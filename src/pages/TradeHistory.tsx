import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney } from '../store';
import './TradeHistory.css';

type RangeKey = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL' | 'CUSTOM';

function getRangeStart(key: RangeKey): Date | null {
  const now = new Date();
  if (key === '1W') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  if (key === '1M') return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  if (key === '3M') return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  if (key === '6M') return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
  if (key === '1Y') return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  return null;
}

export default function TradeHistory() {
  const navigate = useNavigate();
  const { trades, updateTradeNote } = useStore();
  const [search, setSearch] = useState('');
  const [rangeKey, setRangeKey] = useState<RangeKey>('ALL');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // 每筆筆記的編輯狀態
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  // 計算篩選後的交易
  const filteredTrades = useMemo(() => {
    let list = trades;

    // 搜尋過濾
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(t =>
        t.stockCode.includes(q) ||
        t.stockName.toLowerCase().includes(q) ||
        (t.reason && t.reason.toLowerCase().includes(q))
      );
    }

    // 日期區間過濾
    let from: Date | null = null;
    let to: Date | null = null;

    if (rangeKey === 'CUSTOM') {
      if (customFrom) from = new Date(customFrom);
      if (customTo) { to = new Date(customTo); to.setHours(23, 59, 59, 999); }
    } else {
      from = getRangeStart(rangeKey);
    }

    if (from) list = list.filter(t => new Date(t.timestamp) >= from!);
    if (to)   list = list.filter(t => new Date(t.timestamp) <= to!);

    return list;
  }, [trades, search, rangeKey, customFrom, customTo]);

  // 統計：只計算有 profit 的賣出紀錄
  const stats = useMemo(() => {
    let netProfit = 0;
    let winCount = 0;
    let lossCount = 0;
    filteredTrades.forEach(t => {
      if (t.tradeType === 'sell' && t.profit !== undefined && t.profit !== null) {
        netProfit += t.profit;
        if (t.profit > 0) winCount++;
        else if (t.profit < 0) lossCount++;
      }
    });
    return { netProfit, winCount, lossCount };
  }, [filteredTrades]);

  const openYahooChart = (stockCode: string) => {
    window.open(`https://tw.stock.yahoo.com/quote/${stockCode}.TW/technical-analysis`, '_blank');
  };

  const startEdit = (tradeId: string, currentNote: string | undefined) => {
    setEditingId(tradeId);
    setEditText(currentNote ?? '');
  };

  const cancelEdit = () => { setEditingId(null); setEditText(''); };

  const saveNote = async (tradeId: string) => {
    setSaving(true);
    await updateTradeNote(tradeId, editText.trim());
    setSaving(false);
    setEditingId(null);
  };

  const RANGE_LABELS: { key: RangeKey; label: string }[] = [
    { key: '1W', label: '1 週' },
    { key: '1M', label: '1 月' },
    { key: '3M', label: '1 季' },
    { key: '6M', label: '半年' },
    { key: '1Y', label: '1 年' },
    { key: 'ALL', label: '全部' },
    { key: 'CUSTOM', label: '自訂' },
  ];

  return (
    <div className="trade-history-page">
      <div className="page-header" style={{ justifyContent: 'space-between' }}>
        <button className="page-header-back" onClick={() => navigate(-1)}>←</button>
        <h1 className="page-title">🕒 交易紀錄與筆記</h1>
        <div style={{ width: 40 }}></div>
      </div>

      {/* ── 日期快選列 ── */}
      <div className="th-range-bar">
        {RANGE_LABELS.map(r => (
          <button
            key={r.key}
            className={`th-range-btn${rangeKey === r.key ? ' active' : ''}`}
            onClick={() => setRangeKey(r.key)}
          >{r.label}</button>
        ))}
      </div>

      {/* ── 自訂日期區間 ── */}
      {rangeKey === 'CUSTOM' && (
        <div className="th-custom-range">
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
          <span>～</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
        </div>
      )}

      {/* ── 統計摘要卡 ── */}
      <div className={`th-stats-card ${stats.netProfit >= 0 ? 'profit' : 'loss'}`}>
        <div className="th-stats-main">
          <span className="th-stats-label">區間淨損益</span>
          <span className={`th-stats-value ${stats.netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
            {stats.netProfit >= 0 ? '+' : ''}NT$ {formatMoney(stats.netProfit)}
          </span>
        </div>
        <div className="th-stats-sub">
          <span className="th-stats-win">勝 {stats.winCount} 筆</span>
          <span className="th-stats-loss">敗 {stats.lossCount} 筆</span>
          <span className="th-stats-total">共 {filteredTrades.length} 筆</span>
        </div>
      </div>

      {/* ── 搜尋欄 ── */}
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
          <div className="empty-state-title">此區間沒有交易紀錄</div>
          <div className="empty-state-desc">換個日期區間或搜尋關鍵字試試看</div>
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

              {/* ── 投資筆記 / 心得 ── */}
              {editingId === t.id ? (
                <div className="trade-note-edit">
                  <textarea
                    className="trade-note-textarea"
                    rows={3}
                    placeholder="記錄你的交易心得、策略想法..."
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    autoFocus
                  />
                  <div className="trade-note-edit-actions">
                    <button className="btn-note-save" onClick={() => saveNote(t.id)} disabled={saving}>
                      {saving ? '儲存中...' : '✅ 儲存'}
                    </button>
                    <button className="btn-note-cancel" onClick={cancelEdit}>取消</button>
                  </div>
                </div>
              ) : (
                <div className="trade-reason-box" onClick={() => startEdit(t.id, t.reason)}>
                  <span className="trade-reason-label">🐻 投資心得 <span className="trade-note-edit-hint">（點擊編輯）</span></span>
                  {t.reason ? t.reason : <span className="trade-note-empty">尚未填寫，點此記錄心得...</span>}
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
