import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar, Modal, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/icons';
import { quizSocket } from '../lib/socket';
import { useAuth } from '../store/auth';
import { notify, useLive } from '../store/live';
import type { RoomMember } from '../types';

export default function WaitingRoom() {
  const { code = '' } = useParams();
  const targetCode = code.toUpperCase();
  const { room, status, pending, roomError } = useLive();
  const user = useAuth((s) => s.user)!;
  const [password, setPassword] = useState('');
  const [name, setName] = useState(() => localStorage.getItem('quiz.name') || user.displayName);
  const [confirm, setConfirm] = useState<{ kind: 'kick' | 'host'; member: RoomMember } | null>(null);
  const tried = useRef('');
  const disabled = pending || status !== 'OPEN';
  useEffect(() => {
    if (status !== 'OPEN' || room || tried.current === targetCode) return;
    const timer = setTimeout(() => {
      if (useLive.getState().room) return;
      tried.current = targetCode;
      void quizSocket.joinRoom(targetCode, undefined, name.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [status, room, targetCode, name]);
  const retry = (e: FormEvent) => {
    e.preventDefault();
    if (disabled || !name.trim()) return;
    localStorage.setItem('quiz.name', name.trim());
    void quizSocket.joinRoom(targetCode, password || undefined, name.trim());
  };
  if (!room || room.roomCode !== targetCode) return <div className="page narrow"><section className="panel join-panel">
    <h1 className="panel-title">Vào phòng {targetCode}</h1>
    {room ? <><p className="note">Bạn đang ở phòng {room.roomCode}. Hãy rời phòng hiện tại trước khi vào phòng khác.</p><Link className="btn" to={`/rooms/${room.roomCode}`}>Quay lại phòng hiện tại</Link></> : <>
      {disabled && <Spinner label={pending ? 'Đang vào phòng…' : 'Đang kết nối máy chủ…'} />}
      <form className="form" onSubmit={retry}>
        <label className="field"><span className="field-label">Tên trong phòng</span><input name="displayName" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required autoComplete="nickname" /></label>
        <label className="field"><span className="field-label">Mật khẩu phòng (nếu có)</span><input name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={72} autoComplete="off" /></label>
        {roomError && <p className="field-error" role="alert">{roomError}</p>}
        <button className="btn btn-primary" disabled={disabled || !name.trim()}>Vào phòng</button>
      </form>
    </>}
    <Link className="btn btn-quiet" to="/lobby">Về sảnh</Link>
  </section></div>;
  const isHost = room.hostUserId === user.id;
  const copy = async () => {
    try { await navigator.clipboard.writeText(room.roomCode); notify('Đã sao chép mã phòng.', 'success'); }
    catch { notify('Không thể sao chép. Hãy chọn mã phòng để sao chép thủ công.', 'warn'); }
  };
  return <div className="page">
    <PageHeader kicker={`Phòng chờ · ${room.visibility === 'PRIVATE' ? 'Riêng tư' : 'Công khai'}${room.hasPassword ? ' · Có mật khẩu' : ''}`} title={room.title} sub="Chia sẻ mã phòng để mời bạn bè cùng tham gia."
      actions={<><button className="code-stamp" onClick={() => void copy()} aria-label={`Sao chép mã phòng ${room.roomCode}`}><span className="code-stamp-label">Mã phòng</span><span className="code-stamp-value mono">{room.roomCode}</span><Icon name="copy" /></button><button className="btn btn-quiet" disabled={disabled} onClick={() => void quizSocket.leaveRoom()}>Rời phòng</button></>} />
    <div className="waiting-grid">
      <section className="panel" aria-labelledby="members-title">
        <div className="panel-head"><h2 id="members-title" className="panel-title">Người chơi <span className="num muted">{room.members.length}/{room.maxPlayers}</span></h2><span className="muted small">{room.members.filter((m) => m.online).length} trực tuyến</span></div>
        <ul className="member-list">{room.members.map((member) => <li key={member.userId} className={`member ${member.userId === user.id ? 'is-me' : ''}`}>
          <Avatar name={member.displayName} id={member.userId} />
          <div className="member-main"><div className="member-name truncate">{member.displayName}{member.userId === user.id && <span className="muted"> (bạn)</span>}</div><div className="member-meta">
            {member.userId === room.hostUserId && <span className="host-mark"><Icon name="crown" size={13} /> chủ phòng</span>}
            {member.isGuest && <span>khách</span>}<span>{member.online ? 'Trực tuyến' : 'Đang chờ kết nối lại'}</span>
          </div></div>
          {isHost && member.userId !== user.id && <div className="member-actions">
            {!member.isGuest && member.online && <button className="btn btn-xs btn-quiet" disabled={disabled} onClick={() => setConfirm({ kind: 'host', member })}>Trao quyền</button>}
            <button className="btn btn-xs btn-danger-quiet" disabled={disabled} onClick={() => setConfirm({ kind: 'kick', member })}>Mời ra</button>
          </div>}
        </li>)}</ul>
        <p className="seats-left">{room.members.length < room.maxPlayers ? `Còn ${room.maxPlayers - room.members.length} chỗ trống` : 'Phòng đã đủ người'}</p>
        {roomError && <p className="field-error waiting-error" role="alert">{roomError}</p>}
      </section>
      <aside className="lobby-side">
        <section className="panel join-panel"><h2 className="panel-title">Mời bạn bè</h2><p className="note">Gửi mã 6 ký tự này cho người bạn muốn mời.</p><div className="invite-code mono">{room.roomCode}</div><button className="btn btn-primary btn-block" onClick={() => void copy()}><Icon name="copy" /> Sao chép mã phòng</button></section>
        <section className="panel panel-quiet"><h2 className="panel-title">Thông tin phòng</h2><dl className="rules"><dt>Chủ phòng</dt><dd>{room.members.find((m) => m.userId === room.hostUserId)?.displayName}</dd><dt>Quyền của bạn</dt><dd>{isHost ? 'Quản lý thành viên, chuyển quyền và rời phòng.' : 'Thành viên phòng chờ.'}</dd><dt>Khi chủ phòng rời</dt><dd>Quyền được chuyển cho tài khoản thành viên đang trực tuyến. Phòng đóng nếu không có người phù hợp.</dd></dl></section>
      </aside>
    </div>
    {confirm && <Modal title={confirm.kind === 'kick' ? `Mời ${confirm.member.displayName} ra khỏi phòng?` : `Trao quyền cho ${confirm.member.displayName}?`} onClose={() => setConfirm(null)} footer={<><button className="btn btn-quiet" onClick={() => setConfirm(null)}>Hủy</button><button className={`btn ${confirm.kind === 'kick' ? 'btn-danger' : 'btn-primary'}`} disabled={disabled} onClick={() => { quizSocket.send({ type: confirm.kind === 'kick' ? 'KICK_MEMBER' : 'TRANSFER_HOST', payload: { userId: confirm.member.userId } }); setConfirm(null); }}>{confirm.kind === 'kick' ? 'Mời ra' : 'Trao quyền'}</button></>}><p>{confirm.kind === 'kick' ? 'Người này sẽ không thể vào lại phòng bằng tài khoản hiện tại.' : 'Bạn vẫn ở lại phòng như một thành viên.'}</p></Modal>}
  </div>;
}
