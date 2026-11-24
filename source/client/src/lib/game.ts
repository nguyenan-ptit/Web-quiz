// Công thức và tiện ích dùng chung giữa mock server và giao diện.

/** điểm = max(1, floor(P * R / T)) nếu đúng và còn hạn, ngược lại 0. */
export function calcScore(points: number, remainingMs: number, timeLimitMs: number): number {
  if (remainingMs <= 0) return 0;
  return Math.max(1, Math.floor((points * remainingMs) / timeLimitMs));
}

/** Thưởng chuỗi: từ câu đúng thứ 2 liên tiếp, +10 mỗi bậc, tối đa 50. */
export function streakBonus(streakAfterThis: number): number {
  if (streakAfterThis < 2) return 0;
  return Math.min(50, (streakAfterThis - 1) * 10);
}

/** PRNG nhỏ có hạt giống (shuffle_seed) để xáo trộn tái lập được. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomRoomCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
