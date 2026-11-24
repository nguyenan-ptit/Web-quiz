import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { userApi } from '../mock/api';
import { fmtDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import { notify } from '../store/live';
import { Avatar, ErrorBox } from '../components/ui';

export default function ProfilePage() {
  const user = useAuth((s) => s.user)!;
  const setUser = useAuth((s) => s.setUser);
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? '');
  const [pw, setPw] = useState({ oldPassword: '', newPassword: '', confirm: '' });

  const save = useMutation({
    mutationFn: () => userApi.updateMe({ displayName, email }),
    onSuccess: (u) => {
      setUser(u);
      notify('Đã lưu hồ sơ', 'success');
    },
  });
  const change = useMutation({
    mutationFn: () => {
      if (pw.newPassword !== pw.confirm) return Promise.reject(new Error('Mật khẩu nhập lại chưa khớp. Hãy gõ lại mật khẩu mới.'));
      return userApi.changePassword(pw);
    },
    onSuccess: () => {
      setPw({ oldPassword: '', newPassword: '', confirm: '' });
      notify('Đã đổi mật khẩu', 'success');
    },
  });

  return (
    <div className="page narrow">
      <header className="profile-head">
        <Avatar name={user.displayName} id={user.id} size={64} />
        <div>
          <div className="kicker">Hồ sơ</div>
          <h1>{user.displayName}</h1>
          <div className="muted">
            <span translate="no">@{user.username}</span> · {user.role === 'ADMIN' ? 'quản trị viên' : 'người dùng'} · tham gia {fmtDateTime(user.createdAt)}
          </div>
        </div>
      </header>

      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        aria-labelledby="profile-h"
      >
        <h2 id="profile-h" className="panel-title">
          Thông tin
        </h2>
        <label className="field">
          <span className="field-label">Tên hiển thị</span>
          <input name="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={30} required autoComplete="nickname" />
        </label>
        <label className="field">
          <span className="field-label">Email</span>
          <input name="email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" spellCheck={false} />
        </label>
        <ErrorBox error={save.error} />
        <div className="form-actions">
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Đang lưu…' : 'Lưu hồ sơ'}
          </button>
        </div>
      </form>

      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
        aria-labelledby="pw-h"
      >
        <h2 id="pw-h" className="panel-title">
          Đổi mật khẩu
        </h2>
        <input type="text" name="username" autoComplete="username" value={user.username ?? ''} readOnly hidden />
        <label className="field">
          <span className="field-label">Mật khẩu hiện tại</span>
          <input type="password" name="current-password" autoComplete="current-password" value={pw.oldPassword} onChange={(e) => setPw({ ...pw, oldPassword: e.target.value })} required />
        </label>
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Mật khẩu mới</span>
            <input
              type="password"
              name="new-password"
              autoComplete="new-password"
              value={pw.newPassword}
              onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
              minLength={8}
              required
            />
            <span className="field-hint">Tối thiểu 8 ký tự.</span>
          </label>
          <label className="field">
            <span className="field-label">Nhập lại mật khẩu mới</span>
            <input type="password" name="confirm-password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
          </label>
        </div>
        <ErrorBox error={change.error} />
        <div className="form-actions">
          <button className="btn" disabled={change.isPending}>
            {change.isPending ? 'Đang đổi…' : 'Đổi mật khẩu'}
          </button>
        </div>
      </form>
    </div>
  );
}
