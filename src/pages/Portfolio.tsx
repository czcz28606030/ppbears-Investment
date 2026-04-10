import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getHoldings, getPortfolioSummary, getTrades, getUser, formatMoney, formatPrice } from '../store';
import type { Holding, Trade } from '../types';
import './Portfolio.css';

export default function Portfolio() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'holdings' | 'trades'>('holdings');
  const holdings = getHoldings();
  const trades = getTrades();
  const summary = getPortfolioSummary();
  const user = getUser();

  const pl = summary.totalProfitLoss;
  const isProfit = pl >= 0;

  return (
    <div className="portfolio">
      <div className="page-header">
        <h1 className="page-title">💼 我的庫存</h1>
      </div>

      {/* 總覽卡片 */}
      <div className={`card portfolio-summary-card ${isProfit ? 'card-profit' : 'card-primary'}`}>
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

      {/* 預算進度 */}
      <div className="card budget-card">
        <div className="budget-header">
          <span className="budget-label">💰 零用錢使用進度</span>
          <span className="budget-pct">
            {((1 - summary.cashBalance / user.totalBudget) * 100).toFixed(0)}% 已投資
          </span>
        </div>
        <div className="budget-bar">
          <div
            className="budget-bar-fill"
            style={{ width: `${((user.totalBudget - summary.cashBalance) / user.totalBudget * 100)}%` }}
          ></div>
        </div>
        <div className="budget-detail">
          <span>已投資 NT$ {formatMoney(user.totalBudget - summary.cashBalance)}</span>
          <span>總額度 NT$ {formatMoney(user.totalBudget)}</span>
        </div>
      </div>

      {/* 標籤切換 */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'holdings' ? 'active' : ''}`}
          onClick={() => setActiveTab('holdings')}
        >
          📊 持股 ({holdings.length})
        </button>
        <button
          className={`tab ${activeTab === 'trades' ? 'active' : ''}`}
          onClick={() => setActiveTab('trades')}
        >
          🕐 紀錄 ({trades.length})
        </button>
      </div>

      {/* 持股列表 */}
      {activeTab === 'holdings' && (
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
      )}

      {/* 交易紀錄 */}
      {activeTab === 'trades' && (
        <div className="trades-history">
          {trades.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📝</div>
              <div className="empty-state-title">還沒有交易紀錄</div>
              <div className="empty-state-desc">買或賣股票後，紀錄就會出現在這裡！</div>
            </div>
          ) : (
            trades.map((t: Trade) => {
              const date = new Date(t.timestamp);
              return (
                <div key={t.id} className="trade-history-item">
                  <div className={`trade-type-indicator ${t.tradeType === 'buy' ? 'buy' : 'sell'}`}>
                    {t.tradeType === 'buy' ? '買' : '賣'}
                  </div>
                  <div className="trade-history-info">
                    <div className="trade-history-name">{t.stockName}</div>
                    <div className="trade-history-detail">
                      {t.quantity}股 × NT${formatPrice(t.price)}
                    </div>
                    <div className="trade-history-date">
                      {date.toLocaleDateString('zh-TW')} {date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className={`trade-history-amount ${t.tradeType === 'buy' ? 'text-loss' : 'text-profit'}`}>
                    {t.tradeType === 'buy' ? '-' : '+'}NT$ {formatMoney(t.totalAmount)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
