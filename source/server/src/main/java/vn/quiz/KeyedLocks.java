package vn.quiz;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
/** Different rooms never share a lock. Entries disappear after the last waiter releases. */
final class KeyedLocks {
 private static class Entry { final ReentrantLock lock=new ReentrantLock(true); int users; }
 private final ConcurrentHashMap<String,Entry> entries=new ConcurrentHashMap<>();
 final class Lease implements AutoCloseable {
  private final String key; private final Entry entry;
  Lease(String key,Entry entry){this.key=key;this.entry=entry;}
  public void close(){entry.lock.unlock();entries.compute(key,(k,e)->{if(e!=entry) throw new IllegalStateException("Lock registry mismatch");return --e.users==0?null:e;});}
 }
 Lease acquire(String key){var e=entries.compute(key,(k,v)->{if(v==null) v=new Entry();v.users++;return v;});e.lock.lock();return new Lease(key,e);}
}
