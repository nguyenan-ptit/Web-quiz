// Kết nối socket phía client: một kết nối cho mỗi tab, tự kết nối lại (1, 2, 4, 8 giây),
// PING mỗi 10 giây, gắn requestId cho mỗi thông điệp, và đổ thông điệp server vào store.
//
// Khi có backend Spring Boot: đổi `new MockWebSocket(WS_URL)` thành `new WebSocket(WS_URL)`.

import { BackendRoomSocket } from './backend-room-socket';
import { mockEnabled } from './runtime';
import { MockWebSocket } from '../mock/server';
import type { ClientMessage, ServerEnvelope } from '../protocol';
import { initialLive, navigateTo, notify, pushLog, useLive, type GameView } from '../store/live';

const WS_URL = 'ws://localhost:8080/ws';
const PING_MS = 10000;
const BACKOFF = [1000, 2000, 4000, 8000];

class QuizSocket {
  private ws: MockWebSocket | null = null;
  private token: string | null = null;
  private attempt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private manual = false;
  private reqSeq = 0;
  private wantJoinNav = false;

  connect(token: string) {
    if (this.token === token && this.ws && this.ws.readyState !== MockWebSocket.CLOSED) return;
    this.disconnect();
    this.token = token;
    this.manual = false;
    this.attempt = 0;
    this.open();
  }

  disconnect() {
    this.manual = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.token = null;
    useLive.setState({ ...initialLive });
  }

  /** Thử kết nối lại ngay (sau SESSION_REPLACED hoặc khi người dùng bấm). */
  reconnectNow() {
    if (!this.token) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.manual = false;
    this.open();
  }

  private open() {
    useLive.setState({ status: this.attempt > 0 ? 'RECONNECTING' : 'CONNECTING', retryAt: null });
    const ws = new MockWebSocket(WS_URL);
    this.ws = ws;
    ws.onopen = () => {
      useLive.setState({ status: 'AUTHENTICATING', attempt: 0 });
      // AUTH phải là thông điệp đầu tiên
      this.send({ type: 'AUTH', payload: { token: this.token! } }, true);
      this.pingTimer = setInterval(() => this.send({ type: 'PING' }, true), PING_MS);
    };
    ws.onmessage = (ev) => {
      const env = JSON.parse(ev.data) as ServerEnvelope;
      pushLog('in', env.type, env);
      this.handle(env);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.manual) return;
      if (ev.code === 4001) {
        useLive.setState({ status: 'REPLACED' });
        return;
      }
      if (ev.code === 4401) {
        useLive.setState({ status: 'CLOSED' });
        return;
      }
      const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
      this.attempt++;
      useLive.setState({ status: 'RECONNECTING', retryAt: Date.now() + delay, attempt: this.attempt });
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
  }

  send(msg: ClientMessage, silent = false): string | null {
    const ws = this.ws;
    if (!ws || ws.readyState !== MockWebSocket.OPEN) {
      if (!silent) notify('Đang mất kết nối tới server, thử lại sau giây lát', 'warn');
      return null;
    }
    const requestId = `c-${String(++this.reqSeq).padStart(4, '0')}`;
    const env = { ...msg, requestId };
    pushLog('out', msg.type, env);
    ws.send(JSON.stringify(env));
    return requestId;
  }

  // ------------------------------------------------------------------ thao tác
  subscribeLobby() {
    useLive.setState({ lobbyWanted: true });
    this.send({ type: 'LOBBY_SUBSCRIBE' }, true);
  }
  unsubscribeLobby() {
    useLive.setState({ lobbyWanted: false });
    this.send({ type: 'LOBBY_UNSUBSCRIBE' }, true);
  }
  createRoom(title: string, visibility: 'PUBLIC' | 'PRIVATE', password: string | null, _displayName?: string, _maxPlayers = 20) {
    this.wantJoinNav = true;
    this.send({ type: 'CREATE_ROOM', payload: { title, visibility, password } });
  }
  joinRoom(roomCode: string, password?: string, _displayName?: string) {
    this.wantJoinNav = true;
    this.send({ type: 'JOIN_ROOM', payload: { roomCode, password } });
  }
  leaveRoom() {
    this.send({ type: 'LEAVE_ROOM' }, true);
    useLive.setState({ room: null, messages: [], game: null });
  }

  // ------------------------------------------------------------------ xử lý thông điệp server
  private handle(env: ServerEnvelope) {
    const set = useLive.setState;
    const patchGame = (fn: (g: GameView) => Partial<GameView>) =>
      set((s) => (s.game ? { game: { ...s.game, ...fn(s.game) } } : {}));

    switch (env.type) {
      case 'AUTH_OK': {
        set({ status: 'OPEN', me: env.payload.user, serverOffset: env.serverTime - Date.now() });
        const { gameId, roomCode } = env.payload;
        if (gameId) this.send({ type: 'RESUME' }, true);
        else if (roomCode) this.send({ type: 'JOIN_ROOM', payload: { roomCode } }, true);
        if (useLive.getState().lobbyWanted) this.send({ type: 'LOBBY_SUBSCRIBE' }, true);
        if (!gameId && useLive.getState().game && !useLive.getState().game?.standings) {
          // từng ở trong trận nhưng server không còn giữ chỗ (quá 30 giây)
          set({ game: null });
          notify('Bạn đã bị đánh dấu rời trận do mất kết nối quá 30 giây', 'error');
        }
        return;
      }
      case 'PONG':
        set({ serverOffset: env.payload.serverTime - Date.now() });
        return;
      case 'LOBBY_ROOMS':
        set({ lobby: env.payload.rooms });
        return;
      case 'ROOM_STATE': {
        const { room, quizTitle, quizQuestionCount, messages } = env.payload;
        set({ room, roomQuizTitle: quizTitle, roomQuizCount: quizQuestionCount, messages });
        if (this.wantJoinNav) {
          this.wantJoinNav = false;
          navigateTo(`/rooms/${room.roomCode}`);
        }
        return;
      }
      case 'ROOM_UPDATED': {
        const { room, quizTitle, quizQuestionCount } = env.payload;
        set((s) => (s.room?.id === room.id ? { room, roomQuizTitle: quizTitle, roomQuizCount: quizQuestionCount } : {}));
        return;
      }
      case 'MEMBER_KICKED':
        set({ room: null, messages: [] });
        notify(`Bạn đã bị mời ra khỏi phòng ${env.payload.roomCode}`, 'error');
        navigateTo('/lobby');
        return;
      case 'CHAT_MESSAGE':
        set((s) => ({ messages: [...s.messages.slice(-99), env.payload.message] }));
        return;
      case 'GAME_STARTED': {
        const p = env.payload;
        set({
          game: {
            gameId: p.gameId,
            mode: p.mode,
            quizTitle: p.quizTitle,
            questionCount: p.questionCount,
            startsAt: p.startsAt,
            question: null,
            answer: null,
            liveResult: null,
            totalScore: 0,
            leaderboard: [],
            finishedSelf: false,
            standings: null,
            history: [],
          },
        });
        navigateTo('/play');
        return;
      }
      case 'QUESTION_STARTED':
        patchGame(() => ({ question: env.payload.question, answer: null, liveResult: null, startsAt: null }));
        return;
      case 'ANSWER_RECORDED': {
        const p = env.payload;
        patchGame((g) => ({
          totalScore: p.totalScore,
          answer: g.answer && g.answer.roundId === p.roundId
            ? { ...g.answer, pending: false, result: p.result, score: p.score, bonus: p.bonus, streak: p.streak }
            : { roundId: p.roundId, choiceIds: [], pending: false, result: p.result, score: p.score, bonus: p.bonus, streak: p.streak },
          history: [...g.history, { index: g.question?.index ?? g.history.length, result: p.result, score: p.score + p.bonus }],
        }));
        return;
      }
      case 'QUESTION_TIMED_OUT':
        patchGame((g) => ({
          totalScore: env.payload.totalScore,
          answer: { roundId: env.payload.roundId, choiceIds: g.answer?.choiceIds ?? [], pending: false, result: 'TIMEOUT', score: 0, bonus: 0, streak: 0 },
          history: [...g.history, { index: g.question?.index ?? g.history.length, result: 'TIMEOUT', score: 0 }],
        }));
        return;
      case 'QUESTION_RESULT':
        patchGame(() => ({ liveResult: env.payload }));
        return;
      case 'LEADERBOARD_UPDATED':
        patchGame(() => ({ leaderboard: env.payload.entries }));
        return;
      case 'PLAYER_CONNECTION_CHANGED': {
        const { displayName, status, userId } = env.payload;
        if (userId === useLive.getState().me?.id) return;
        const text =
          status === 'DISCONNECTED'
            ? `${displayName} mất kết nối, chờ quay lại trong 30 giây`
            : status === 'RECONNECTED'
              ? `${displayName} đã kết nối lại`
              : `${displayName} đã rời trận`;
        notify(text, status === 'RECONNECTED' ? 'success' : 'warn');
        return;
      }
      case 'PLAYER_FINISHED':
        patchGame(() => ({ finishedSelf: true, question: null, totalScore: env.payload.totalScore }));
        return;
      case 'GAME_STATE': {
        const p = env.payload;
        set((s) => ({
          game: {
            gameId: p.gameId,
            mode: p.mode,
            quizTitle: p.quizTitle,
            questionCount: p.questionCount,
            startsAt: null,
            question: p.question,
            answer: s.game?.answer && p.question && s.game.answer.roundId === p.question.roundId ? s.game.answer : null,
            liveResult: null,
            totalScore: p.totalScore,
            leaderboard: p.leaderboard,
            finishedSelf: p.finished,
            standings: null,
            history: s.game?.gameId === p.gameId ? s.game.history : [],
          },
        }));
        notify('Đã kết nối lại, tiếp tục trận với thời hạn cũ', 'success');
        if (!location.pathname.startsWith('/play')) navigateTo('/play');
        return;
      }
      case 'GAME_FINISHED':
        patchGame(() => ({ standings: env.payload.standings, question: null }));
        navigateTo(`/games/${env.payload.gameId}/result`);
        return;
      case 'SESSION_REPLACED':
        useLive.setState({ status: 'REPLACED' });
        return;
      case 'ERROR':
        this.wantJoinNav = false;
        notify(`${env.payload.message} (${env.payload.code})`, 'error');
        return;
    }
  }
}

export const quizSocket = mockEnabled ? new QuizSocket() : new BackendRoomSocket();

/** Hook dùng trong component: trạng thái kết nối + hàm gửi. */
export function useQuizSocket() {
  const status = useLive((s) => s.status);
  return { status, socket: quizSocket };
}
