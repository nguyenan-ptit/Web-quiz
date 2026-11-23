import type { Room, State, User } from './connection';

const previewParam = new URLSearchParams(location.search).get('preview');
export const previewEnabled = previewParam === null
  ? import.meta.env.VITE_PREVIEW_MODE === 'true'
  : previewParam === '1';

export type PreviewView = 'entry' | 'user' | 'guest' | 'host-room' | 'member-room';

/** Local UI data only. Never authenticates or sends requests to the backend. */
export class PreviewConnection {
  private state: State = { user: null, room: null, status: 'idle', message: '', pending: false };
  private listeners = new Set<() => void>();

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  message(message: string) { this.update({ message }); }
  start(_token: string, user: User) {
    this.update({ user, room: null, status: 'connected', message: '', pending: false });
  }
  stop() {
    this.update({ user: null, room: null, status: 'idle', message: '', pending: false });
  }
  show(view: PreviewView) {
    if (view === 'entry') { this.stop(); return; }
    const user: User = { userId: 1, displayName: 'Minh Anh', isGuest: view === 'guest' };
    this.start('', user);
    if (view === 'host-room' || view === 'member-room') {
      this.update({ room: this.sampleRoom(user, view === 'host-room') });
    }
  }
  private sampleRoom(user: User, isHost: boolean): Room {
    return {
      roomId: 'preview-room', roomCode: 'ABC234', title: 'Cùng ôn tập lập trình mạng',
      status: 'WAITING', visibility: 'PRIVATE', hasPassword: false,
      hostUserId: isHost ? user.userId : 2, maxPlayers: 20, memberCount: 4,
      roomVersion: 1,
      members: [
        { ...user, online: true },
        { userId: 2, displayName: 'Quang Huy', isGuest: false, online: true },
        { userId: 3, displayName: 'Nguyễn An', isGuest: true, online: true },
        { userId: 4, displayName: 'Khánh Linh', isGuest: false, online: false },
      ],
    };
  }
  async send(type: string, payload: object = {}) {
    const user = this.state.user;
    if (!user) throw new Error('Hãy chọn danh tính xem trước.');
    const data = payload as Record<string, unknown>;
    if (type === 'CREATE_ROOM' || type === 'JOIN_ROOM') {
      if (type === 'CREATE_ROOM' && user.isGuest) throw new Error('Khách cần đăng nhập để tạo phòng.');
      const displayName = String(data.displayName || user.displayName).trim();
      if (!displayName) throw new Error('Vui lòng nhập tên hiển thị.');
      const room = this.sampleRoom({ ...user, displayName }, type === 'CREATE_ROOM');
      if (type === 'CREATE_ROOM') {
        room.title = String(data.title || room.title);
        room.visibility = String(data.visibility || 'PRIVATE');
        room.hasPassword = Boolean(data.password);
        room.maxPlayers = Math.max(2, Math.min(100, Number(data.maxPlayers) || 20));
        room.members = room.members.slice(0, room.maxPlayers);
        room.memberCount = room.members.length;
      } else {
        room.roomCode = String(data.roomCode || 'ABC234').trim().toUpperCase();
      }
      this.update({ room, message: '' });
      return;
    }
    if (type === 'LEAVE_ROOM') {
      this.update({ room: null, message: 'Bạn đã rời phòng mẫu.' });
      return;
    }
    const room = this.state.room;
    if (!room || room.hostUserId !== user.userId) throw new Error('Chỉ chủ phòng được thực hiện thao tác này.');
    const target = room.members.find(member => member.userId === data.targetUserId);
    if (!target || target.userId === user.userId) throw new Error('Thành viên đích không hợp lệ.');
    if (type === 'TRANSFER_HOST') {
      if (target.isGuest || !target.online) throw new Error('Chỉ chuyển quyền cho tài khoản thật trực tuyến.');
      this.update({ room: { ...room, hostUserId: target.userId, roomVersion: room.roomVersion + 1 } });
    } else if (type === 'KICK_MEMBER') {
      const members = room.members.filter(member => member.userId !== target.userId);
      this.update({ room: { ...room, members, memberCount: members.length, roomVersion: room.roomVersion + 1 } });
    }
  }
}

export const previewConnection = new PreviewConnection();
