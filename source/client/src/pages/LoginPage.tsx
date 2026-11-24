import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DEMO_ACCOUNTS } from '../mock/api';
import { authApi } from '../lib/auth-api';
import { mockEnabled } from '../lib/runtime';
import { useAuth } from '../store/auth';
import { ErrorBox, Tabs } from '../components/ui';

type Mode = 'login' | 'register' | 'guest';

/** Chỉ tự focus trên thiết bị có chuột (tránh bật bàn phím trên điện thoại). */
const finePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;

const FEATURES = mockEnabled ? [
  ['Hai chế độ chơi', 'Tiến độ riêng cho từng người, hoặc đồng bộ cả phòng cùng một câu.'],
  ['Không sợ rớt mạng', 'Mất kết nối giữa trận vẫn quay lại được trong 30 giây, giữ nguyên thời hạn.'],
  ['Tự soạn bộ đề', 'Một đáp án, nhiều đáp án, đúng/sai; thời gian và điểm riêng cho từng câu.'],
] : [
  ['Tham gia bằng tên', 'Chọn tên hiển thị và nhập mã 6 ký tự để vào phòng của bạn bè.'],
  ['Phòng chờ trực tiếp', 'Danh sách người chơi và trạng thái kết nối cập nhật ngay khi có thay đổi.'],
  ['Cùng quản lý phòng', 'Chia sẻ mã, chuyển quyền chủ phòng và quản lý người tham gia.'],
];

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('guest');
  const [form, setForm] = useState({ username: '', password: '', email: '', displayName: '' });
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/lobby';

  const up = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === 'register' && form.password !== confirmPassword) {
      setError(new Error('Mật khẩu xác nhận không khớp.'));
      return;
    }
    if (mode === 'register' && new TextEncoder().encode(form.password).length > 72) {
      setError(new Error('Mật khẩu tối đa 72 byte UTF-8. Vui lòng dùng mật khẩu ngắn hơn.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await authApi.login(form)
          : mode === 'register'
            ? await authApi.register(form)
            : await authApi.guest({ displayName: form.displayName });
      setSession(res.token, res.user);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submitLabel = mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Tạo tài khoản' : 'Vào chơi';

  return (
    <div className="auth-page">
      <section className="auth-intro">
        <div className="wordmark wordmark-lg" translate="no">
          Quiz<span>online</span>
        </div>
        <h1 className="auth-title">
          {mockEnabled ? 'Trắc nghiệm nhiều người,' : 'Một phòng ôn tập,'}
          <br />
          <em>{mockEnabled ? 'chấm điểm theo từng giây.' : 'kết nối những người bạn.'}</em>
        </h1>
        <p className="auth-lede">
          {mockEnabled ? 'Tạo phòng, gửi mã cho bạn bè, cùng trả lời và xem bảng xếp hạng thay đổi ngay khi có người bấm chọn.' : 'Nhập tên, tạo phòng hoặc tham gia bằng mã. Mọi người cùng có mặt trong một phòng chờ trực tiếp.'}
        </p>
        <ol className="feature-list">
          {FEATURES.map(([t, d], i) => (
            <li key={t}>
              <span className="feature-num">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <div className="feature-title">{t}</div>
                <div className="feature-desc">{d}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="auth-panel" aria-label="Đăng nhập">
        <Tabs
          label="Cách vào"
          value={mode}
          onChange={(m) => {
            if (busy) return;
            setMode(m);
            setConfirmPassword('');
            setError(null);
          }}
          items={[
            { value: 'login', label: 'Đăng nhập' },
            { value: 'register', label: 'Đăng ký' },
            { value: 'guest', label: 'Khách' },
          ]}
        />
        <form onSubmit={submit} className="form" noValidate={false}>
          {mode !== 'guest' && (
            <label className="field">
              <span className="field-label">Tên đăng nhập</span>
              <input
                maxLength={50}
                minLength={mode === 'register' ? 3 : undefined}
                pattern={mode === 'register' ? '[A-Za-z0-9_]{3,50}' : undefined}
                title={mode === 'register' ? '3–50 ký tự: chữ không dấu, số và dấu gạch dưới.' : undefined}
                name="username"
                value={form.username}
                onChange={up('username')}
                autoComplete="username"
                spellCheck={false}
                autoCapitalize="none"
                required
                autoFocus={finePointer}
              />
            </label>
          )}
          {mode === 'register' && (
            <label className="field">
              <span className="field-label">Email</span>
              <input maxLength={254} name="email" type="email" inputMode="email" value={form.email} onChange={up('email')} autoComplete="email" spellCheck={false} required />
            </label>
          )}
          {mode !== 'login' && (
            <label className="field">
              <span className="field-label">Tên hiển thị</span>
              <input
                name="displayName"
                value={form.displayName}
                onChange={up('displayName')}
                required
                maxLength={50}
                autoComplete="nickname"
                placeholder="VD: Minh Anh…"
              />
              <span className="field-hint">Người khác sẽ thấy tên này trong phòng.</span>
            </label>
          )}
          {mode !== 'guest' && (
            <label className="field">
              <span className="field-label">Mật khẩu</span>
              <input
                name="password"
                maxLength={72}
                minLength={mode === 'register' ? 8 : undefined}
                type="password"
                value={form.password}
                onChange={up('password')}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
              {mode === 'register' && <span className="field-hint">Tối thiểu 8 ký tự.</span>}
            </label>
          )}
          {mode === 'register' && (
            <label className="field">
              <span className="field-label">Nhập lại mật khẩu</span>
              <input name="confirmPassword" type="password" autoComplete="new-password"
                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8} maxLength={72} required />
              <span className="field-hint">Tạo tài khoản thành công sẽ tự đăng nhập để bạn có thể tạo phòng.</span>
            </label>
          )}
          {mode === 'guest' && (
            <p className="note">Khách có thể vào phòng bằng mã. Đăng nhập tài khoản để tạo và làm chủ phòng.</p>
          )}
          <ErrorBox error={error} />
          <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Đang xử lý…' : submitLabel}
          </button>
        </form>

        {mockEnabled && mode === 'login' && (
          <div className="demo-accounts">
            <div className="demo-head">
              <span className="kicker">Tài khoản demo</span>
              <span className="muted small">
                mật khẩu <code translate="no">{DEMO_ACCOUNTS[0].password}</code>
              </span>
            </div>
            <ul className="demo-list">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.username}>
                  <button type="button" className="demo-item" onClick={() => setForm({ ...form, username: a.username, password: a.password })}>
                    <span className="mono" translate="no">
                      {a.username}
                    </span>
                    <span className="muted small">{a.role === 'ADMIN' ? 'quản trị' : a.note || 'người dùng'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
