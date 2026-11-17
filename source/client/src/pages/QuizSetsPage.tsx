import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { quizSetApi } from '../mock/api';
import { fmtDateTime } from '../lib/format';
import { notify } from '../store/live';
import { useAuth } from '../store/auth';
import type { QuizSetSummary, Visibility } from '../types';
import { Empty, ErrorBox, Modal, PageHeader, Spinner, Tabs, useUrlState } from '../components/ui';
import { Icon } from '../components/icons';

const SCOPES = ['mine', 'public'] as const;

export default function QuizSetsPage() {
  const [scope, setScope] = useUrlState('scope', 'mine', SCOPES);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<QuizSetSummary | null>(null);
  const me = useAuth((s) => s.user)!;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ['quiz-sets', scope], queryFn: () => quizSetApi.list(scope) });

  const copy = useMutation({
    mutationFn: quizSetApi.copy,
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['quiz-sets'] });
      notify(`Đã sao chép thành “${s.title}”`, 'success');
      navigate(`/quiz-sets/${s.id}/edit`);
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  const remove = useMutation({
    mutationFn: quizSetApi.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quiz-sets'] });
      notify('Đã xóa bộ đề', 'success');
      setToDelete(null);
    },
  });

  return (
    <div className="page">
      <PageHeader
        kicker="Bộ đề"
        title="Kho câu hỏi"
        sub="Bộ đề của bạn chỉ bạn sửa được. Bộ đề công khai ai cũng chọn để chơi hoặc sao chép về kho."
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Tạo bộ đề
          </button>
        }
      />

      <Tabs
        label="Phạm vi"
        value={scope}
        onChange={setScope}
        items={[
          { value: 'mine', label: 'Của tôi' },
          { value: 'public', label: 'Thư viện công khai' },
        ]}
      />

      <ErrorBox error={error} />
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <Empty
          title={scope === 'mine' ? 'Bạn chưa có bộ đề nào' : 'Chưa có bộ đề công khai'}
          action={
            scope === 'mine' && (
              <button className="btn" onClick={() => setScope('public')}>
                Xem thư viện công khai
              </button>
            )
          }
        >
          {scope === 'mine' && 'Tạo mới, hoặc sao chép một bộ đề có sẵn rồi chỉnh theo ý bạn.'}
        </Empty>
      ) : (
        <ul className="set-list">
          {data.map((s) => {
            const mine = s.ownerId === me.id;
            return (
              <li key={s.id} className="set-row">
                <div className="set-main">
                  <div className="set-tags">
                    <span className={`vis vis-${s.visibility}`}>{s.visibility === 'PUBLIC' ? 'Công khai' : 'Riêng tư'}</span>
                    {s.copiedFromId && <span className="muted">bản sao</span>}
                    {!mine && <span className="muted">của {s.ownerName}</span>}
                  </div>
                  {mine ? (
                    <Link to={`/quiz-sets/${s.id}/edit`} className="set-title">
                      {s.title}
                    </Link>
                  ) : (
                    <span className="set-title">{s.title}</span>
                  )}
                  <p className="set-desc">{s.description || 'Không có mô tả.'}</p>
                </div>
                <dl className="set-stats">
                  <div>
                    <dt>Câu</dt>
                    <dd className="num">{s.questionCount}</dd>
                  </div>
                  <div>
                    <dt>Trận</dt>
                    <dd className="num">{s.playCount}</dd>
                  </div>
                  <div className="set-updated">
                    <dt>Cập nhật</dt>
                    <dd className="num">{fmtDateTime(s.updatedAt)}</dd>
                  </div>
                </dl>
                <div className="set-actions">
                  {mine ? (
                    <>
                      <Link className="btn btn-sm" to={`/quiz-sets/${s.id}/edit`}>
                        Sửa
                      </Link>
                      <Link className="btn btn-sm btn-quiet" to={`/quiz-sets/${s.id}/stats`}>
                        Thống kê
                      </Link>
                      <button className="btn btn-sm btn-danger-quiet" onClick={() => setToDelete(s)}>
                        Xóa
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-sm" disabled={copy.isPending} onClick={() => copy.mutate(s.id)}>
                      {copy.isPending && copy.variables === s.id ? 'Đang sao chép…' : 'Sao chép về kho'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {creating && <CreateSetModal onClose={() => setCreating(false)} />}
      {toDelete && (
        <Modal
          title={`Xóa “${toDelete.title}”?`}
          onClose={() => setToDelete(null)}
          footer={
            <>
              <button className="btn btn-quiet" onClick={() => setToDelete(null)}>
                Hủy
              </button>
              <button className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate(toDelete.id)}>
                {remove.isPending ? 'Đang xóa…' : 'Xóa bộ đề'}
              </button>
            </>
          }
        >
          <p>Bộ đề bị xóa mềm. Lịch sử các trận đã chơi vẫn giữ nguyên vì trận chạy trên bản chụp của bộ đề.</p>
        </Modal>
      )}
    </div>
  );
}

function CreateSetModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('PRIVATE');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: quizSetApi.create,
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['quiz-sets'] });
      navigate(`/quiz-sets/${s.id}/edit`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ title, description, visibility });
  };
  return (
    <Modal title="Tạo bộ đề" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Tên bộ đề</span>
          <input name="set-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} autoComplete="off" placeholder="VD: Ôn tập chương 3…" autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Mô tả</span>
          <textarea name="set-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>
        <fieldset className="field">
          <legend className="field-label">Hiển thị</legend>
          <div className="segmented" role="radiogroup" aria-label="Hiển thị">
            <button type="button" role="radio" aria-checked={visibility === 'PRIVATE'} className={visibility === 'PRIVATE' ? 'active' : ''} onClick={() => setVisibility('PRIVATE')}>
              Riêng tư
            </button>
            <button type="button" role="radio" aria-checked={visibility === 'PUBLIC'} className={visibility === 'PUBLIC' ? 'active' : ''} onClick={() => setVisibility('PUBLIC')}>
              Công khai
            </button>
          </div>
        </fieldset>
        <ErrorBox error={create.error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Hủy
          </button>
          <button className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Đang tạo…' : 'Tạo và thêm câu hỏi'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
