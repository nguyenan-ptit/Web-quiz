import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { quizSetApi } from '../mock/api';
import { pct, QTYPE_LABEL } from '../lib/format';
import { Empty, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { Icon } from '../components/icons';

export default function QuizStatsPage() {
  const id = Number(useParams().id);
  const { data, error, isLoading } = useQuery({ queryKey: ['quiz-stats', id], queryFn: () => quizSetApi.stats(id) });
  if (isLoading) return <Spinner />;
  if (error || !data)
    return (
      <div className="page">
        <ErrorBox error={error} />
      </div>
    );

  const hardest = data.questions.filter((q) => q.attempts > 0).sort((a, b) => a.correctRate - b.correctRate)[0];

  return (
    <div className="page">
      <Link to={`/quiz-sets/${id}/edit`} className="link-arrow back">
        <Icon name="arrowLeft" /> {data.set.title}
      </Link>
      <PageHeader kicker="Thống kê bộ đề" title={data.set.title} sub="Số liệu gộp từ mọi trận đã chơi bằng bộ đề này." />

      <dl className="figures">
        <div>
          <dt>Trận đã chơi</dt>
          <dd className="num">{data.gameCount}</dd>
        </div>
        <div>
          <dt>Lượt người chơi</dt>
          <dd className="num">{data.playerCount}</dd>
        </div>
        <div>
          <dt>Điểm trung bình</dt>
          <dd className="num">{Math.round(data.avgScore)}</dd>
        </div>
        <div>
          <dt>Câu khó nhất</dt>
          <dd className="num">
            {hardest ? (
              <>
                {String(hardest.position).padStart(2, '0')}
                <small> · {pct(hardest.correctRate)} đúng</small>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
      </dl>

      {data.gameCount === 0 ? (
        <Empty title="Chưa có trận nào dùng bộ đề này">Tạo phòng và chơi thử để có số liệu.</Empty>
      ) : (
        <div className="panel panel-flush table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Câu</th>
                <th scope="col">Nội dung</th>
                <th scope="col" className="num">
                  Lượt
                </th>
                <th scope="col" style={{ width: '26%' }}>
                  Tỷ lệ đúng
                </th>
                <th scope="col" className="num">
                  TG trung bình
                </th>
                <th scope="col" className="num">
                  Hết giờ
                </th>
              </tr>
            </thead>
            <tbody>
              {data.questions.map((q) => (
                <tr key={q.questionId}>
                  <td className="num">{String(q.position).padStart(2, '0')}</td>
                  <td>
                    <div className="clamp-2">{q.content}</div>
                    <div className="muted small">{QTYPE_LABEL[q.type]}</div>
                  </td>
                  <td className="num">{q.attempts}</td>
                  <td>
                    {q.attempts ? (
                      <div className="rate">
                        <div className="meter" aria-hidden="true">
                          <span style={{ transform: `scaleX(${q.correctRate})` }} className={q.correctRate < 0.4 ? 'bad' : q.correctRate < 0.7 ? 'mid' : 'good'} />
                        </div>
                        <span className="num small">{pct(q.correctRate)}</span>
                      </div>
                    ) : (
                      <span className="muted small">Chưa có lượt (câu thêm sau)</span>
                    )}
                  </td>
                  <td className="num">{q.avgTimeMs ? `${(q.avgTimeMs / 1000).toFixed(1)} giây` : '—'}</td>
                  <td className="num">{q.timeoutCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
