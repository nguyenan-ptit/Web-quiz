import { mockEnabled } from '../lib/runtime';
import WaitingRoom from './WaitingRoom';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { quizSetApi } from '../mock/api';
import { quizSocket } from '../lib/socket';
import { fmtTime, MODE_LABEL } from '../lib/format';
import { useAuth } from '../store/auth';
import { notify, useLive } from '../store/live';
import type { Room, RoomConfig, RoomMember } from '../types';
import { Avatar, Modal, PageHeader, Spinner, Toggle } from '../components/ui';
import { Icon } from '../components/icons';

function MockRoomPage() {
  const { code = '' } = useParams();
  const { room, status, game } = useLive();
  const me = useAuth((s) => s.user)!;
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const tried = useRef(false);

  // Mở thẳng URL /rooms/:code → gửi JOIN_ROOM
  useEffect(() => {
    if (status !== 'OPEN' || room?.roomCode === code.toUpperCase() || tried.current) return;
    const t = setTimeout(() => {
      if (useLive.getState().room?.roomCode !== code.toUpperCase()) {
        tried.current = true;
        quizSocket.joinRoom(code);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [status, room, code]);

  if (!room || room.roomCode !== code.toUpperCase()) {
    return (
      <div className="page narrow">
        <div className="panel">
          <Spinner label={`Đang vào phòng ${code.toUpperCase()}…`} />
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              quizSocket.joinRoom(code, pw);
            }}
          >
            <label className="field">
              <span className="field-label">Mật khẩu phòng (nếu phòng yêu cầu)</span>
              <div className="row gap-8">
                <input type="password" name="room-password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
                <button className="btn">Thử lại</button>
              </div>
            </label>
          </form>
          <Link to="/lobby" className="link-arrow back">
            <Icon name="arrowLeft" /> Về sảnh
          </Link>
        </div>
      </div>
    );
  }

  const isHost = room.hostUserId === me.id;
  const joined = room.members.filter((m) => m.status === 'JOINED').length;
  const leave = () => {
    quizSocket.leaveRoom();
    navigate('/lobby');
  };

  return (
    <div className="page">
      <PageHeader
        kicker={
          <>
            Phòng chờ · {room.status === 'PLAYING' ? 'đang trong trận' : 'đang chờ'}
            {room.visibility === 'PRIVATE' && ' · riêng tư'}
            {room.hasPassword && ' · có mật khẩu'}
          </>
        }
        title={room.title}
        sub="Gửi mã phòng cho bạn bè để cùng vào chơi."
        actions={
          <>
            <button
              className="code-stamp"
              onClick={() => {
                navigator.clipboard?.writeText(room.roomCode).catch(() => {});
                notify(`Đã sao chép mã ${room.roomCode}`, 'success');
              }}
              aria-label={`Sao chép mã phòng ${room.roomCode}`}
            >
              <span className="code-stamp-label">Mã phòng</span>
              <span className="code-stamp-value mono" translate="no">
                {room.roomCode}
              </span>
              <Icon name="copy" />
            </button>
            <button className="btn btn-quiet" onClick={leave}>
              Rời phòng
            </button>
          </>
        }
      />

      {room.status === 'PLAYING' && (
        <div className="callout callout-warn">
          <span>Trận đang diễn ra.</span>
          {game && !game.standings ? (
            <Link to="/play" className="link-arrow">
              Vào màn chơi <Icon name="arrowRight" />
            </Link>
          ) : (
            <span className="muted">Chờ trận kết thúc để chơi lượt sau.</span>
          )}
        </div>
      )}

      <div className="room-grid">
        <section className="panel" aria-labelledby="members-h">
          <div className="panel-head">
            <h2 id="members-h" className="panel-title">
              Người chơi
            </h2>
            <span className="num muted">
              {joined}/{room.maxPlayers}
            </span>
          </div>
          <MemberList room={room} meId={me.id} isHost={isHost} />
        </section>

        <section className="panel" aria-labelledby="config-h">
          <div className="panel-head">
            <h2 id="config-h" className="panel-title">
              Cấu hình trận
            </h2>
            {!isHost && <span className="muted small">Chỉ chủ phòng chỉnh được</span>}
          </div>
          <RoomConfigPanel room={room} editable={isHost && room.status === 'WAITING'} />
          <StartBar room={room} isHost={isHost} />
        </section>

        <section className="panel chat-panel" aria-labelledby="chat-h">
          <div className="panel-head">
            <h2 id="chat-h" className="panel-title">
              Trò chuyện
            </h2>
          </div>
          <Chat meId={me.id} disabled={room.status !== 'WAITING'} />
        </section>
      </div>
    </div>
  );
}

function MemberList({ room, meId, isHost }: { room: Room; meId: number; isHost: boolean }) {
  const [confirm, setConfirm] = useState<{ kind: 'kick' | 'host'; m: RoomMember } | null>(null);
  const members = room.members.filter((m) => m.status === 'JOINED').sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const free = room.maxPlayers - members.length;
  return (
    <>
      <ul className="member-list">
        {members.map((m) => (
          <li key={m.userId} className={`member ${m.userId === meId ? 'is-me' : ''}`}>
            <Avatar name={m.displayName} id={m.userId} />
            <div className="member-main">
              <div className="member-name truncate">
                {m.displayName}
                {m.userId === meId && <span className="muted"> (bạn)</span>}
              </div>
              <div className="member-meta">
                {m.userId === room.hostUserId && (
                  <span className="host-mark">
                    <Icon name="crown" size={13} /> chủ phòng
                  </span>
                )}
                {m.isGuest && <span>khách</span>}
              </div>
            </div>
            {isHost && m.userId !== meId && room.status === 'WAITING' && (
              <div className="member-actions">
                <button className="btn btn-xs btn-quiet" onClick={() => setConfirm({ kind: 'host', m })}>
                  Trao quyền
                </button>
                <button className="btn btn-xs btn-danger-quiet" onClick={() => setConfirm({ kind: 'kick', m })}>
                  Mời ra
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="seats-left">{free > 0 ? `Còn ${free} chỗ trống` : 'Phòng đã đủ người'}</p>
      {confirm && (
        <Modal
          title={confirm.kind === 'kick' ? `Mời ${confirm.m.displayName} ra khỏi phòng?` : `Trao quyền chủ phòng cho ${confirm.m.displayName}?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn btn-quiet" onClick={() => setConfirm(null)}>
                Hủy
              </button>
              <button
                className={`btn ${confirm.kind === 'kick' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => {
                  quizSocket.send(
                    confirm.kind === 'kick'
                      ? { type: 'KICK_MEMBER', payload: { userId: confirm.m.userId } }
                      : { type: 'TRANSFER_HOST', payload: { userId: confirm.m.userId } },
                  );
                  setConfirm(null);
                }}
              >
                {confirm.kind === 'kick' ? 'Mời ra' : 'Trao quyền'}
              </button>
            </>
          }
        >
          <p>{confirm.kind === 'kick' ? 'Người bị mời ra sẽ không vào lại được phòng này.' : 'Bạn vẫn ở lại phòng như một người chơi bình thường.'}</p>
        </Modal>
      )}
    </>
  );
}

function RoomConfigPanel({ room, editable }: { room: Room; editable: boolean }) {
  const quizTitle = useLive((s) => s.roomQuizTitle);
  const quizCount = useLive((s) => s.roomQuizCount);
  const { data: sets } = useQuery({ queryKey: ['quiz-sets', 'selectable'], queryFn: quizSetApi.selectable, enabled: editable });
  const [timeSec, setTimeSec] = useState(String(room.questionTimeMs / 1000));
  const [maxP, setMaxP] = useState(String(room.maxPlayers));
  useEffect(() => setTimeSec(String(room.questionTimeMs / 1000)), [room.questionTimeMs]);
  useEffect(() => setMaxP(String(room.maxPlayers)), [room.maxPlayers]);

  const update = (cfg: Partial<RoomConfig>) => quizSocket.send({ type: 'UPDATE_ROOM_CONFIG', payload: cfg });

  return (
    <div className="config">
      <label className="field">
        <span className="field-label">Bộ đề</span>
        {editable ? (
          <select name="quiz-set" value={room.quizSetId ?? ''} onChange={(e) => update({ quizSetId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Chọn bộ đề…</option>
            {sets?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} · {s.questionCount} câu {s.visibility === 'PRIVATE' ? '(riêng tư)' : `· ${s.ownerName}`}
              </option>
            ))}
          </select>
        ) : (
          <div className="readonly">{quizTitle ? `${quizTitle} · ${quizCount} câu` : 'Chưa chọn'}</div>
        )}
      </label>

      <fieldset className="field">
        <legend className="field-label">Chế độ</legend>
        <div className="segmented" role="radiogroup" aria-label="Chế độ chơi">
          {(['SELF_PACED', 'LIVE'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={room.mode === m} disabled={!editable} className={room.mode === m ? 'active' : ''} onClick={() => update({ mode: m })}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <span className="field-hint">
          {room.mode === 'SELF_PACED'
            ? 'Mỗi người một câu và một đồng hồ riêng; trả lời xong nhận ngay câu kế tiếp.'
            : 'Cả phòng cùng câu, cùng thời hạn; xem đáp án và xếp hạng 5 giây sau mỗi câu.'}
        </span>
      </fieldset>

      <div className="grid-2">
        <label className="field">
          <span className="field-label">Giây mỗi câu</span>
          <input
            type="number"
            inputMode="numeric"
            name="question-time"
            min={5}
            max={300}
            disabled={!editable}
            value={timeSec}
            onChange={(e) => setTimeSec(e.target.value)}
            onBlur={() => Number(timeSec) * 1000 !== room.questionTimeMs && update({ questionTimeMs: Number(timeSec) * 1000 })}
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span className="field-label">Số người tối đa</span>
          <input
            type="number"
            inputMode="numeric"
            name="max-players"
            min={2}
            max={100}
            disabled={!editable}
            value={maxP}
            onChange={(e) => setMaxP(e.target.value)}
            onBlur={() => Number(maxP) !== room.maxPlayers && update({ maxPlayers: Number(maxP) })}
            autoComplete="off"
          />
        </label>
      </div>
      <span className="field-hint">Câu có thời gian riêng trong bộ đề sẽ dùng thời gian đó.</span>

      <div className="toggles">
        <Toggle
          disabled={!editable || room.mode === 'LIVE'}
          checked={room.shuffleQuestions && room.mode === 'SELF_PACED'}
          onChange={(v) => update({ shuffleQuestions: v })}
          label="Xáo thứ tự câu hỏi"
          hint="Chỉ áp dụng cho tiến độ riêng."
        />
        <Toggle disabled={!editable} checked={room.shuffleChoices} onChange={(v) => update({ shuffleChoices: v })} label="Xáo thứ tự lựa chọn" />
        <Toggle disabled={!editable} checked={room.streakBonus} onChange={(v) => update({ streakBonus: v })} label="Thưởng chuỗi đúng" hint="+10 từ câu đúng thứ 2 liên tiếp, tối đa +50." />
      </div>
    </div>
  );
}

function StartBar({ room, isHost }: { room: Room; isHost: boolean }) {
  const quizCount = useLive((s) => s.roomQuizCount);
  if (room.status !== 'WAITING') return null;
  const reason = !room.quizSetId ? 'Chọn bộ đề để bắt đầu.' : quizCount === 0 ? 'Bộ đề chưa có câu hỏi.' : null;
  if (!isHost)
    return (
      <div className="start-bar">
        <span className="spinner" aria-hidden="true" />
        <span className="muted">Đang chờ chủ phòng bắt đầu…</span>
      </div>
    );
  return (
    <div className="start-bar">
      {reason && <span className="muted small">{reason}</span>}
      <button className="btn btn-primary btn-lg" disabled={!!reason} onClick={() => quizSocket.send({ type: 'START_GAME' })}>
        Bắt đầu trận <Icon name="arrowRight" />
      </button>
    </div>
  );
}

function Chat({ meId, disabled }: { meId: number; disabled: boolean }) {
  const messages = useLive((s) => s.messages);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    quizSocket.send({ type: 'SEND_CHAT', payload: { content: text } });
    setText('');
  };
  return (
    <div className="chat">
      <div className="chat-list" ref={listRef} role="log" aria-live="polite" aria-label="Tin nhắn trong phòng">
        {messages.length === 0 && <div className="muted small chat-empty">Chưa có tin nhắn.</div>}
        {messages.map((m, i) => {
          if (m.userId === 0)
            return (
              <div key={m.id} className="chat-system">
                {m.content}
              </div>
            );
          const grouped = i > 0 && messages[i - 1].userId === m.userId;
          return (
            <div key={m.id} className={`chat-msg ${m.userId === meId ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}>
              {!grouped && (
                <div className="chat-meta">
                  <span className="chat-author">{m.userId === meId ? 'Bạn' : m.displayName}</span>
                  <time className="chat-time" dateTime={m.sentAt}>
                    {fmtTime(m.sentAt)}
                  </time>
                </div>
              )}
              <div className="chat-text">{m.content}</div>
            </div>
          );
        })}
      </div>
      <form className="chat-form" onSubmit={send}>
        <label className="sr-only" htmlFor="chat-input">
          Tin nhắn
        </label>
        <input
          id="chat-input"
          name="chat"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 300))}
          placeholder={disabled ? 'Chat tạm khóa khi đang chơi' : 'Nhắn cho cả phòng…'}
          disabled={disabled}
          maxLength={300}
          autoComplete="off"
        />
        <button className="btn btn-primary" disabled={disabled}>
          Gửi
        </button>
      </form>
      <div className="chat-count num" aria-hidden="true">
        {text.length}/300
      </div>
    </div>
  );
}

export default function RoomPage() {
  return mockEnabled ? <MockRoomPage /> : <WaitingRoom />;
}
