// "Mock server": giả lập cổng WebSocket + dịch vụ phòng và trận của Spring Boot ngay trong trình duyệt.
// Mục đích: dựng giao diện trước khi có backend. Lớp MockWebSocket có cùng API với WebSocket thật
// (onopen / onmessage / onclose / send / close, dữ liệu là chuỗi JSON), nên khi có server thật
// chỉ cần đổi `new MockWebSocket(url)` thành `new WebSocket(url)` trong lib/socket.ts.
//
// Những người chơi khác (Vĩ, An, Lan, Minh…) do mock server tự điều khiển: vào phòng, chat, trả lời.
// JavaScript chạy đơn luồng nên mỗi thông điệp / sự kiện hết giờ được xử lý tuần tự,
// tương đương "một hàng đợi tuần tự cho mỗi phòng" ở server thật.

import type { ClientEnvelope, ErrorCode, ServerEnvelope, ServerMessage } from '../protocol';
import type {
  ChatMessage,
  Game,
  GamePlayer,
  GameQuestion,
  LeaderboardEntry,
  LobbyRoom,
  PlayerRound,
  QuestionView,
  Room,
  RoomConfig,
  User,
} from '../types';
import { calcScore, normalizeName, randomRoomCode, sameSet, seededShuffle, streakBonus, uuid } from '../lib/game';
import { assignRanks, db, snapshotQuestions } from './data';
import { resolveToken } from './api';

type Timer = ReturnType<typeof setTimeout>;

const LATENCY_MS = 60; // độ trễ mạng giả lập mỗi chiều
const AUTH_TIMEOUT_MS = 5000; // AUTH phải đến trong 5 giây
const IDLE_TIMEOUT_MS = 30000; // BR20: im lặng quá 30 giây thì đóng
const RECONNECT_GRACE_MS = 30000; // BR18: chờ kết nối lại 30 giây
const LIVE_RESULT_MS = 5000; // BR15: 5 giây giữa hai câu ở chế độ đồng bộ
const START_COUNTDOWN_MS = 3000;
const FEEDBACK_GAP_MS = 1500; // mock: dừng ngắn để người chơi thấy kết quả câu trước
const CHAT_LIMIT = 5; // BR19: tối đa 5 tin / 10 giây
const CHAT_WINDOW_MS = 10000;
const BOT_IDS = [2, 3, 4, 6, 7, 8, 9];

const GREETINGS = ['Chào mọi người 👋', 'Hello!', 'Có ai ôn bài này chưa?', 'Hôm nay chơi mấy câu vậy?', 'Sẵn sàng rồi!'];
const REPLIES = ['👍', 'Ok luôn', 'Chuẩn', 'Haha', 'Đồng ý', 'Mình cũng nghĩ vậy'];

interface Conn {
  id: number;
  socket: MockWebSocket;
  userId: number | null;
  lobby: boolean;
  open: boolean;
  lastSeen: number;
  recent: Map<string, ServerEnvelope[]>; // 100 requestId gần nhất → phản hồi đã gửi
  chatTimes: number[];
  authTimer: Timer | null;
}

interface PlayerRt {
  isBot: boolean;
  accuracy: number;
  order: number[]; // thứ tự câu (index trong game.questions)
  pos: number;
  timers: Timer[];
  waitingResume: boolean;
}

interface Runner {
  game: Game;
  room: Room;
  rt: Map<number, PlayerRt>; // game_player_id → trạng thái RAM
  liveIndex: number;
  liveClosed: boolean;
  liveTimer: Timer | null; // hết giờ của câu đồng bộ đang mở
  timers: Timer[];
}

const nowIso = () => new Date().toISOString();
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const userById = (id: number): User | undefined => db.users.find((u) => u.id === id);

class MockServer {
  private conn: Conn | null = null;
  private connSeq = 0;
  private networkDown = false;
  private roomTimers = new Map<string, Timer[]>();
  private runners = new Map<string, Runner>();
  private graceTimers = new Map<number, Timer>();
  private lobbyTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private autoStarted = new Set<string>();

  // ============================================================ kết nối
  accept(socket: MockWebSocket): Conn | null {
    if (this.networkDown) return null;
    // BR21: một kết nối điều khiển — kết nối mới thay kết nối cũ
    if (this.conn?.open) {
      this.emit(this.conn, { type: 'SESSION_REPLACED', payload: {} });
      this.dropConn(this.conn, 4001, 'SESSION_REPLACED');
    }
    const conn: Conn = {
      id: ++this.connSeq,
      socket,
      userId: null,
      lobby: false,
      open: true,
      lastSeen: Date.now(),
      recent: new Map(),
      chatTimes: [],
      authTimer: null,
    };
    conn.authTimer = setTimeout(() => {
      if (conn.open && conn.userId == null) {
        this.emit(conn, { type: 'ERROR', payload: { code: 'UNAUTHENTICATED', message: 'Không nhận được AUTH trong 5 giây' } });
        this.dropConn(conn, 4401, 'AUTH_TIMEOUT');
      }
    }, AUTH_TIMEOUT_MS);
    this.conn = conn;
    if (!this.idleTimer) {
      this.idleTimer = setInterval(() => {
        const c = this.conn;
        if (c?.open && Date.now() - c.lastSeen > IDLE_TIMEOUT_MS) this.dropConn(c, 4408, 'HEARTBEAT_TIMEOUT');
      }, 5000);
    }
    return conn;
  }

  /** Client đóng socket (đăng xuất, đóng tab…). */
  clientClosed(conn: Conn) {
    if (!conn.open) return;
    conn.open = false;
    this.onConnLost(conn);
  }

  private dropConn(conn: Conn, code: number, reason: string) {
    if (!conn.open) return;
    conn.open = false;
    conn.socket._serverClose(code, reason);
    this.onConnLost(conn);
  }

  private onConnLost(conn: Conn) {
    if (conn.authTimer) clearTimeout(conn.authTimer);
    if (this.conn === conn) this.conn = null;
    this.stopLobbySim();
    if (conn.userId == null) return;
    // Mất kết nối giữa trận → chờ kết nối lại 30 giây (BR18)
    for (const r of this.runners.values()) {
      const p = r.game.players.find((x) => x.userId === conn.userId);
      if (p && p.status === 'PLAYING') {
        p.status = 'DISCONNECTED';
        this.toGame(r, {
          type: 'PLAYER_CONNECTION_CHANGED',
          payload: { userId: p.userId, displayName: p.displayName, status: 'DISCONNECTED' },
        });
        this.broadcastLeaderboard(r);
        const uid = p.userId;
        this.graceTimers.set(
          uid,
          setTimeout(() => {
            this.graceTimers.delete(uid);
            if (p.status === 'DISCONNECTED') this.leaveGame(r, p);
          }, RECONNECT_GRACE_MS),
        );
      }
    }
  }

  receive(conn: Conn, raw: string) {
    if (!conn.open || this.conn !== conn) return;
    let msg: ClientEnvelope;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.emit(conn, { type: 'ERROR', payload: { code: 'BAD_REQUEST', message: 'JSON không hợp lệ' } });
      return;
    }
    conn.lastSeen = Date.now();
    // Gửi trùng: trả lại phản hồi cũ
    const cached = msg.requestId ? conn.recent.get(msg.requestId) : undefined;
    if (cached) {
      cached.forEach((env) => conn.socket._deliver(JSON.stringify(env)));
      return;
    }
    if (msg.requestId) {
      conn.recent.set(msg.requestId, []);
      if (conn.recent.size > 100) conn.recent.delete(conn.recent.keys().next().value!);
    }
    if (conn.userId == null && msg.type !== 'AUTH') {
      this.reply(conn, msg.requestId, { type: 'ERROR', payload: { code: 'UNAUTHENTICATED', message: 'Cần gửi AUTH trước' } });
      return;
    }
    try {
      this.route(conn, msg);
    } catch (e) {
      if (e instanceof WsError) this.reply(conn, msg.requestId, { type: 'ERROR', payload: { code: e.code, message: e.message } });
      else throw e;
    }
  }

  private emit(conn: Conn, msg: ServerMessage, requestId?: string) {
    if (!conn.open) return;
    const env = { ...msg, requestId, serverTime: Date.now() } as ServerEnvelope;
    if (requestId) conn.recent.get(requestId)?.push(env);
    conn.socket._deliver(JSON.stringify(env));
  }

  private reply(conn: Conn, requestId: string | undefined, msg: ServerMessage) {
    this.emit(conn, msg, requestId);
  }

  private toUser(userId: number, msg: ServerMessage, requestId?: string) {
    const c = this.conn;
    if (c?.open && c.userId === userId) this.emit(c, msg, requestId);
  }

  private toRoom(room: Room, msg: ServerMessage) {
    room.members.filter((m) => m.status === 'JOINED').forEach((m) => this.toUser(m.userId, msg));
  }

  private toGame(r: Runner, msg: ServerMessage) {
    r.game.players.filter((p) => p.status !== 'LEFT').forEach((p) => this.toUser(p.userId, msg));
  }

  // ============================================================ định tuyến theo type
  private route(conn: Conn, msg: ClientEnvelope) {
    const rid = msg.requestId;
    switch (msg.type) {
      case 'AUTH': {
        const user = resolveToken(msg.payload.token);
        if (!user) {
          this.reply(conn, rid, { type: 'ERROR', payload: { code: 'UNAUTHENTICATED', message: 'Token không hợp lệ' } });
          this.dropConn(conn, 4401, 'UNAUTHENTICATED');
          return;
        }
        if (conn.authTimer) clearTimeout(conn.authTimer);
        conn.userId = user.id;
        const room = this.roomOf(user.id);
        const runner = this.runnerOf(user.id);
        this.reply(conn, rid, {
          type: 'AUTH_OK',
          payload: { user, roomCode: room?.roomCode ?? null, gameId: runner?.game.id ?? null },
        });
        return;
      }
      case 'PING':
        this.reply(conn, rid, { type: 'PONG', payload: { serverTime: Date.now() } });
        return;
      case 'LOBBY_SUBSCRIBE':
        conn.lobby = true;
        this.reply(conn, rid, { type: 'LOBBY_ROOMS', payload: { rooms: this.lobbyRooms() } });
        this.startLobbySim();
        return;
      case 'LOBBY_UNSUBSCRIBE':
        conn.lobby = false;
        this.stopLobbySim();
        return;
      case 'CREATE_ROOM':
        return this.createRoom(conn, rid, msg.payload);
      case 'JOIN_ROOM':
        return this.joinRoom(conn, rid, msg.payload.roomCode, msg.payload.password);
      case 'LEAVE_ROOM':
        return this.leaveRoom(conn.userId!);
      case 'UPDATE_ROOM_CONFIG':
        return this.updateConfig(conn, msg.payload);
      case 'KICK_MEMBER':
        return this.kick(conn, msg.payload.userId);
      case 'TRANSFER_HOST':
        return this.transferHost(conn.userId!, msg.payload.userId);
      case 'SEND_CHAT':
        return this.chat(conn, msg.payload.content);
      case 'START_GAME': {
        const room = this.roomOf(conn.userId!);
        if (!room) throw new WsError('ROOM_NOT_FOUND', 'Bạn không ở trong phòng nào');
        return this.startGame(room, conn.userId!);
      }
      case 'SUBMIT_ANSWER': {
        const r = this.runnerOf(conn.userId!);
        const p = r?.game.players.find((x) => x.userId === conn.userId);
        if (!r || !p || p.status !== 'PLAYING') throw new WsError('ROUND_NOT_ACTIVE', 'Bạn không ở trong trận đang chạy');
        this.submit(r, p, msg.payload.roundId, msg.payload.choiceIds, rid);
        return;
      }
      case 'RESUME':
        return this.resume(conn, rid);
    }
  }

  // ============================================================ phòng
  private roomOf(userId: number): Room | undefined {
    return db.rooms.find((r) => r.status !== 'CLOSED' && r.members.some((m) => m.userId === userId && m.status === 'JOINED'));
  }

  private runnerOf(userId: number): Runner | undefined {
    for (const r of this.runners.values()) {
      const p = r.game.players.find((x) => x.userId === userId);
      if (p && (p.status === 'PLAYING' || p.status === 'DISCONNECTED' || p.status === 'COMPLETED')) return r;
    }
    return undefined;
  }

  private quizInfo(room: Room) {
    const set = db.quizSets.find((s) => s.id === room.quizSetId && !s.deletedAt);
    return { quizTitle: set?.title ?? null, quizQuestionCount: set?.questions.length ?? 0 };
  }

  private roomState(room: Room) {
    return {
      room: structuredClone(room),
      ...this.quizInfo(room),
      messages: db.roomMessages.filter((m) => m.roomId === room.id).slice(-50),
    };
  }

  private roomUpdated(room: Room) {
    this.toRoom(room, { type: 'ROOM_UPDATED', payload: { room: structuredClone(room), ...this.quizInfo(room) } });
    this.notifyLobby();
  }

  private joinedCount(room: Room) {
    return room.members.filter((m) => m.status === 'JOINED').length;
  }

  private createRoom(conn: Conn, rid: string | undefined, p: { title: string; visibility: Room['visibility']; password: string | null }) {
    const user = userById(conn.userId!)!;
    if (user.isGuest) throw new WsError('FORBIDDEN', 'Khách không được tạo phòng');
    const title = p.title.trim();
    if (!title || title.length > 60) throw new WsError('BAD_REQUEST', 'Tên phòng 1–60 ký tự');
    this.leaveRoom(user.id);
    let code = randomRoomCode();
    while (db.rooms.some((r) => r.roomCode === code)) code = randomRoomCode();
    const room: Room = {
      id: uuid(),
      roomCode: code,
      title,
      hostUserId: user.id,
      visibility: p.visibility,
      hasPassword: !!p.password,
      quizSetId: null,
      mode: 'SELF_PACED',
      questionTimeMs: 20000,
      maxPlayers: 10,
      shuffleQuestions: false,
      shuffleChoices: false,
      streakBonus: false,
      status: 'WAITING',
      createdAt: nowIso(),
      members: [{ userId: user.id, displayName: user.displayName, isGuest: false, status: 'JOINED', joinedAt: nowIso() }],
    };
    if (p.password) db.roomPasswords[code] = p.password;
    db.rooms.push(room);
    this.reply(conn, rid, { type: 'ROOM_STATE', payload: this.roomState(room) });
    this.notifyLobby();
    this.startRoomSim(room, user.id);
  }

  private joinRoom(conn: Conn, rid: string | undefined, rawCode: string, password?: string) {
    const user = userById(conn.userId!)!;
    const code = rawCode.trim().toUpperCase();
    const room = db.rooms.find((r) => r.roomCode === code && r.status !== 'CLOSED');
    if (!room) throw new WsError('ROOM_NOT_FOUND', `Không tìm thấy phòng ${code}`);
    const existing = room.members.find((m) => m.userId === user.id);
    if (existing?.status === 'KICKED') throw new WsError('KICKED', 'Bạn đã bị mời ra khỏi phòng này (BR12)');
    if (existing?.status === 'JOINED') {
      // vào lại phòng đang ở (sau khi tải lại trang / kết nối lại)
      this.reply(conn, rid, { type: 'ROOM_STATE', payload: this.roomState(room) });
      if (room.status === 'WAITING') this.startRoomSim(room, user.id);
      return;
    }
    if (room.status !== 'WAITING') throw new WsError('ROOM_NOT_WAITING', 'Phòng đang trong trận, hãy chờ trận kết thúc');
    if (this.joinedCount(room) >= room.maxPlayers) throw new WsError('ROOM_FULL', 'Phòng đã đủ người');
    if (room.hasPassword && db.roomPasswords[room.roomCode] !== (password ?? ''))
      throw new WsError('WRONG_PASSWORD', password ? 'Sai mật khẩu phòng' : 'Phòng này cần mật khẩu');
    const norm = normalizeName(user.displayName);
    if (room.members.some((m) => m.status === 'JOINED' && normalizeName(m.displayName) === norm))
      throw new WsError('NAME_TAKEN', `Tên “${user.displayName}” đã có người dùng trong phòng`);

    this.leaveRoom(user.id); // mỗi người ở tối đa một phòng
    if (existing) {
      existing.status = 'JOINED';
      existing.joinedAt = nowIso();
      existing.displayName = user.displayName;
    } else {
      room.members.push({ userId: user.id, displayName: user.displayName, isGuest: user.isGuest, status: 'JOINED', joinedAt: nowIso() });
    }
    this.reply(conn, rid, { type: 'ROOM_STATE', payload: this.roomState(room) });
    this.roomUpdated(room);
    this.startRoomSim(room, user.id);
  }

  /** Rời phòng (và rời trận nếu đang chơi). */
  private leaveRoom(userId: number) {
    const room = this.roomOf(userId);
    if (!room) return;
    const r = [...this.runners.values()].find((x) => x.room.id === room.id);
    const p = r?.game.players.find((x) => x.userId === userId);
    if (r && p && (p.status === 'PLAYING' || p.status === 'DISCONNECTED')) this.leaveGame(r, p);
    this.memberLeaves(room, userId);
    this.stopRoomSim(room);
  }

  private memberLeaves(room: Room, userId: number) {
    const m = room.members.find((x) => x.userId === userId && x.status === 'JOINED');
    if (!m) return;
    m.status = 'LEFT';
    const remaining = room.members.filter((x) => x.status === 'JOINED').sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
    if (remaining.length === 0) {
      room.status = 'CLOSED';
    } else if (room.hostUserId === userId) {
      room.hostUserId = remaining[0].userId; // chuyển quyền cho người vào sớm nhất
    }
    this.roomUpdated(room);
  }

  private requireHost(conn: Conn): Room {
    const room = this.roomOf(conn.userId!);
    if (!room) throw new WsError('ROOM_NOT_FOUND', 'Bạn không ở trong phòng nào');
    if (room.hostUserId !== conn.userId) throw new WsError('FORBIDDEN', 'Chỉ chủ phòng được làm thao tác này');
    if (room.status !== 'WAITING') throw new WsError('ROOM_NOT_WAITING', 'Chỉ thao tác được khi phòng đang chờ');
    return room;
  }

  private updateConfig(conn: Conn, cfg: Partial<RoomConfig>) {
    const room = this.requireHost(conn);
    if (cfg.quizSetId !== undefined && cfg.quizSetId !== null) {
      const set = db.quizSets.find((s) => s.id === cfg.quizSetId && !s.deletedAt);
      if (!set || (set.visibility === 'PRIVATE' && set.ownerId !== conn.userId))
        throw new WsError('INVALID_QUIZ_SET', 'Bộ đề không tồn tại hoặc là bộ đề riêng tư của người khác');
      if (set.questions.length === 0) throw new WsError('INVALID_QUIZ_SET', 'Bộ đề chưa có câu hỏi nào');
    }
    if (cfg.maxPlayers !== undefined && (cfg.maxPlayers < 2 || cfg.maxPlayers > 100 || cfg.maxPlayers < this.joinedCount(room)))
      throw new WsError('BAD_REQUEST', 'Số người tối đa từ 2 đến 100 và không nhỏ hơn số người đang trong phòng');
    if (cfg.questionTimeMs !== undefined && (cfg.questionTimeMs < 5000 || cfg.questionTimeMs > 300000))
      throw new WsError('BAD_REQUEST', 'Thời gian mỗi câu từ 5 đến 300 giây');
    Object.assign(room, cfg);
    this.roomUpdated(room);
  }

  private kick(conn: Conn, targetId: number) {
    const room = this.requireHost(conn);
    if (targetId === conn.userId) throw new WsError('BAD_REQUEST', 'Không thể tự mời mình ra');
    const m = room.members.find((x) => x.userId === targetId && x.status === 'JOINED');
    if (!m) throw new WsError('BAD_REQUEST', 'Người này không ở trong phòng');
    m.status = 'KICKED';
    this.toUser(targetId, { type: 'MEMBER_KICKED', payload: { roomCode: room.roomCode, reason: 'Chủ phòng đã mời bạn ra' } });
    this.systemChat(room, `${m.displayName} đã bị mời ra khỏi phòng`);
    this.roomUpdated(room);
  }

  private transferHost(fromId: number, toId: number) {
    const room = this.roomOf(fromId);
    if (!room) throw new WsError('ROOM_NOT_FOUND', 'Bạn không ở trong phòng nào');
    if (room.hostUserId !== fromId) throw new WsError('FORBIDDEN', 'Chỉ chủ phòng được chuyển quyền');
    if (room.status !== 'WAITING') throw new WsError('ROOM_NOT_WAITING', 'Chỉ chuyển quyền khi phòng đang chờ');
    const target = room.members.find((x) => x.userId === toId && x.status === 'JOINED');
    if (!target) throw new WsError('BAD_REQUEST', 'Người nhận không ở trong phòng');
    room.hostUserId = toId;
    this.systemChat(room, `${target.displayName} trở thành chủ phòng`);
    this.roomUpdated(room);
    if (BOT_IDS.includes(toId) && toId !== this.conn?.userId) this.scheduleBotHostStart(room, 20000);
  }

  private chat(conn: Conn, raw: string) {
    const room = this.roomOf(conn.userId!);
    if (!room) throw new WsError('ROOM_NOT_FOUND', 'Bạn không ở trong phòng nào');
    if (room.status !== 'WAITING') throw new WsError('ROOM_NOT_WAITING', 'Chỉ chat được khi phòng đang chờ');
    const content = raw.trim();
    if (!content) return;
    if (content.length > 300) throw new WsError('BAD_REQUEST', 'Tin nhắn tối đa 300 ký tự');
    const t = Date.now();
    conn.chatTimes = conn.chatTimes.filter((x) => t - x < CHAT_WINDOW_MS);
    if (conn.chatTimes.length >= CHAT_LIMIT) throw new WsError('RATE_LIMITED', 'Bạn gửi quá nhanh (tối đa 5 tin / 10 giây)');
    conn.chatTimes.push(t);
    this.postChat(room, conn.userId!, content);
    // người chơi ảo thỉnh thoảng đáp lời
    if (Math.random() < 0.45) {
      const bots = room.members.filter((m) => m.status === 'JOINED' && m.userId !== conn.userId);
      if (bots.length) this.roomTimeout(room, () => this.postChat(room, pick(bots).userId, pick(REPLIES)), 1200 + Math.random() * 1500);
    }
  }

  private postChat(room: Room, userId: number, content: string) {
    if (room.status !== 'WAITING') return;
    const m = room.members.find((x) => x.userId === userId);
    const msg: ChatMessage = {
      id: db.seq.message++,
      roomId: room.id,
      userId,
      displayName: m?.displayName ?? userById(userId)?.displayName ?? '?',
      content,
      sentAt: nowIso(),
    };
    db.roomMessages.push(msg);
    this.toRoom(room, { type: 'CHAT_MESSAGE', payload: { message: msg } });
  }

  /** Thông báo hệ thống trong khung chat (userId = 0). */
  private systemChat(room: Room, content: string) {
    const msg: ChatMessage = { id: db.seq.message++, roomId: room.id, userId: 0, displayName: 'Hệ thống', content, sentAt: nowIso() };
    db.roomMessages.push(msg);
    this.toRoom(room, { type: 'CHAT_MESSAGE', payload: { message: msg } });
  }

  // ============================================================ sảnh
  private lobbyRooms(): LobbyRoom[] {
    return db.rooms
      .filter((r) => r.visibility === 'PUBLIC' && r.status === 'WAITING')
      .map((r) => ({
        id: r.id,
        roomCode: r.roomCode,
        title: r.title,
        hostName: r.members.find((m) => m.userId === r.hostUserId)?.displayName ?? '?',
        quizTitle: this.quizInfo(r).quizTitle,
        mode: r.mode,
        memberCount: this.joinedCount(r),
        maxPlayers: r.maxPlayers,
        hasPassword: r.hasPassword,
        status: r.status,
      }))
      .sort((a, b) => b.memberCount - a.memberCount);
  }

  private notifyLobby() {
    const c = this.conn;
    if (c?.open && c.lobby) this.emit(c, { type: 'LOBBY_ROOMS', payload: { rooms: this.lobbyRooms() } });
  }

  private freeBots(): number[] {
    const me = this.conn?.userId;
    return BOT_IDS.filter((id) => id !== me && !this.roomOf(id));
  }

  /** Sảnh "sống": người chơi ảo vào/ra phòng, mở phòng mới. */
  private startLobbySim() {
    if (this.lobbyTimer) return;
    this.lobbyTimer = setInterval(() => {
      const me = this.conn?.userId;
      const rooms = db.rooms.filter((r) => r.visibility === 'PUBLIC' && r.status === 'WAITING' && !r.members.some((m) => m.userId === me && m.status === 'JOINED'));
      const roll = Math.random();
      const free = this.freeBots();
      if (roll < 0.45 && rooms.length && free.length) {
        const room = pick(rooms);
        if (this.joinedCount(room) < room.maxPlayers) this.botJoin(room, pick(free));
      } else if (roll < 0.75 && rooms.length) {
        const room = pick(rooms);
        const leavers = room.members.filter((m) => m.status === 'JOINED' && m.userId !== room.hostUserId);
        if (leavers.length) this.memberLeaves(room, pick(leavers).userId);
      } else if (free.length && db.rooms.filter((r) => r.status === 'WAITING').length < 8) {
        const host = userById(pick(free))!;
        const sets = db.quizSets.filter((s) => s.visibility === 'PUBLIC' && !s.deletedAt && s.questions.length);
        if (!sets.length) return;
        const set = pick(sets);
        let code = randomRoomCode();
        while (db.rooms.some((r) => r.roomCode === code)) code = randomRoomCode();
        db.rooms.push({
          id: uuid(),
          roomCode: code,
          title: `Phòng của ${host.displayName}`,
          hostUserId: host.id,
          visibility: 'PUBLIC',
          hasPassword: false,
          quizSetId: set.id,
          mode: Math.random() < 0.5 ? 'LIVE' : 'SELF_PACED',
          questionTimeMs: 20000,
          maxPlayers: 8,
          shuffleQuestions: false,
          shuffleChoices: true,
          streakBonus: Math.random() < 0.5,
          status: 'WAITING',
          createdAt: nowIso(),
          members: [{ userId: host.id, displayName: host.displayName, isGuest: false, status: 'JOINED', joinedAt: nowIso() }],
        });
        this.notifyLobby();
      }
    }, 7000);
  }

  private stopLobbySim() {
    if (this.lobbyTimer) clearInterval(this.lobbyTimer);
    this.lobbyTimer = null;
  }

  private botJoin(room: Room, botId: number) {
    const u = userById(botId)!;
    const existing = room.members.find((m) => m.userId === botId);
    if (existing?.status === 'KICKED') return;
    if (room.members.some((m) => m.status === 'JOINED' && normalizeName(m.displayName) === normalizeName(u.displayName))) return;
    if (existing) {
      existing.status = 'JOINED';
      existing.joinedAt = nowIso();
    } else {
      room.members.push({ userId: botId, displayName: u.displayName, isGuest: false, status: 'JOINED', joinedAt: nowIso() });
    }
    this.roomUpdated(room);
  }

  // ============================================================ mô phỏng trong phòng chờ
  private roomTimeout(room: Room, fn: () => void, ms: number) {
    const list = this.roomTimers.get(room.id) ?? [];
    list.push(setTimeout(fn, ms));
    this.roomTimers.set(room.id, list);
  }

  private stopRoomSim(room: Room) {
    (this.roomTimers.get(room.id) ?? []).forEach(clearTimeout);
    this.roomTimers.delete(room.id);
  }

  private startRoomSim(room: Room, meId: number) {
    this.stopRoomSim(room);
    const others = () => room.members.filter((m) => m.status === 'JOINED' && m.userId !== meId);
    this.roomTimeout(room, () => {
      const o = others();
      if (o.length) this.postChat(room, pick(o).userId, pick(GREETINGS));
    }, 2500);
    // vài người chơi ảo vào phòng
    [5000, 11000].forEach((ms) =>
      this.roomTimeout(room, () => {
        if (room.status !== 'WAITING' || this.joinedCount(room) >= room.maxPlayers) return;
        const free = this.freeBots();
        if (!free.length) return;
        const id = pick(free);
        this.botJoin(room, id);
        this.roomTimeout(room, () => this.postChat(room, id, pick(GREETINGS)), 1500);
      }, ms),
    );
    if (room.hostUserId !== meId && !this.autoStarted.has(room.id)) this.scheduleBotHostStart(room, 25000);
  }

  /** Chủ phòng là người chơi ảo: tự bắt đầu trận sau một lúc. */
  private scheduleBotHostStart(room: Room, afterMs: number) {
    this.autoStarted.add(room.id);
    const hostAtSchedule = room.hostUserId;
    this.roomTimeout(room, () => {
      if (room.status !== 'WAITING' || room.hostUserId !== hostAtSchedule) return;
      this.postChat(room, room.hostUserId, 'Mọi người sẵn sàng chưa? 5 giây nữa mình bắt đầu nhé!');
    }, afterMs - 5000);
    this.roomTimeout(room, () => {
      if (room.status !== 'WAITING' || room.hostUserId !== hostAtSchedule) return;
      try {
        this.startGame(room, room.hostUserId);
      } catch {
        /* chưa đủ điều kiện thì thôi */
      }
    }, afterMs);
  }

  // ============================================================ trận
  private startGame(room: Room, starterId: number) {
    if (room.hostUserId !== starterId) throw new WsError('FORBIDDEN', 'Chỉ chủ phòng được bắt đầu');
    if (room.status !== 'WAITING') throw new WsError('ROOM_NOT_WAITING', 'Phòng không ở trạng thái chờ');
    if (this.runners.size && [...this.runners.values()].some((r) => r.room.id === room.id))
      throw new WsError('ROOM_NOT_WAITING', 'Phòng đã có trận đang chạy');
    const set = db.quizSets.find((s) => s.id === room.quizSetId && !s.deletedAt);
    if (!set || set.questions.length === 0) throw new WsError('INVALID_QUIZ_SET', 'Hãy chọn một bộ đề có ít nhất 1 câu');
    const members = room.members.filter((m) => m.status === 'JOINED');
    if (members.length < 1) throw new WsError('BAD_REQUEST', 'Phòng chưa có người chơi nào');

    // Chụp bộ đề: game_questions / game_choices có id riêng
    const questions: GameQuestion[] = snapshotQuestions(set, room.questionTimeMs).map((q) => ({
      ...q,
      id: db.seq.gameChoice++,
      choices: q.choices.map((c) => ({ ...c, id: db.seq.gameChoice++ })),
    }));
    const meId = this.conn?.userId;
    const players: GamePlayer[] = members.map((m) => ({
      id: db.seq.gamePlayer++,
      userId: m.userId,
      displayName: m.displayName,
      status: 'PLAYING',
      shuffleSeed: Math.floor(Math.random() * 2 ** 31),
      totalScore: 0,
      correctCount: 0,
      currentStreak: 0,
      bestStreak: 0,
      finalRank: null,
      completedAt: null,
    }));
    const game: Game = {
      id: uuid(),
      roomId: room.id,
      roomCode: room.roomCode,
      roomTitle: room.title,
      quizSetId: set.id,
      quizTitleSnapshot: set.title,
      mode: room.mode,
      questionTimeMs: room.questionTimeMs,
      shuffleQuestions: room.shuffleQuestions,
      shuffleChoices: room.shuffleChoices,
      streakBonus: room.streakBonus,
      status: 'RUNNING',
      startedBy: starterId,
      startedAt: nowIso(),
      endedAt: null,
      cancelReason: null,
      questions,
      players,
      rounds: [],
    };
    db.games.push(game);
    room.status = 'PLAYING';
    this.stopRoomSim(room);

    const indices = questions.map((_, i) => i);
    const r: Runner = { game, room, rt: new Map(), liveIndex: 0, liveClosed: true, liveTimer: null, timers: [] };
    for (const p of players) {
      r.rt.set(p.id, {
        isBot: p.userId !== meId,
        accuracy: 0.45 + Math.random() * 0.45,
        // BR16: chế độ đồng bộ chỉ xáo lựa chọn
        order: room.shuffleQuestions && room.mode === 'SELF_PACED' ? seededShuffle(indices, p.shuffleSeed) : indices,
        pos: 0,
        timers: [],
        waitingResume: false,
      });
    }
    this.runners.set(game.id, r);

    const startsAt = Date.now() + START_COUNTDOWN_MS;
    this.toGame(r, {
      type: 'GAME_STARTED',
      payload: { gameId: game.id, mode: game.mode, questionCount: questions.length, startsAt, quizTitle: game.quizTitleSnapshot },
    });
    this.roomUpdated(room);
    this.broadcastLeaderboard(r);
    r.timers.push(
      setTimeout(() => {
        if (game.mode === 'LIVE') this.openLive(r);
        else players.forEach((p) => this.openNext(r, p));
      }, START_COUNTDOWN_MS),
    );
  }

  private leaderboard(r: Runner): LeaderboardEntry[] {
    const entries = r.game.players.map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      totalScore: p.totalScore,
      correctCount: p.correctCount,
      answeredCount: r.game.rounds.filter((x) => x.gamePlayerId === p.id && x.status !== 'ACTIVE' && x.status !== 'CANCELLED').length,
      status: p.status,
      rank: 0,
    }));
    entries.sort((a, b) => b.totalScore - a.totalScore);
    entries.forEach((e, i) => (e.rank = i > 0 && entries[i - 1].totalScore === e.totalScore ? entries[i - 1].rank : i + 1));
    return entries;
  }

  private broadcastLeaderboard(r: Runner) {
    this.toGame(r, { type: 'LEADERBOARD_UPDATED', payload: { entries: this.leaderboard(r) } });
  }

  private questionView(r: Runner, p: GamePlayer, round: PlayerRound, index: number): QuestionView {
    const q = r.game.questions.find((x) => x.id === round.gameQuestionId)!;
    let choices = q.choices.slice().sort((a, b) => a.position - b.position);
    if (r.game.shuffleChoices && q.type !== 'TRUE_FALSE') choices = seededShuffle(choices, p.shuffleSeed + q.id);
    return {
      roundId: round.id,
      index,
      total: r.game.questions.length,
      type: q.type,
      content: q.content,
      imageUrl: q.imageUrl,
      points: q.points,
      timeLimitMs: q.timeLimitMs,
      choices: choices.map((c) => ({ id: c.id, content: c.content })),
      startedAt: Date.parse(round.startedAt),
      deadlineAt: Date.parse(round.deadlineAt),
    };
  }

  private createRound(r: Runner, p: GamePlayer, q: GameQuestion, deadline: number): PlayerRound {
    const round: PlayerRound = {
      id: uuid(),
      gamePlayerId: p.id,
      gameQuestionId: q.id,
      status: 'ACTIVE',
      startedAt: nowIso(),
      deadlineAt: new Date(deadline).toISOString(),
      answeredAt: null,
      score: 0,
      bonus: 0,
      choiceIds: [],
    };
    r.game.rounds.push(round);
    return round;
  }

  private scheduleBot(r: Runner, p: GamePlayer, round: PlayerRound, q: GameQuestion) {
    const rt = r.rt.get(p.id)!;
    if (Math.random() < 0.07) return; // thỉnh thoảng để hết giờ
    const t = q.timeLimitMs * (0.12 + Math.random() * 0.6);
    rt.timers.push(
      setTimeout(() => {
        if (round.status !== 'ACTIVE') return;
        const correct = q.choices.filter((c) => c.isCorrect).map((c) => c.id);
        const wrong = q.choices.filter((c) => !c.isCorrect).map((c) => c.id);
        const ok = Math.random() < rt.accuracy || wrong.length === 0;
        this.submit(r, p, round.id, ok ? correct : [pick(wrong)]);
      }, t),
    );
  }

  /** Chốt lượt bằng đáp án. Tương đương UPDATE ... WHERE id = ? AND status = 'ACTIVE'. */
  private submit(r: Runner, p: GamePlayer, roundId: string, choiceIds: number[], requestId?: string) {
    const round = r.game.rounds.find((x) => x.id === roundId && x.gamePlayerId === p.id);
    if (!round || round.status !== 'ACTIVE') throw new WsError('ROUND_NOT_ACTIVE', 'Lượt câu này đã đóng');
    const t = Date.now();
    const deadline = Date.parse(round.deadlineAt);
    if (t >= deadline) {
      this.timeoutRound(r, p, round);
      throw new WsError('ROUND_NOT_ACTIVE', 'Đã hết giờ');
    }
    const q = r.game.questions.find((x) => x.id === round.gameQuestionId)!;
    const valid = new Set(q.choices.map((c) => c.id));
    const uniq = [...new Set(choiceIds)];
    if (!uniq.length || uniq.some((id) => !valid.has(id)) || (q.type !== 'MULTIPLE' && uniq.length !== 1))
      throw new WsError('INVALID_CHOICE', 'Lựa chọn không hợp lệ');

    // BR17: nhiều đáp án chỉ đúng khi khớp hoàn toàn
    const ok = sameSet(uniq, q.choices.filter((c) => c.isCorrect).map((c) => c.id));
    const score = ok ? calcScore(q.points, deadline - t, q.timeLimitMs) : 0;
    p.currentStreak = ok ? p.currentStreak + 1 : 0;
    p.bestStreak = Math.max(p.bestStreak, p.currentStreak);
    const bonus = ok && r.game.streakBonus ? streakBonus(p.currentStreak) : 0;
    Object.assign(round, { status: ok ? 'CORRECT' : 'WRONG', answeredAt: nowIso(), score, bonus, choiceIds: uniq });
    p.totalScore += score + bonus;
    if (ok) p.correctCount++;

    this.toUser(
      p.userId,
      {
        type: 'ANSWER_RECORDED',
        payload: { roundId, result: ok ? 'CORRECT' : 'WRONG', score, bonus, totalScore: p.totalScore, streak: p.currentStreak },
      },
      requestId,
    );
    this.broadcastLeaderboard(r);
    this.afterRoundClosed(r, p);
  }

  private timeoutRound(r: Runner, p: GamePlayer, round: PlayerRound, advance = true) {
    if (round.status !== 'ACTIVE') return;
    round.status = 'TIMEOUT';
    round.score = 0;
    p.currentStreak = 0;
    this.toUser(p.userId, { type: 'QUESTION_TIMED_OUT', payload: { roundId: round.id, score: 0, totalScore: p.totalScore } });
    if (advance) {
      this.broadcastLeaderboard(r);
      this.afterRoundClosed(r, p);
    }
  }

  private afterRoundClosed(r: Runner, p: GamePlayer) {
    const rt = r.rt.get(p.id)!;
    rt.timers.forEach(clearTimeout);
    rt.timers = [];
    if (r.game.mode === 'SELF_PACED') {
      rt.pos++;
      // BR14: chốt câu xong nhận câu kế tiếp
      rt.timers.push(setTimeout(() => this.openNext(r, p), rt.isBot ? 400 : FEEDBACK_GAP_MS));
    } else {
      const q = r.game.questions[r.liveIndex];
      const open = r.game.rounds.some((x) => x.gameQuestionId === q?.id && x.status === 'ACTIVE');
      if (!open) this.closeLive(r);
    }
  }

  // ----- tiến độ riêng
  private openNext(r: Runner, p: GamePlayer) {
    if (r.game.status !== 'RUNNING') return;
    const rt = r.rt.get(p.id)!;
    if (p.status === 'DISCONNECTED') {
      rt.waitingResume = true; // BR18: không mở lượt mới cho đến khi quay lại
      return;
    }
    if (p.status !== 'PLAYING') return;
    if (rt.pos >= rt.order.length) return this.completePlayer(r, p);
    const q = r.game.questions[rt.order[rt.pos]];
    const round = this.createRound(r, p, q, Date.now() + q.timeLimitMs);
    rt.timers.push(setTimeout(() => this.timeoutRound(r, p, round), q.timeLimitMs));
    this.toUser(p.userId, { type: 'QUESTION_STARTED', payload: { question: this.questionView(r, p, round, rt.pos) } });
    if (rt.isBot) this.scheduleBot(r, p, round, q);
  }

  private completePlayer(r: Runner, p: GamePlayer) {
    p.status = 'COMPLETED';
    p.completedAt = nowIso();
    this.toUser(p.userId, {
      type: 'PLAYER_FINISHED',
      payload: { totalScore: p.totalScore, correctCount: p.correctCount, questionCount: r.game.questions.length },
    });
    this.broadcastLeaderboard(r);
    this.checkFinish(r);
  }

  private checkFinish(r: Runner) {
    if (r.game.status !== 'RUNNING') return;
    if (r.game.players.every((p) => p.status === 'COMPLETED' || p.status === 'LEFT')) this.finish(r);
  }

  // ----- đồng bộ
  private openLive(r: Runner) {
    if (r.game.status !== 'RUNNING') return;
    if (r.liveIndex >= r.game.questions.length) return this.finishLive(r);
    const q = r.game.questions[r.liveIndex];
    const deadline = Date.now() + q.timeLimitMs;
    r.liveClosed = false;
    for (const p of r.game.players.filter((x) => x.status === 'PLAYING' || x.status === 'DISCONNECTED')) {
      const round = this.createRound(r, p, q, deadline);
      if (p.status === 'PLAYING')
        this.toUser(p.userId, { type: 'QUESTION_STARTED', payload: { question: this.questionView(r, p, round, r.liveIndex) } });
      if (r.rt.get(p.id)!.isBot) this.scheduleBot(r, p, round, q);
    }
    r.liveTimer = setTimeout(() => this.closeLive(r), q.timeLimitMs);
  }

  private closeLive(r: Runner) {
    if (r.liveClosed || r.game.status !== 'RUNNING') return;
    r.liveClosed = true;
    if (r.liveTimer) clearTimeout(r.liveTimer); // câu đóng sớm: hủy hẹn giờ cũ
    r.liveTimer = null;
    const q = r.game.questions[r.liveIndex];
    const rounds = r.game.rounds.filter((x) => x.gameQuestionId === q.id);
    for (const round of rounds.filter((x) => x.status === 'ACTIVE')) {
      const p = r.game.players.find((x) => x.id === round.gamePlayerId)!;
      this.timeoutRound(r, p, round, false);
    }
    const counts: Record<number, number> = {};
    q.choices.forEach((c) => (counts[c.id] = 0));
    rounds.forEach((x) => x.choiceIds.forEach((id) => (counts[id] = (counts[id] ?? 0) + 1)));
    r.liveIndex++;
    const nextAt = r.liveIndex < r.game.questions.length ? Date.now() + LIVE_RESULT_MS : null;
    for (const p of r.game.players.filter((x) => x.status !== 'LEFT')) {
      const mine = rounds.find((x) => x.gamePlayerId === p.id);
      this.toUser(p.userId, {
        type: 'QUESTION_RESULT',
        payload: {
          gameQuestionId: q.id,
          roundId: mine?.id ?? null,
          correctChoiceIds: q.choices.filter((c) => c.isCorrect).map((c) => c.id),
          explanation: q.explanation,
          counts,
          answeredCount: rounds.filter((x) => x.answeredAt).length,
          playerCount: rounds.length,
          yourResult: mine?.status ?? null,
          yourScore: mine?.score ?? 0,
          yourBonus: mine?.bonus ?? 0,
          nextAt,
        },
      });
    }
    this.broadcastLeaderboard(r);
    r.timers.push(setTimeout(() => this.openLive(r), LIVE_RESULT_MS));
  }

  private finishLive(r: Runner) {
    for (const p of r.game.players.filter((x) => x.status === 'PLAYING' || x.status === 'DISCONNECTED')) {
      p.status = 'COMPLETED';
      p.completedAt = nowIso();
    }
    this.finish(r);
  }

  private leaveGame(r: Runner, p: GamePlayer) {
    const rt = r.rt.get(p.id)!;
    rt.timers.forEach(clearTimeout);
    rt.timers = [];
    const g = this.graceTimers.get(p.userId);
    if (g) clearTimeout(g);
    this.graceTimers.delete(p.userId);
    p.status = 'LEFT';
    r.game.rounds.filter((x) => x.gamePlayerId === p.id && x.status === 'ACTIVE').forEach((x) => (x.status = 'CANCELLED'));
    this.toGame(r, { type: 'PLAYER_CONNECTION_CHANGED', payload: { userId: p.userId, displayName: p.displayName, status: 'LEFT' } });
    this.broadcastLeaderboard(r);
    if (r.game.mode === 'LIVE' && !r.liveClosed) {
      const q = r.game.questions[r.liveIndex];
      if (!r.game.rounds.some((x) => x.gameQuestionId === q.id && x.status === 'ACTIVE')) this.closeLive(r);
    }
    if (r.game.players.every((x) => x.status === 'LEFT' || x.status === 'COMPLETED')) this.finish(r);
  }

  private finish(r: Runner) {
    const { game, room } = r;
    if (game.status !== 'RUNNING') return;
    r.timers.forEach(clearTimeout);
    if (r.liveTimer) clearTimeout(r.liveTimer);
    r.rt.forEach((x) => x.timers.forEach(clearTimeout));
    const anyCompleted = game.players.some((p) => p.status === 'COMPLETED');
    game.status = anyCompleted ? 'FINISHED' : 'CANCELLED';
    game.cancelReason = anyCompleted ? null : 'Mọi người rời trận trước khi có ai hoàn thành';
    game.endedAt = nowIso();
    assignRanks(game.players);
    this.runners.delete(game.id);
    this.toGame(r, { type: 'GAME_FINISHED', payload: { gameId: game.id, standings: this.leaderboard(r) } });
    // BR13: phòng về trạng thái chờ
    room.status = this.joinedCount(room) > 0 ? 'WAITING' : 'CLOSED';
    this.roomUpdated(room);
    const meId = this.conn?.userId;
    if (meId != null && room.status === 'WAITING' && room.members.some((m) => m.userId === meId && m.status === 'JOINED')) {
      this.startRoomSim(room, meId);
      if (room.hostUserId !== meId) {
        // chủ phòng ảo nhường quyền để người dùng tự cấu hình và chơi lại
        const host = room.hostUserId;
        this.roomTimeout(room, () => {
          if (room.status !== 'WAITING' || room.hostUserId !== host) return;
          const me = room.members.find((m) => m.userId === meId && m.status === 'JOINED');
          if (!me) return;
          this.postChat(room, host, `Mình nhường chủ phòng cho ${me.displayName} nhé, chơi lại đi!`);
          this.transferHost(host, meId);
        }, 4000);
      }
    }
  }

  private resume(conn: Conn, rid: string | undefined) {
    const userId = conn.userId!;
    const r = this.runnerOf(userId);
    const p = r?.game.players.find((x) => x.userId === userId);
    if (!r || !p) throw new WsError('BAD_REQUEST', 'Bạn không còn trong trận nào (có thể đã quá 30 giây)');
    if (p.status === 'DISCONNECTED') {
      p.status = 'PLAYING';
      const g = this.graceTimers.get(userId);
      if (g) clearTimeout(g);
      this.graceTimers.delete(userId);
      this.toGame(r, { type: 'PLAYER_CONNECTION_CHANGED', payload: { userId, displayName: p.displayName, status: 'RECONNECTED' } });
    }
    const rt = r.rt.get(p.id)!;
    const active = r.game.rounds.find((x) => x.gamePlayerId === p.id && x.status === 'ACTIVE');
    const index = r.game.mode === 'LIVE' ? r.liveIndex : rt.pos;
    this.reply(conn, rid, {
      type: 'GAME_STATE',
      payload: {
        gameId: r.game.id,
        mode: r.game.mode,
        quizTitle: r.game.quizTitleSnapshot,
        questionCount: r.game.questions.length,
        question: active ? this.questionView(r, p, active, index) : null, // thời hạn cũ
        totalScore: p.totalScore,
        finished: p.status === 'COMPLETED',
        leaderboard: this.leaderboard(r),
      },
    });
    this.broadcastLeaderboard(r);
    if (r.game.mode === 'SELF_PACED' && rt.waitingResume) {
      rt.waitingResume = false;
      this.openNext(r, p);
    }
  }

  // ============================================================ công cụ demo
  /** Giả lập rớt mạng trong `ms` mili giây. */
  simulateOutage(ms: number) {
    this.networkDown = true;
    const c = this.conn;
    if (c?.open) this.dropConn(c, 1006, 'NETWORK_DOWN');
    setTimeout(() => (this.networkDown = false), ms);
  }

  /** Giả lập một tab khác của cùng tài khoản kết nối (BR21). */
  simulateSessionReplaced() {
    const c = this.conn;
    if (!c?.open) return;
    this.emit(c, { type: 'SESSION_REPLACED', payload: {} });
    setTimeout(() => this.dropConn(c, 4001, 'SESSION_REPLACED'), LATENCY_MS * 2);
  }
}

class WsError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const mockServer = new MockServer();

// ============================================================ MockWebSocket
/** Cùng giao diện tối thiểu với WebSocket của trình duyệt. */
export class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  private conn: Conn | null = null;

  constructor(public url: string) {
    setTimeout(() => {
      if (this.readyState === MockWebSocket.CLOSED) return;
      const c = mockServer.accept(this);
      if (!c) {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({ code: 1006, reason: 'Không kết nối được tới server' });
        return;
      }
      this.conn = c;
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 200);
  }

  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN || !this.conn) return;
    const c = this.conn;
    setTimeout(() => mockServer.receive(c, data), LATENCY_MS);
  }

  close() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    if (this.conn) mockServer.clientClosed(this.conn);
    this.onclose?.({ code: 1000, reason: 'client closed' });
  }

  /** server → client */
  _deliver(data: string) {
    setTimeout(() => {
      if (this.readyState === MockWebSocket.OPEN) this.onmessage?.({ data });
    }, LATENCY_MS);
  }

  _serverClose(code: number, reason: string) {
    if (this.readyState === MockWebSocket.CLOSED) return;
    // để thông điệp cuối (SESSION_REPLACED / ERROR) tới trước
    setTimeout(() => {
      if (this.readyState === MockWebSocket.CLOSED) return;
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({ code, reason });
    }, LATENCY_MS + 10);
  }
}
