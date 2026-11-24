import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../lib/auth-api';
import { mockEnabled } from '../lib/runtime';
import { mockServer } from '../mock/server';
import { quizSocket } from '../lib/socket';
import { useAuth } from '../store/auth';
import { useLive, type ConnStatus } from '../store/live';
import { Avatar, Modal, useNow } from './ui';
import { Icon } from './icons';

const STATUS_TEXT: Record<ConnStatus, string> = {
  IDLE: 'chưa kết nối',
  CONNECTING: 'đang kết nối…',
  AUTHENTICATING: 'đang xác thực…',
  OPEN: 'trực tuyến',
  RECONNECTING: 'kết nối lại…',
  REPLACED: 'phiên bị thay thế',
  CLOSED: 'đã ngắt',
};

export function ConnectionStatus() {
  const status = useLive((s) => s.status);
  const tone = status === 'OPEN' ? 'ok' : status === 'REPLACED' || status === 'CLOSED' || status === 'IDLE' ? 'bad' : 'warn';
  return (
    <span className={`conn conn-${tone}`} title="Trạng thái kết nối WebSocket" role="status">
      <span className="conn-dot" aria-hidden="true" />
      <span className="conn-label">ws</span> {STATUS_TEXT[status]}
    </span>
  );
}

/** Dải báo khi mất kết nối + hộp thoại khi phiên bị thay thế. */
function ConnectionBanner() {
  const { status, retryAt, attempt } = useLive();
  const now = useNow(250);
  if (status === 'RECONNECTING') {
    const left = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
    return (
      <div className="conn-banner" role="status">
        <Icon name="wifiOff" />
        <span>
          Mất kết nối tới server. {retryAt ? `Thử lại sau ${left} giây (lần ${attempt}).` : 'Đang thử lại…'}
        </span>
        <button className="btn btn-sm btn-quiet" onClick={() => quizSocket.reconnectNow()}>
          Thử ngay
        </button>
      </div>
    );
  }
  if (status === 'REPLACED') {
    return (
      <Modal title="Phiên đã bị thay thế" onClose={() => quizSocket.reconnectNow()}>
        <p>
          Tài khoản của bạn vừa kết nối từ tab hoặc thiết bị khác (<code translate="no">SESSION_REPLACED</code>). Mỗi tài khoản chỉ giữ
          một kết nối điều khiển trong phòng.
        </p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={() => quizSocket.reconnectNow()}>
            Tiếp tục ở tab này
          </button>
        </div>
      </Modal>
    );
  }
  if (status === 'CLOSED') return (
    <div className="conn-banner" role="alert">
      <span>Phiên đã hết hạn. Đăng nhập lại để tiếp tục.</span>
      <button className="btn btn-sm" onClick={() => { quizSocket.disconnect(); useAuth.getState().clear(); }}>Đăng nhập lại</button>
    </div>
  );
  return null;
}

function Toasts() {
  const notices = useLive((s) => s.notices);
  return (
    <div className="toasts" aria-live="polite" role="status">
      {notices.map((n) => (
        <div key={n.id} className={`toast toast-${n.tone}`}>
          {n.text}
        </div>
      ))}
    </div>
  );
}

/** Điều hướng theo sự kiện socket (GAME_STARTED → /play, …). */
function SocketNavigator() {
  const nav = useLive((s) => s.nav);
  const navigate = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    if (nav && nav.to !== loc.pathname) navigate(nav.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);
  return null;
}

/** Bảng log socket + nút giả lập sự cố mạng, phục vụ demo môn Lập trình mạng. */
function DevPanel({ onClose }: { onClose: () => void }) {
  const log = useLive((s) => s.log);
  const [hidePing, setHidePing] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const rows = log.filter((l) => !hidePing || (l.type !== 'PING' && l.type !== 'PONG')).slice().reverse();
  return (
    <aside className="devpanel" aria-label="Nhật ký socket">
      <div className="devpanel-head">
        <span className="devpanel-title">Socket log</span>
        <label className="devpanel-check">
          <input type="checkbox" checked={hidePing} onChange={(e) => setHidePing(e.target.checked)} /> Ẩn PING/PONG
        </label>
        <button className="icon-btn" onClick={onClose} aria-label="Đóng nhật ký socket">
          <Icon name="close" />
        </button>
      </div>
      <div className="devpanel-actions">
        {mockEnabled && <>
        <button className="devbtn" onClick={() => mockServer.simulateOutage(5000)}>
          Rớt mạng 5 giây
        </button>
        <button className="devbtn" onClick={() => mockServer.simulateOutage(40000)}>
          Rớt mạng 40 giây
        </button>
        <button className="devbtn" onClick={() => mockServer.simulateSessionReplaced()}>
          Tab khác đăng nhập
        </button>
        </>}
        <button className="devbtn devbtn-quiet" onClick={() => useLive.setState({ log: [] })}>
          Xóa log
        </button>
      </div>
      <ul className="devlog">
        {rows.length === 0 && <li className="devlog-empty">Chưa có thông điệp nào.</li>}
        {rows.map((l) => (
          <li key={l.id}>
            <button className={`devlog-row ${l.dir}`} onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
              <span className="devlog-dir" aria-label={l.dir === 'out' ? 'gửi' : 'nhận'}>
                {l.dir === 'out' ? '→' : '←'}
              </span>
              <span className="devlog-type" translate="no">
                {l.type}
              </span>
              <span className="devlog-time">{new Date(l.at).toLocaleTimeString('vi-VN')}</span>
            </button>
            {open === l.id && <pre className="devlog-body">{l.body}</pre>}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function UserMenu() {
  const user = useAuth((s) => s.user)!;
  const clear = useAuth((s) => s.clear);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const logout = async () => {
    await quizSocket.leaveRoom();
    quizSocket.disconnect();
    await authApi.logout();
    qc.clear();
    clear();
    navigate('/login');
  };

  return (
    <div className="usermenu" ref={ref}>
      <button className="usermenu-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <Avatar name={user.displayName} id={user.id} size={28} />
        <span className="usermenu-name">{user.displayName}</span>
        {user.isGuest && <span className="usermenu-tag">khách</span>}
      </button>
      {open && (
        <div className="usermenu-pop" role="menu">
          <div className="usermenu-meta">
            <div className="strong">{user.displayName}</div>
            <div className="muted small">{user.isGuest ? 'Tài khoản khách' : user.username ? `@${user.username}` : 'Tài khoản thành viên'}</div>
          </div>
          {mockEnabled && !user.isGuest && (
            <Link to="/profile" role="menuitem" onClick={() => setOpen(false)}>
              <Icon name="user" /> Hồ sơ
            </Link>
          )}
          <button role="menuitem" onClick={logout}>
            <Icon name="logout" /> Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const user = useAuth((s) => s.user);
  const room = useLive((s) => s.room);
  const game = useLive((s) => s.game);
  const [dev, setDev] = useState(false);
  const inGame = !!game && !game.standings;

  return (
    <div className={`app ${dev ? 'with-dev' : ''}`}>
      <a href="#main" className="skip-link">
        Bỏ qua tới nội dung chính
      </a>
      <header className="masthead">
        <div className="masthead-inner">
          <Link to="/lobby" className="wordmark" translate="no" aria-label="Quiz Online – về sảnh">
            Quiz<span>online</span>
          </Link>
          <nav className="nav" aria-label="Điều hướng chính">
            <NavLink to="/lobby">Sảnh</NavLink>
            {mockEnabled && !user?.isGuest && <NavLink to="/quiz-sets">Bộ đề</NavLink>}
            {mockEnabled && !user?.isGuest && <NavLink to="/history">Lịch sử</NavLink>}
            {mockEnabled && <NavLink to="/leaderboard">Xếp hạng</NavLink>}
            {mockEnabled && user?.role === 'ADMIN' && <NavLink to="/admin">Quản trị</NavLink>}
          </nav>
          <div className="masthead-right">
            {room && (
              <Link to={inGame ? '/play' : `/rooms/${room.roomCode}`} className={`room-chip ${inGame ? 'live' : ''}`}>
                <span className="room-chip-label">{inGame ? 'Đang chơi' : 'Phòng'}</span>
                <span className="mono" translate="no">
                  {room.roomCode}
                </span>
              </Link>
            )}
            <ConnectionStatus />
            <button
              className={`icon-btn ${dev ? 'is-on' : ''}`}
              onClick={() => setDev(!dev)}
              aria-label={dev ? 'Ẩn nhật ký socket' : 'Hiện nhật ký socket'}
              aria-pressed={dev}
              title="Nhật ký socket"
            >
              <Icon name="terminal" size={18} />
            </button>
            {user && <UserMenu />}
          </div>
        </div>
      </header>
      <ConnectionBanner />
      <main className="main" id="main" tabIndex={-1}>
        <Outlet />
      </main>
      {dev && <DevPanel onClose={() => setDev(false)} />}
      <Toasts />
      <SocketNavigator />
    </div>
  );
}
