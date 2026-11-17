// Trạng thái thời gian thực (sảnh, phòng, trận) do socket đẩy về. Zustand giữ một bản duy nhất.
import { create } from 'zustand';
import type { QuestionResultPayload } from '../protocol';
import type { ChatMessage, LeaderboardEntry, LobbyRoom, QuestionView, Room, RoomMode, User } from '../types';

export type ConnStatus = 'IDLE' | 'CONNECTING' | 'AUTHENTICATING' | 'OPEN' | 'RECONNECTING' | 'REPLACED' | 'CLOSED';

export interface LogEntry {
  id: number;
  dir: 'in' | 'out';
  type: string;
  at: number;
  body: string;
}

export interface MyAnswer {
  roundId: string;
  choiceIds: number[];
  pending: boolean;
  result: 'CORRECT' | 'WRONG' | 'TIMEOUT' | null;
  score: number;
  bonus: number;
  streak: number;
}

export interface GameView {
  gameId: string;
  mode: RoomMode;
  quizTitle: string;
  questionCount: number;
  startsAt: number | null;
  question: QuestionView | null;
  answer: MyAnswer | null;
  liveResult: QuestionResultPayload | null;
  totalScore: number;
  leaderboard: LeaderboardEntry[];
  finishedSelf: boolean;
  standings: LeaderboardEntry[] | null;
  history: { index: number; result: MyAnswer['result']; score: number }[];
}

export interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'error' | 'success';
}

interface LiveState {
  status: ConnStatus;
  retryAt: number | null;
  attempt: number;
  me: User | null;
  serverOffset: number;
  log: LogEntry[];
  lobbyWanted: boolean;
  lobby: LobbyRoom[] | null;
  room: Room | null;
  roomQuizTitle: string | null;
  roomQuizCount: number;
  messages: ChatMessage[];
  game: GameView | null;
  notices: Notice[];
  nav: { to: string; seq: number } | null;
}

export const initialLive: LiveState = {
  status: 'IDLE',
  retryAt: null,
  attempt: 0,
  me: null,
  serverOffset: 0,
  log: [],
  lobbyWanted: false,
  lobby: null,
  room: null,
  roomQuizTitle: null,
  roomQuizCount: 0,
  messages: [],
  game: null,
  notices: [],
  nav: null,
};

export const useLive = create<LiveState>(() => ({ ...initialLive }));

let seq = 0;
export function pushLog(dir: LogEntry['dir'], type: string, body: unknown) {
  useLive.setState((s) => ({
    log: [...s.log.slice(-199), { id: ++seq, dir, type, at: Date.now(), body: JSON.stringify(body, null, 2) }],
  }));
}

export function notify(text: string, tone: Notice['tone'] = 'info') {
  const id = ++seq;
  useLive.setState((s) => ({ notices: [...s.notices, { id, text, tone }] }));
  setTimeout(() => useLive.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) })), 4000);
}

export function navigateTo(to: string) {
  useLive.setState({ nav: { to, seq: ++seq } });
}

/** Giờ server ước lượng, dùng để đếm ngược theo deadlineAt. */
export function serverNow() {
  return Date.now() + useLive.getState().serverOffset;
}
