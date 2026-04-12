import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import './Login.css';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const { registerParent } = useStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !displayName) return;
    if (password.length < 6) { setError('密碼至少需要 6 個字元'); return; }
    if (password !== confirmPassword) { setError('兩次輸入的密碼不一致，請再確認！'); return; }
    setError('');
    setIsLoading(true);

    const result = await registerParent(email, password, displayName, '🐻');
    setIsLoading(false);

    if (result.error) {
      setError(result.error.includes('already') ? '這個 Email 已經被使用了，請直接登入' : result.error);
    } else if (result.needsConfirmation) {
      setRegisteredEmail(email);
      setNeedsConfirmation(true);
    }
    // If needsConfirmation is false, app already logged in → App.tsx redirects automatically
  };

  // ── Email Confirmation Screen ──
  if (needsConfirmation) {
    return (
      <div className="auth-page">
        <div className="auth-bg-blobs">
          <div className="blob blob-1"></div>
          <div className="blob blob-2"></div>
        </div>
        <div className="auth-card">
          <div className="auth-header">
            <div style={{ fontSize: 64, marginBottom: 12 }} className="animate-bounce">📬</div>
            <h1 className="auth-title">確認信已寄出！</h1>
            <p className="auth-subtitle">帳號建立成功 🎉</p>
          </div>
          <div style={{
            background: 'rgba(138,201,38,0.08)',
            border: '1.5px solid rgba(138,201,38,0.3)',
            borderRadius: 16,
            padding: '16px 20px',
            textAlign: 'center',
            marginBottom: 20,
          }}>
            <p style={{ fontWeight: 800, fontSize: 14, color: '#2B2118', marginBottom: 6 }}>
              請去信箱查收確認信 📧
            </p>
            <p style={{ fontWeight: 700, fontSize: 13, color: '#7A6A55', marginBottom: 4 }}>
              {registeredEmail}
            </p>
            <p style={{ fontWeight: 600, fontSize: 12, color: '#BFB09A' }}>
              點擊信中的連結後，再回來登入即可！
            </p>
          </div>
          <div className="auth-footer" style={{ marginTop: 0 }}>
            已確認信箱？
            <Link to="/login" className="auth-link">立刻登入 →</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-bg-blobs">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
      </div>
      <div className="auth-card">
        <div className="auth-header">
          <img src="/ppbear.png" alt="PPBear" className="auth-logo" />
          <h1 className="auth-title">建立主帳號</h1>
          <p className="auth-subtitle">開啟你的小熊投資家旅程 🚀</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">📧 電子信箱</label>
            <input type="email" className="form-input" placeholder="your@email.com"
              value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>

          <div className="form-group">
            <label className="form-label">🔒 密碼 (至少 6 個字元)</label>
            <div className="password-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-input password-input"
                placeholder="設定你的密碼"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button type="button" className="password-toggle" onClick={() => setShowPassword(v => !v)} tabIndex={-1}>
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">🔒 確認密碼</label>
            <div className="password-wrapper">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                className={`form-input password-input ${confirmPassword && confirmPassword !== password ? 'input-error' : ''} ${confirmPassword && confirmPassword === password ? 'input-success' : ''}`}
                placeholder="再輸入一次密碼"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button type="button" className="password-toggle" onClick={() => setShowConfirmPassword(v => !v)} tabIndex={-1}>
                {showConfirmPassword ? '🙈' : '👁️'}
              </button>
            </div>
            {confirmPassword && confirmPassword !== password && (
              <span className="field-hint error">密碼不一致</span>
            )}
            {confirmPassword && confirmPassword === password && (
              <span className="field-hint success">✓ 密碼一致</span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">😊 你的暱稱</label>
            <input type="text" className="form-input" placeholder="例如：熊爸爸"
              value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={15} />
          </div>

          <div className="register-note">
            💡 頭像可以在帳號設定中上傳照片
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={!email || !password || !confirmPassword || password !== confirmPassword || !displayName || isLoading}
          >
            {isLoading ? '建立中...' : '建立帳號 🐻'}
          </button>
        </form>

        <div className="auth-footer">
          已有帳號？ <Link to="/login" className="auth-link">登入 →</Link>
        </div>
      </div>
    </div>
  );
}
