import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney, formatPrice } from '../store';
import type { Holding, Trade, TradeAttachment } from '../types';
import './TradeHistory.css';

type RangeKey = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL' | 'CUSTOM';

type TradeStockGroup = {
  stockCode: string;
  stockName: string;
  trades: Trade[];
  latestTimestamp: number;
  buyCount: number;
  sellCount: number;
  attachmentCount: number;
  totalBuyCost: number;
  realizedProfit: number;
  unrealizedProfit: number;
  cumulativeProfit: number;
  cumulativeReturnPct: number | null;
  holding?: Holding;
  isClosed: boolean;
  matchedByFilter: boolean;
};

function getRangeStart(key: RangeKey): Date | null {
  const now = new Date();
  if (key === '1W') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  if (key === '1M') return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  if (key === '3M') return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  if (key === '6M') return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
  if (key === '1Y') return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  return null;
}

function isStockTrade(trade: Trade): boolean {
  return trade.tradeType === 'buy' || trade.tradeType === 'sell';
}

function isCashTrade(trade: Trade): boolean {
  return trade.tradeType === 'deposit' || trade.tradeType === 'withdraw';
}

function isInSelectedRange(trade: Trade, rangeKey: RangeKey, customFrom: string, customTo: string): boolean {
  let from: Date | null = null;
  let to: Date | null = null;

  if (rangeKey === 'CUSTOM') {
    if (customFrom) from = new Date(customFrom);
    if (customTo) {
      to = new Date(customTo);
      to.setHours(23, 59, 59, 999);
    }
  } else {
    from = getRangeStart(rangeKey);
  }

  const date = new Date(trade.timestamp);
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function formatReturnPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function buildStockGroups(trades: Trade[], holdings: Holding[], visibleTradeIds: Set<string>): TradeStockGroup[] {
  const holdingMap = new Map(holdings.map(h => [h.stockCode, h]));
  const map = new Map<string, TradeStockGroup>();

  trades.filter(isStockTrade).forEach(trade => {
    const existing = map.get(trade.stockCode);
    const group = existing || {
      stockCode: trade.stockCode,
      stockName: trade.stockName,
      trades: [],
      latestTimestamp: trade.timestamp,
      buyCount: 0,
      sellCount: 0,
      attachmentCount: 0,
      totalBuyCost: 0,
      realizedProfit: 0,
      unrealizedProfit: 0,
      cumulativeProfit: 0,
      cumulativeReturnPct: null,
      holding: holdingMap.get(trade.stockCode),
      isClosed: !holdingMap.get(trade.stockCode),
      matchedByFilter: false,
    } satisfies TradeStockGroup;

    group.trades.push(trade);
    group.latestTimestamp = Math.max(group.latestTimestamp, trade.timestamp);
    group.attachmentCount += trade.attachments?.length || 0;
    group.matchedByFilter = group.matchedByFilter || visibleTradeIds.has(trade.id);
    if (trade.tradeType === 'buy') {
      group.buyCount += 1;
      group.totalBuyCost += trade.totalAmount;
    } else if (trade.tradeType === 'sell') {
      group.sellCount += 1;
      group.realizedProfit += Number(trade.profit) || 0;
    }
    map.set(trade.stockCode, group);
  });

  return [...map.values()].map(group => {
    const holding = holdingMap.get(group.stockCode);
    const unrealizedProfit = holding ? (holding.currentPrice - holding.avgCost) * holding.totalShares : 0;
    const cumulativeProfit = group.realizedProfit + unrealizedProfit;
    return {
      ...group,
      holding,
      isClosed: !holding || holding.totalShares <= 0,
      trades: [...group.trades].sort((a, b) => b.timestamp - a.timestamp),
      unrealizedProfit,
      cumulativeProfit,
      cumulativeReturnPct: group.totalBuyCost > 0 ? (cumulativeProfit / group.totalBuyCost) * 100 : null,
    };
  }).sort((a, b) => b.latestTimestamp - a.latestTimestamp);
}

export default function TradeHistory() {
  const navigate = useNavigate();
  const { trades, holdings, updateTradeNote, uploadTradeAttachments, deleteTradeAttachment } = useStore();
  const [search, setSearch] = useState('');
  const [rangeKey, setRangeKey] = useState<RangeKey>('ALL');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [expandedStockCode, setExpandedStockCode] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<TradeAttachment | null>(null);
  const [uploadingTradeId, setUploadingTradeId] = useState<string | null>(null);

  const rangeFilteredTrades = useMemo(() => (
    trades.filter(t => isInSelectedRange(t, rangeKey, customFrom, customTo))
  ), [trades, rangeKey, customFrom, customTo]);

  const visibleTradeIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = rangeFilteredTrades.filter(t => {
      if (!q) return true;
      return t.stockCode.includes(q) ||
        t.stockName.toLowerCase().includes(q) ||
        (t.reason && t.reason.toLowerCase().includes(q));
    });
    return new Set(visible.map(t => t.id));
  }, [rangeFilteredTrades, search]);

  const visibleStockGroups = useMemo(() => (
    buildStockGroups(trades, holdings, visibleTradeIds).filter(group => group.matchedByFilter)
  ), [trades, holdings, visibleTradeIds]);

  const cashTrades = useMemo(() => (
    rangeFilteredTrades
      .filter(t => isCashTrade(t) && visibleTradeIds.has(t.id))
      .sort((a, b) => b.timestamp - a.timestamp)
  ), [rangeFilteredTrades, visibleTradeIds]);

  const stats = useMemo(() => {
    let netProfit = 0;
    let winCount = 0;
    let lossCount = 0;
    let tradeCount = 0;
    rangeFilteredTrades.forEach(t => {
      if (!isStockTrade(t) || !visibleTradeIds.has(t.id)) return;
      tradeCount += 1;
      if (t.tradeType === 'sell' && t.profit !== undefined && t.profit !== null) {
        netProfit += t.profit;
        if (t.profit > 0) winCount += 1;
        else if (t.profit < 0) lossCount += 1;
      }
    });
    return { netProfit, winCount, lossCount, tradeCount };
  }, [rangeFilteredTrades, visibleTradeIds]);

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

  const handleUploadAttachments = async (trade: Trade, fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploadingTradeId(trade.id);
    const result = await uploadTradeAttachments(trade.id, trade.stockCode, files, 'manual');
    setUploadingTradeId(null);
    if (result.error) alert(result.error);
  };

  const handleDeleteAttachment = async (attachment: TradeAttachment) => {
    if (!confirm(`確定刪除附件「${attachment.fileName}」嗎？`)) return;
    const result = await deleteTradeAttachment(attachment.id);
    if (result.error) alert(result.error);
  };

  const renderTradeTimelineItem = (t: Trade) => (
    <div key={t.id} className="trade-timeline-item">
      <div className="trade-timeline-rail">
        <span className={`trade-type-badge ${t.tradeType}`}>
          {t.tradeType === 'buy' && '買入'}
          {t.tradeType === 'sell' && '賣出'}
          {t.tradeType === 'deposit' && '入金'}
          {t.tradeType === 'withdraw' && '出金'}
        </span>
      </div>
      <div className="trade-timeline-content">
        <div className="trade-item-header">
          <div className="trade-item-stock">
            <span className="trade-item-date">{new Date(t.timestamp).toLocaleString()}</span>
            {(t.tradeType === 'buy' || t.tradeType === 'sell') && (
              <span className="trade-item-detail">{t.quantity.toLocaleString('zh-TW')} 股 × NT$ {formatPrice(t.price)}</span>
            )}
          </div>
          <div className="trade-item-price-block">
            <div className={`trade-item-total ${t.tradeType === 'deposit' ? 'text-profit' : t.tradeType === 'withdraw' ? 'text-loss' : ''}`}>
              {t.tradeType === 'deposit' ? '+ ' : t.tradeType === 'withdraw' ? '- ' : ''}NT$ {formatMoney(t.totalAmount)}
            </div>
            {t.profit !== undefined && t.profit !== null && (
              <div className={`trade-item-profit ${t.profit >= 0 ? 'text-profit' : 'text-loss'}`}>
                {t.profit >= 0 ? `賺 NT$ ${formatMoney(t.profit)}` : `虧 NT$ ${formatMoney(Math.abs(t.profit))}`}
              </div>
            )}
          </div>
        </div>

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
                {saving ? '儲存中...' : '儲存'}
              </button>
              <button className="btn-note-cancel" onClick={cancelEdit}>取消</button>
            </div>
          </div>
        ) : (
          <div className="trade-reason-box" onClick={() => startEdit(t.id, t.reason)}>
            <span className="trade-reason-label">投資心得 <span className="trade-note-edit-hint">（點擊編輯）</span></span>
            {t.reason ? t.reason : <span className="trade-note-empty">尚未填寫，點此記錄心得...</span>}
          </div>
        )}

        {(t.attachments || []).length > 0 && (
          <div className="trade-attachments-grid">
            {(t.attachments || []).map(att => (
              <div key={att.id} className={`trade-attachment-card ${att.kind}`}>
                {att.mimeType.startsWith('image/') ? (
                  <button type="button" className="trade-attachment-thumb" onClick={() => setPreviewAttachment(att)}>
                    {att.signedUrl ? <img src={att.signedUrl} alt={att.fileName} /> : <span>圖片</span>}
                  </button>
                ) : (
                  <a className="trade-attachment-pdf" href={att.signedUrl} target="_blank" rel="noreferrer">
                    <span>PDF</span>
                    <strong>{att.fileName}</strong>
                  </a>
                )}
                <div className="trade-attachment-meta">
                  <span>{att.kind === 'auto_snapshot' ? '自動快照' : '補充附件'}</span>
                  {att.kind === 'manual' && (
                    <button type="button" onClick={() => handleDeleteAttachment(att)}>刪除</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {(t.tradeType === 'buy' || t.tradeType === 'sell') && (
          <div className="trade-action-bar">
            <button className="btn-stock-detail" onClick={() => navigate(`/stock/${t.stockCode}`)}>
              查看個股內容
            </button>
            <label className="btn-attach-upload">
              {uploadingTradeId === t.id ? '上傳中...' : '＋ 補充附件'}
              <input
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                multiple
                disabled={uploadingTradeId === t.id}
                onChange={e => {
                  handleUploadAttachments(t, e.target.files);
                  e.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );

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
        <h1 className="page-title">交易紀錄與筆記</h1>
        <div style={{ width: 40 }} />
      </div>

      <div className="th-range-bar">
        {RANGE_LABELS.map(r => (
          <button
            key={r.key}
            className={`th-range-btn${rangeKey === r.key ? ' active' : ''}`}
            onClick={() => setRangeKey(r.key)}
          >{r.label}</button>
        ))}
      </div>

      {rangeKey === 'CUSTOM' && (
        <div className="th-custom-range">
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
          <span>～</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
        </div>
      )}

      <div className={`th-stats-card ${stats.netProfit >= 0 ? 'profit' : 'loss'}`}>
        <div className="th-stats-main">
          <span className="th-stats-label">區間已實現損益</span>
          <span className={`th-stats-value ${stats.netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
            {stats.netProfit >= 0 ? '+' : ''}NT$ {formatMoney(stats.netProfit)}
          </span>
        </div>
        <div className="th-stats-sub">
          <span className="th-stats-win">勝 {stats.winCount} 筆</span>
          <span className="th-stats-loss">敗 {stats.lossCount} 筆</span>
          <span className="th-stats-total">{visibleStockGroups.length} 檔・{stats.tradeCount} 筆</span>
        </div>
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

      {visibleStockGroups.length === 0 && cashTrades.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📝</div>
          <div className="empty-state-title">此區間沒有交易紀錄</div>
          <div className="empty-state-desc">換個日期區間或搜尋關鍵字試試看</div>
        </div>
      ) : (
        <div className="trade-stock-folder-list">
          {visibleStockGroups.map(group => {
            const expanded = expandedStockCode === group.stockCode;
            return (
              <section key={group.stockCode} className={`trade-stock-folder ${expanded ? 'expanded' : ''}`}>
                <button
                  type="button"
                  className="trade-stock-folder-summary"
                  onClick={() => setExpandedStockCode(expanded ? null : group.stockCode)}
                >
                  <div className="trade-stock-folder-main">
                    <span className={`trade-stock-status ${group.isClosed ? 'closed' : 'holding'}`}>
                      {group.isClosed ? '已結束' : '持有中'}
                    </span>
                    <strong>{group.stockName}</strong>
                    <span>{group.stockCode}</span>
                  </div>
                  <div className="trade-stock-folder-metrics">
                    <div>
                      <span>累積損益</span>
                      <strong className={group.cumulativeProfit >= 0 ? 'text-profit' : 'text-loss'}>
                        {group.cumulativeProfit >= 0 ? '+' : ''}NT$ {formatMoney(group.cumulativeProfit)}
                      </strong>
                    </div>
                    <div>
                      <span>投報率</span>
                      <strong className={(group.cumulativeReturnPct || 0) >= 0 ? 'text-profit' : 'text-loss'}>{formatReturnPct(group.cumulativeReturnPct)}</strong>
                    </div>
                    <div>
                      <span>交易</span>
                      <strong>{group.buyCount}買 / {group.sellCount}賣</strong>
                    </div>
                  </div>
                  <div className="trade-stock-folder-side">
                    <span>{new Date(group.latestTimestamp).toLocaleDateString('zh-TW')}</span>
                    <strong>{expanded ? '收合' : '展開'}</strong>
                  </div>
                </button>

                <div className="trade-stock-folder-extra">
                  <div>
                    <span>目前庫存</span>
                    <strong>{group.holding ? `${group.holding.totalShares.toLocaleString('zh-TW')} 股` : '0 股'}</strong>
                  </div>
                  <div>
                    <span>平均成本</span>
                    <strong>{group.holding ? `NT$ ${formatPrice(group.holding.avgCost)}` : '--'}</strong>
                  </div>
                  <div>
                    <span>未實現損益</span>
                    <strong className={group.unrealizedProfit >= 0 ? 'text-profit' : 'text-loss'}>
                      {group.unrealizedProfit >= 0 ? '+' : ''}NT$ {formatMoney(group.unrealizedProfit)}
                    </strong>
                  </div>
                  <div>
                    <span>附件</span>
                    <strong>{group.attachmentCount} 個</strong>
                  </div>
                </div>

                {expanded && (
                  <div className="trade-stock-timeline">
                    {group.trades.map(renderTradeTimelineItem)}
                  </div>
                )}
              </section>
            );
          })}

          {cashTrades.length > 0 && (
            <section className="trade-cash-folder">
              <div className="trade-cash-folder-title">資金紀錄</div>
              <div className="trade-stock-timeline">
                {cashTrades.map(renderTradeTimelineItem)}
              </div>
            </section>
          )}
        </div>
      )}

      {previewAttachment && (
        <div className="trade-attachment-lightbox" onClick={() => setPreviewAttachment(null)}>
          <div className="trade-attachment-lightbox-inner" onClick={e => e.stopPropagation()}>
            <button type="button" className="trade-attachment-lightbox-close" onClick={() => setPreviewAttachment(null)}>×</button>
            {previewAttachment.signedUrl && <img src={previewAttachment.signedUrl} alt={previewAttachment.fileName} />}
            <div>{previewAttachment.fileName}</div>
          </div>
        </div>
      )}
    </div>
  );
}
