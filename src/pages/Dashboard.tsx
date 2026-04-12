import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney } from '../store';
import { POPULAR_STOCKS, fetchTWSEAllStocks, type TWSTEStockQuote } from '../api';
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
  
  const [livePnL, setLivePnL] = useState<{ todayPnL: number, todayPnLPct: number } | null>(null);
  const [liveQuotes, setLiveQuotes] = useState<Record<string, TWSTEStockQuote>>({});

  useEffect(() => {
    async function fetchLive() {
      if (holdings.length === 0) {
        setLivePnL({ todayPnL: 0, todayPnLPct: 0 });
        setLiveQuotes({});
        return;
      }
      const twse = await fetchTWSEAllStocks();
      const quotesMap: Record<string, TWSTEStockQuote> = {};
      let todayPnL = 0;
      let totalYesterdayValue = 0;
      
      holdings.forEach(h => {
        const quote = twse.find(t => t.Code === h.stockCode);
        if (quote) {
           quotesMap[h.stockCode] = quote;
           if (quote.Change) {
             const changeAmount = parseFloat(quote.Change);
             todayPnL += changeAmount * h.totalShares;
             const currentPrice = parseFloat(quote.ClosingPrice);
             let prevPrice = currentPrice - changeAmount;
             if (prevPrice <= 0) prevPrice = currentPrice;
             totalYesterdayValue += prevPrice * h.totalShares;
           }
        }
      });
      const todayPnLPct = totalYesterdayValue > 0 ? (todayPnL / totalYesterdayValue) * 100 : 0;
      setLivePnL({ todayPnL, todayPnLPct });
      setLiveQuotes(quotesMap);
    }
    fetchLive();
  }, [holdings]);

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
        <img src="/ppbear.png" alt="PPBear" className="greeting-bear animate-float" />
      </div>

      {/* 總資產卡片 */}
      <div className={`card asset-card ${summary.totalCost > 0 ? (profitClass === 'profit' ? 'card-profit' : 'card-loss') : 'card-primary'}`}>
        <div className="asset-label">我的總資產 💰</div>
        <div className="asset-value">NT$ {formatMoney(summary.totalAssets)}</div>
        
        <div className="asset-details" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="asset-detail">
            <span className="asset-detail-label">💵 可用現金</span>
            <span className="asset-detail-value">NT$ {formatMoney(summary.cashBalance)}</span>
          </div>
          <div className="asset-detail">
            <span className="asset-detail-label">📈 股票市值</span>
            <span className="asset-detail-value">NT$ {formatMoney(summary.totalMarketValue)}</span>
          </div>
          <div className="asset-detail">
            <span className="asset-detail-label">📊 累積損益</span>
            <span className={`asset-detail-value ${summary.totalProfitLoss >= 0 ? 'text-profit' : 'text-loss'}`} style={{ color: summary.totalProfitLoss >= 0 ? '#fff' : '#ffe1e1' }}>
              {summary.totalProfitLoss >= 0 ? '+' : ''}NT$ {formatMoney(summary.totalProfitLoss)}
              <span style={{ fontSize: '0.8em', marginLeft: 4 }}>({summary.profitLossPct >= 0 ? '+' : ''}{summary.profitLossPct.toFixed(1)}%)</span>
            </span>
          </div>
          <div className="asset-detail">
            <span className="asset-detail-label">⚡ 今日損益</span>
            <span className={`asset-detail-value ${livePnL && livePnL.todayPnL >= 0 ? 'text-profit' : 'text-loss'}`} style={{ color: livePnL && livePnL.todayPnL >= 0 ? '#fff' : '#ffe1e1' }}>
              {livePnL ? (
                <>
                  {livePnL.todayPnL >= 0 ? '+' : ''}NT$ {formatMoney(livePnL.todayPnL)}
                  <span style={{ fontSize: '0.8em', marginLeft: 4 }}>({livePnL.todayPnLPct >= 0 ? '+' : ''}{livePnL.todayPnLPct.toFixed(1)}%)</span>
                </>
              ) : (
                <span style={{ fontSize: '0.9em', opacity: 0.7 }}>計算中...</span>
              )}
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
          <div className="holdings-preview" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {holdings.slice(0, 3).map((h) => {
              const quote = liveQuotes[h.stockCode];
              
              const currentPrice = quote ? parseFloat(quote.ClosingPrice) : h.currentPrice;
              const liveChangeAmt = quote && quote.Change ? parseFloat(quote.Change) : 0;
              const prevPrice = currentPrice - liveChangeAmt;
              const liveChangePct = prevPrice > 0 ? (liveChangeAmt / prevPrice) * 100 : 0;
              
              const todayPnL = liveChangeAmt * h.totalShares;
              const totalCost = h.avgCost * h.totalShares;
              const totalPnL = (currentPrice - h.avgCost) * h.totalShares;
              const totalPnLPct = h.avgCost > 0 ? ((currentPrice - h.avgCost) / h.avgCost * 100) : 0;
              const isProfit = totalPnL >= 0;

              return (
                <div key={h.stockCode} className="card" onClick={() => navigate(`/stock/${h.stockCode}`)} style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                     <div style={{ fontWeight: 800, fontSize: '18px', color: 'var(--text-primary)' }}>
                        {h.stockName} <span style={{fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 500}}>{h.stockCode}</span>
                     </div>
                     <div className={liveChangeAmt >= 0 ? 'text-profit' : 'text-loss'} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 800 }}>
                        <span style={{ fontSize: '14px' }}>NT$ {formatMoney(currentPrice)}</span>
                        <span style={{ fontSize: '14px', padding: '2px 6px', background: liveChangeAmt >= 0 ? 'var(--profit-bg)' : 'var(--loss-bg)', borderRadius: '6px' }}>
                          {liveChangePct >= 0 ? '+' : ''}{liveChangePct.toFixed(1)}%
                        </span>
                     </div>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
                     <div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginBottom: '2px' }}>⚡ 今日損益</div>
                        <div className={todayPnL >= 0 ? 'text-profit' : 'text-loss'} style={{ fontWeight: 700, fontSize: '15px' }}>
                           {todayPnL >= 0 ? '+' : ''}{formatMoney(todayPnL)}
                        </div>
                     </div>
                     <div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginBottom: '2px' }}>📊 累積損益 (報酬率)</div>
                        <div className={isProfit ? 'text-profit' : 'text-loss'} style={{ fontWeight: 700, fontSize: '15px' }}>
                           {isProfit ? '+' : ''}{formatMoney(totalPnL)} ({isProfit ? '+' : ''}{totalPnLPct.toFixed(1)}%)
                        </div>
                     </div>
                     <div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginBottom: '2px' }}>💼 股數 / 均價總成本</div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '14px' }}>
                           {h.totalShares}股 / {formatMoney(totalCost)}
                        </div>
                     </div>
                     <div>
                        <div style={{ color: 'var(--text-tertiary)', fontSize: '11px', marginBottom: '2px' }}>💵 預估現金股利</div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '14px' }}>
                           NT$ 0 <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 400 }}>(試算中)</span>
                        </div>
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
