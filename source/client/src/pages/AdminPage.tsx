import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../mock/api';
import { fmtDateTime } from '../lib/format';
import { notify } from '../store/live';
import type { QuizSetSummary, User } from '../types';
import { Avatar, ErrorBox, Modal, PageHeader, Spinner, Tabs, useUrlState } from '../components/ui';

const TABS = ['users', 'sets'] as const;

export default function AdminPage() {
  const [tab, setTab] = useUrlState('tab', 'users', TABS);
  return (
    <div className="page">
      <PageHeader kicker="Quản trị" title="Kiểm duyệt" sub="Khóa tài khoản và gỡ bộ đề công khai vi phạm. Quản trị viên không điều khiển phòng của người khác." />
      <Tabs
        label="Mục quản trị"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'users', label: 'Tài khoản' },
          { value: 'sets', label: 'Bộ đề công khai' },
        ]}
      />
      {tab === 'users' ? <Users /> : <Sets />}
    </div>
  );
}

function Users() {
  const qc = useQueryClient();
  const [target, setTarget] = useState<User | null>(null);
  const { data, error, isLoading } = useQuery({ queryKey: ['admin', 'users'], queryFn: adminApi.users });
  const toggle = useMutation({
    mutationFn: (u: User) => adminApi.setUserStatus(u.id, u.status === 'LOCKED' ? 'ACTIVE' : 'LOCKED'),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      notify(`${u.displayName}: ${u.status === 'LOCKED' ? 'đã khóa' : 'đã mở khóa'}`, 'success');
      setTarget(null);
    },
    onError: (e) => notify((e as Error).message, 'error'),
  });
  if (isLoading) return <Spinner />;
  return (
    <>
      <ErrorBox error={error} />
      <div className="panel panel-flush table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Tài khoản</th>
              <th scope="col">Email</th>
              <th scope="col">Vai trò</th>
              <th scope="col">Ngày tạo</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">
                <span className="sr-only">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="row gap-8">
                    <Avatar name={u.displayName} id={u.id} size={26} />
                    <div>
                      {u.displayName}
                      <div className="small muted" translate="no">
                        @{u.username}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="truncate-cell">{u.email}</td>
                <td>{u.role === 'ADMIN' ? 'Quản trị' : 'Người dùng'}</td>
                <td className="num nowrap">{fmtDateTime(u.createdAt)}</td>
                <td>
                  <span className={`status-dot ${u.status === 'ACTIVE' ? 'good' : 'bad'}`}>{u.status === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'}</span>
                </td>
                <td className="cell-action">
                  {u.role !== 'ADMIN' && (
                    <button className={`btn btn-sm ${u.status === 'ACTIVE' ? 'btn-danger-quiet' : 'btn-quiet'}`} onClick={() => setTarget(u)}>
                      {u.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {target && (
        <Modal
          title={target.status === 'ACTIVE' ? `Khóa tài khoản ${target.displayName}?` : `Mở khóa ${target.displayName}?`}
          onClose={() => setTarget(null)}
          footer={
            <>
              <button className="btn btn-quiet" onClick={() => setTarget(null)}>
                Hủy
              </button>
              <button className={`btn ${target.status === 'ACTIVE' ? 'btn-danger' : 'btn-primary'}`} disabled={toggle.isPending} onClick={() => toggle.mutate(target)}>
                {target.status === 'ACTIVE' ? 'Khóa tài khoản' : 'Mở khóa'}
              </button>
            </>
          }
        >
          <p>{target.status === 'ACTIVE' ? 'Người này sẽ không đăng nhập được cho tới khi được mở khóa.' : 'Người này sẽ đăng nhập lại được ngay.'}</p>
        </Modal>
      )}
    </>
  );
}

function Sets() {
  const qc = useQueryClient();
  const [target, setTarget] = useState<QuizSetSummary | null>(null);
  const { data, error, isLoading } = useQuery({ queryKey: ['admin', 'sets'], queryFn: adminApi.publicSets });
  const remove = useMutation({
    mutationFn: adminApi.removeQuizSet,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'sets'] });
      qc.invalidateQueries({ queryKey: ['quiz-sets'] });
      notify('Đã gỡ bộ đề', 'success');
      setTarget(null);
    },
  });
  if (isLoading) return <Spinner />;
  return (
    <>
      <ErrorBox error={error} />
      <div className="panel panel-flush table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Bộ đề</th>
              <th scope="col">Chủ sở hữu</th>
              <th scope="col" className="num">
                Câu
              </th>
              <th scope="col" className="num">
                Trận
              </th>
              <th scope="col">Cập nhật</th>
              <th scope="col">
                <span className="sr-only">Thao tác</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data?.map((s) => (
              <tr key={s.id}>
                <td>
                  <span className="strong">{s.title}</span>
                  <div className="small muted clamp-2">{s.description}</div>
                </td>
                <td>{s.ownerName}</td>
                <td className="num">{s.questionCount}</td>
                <td className="num">{s.playCount}</td>
                <td className="num nowrap">{fmtDateTime(s.updatedAt)}</td>
                <td className="cell-action">
                  <button className="btn btn-sm btn-danger-quiet" onClick={() => setTarget(s)}>
                    Gỡ
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {target && (
        <Modal
          title={`Gỡ bộ đề “${target.title}”?`}
          onClose={() => setTarget(null)}
          footer={
            <>
              <button className="btn btn-quiet" onClick={() => setTarget(null)}>
                Hủy
              </button>
              <button className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate(target.id)}>
                {remove.isPending ? 'Đang gỡ…' : 'Gỡ bộ đề'}
              </button>
            </>
          }
        >
          <p>Bộ đề của {target.ownerName} sẽ bị xóa mềm và không còn chọn được trong phòng. Lịch sử trận cũ vẫn giữ nguyên.</p>
        </Modal>
      )}
    </>
  );
}
