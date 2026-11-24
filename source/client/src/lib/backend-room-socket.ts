import { RoomConnection, type Room as WireRoom } from '../connection';
import type { ClientMessage } from '../protocol';
import type { Room } from '../types';
import { useAuth } from '../store/auth';
import { initialLive, navigateTo, notify, pushLog, useLive, type ConnStatus } from '../store/live';
import { toUser } from './auth-api';

function toRoom(room: WireRoom): Room {
  return {
    ...room, id: room.roomId, roomVersion: room.roomVersion,
    status: room.status as Room['status'], visibility: room.visibility as Room['visibility'],
    quizSetId: null, mode: 'SELF_PACED', questionTimeMs: 30000,
    shuffleQuestions: true, shuffleChoices: true, streakBonus: false, createdAt: '',
    members: room.members.map((member) => ({ ...member, status: 'JOINED', joinedAt: '' })),
  };
}

const statuses: Record<string, ConnStatus> = {
  idle: 'IDLE', connecting: 'CONNECTING', connected: 'OPEN', reconnecting: 'RECONNECTING', expired: 'CLOSED', replaced: 'REPLACED',
};

/** Adapt the real room backend to the existing Router/Zustand screens. */
export class BackendRoomSocket {
  private lastEvent = '';
  private transport = new RoomConnection((dir, type, body) => {
    if (dir === 'in') this.lastEvent = type;
    pushLog(dir, type, body);
  });
  private token: string | null = null;
  private lastMessage = '';

  constructor() {
    this.transport.subscribe(() => {
      const state = this.transport.getSnapshot();
      const previous = useLive.getState().room;
      useLive.setState({
        status: statuses[state.status], pending: state.pending,
        me: state.user ? toUser(state.user) : null,
        room: state.room ? toRoom(state.room) : null,
      });
      if (state.message && state.message !== this.lastMessage) notify(state.message, 'info');
      this.lastMessage = state.message;
      // Leave/kick/closed is acknowledged before navigating away.
      if (previous && !state.room && ['ROOM_LEFT', 'ROOM_CLOSED', 'MEMBER_KICKED'].includes(this.lastEvent)) navigateTo('/lobby');
    });
  }

  connect(token: string) {
    const user = useAuth.getState().user;
    if (!user) return;
    this.token = token;
    this.transport.start(token, { userId: user.id, displayName: user.displayName, isGuest: user.isGuest });
  }
  disconnect() {
    this.token = null;
    this.transport.stop();
    useLive.setState({ ...initialLive });
  }
  reconnectNow() {
    if (!this.token) return;
    this.transport.reconnectNow();
  }
  subscribeLobby() { useLive.setState({ lobbyWanted: true, lobby: [] }); }
  unsubscribeLobby() { useLive.setState({ lobbyWanted: false }); }

  private async command(type: string, payload: object = {}): Promise<boolean> {
    useLive.setState({ roomError: null });
    try {
      await this.transport.send(type, payload);
      return true;
    } catch (error) {
      const message = (error as Error).message;
      useLive.setState({ roomError: message });
      notify(message, 'error');
      return false;
    }
  }
  async createRoom(title: string, visibility: 'PUBLIC' | 'PRIVATE', password: string | null, displayName?: string, maxPlayers = 20) {
    const ok = await this.command('CREATE_ROOM', {
      title, visibility, password, maxPlayers,
      displayName: displayName ?? useAuth.getState().user?.displayName,
    });
    const room = useLive.getState().room;
    if (ok && room) navigateTo(`/rooms/${room.roomCode}`);
    return ok;
  }
  async joinRoom(roomCode: string, password?: string, displayName?: string) {
    const ok = await this.command('JOIN_ROOM', {
      roomCode: roomCode.trim().toUpperCase(), password,
      displayName: displayName ?? useAuth.getState().user?.displayName,
    });
    const room = useLive.getState().room;
    if (ok && room) navigateTo(`/rooms/${room.roomCode}`);
    return ok;
  }
  leaveRoom() { return useLive.getState().room ? this.command('LEAVE_ROOM') : Promise.resolve(true); }
  send(message: ClientMessage, _silent = false): string | null {
    if (message.type === 'KICK_MEMBER' || message.type === 'TRANSFER_HOST') {
      void this.command(message.type, { targetUserId: message.payload.userId });
      return message.type;
    }
    notify('Chức năng này chưa được backend hỗ trợ.', 'warn');
    return null;
  }
}
