import { useQuery } from '@tanstack/react-query';
import { statsApi } from '../mock/api';
import { pct } from '../lib/format';
import { useAuth } from '../store/auth';
import { Avatar, Empty, ErrorBox, PageHeader, Spinner } from '../components/ui';

export default function LeaderboardPage() {
  const me = useAuth((s) => s.user)!;
  const { data, error, isLoading } = useQuery({ queryKey: ['leaderboard'], queryFn: statsApi.leaderboard });
  return (
    <div className="page">
      <PageHeader kicker="Xếp hạng" title="Bảng xếp hạng toàn hệ thống" sub="Tính trên tổng điểm các trận đã kết thúc. Tài khoản khách không được xếp hạng." />
      <ErrorBox error={error} />
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty title="Chưa có dữ liệu" />
      ) : (
        <div className="panel panel-flush table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col" className="num">
                  Hạng
                </th>
                <th scope="col">Người chơi</th>
                <th scope="col" className="num">
                  Số trận
                </th>
                <th scope="col" className="num">
                  Hạng nhất
                </th>
                <th scope="col" className="num">
                  Tỷ lệ đúng
                </th>
                <th scope="col" className="num">
                  Tổng điểm
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((e, i) => (
                <tr key={e.userId} className={e.userId === me.id ? 'row-me' : ''}>
                  <td className={`num rank-cell ${i < 3 ? 'rank-top' : ''}`}>{i + 1}</td>
                  <td>
                    <div className="row gap-8">
                      <Avatar name={e.displayName} id={e.userId} size={26} />
                      <span>
                        {e.displayName}
                        {e.userId === me.id && <span className="muted"> (bạn)</span>}
                      </span>
                    </div>
                  </td>
                  <td className="num">{e.gamesPlayed}</td>
                  <td className="num">{e.wins}</td>
                  <td className="num">{pct(e.correctRate)}</td>
                  <td className="num strong">{e.totalScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
