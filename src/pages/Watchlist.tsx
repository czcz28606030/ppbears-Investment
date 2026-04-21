import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatPrice } from '../store';
import { fetchStockData } from '../api';
import type { WatchlistSignal, WatchlistWarning } from '../types';
import './Watchlist.css';

export default function Watchlist() {
  const navigate = useNavigate();
  const {
    watchlist, watchlistSignals, watchlistWarnings, watchlistSignalsLoading,
    removeFromWatchlist, checkWatchlistSignals, fetchWatchlist,
  } = useStore();

  const [liveQuotes, setLiveQuotes] = useState<Record<string, { close: number; change: number }>>({});
  const [_quotesLoading, setQuotesLoading] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);

  // 進入頁面時抓取即時報價 + 訊號分析
  useEffect(() => {
    async function loadData() {
      await fetchWatchlist();
    }
    loadData();
  }, []);

  useEffect(() => {
    if (watchlist.length === 0) return;

    async function fetchQuotesAndSignals() {
      setQuotesLoading(true);

      // 平行抓取所有觀察股票的即時報價
      const stockDatas = await Promise.all(
        watchlist.map(w => fetchStockData(w.stockCode).catch(() => null))
      );

      const quotes: Record<string, { close: number; change: number }> = {};
      stockDatas.forEach((res, idx) => {
        if (res && res.prices && res.prices.length >= 2) {
          const latest = res.prices[res.prices.length - 1];
          const prev = res.prices[res.prices.length - 2];
          const close = parseFloat(latest.close_d);
          const prevClose = parseFloat(prev.close_d);

          const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
          const latestDateStr = (latest.mdate || '').replace(/-/g, '');
          const isToday = latestDateStr === todayStr;

          quotes[watchlist[idx].stockCode] = {
            close,
            change: isToday ? close - prevClose : 0,
          };
        }
      });
      setLiveQuotes(quotes);
      setQuotesLoading(false);

      // 訊號 + 警告分析
      await checkWatchlistSignals();
    }

    fetchQuotesAndSignals();
  }, [watchlist.length]);

  function getSignalForStock(stockCode: string): WatchlistSignal | undefined {
    return watchlistSignals.find(s => s.stockCode === stockCode);
  }

  function getWarningForStock(stockCode: string): WatchlistWarning | undefined {
    return watchlistWarnings.find(w => w.stockCode === stockCode);
  }

  function getSignalBadge(signal?: WatchlistSignal) {
    if (!signal) return <span className="wl-signal-badge wl-signal-none">⚪ 無訊號</span>;
    switch (signal.signalType) {
      case 'both':
        return <span className="wl-signal-badge wl-signal-both">🔥 雙重確認</span>;
      case 'ma5_support':
        return <span className="wl-signal-badge wl-signal-ma5">🟢 MA5 支撐</span>;
      case 'volume_shrink':
        return <span className="wl-signal-badge wl-signal-vol">🔵 縮量回檔</span>;
    }
  }

  async function handleRemove(stockCode: string) {
    await removeFromWatchlist(stockCode);
    setRemoveConfirm(null);
  }

  // 排序：有訊號 > 無訊號但無警告 > 有警告的排最後
  const sortedWatchlist = [...watchlist].sort((a, b) => {
    const sigA = getSignalForStock(a.stockCode);
    const sigB = getSignalForStock(b.stockCode);
    const warnA = getWarningForStock(a.stockCode);
    const warnB = getWarningForStock(b.stockCode);
    const priority = (s?: WatchlistSignal, w?: WatchlistWarning) => {
      if (s) return s.signalType === 'both' ? 10 : s.signalType === 'ma5_support' ? 9 : 8;
      if (!w) return 5;
      if (w.level === 'info') return 4;
      if (w.level === 'caution') return 2;
      return 1; // remove
    };
    return priority(sigB, warnB) - priority(sigA, warnA);
  });

  const signalCount = watchlistSignals.length;
  const warningCount = watchlistWarnings.filter(w => w.level === 'remove').length;

  return (
    <div className="watchlist-page">
      <div className="page-header">
        <h1 className="page-title">👁️ 觀察名單</h1>
      </div>

      {/* 訊號摘要 */}
      {signalCount > 0 && (
        <div className="wl-alert-banner">
          <div className="wl-alert-icon">🔔</div>
          <div className="wl-alert-text">
            <div className="wl-alert-title">有 {signalCount} 檔股票出現進場訊號！</div>
            <div className="wl-alert-desc">往下查看詳細分析</div>
          </div>
        </div>
      )}

      {/* 建議移除摘要 */}
      {warningCount > 0 && (
        <div className="wl-warn-banner">
          <div className="wl-alert-icon">⚠️</div>
          <div className="wl-alert-text">
            <div className="wl-warn-title">有 {warningCount} 檔股票建議移除</div>
            <div className="wl-alert-desc">已持有或趨勢破壞的股票，請檢視後決定</div>
          </div>
        </div>
      )}

      {watchlistSignalsLoading && watchlist.length > 0 && (
        <div className="wl-loading-bar">
          <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }}></span>
          正在分析 MA5 與量能訊號...
        </div>
      )}

      {/* 空狀態 */}
      {watchlist.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">👁️</div>
          <div className="empty-state-title">觀察名單是空的</div>
          <div className="empty-state-desc">
            去「找股票」頁面，點選感興趣的股票加入觀察名單吧！
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/explore')}>
            🔍 開始探索
          </button>
        </div>
      )}

      {/* 觀察清單 */}
      {sortedWatchlist.length > 0 && (
        <div className="wl-list">
          {sortedWatchlist.map((w) => {
            const signal = getSignalForStock(w.stockCode);
            const warning = getWarningForStock(w.stockCode);
            const quote = liveQuotes[w.stockCode];
            const currentPrice = quote?.close || w.addedPrice;
            const changeFromAdded = w.addedPrice > 0
              ? ((currentPrice - w.addedPrice) / w.addedPrice) * 100
              : 0;
            const isUp = changeFromAdded >= 0;
            const todayChange = quote?.change || 0;
            const todayIsUp = todayChange >= 0;

            return (
              <div
                key={w.stockCode}
                className={`wl-card ${signal ? `wl-card-signal wl-card-${signal.signalType}` : ''} ${warning ? `wl-card-warn wl-card-warn-${warning.level}` : ''}`}
                onClick={() => navigate(`/stock/${w.stockCode}`)}
              >
                {/* 訊號指示條 */}
                {signal && <div className={`wl-signal-stripe wl-stripe-${signal.signalType}`} />}
                {!signal && warning && warning.level === 'remove' && <div className="wl-signal-stripe wl-stripe-remove" />}

                <div className="wl-card-header">
                  <div className="wl-stock-info">
                    <div className="wl-stock-name">{w.stockName}</div>
                    <div className="wl-stock-code">{w.stockCode}</div>
                  </div>
                  <div className="wl-price-info">
                    <div className={`wl-price ${todayIsUp ? 'text-profit' : 'text-loss'}`}>
                      NT$ {formatPrice(currentPrice)}
                    </div>
                    {todayChange !== 0 && (
                      <div className={`wl-change ${todayIsUp ? 'text-profit' : 'text-loss'}`}>
                        {todayIsUp ? '▲' : '▼'} {formatPrice(Math.abs(todayChange))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="wl-card-body">
                  <div className="wl-meta-row">
                    <span className="wl-meta-label">加入價</span>
                    <span className="wl-meta-value">NT$ {formatPrice(w.addedPrice)}</span>
                  </div>
                  <div className="wl-meta-row">
                    <span className="wl-meta-label">自加入漲跌</span>
                    <span className={`wl-meta-value ${isUp ? 'text-profit' : 'text-loss'}`}>
                      {isUp ? '+' : ''}{changeFromAdded.toFixed(2)}%
                    </span>
                  </div>
                  <div className="wl-meta-row">
                    {getSignalBadge(signal)}
                  </div>
                </div>

                {/* 進場訊號提醒 */}
                {signal && (
                  <div className={`wl-signal-box wl-signal-box-${signal.signalType}`}>
                    <div className="wl-signal-message">{signal.message}</div>
                    <div className="wl-signal-detail">
                      MA5: {signal.ma5} ｜ 量能變化: {signal.volumeChange > 0 ? '+' : ''}{signal.volumeChange}%
                    </div>
                  </div>
                )}

                {/* ⚠️ 警告提醒 */}
                {warning && (
                  <div className={`wl-warning-box wl-warning-${warning.level}`}>
                    <div className="wl-warning-header">
                      <span className="wl-warning-icon">{warning.icon}</span>
                      <span className="wl-warning-title">{warning.title}</span>
                    </div>
                    <div className="wl-warning-message">{warning.message}</div>
                    {warning.level === 'remove' && (
                      <button
                        className="wl-warning-remove-btn"
                        onClick={(e) => { e.stopPropagation(); handleRemove(w.stockCode); }}
                      >
                        一鍵移除
                      </button>
                    )}
                  </div>
                )}

                {/* 移除按鈕 */}
                <div className="wl-card-actions">
                  {removeConfirm === w.stockCode ? (
                    <div className="wl-remove-confirm">
                      <span>確定移除？</span>
                      <button className="wl-confirm-yes" onClick={(e) => { e.stopPropagation(); handleRemove(w.stockCode); }}>是</button>
                      <button className="wl-confirm-no" onClick={(e) => { e.stopPropagation(); setRemoveConfirm(null); }}>否</button>
                    </div>
                  ) : (
                    <button
                      className="wl-remove-btn"
                      onClick={(e) => { e.stopPropagation(); setRemoveConfirm(w.stockCode); }}
                    >
                      移除
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 訊號說明 */}
      {watchlist.length > 0 && (
        <div className="wl-legend">
          <div className="wl-legend-title">📖 訊號與警告說明</div>
          <div className="wl-legend-section">進場訊號</div>
          <div className="wl-legend-item">
            <span className="wl-signal-badge wl-signal-both">🔥 雙重確認</span>
            <span>MA5 支撐 + 縮量回檔同時觸發，最強進場訊號</span>
          </div>
          <div className="wl-legend-item">
            <span className="wl-signal-badge wl-signal-ma5">🟢 MA5 支撐</span>
            <span>股價回測 5 日均線後站穩，跌不破就是支撐確認</span>
          </div>
          <div className="wl-legend-item">
            <span className="wl-signal-badge wl-signal-vol">🔵 縮量回檔</span>
            <span>成交量萎縮且跌幅小，代表賣壓減輕的整理訊號</span>
          </div>
          <div className="wl-legend-section" style={{ marginTop: 12 }}>移除建議</div>
          <div className="wl-legend-item">
            <span className="wl-signal-badge wl-warn-badge-remove">🚨 建議移除</span>
            <span>已持有或從加入價跌超過 15%，趨勢已破壞</span>
          </div>
          <div className="wl-legend-item">
            <span className="wl-signal-badge wl-warn-badge-caution">⏰ 注意</span>
            <span>觀察超過 30 天未進場，機會可能已過</span>
          </div>
          <div className="wl-legend-item">
            <span className="wl-signal-badge wl-warn-badge-info">💡 提醒</span>
            <span>已觀察超過 2 週，是否該做決定？</span>
          </div>
        </div>
      )}
    </div>
  );
}
