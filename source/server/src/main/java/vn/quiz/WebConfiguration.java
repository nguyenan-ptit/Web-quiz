package vn.quiz;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.web.socket.config.annotation.*;
@Configuration @EnableWebSocket
public class WebConfiguration implements WebSocketConfigurer {
 final RoomSocket socket; final String[] origins;
 WebConfiguration(RoomSocket socket,@Value("${quiz.origins}") String origins) { this.socket=socket; this.origins=origins.split(","); }
 public void registerWebSocketHandlers(WebSocketHandlerRegistry r) { r.addHandler(socket,"/ws").setAllowedOrigins(origins); }
 @Bean SecurityFilterChain security(HttpSecurity http) throws Exception {
  return http.csrf(c->c.disable()).sessionManagement(c->c.sessionCreationPolicy(SessionCreationPolicy.STATELESS)).authorizeHttpRequests(c->c.requestMatchers("/ws","/api/auth/guest","/api/auth/login","/api/auth/me").permitAll().anyRequest().denyAll()).build();
 }
}
