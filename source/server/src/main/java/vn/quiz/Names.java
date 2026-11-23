package vn.quiz;
import java.text.Normalizer;
import java.util.Locale;
public final class Names {
 private Names() {}
 public static String display(String raw) {
  Problem.require(raw!=null,"BAD_REQUEST","Vui lòng nhập tên hiển thị.");
  String s=Normalizer.normalize(raw,Normalizer.Form.NFC).replaceAll("[\\p{Z}\\s]+"," ").trim();
  Problem.require(s.codePointCount(0,s.length())>=1 && s.codePointCount(0,s.length())<=50 && s.codePoints().noneMatch(Character::isISOControl),"BAD_REQUEST","Tên hiển thị cần từ 1 đến 50 ký tự.");
  return s;
 }
 public static String normalized(String s) { return Normalizer.normalize(display(s).toLowerCase(Locale.ROOT),Normalizer.Form.NFC); }
}
