package vn.quiz;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
@Service
public class AuthService {
 public record Identity(String sessionId,long userId,String displayName,boolean isGuest,Instant expiresAt) {}
 public record User(long userId,String displayName,boolean isGuest) {}
 public record Login(String token,User user) {}
 final JdbcTemplate db; final TransactionTemplate tx; final Clock clock;
 final BCryptPasswordEncoder bcrypt=new BCryptPasswordEncoder();
 private final SecureRandom random=new SecureRandom();
 AuthService(JdbcTemplate db,TransactionTemplate tx,Clock clock) { this.db=db; this.tx=tx; this.clock=clock; }
 public static byte[] hash(String token) {
  try { return MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)); }
  catch(NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
 }
 public User user(Identity i) { return new User(i.userId(),i.displayName(),i.isGuest()); }
 public Identity authenticate(String token) {
  Problem.require(token!=null && token.length()>=32 && token.length()<=128,"UNAUTHENTICATED","Phiên không còn hợp lệ. Vui lòng đăng nhập lại.");
  var rows=db.query("SELECT s.id,s.user_id,u.display_name,u.is_guest,s.expires_at FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='ACTIVE'",
   (r,n)->new Identity(r.getString(1),r.getLong(2),r.getString(3),r.getBoolean(4),r.getTimestamp(5).toInstant()),hash(token),Timestamp.from(clock.instant()));
  Problem.require(!rows.isEmpty(),"UNAUTHENTICATED","Phiên đã hết hạn hoặc bị thu hồi.");
  Identity i=rows.get(0);
  db.update("UPDATE user_sessions SET last_seen_at=? WHERE id=? AND (last_seen_at IS NULL OR last_seen_at<?)",Timestamp.from(clock.instant()),i.sessionId(),Timestamp.from(clock.instant().minusSeconds(60)));
  return i;
 }
 public Login guest(String name) { return tx.execute(s->{
  db.update("INSERT INTO users(display_name,is_guest) VALUES (?,TRUE)",Names.display(name));
  long id=db.queryForObject("SELECT LAST_INSERT_ID()",Long.class);
  return issue(id);
 }); }
 public Login login(String username,String password) {
  Problem.require(username!=null && username.length()<=50 && password!=null && password.getBytes(StandardCharsets.UTF_8).length<=72,"BAD_REQUEST","Thông tin đăng nhập không hợp lệ.");
  var rows=db.queryForList("SELECT id,password_hash FROM users WHERE username=? AND is_guest=FALSE AND status='ACTIVE'",username);
  String hash=rows.isEmpty()?"$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy":(String)rows.get(0).get("password_hash");
  boolean match=bcrypt.matches(password,hash);
  Problem.require(!rows.isEmpty() && match,"UNAUTHENTICATED","Tên đăng nhập hoặc mật khẩu không đúng.");
  return tx.execute(s->issue(((Number)rows.get(0).get("id")).longValue()));
 }
 private Login issue(long userId) {
  byte[] bytes=new byte[32]; random.nextBytes(bytes); String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  db.update("INSERT INTO user_sessions(id,user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)",UUID.randomUUID().toString(),userId,hash(token),Timestamp.from(clock.instant()),Timestamp.from(clock.instant().plus(Duration.ofDays(7))));
  return new Login(token,user(authenticate(token)));
 }
}
