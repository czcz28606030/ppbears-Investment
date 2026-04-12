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
  const { registerParent } = useStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !displayName) return;
    if (password.length < 6) { setError('密碼至少需要 6 個字元'); return; }
    if (password !== confirmPassword) { setError('兩次輸入的密碼不一致，請再確認！'); return; }
    setError('');
    setIsLoading(true);

    // 預設使用 🐻，使用者可以之後在設定頁面上傳照片
    const result = await registerParent(email, password, displayName, '🐻');
    setIsLoading(false);

    if (result.error) {
      setError(result.error.includes('already') ? '這個 Email 已經被使用了' : result.error);
    }
  };

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
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(v => !v)}
                tabIndex={-1}
              >
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
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword(v => !v)}
                tabIndex={-1}
              >
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
