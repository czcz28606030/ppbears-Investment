import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import './Login.css';

export default function UpdatePassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [message, setMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const { updatePassword, isRecoveryMode } = useStore();
  const navigate = useNavigate();

  // 如果不是 recovery mode，導向首頁
  useEffect(() => {
    if (!isRecoveryMode && status !== 'success') {
      navigate('/login');
    }
  }, [isRecoveryMode, status, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || !confirmPassword) return;
    if (password.length < 6) { setMessage('密碼至少需要 6 個字元'); return; }
    if (password !== confirmPassword) { setMessage('兩次輸入的密碼不一致'); return; }
    
    setStatus('loading');
    setMessage('');

    const result = await updatePassword(password);

    if (result.error) {
      setMessage(result.error);
      setStatus('idle');
    } else {
      setStatus('success');
      // 3秒後導向首頁
      setTimeout(() => {
        navigate('/');
      }, 3000);
    }
  };

  if (!isRecoveryMode && status !== 'success') return null;

  return (
    <div className="auth-page">
      <div className="auth-bg-blobs">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
      </div>
      <div className="auth-card">
        <div className="auth-header">
          <img src="/ppbear.png" alt="PPBear" className="auth-logo" />
          <h1 className="auth-title">設定新密碼 🐻</h1>
          <p className="auth-subtitle">
            {status === 'success' ? '密碼重設成功！即將為您重新導向...' : '請輸入新的密碼'}
          </p>
        </div>

        {status !== 'success' ? (
          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">🔒 新密碼 (至少 6 個字元)</label>
              <div className="password-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-input password-input"
                  placeholder="設定新密碼"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
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
              <label className="form-label">🔒 確認新密碼</label>
              <div className="password-wrapper">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  className={`form-input password-input ${confirmPassword && confirmPassword !== password ? 'input-error' : ''} ${confirmPassword && confirmPassword === password ? 'input-success' : ''}`}
                  placeholder="再輸入一次新密碼"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
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

            {message && (
              <div className="auth-error">
                {message}
              </div>
            )}

            <button
              type="submit"
              className="auth-submit-btn"
              disabled={!password || !confirmPassword || password !== confirmPassword || status === 'loading'}
            >
              {status === 'loading' ? '更新中...' : '儲存新密碼 💾'}
            </button>
          </form>
        ) : (
          <div className="empty-state" style={{ padding: '20px 0 0' }}>
            <div className="empty-state-icon" style={{ fontSize: '48px', animation: 'bounce 2s infinite' }}>🎉</div>
          </div>
        )}
      </div>
    </div>
  );
}
