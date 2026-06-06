import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney, formatPrice } from '../store';
import './TradeHistory.css';

function formatDate(value: string | undefined): string {
  if (!value) return '-';
  return new Date(`${value}T00:00:00+08:00`).toLocaleDateString('zh-TW');
}

export default function DividendHistory() {
  const navigate = useNavigate();
  const { dividendPayments, fetchDividendPayments } = useStore();

  useEffect(() => {
    fetchDividendPayments();
  }, [fetchDividendPayments]);

  const stats = useMemo(() => {
    return dividendPayments.reduce(
      (acc, item) => {
        if (item.status === 'paid') acc.paid += item.amount;
        else if (item.status === 'scheduled') acc.scheduled += item.amount;
        return acc;
      },
      { paid: 0, scheduled: 0 }
    );
  }, [dividendPayments]);

  return (
    <div className="trade-history-page">
      <div className="page-header" style={{ justifyContent: 'space-between' }}>
        <button className="page-header-back" onClick={() => navigate(-1)}>←</button>
        <h1 className="page-title">股利入帳紀錄</h1>
        <div style={{ width: 40 }} />
      </div>

      <div className="th-stats-card profit">
        <div className="th-stats-main">
          <span className="th-stats-label">已入帳股利</span>
          <span className="th-stats-value text-profit">+NT$ {formatMoney(stats.paid)}</span>
        </div>
        <div className="th-stats-sub">
          <span>待發放 NT$ {formatMoney(stats.scheduled)}</span>
          <span>共 {dividendPayments.length} 筆</span>
        </div>
      </div>

      {dividendPayments.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">💰</div>
          <div className="empty-state-title">還沒有股利入帳紀錄</div>
          <div className="empty-state-desc">排程抓到真實發放日後，會在這裡建立待發放或已入帳紀錄。</div>
        </div>
      ) : (
        <div className="trade-history-list">
          {dividendPayments.map(item => (
            <div key={item.id} className="trade-item-expanded">
              <div className="trade-item-header">
                <div className="trade-item-info">
                  <div className={`trade-type-badge ${item.status === 'paid' ? 'deposit' : 'buy'}`}>
                    {item.status === 'paid' ? '已入帳' : '待發放'}
                  </div>
                  <div className="trade-item-stock">
                    <span className="trade-item-stock-name">
                      {item.stockName} <span style={{ opacity: 0.5, fontSize: 13 }}>{item.stockCode}</span>
                    </span>
                    <span className="trade-item-date">發放日：{formatDate(item.payDate)}</span>
                  </div>
                </div>
                <div className="trade-item-price-block">
                  <div className={`trade-item-total ${item.status === 'paid' ? 'text-profit' : ''}`}>
                    {item.status === 'paid' ? '+ ' : ''}NT$ {formatMoney(item.amount)}
                  </div>
                  <div className="trade-item-detail">
                    {formatMoney(item.eligibleShares)} 股 × NT$ {formatPrice(item.cashDividend)}
                  </div>
                </div>
              </div>

              <div className="trade-reason-box">
                <span className="trade-reason-label">配息資格</span>
                除息日 {formatDate(item.exDate)}，最後買進日 {formatDate(item.lastBuyDate)}。系統以除息日前一日收盤後持股數計算。
                {item.paidAt && (
                  <div style={{ marginTop: 8, color: 'var(--profit-color)', fontWeight: 800 }}>
                    入帳時間：{new Date(item.paidAt).toLocaleString('zh-TW')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
