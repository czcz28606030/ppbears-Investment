import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import './ParentRewardGrant.css';

export default function ParentRewardGrant() {
  const navigate = useNavigate();
  const { user, children, loadChildren, grantCoinsManually } = useStore();
  const [childId, setChildId] = useState('');
  const [amount,  setAmount]  = useState(50);
  const [message, setMessage] = useState('');
  const [busy,   setBusy]     = useState(false);
  const [toast,  setToast]    = useState('');
  const [error,  setError]    = useState('');

  useEffect(() => {
    if (!user || user.role !== 'parent') return;
    if (children.length === 0) loadChildren();
  }, [user]);

  useEffect(() => {
    if (children.length > 0 && !childId) setChildId(children[0].id);
  }, [children]);

  if (!user || user.role !== 'parent') return null;

  async function handleGrant() {
    if (!childId) { setError('請選擇孩子'); return; }
    if (amount <= 0) { setError('金額需大於 0'); return; }
    setBusy(true); setError('');
    const { error: e } = await grantCoinsManually(childId, amount, message.trim());
    setBusy(false);
    if (e) { setError(`發幣失敗：${e}`); return; }
    showToast(`已發放 ${amount} 學習幣 🎉`);
    setMessage('');
  }

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(''), 3000);
  }

  const QUICK = [20, 50, 100, 200, 500];

  return (
    <div className="prg-page">
      {toast && <div className="prg-toast">{toast}</div>}

      <div className="page-header">
        <button className="page-header-back" onClick={() => navigate('/parent/rewards')}>←</button>
        <h1 className="page-title">🎁 手動發幣</h1>
      </div>

      <div className="card prg-form">
        {/* 選擇孩子 */}
        <div className="prg-field">
          <label>發給誰</label>
          <div className="prg-child-list">
            {children.map(c => (
              <button
                key={c.id}
                className={`prg-child-btn ${childId === c.id ? 'selected' : ''}`}
                onClick={() => setChildId(c.id)}
              >
                <span>{c.avatar}</span>
                <span>{c.displayName}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 快速金額 */}
        <div className="prg-field">
          <label>學習幣數量</label>
          <div className="prg-quick-btns">
            {QUICK.map(q => (
              <button
                key={q}
                className={`prg-quick ${amount === q ? 'selected' : ''}`}
                onClick={() => setAmount(q)}
              >
                {q}
              </button>
            ))}
          </div>
          <input
            type="number" min={1} value={amount}
            onChange={e => setAmount(Number(e.target.value))}
            className="prg-input"
          />
          <div className="prg-rate-note">1 幣 = NT$1</div>
        </div>

        {/* 留言 */}
        <div className="prg-field">
          <label>留言（選填）</label>
          <input
            placeholder="例：生日快樂！好好學習喔 🎂"
            value={message}
            onChange={e => setMessage(e.target.value)}
            className="prg-input"
          />
        </div>

        {error && <div className="prg-error">{error}</div>}

        {/* 預覽 */}
        <div className="prg-preview">
          <span>{children.find(c => c.id === childId)?.avatar ?? '🐻'}</span>
          <span>{children.find(c => c.id === childId)?.displayName ?? '—'}</span>
          <span className="prg-preview-arrow">收到</span>
          <span className="prg-preview-amt">🪙 +{amount}</span>
        </div>

        <button className="btn-primary" disabled={busy || !childId} onClick={handleGrant}>
          {busy ? '發送中...' : '確認發幣'}
        </button>
      </div>
    </div>
  );
}
