import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney, formatPrice } from '../store';
import type { Holding } from '../types';
import './Portfolio.css';

export default function Portfolio() {
  const navigate = useNavigate();
  const { holdings, getPortfolioSummary, user, hasFeature } = useStore();
  const hasAiFeature = hasFeature('ai_portfolio_advice');
  const summary = getPortfolioSummary();

  const pl = summary.totalProfitLoss;
  const isProfit = pl >= 0;

  const [aiSignals, setAiSignals] = useState<Record<string, { advice: string, color: string, icon: string }>>({});
  const [enableCustomSignal, setEnableCustomSignal] = useState(() => {
    return localStorage.getItem('ppbears_custom_signal') === 'true';
  });

  const toggleCustomSignal = (val: boolean) => {
    setEnableCustomSignal(val);
    localStorage.setItem('ppbears_custom_signal', String(val));
  };

  useEffect(() => {
    let mounted = true;
    async function loadSignals() {
      if (holdings.length === 0) return;
      if (!hasAiFeature && !enableCustomSignal) {
        if (mounted && Object.keys(aiSignals).length > 0) setAiSignals({});
        return;
      }
      
      const signals: Record<string, { advice: string, color: string, icon: string }> = {};
      
      if (hasAiFeature) {
        try {
          let buySet = new Set<string>();
          for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            if (d.getDay() === 0 || d.getDay() === 6) continue;
            const dateStr = d.toISOString().split('T')[0];
            const res = await fetch(`https://api.ifalgo.com.tw/frontapi/common/getSimonsData?searchDate=${dateStr}`);
            const data = await res.json();
            const items = data.data?.dataItems || [];
            if (items.length > 0) {
              buySet = new Set(items.map((it: any) => it.coid));
              break;
            }
          }

          await Promise.all(holdings.map(async (h) => {
            if (buySet.has(h.stockCode)) {
              signals[h.stockCode] = { advice: 'AI 加碼', color: '#FF2424', icon: '👑 🚀' };
              return;
            }
            try {
              const res = await fetch(`https://api.ifalgo.com.tw/frontapi/stock?coid=${h.stockCode}`);
              const json = await res.json();
              const list = json.data?.stock?.aiQuanBackDataTradingList || [];
              if (list.length > 0) {
                const last = list[list.length - 1];
                if (last.sell_sig === '出場' || last.sell_sig === '賣出') {
                  signals[h.stockCode] = { advice: 'AI 出場', color: 'var(--loss-color)', icon: '👑 ⚠️' };
                  return;
                }
              }
              signals[h.stockCode] = { advice: 'AI 中立', color: '#888888', icon: '👑 ⚖️' };
            } catch {
              signals[h.stockCode] = { advice: 'AI 中立', color: '#888888', icon: '👑 ⚖️' };
            }
          }));

        } catch (err) {
          console.error('Failed to load AI signals', err);
        }
      } else if (enableCustomSignal) {
        await Promise.all(holdings.map(async (h) => {
          try {
             const start = new Date();
             start.setDate(start.getDate() - 150);
             const dateStr = start.toISOString().split('T')[0];
             const res = await fetch(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${h.stockCode}&start_date=${dateStr}`);
             const json = await res.json();
             const data = json.data;
             if (data && data.length >= 60) {
               const closes = data.map((d: any) => d.close);
               const getSMA = (arr: number[], period: number, offset: number = 0) => {
                 const slice = arr.slice(arr.length - period - offset, arr.length - offset);
                 return slice.reduce((a, b) => a + b, 0) / period;
               };
               
               const lastClose = closes[closes.length - 1];
               const sma60 = getSMA(closes, 60, 0);
               const sma60Prev = getSMA(closes, 60, 1);
               const prevClose = closes[closes.length - 2];
               
               const max20 = Math.max(...closes.slice(-20));
               
               if (lastClose > sma60 && lastClose >= max20) {
                 signals[h.stockCode] = { advice: '技術 加碼', color: '#FF2424', icon: '📈 🚀' };
               } else if (lastClose < sma60 && prevClose < sma60Prev) {
                 signals[h.stockCode] = { advice: '技術 出場', color: 'var(--loss-color)', icon: '📉 ⚠️' };
               } else {
                 signals[h.stockCode] = { advice: '技術 中立', color: '#888888', icon: '➖ ⚖️' };
               }
             }
          } catch (e) {
             console.error('Fetch technical fail:', e);
          }
        }));
      }

      if (mounted) setAiSignals(signals);
    }
    loadSignals();
    return () => { mounted = false; };
  }, [holdings, hasAiFeature, enableCustomSignal]);

  return (
    <div className="portfolio">
      <div className="page-header">
        <h1 className="page-title">💼 我的庫存</h1>
      </div>

      {/* 總覽卡片 */}
      <div className={`card portfolio-summary-card ${summary.totalCost > 0 ? (isProfit ? 'card-profit' : 'card-loss') : 'card-primary'}`}>
        <div className="ps-row">
          <div className="ps-item">
            <div className="ps-label">總資產</div>
            <div className="ps-value ps-total">NT$ {formatMoney(summary.totalAssets)}</div>
          </div>
        </div>
        <div className="ps-row">
          <div className="ps-item">
            <div className="ps-label">💵 可用現金</div>
            <div className="ps-value">NT$ {formatMoney(summary.cashBalance)}</div>
          </div>
          <div className="ps-item">
            <div className="ps-label">📈 投資市值</div>
            <div className="ps-value">NT$ {formatMoney(summary.totalMarketValue)}</div>
          </div>
        </div>
        <div className="ps-profit-row">
          <span>{isProfit ? '📈 目前賺' : '📉 目前虧'}</span>
          <span className="ps-profit-value">
            NT$ {formatMoney(Math.abs(pl))}
            {summary.totalCost > 0 && ` (${isProfit ? '+' : ''}${summary.profitLossPct.toFixed(1)}%)`}
          </span>
        </div>
      </div>

      {/* 資金使用進度 (只在有初始金額時顯示) */}
      {user && user.initialBalance > 0 && (
        <div className="card budget-card">
          <div className="budget-header">
            <span className="budget-label">💰 資金使用進度</span>
            <span className="budget-pct">
              {Math.min(100, ((user.initialBalance - summary.cashBalance) / user.initialBalance * 100)).toFixed(0)}% 已投資
            </span>
          </div>
          <div className="budget-bar">
            <div
              className="budget-bar-fill"
              style={{ width: `${Math.min(100, (user.initialBalance - summary.cashBalance) / user.initialBalance * 100)}%` }}
            ></div>
          </div>
          <div className="budget-detail">
            <span>已投資 NT$ {formatMoney(Math.max(0, user.initialBalance - summary.cashBalance))}</span>
            <span>初始資金 NT$ {formatMoney(user.initialBalance)}</span>
          </div>
        </div>
      )}

      <div className="section-header" style={{ marginTop: '24px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="section-title" style={{ margin: 0 }}>📊 持股清單 ({holdings.length})</h2>
        {!hasAiFeature && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13.5px', color: '#555', cursor: 'pointer', fontWeight: 600, background: '#f5f5f5', padding: '6px 12px', borderRadius: '8px' }}>
            <input 
              type="checkbox" 
              checked={enableCustomSignal} 
              onChange={e => toggleCustomSignal(e.target.checked)} 
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            顯示加碼與出場訊號
          </label>
        )}
      </div>

      {/* 持股列表 */}
      <div className="holdings-list">
          {holdings.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📭</div>
              <div className="empty-state-title">還沒有持股</div>
              <div className="empty-state-desc">快去探索頁面買你的第一支股票吧！</div>
              <button className="btn btn-primary" onClick={() => navigate('/explore')}>
                🔍 去探索
              </button>
            </div>
          ) : (
            holdings.map((h: Holding) => {
              const itemPL = (h.currentPrice - h.avgCost) * h.totalShares;
              const itemPLPct = ((h.currentPrice - h.avgCost) / h.avgCost * 100);
              const itemIsProfit = itemPL >= 0;
              return (
                <div
                  key={h.stockCode}
                  className="holding-item"
                  onClick={() => navigate(`/stock/${h.stockCode}`)}
                >
                  <div className="holding-left">
                    {aiSignals[h.stockCode] ? (
                      <div className="holding-emoji" style={{ display: 'flex', flexDirection: 'column', padding: '4px', background: '#f5f5f5', borderRadius: 8, textAlign: 'center' }}>
                        <span style={{ fontSize: '18px' }}>{aiSignals[h.stockCode].icon}</span>
                        <span style={{ fontSize: '10px', fontWeight: 800, color: aiSignals[h.stockCode].color }}>{aiSignals[h.stockCode].advice}</span>
                      </div>
                    ) : (
                      <div className="holding-emoji">{itemIsProfit ? '😊' : '😢'}</div>
                    )}
                    <div>
                      <div className="holding-name">{h.stockName}</div>
                      <div className="holding-code">{h.stockCode}</div>
                    </div>
                  </div>
                  <div className="holding-center">
                    <div className="holding-shares">{h.totalShares} 股</div>
                    <div className="holding-avg">成本 {formatPrice(h.avgCost)}</div>
                  </div>
                  <div className="holding-right">
                    <div className="holding-current">NT$ {formatPrice(h.currentPrice)}</div>
                    <div className={`holding-pl ${itemIsProfit ? 'text-profit' : 'text-loss'}`}>
                      {itemIsProfit ? '+' : ''}{formatMoney(itemPL)}
                    </div>
                    <div className={`holding-pl-pct ${itemIsProfit ? 'text-profit' : 'text-loss'}`}>
                      ({itemIsProfit ? '+' : ''}{itemPLPct.toFixed(1)}%)
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
    </div>
  );
}
