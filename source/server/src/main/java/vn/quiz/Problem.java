package vn.quiz;
public class Problem extends RuntimeException {
 public final String code;
 public Problem(String code,String message) { super(message); this.code=code; }
 public static void require(boolean ok,String code,String message) { if(!ok) throw new Problem(code,message); }
}
