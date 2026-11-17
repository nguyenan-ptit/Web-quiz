import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { gameApi } from '../mock/api';
import { fmtDateTime, fmtDuration, GAME_STATUS_LABEL, MODE_LABEL } from '../lib/format';
import { Empty, ErrorBox, PageHeader, Spinner, Tabs, useUrlState } from '../components/ui';

const ROLES = ['player', 'host'] as const;

export default function HistoryPage() {
  const [role, setRole] = useUrlState('role', 'player', ROLES);
  const { data, error, isLoading } = useQuery({ queryKey: ['games', role], queryFn: () => gameApi.list(role) });

  return (
    <div className="page">
      <PageHeader kicker="Lịch sử" title="Các trận đã qua" sub="Trận bạn đã chơi và trận bạn đã tổ chức." />
      <Tabs
        label="Vai trò"
        value={role}
        onChange={setRole}
        items={[
          { value: 'player', label: 'Đã chơi' },
          { value: 'host', label: 'Đã tổ chức' },
        ]}
      />
      <ErrorBox error={error} />
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty
          title="Chưa có trận nào"
          action={
            <Link className="btn" to="/lobby">
              Vào sảnh
            </Link>
          }
        />
      ) : (
        <div className="panel panel-flush table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Thời gian</th>
                <th scope="col">Bộ đề</th>
                <th scope="col">Phòng</th>
                <th scope="col">Chế độ</th>
                <th scope="col" className="num">
                  Người chơi
                </th>
                {role === 'player' ? (
                  <>
                    <th scope="col" className="num">
                      Hạng
                    </th>
                    <th scope="col" className="num">
                      Điểm
                    </th>
                  </>
                ) : (
                  <th scope="col">Trạng thái</th>
                )}
                <th scope="col">
                  <span className="sr-only">Thao tác</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((g) => (
                <tr key={g.id}>
                  <td className="nowrap">
                    <span className="num">{fmtDateTime(g.startedAt)}</span>
                    <div className="muted small">{fmtDuration(g.startedAt, g.endedAt)}</div>
                  </td>
                  <td className="strong">{g.quizTitle}</td>
                  <td>
                    <span className="mono" translate="no">
                      {g.roomCode}
                    </span>
                    <div className="muted small">{g.roomTitle}</div>
                  </td>
                  <td>
                    <span className={`mode-tag mode-${g.mode}`}>{MODE_LABEL[g.mode]}</span>
                  </td>
                  <td className="num">{g.playerCount}</td>
                  {role === 'player' ? (
                    <>
                      <td className="num">{g.myRank ?? '—'}</td>
                      <td className="num strong">{g.myScore}</td>
                    </>
                  ) : (
                    <td className={g.status === 'FINISHED' ? '' : 'text-bad'}>{GAME_STATUS_LABEL[g.status]}</td>
                  )}
                  <td className="cell-action">
                    <Link to={`/games/${g.id}/result`} className="btn btn-sm btn-quiet" aria-label={`Xem kết quả trận ${g.quizTitle} lúc ${fmtDateTime(g.startedAt)}`}>
                      Xem
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
