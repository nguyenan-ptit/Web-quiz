package vn.quiz;

import java.sql.Timestamp;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.*;
import java.util.function.LongPredicate;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import com.fasterxml.jackson.databind.JsonNode;
import static vn.quiz.Problem.require;

/** Database mutations only. Caller holds room serialization lock; sends happen after tx returns. */
@Service
public class RoomService {
 final JdbcTemplate db; final TransactionTemplate tx; final Clock clock;
 private final AuthService auth;
 private final SecureRandom random=new SecureRandom();
 RoomService(JdbcTemplate db,TransactionTemplate tx,Clock clock,AuthService auth) {
  this.db=db; this.tx=tx; this.clock=clock; this.auth=auth;
 }
 public record Member(long userId,String displayName,boolean isGuest,boolean online) {}
 public record Snapshot(String roomId,String roomCode,String title,String status,String visibility,boolean hasPassword,long hostUserId,int maxPlayers,int memberCount,List<Member> members,long roomVersion) {}
 public record Change(String roomId,List<Long> recipients,Long kicked,boolean closed) {}
 Timestamp now() { return Timestamp.from(clock.instant()); }
 public String current(long user) {
  var rows=db.queryForList("SELECT room_id FROM room_members WHERE user_id=? AND status='JOINED'",String.class,user);
  return rows.isEmpty()?null:rows.get(0);
 }
 public String byCode(String code) {
  var rows=db.queryForList("SELECT id FROM rooms WHERE room_code=?",String.class,code);
  require(!rows.isEmpty(),"ROOM_NOT_FOUND","Không tìm thấy phòng với mã này."); return rows.get(0);
 }
 public static String text(JsonNode p,String key,int max,boolean optional) {
  JsonNode n=p.get(key);
  if(optional && (n==null || n.isNull())) return null;
  require(n!=null && n.isTextual() && n.textValue().length()<=max,"BAD_REQUEST","Trường "+key+" không hợp lệ."); return n.textValue();
 }
 public static String code(JsonNode p) {
  String c=text(p,"roomCode",30,false).trim().toUpperCase(Locale.ROOT);
  require(c.matches("[A-Z0-9]{6}"),"BAD_REQUEST","Mã phòng gồm đúng 6 chữ cái hoặc chữ số."); return c;
 }
 public static long target(JsonNode p) {
  var n=p.get("targetUserId"); require(n!=null && n.isIntegralNumber() && n.canConvertToLong() && n.longValue()>0,"BAD_REQUEST","Thành viên đích không hợp lệ."); return n.longValue();
 }
 String nextCode() {
  String alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; StringBuilder b=new StringBuilder();
  for(int i=0;i<6;i++) b.append(alphabet.charAt(random.nextInt(alphabet.length()))); return b.toString();
 }
 public String create(AuthService.Identity actor,JsonNode p) {
  require(!actor.isGuest(),"FORBIDDEN","Khách cần đăng nhập tài khoản để tạo phòng.");
  String title=text(p,"title",100,false).strip(); require(!title.isEmpty(),"BAD_REQUEST","Vui lòng nhập tên phòng.");
  String display=Names.display(text(p,"displayName",200,false));
  String visibility=text(p,"visibility",10,false); require(Set.of("PUBLIC","PRIVATE").contains(visibility),"BAD_REQUEST","Chế độ phòng không hợp lệ.");
  JsonNode count=p.get("maxPlayers"); int max=count==null?20:count.asInt(-1);
  require((count==null || count.isIntegralNumber()) && max>=2 && max<=100,"BAD_REQUEST","Số người cần từ 2 đến 100.");
  String password=text(p,"password",72,true);
  require(password==null || password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=72,"BAD_REQUEST","Mật khẩu tối đa 72 byte UTF-8.");
  String hash=password==null || password.isEmpty()?null:auth.bcrypt.encode(password);
  for(int attempt=0;attempt<8;attempt++) {
   String id=UUID.randomUUID().toString(), code=nextCode();
   try { return tx.execute(s->{
    lockUser(actor.userId()); require(current(actor.userId())==null,"ALREADY_IN_ROOM","Bạn đang ở một phòng khác.");
    db.update("INSERT INTO rooms(id,room_code,title,host_user_id,visibility,password_hash,max_players) VALUES(?,?,?,?,?,?,?)",id,code,title,actor.userId(),visibility,hash,max);
    db.update("INSERT INTO room_members(room_id,user_id,display_name,normalized_name,joined_at) VALUES(?,?,?,?,?)",id,actor.userId(),display,Names.normalized(display),now());
    return id;
   }); } catch(DuplicateKeyException e) {
    // A retry starts a fresh transaction. Other uniqueness errors must never be retried as a create.
    if(db.queryForObject("SELECT COUNT(*) FROM rooms WHERE room_code=?",Long.class,code)==0) throw e;
   }
  }
  throw new Problem("BAD_REQUEST","Chưa cấp được mã phòng, vui lòng thử lại.");
 }
 void lockUser(long user) { require("ACTIVE".equals(db.queryForObject("SELECT status FROM users WHERE id=? FOR UPDATE",String.class,user)),"UNAUTHENTICATED","Tài khoản không còn hoạt động."); }
 Map<String,Object> lockRoom(String id) {
  var rows=db.queryForList("SELECT * FROM rooms WHERE id=? FOR UPDATE",id);
  require(!rows.isEmpty(),"ROOM_NOT_FOUND","Không tìm thấy phòng."); var r=rows.get(0);
  require(r.get("status").equals("WAITING"),"ROOM_NOT_WAITING","Phòng không còn ở trạng thái chờ."); return r;
 }
 List<Long> recipients(String room) { return db.queryForList("SELECT user_id FROM room_members WHERE room_id=? AND status='JOINED' ORDER BY joined_at,id",Long.class,room); }
 public Change join(AuthService.Identity actor,String id,JsonNode p) {
  String display=Names.display(text(p,"displayName",200,false)); String password=text(p,"password",72,true);
  return tx.execute(s->{
   lockUser(actor.userId()); var r=lockRoom(id); String current=current(actor.userId());
   require(current==null || current.equals(id),"ALREADY_IN_ROOM","Bạn đang ở một phòng khác.");
   if(id.equals(current)) return new Change(id,recipients(id),null,false);
   String hash=(String)r.get("password_hash");
   require(hash==null || (password!=null && password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=72 && auth.bcrypt.matches(password,hash)),"WRONG_PASSWORD","Mật khẩu phòng không đúng.");
   var old=db.queryForList("SELECT status FROM room_members WHERE room_id=? AND user_id=?",String.class,id,actor.userId());
   require(old.isEmpty() || !old.get(0).equals("KICKED"),"KICKED","Bạn đã được mời ra khỏi phòng này.");
   require(db.queryForObject("SELECT COUNT(*) FROM room_members WHERE room_id=? AND status='JOINED' AND normalized_name=?",Long.class,id,Names.normalized(display))==0,"NAME_TAKEN","Tên hiển thị đã được dùng trong phòng.");
   require(recipients(id).size()<((Number)r.get("max_players")).intValue(),"ROOM_FULL","Phòng đã đủ người.");
   if(old.isEmpty()) db.update("INSERT INTO room_members(room_id,user_id,display_name,normalized_name,joined_at) VALUES(?,?,?,?,?)",id,actor.userId(),display,Names.normalized(display),now());
   else db.update("UPDATE room_members SET display_name=?,normalized_name=?,status='JOINED',joined_at=?,left_at=NULL WHERE room_id=? AND user_id=?",display,Names.normalized(display),now(),id,actor.userId());
   return new Change(id,recipients(id),null,false);
  });
 }
 public Change manage(long actor,String id,String type,long target,LongPredicate online) {
  return tx.execute(s->{
   var r=lockRoom(id); var members=recipients(id);
   require(((Number)r.get("host_user_id")).longValue()==actor && members.contains(actor),"FORBIDDEN","Chỉ chủ phòng hiện tại được thực hiện thao tác này.");
   require(target!=actor && members.contains(target),"INVALID_HOST_TARGET","Hãy chọn thành viên khác đang ở phòng.");
   if(type.equals("TRANSFER_HOST")) {
    boolean guest=db.queryForObject("SELECT is_guest FROM users WHERE id=?",Boolean.class,target);
    require(!guest && online.test(target),"INVALID_HOST_TARGET","Chỉ chuyển quyền cho tài khoản thật đang trực tuyến.");
    db.update("UPDATE rooms SET host_user_id=? WHERE id=?",target,id);
    return new Change(id,members,null,false);
   }
   db.update("UPDATE room_members SET status='KICKED',left_at=? WHERE room_id=? AND user_id=?",now(),id,target);
   return new Change(id,members,target,false);
  });
 }
 /** Single policy for explicit leave and grace expiry. Caller serializes with joins and presence. */
 public Change leave(long actor,String id,LongPredicate online) {
  return tx.execute(s->{
   var r=lockRoom(id); var before=recipients(id);
   if(!before.contains(actor)) return new Change(id,before,null,false);
   db.update("UPDATE room_members SET status='LEFT',left_at=? WHERE room_id=? AND user_id=? AND status='JOINED'",now(),id,actor);
   if(((Number)r.get("host_user_id")).longValue()==actor) {
    Long next=successor(id,online);
    if(next!=null) db.update("UPDATE rooms SET host_user_id=? WHERE id=?",next,id);
    else {
     db.update("UPDATE room_members SET status='LEFT',left_at=? WHERE room_id=? AND status='JOINED'",now(),id);
     db.update("UPDATE rooms SET status='CLOSED',closed_at=? WHERE id=?",now(),id);
     return new Change(id,before,null,true);
    }
   }
   return new Change(id,before,null,false);
  });
 }
 Long successor(String id,LongPredicate online) {
  return db.queryForList("SELECT m.user_id FROM room_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=? AND m.status='JOINED' AND u.is_guest=FALSE AND u.status='ACTIVE' ORDER BY m.joined_at,m.id",Long.class,id).stream().filter(online::test).findFirst().orElse(null);
 }
 public Snapshot snapshot(String id,long version,LongPredicate online) {
  return tx.execute(s->{
   var r=db.queryForMap("SELECT id,room_code,title,status,visibility,password_hash IS NOT NULL has_password,host_user_id,max_players FROM rooms WHERE id=?",id);
   var m=db.query("SELECT m.user_id,m.display_name,u.is_guest FROM room_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=? AND m.status='JOINED' ORDER BY m.joined_at,m.id",(rs,n)->new Member(rs.getLong(1),rs.getString(2),rs.getBoolean(3),online.test(rs.getLong(1))),id);
   return new Snapshot(id,(String)r.get("room_code"),(String)r.get("title"),(String)r.get("status"),(String)r.get("visibility"),((Number)r.get("has_password")).intValue()!=0,((Number)r.get("host_user_id")).longValue(),((Number)r.get("max_players")).intValue(),m.size(),m,version);
  });
 }
 @jakarta.annotation.PostConstruct void reconcile() {
  tx.executeWithoutResult(s->{
   db.update("UPDATE room_members m JOIN rooms r ON r.id=m.room_id SET m.status='LEFT',m.left_at=? WHERE r.status='WAITING' AND m.status='JOINED'",now());
   db.update("UPDATE rooms SET status='CLOSED',closed_at=? WHERE status='WAITING'",now());
  });
 }
}
