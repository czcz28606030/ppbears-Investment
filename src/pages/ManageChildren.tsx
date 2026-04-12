import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney } from '../store';
import './ManageChildren.css';

const AVATARS = ['🐻', '🐼', '🐨', '🦁', '🦊', '🐯', '🐸', '🦄'];

export default function ManageChildren() {
  const navigate = useNavigate();
  const { children, createChildAccount, setChildBalance } = useStore();

  // 建立副帳號表單
  const [showCreate, setShowCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatar, setAvatar] = useState('🐼');
  const [initialBalance, setInitialBalance] = useState('');
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // 設定餘額面板
  const [editingChildId, setEditingChildId] = useState<string | null>(null);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceMode, setBalanceMode] = useState<'set' | 'add'>('add');
  const [balanceError, setBalanceError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    if (password.length < 6) { setCreateError('密碼至少需要 6 個字元'); return; }
    setIsCreating(true);
    const result = await createChildAccount(email, password, displayName, avatar, Number(initialBalance) || 0);
    setIsCreating(false);
    if (result.error) {
      setCreateError(result.error.includes('already') ? '此 Email 已經被使用了' : result.error);
    } else {
      setShowCreate(false);
      setEmail(''); setPassword(''); setDisplayName(''); setInitialBalance('');
    }
  };

  const handleSetBalance = async (childId: string) => {
    setBalanceError('');
    const amount = Number(balanceAmount);
    if (!amount || amount <= 0) { setBalanceError('請輸入有效的金額'); return; }
    setIsSaving(true);
    const result = await setChildBalance(childId, amount, balanceMode);
    setIsSaving(false);
    if (result.error) {
      setBalanceError(result.error);
    } else {
      setEditingChildId(null);
      setBalanceAmount('');
    }
  };

  return (
    <div className="manage-page">
      <div className="page-header">
        <button className="page-header-back" onClick={() => navigate('/')}>←</button>
        <h1 className="page-title">👨‍👩‍👧 管理副帳號</h1>
      </div>

      {/* 副帳號清單 */}
      <div className="children-list">
        {children.length === 0 && !showCreate && (
          <div className="empty-state">
            <div className="empty-state-icon">👶</div>
            <div className="empty-state-title">還沒有副帳號</div>
            <div className="empty-state-desc">幫你的小朋友建立帳號，一起學習投資！</div>
          </div>
        )}

        {children.map(child => (
          <div key={child.id} className="child-card">
            <div className="child-card-header">
              <span className="child-avatar">{child.avatar}</span>
              <div className="child-info">
                <div className="child-name">{child.displayName}</div>
                <div className="child-email">{child.email}</div>
              </div>
              <div className="child-balance-display">
                <div className="child-balance-label">可用餘額</div>
                <div className="child-balance-value">NT$ {formatMoney(child.availableBalance)}</div>
              </div>
            </div>

            {editingChildId === child.id ? (
              <div className="balance-editor">
                <div className="balance-mode-toggle">
                  <button
                    className={`mode-btn ${balanceMode === 'add' ? 'active' : ''}`}
                    onClick={() => setBalanceMode('add')}>
                    ➕ 追加金額
                  </button>
                  <button
                    className={`mode-btn ${balanceMode === 'set' ? 'active' : ''}`}
                    onClick={() => setBalanceMode('set')}>
                    📝 直接設定
                  </button>
                </div>
                <input
                  type="number" className="balance-input"
                  placeholder={balanceMode === 'add' ? '追加的金額（元）' : '新的餘額（元）'}
                  value={balanceAmount}
                  onChange={(e) => setBalanceAmount(e.target.value)}
                  min="1"
                />
                {balanceError && <div className="error-msg">{balanceError}</div>}
                <div className="balance-actions">
                  <button className="btn-cancel" onClick={() => { setEditingChildId(null); setBalanceAmount(''); setBalanceError(''); }}>取消</button>
                  <button className="btn-save" onClick={() => handleSetBalance(child.id)} disabled={isSaving}>
                    {isSaving ? '儲存中...' : '確認 ✅'}
                  </button>
                </div>
              </div>
            ) : (
              <button className="set-balance-btn" onClick={() => { setEditingChildId(child.id); setBalanceError(''); setBalanceAmount(''); }}>
                💰 調整零用錢
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 建立副帳號按鈕 */}
      {!showCreate && children.length < 5 && (
        <button className="create-child-btn" onClick={() => setShowCreate(true)}>
          ➕ 建立副帳號 ({children.length}/5)
        </button>
      )}

      {/* 建立副帳號表單 */}
      {showCreate && (
        <div className="create-form-card">
          <div className="create-form-title">建立新的副帳號</div>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label className="form-label">📧 電子信箱</label>
              <input type="email" className="form-input" placeholder="child@email.com"
                value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">🔒 密碼 (至少 6 字元)</label>
              <input type="password" className="form-input" placeholder="設定密碼"
                value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">😊 暱稱</label>
              <input type="text" className="form-input" placeholder="例如：小熊寶寶"
                value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={15} />
            </div>
            <div className="form-group">
              <label className="form-label">🐻 選擇頭像</label>
              <div className="avatar-picker">
                {AVATARS.map(a => (
                  <button key={a} type="button"
                    className={`avatar-pick-btn ${avatar === a ? 'active' : ''}`}
                    onClick={() => setAvatar(a)}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">💰 初始零用錢 (元)</label>
              <input type="number" className="form-input" placeholder="例如：10000"
                value={initialBalance} onChange={(e) => setInitialBalance(e.target.value)} min="0" />
            </div>

            {createError && <div className="error-msg">{createError}</div>}

            <div className="form-actions">
              <button type="button" className="btn-cancel" onClick={() => { setShowCreate(false); setCreateError(''); }}>取消</button>
              <button type="submit" className="btn-save" disabled={isCreating}>
                {isCreating ? '建立中...' : '建立副帳號 ✅'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
