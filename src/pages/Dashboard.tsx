import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney } from '../store';
import { POPULAR_STOCKS } from '../api';
import './Dashboard.css';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, holdings, trades: allTrades, getPortfolioSummary, requestWithdrawal } = useStore();
  const trades = allTrades.slice(0, 5);
  const summary = getPortfolioSummary();
  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [wAmount, setWAmount] = useState('');
  const [wReason, setWReason] = useState('');
  const [wError, setWError] = useState('');
  const [wLoading, setWLoading] = useState(false);

  const profitClass = summary.totalProfitLoss >= 0 ? 'profit' : 'loss';
  const profitEmoji = summary.totalProfitLoss >= 0 ? '📈' : '📉';
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
        <img src="/ppbear.png" alt="PPBear" className="greeting-bear animate-float" />
      </div>

      {/* 總資產卡片 */}
      <div className={`card asset-card ${profitClass === 'profit' ? 'card-profit' : 'card-primary'}`}>
        <div className="asset-label">我的總資產 💰</div>
        <div className="asset-value">NT$ {formatMoney(summary.totalAssets)}</div>
        <div className="asset-details">
          <div className="asset-detail">
            <span className="asset-detail-label">可用現金</span>
            <span className="asset-detail-value">NT$ {formatMoney(summary.cashBalance)}</span>
          </div>
          <div className="asset-detail">
            <span className="asset-detail-label">投資市值</span>
            <span className="asset-detail-value">NT$ {formatMoney(summary.totalMarketValue)}</span>
          </div>
        </div>
        {summary.totalCost > 0 && (
          <div className="asset-profit">
            <span>{profitEmoji} 目前{summary.totalProfitLoss >= 0 ? '賺' : '虧'}</span>
            <span className="asset-profit-value">
              NT$ {formatMoney(Math.abs(summary.totalProfitLoss))}
              ({summary.profitLossPct >= 0 ? '+' : ''}{summary.profitLossPct.toFixed(1)}%)
            </span>
          </div>
        )}
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
        <button className="quick-action-btn" onClick={() => navigate('/learn')}>
          <span className="qa-icon">📚</span>
          <span className="qa-label">學投資</span>
        </button>
      </div>

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

      {/* 我的持股 */}
      {holdings.length > 0 && (
        <section>
          <div className="section-header">
            <h2 className="section-title">📊 我的持股</h2>
            <span className="section-action" onClick={() => navigate('/portfolio')}>查看全部</span>
          </div>
          <div className="holdings-preview">
            {holdings.slice(0, 3).map((h) => {
              const pl = (h.currentPrice - h.avgCost) * h.totalShares;
              const plPct = ((h.currentPrice - h.avgCost) / h.avgCost * 100);
              const isProfit = pl >= 0;
              return (
                <div
                  key={h.stockCode}
                  className="stock-card"
                  onClick={() => navigate(`/stock/${h.stockCode}`)}
                >
                  <div className="stock-icon" style={{ background: isProfit ? 'var(--profit-bg)' : 'var(--loss-bg)' }}>
                    {isProfit ? '📈' : '📉'}
                  </div>
                  <div className="stock-info">
                    <div className="stock-name">{h.stockName}</div>
                    <div className="stock-code">{h.stockCode} · {h.totalShares}股</div>
                  </div>
                  <div className="stock-price-info">
                    <div className={`stock-price ${isProfit ? 'text-profit' : 'text-loss'}`}>
                      {isProfit ? '+' : ''}{formatMoney(pl)}
                    </div>
                    <div className={`stock-change ${isProfit ? 'text-profit' : 'text-loss'}`}>
                      {isProfit ? '+' : ''}{plPct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 熱門股票 */}
      <section>
        <div className="section-header">
          <h2 className="section-title">🔥 熱門股票</h2>
          <span className="section-action" onClick={() => navigate('/explore')}>更多</span>
        </div>
        <div className="popular-grid">
          {POPULAR_STOCKS.slice(0, 6).map((s) => (
            <div
              key={s.code}
              className="popular-item"
              onClick={() => navigate(`/stock/${s.code}`)}
            >
              <span className="popular-emoji">{s.emoji}</span>
              <span className="popular-name">{s.name}</span>
              <span className="popular-code">{s.code}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 最近交易 */}
      {trades.length > 0 && (
        <section>
          <div className="section-header">
            <h2 className="section-title">🕐 最近交易</h2>
          </div>
          <div className="trades-list">
            {trades.map((t) => (
              <div key={t.id} className="trade-item">
                <div className={`trade-type-badge ${t.tradeType === 'buy' ? 'badge-buy' : 'badge-sell'}`}>
                  {t.tradeType === 'buy' ? '買' : '賣'}
                </div>
                <div className="trade-info">
                  <div className="trade-name">{t.stockName}</div>
                  <div className="trade-detail">{t.quantity}股 × NT${t.price}</div>
                </div>
                <div className="trade-amount">
                  NT$ {formatMoney(t.totalAmount)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 空狀態 */}
      {holdings.length === 0 && trades.length === 0 && (
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
      <div className="dashboard-footer" style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-tertiary, #aaa)', fontSize: '0.85rem' }}>
        PPBears Investment v1.2.0
      </div>
    </div>
  );
}
