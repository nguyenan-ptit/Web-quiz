import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { gameApi } from '../mock/api';
import { fmtDateTime, fmtDuration, GAME_STATUS_LABEL, MODE_LABEL, QTYPE_LABEL, ROUND_LABEL } from '../lib/format';
import { useAuth } from '../store/auth';
import { useLive } from '../store/live';
import type { Game, GamePlayer } from '../types';
import { Avatar, Badge, ErrorBox, PageHeader, Spinner, Tabs, useUrlState } from '../components/ui';
import { Icon } from '../components/icons';

const TABS = ['rank', 'review'] as const;

export default function ResultPage() {
  const { id = '' } = useParams();
  const me = useAuth((s) => s.user)!;
  const room = useLive((s) => s.room);
  const { data: game, error, isLoading } = useQuery({ queryKey: ['game', id], queryFn: () => gameApi.get(id) });
  const [tab, setTab] = useUrlState('tab', 'rank', TABS);

  if (isLoading) return <Spinner />;
  if (error || !game)
    return (
      <div className="page">
        <ErrorBox error={error} />
      </div>
    );

  const players = game.players.slice().sort((a, b) => (a.finalRank ?? 999) - (b.finalRank ?? 999));
  const mine = game.players.find((p) => p.userId === me.id);
  const backToRoom = room && room.roomCode === game.roomCode;

  return (
    <div className="page">
      <PageHeader
        kicker={
          <>
            Kết quả · phòng <span translate="no">{game.roomCode}</span> · {MODE_LABEL[game.mode]} · {fmtDateTime(game.startedAt)} ·{' '}
            {fmtDuration(game.startedAt, game.endedAt)}
          </>
        }
        title={game.quizTitleSnapshot}
        actions={
          <>
            {!me.isGuest && (
              <Link className="btn btn-quiet" to="/history">
                Lịch sử
              </Link>
            )}
            {backToRoom ? (
              <Link className="btn btn-primary" to={`/rooms/${room.roomCode}`}>
                Về phòng chờ để chơi lại
              </Link>
            ) : (
              <Link className="btn btn-primary" to="/lobby">
                Về sảnh
              </Link>
            )}
          </>
        }
      />
      {game.status !== 'FINISHED' && (
        <div className="callout callout-warn">
          {GAME_STATUS_LABEL[game.status]}
          {game.cancelReason ? ` · ${game.cancelReason}` : ''}
        </div>
      )}

      {mine && (
        <dl className="figures">
          <div>
            <dt>Hạng</dt>
            <dd className="num">
              {mine.finalRank ?? '—'}
              <small>/{game.players.length}</small>
            </dd>
          </div>
          <div>
            <dt>Tổng điểm</dt>
            <dd className="num">{mine.totalScore}</dd>
          </div>
          <div>
            <dt>Câu đúng</dt>
            <dd className="num">
              {mine.correctCount}
              <small>/{game.questions.length}</small>
            </dd>
          </div>
          <div>
            <dt>Chuỗi dài nhất</dt>
            <dd className="num">{mine.bestStreak}</dd>
          </div>
        </dl>
      )}

      <Tabs
        label="Xem kết quả"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'rank', label: 'Bảng tổng kết' },
          { value: 'review', label: 'Xem lại từng câu' },
        ]}
      />

      {tab === 'rank' ? <Standings players={players} game={game} meId={me.id} /> : <Review game={game} player={mine ?? players[0]} />}
    </div>
  );
}

function Standings({ players, game, meId }: { players: GamePlayer[]; game: Game; meId: number }) {
  const max = Math.max(1, ...players.map((p) => p.totalScore));
  return (
    <div className="panel panel-flush">
      <ol className="final-list">
        {players.map((p) => (
          <li key={p.id} className={`final-row ${p.userId === meId ? 'is-me' : ''} ${p.finalRank != null && p.finalRank <= 3 ? `top top-${p.finalRank}` : ''}`}>
            <span className="final-rank num">{p.finalRank ?? '—'}</span>
            <Avatar name={p.displayName} id={p.userId} size={34} />
            <div className="final-main">
              <div className="final-name">
                {p.displayName}
                {p.userId === meId && <span className="muted"> (bạn)</span>}
                {p.status === 'LEFT' && <Badge tone="plain">đã rời</Badge>}
              </div>
              <div className="final-bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${p.totalScore / max})` }} />
              </div>
              <div className="final-sub num">
                {p.correctCount}/{game.questions.length} câu đúng · chuỗi {p.bestStreak}
              </div>
            </div>
            <span className="final-score num">{p.totalScore}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Review({ game, player }: { game: Game; player: GamePlayer }) {
  const [who, setWho] = useState(player.id);
  const target = game.players.find((p) => p.id === who) ?? player;
  const rows = useMemo(
    () =>
      game.questions
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((q) => ({ q, r: game.rounds.find((x) => x.gameQuestionId === q.id && x.gamePlayerId === target.id) })),
    [game, target.id],
  );
  return (
    <div className="stack">
      <label className="inline-field">
        <span className="field-label">Bài làm của</span>
        <select name="review-player" value={who} onChange={(e) => setWho(Number(e.target.value))}>
          {game.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </label>
      {rows.map(({ q, r }, i) => {
        const status = r?.status ?? 'CANCELLED';
        const took = r?.answeredAt ? (Date.parse(r.answeredAt) - Date.parse(r.startedAt)) / 1000 : null;
        return (
          <article key={q.id} className={`review review-${status}`}>
            <header className="review-head">
              <span className="review-num num">Câu {String(i + 1).padStart(2, '0')}</span>
              <span className="muted">{QTYPE_LABEL[q.type]}</span>
              <span className={`review-status st-${status}`}>{ROUND_LABEL[status]}</span>
              <span className="review-score num">
                {took != null && <span className="muted">{took.toFixed(1)}/{q.timeLimitMs / 1000} giây · </span>}+{r?.score ?? 0}
                {r?.bonus ? ` (+${r.bonus})` : ''}
              </span>
            </header>
            <h3 className="review-q">{q.content}</h3>
            <ul className="review-choices">
              {q.choices.map((c) => {
                const picked = r?.choiceIds.includes(c.id);
                return (
                  <li key={c.id} className={`${c.isCorrect ? 'correct' : ''} ${picked && !c.isCorrect ? 'wrong' : ''}`}>
                    <span className="rc-mark" aria-hidden="true">
                      {c.isCorrect ? <Icon name="check" size={14} /> : picked ? <Icon name="x" size={14} /> : null}
                    </span>
                    <span className="rc-text">{c.content}</span>
                    {picked && <span className="rc-you">đã chọn</span>}
                    {c.isCorrect && <span className="sr-only">(đáp án đúng)</span>}
                  </li>
                );
              })}
            </ul>
            {q.explanation && (
              <p className="review-explain">
                <Icon name="bulb" /> {q.explanation}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
