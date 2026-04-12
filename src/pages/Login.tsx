import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import './Login.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError('');
    setIsLoading(true);

    const result = await login(email, password);
    setIsLoading(false);

    if (result.error) {
      setError('電子信箱或密碼錯誤，請再試一次 🔑');
    }
    // 成功登入後 App.tsx 的 onAuthStateChange 會自動導向
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
          <h1 className="auth-title">小熊投資家</h1>
          <p className="auth-subtitle">歡迎回來！請先登入你的帳號</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">📧 電子信箱</label>
            <input
              type="email"
              className="form-input"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="form-label" style={{ marginBottom: 0 }}>🔒 密碼</label>
              <Link to="/forgot-password" style={{ fontSize: 12, fontWeight: 800, color: 'var(--coral)', textDecoration: 'none' }}>忘記密碼？</Link>
            </div>
            <div className="password-wrapper">
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-input password-input"
                placeholder="輸入你的密碼"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
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

          {error && (
            <div className="auth-error">{error}</div>
          )}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={!email || !password || isLoading}
          >
            {isLoading ? '登入中...' : '登入 🚀'}
          </button>
        </form>

        <div className="auth-footer">
          還沒有帳號？
          <Link to="/register" className="auth-link">立刻註冊 →</Link>
        </div>
      </div>
    </div>
  );
}
