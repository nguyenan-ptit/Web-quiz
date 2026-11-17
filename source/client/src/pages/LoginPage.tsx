import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authApi, DEMO_ACCOUNTS } from '../mock/api';
import { useAuth } from '../store/auth';
import { ErrorBox, Tabs } from '../components/ui';

type Mode = 'login' | 'register' | 'guest';

/** Chỉ tự focus trên thiết bị có chuột (tránh bật bàn phím trên điện thoại). */
const finePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;

const FEATURES = [
  ['Hai chế độ chơi', 'Tiến độ riêng cho từng người, hoặc đồng bộ cả phòng cùng một câu.'],
  ['Không sợ rớt mạng', 'Mất kết nối giữa trận vẫn quay lại được trong 30 giây, giữ nguyên thời hạn.'],
  ['Tự soạn bộ đề', 'Một đáp án, nhiều đáp án, đúng/sai; thời gian và điểm riêng cho từng câu.'],
];

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [form, setForm] = useState({ username: '', password: '', email: '', displayName: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/lobby';

  const up = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
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
          Trắc nghiệm nhiều người,
          <br />
          <em>chấm điểm theo từng giây.</em>
        </h1>
        <p className="auth-lede">
          Tạo phòng, gửi mã cho bạn bè, cùng trả lời và xem bảng xếp hạng thay đổi ngay khi có người bấm chọn.
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
            setMode(m);
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
              <input name="email" type="email" inputMode="email" value={form.email} onChange={up('email')} autoComplete="email" spellCheck={false} required />
            </label>
          )}
          {mode !== 'login' && (
            <label className="field">
              <span className="field-label">Tên hiển thị</span>
              <input
                name="displayName"
                value={form.displayName}
                onChange={up('displayName')}
                required={mode === 'guest'}
                maxLength={30}
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
                type="password"
                value={form.password}
                onChange={up('password')}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
              {mode === 'register' && <span className="field-hint">Tối thiểu 8 ký tự.</span>}
            </label>
          )}
          {mode === 'guest' && (
            <p className="note">Khách vào phòng bằng mã và chơi được ngay, nhưng không tạo phòng, không soạn bộ đề và không có trang lịch sử.</p>
          )}
          <ErrorBox error={error} />
          <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Đang xử lý…' : submitLabel}
          </button>
        </form>

        {mode === 'login' && (
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
