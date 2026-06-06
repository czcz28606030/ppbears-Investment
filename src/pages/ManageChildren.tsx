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
  const { user, children, createChildAccount, setChildBalance, updateChildProfile, deleteChildAccount, updateBrokerSettings } = useStore();

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
  const [stopLossAlertPct, setStopLossAlertPct] = useState(user?.stopLossAlertPct?.toString() || '20');
  const [riskSettingMsg, setRiskSettingMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [riskSettingSaving, setRiskSettingSaving] = useState(false);

  // 設定餘額面板
  const [editingChildId, setEditingChildId] = useState<string | null>(null);
  const [balanceAmount, setBalanceAmount] = useState('');
  const [balanceMode, setBalanceMode] = useState<'set' | 'add'>('add');
  const [balanceError, setBalanceError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // ── 編輯子帳號 Modal ──
  const [editModalChildId, setEditModalChildId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAvatar, setEditAvatar] = useState('🐼');
  const [editError, setEditError] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const openEditModal = (child: { id: string; displayName: string; avatar: string }) => {
    setEditModalChildId(child.id);
    setEditName(child.displayName);
    setEditAvatar(child.avatar || '🐼');
    setEditError('');
  };

  const handleEditSave = async () => {
    if (!editName.trim()) { setEditError('暱稱不能為空'); return; }
    setIsSavingEdit(true);
    const result = await updateChildProfile(editModalChildId!, editName.trim(), editAvatar);
    setIsSavingEdit(false);
    if (result.error) {
      setEditError(result.error);
    } else {
      setEditModalChildId(null);
    }
  };

  // ── 刪除子帳號 確認 Modal ──
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const openDeleteConfirm = (child: { id: string; displayName: string }) => {
    setDeleteConfirmId(child.id);
    setDeleteConfirmName(child.displayName);
    setDeleteError('');
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return;
    setIsDeleting(true);
    const result = await deleteChildAccount(deleteConfirmId);
    setIsDeleting(false);
    if (result.error) {
      setDeleteError(result.error);
    } else {
      setDeleteConfirmId(null);
    }
  };

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

  const handleSaveRiskSetting = async () => {
    if (!user || user.role !== 'parent') return;
    const pct = Math.min(80, Math.max(1, Number(stopLossAlertPct) || 20));
    setStopLossAlertPct(String(pct));
    setRiskSettingMsg(null);
    setRiskSettingSaving(true);
    const result = await updateBrokerSettings(
      user.brokerFeeRate ?? 0.001425,
      user.brokerMinFee ?? 20,
      user.brokerTaxRate ?? 0.003,
      pct
    );
    setRiskSettingSaving(false);
    setRiskSettingMsg(result.error
      ? { text: result.error, type: 'error' }
      : { text: `✅ 停損提醒已設定為 -${pct}%`, type: 'success' }
    );
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

      {/* 下單風險設定 */}
      <div
        style={{
          background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)',
          padding: '16px 20px', marginBottom: 4,
          border: '2px solid rgba(255,89,94,0.18)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
          <span style={{ fontSize: 32 }}>🛡️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 900, fontSize: 'var(--font-size-base)', color: 'var(--text-primary)' }}>下單停損提醒設定</div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: 2 }}>買入時自動試算停損價與可能損失，套用到所有副帳號</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="number"
            min="1"
            max="80"
            step="1"
            value={stopLossAlertPct}
            onChange={(event) => setStopLossAlertPct(event.target.value)}
            style={{
              flex: 1,
              border: '2px solid rgba(255,193,7,0.45)',
              borderRadius: 14,
              padding: '12px 14px',
              fontSize: 16,
              fontWeight: 900,
              color: 'var(--text-primary)',
              background: '#fffaf0',
            }}
          />
          <span style={{ fontWeight: 900, color: 'var(--text-secondary)' }}>%</span>
          <button
            type="button"
            onClick={handleSaveRiskSetting}
            disabled={riskSettingSaving}
            style={{
              border: 0,
              borderRadius: 14,
              padding: '12px 16px',
              background: 'linear-gradient(135deg, var(--primary), var(--primary-dark))',
              color: '#fff',
              fontWeight: 900,
              cursor: riskSettingSaving ? 'not-allowed' : 'pointer',
              opacity: riskSettingSaving ? 0.6 : 1,
            }}
          >
            {riskSettingSaving ? '儲存中' : '儲存'}
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: '#7a5800', background: 'rgba(255,193,7,0.12)', borderRadius: 10, padding: '9px 10px', marginTop: 10, lineHeight: 1.5, fontWeight: 700 }}>
          例如設定 20%，股價 NT$100 買入時會提醒停損參考價 NT$80，並試算這筆單可能虧多少。
        </div>
        {riskSettingMsg && (
          <div style={{
            marginTop: 10,
            borderRadius: 10,
            padding: '9px 10px',
            fontSize: 13,
            fontWeight: 800,
            background: riskSettingMsg.type === 'success' ? 'rgba(76,175,80,0.12)' : 'rgba(255,80,80,0.1)',
            color: riskSettingMsg.type === 'success' ? '#2e7d32' : 'var(--loss-color)',
          }}>
            {riskSettingMsg.text}
          </div>
        )}
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
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button className="set-balance-btn" style={{ flex: 1 }}
                  onClick={() => { setEditingChildId(child.id); setBalanceError(''); setBalanceAmount(''); }}>
                  💰 調整現金餘額
                </button>
                <button
                  onClick={() => openEditModal(child)}
                  style={{
                    flex: '0 0 auto', padding: '10px 14px', borderRadius: '12px',
                    border: '1.5px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.08)',
                    color: '#6366f1', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
                  }}
                >
                  ✏️ 編輯
                </button>
                <button
                  onClick={() => openDeleteConfirm(child)}
                  style={{
                    flex: '0 0 auto', padding: '10px 14px', borderRadius: '12px',
                    border: '1.5px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)',
                    color: '#ef4444', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
                  }}
                >
                  🗑️ 刪除
                </button>
              </div>
            )}
          </div>
        );
      })}
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
      {/* ── 編輯子帳號 Modal ── */}
      {editModalChildId && (
        <div className="modal-overlay" style={{ alignItems: 'center' }}>
          <div className="modal-content" style={{ borderRadius: '24px', maxWidth: '400px', margin: '0 20px', padding: '28px 24px' }}>
            <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 20, color: '#2B2118' }}>✏️ 編輯副帳號資料</h2>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">😊 暱稱</label>
              <input
                type="text" className="form-input"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                maxLength={15}
                placeholder="例如：小熊寶寶"
              />
            </div>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">🐻 選擇頭像</label>
              <div className="avatar-picker">
                {AVATARS.map(a => (
                  <button key={a} type="button"
                    className={`avatar-pick-btn ${editAvatar === a ? 'active' : ''}`}
                    onClick={() => setEditAvatar(a)}>
                    {a}
                  </button>
                ))}
              </div>
            </div>

            {editError && <div className="error-msg" style={{ marginBottom: 12 }}>{editError}</div>}

            <div className="form-actions">
              <button className="btn-cancel" onClick={() => setEditModalChildId(null)}>取消</button>
              <button className="btn-save" onClick={handleEditSave} disabled={isSavingEdit}>
                {isSavingEdit ? '儲存中...' : '儲存 ✅'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 刪除確認 Modal ── */}
      {deleteConfirmId && (
        <div className="modal-overlay" style={{ alignItems: 'center' }}>
          <div className="modal-content" style={{ borderRadius: '24px', maxWidth: '380px', margin: '0 20px', padding: '28px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>⚠️</div>
            <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 8, color: '#2B2118' }}>確認刪除副帳號？</h2>
            <p style={{ fontSize: 14, color: '#7A6A55', marginBottom: 8 }}>
              即將刪除 <strong style={{ color: '#ef4444' }}>{deleteConfirmName}</strong> 的帳號
            </p>
            <p style={{ fontSize: 13, color: '#BFB09A', marginBottom: 24, lineHeight: 1.6 }}>
              ⚠️ 此操作無法復原！<br />
              該帳號的持股、交易紀錄、學習進度將一併刪除。
            </p>

            {deleteError && <div className="error-msg" style={{ marginBottom: 12 }}>{deleteError}</div>}

            <div className="form-actions">
              <button className="btn-cancel" onClick={() => setDeleteConfirmId(null)} disabled={isDeleting}>
                取消
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                style={{
                  flex: 1, padding: '12px', borderRadius: '12px',
                  background: isDeleting ? '#ccc' : '#ef4444',
                  color: '#fff', fontWeight: 800, fontSize: '15px',
                  border: 'none', cursor: isDeleting ? 'not-allowed' : 'pointer',
                }}
              >
                {isDeleting ? '刪除中...' : '確認刪除 🗑️'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
