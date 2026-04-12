import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney } from '../store';
import './TradeHistory.css';

export default function TradeHistory() {
  const navigate = useNavigate();
  const { trades } = useStore();
  const [search, setSearch] = useState('');

  const filteredTrades = useMemo(() => {
    if (!search.trim()) return trades;
    const q = search.trim().toLowerCase();
    return trades.filter(t => 
      t.stockCode.includes(q) || 
      t.stockName.toLowerCase().includes(q) ||
      (t.reason && t.reason.toLowerCase().includes(q))
    );
  }, [trades, search]);

  const openYahooChart = (stockCode: string) => {
    // 導向至 Yahoo 奇摩股市技術分析頁面
    window.open(`https://tw.stock.yahoo.com/quote/${stockCode}.TW/technical-analysis`, '_blank');
  };

  return (
    <div className="trade-history-page">
      <div className="page-header" style={{ justifyContent: 'space-between' }}>
        <button className="page-header-back" onClick={() => navigate(-1)}>←</button>
        <h1 className="page-title">🕒 交易紀錄與筆記</h1>
        <div style={{ width: 40 }}></div> {/* placeholder for centering */}
      </div>

      <div className="history-search-bar">
        <span style={{ marginRight: 8 }}>🔎</span>
        <input 
          type="text" 
          placeholder="搜尋股票名稱、代號或筆記..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filteredTrades.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📝</div>
          <div className="empty-state-title">還沒有交易紀錄</div>
          <div className="empty-state-desc">當你買賣股票時，記得寫下投資筆記喔！</div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/explore')}>
            去逛逛股票
          </button>
        </div>
      ) : (
        <div className="trade-history-list">
          {filteredTrades.map(t => (
            <div key={t.id} className="trade-item-expanded">
              <div className="trade-item-header">
                <div className="trade-item-info">
                  <div className={`trade-type-badge ${t.tradeType}`}>
                    {t.tradeType === 'buy' && '買入'}
                    {t.tradeType === 'sell' && '賣出'}
                    {t.tradeType === 'deposit' && '入金'}
                    {t.tradeType === 'withdraw' && '出金'}
                  </div>
                  <div className="trade-item-stock">
                    <span className="trade-item-stock-name">{t.stockName} <span style={{ opacity: 0.5, fontSize: '13px' }}>{t.stockCode}</span></span>
                    <span className="trade-item-date">{new Date(t.timestamp).toLocaleString()}</span>
                  </div>
                </div>
                <div className="trade-item-price-block">
                  <div className={`trade-item-total ${t.tradeType === 'deposit' ? 'text-profit' : t.tradeType === 'withdraw' ? 'text-loss' : ''}`}>
                    {t.tradeType === 'deposit' ? '+ ' : t.tradeType === 'withdraw' ? '- ' : ''}NT$ {formatMoney(t.totalAmount)}
                  </div>
                  {(t.tradeType === 'buy' || t.tradeType === 'sell') && (
                    <div className="trade-item-detail">{t.quantity} 股 × NT$ {t.price}</div>
                  )}
                  {t.profit !== undefined && t.profit !== null && (
                    <div style={{ marginTop: 6, fontWeight: 800, fontSize: 13 }} className={t.profit >= 0 ? 'text-profit' : 'text-loss'}>
                      {t.profit >= 0 ? `賺 NT$ ${formatMoney(t.profit)} 📈` : `虧 NT$ ${formatMoney(Math.abs(t.profit))} 📉`}
                    </div>
                  )}
                </div>
              </div>

              {t.reason && (
                <div className="trade-reason-box">
                  <span className="trade-reason-label">🐻 投資筆記：</span>
                  {t.reason}
                </div>
              )}

              {(t.tradeType === 'buy' || t.tradeType === 'sell') && (
                <div className="trade-action-bar">
                  <button className="btn-yahoo-chart" onClick={() => openYahooChart(t.stockCode)}>
                    📈 查看當時技術線圖
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
