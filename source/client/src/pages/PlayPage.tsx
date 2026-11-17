import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { quizSocket } from '../lib/socket';
import { MODE_LABEL, PLAYER_STATUS_LABEL, QTYPE_LABEL } from '../lib/format';
import { useAuth } from '../store/auth';
import { serverNow, useLive, type GameView } from '../store/live';
import type { LeaderboardEntry, QuestionView } from '../types';
import { Avatar, Empty, Kbd, Modal, useNow } from '../components/ui';
import { Icon } from '../components/icons';

const pad2 = (n: number) => String(n).padStart(2, '0');

export default function PlayPage() {
  const game = useLive((s) => s.game);
  const room = useLive((s) => s.room);
  const status = useLive((s) => s.status);
  const me = useAuth((s) => s.user)!;
  const navigate = useNavigate();
  const [confirmLeave, setConfirmLeave] = useState(false);

  if (!game) {
    return (
      <div className="page narrow">
        <Empty
          title="Bạn không ở trong trận nào"
          action={
            room ? (
              <Link className="btn" to={`/rooms/${room.roomCode}`}>
                Về phòng {room.roomCode}
              </Link>
            ) : (
              <Link className="btn" to="/lobby">
                Về sảnh
              </Link>
            )
          }
        />
      </div>
    );
  }

  const leave = () => {
    quizSocket.leaveRoom();
    navigate('/lobby');
  };

  return (
    <div className="page play-page">
      <header className="play-head">
        <div className="page-head-text">
          <div className="kicker">
            <span translate="no">{room?.roomCode}</span> · {MODE_LABEL[game.mode]} · {game.questionCount} câu
          </div>
          <h1 className="play-title">{game.quizTitle}</h1>
        </div>
        <div className="play-head-right">
          <div className="scoreboard" aria-live="polite">
            <span className="scoreboard-label">Điểm</span>
            <span className="scoreboard-value num">{game.totalScore}</span>
          </div>
          <button className="btn btn-quiet" onClick={() => setConfirmLeave(true)}>
            Rời trận
          </button>
        </div>
      </header>

      <Progress game={game} />

      <div className="play-grid">
        <section className="play-main" aria-label="Câu hỏi">
          {status === 'RECONNECTING' && (
            <div className="reconnect-overlay" role="alert">
              <Icon name="wifiOff" size={28} />
              <h2>Mất kết nối</h2>
              <p>Đang kết nối lại… Đồng hồ của câu hiện tại vẫn chạy trên server. Bạn có 30 giây để quay lại trước khi bị tính là rời trận.</p>
            </div>
          )}
          <Stage game={game} />
        </section>
        <aside className="panel play-side" aria-labelledby="lb-h">
          <div className="panel-head">
            <h2 id="lb-h" className="panel-title">
              Bảng xếp hạng
            </h2>
            <span className="live-tag">trực tiếp</span>
          </div>
          <Leaderboard entries={game.leaderboard} meId={me.id} total={game.questionCount} />
        </aside>
      </div>

      {confirmLeave && (
        <Modal
          title="Rời trận?"
          onClose={() => setConfirmLeave(false)}
          footer={
            <>
              <button className="btn btn-quiet" onClick={() => setConfirmLeave(false)}>
                Ở lại
              </button>
              <button className="btn btn-danger" onClick={leave}>
                Rời trận
              </button>
            </>
          }
        >
          <p>Bạn sẽ bị đánh dấu rời trận và không quay lại được. Điểm đã đạt vẫn được tính hạng.</p>
        </Modal>
      )}
    </div>
  );
}

function Stage({ game }: { game: GameView }) {
  useNow(100);
  if (game.startsAt && !game.question) {
    const left = Math.max(0, Math.ceil((game.startsAt - serverNow()) / 1000));
    return (
      <div className="stage">
        <div className="kicker">Trận bắt đầu sau</div>
        <div className="countdown num" key={left} aria-live="assertive">
          {left || 'Bắt đầu'}
        </div>
        <div className="muted">
          {game.questionCount} câu · {MODE_LABEL[game.mode]}
        </div>
      </div>
    );
  }
  if (game.finishedSelf) {
    const mine = game.leaderboard.find((e) => e.userId === useAuth.getState().user?.id);
    const waiting = game.leaderboard.filter((e) => e.status === 'PLAYING' || e.status === 'DISCONNECTED').length;
    return (
      <div className="stage">
        <div className="kicker">Bạn đã hoàn thành</div>
        <div className="stage-score num">{game.totalScore}</div>
        <div className="muted">điểm{mine ? ` · hạng tạm thời ${mine.rank}` : ''}</div>
        <p className="stage-wait">
          <span className="spinner" aria-hidden="true" /> Chờ {waiting} người chơi khác hoàn thành…
        </p>
      </div>
    );
  }
  if (!game.question) {
    return (
      <div className="stage">
        <span className="spinner spinner-lg" aria-hidden="true" />
        <p className="muted">Đang chờ câu hỏi…</p>
      </div>
    );
  }
  return <QuestionSheet game={game} q={game.question} />;
}

function QuestionSheet({ game, q }: { game: GameView; q: QuestionView }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [forRound, setForRound] = useState(q.roundId);
  if (forRound !== q.roundId) {
    setForRound(q.roundId);
    setSelected([]);
  }
  const remaining = Math.max(0, q.deadlineAt - serverNow());
  const ratio = remaining / q.timeLimitMs;
  const answer = game.answer?.roundId === q.roundId ? game.answer : null;
  const live = game.liveResult && game.liveResult.roundId === q.roundId ? game.liveResult : null;
  const locked = !!answer || remaining <= 0 || !!live;

  // Đồng hồ dừng khi lượt đã chốt (đã trả lời / câu đã đóng)
  const closed = (!!answer && !answer.pending) || !!live;
  const [frozen, setFrozen] = useState<{ round: string; ratio: number; ms: number } | null>(null);
  if (closed && frozen?.round !== q.roundId) setFrozen({ round: q.roundId, ratio, ms: remaining });
  const shownRatio = closed && frozen?.round === q.roundId ? frozen.ratio : ratio;
  const shownMs = closed && frozen?.round === q.roundId ? frozen.ms : remaining;

  const submit = (ids: number[]) => {
    if (locked || ids.length === 0) return;
    useLive.setState((s) => ({
      game: s.game && { ...s.game, answer: { roundId: q.roundId, choiceIds: ids, pending: true, result: null, score: 0, bonus: 0, streak: 0 } },
    }));
    quizSocket.send({ type: 'SUBMIT_ANSWER', payload: { roundId: q.roundId, choiceIds: ids } });
  };

  const onChoice = (id: number) => {
    if (locked) return;
    if (q.type === 'MULTIPLE') setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    else submit([id]);
  };

  // Phím tắt: 1–6 chọn đáp án, Enter gửi (câu nhiều đáp án)
  const handlers = useRef({ onChoice, submit, selected });
  handlers.current = { onChoice, submit, selected };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [role="dialog"]')) return;
      const n = Number(e.key);
      if (n >= 1 && n <= q.choices.length) {
        e.preventDefault();
        handlers.current.onChoice(q.choices[n - 1].id);
      } else if (e.key === 'Enter' && q.type === 'MULTIPLE') {
        e.preventDefault();
        handlers.current.submit(handlers.current.selected);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q]);

  const picked = answer?.choiceIds.length ? answer.choiceIds : selected;
  const totalVotes = live ? Object.values(live.counts).reduce((a, b) => a + b, 0) : 0;
  const urgency = closed ? 'closed' : ratio < 0.25 ? 'danger' : ratio < 0.5 ? 'warn' : '';

  return (
    <article className="sheet">
      <div className="sheet-top">
        <div className="sheet-meta">
          <span className="sheet-num num">
            Câu {pad2(q.index + 1)}
            <span className="muted">/{pad2(q.total)}</span>
          </span>
          <span>{QTYPE_LABEL[q.type]}</span>
          <span className="num">{q.points} điểm</span>
        </div>
        <div className={`clock ${urgency}`} aria-label={closed ? 'Lượt đã chốt' : `Còn ${Math.ceil(remaining / 1000)} giây`}>
          {closed ? (live ? 'đã đóng' : 'đã chốt') : null}
          <span className="clock-value num">{(shownMs / 1000).toFixed(1)}</span>
          <span className="clock-unit">giây</span>
        </div>
      </div>
      <div className="timebar" aria-hidden="true">
        <span className={urgency} style={{ transform: `scaleX(${shownRatio})` }} />
      </div>

      <h2 className="sheet-question">{q.content}</h2>
      {q.type === 'MULTIPLE' && !locked && (
        <p className="sheet-hint">
          Chọn tất cả đáp án đúng rồi bấm Gửi (hoặc <Kbd>Enter</Kbd>). Chỉ được điểm khi khớp hoàn toàn.
        </p>
      )}

      <ol className="answers" role="list">
        {q.choices.map((c, i) => {
          const isPicked = picked.includes(c.id);
          const isCorrect = live?.correctChoiceIds.includes(c.id);
          const count = live?.counts[c.id] ?? 0;
          let cls = 'answer';
          if (isPicked) cls += ' picked';
          if (live) cls += isCorrect ? ' correct' : isPicked ? ' wrong' : ' dim';
          return (
            <li key={c.id}>
              <button
                className={cls}
                onClick={() => onChoice(c.id)}
                disabled={locked}
                aria-pressed={q.type === 'MULTIPLE' ? isPicked : undefined}
                aria-keyshortcuts={String(i + 1)}
              >
                {live && <span className="answer-fill" style={{ transform: `scaleX(${totalVotes ? count / totalVotes : 0})` }} aria-hidden="true" />}
                <span className="answer-key num" aria-hidden="true">
                  {q.type === 'MULTIPLE' && isPicked ? <Icon name="check" size={14} /> : i + 1}
                </span>
                <span className="answer-text">{c.content}</span>
                {live && (
                  <span className="answer-count num">
                    {isCorrect && <Icon name="check" size={14} />} {count} người
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {q.type === 'MULTIPLE' && !locked && (
        <div className="sheet-actions">
          <button className="btn btn-primary btn-lg" onClick={() => submit(selected)} disabled={selected.length === 0}>
            Gửi đáp án{selected.length ? ` (${selected.length})` : ''}
          </button>
        </div>
      )}

      <Feedback game={game} q={q} remaining={remaining} />
    </article>
  );
}

function Feedback({ game, q, remaining }: { game: GameView; q: QuestionView; remaining: number }) {
  const answer = game.answer?.roundId === q.roundId ? game.answer : null;
  const live = game.liveResult && game.liveResult.roundId === q.roundId ? game.liveResult : null;
  useNow(250);

  if (live) {
    const r = live.yourResult;
    const next = live.nextAt ? Math.max(0, Math.ceil((live.nextAt - serverNow()) / 1000)) : null;
    return (
      <div className={`verdict ${r === 'CORRECT' ? 'good' : 'bad'}`} role="status">
        <div className="verdict-head">
          <span className="verdict-title">{r === 'CORRECT' ? 'Chính xác' : r === 'WRONG' ? 'Chưa đúng' : 'Hết giờ'}</span>
          {r === 'CORRECT' && <span className="verdict-score num">+{live.yourScore}</span>}
          {live.yourBonus > 0 && <span className="verdict-bonus num">+{live.yourBonus} thưởng chuỗi</span>}
          <span className="verdict-aside num">
            {live.answeredCount}/{live.playerCount} người đã trả lời
          </span>
        </div>
        {live.explanation && (
          <p className="verdict-explain">
            <Icon name="bulb" /> {live.explanation}
          </p>
        )}
        <div className="verdict-next">{next != null ? `Câu tiếp theo sau ${next} giây…` : 'Đang tổng kết trận…'}</div>
      </div>
    );
  }
  if (!answer) {
    if (remaining <= 0)
      return (
        <div className="verdict bad" role="status">
          <span className="verdict-title">Hết giờ</span>
        </div>
      );
    return null;
  }
  if (answer.pending)
    return (
      <div className="verdict pending" role="status">
        <span className="spinner" aria-hidden="true" /> Đang gửi đáp án…
      </div>
    );
  if (game.mode === 'LIVE')
    return (
      <div className="verdict pending" role="status">
        <span className="spinner" aria-hidden="true" /> Đã ghi nhận. Chờ mọi người trả lời hoặc hết giờ…
      </div>
    );
  return (
    <div className={`verdict ${answer.result === 'CORRECT' ? 'good' : 'bad'}`} role="status">
      <div className="verdict-head">
        <span className="verdict-title">{answer.result === 'CORRECT' ? 'Chính xác' : answer.result === 'WRONG' ? 'Chưa đúng' : 'Hết giờ'}</span>
        {answer.result === 'CORRECT' && <span className="verdict-score num">+{answer.score}</span>}
        {answer.bonus > 0 && (
          <span className="verdict-bonus num">
            <Icon name="flame" size={14} /> +{answer.bonus} · chuỗi {answer.streak}
          </span>
        )}
      </div>
      <div className="verdict-next">Đang chuyển sang câu tiếp theo…</div>
    </div>
  );
}

function Progress({ game }: { game: GameView }) {
  const cur = game.question?.index ?? -1;
  const done = game.history.length;
  return (
    <div className="progress" role="progressbar" aria-label="Tiến độ" aria-valuemin={0} aria-valuemax={game.questionCount} aria-valuenow={done}>
      {Array.from({ length: game.questionCount }).map((_, i) => {
        const h = game.history.find((x) => x.index === i);
        const cls = h ? (h.result === 'CORRECT' ? 'good' : 'bad') : i === cur ? 'cur' : '';
        return <span key={i} className={`progress-cell ${cls}`} />;
      })}
    </div>
  );
}

export function Leaderboard({ entries, meId, total }: { entries: LeaderboardEntry[]; meId: number; total: number }) {
  if (!entries.length) return <p className="muted small">Chưa có dữ liệu.</p>;
  return (
    <ol className="standings">
      {entries.map((e) => (
        <li key={e.userId} className={`standing ${e.userId === meId ? 'is-me' : ''} ${e.status === 'LEFT' ? 'is-left' : ''}`}>
          <span className="standing-rank num">{e.rank}</span>
          <Avatar name={e.displayName} id={e.userId} size={26} />
          <div className="standing-main">
            <div className="standing-name truncate">{e.displayName}</div>
            <div className="standing-sub num">
              {e.answeredCount}/{total} câu · {e.correctCount} đúng
              {e.status !== 'PLAYING' && <span className={`st st-${e.status}`}> · {PLAYER_STATUS_LABEL[e.status].toLowerCase()}</span>}
            </div>
          </div>
          <span className="standing-score num">{e.totalScore}</span>
        </li>
      ))}
    </ol>
  );
}
