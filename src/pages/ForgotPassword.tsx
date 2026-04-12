import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';
import './Login.css';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [message, setMessage] = useState('');
  const { sendPasswordResetEmail } = useStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setStatus('loading');
    setMessage('');

    const result = await sendPasswordResetEmail(email);

    if (result.error) {
      setMessage(result.error);
      setStatus('idle');
    } else {
      setMessage('✅ 密碼重設信件已寄出！請去信箱收信。');
      setStatus('success');
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
          <h1 className="auth-title">忘記密碼 🐻</h1>
          <p className="auth-subtitle">別擔心，輸入信箱來重設密碼</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">📧 電子信箱</label>
            <input
              type="email"
              className="form-input"
              placeholder="請輸入註冊時的信箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={status === 'success'}
            />
          </div>

          {message && (
            <div className={status === 'success' ? "auth-error" : "auth-error"} style={status === 'success' ? { background: '#FFFBEF', borderColor: '#8AC926', color: '#8AC926' } : {}}>
              {message}
            </div>
          )}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={!email || status === 'loading' || status === 'success'}
          >
            {status === 'loading' ? '發送中...' : status === 'success' ? '發送成功' : '發送重設信件 🚀'}
          </button>
        </form>

        <div className="auth-footer">
          想起來了？
          <Link to="/login" className="auth-link">返回登入 →</Link>
        </div>
      </div>
    </div>
  );
}
