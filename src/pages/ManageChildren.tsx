import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney } from '../store';
import { supabase } from '../supabase';
import { fetchTWSEAllStocks, fetchTWSEDividendYields, type TWSTEStockQuote, type TWSEDividendYield } from '../api';
import type { Holding } from '../types';
import './ManageChildren.css';
import './Login.css'; // Import for password-wrapper and toggle styles

const AVATARS = ['🐻', '🐼', '🐨', '🦁', '🦊', '🐯', '🐸', '🦄'];

export default function ManageChildren() {
  const navigate = useNavigate();
  const { children, createChildAccount, setChildBalance } = useStore();

  // 子帳號資產資料
  const [childrenHoldings, setChildrenHoldings] = useState<Record<string, Holding[]>>({});
  const [liveQuotes, setLiveQuotes] = useState<Record<string, TWSTEStockQuote>>({});
  const [liveDividends, setLiveDividends] = useState<Record<string, TWSEDividendYield>>({});

  useEffect(() => {
    async function loadDetailedData() {
      if (children.length === 0) return;
      
      const [twse, twseDivs] = await Promise.all([
        fetchTWSEAllStocks(),
        fetchTWSEDividendYields()
      ]);
      const quotesMap: Record<string, TWSTEStockQuote> = {};
      twse.forEach(t => quotesMap[t.Code] = t);
      setLiveQuotes(quotesMap);

      const divsMap: Record<string, TWSEDividendYield> = {};
      twseDivs.forEach(d => divsMap[d.Code] = d);
      setLiveDividends(divsMap);

      const childIds = children.map(c => c.id);
      if (!supabase) return;
      
      const { data } = await supabase
        .from('holdings')
        .select('*')
        .in('user_id', childIds);
      
      const holdingsMap: Record<string, Holding[]> = {};
      childIds.forEach(id => holdingsMap[id] = []);
      
      (data || []).forEach(h => {
        holdingsMap[h.user_id].push({
          stockCode: h.stock_code,
          stockName: h.stock_name,
          totalShares: Number(h.total_shares),
          avgCost: Number(h.avg_cost),
          currentPrice: Number(h.current_price),
          industry: h.industry,
        });
      });
      setChildrenHoldings(holdingsMap);
    }
    
    if (children.length > 0) {
      loadDetailedData();
    }
  }, [children]);

  // 建立副帳號表單
  const [showCreate, setShowCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [avatar, setAvatar] = useState('🐼');
  const [initialBalance, setInitialBalance] = useState('');
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [registeredChildEmail, setRegisteredChildEmail] = useState('');

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
    if (password !== confirmPassword) { setCreateError('兩次輸入的密碼不一致，請再確認！'); return; }
    
    setIsCreating(true);
    const result = await createChildAccount(email, password, displayName, avatar, Number(initialBalance) || 0);
    setIsCreating(false);
    if (result.error) {
      if (result.error.includes('already')) {
        setCreateError('此 Email 已經被使用了');
      } else if (result.error.includes('rate limit')) {
        setCreateError('發送驗證信太頻繁啦！請稍後 1 小時再試（平台保護機制）');
      } else {
        setCreateError(result.error);
      }
    } else {
      setShowCreate(false);
      setRegisteredChildEmail(email);
      setEmail(''); setPassword(''); setConfirmPassword(''); setDisplayName(''); setInitialBalance('');
      if (result.needsConfirmation) {
        setShowSuccessModal(true);
      }
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

      {/* 學習獎勵管理入口 */}
      <div
        onClick={() => navigate('/parent/rewards')}
        style={{
          display: 'flex', alignItems: 'center', gap: 16,
          background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)',
          padding: '16px 20px', cursor: 'pointer', marginBottom: 4,
          border: '2px solid rgba(240,147,43,0.2)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <span style={{ fontSize: 36 }}>🎁</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 900, fontSize: 'var(--font-size-base)', color: 'var(--text-primary)' }}>學習獎勵管理</div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 2 }}>設定發幣規則，孩子學習自動領學習幣</div>
        </div>
        <span style={{ color: 'var(--text-light)', fontSize: 18 }}>▶</span>
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

        {children.map(child => {
          const cHoldings = childrenHoldings[child.id] || [];
          let totalMarketValue = 0;
          let totalCost = 0;
          let todayPnL = 0;
          let totalEstDividend = 0;
          
          cHoldings.forEach(h => {
             const quote = liveQuotes[h.stockCode];
             const currentPrice = quote ? parseFloat(quote.ClosingPrice) : h.currentPrice;
             const liveChangeAmt = quote && quote.Change ? parseFloat(quote.Change) : 0;
             const divInfo = liveDividends[h.stockCode];
             const divYield = divInfo && divInfo.DividendYield ? parseFloat(divInfo.DividendYield) / 100 : 0;
             
             totalMarketValue += currentPrice * h.totalShares;
             totalCost += h.avgCost * h.totalShares;
             todayPnL += liveChangeAmt * h.totalShares;
             
             if (divYield > 0) {
                totalEstDividend += currentPrice * h.totalShares * divYield;
             }
          });
          
          const totalAssets = child.availableBalance + totalMarketValue;
          const totalPnL = totalMarketValue - totalCost;
          const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

          return (
          <div key={child.id} className="child-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
            <div className="child-card-header" style={{ marginBottom: 0, paddingBottom: 0, borderBottom: 'none' }}>
              <span className="child-avatar" style={{ padding: (child.avatar?.startsWith('data:') || child.avatar?.startsWith('http')) ? 0 : undefined, overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                {(child.avatar?.startsWith('data:') || child.avatar?.startsWith('http')) 
                  ? <img src={child.avatar} alt="avatar" style={{ width: '48px', height: '48px', objectFit: 'cover' }} /> 
                  : (child.avatar || '🐻')}
              </span>
              <div className="child-info">
                <div className="child-name">{child.displayName}</div>
                <div className="child-email">{child.email}</div>
              </div>
              <div className="child-balance-display">
                <div className="child-balance-label">總資金 (總資產)</div>
                <div className="child-balance-value" style={{ color: 'var(--primary-dark)', fontSize: '18px' }}>NT$ {formatMoney(totalAssets)}</div>
              </div>
            </div>

            {/* 子帳號資產總覽 */}
            <div style={{ background: 'var(--bg-page)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>可用餘額 (現金)</span>
                <span style={{ fontWeight: 700, fontSize: '14px' }}>NT$ {formatMoney(child.availableBalance)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>股票總市值</span>
                <span style={{ fontWeight: 700, fontSize: '14px' }}>NT$ {formatMoney(totalMarketValue)}</span>
              </div>
              {(totalMarketValue > 0) && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: '12px', marginTop: '4px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>預估現金股利</span>
                    <span style={{ fontWeight: 800, fontSize: '14px', color: 'var(--info-color)' }}>
                      NT$ {formatMoney(totalEstDividend)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>累積獲利</span>
                    <span className={totalPnL > 0 ? 'text-profit' : (totalPnL < 0 ? 'text-loss' : '')} style={{ fontWeight: 800, fontSize: '14px' }}>
                      {totalPnL > 0 ? '+' : ''}{formatMoney(totalPnL)} ({totalPnL > 0 ? '+' : ''}{totalPnLPct.toFixed(1)}%)
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* 子帳號具體持股 */}
            {cHoldings.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '4px' }}>持有股票明細 ({cHoldings.length})</div>
                {cHoldings.map(h => {
                  const quote = liveQuotes[h.stockCode];
                  const currentPrice = quote ? parseFloat(quote.ClosingPrice) : h.currentPrice;
                  const pl = (currentPrice - h.avgCost) * h.totalShares;
                  const plPct = h.avgCost > 0 ? (pl / (h.avgCost * h.totalShares)) * 100 : 0;
                  return (
                    <div key={h.stockCode} style={{ background: '#fff', border: '1px solid var(--border-card)', borderRadius: '8px', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontWeight: 800, fontSize: '14px' }}>{h.stockName} <span style={{ color: '#aaa', fontWeight: 500, fontSize: '12px' }}>{h.stockCode}</span></span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{h.totalShares} 股 · 總成本 NT${formatMoney(h.avgCost * h.totalShares)}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                        <span className={pl >= 0 ? 'text-profit' : 'text-loss'} style={{ fontWeight: 800, fontSize: '14px' }}>{pl >= 0 ? '+' : ''}{formatMoney(pl)}</span>
                        <span className={pl >= 0 ? 'text-profit' : 'text-loss'} style={{ fontSize: '12px', padding: '2px 6px', background: pl >= 0 ? 'var(--profit-bg)' : 'var(--loss-bg)', borderRadius: '4px' }}>{pl >= 0 ? '+' : ''}{plPct.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {editingChildId === child.id ? (
              <div className="balance-editor" style={{ marginTop: '8px' }}>
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
                  placeholder={balanceMode === 'add' ? '追加的現金（元）' : '新的現金餘額（元）'}
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
              <button className="set-balance-btn" onClick={() => { setEditingChildId(child.id); setBalanceError(''); setBalanceAmount(''); }} style={{ marginTop: '4px' }}>
                💰 調整現金餘額
              </button>
            )}
          </div>
        )})}
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
              <div className="password-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-input password-input"
                  placeholder="設定密碼"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
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
              <button type="button" className="btn-cancel" onClick={() => { setShowCreate(false); setCreateError(''); setConfirmPassword(''); }}>取消</button>
              <button type="submit" className="btn-save" disabled={isCreating || !password || !confirmPassword || password !== confirmPassword}>
                {isCreating ? '建立中...' : '建立副帳號 ✅'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Email Confirmation Modal ── */}
      {showSuccessModal && (
        <div className="modal-overlay" style={{ alignItems: 'center' }}>
          <div className="modal-content" style={{ borderRadius: '28px', maxWidth: '400px', margin: '0 20px', padding: '32px 24px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 64, marginBottom: 16 }} className="animate-bounce">👦</div>
              <h2 style={{ fontSize: 22, fontWeight: 900, color: '#2B2118', marginBottom: 8 }}>副帳號建立成功！</h2>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#7A6A55', marginBottom: 20 }}>
                請提醒孩子去信箱收取驗證信
              </p>
              
              <div style={{
                background: 'rgba(56, 189, 248, 0.1)',
                border: '1.5px dashed rgba(56, 189, 248, 0.4)',
                borderRadius: 16,
                padding: '12px',
                marginBottom: 24,
                wordBreak: 'break-all'
              }}>
                <span style={{ fontWeight: 800, color: '#0284c7' }}>{registeredChildEmail}</span>
              </div>

              <p style={{ fontSize: 13, fontWeight: 600, color: '#BFB09A', marginBottom: 24, lineHeight: 1.6 }}>
                💡 驗證開通後，孩子就可以用這組<br/>信箱與密碼登入小熊投資家了！
              </p>

              <button 
                onClick={() => setShowSuccessModal(false)}
                className="btn btn-block btn-primary"
                style={{ padding: '16px', fontSize: 16 }}
              >
                我知道了 ✅
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
