import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney } from '../store';
import { fetchHomeMarketSummary } from '../api';
import AdBanner from '../components/AdBanner';
import './Dashboard.css';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, trades: allTrades, getPortfolioSummary, requestWithdrawal } = useStore();
  const trades = allTrades.slice(0, 5);
  const summary = getPortfolioSummary();
  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [wAmount, setWAmount] = useState('');
  const [wReason, setWReason] = useState('');
  const [wError, setWError] = useState('');
  const [wLoading, setWLoading] = useState(false);
  useEffect(() => { void fetchHomeMarketSummary(); }, []);

  const profitClass = summary.totalProfitLoss >= 0 ? 'profit' : 'loss';
  const greetingEmoji = summary.totalProfitLoss >= 0 ? '😊' : '💪';

  // 根據時間問候
  const hour = new Date().getHours();
  let greeting = '早安';
  if (hour >= 12 && hour < 18) greeting = '午安';
  else if (hour >= 18) greeting = '晚安';

  return (
    <div className="dashboard">
      {/* 問候區 */}
      <div className="greeting-section">
        <div className="greeting-left">
          <button
            className="greeting-avatar-btn"
            onClick={() => navigate('/settings')}
            title="帳號設定"
          >
            {user!.avatar.startsWith('data:') || user!.avatar.startsWith('http') ? (
              <img src={user!.avatar} alt="頭像" className="greeting-avatar-img" />
            ) : (
              <span className="greeting-avatar">{user!.avatar}</span>
            )}
          </button>
          <div>
            <div className="greeting-text">{greeting}！{user!.displayName} {greetingEmoji}</div>
            <div className="greeting-sub">今天也要好好投資唷！</div>
          </div>
        </div>
      </div>

      {/* 總資產卡片 */}
      <div className={`card asset-card ${summary.totalCost > 0 ? (profitClass === 'profit' ? 'card-profit' : 'card-loss') : 'card-primary'}`}>
        <div className="asset-label">我的總資產 💰</div>
        <div className="asset-value">
          <span className="asset-currency">NT$</span>
          <span className="asset-number">{formatMoney(summary.totalAssets)}</span>
        </div>
        
        <div className="asset-details asset-details-three">
          <div className="asset-detail">
            <span className="asset-detail-label">💵 可用現金</span>
            <span className="asset-detail-value">
              <span className="asset-currency">NT$</span>
              <span className="asset-number">{formatMoney(summary.cashBalance)}</span>
            </span>
          </div>
          <div className="asset-detail">
            <span className="asset-detail-label">📈 股票市值</span>
            <span className="asset-detail-value">
              <span className="asset-currency">NT$</span>
              <span className="asset-number">{formatMoney(summary.totalMarketValue)}</span>
            </span>
          </div>
          <div className="asset-detail">
            <span className="asset-detail-label">📊 未平倉損益</span>
            <span className={`asset-detail-value ${summary.totalProfitLoss > 0 ? 'asset-pnl-profit' : summary.totalProfitLoss < 0 ? 'asset-pnl-loss' : ''}`}>
              <span className="asset-number-row">
                <span>{summary.totalProfitLoss > 0 ? '+' : ''}</span>
                <span className="asset-currency">NT$</span>
                <span className="asset-number">{formatMoney(summary.totalProfitLoss)}</span>
              </span>
              <span className="asset-pct">({summary.profitLossPct > 0 ? '+' : ''}{summary.profitLossPct.toFixed(1)}%)</span>
            </span>
          </div>
        </div>
      </div>

      {/* 快速操作 */}
      <div className="quick-actions">
        <button className="quick-action-btn" onClick={() => navigate('/explore')}>
          <span className="qa-icon">🔍</span>
          <span className="qa-label">找股票</span>
        </button>
        <button className="quick-action-btn" onClick={() => navigate('/portfolio')}>
          <span className="qa-icon">💼</span>
          <span className="qa-label">看庫存</span>
        </button>
        {user?.role === 'parent' ? (
          <button className="quick-action-btn" onClick={() => navigate('/manage-children')}>
            <span className="qa-icon">👨‍👩‍👧</span>
            <span className="qa-label">管理帳號</span>
          </button>
        ) : (
          <button className="quick-action-btn" onClick={() => setShowWithdrawal(true)}>
            <span className="qa-icon">💸</span>
            <span className="qa-label">申請出金</span>
          </button>
        )}
        <button className="quick-action-btn" onClick={() => navigate('/history')}>
          <span className="qa-icon">🕒</span>
          <span className="qa-label">交易紀錄</span>
        </button>
        <button className="quick-action-btn" onClick={() => navigate('/dividends')}>
          <span className="qa-icon">💰</span>
          <span className="qa-label">股利紀錄</span>
        </button>
        {user?.isAdmin && (
          <button className="quick-action-btn" onClick={() => navigate('/backtest')}>
            <span className="qa-icon">📊</span>
            <span className="qa-label">回測</span>
          </button>
        )}
        {user?.isAdmin && (
          <button className="quick-action-btn" onClick={() => navigate('/admin')}>
            <span className="qa-icon">🔧</span>
            <span className="qa-label">管理後台</span>
          </button>
        )}
      </div>

      {/* 廣告橫幅（僅 Free 用戶可見） */}
      <AdBanner />

      {/* 副帳號出金申請彈窗 */}
      {showWithdrawal && (
        <div className="modal-overlay" onClick={() => setShowWithdrawal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-handle"></div>
            <h3 className="trade-modal-title">💸 申請出金</h3>
            <div className="trade-modal-price">可用餘額：NT$ {formatMoney(user?.availableBalance || 0)}</div>
            <div className="input-group" style={{ marginTop: 16 }}>
              <label className="input-label">申請金額（元）</label>
              <input className="input-field" type="number" min="1"
                placeholder="輸入想領出的金額"
                value={wAmount} onChange={e => setWAmount(e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">申請原因（選填）</label>
              <input className="input-field" type="text"
                placeholder="例如：買玩具、存零用錢"
                value={wReason} onChange={e => setWReason(e.target.value)} />
            </div>
            {wError && <div style={{ color: 'var(--loss-color)', fontSize: 13, marginTop: 8 }}>{wError}</div>}
            <button
              className="btn btn-buy btn-lg btn-block"
              style={{ marginTop: 16 }}
              disabled={!wAmount || wLoading}
              onClick={async () => {
                setWError('');
                setWLoading(true);
                const result = await requestWithdrawal(Number(wAmount), wReason);
                setWLoading(false);
                if (result.error) { setWError(result.error); }
                else {
                  setShowWithdrawal(false);
                  setWAmount(''); setWReason('');
                  alert('✅ 申請已送出，請等待主帳號審核！');
                }
              }}
            >
              {wLoading ? '送出中...' : '送出申請 🚀'}
            </button>
          </div>
        </div>
      )}

      <section className="market-panel card">
        <h2 className="section-title">週榜趨勢策略</h2>
        <p>舊版市場預測來源已停用，首頁不再顯示舊預測或過期快取。</p>
        <p>新策略依每週候選名單、官方日 K 與你的實際持倉計算，請到「找股票」查看候選股，或到「持股」查看持倉訊號。</p>
        <div className="quick-actions">
          <button className="btn btn-outline" onClick={() => navigate('/explore')}>找股票</button>
          <button className="btn btn-outline" onClick={() => navigate('/portfolio')}>查看持股</button>
        </div>
      </section>
      {/* 空狀態 */}
      {trades.length === 0 && summary.totalMarketValue === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🐻</div>
          <div className="empty-state-title">歡迎來到小熊投資家！</div>
          <div className="empty-state-desc">
            你有 NT$ {formatMoney(user!.availableBalance)} 的零用錢可以投資，快去探索股票吧！
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/explore')}>
            🔍 開始探索
          </button>
        </div>
      )}

      {/* 頁尾版本號 */}
      <div style={{ textAlign: 'center', margin: '32px 0 16px', color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 500 }}>
        PPBears Investment v{import.meta.env.VITE_APP_VERSION}
      </div>
    </div>
  );
}
