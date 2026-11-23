package vn.quiz;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import java.util.Map;
@RestController @RequestMapping("/api/auth")
public class AuthController {
 final AuthService auth;
 AuthController(AuthService auth) { this.auth=auth; }
 public record Guest(@NotBlank @Size(max=200) String displayName) {}
 public record Credentials(@NotBlank @Size(max=50) String username,@NotBlank @Size(max=72) String password) {}
 @PostMapping("/guest") Object guest(@Valid @RequestBody Guest g) { return auth.guest(g.displayName()); }
 @PostMapping("/login") Object login(@Valid @RequestBody Credentials c) { return auth.login(c.username(),c.password()); }
 @GetMapping("/me") Object me(@RequestHeader(value="Authorization",required=false) String h) { return auth.user(auth.authenticate(h!=null && h.startsWith("Bearer ")?h.substring(7):null)); }
 @RestControllerAdvice static class Errors {
  @ExceptionHandler(Problem.class) ResponseEntity<?> problem(Problem p) { return ResponseEntity.status(p.code.equals("UNAUTHENTICATED")?401:400).body(Map.of("code",p.code,"message",p.getMessage())); }
  @ExceptionHandler(org.springframework.web.bind.MethodArgumentNotValidException.class) ResponseEntity<?> validation() { return ResponseEntity.badRequest().body(Map.of("code","BAD_REQUEST","message","Vui lòng kiểm tra dữ liệu nhập.")); }
 }
}
