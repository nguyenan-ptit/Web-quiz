// Mock của REST API trong thiết kế (mục "REST API"). Mỗi hàm tương ứng một endpoint,
// trả Promise sau một độ trễ nhỏ để giống gọi mạng. Khi có backend thật, chỉ cần thay
// phần thân hàm bằng fetch() tới endpoint ghi trong chú thích; chữ ký giữ nguyên.

import type {
  Choice,
  Game,
  GameHistoryItem,
  GlobalLeaderboardEntry,
  Question,
  QuestionStat,
  QuestionType,
  QuizSet,
  QuizSetSummary,
  User,
  UserStatus,
  Visibility,
} from '../types';
import { db, DEMO_PASSWORD } from './data';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const LATENCY = 250;
const delay = <T>(value: T, ms = LATENCY): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms));
const fail = (code: string, message: string, ms = LATENCY): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new ApiError(code, message)), ms));

// ------------------------------------------------------------ token phiên
// Token thật là chuỗi ngẫu nhiên, server lưu SHA-256 trong user_sessions.
// Ở mock, token mã hóa luôn userId để tải lại trang vẫn giữ phiên.
const TOKEN_KEY = 'quiz.token';

interface TokenPayload {
  uid: number;
  guestName?: string;
}

function issueToken(user: User): string {
  const p: TokenPayload = { uid: user.id, guestName: user.isGuest ? user.displayName : undefined };
  return 'mock.' + btoa(unescape(encodeURIComponent(JSON.stringify(p))));
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* bỏ qua */
  }
}

/** Server phân giải token → user. Dùng chung cho REST và socket (AUTH). */
export function resolveToken(token: string | null): User | null {
  if (!token?.startsWith('mock.')) return null;
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(token.slice(5))))) as TokenPayload;
    let u = db.users.find((x) => x.id === p.uid);
    if (!u && p.guestName) {
      // khách tạo ở phiên trước: dữ liệu mock đã reset, tạo lại dòng users
      u = makeGuest(p.guestName, p.uid);
    }
    if (!u || u.status === 'LOCKED') return null;
    return u;
  } catch {
    return null;
  }
}

function makeGuest(displayName: string, id = db.seq.user++): User {
  const u: User = {
    id,
    username: null,
    email: null,
    displayName,
    role: 'USER',
    isGuest: true,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  };
  db.users.push(u);
  return u;
}

function requireUser(opts: { noGuest?: boolean; admin?: boolean } = {}): User {
  const u = resolveToken(getToken());
  if (!u) throw new ApiError('UNAUTHENTICATED', 'Phiên đăng nhập đã hết hạn');
  if (opts.noGuest && u.isGuest) throw new ApiError('FORBIDDEN', 'Khách không dùng được chức năng này');
  if (opts.admin && u.role !== 'ADMIN') throw new ApiError('FORBIDDEN', 'Chỉ admin');
  return u;
}

/** Bọc thân hàm: lỗi ném ra thành Promise bị từ chối sau độ trễ. */
function handle<T>(fn: () => T): Promise<T> {
  try {
    return delay(fn());
  } catch (e) {
    if (e instanceof ApiError) return fail(e.code, e.message);
    throw e;
  }
}

const userName = (id: number) => db.users.find((u) => u.id === id)?.displayName ?? `#${id}`;
const now = () => new Date().toISOString();

// ============================================================ Xác thực
export const authApi = {
  /** POST /api/auth/register */
  register(input: { username: string; email: string; displayName: string; password: string }) {
    return handle(() => {
      const username = input.username.trim();
      if (!/^[a-zA-Z0-9_]{3,32}$/.test(username))
        throw new ApiError('BAD_REQUEST', 'Tên đăng nhập 3–32 ký tự, chỉ gồm chữ, số, gạch dưới');
      if (input.password.length < 8) throw new ApiError('BAD_REQUEST', 'Mật khẩu tối thiểu 8 ký tự');
      if (db.users.some((u) => u.username?.toLowerCase() === username.toLowerCase()))
        throw new ApiError('BAD_REQUEST', 'Tên đăng nhập đã tồn tại');
      if (db.users.some((u) => u.email?.toLowerCase() === input.email.trim().toLowerCase()))
        throw new ApiError('BAD_REQUEST', 'Email đã được dùng');
      const u: User = {
        id: db.seq.user++,
        username,
        email: input.email.trim(),
        displayName: input.displayName.trim() || username,
        role: 'USER',
        isGuest: false,
        status: 'ACTIVE',
        createdAt: now(),
      };
      db.users.push(u);
      db.passwords[u.id] = input.password;
      const token = issueToken(u);
      setToken(token);
      return { token, user: u };
    });
  },

  /** POST /api/auth/login */
  login(input: { username: string; password: string }) {
    return handle(() => {
      const u = db.users.find((x) => x.username?.toLowerCase() === input.username.trim().toLowerCase());
      if (!u || db.passwords[u.id] !== input.password)
        throw new ApiError('UNAUTHENTICATED', 'Sai tên đăng nhập hoặc mật khẩu');
      if (u.status === 'LOCKED') throw new ApiError('FORBIDDEN', 'Tài khoản đã bị khóa');
      const token = issueToken(u);
      setToken(token);
      return { token, user: u };
    });
  },

  /** POST /api/auth/guest */
  guest(input: { displayName: string }) {
    return handle(() => {
      const name = input.displayName.trim();
      if (name.length < 2 || name.length > 30) throw new ApiError('BAD_REQUEST', 'Tên hiển thị 2–30 ký tự');
      const u = makeGuest(name);
      const token = issueToken(u);
      setToken(token);
      return { token, user: u };
    });
  },

  /** POST /api/auth/logout */
  logout() {
    setToken(null);
    return delay(true, 100);
  },

  /** GET /api/auth/me */
  me() {
    return handle(() => requireUser());
  },
};

// ============================================================ Hồ sơ
export const userApi = {
  /** PATCH /api/users/me */
  updateMe(input: { displayName: string; email: string }) {
    return handle(() => {
      const u = requireUser({ noGuest: true });
      const name = input.displayName.trim();
      if (name.length < 2) throw new ApiError('BAD_REQUEST', 'Tên hiển thị tối thiểu 2 ký tự');
      u.displayName = name;
      u.email = input.email.trim() || u.email;
      return u;
    });
  },

  /** PUT /api/users/me/password */
  changePassword(input: { oldPassword: string; newPassword: string }) {
    return handle(() => {
      const u = requireUser({ noGuest: true });
      if (db.passwords[u.id] !== input.oldPassword) throw new ApiError('BAD_REQUEST', 'Mật khẩu hiện tại không đúng');
      if (input.newPassword.length < 8) throw new ApiError('BAD_REQUEST', 'Mật khẩu mới tối thiểu 8 ký tự');
      db.passwords[u.id] = input.newPassword;
      return true;
    });
  },
};

// ============================================================ Bộ đề
function liveSets() {
  return db.quizSets.filter((s) => !s.deletedAt);
}

function toSummary(s: QuizSet): QuizSetSummary {
  return {
    id: s.id,
    ownerId: s.ownerId,
    ownerName: userName(s.ownerId),
    title: s.title,
    description: s.description,
    visibility: s.visibility,
    copiedFromId: s.copiedFromId,
    questionCount: s.questions.length,
    playCount: db.games.filter((g) => g.quizSetId === s.id).length,
    updatedAt: s.updatedAt,
  };
}

function ownedSet(id: number): QuizSet {
  const u = requireUser({ noGuest: true });
  const s = liveSets().find((x) => x.id === id);
  if (!s) throw new ApiError('NOT_FOUND', 'Không tìm thấy bộ đề');
  if (s.ownerId !== u.id) throw new ApiError('FORBIDDEN', 'Chỉ chủ sở hữu được thao tác bộ đề này (BR08)');
  return s;
}

export interface QuestionInput {
  type: QuestionType;
  content: string;
  imageUrl: string | null;
  timeLimitMs: number | null;
  points: number;
  explanation: string | null;
  choices: { content: string; isCorrect: boolean }[];
}

/** BR09: 2–6 lựa chọn; SINGLE/TRUE_FALSE đúng 1 đáp án; MULTIPLE ít nhất 1. */
export function validateQuestion(q: QuestionInput): string | null {
  if (!q.content.trim()) return 'Nội dung câu hỏi không được trống';
  if (q.choices.length < 2 || q.choices.length > 6) return 'Mỗi câu có 2 đến 6 lựa chọn';
  if (q.choices.some((c) => !c.content.trim())) return 'Lựa chọn không được để trống';
  const correct = q.choices.filter((c) => c.isCorrect).length;
  if (q.type === 'TRUE_FALSE' && q.choices.length !== 2) return 'Câu đúng/sai có đúng 2 lựa chọn';
  if ((q.type === 'SINGLE' || q.type === 'TRUE_FALSE') && correct !== 1) return 'Câu này phải có đúng 1 đáp án đúng';
  if (q.type === 'MULTIPLE' && correct < 1) return 'Câu nhiều đáp án cần ít nhất 1 đáp án đúng';
  if (q.timeLimitMs != null && (q.timeLimitMs < 5000 || q.timeLimitMs > 300000))
    return 'Thời gian mỗi câu từ 5 đến 300 giây';
  if (q.points < 1 || q.points > 1000) return 'Điểm tối đa từ 1 đến 1000';
  return null;
}

function buildChoices(input: QuestionInput['choices']): Choice[] {
  return input.map((c, i) => ({
    id: db.seq.choice++,
    content: c.content.trim(),
    position: i + 1,
    isCorrect: c.isCorrect,
  }));
}

export const quizSetApi = {
  /** GET /api/quiz-sets?scope=mine|public — không có đáp án */
  list(scope: 'mine' | 'public') {
    return handle(() => {
      const u = requireUser();
      const sets = liveSets()
        .filter((s) => (scope === 'mine' ? s.ownerId === u.id : s.visibility === 'PUBLIC'))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return sets.map(toSummary);
    });
  },

  /** Bộ đề mà người dùng được chọn khi cấu hình phòng: của mình + công khai (BR08). */
  selectable() {
    return handle(() => {
      const u = requireUser({ noGuest: true });
      return liveSets()
        .filter((s) => s.ownerId === u.id || s.visibility === 'PUBLIC')
        .filter((s) => s.questions.length > 0)
        .map(toSummary);
    });
  },

  /** GET /api/quiz-sets/{id}/questions — chủ sở hữu, có đáp án */
  get(id: number) {
    return handle(() => ownedSet(id));
  },

  /** POST /api/quiz-sets */
  create(input: { title: string; description: string; visibility: Visibility }) {
    return handle(() => {
      const u = requireUser({ noGuest: true });
      if (!input.title.trim()) throw new ApiError('BAD_REQUEST', 'Tên bộ đề không được trống');
      const s: QuizSet = {
        id: db.seq.quizSet++,
        ownerId: u.id,
        title: input.title.trim(),
        description: input.description.trim(),
        visibility: input.visibility,
        copiedFromId: null,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
        questions: [],
      };
      db.quizSets.push(s);
      return s;
    });
  },

  /** PUT /api/quiz-sets/{id} */
  update(id: number, input: { title: string; description: string; visibility: Visibility }) {
    return handle(() => {
      const s = ownedSet(id);
      if (!input.title.trim()) throw new ApiError('BAD_REQUEST', 'Tên bộ đề không được trống');
      s.title = input.title.trim();
      s.description = input.description.trim();
      s.visibility = input.visibility;
      s.updatedAt = now();
      return s;
    });
  },

  /** DELETE /api/quiz-sets/{id} — xóa mềm */
  remove(id: number) {
    return handle(() => {
      const s = ownedSet(id);
      s.deletedAt = now();
      return true;
    });
  },

  /** POST /api/quiz-sets/{id}/copy */
  copy(id: number) {
    return handle(() => {
      const u = requireUser({ noGuest: true });
      const src = liveSets().find((s) => s.id === id && s.visibility === 'PUBLIC');
      if (!src) throw new ApiError('NOT_FOUND', 'Chỉ sao chép được bộ đề công khai');
      const newId = db.seq.quizSet++;
      const s: QuizSet = {
        ...structuredClone(src),
        id: newId,
        ownerId: u.id,
        title: `${src.title} (bản sao)`,
        visibility: 'PRIVATE',
        copiedFromId: src.id,
        createdAt: now(),
        updatedAt: now(),
      };
      s.questions = s.questions.map((q) => ({
        ...q,
        id: db.seq.question++,
        quizSetId: newId,
        choices: q.choices.map((c) => ({ ...c, id: db.seq.choice++ })),
      }));
      db.quizSets.push(s);
      return toSummary(s);
    });
  },

  /** POST /api/quiz-sets/{id}/questions */
  addQuestion(setId: number, input: QuestionInput) {
    return handle(() => {
      const s = ownedSet(setId);
      const err = validateQuestion(input);
      if (err) throw new ApiError('BAD_REQUEST', err);
      const q: Question = {
        id: db.seq.question++,
        quizSetId: setId,
        type: input.type,
        content: input.content.trim(),
        imageUrl: input.imageUrl,
        timeLimitMs: input.timeLimitMs,
        points: input.points,
        explanation: input.explanation?.trim() || null,
        position: s.questions.length + 1,
        choices: buildChoices(input.choices),
      };
      s.questions.push(q);
      s.updatedAt = now();
      return q;
    });
  },

  /** PUT /api/questions/{id} */
  updateQuestion(setId: number, questionId: number, input: QuestionInput) {
    return handle(() => {
      const s = ownedSet(setId);
      const q = s.questions.find((x) => x.id === questionId);
      if (!q) throw new ApiError('NOT_FOUND', 'Không tìm thấy câu hỏi');
      const err = validateQuestion(input);
      if (err) throw new ApiError('BAD_REQUEST', err);
      Object.assign(q, {
        type: input.type,
        content: input.content.trim(),
        imageUrl: input.imageUrl,
        timeLimitMs: input.timeLimitMs,
        points: input.points,
        explanation: input.explanation?.trim() || null,
        choices: buildChoices(input.choices),
      });
      s.updatedAt = now();
      return q;
    });
  },

  /** DELETE /api/questions/{id} */
  deleteQuestion(setId: number, questionId: number) {
    return handle(() => {
      const s = ownedSet(setId);
      s.questions = s.questions.filter((q) => q.id !== questionId);
      s.questions.forEach((q, i) => (q.position = i + 1));
      s.updatedAt = now();
      return true;
    });
  },

  /** Đổi thứ tự câu (một phần của PUT /api/questions/{id}). */
  moveQuestion(setId: number, questionId: number, dir: -1 | 1) {
    return handle(() => {
      const s = ownedSet(setId);
      const i = s.questions.findIndex((q) => q.id === questionId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.questions.length) return s;
      [s.questions[i], s.questions[j]] = [s.questions[j], s.questions[i]];
      s.questions.forEach((q, k) => (q.position = k + 1));
      return s;
    });
  },

  /**
   * POST /api/quiz-sets/{id}/import — CSV:
   * type,content,choice1,choice2,...,correct(vd "1" hoặc "1|3"),timeSec,points,explanation
   */
  importCsv(setId: number, csv: string) {
    return handle(() => {
      const s = ownedSet(setId);
      const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const errors: string[] = [];
      let added = 0;
      lines.forEach((line, idx) => {
        if (idx === 0 && line.toLowerCase().startsWith('type')) return;
        const cols = line.split(',').map((c) => c.trim());
        const [type, content, ...rest] = cols;
        const correctIdx = rest.findIndex((c) => /^\d+(\|\d+)*$/.test(c));
        if (correctIdx < 0) {
          errors.push(`Dòng ${idx + 1}: thiếu cột đáp án đúng`);
          return;
        }
        const choiceTexts = rest.slice(0, correctIdx);
        const correct = rest[correctIdx].split('|').map(Number);
        const timeSec = Number(rest[correctIdx + 1]) || null;
        const input: QuestionInput = {
          type: (['SINGLE', 'MULTIPLE', 'TRUE_FALSE'].includes(type) ? type : 'SINGLE') as QuestionType,
          content: content ?? '',
          imageUrl: null,
          timeLimitMs: timeSec ? timeSec * 1000 : null,
          points: Number(rest[correctIdx + 2]) || 100,
          explanation: rest[correctIdx + 3] || null,
          choices: choiceTexts.map((c, i) => ({ content: c, isCorrect: correct.includes(i + 1) })),
        };
        const err = validateQuestion(input);
        if (err) {
          errors.push(`Dòng ${idx + 1}: ${err}`);
          return;
        }
        s.questions.push({
          id: db.seq.question++,
          quizSetId: s.id,
          type: input.type,
          content: input.content,
          imageUrl: null,
          timeLimitMs: input.timeLimitMs,
          points: input.points,
          explanation: input.explanation,
          position: s.questions.length + 1,
          choices: buildChoices(input.choices),
        });
        added++;
      });
      s.updatedAt = now();
      return { added, errors };
    });
  },

  /** GET /api/quiz-sets/{id}/stats — chủ sở hữu */
  stats(id: number) {
    return handle(() => {
      const s = ownedSet(id);
      const games = db.games.filter((g) => g.quizSetId === s.id && g.status !== 'CANCELLED');
      const stats: QuestionStat[] = s.questions.map((q) => {
        let attempts = 0;
        let correct = 0;
        let timeouts = 0;
        let totalTime = 0;
        let answered = 0;
        for (const g of games) {
          const gq = g.questions.find((x) => x.sourceQuestionId === q.id);
          if (!gq) continue;
          for (const r of g.rounds.filter((x) => x.gameQuestionId === gq.id && x.status !== 'ACTIVE' && x.status !== 'CANCELLED')) {
            attempts++;
            if (r.status === 'CORRECT') correct++;
            if (r.status === 'TIMEOUT') timeouts++;
            if (r.answeredAt) {
              answered++;
              totalTime += Date.parse(r.answeredAt) - Date.parse(r.startedAt);
            }
          }
        }
        return {
          questionId: q.id,
          position: q.position,
          content: q.content,
          type: q.type,
          attempts,
          correctRate: attempts ? correct / attempts : 0,
          avgTimeMs: answered ? totalTime / answered : 0,
          timeoutCount: timeouts,
        };
      });
      const playerCount = games.reduce((n, g) => n + g.players.length, 0);
      const avgScore = playerCount
        ? games.reduce((n, g) => n + g.players.reduce((m, p) => m + p.totalScore, 0), 0) / playerCount
        : 0;
      return { set: toSummary(s), gameCount: games.length, playerCount, avgScore, questions: stats };
    });
  },
};

// ============================================================ Lịch sử
function toHistoryItem(g: Game, userId: number): GameHistoryItem {
  const me = g.players.find((p) => p.userId === userId);
  return {
    id: g.id,
    roomCode: g.roomCode,
    roomTitle: g.roomTitle,
    quizTitle: g.quizTitleSnapshot,
    mode: g.mode,
    status: g.status,
    startedAt: g.startedAt,
    endedAt: g.endedAt,
    playerCount: g.players.length,
    questionCount: g.questions.length,
    hostName: userName(g.startedBy),
    myRank: me?.finalRank ?? null,
    myScore: me?.totalScore ?? null,
  };
}

export const gameApi = {
  /** GET /api/games?role=player|host */
  list(role: 'player' | 'host') {
    return handle(() => {
      const u = requireUser({ noGuest: true });
      return db.games
        .filter((g) => g.status !== 'RUNNING')
        .filter((g) => (role === 'host' ? g.startedBy === u.id : g.players.some((p) => p.userId === u.id)))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map((g) => toHistoryItem(g, u.id));
    });
  },

  /** GET /api/games/{id} — người đã tham gia (hoặc chủ trận) */
  get(id: string) {
    return handle(() => {
      const u = requireUser();
      const g = db.games.find((x) => x.id === id);
      if (!g) throw new ApiError('NOT_FOUND', 'Không tìm thấy trận');
      if (!g.players.some((p) => p.userId === u.id) && g.startedBy !== u.id && u.role !== 'ADMIN')
        throw new ApiError('FORBIDDEN', 'Bạn không tham gia trận này');
      return g;
    });
  },
};

// ============================================================ Thống kê
export const statsApi = {
  /** GET /api/leaderboard */
  leaderboard() {
    return handle(() => {
      requireUser();
      const map = new Map<number, GlobalLeaderboardEntry & { answered: number; correct: number }>();
      for (const g of db.games.filter((x) => x.status === 'FINISHED')) {
        for (const p of g.players) {
          const u = db.users.find((x) => x.id === p.userId);
          if (!u || u.isGuest) continue;
          const e = map.get(u.id) ?? {
            userId: u.id,
            displayName: u.displayName,
            gamesPlayed: 0,
            wins: 0,
            totalScore: 0,
            correctRate: 0,
            answered: 0,
            correct: 0,
          };
          e.gamesPlayed++;
          if (p.finalRank === 1) e.wins++;
          e.totalScore += p.totalScore;
          e.answered += g.rounds.filter((r) => r.gamePlayerId === p.id).length;
          e.correct += p.correctCount;
          map.set(u.id, e);
        }
      }
      return [...map.values()]
        .map(({ answered, correct, ...e }) => ({ ...e, correctRate: answered ? correct / answered : 0 }))
        .sort((a, b) => b.totalScore - a.totalScore);
    });
  },
};

// ============================================================ Quản trị
export const adminApi = {
  /** GET /api/admin/users */
  users() {
    return handle(() => {
      requireUser({ admin: true });
      return db.users.filter((u) => !u.isGuest);
    });
  },

  /** PATCH /api/admin/users/{id}/status */
  setUserStatus(id: number, status: UserStatus) {
    return handle(() => {
      const me = requireUser({ admin: true });
      if (me.id === id) throw new ApiError('BAD_REQUEST', 'Không thể tự khóa chính mình');
      const u = db.users.find((x) => x.id === id);
      if (!u) throw new ApiError('NOT_FOUND', 'Không tìm thấy tài khoản');
      u.status = status;
      return u;
    });
  },

  /** GET public sets for moderation */
  publicSets() {
    return handle(() => {
      requireUser({ admin: true });
      return liveSets()
        .filter((s) => s.visibility === 'PUBLIC')
        .map(toSummary);
    });
  },

  /** DELETE /api/admin/quiz-sets/{id} */
  removeQuizSet(id: number) {
    return handle(() => {
      requireUser({ admin: true });
      const s = liveSets().find((x) => x.id === id);
      if (!s) throw new ApiError('NOT_FOUND', 'Không tìm thấy bộ đề');
      s.deletedAt = now();
      return true;
    });
  },
};

export const DEMO_ACCOUNTS = [
  { username: 'huy_demo', role: 'USER', note: 'Chủ phòng QUIZ02' },
  { username: 'vi_demo', role: 'USER', note: 'Chủ bộ đề mẫu' },
  { username: 'an_demo', role: 'USER', note: '' },
  { username: 'admin_demo', role: 'ADMIN', note: '' },
].map((a) => ({ ...a, password: DEMO_PASSWORD }));
