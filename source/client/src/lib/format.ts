import type { GameStatus, PlayerStatus, QuestionType, RoomMode, RoundStatus } from '../types';

export const MODE_LABEL: Record<RoomMode, string> = {
  SELF_PACED: 'Tiến độ riêng',
  LIVE: 'Đồng bộ',
};

export const QTYPE_LABEL: Record<QuestionType, string> = {
  SINGLE: 'Một đáp án',
  MULTIPLE: 'Nhiều đáp án',
  TRUE_FALSE: 'Đúng / Sai',
};

export const ROUND_LABEL: Record<RoundStatus, string> = {
  ACTIVE: 'Đang mở',
  CORRECT: 'Đúng',
  WRONG: 'Sai',
  TIMEOUT: 'Hết giờ',
  CANCELLED: 'Đã hủy',
};

export const PLAYER_STATUS_LABEL: Record<PlayerStatus, string> = {
  PLAYING: 'Đang chơi',
  DISCONNECTED: 'Mất kết nối',
  COMPLETED: 'Hoàn thành',
  LEFT: 'Đã rời',
};

export const GAME_STATUS_LABEL: Record<GameStatus, string> = {
  RUNNING: 'Đang chạy',
  FINISHED: 'Đã kết thúc',
  CANCELLED: 'Đã hủy',
};

export function fmtDateTime(isoStr: string | null): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} giây`;
}

export function fmtDuration(fromIso: string, toIso: string | null): string {
  if (!toIso) return '—';
  const s = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} phút ${s % 60} giây` : `${s} giây`;
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1] ?? '?';
  return last.slice(0, 2).toUpperCase();
}
