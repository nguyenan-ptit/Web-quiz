import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { quizSocket } from '../lib/socket';
import { MODE_LABEL } from '../lib/format';
import { useAuth } from '../store/auth';
import { useLive } from '../store/live';
import type { LobbyRoom } from '../types';
import { Empty, Modal, PageHeader, Spinner, Toggle } from '../components/ui';
import { Icon } from '../components/icons';

export default function LobbyPage() {
  const user = useAuth((s) => s.user)!;
  const { lobby, status, room } = useLive();
  const [code, setCode] = useState('');
  const [codePw, setCodePw] = useState('');
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [pwRoom, setPwRoom] = useState<LobbyRoom | null>(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');

  // LOBBY_SUBSCRIBE khi vào sảnh, LOBBY_UNSUBSCRIBE khi rời
  useEffect(() => {
    if (status === 'OPEN') quizSocket.subscribeLobby();
    return () => quizSocket.unsubscribeLobby();
  }, [status]);

  const joinByCode = (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setCodeErr('Nhập mã phòng gồm 6 ký tự, ví dụ QUIZ02.');
      return;
    }
    setCodeErr(null);
    quizSocket.joinRoom(code.trim(), codePw || undefined);
  };

  const join = (r: LobbyRoom) => {
    if (r.hasPassword) setPwRoom(r);
    else quizSocket.joinRoom(r.roomCode);
  };

  const needle = q.trim().toLowerCase();
  const rooms = (lobby ?? []).filter(
    (r) => !needle || r.title.toLowerCase().includes(needle) || r.roomCode.toLowerCase().includes(needle) || r.quizTitle?.toLowerCase().includes(needle),
  );

  return (
    <div className="page">
      <PageHeader
        kicker={`Sảnh${lobby ? ` · ${lobby.length} phòng đang chờ` : ''}`}
        title={`Chào ${user.displayName}, hôm nay chơi gì?`}
        sub="Vào phòng bằng mã bạn bè gửi, hoặc chọn một phòng công khai bên dưới."
        actions={
          !user.isGuest && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> Tạo phòng
            </button>
          )
        }
      />

      {room && (
        <div className="callout">
          <span>
            Bạn đang ở phòng <strong className="mono" translate="no">{room.roomCode}</strong> · {room.title}
          </span>
          <Link to={`/rooms/${room.roomCode}`} className="link-arrow">
            Quay lại phòng <Icon name="arrowRight" />
          </Link>
        </div>
      )}

      <div className="lobby-grid">
        <section className="panel" aria-labelledby="rooms-h">
          <div className="panel-head">
            <h2 id="rooms-h" className="panel-title">
              Phòng công khai <span className="live-tag">trực tiếp</span>
            </h2>
            <label className="search">
              <Icon name="search" />
              <span className="sr-only">Tìm phòng</span>
              <input
                type="search"
                name="room-search"
                placeholder="Tìm theo tên, mã, bộ đề…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>

          {lobby == null ? (
            <Spinner label="Đang tải danh sách phòng…" />
          ) : rooms.length === 0 ? (
            <Empty title={q ? 'Không có phòng nào khớp' : 'Chưa có phòng nào đang chờ'}>
              {q ? 'Thử từ khóa khác.' : user.isGuest ? 'Nhập mã phòng bạn bè gửi cho bạn.' : 'Tạo phòng đầu tiên và mời bạn bè vào.'}
            </Empty>
          ) : (
            <ul className="room-list">
              {rooms.map((r) => {
                const full = r.memberCount >= r.maxPlayers;
                return (
                  <li key={r.id} className="room-row">
                    <span className="room-code mono" translate="no">
                      {r.roomCode}
                    </span>
                    <div className="room-main">
                      <div className="room-title">
                        <span className="truncate">{r.title}</span>
                        {r.hasPassword && (
                          <span className="room-lock" title="Cần mật khẩu">
                            <Icon name="lock" size={14} />
                            <span className="sr-only">cần mật khẩu</span>
                          </span>
                        )}
                      </div>
                      <div className="room-sub truncate">
                        {r.quizTitle ?? 'Chưa chọn bộ đề'} · chủ phòng {r.hostName}
                      </div>
                    </div>
                    <span className={`mode-tag mode-${r.mode}`}>{MODE_LABEL[r.mode]}</span>
                    <span className="room-seats num" aria-label={`${r.memberCount} trên ${r.maxPlayers} người`}>
                      {r.memberCount}
                      <span className="muted">/{r.maxPlayers}</span>
                    </span>
                    <button className="btn btn-sm" disabled={full} onClick={() => join(r)} aria-label={full ? `Phòng ${r.roomCode} đã đầy` : `Vào phòng ${r.roomCode}`}>
                      {full ? 'Đầy' : 'Vào'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="lobby-side">
          <form className="panel join-panel" onSubmit={joinByCode} aria-labelledby="join-h">
            <h2 id="join-h" className="panel-title">
              Vào bằng mã
            </h2>
            <label className="field">
              <span className="field-label">Mã phòng</span>
              <input
                className="code-input mono"
                name="room-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="QUIZ02"
                maxLength={8}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
                aria-invalid={!!codeErr}
                aria-describedby={codeErr ? 'code-err' : undefined}
              />
              {codeErr && (
                <span className="field-error" id="code-err">
                  {codeErr}
                </span>
              )}
            </label>
            <label className="field">
              <span className="field-label">
                Mật khẩu <span className="muted">(nếu có)</span>
              </span>
              <input type="password" name="room-password" value={codePw} onChange={(e) => setCodePw(e.target.value)} autoComplete="off" />
            </label>
            <button className="btn btn-primary btn-block">Vào phòng</button>
            <p className="note">
              Thử <code translate="no">QUIZ02</code>, <code translate="no">OSI777</code>; phòng riêng <code translate="no">NHOM04</code> (mật khẩu{' '}
              <code translate="no">1234</code>), <code translate="no">JS2026</code> (mật khẩu <code translate="no">js</code>).
            </p>
          </form>

          <section className="panel panel-quiet" aria-labelledby="how-h">
            <h2 id="how-h" className="panel-title">
              Luật chơi
            </h2>
            <dl className="rules">
              <dt>Tiến độ riêng</dt>
              <dd>Mỗi người một câu, một đồng hồ. Trả lời xong nhận ngay câu kế tiếp.</dd>
              <dt>Đồng bộ</dt>
              <dd>Cả phòng cùng câu. Sau mỗi câu hiện đáp án, số người chọn và bảng xếp hạng.</dd>
              <dt>Tính điểm</dt>
              <dd>
                Đúng được <strong>P × thời gian còn lại ÷ T</strong>, tối thiểu 1. Sai hoặc hết giờ được 0.
              </dd>
            </dl>
          </section>
        </aside>
      </div>

      {creating && <CreateRoomModal onClose={() => setCreating(false)} />}
      {pwRoom && <PasswordModal room={pwRoom} onClose={() => setPwRoom(null)} />}
    </div>
  );
}

function CreateRoomModal({ onClose }: { onClose: () => void }) {
  const user = useAuth((s) => s.user)!;
  const [title, setTitle] = useState(`Phòng của ${user.displayName}`);
  const [isPrivate, setPrivate] = useState(false);
  const [usePw, setUsePw] = useState(false);
  const [pw, setPw] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    quizSocket.createRoom(title, isPrivate ? 'PRIVATE' : 'PUBLIC', usePw && pw ? pw : null);
    onClose();
  };
  return (
    <Modal title="Tạo phòng mới" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Tên phòng</span>
          <input name="room-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} required autoComplete="off" />
        </label>
        <Toggle checked={isPrivate} onChange={setPrivate} label="Phòng riêng tư" hint="Không hiện ở sảnh, chỉ vào được bằng mã." />
        <Toggle checked={usePw} onChange={setUsePw} label="Đặt mật khẩu" />
        {usePw && (
          <label className="field">
            <span className="field-label">Mật khẩu phòng</span>
            <input name="new-room-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="off" />
          </label>
        )}
        <p className="note">Bộ đề, chế độ chơi và thời gian sẽ chọn trong phòng chờ.</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary">Tạo phòng</button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordModal({ room, onClose }: { room: LobbyRoom; onClose: () => void }) {
  const [pw, setPw] = useState('');
  return (
    <Modal title={`Phòng ${room.roomCode} cần mật khẩu`} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          quizSocket.joinRoom(room.roomCode, pw);
          onClose();
        }}
      >
        <label className="field">
          <span className="field-label">Mật khẩu</span>
          <input type="password" name="join-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="off" autoFocus />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary">Vào phòng</button>
        </div>
      </form>
    </Modal>
  );
}
