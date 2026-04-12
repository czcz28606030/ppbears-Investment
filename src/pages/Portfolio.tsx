import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney, formatPrice } from '../store';
import type { Holding } from '../types';
import './Portfolio.css';

export default function Portfolio() {
  const navigate = useNavigate();
  const { holdings, getPortfolioSummary, user } = useStore();
  const summary = getPortfolioSummary();

  const pl = summary.totalProfitLoss;
  const isProfit = pl >= 0;

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

      <div className="section-header" style={{ marginTop: '24px', marginBottom: '16px' }}>
        <h2 className="section-title">📊 持股清單 ({holdings.length})</h2>
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
                    <div className="holding-emoji">{itemIsProfit ? '😊' : '😢'}</div>
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
