import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Modal, Toggle } from '../components/ui';
import { Icon } from '../components/icons';
import { quizSocket } from '../lib/socket';
import { useAuth } from '../store/auth';
import { useLive } from '../store/live';

export default function WaitingLobby() {
  const user = useAuth((s) => s.user)!;
  const { room, status, pending, roomError } = useLive();
  const [name, setName] = useState(() => localStorage.getItem('quiz.name') || user.displayName);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const disabled = pending || status !== 'OPEN' || !name.trim() || !!room;
  const join = (e: FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    localStorage.setItem('quiz.name', name.trim());
    void quizSocket.joinRoom(code, password || undefined, name.trim());
  };
  return (
    <div className="page">
      <PageHeader kicker="Phòng & người chơi" title={`Chào ${user.displayName}!`}
        sub="Chọn tên hiển thị, tạo phòng hoặc nhập mã để tham gia cùng bạn bè."
        actions={!user.isGuest && <button className="btn btn-primary" disabled={disabled} onClick={() => { useLive.setState({ roomError: null }); setCreating(true); }}><Icon name="plus" /> Tạo phòng</button>} />
      {room && <div className="callout"><span>Bạn đang ở phòng <strong className="mono">{room.roomCode}</strong> · {room.title}</span><Link className="btn btn-sm" to={`/rooms/${room.roomCode}`}>Quay lại phòng</Link></div>}
      <div className="lobby-grid">
        <section className="panel join-panel">
          <div className="panel-head"><h2 className="panel-title">Vào phòng bằng mã</h2><span className="muted small">Mã gồm 6 ký tự</span></div>
          <form className="form" onSubmit={join}>
            <label className="field"><span className="field-label">Tên hiển thị trong phòng</span><input name="displayName" autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required placeholder="Ví dụ: Minh Anh" /><span className="field-hint">Mỗi người trong phòng cần một tên khác nhau.</span></label>
            <label className="field"><span className="field-label">Mã phòng</span><input className="code-input mono" name="roomCode" autoComplete="off" spellCheck={false} autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} pattern="[A-Za-z0-9]{6}" maxLength={6} required placeholder="ABC234" /></label>
            <label className="field"><span className="field-label">Mật khẩu <span className="muted">(nếu có)</span></span><input name="roomPassword" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={72} /></label>
            {roomError && <p className="field-error" role="alert">{roomError}</p>}
            <button className="btn btn-primary btn-lg" disabled={disabled}>{pending ? 'Đang xử lý…' : 'Vào phòng'}</button>
          </form>
        </section>
        <aside className="lobby-side">
          <section className="panel join-panel"><h2 className="panel-title">Phòng của bạn</h2><p className="page-sub">Tạo không gian ôn tập, chia sẻ mã và quản lý người tham gia ngay trong phòng chờ.</p>
            {user.isGuest ? <><p className="note">Khách có thể tham gia bằng mã. Đăng nhập tài khoản để tạo phòng.</p><button className="btn btn-block" onClick={() => { quizSocket.disconnect(); localStorage.removeItem('quiz.token'); useAuth.getState().clear(); }}>Đăng nhập tài khoản</button></> : <button className="btn btn-primary btn-block" disabled={disabled} onClick={() => { useLive.setState({ roomError: null }); setCreating(true); }}><Icon name="plus" /> Tạo phòng mới</button>}
          </section>
          <section className="panel panel-quiet"><h2 className="panel-title">Cùng vào phòng</h2><dl className="rules"><dt>Chia sẻ mã</dt><dd>Xin mã 6 ký tự từ chủ phòng để tham gia.</dd><dt>Giữ kết nối</dt><dd>Nếu mất mạng, chỗ của bạn được giữ 2 phút kể từ khi máy chủ phát hiện mất kết nối.</dd><dt>Chủ phòng</dt><dd>Có thể chuyển quyền hoặc mời người chơi ra khỏi phòng.</dd></dl></section>
        </aside>
      </div>
      {creating && <CreateRoom name={name.trim()} onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateRoom({ name, onClose }: { name: string; onClose: () => void }) {
  const [title, setTitle] = useState(`Phòng của ${name}`);
  const [isPrivate, setPrivate] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(20);
  const { pending, status, roomError } = useLive();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending || status !== 'OPEN') return;
    localStorage.setItem('quiz.name', name);
    const ok = await quizSocket.createRoom(title.trim(), isPrivate ? 'PRIVATE' : 'PUBLIC', hasPassword ? password : null, name, maxPlayers);
    if (ok) onClose();
  };
  return <Modal title="Tạo phòng mới" onClose={() => { if (!pending) onClose(); }}><form className="form" onSubmit={submit}>
    <label className="field"><span className="field-label">Tên phòng</span><input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required autoComplete="off" /></label>
    <label className="field"><span className="field-label">Số người tối đa</span><input name="maxPlayers" type="number" min={2} max={100} required value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} /><span className="field-hint">Từ 2 đến 100 người, bao gồm chủ phòng.</span></label>
    <Toggle checked={isPrivate} onChange={setPrivate} label="Phòng riêng tư" />
    <Toggle checked={hasPassword} onChange={setHasPassword} label="Đặt mật khẩu" />
    {hasPassword && <label className="field"><span className="field-label">Mật khẩu phòng</span><input name="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={72} required /></label>}
    {roomError && <p className="field-error" role="alert">{roomError}</p>}
    <div className="modal-actions"><button type="button" className="btn btn-quiet" disabled={pending} onClick={onClose}>Hủy</button><button className="btn btn-primary" disabled={pending || status !== 'OPEN' || !title.trim()}>{pending ? 'Đang tạo…' : 'Tạo phòng'}</button></div>
  </form></Modal>;
}
