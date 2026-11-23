package vn.quiz;

import com.fasterxml.jackson.databind.*;
import java.io.IOException;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.*;
import static vn.quiz.Problem.require;

@Component
public class RoomSocket extends TextWebSocketHandler {
 record Reply(String type,String requestId,long serverTime,Object payload) {}
 record Cached(String fingerprint,Reply reply) {}
 static class History {
  final LinkedHashMap<String,Cached> entries=new LinkedHashMap<>(); final long expires;
  History(long expires) { this.expires=expires; }
  void put(String id,Cached c) { entries.put(id,c); if(entries.size()>100) entries.remove(entries.keySet().iterator().next()); }
 }
 static class Connection {
  final WebSocketSession socket; final long opened; volatile long lastActivity;
  volatile AuthService.Identity identity; volatile String token;
  Connection(WebSocketSession s,long now) { socket=new ConcurrentWebSocketSessionDecorator(s,3000,65536); opened=now; lastActivity=now; }
 }
 record Grace(String connectionId,long deadline) {}
 final AuthService auth; final RoomService rooms; final ObjectMapper json; final Clock clock;
 final ConcurrentMap<String,Connection> connections=new ConcurrentHashMap<>();
 final ConcurrentMap<Long,Connection> controllers=new ConcurrentHashMap<>();
 final ConcurrentMap<Long,Grace> grace=new ConcurrentHashMap<>();
 final ConcurrentMap<String,History> histories=new ConcurrentHashMap<>();
 volatile long lastHistoryCleanup;
 // Bounded user stripes; reference-counted room locks serialize commands and presence.
 final Object[] userLocks=locks();
 final KeyedLocks roomLocks=new KeyedLocks(); final AtomicLong version=new AtomicLong();
 static Object[] locks() { Object[] a=new Object[1024]; Arrays.setAll(a,i->new Object()); return a; }
 Object userLock(long user) { return userLocks[Math.floorMod(Long.hashCode(user),userLocks.length)]; }
 RoomSocket(AuthService auth,RoomService rooms,ObjectMapper json,Clock clock) { this.auth=auth;this.rooms=rooms;this.json=json;this.clock=clock; }
 long now() { return clock.millis(); }
 boolean online(long u) { var c=controllers.get(u); return c!=null && c.socket.isOpen(); }
 Reply reply(String type,String request,Object payload) { return new Reply(type,request,now(),payload); }
 Reply error(String request,Problem p) { return reply("ERROR",request,Map.of("code",p.code,"message",p.getMessage())); }
 void send(Connection c,Reply r) {
  if(c==null || !c.socket.isOpen()) return;
  try { c.socket.sendMessage(new TextMessage(json.writeValueAsString(r))); }
  catch(Exception ignored) { close(c,1011); } // Commit has already happened; never replay a mutation on send failure.
 }
 void close(Connection c,int code) { try { c.socket.close(new CloseStatus(code)); } catch(IOException ignored) {} }
 void toUser(long user,Reply reply) { send(controllers.get(user),reply); }
 @Override public void afterConnectionEstablished(WebSocketSession s) {
  s.setTextMessageSizeLimit(16384); s.setBinaryMessageSizeLimit(0);
  connections.put(s.getId(),new Connection(s,now()));
 }
 @Override protected void handleTextMessage(WebSocketSession s,TextMessage message) {
  Connection c=connections.get(s.getId()); if(c==null) return;
  String request=null;
  try {
   require(message.getPayloadLength()<=16384,"BAD_REQUEST","Thông điệp quá lớn.");
   JsonNode n=json.readTree(message.getPayload());
   require(n!=null && n.isObject(),"BAD_REQUEST","Thông điệp phải là JSON object.");
   request=RoomService.text(n,"requestId",36,false);
   require(request.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"),"BAD_REQUEST","requestId cần là UUID.");
   String type=RoomService.text(n,"type",32,false); JsonNode p=n.get("payload");
   require(p!=null && p.isObject(),"BAD_REQUEST","payload phải là object.");
   if(c.identity==null) {
    require(type.equals("AUTH"),"UNAUTHENTICATED","AUTH phải là thông điệp đầu tiên.");
    authenticate(c,request,p); return;
   }
   var identity=auth.authenticate(c.token);
   synchronized(userLock(identity.userId())) {
    require(controllers.get(identity.userId())==c,"UNAUTHENTICATED","Kết nối đã bị thay thế.");
    c.lastActivity=now();
    if(type.equals("PING")) { send(c,reply("PONG",request,Map.of())); return; }
    require(!type.equals("AUTH"),"BAD_REQUEST","Kết nối đã xác thực.");
    History history=histories.get(identity.sessionId());
    require(history!=null,"UNAUTHENTICATED","Phiên cần kết nối lại.");
    synchronized(history) {
     // Canonical JSON makes object field order irrelevant; cache contains only a digest of secrets.
     String fingerprint=HexFormat.of().formatHex(AuthService.hash(type+canonical(p)));
     Cached old=history.entries.get(request);
     if(old!=null) {
      require(old.fingerprint().equals(fingerprint),"BAD_REQUEST","requestId đã được dùng với nội dung khác.");
      send(c,old.reply()); return;
     }
     Reply response;
     try { response=command(c,request,type,p); }
     catch(Problem e) { response=error(request,e); }
     catch(org.springframework.dao.DataIntegrityViolationException e) { response=error(request,new Problem("BAD_REQUEST","Dữ liệu vừa thay đổi. Vui lòng kiểm tra phòng và thử lại.")); }
     history.put(request,new Cached(fingerprint,response));
     send(c,response);
    }
   }
  } catch(Problem e) {
   send(c,error(request,e)); if(e.code.equals("UNAUTHENTICATED")) close(c,4001);
  } catch(Exception e) { send(c,error(request,new Problem("BAD_REQUEST","Không xử lý được thông điệp. Vui lòng thử lại."))); }
 }
 String canonical(JsonNode n) { return canonicalNode(n).toString(); }
 JsonNode canonicalNode(JsonNode n) {
  if(n.isObject()) { var out=json.createObjectNode(); var keys=new TreeSet<String>(); n.fieldNames().forEachRemaining(keys::add); keys.forEach(k->out.set(k,canonicalNode(n.get(k)))); return out; }
  if(n.isArray()) { var out=json.createArrayNode(); n.forEach(v->out.add(canonicalNode(v))); return out; }
  return n;
 }
 void authenticate(Connection c,String request,JsonNode p) {
  require(now()-c.opened<=5000,"UNAUTHENTICATED","Quá thời hạn xác thực.");
  String token=RoomService.text(p,"token",128,false); var i=auth.authenticate(token);
  synchronized(userLock(i.userId())) {
   // Expiry is checked before restoring even if the scheduled sweep has not run yet.
   expire(i.userId());
   synchronized(histories) {
    require(histories.containsKey(i.sessionId()) || histories.size()<10000,"BAD_REQUEST","Máy chủ đang bận, vui lòng thử lại.");
    histories.computeIfAbsent(i.sessionId(),k->new History(i.expiresAt().toEpochMilli()));
   }
   c.identity=i; c.token=token; c.lastActivity=now();
   String room=rooms.current(i.userId());
   Runnable replace=()->{
    Connection old=controllers.put(i.userId(),c); grace.remove(i.userId());
    if(old!=null && old!=c) { send(old,reply("SESSION_REPLACED",null,Map.of("reason","Tài khoản đã kết nối ở cửa sổ khác."))); close(old,4002); }
    send(c,reply("AUTH_OK",request,auth.user(i)));
    if(room!=null) {
     var snapshot=rooms.snapshot(room,version.incrementAndGet(),this::online);
     send(c,reply("ROOM_STATE",null,snapshot)); broadcast(snapshot,null);
    }
   };
   if(room==null) replace.run(); else try(var lease=roomLocks.acquire(room)) { replace.run(); }
  }
 }
 Reply command(Connection c,String request,String type,JsonNode p) {
  long user=c.identity.userId();
  if(type.equals("CREATE_ROOM")) {
   String id=rooms.create(c.identity,p);
   try(var lease=roomLocks.acquire(id)) { return reply("ROOM_STATE",request,rooms.snapshot(id,version.incrementAndGet(),this::online)); }
  }
  String room=type.equals("JOIN_ROOM")?rooms.byCode(RoomService.code(p)):rooms.current(user);
  require(room!=null,"ROOM_NOT_FOUND","Bạn chưa tham gia phòng nào.");
  try(var lease=roomLocks.acquire(room)) {
   if(type.equals("JOIN_ROOM")) {
    rooms.join(c.identity,room,p);
    var snapshot=rooms.snapshot(room,version.incrementAndGet(),this::online);
    broadcast(snapshot,user); return reply("ROOM_STATE",request,snapshot);
   }
   if(type.equals("LEAVE_ROOM")) {
    var change=rooms.leave(user,room,this::online); grace.remove(user); publish(change,user);
    return reply("ROOM_LEFT",request,Map.of("reason","Bạn đã rời phòng.","roomId",room));
   }
   require(Set.of("TRANSFER_HOST","KICK_MEMBER").contains(type),"BAD_REQUEST","Loại thông điệp không được hỗ trợ.");
   var change=rooms.manage(user,room,type,RoomService.target(p),this::online);
   if(change.kicked()!=null) {
    grace.remove(change.kicked()); toUser(change.kicked(),reply("MEMBER_KICKED",null,Map.of("reason","Chủ phòng đã mời bạn ra.","roomId",room)));
   }
   var snapshot=rooms.snapshot(room,version.incrementAndGet(),this::online); broadcast(snapshot,user);
   return reply("ROOM_STATE",request,snapshot);
  }
 }
 void broadcast(RoomService.Snapshot snapshot,Long except) {
  Reply event=reply("ROOM_UPDATED",null,snapshot);
  for(var m:snapshot.members()) if(except==null || m.userId()!=except) toUser(m.userId(),event);
 }
 void publish(RoomService.Change change,Long left) {
  if(change.closed()) {
   for(long u:change.recipients()) {
    grace.remove(u);
    if(left==null || u!=left) toUser(u,reply("ROOM_CLOSED",null,Map.of("roomId",change.roomId(),"reason","Phòng đã đóng vì không có tài khoản thật trực tuyến để làm chủ phòng.")));
   }
  } else broadcast(rooms.snapshot(change.roomId(),version.incrementAndGet(),this::online),left);
 }
 @Override public void afterConnectionClosed(WebSocketSession s,CloseStatus status) { disconnected(s.getId()); }
 @Override public void handleTransportError(WebSocketSession s,Throwable error) { var c=connections.get(s.getId()); if(c!=null) close(c,1011); disconnected(s.getId()); }
 void disconnected(String id) {
  Connection c=connections.remove(id); if(c==null || c.identity==null) return;
  long user=c.identity.userId();
  synchronized(userLock(user)) {
   if(!controllers.remove(user,c)) return; // Old close callback cannot disconnect a new controller.
   String room=rooms.current(user); if(room==null) return;
   try(var lease=roomLocks.acquire(room)) {
    grace.put(user,new Grace(id,now()+30000));
    broadcast(rooms.snapshot(room,version.incrementAndGet(),this::online),null);
   }
  }
 }
 void expire(long user) {
  synchronized(userLock(user)) {
   Grace g=grace.get(user);
   if(g==null || g.deadline()>now() || controllers.containsKey(user)) return;
   String room=rooms.current(user);
   if(room==null) { grace.remove(user,g); return; }
   try(var lease=roomLocks.acquire(room)) {
    if(!grace.remove(user,g)) return;
    publish(rooms.leave(user,room,this::online),user);
   }
  }
 }
 @Scheduled(fixedDelay=1000) public void sweep() {
  for(Connection c:connections.values()) {
   try {
    if(c.identity==null) { if(now()-c.opened>5000) close(c,4001); }
    else if(now()-c.lastActivity>30000) { close(c,4000); disconnected(c.socket.getId()); }
    else {
     try { auth.authenticate(c.token); }
     catch(Problem p) { send(c,error(null,p)); close(c,4001); disconnected(c.socket.getId()); }
    }
   } catch(Exception ignored) { /* Isolate failed connections so other grace deadlines still run. */ }
  }
  for(long user:grace.keySet()) { try { expire(user); } catch(Exception ignored) {} }
  histories.entrySet().removeIf(e->e.getValue().expires<=now());
  if(now()-lastHistoryCleanup>=60000 && !histories.isEmpty()) {
   lastHistoryCleanup=now();
   var valid=new HashSet<>(auth.db.queryForList("SELECT s.id FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.revoked_at IS NULL AND s.expires_at>? AND u.status='ACTIVE'",String.class,java.sql.Timestamp.from(clock.instant())));
   histories.keySet().removeIf(k->!valid.contains(k));
  }
 }
 @Override protected void handleBinaryMessage(WebSocketSession s,BinaryMessage m) { var c=connections.get(s.getId()); if(c!=null) close(c,1003); }
}
