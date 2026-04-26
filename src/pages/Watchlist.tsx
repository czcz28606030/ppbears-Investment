import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatPrice } from '../store';
import { fetchSimonsData, fetchStockData, fetchStockQuantData, toRecommendation } from '../api';
import type { StockQuantData } from '../api';
import type { AIAdvice, SimonsItem, StockRecommendation, WatchlistSignal, WatchlistWarning } from '../types';
import { getCache, setCache, clearCache, getCacheTTL, CACHE_KEYS } from '../cache';
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
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<string | null>(null);
  const [latestKlineDate, setLatestKlineDate] = useState<string | null>(null);
  const [industryMap, setIndustryMap] = useState<Record<string, string>>({});
  const [quantDataMap, setQuantDataMap] = useState<Record<string, StockQuantData>>({});
  const [simonsRecMap, setSimonsRecMap] = useState<Record<string, StockRecommendation>>({});
  const [filterSignalOnly, setFilterSignalOnly] = useState(false); // 只顯示有訊號的
  const [filterWarnOnly, setFilterWarnOnly] = useState(false);   // 只顯示建議移除的
  const [filterAiSignal, setFilterAiSignal] = useState<'all' | 'buy' | 'neutral' | 'sell'>('all'); // AI 進出場訊號篩選
  const [dataLoading, setDataLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('正在連線...');

  // 進入頁面時抓取即時報價 + 訊號分析
  useEffect(() => {
    async function loadData() {
      await fetchWatchlist();
    }
    loadData();
  }, []);

  useEffect(() => {
    if (watchlist.length === 0) return;

    // 檢查快取（TTL 5 分鐘）
    type WatchlistCacheData = {
      quotes: Record<string, { close: number; change: number }>;
      industryMap: Record<string, string>;
      quantDataMap: Record<string, StockQuantData>;
      simonsRecMap: Record<string, StockRecommendation>;
      latestKlineDate: string;
      analyzedAt: string;
      watchlistKeys: string; // 用來檢測觀察名單是否變更
    };
    const cacheKey = CACHE_KEYS.WATCHLIST_FULL;
    const watchlistKeys = watchlist.map(w => w.stockCode).sort().join(',');
    const cached = getCache<WatchlistCacheData>(cacheKey);
    if (cached && cached.watchlistKeys === watchlistKeys) {
      // 資料未過期且觀察名單未變更 → 直接讀快取
      setLiveQuotes(cached.quotes);
      setIndustryMap(cached.industryMap);
      setQuantDataMap(cached.quantDataMap);
      setSimonsRecMap(cached.simonsRecMap);
      setLatestKlineDate(cached.latestKlineDate);
      setLastAnalyzedAt(cached.analyzedAt);
      return;
    }

    async function fetchQuotesAndSignals() {
      setDataLoading(true);
      setLoadingStep(`正在抓取 ${watchlist.length} 支股票報價...`);
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

      const nextIndustryMap: Record<string, string> = {};
      stockDatas.forEach((res, idx) => {
        if (res) {
          nextIndustryMap[watchlist[idx].stockCode] = res.subindustry || '';
        }
      });
      setIndustryMap(nextIndustryMap);

      setLiveQuotes(quotes);
      setQuotesLoading(false);

      // 記錄最新 K 線日期
      let latestDate = '';
      stockDatas.forEach(res => {
        if (res?.prices?.length) {
          const d = res.prices[res.prices.length - 1].mdate;
          if (d && d > latestDate) latestDate = d;
        }
      });
      if (latestDate) setLatestKlineDate(latestDate);

      setLoadingStep('正在載入 Simons 量化模型...');

      const [simonsItems, quantResults] = await Promise.all([
        fetchSimonsData().catch(() => []),
        Promise.all(watchlist.map(w => fetchStockQuantData(w.stockCode).catch(() => ({
          aiQuanBackDataComment: null,
          chipStability: null,
          stockInfo: null,
          currentSignal: 'neutral' as const,
        }))))
      ]);

      const simonsItemMap: Record<string, SimonsItem> = {};
      simonsItems.forEach((item) => {
        simonsItemMap[item.coid] = item;
      });

      const nextQuantDataMap: Record<string, StockQuantData> = {};
      const nextSimonsRecMap: Record<string, StockRecommendation> = {};

      watchlist.forEach((w, idx) => {
        const qd = quantResults[idx];
        nextQuantDataMap[w.stockCode] = qd;

        const simonsItem = simonsItemMap[w.stockCode];
        if (simonsItem) {
          nextSimonsRecMap[w.stockCode] = toRecommendation(simonsItem, qd);
        }
      });

      setQuantDataMap(nextQuantDataMap);
      setSimonsRecMap(nextSimonsRecMap);

      setLoadingStep('正在分析 MA5 與量能訊號...');
      // 訊號 + 警告分析
      await checkWatchlistSignals();

      // 記錄分析完成時間
      const now = new Date();
      const analyzedAt = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      setLastAnalyzedAt(analyzedAt);

      // 寫入快取（5 分鐘）
      setCache<WatchlistCacheData>(cacheKey, {
        quotes,
        industryMap: nextIndustryMap,
        quantDataMap: nextQuantDataMap,
        simonsRecMap: nextSimonsRecMap,
        latestKlineDate: latestDate,
        analyzedAt,
        watchlistKeys,
      }, 5 * 60 * 1000);

      setDataLoading(false);
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

  function getAdviceBadge(advice: AIAdvice) {
    switch (advice) {
      case 'buy': return <span className="wl-badge wl-badge-buy">🚀 建議買進</span>;
      case 'sell': return <span className="wl-badge wl-badge-sell">⚠️ 建議減碼</span>;
      default: return <span className="wl-badge wl-badge-hold">🟡 觀望中</span>;
    }
  }

  function getAiSignalBadge(stockCode: string) {
    const qd = quantDataMap[stockCode];
    if (!qd) return null;
    const sig = qd.currentSignal;
    switch (sig) {
      case 'buy':
        return (
          <div className="wl-ai-icon-badge wl-ai-icon-buy">
            <div className="wl-ai-icon-circle wl-ai-circle-buy">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
            </div>
            <span className="wl-ai-icon-label">AI進場</span>
          </div>
        );
      case 'sell':
        return (
          <div className="wl-ai-icon-badge wl-ai-icon-sell">
            <div className="wl-ai-icon-circle wl-ai-circle-sell">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
                <polyline points="17 18 23 18 23 12" />
              </svg>
            </div>
            <span className="wl-ai-icon-label">AI出場</span>
          </div>
        );
      default:
        return (
          <div className="wl-ai-icon-badge wl-ai-icon-neutral">
            <div className="wl-ai-icon-circle wl-ai-circle-neutral">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <span className="wl-ai-icon-label">AI中立</span>
          </div>
        );
    }
  }

  function getAiSignalForStock(stockCode: string): 'buy' | 'sell' | 'neutral' {
    return quantDataMap[stockCode]?.currentSignal ?? 'neutral';
  }

  function getScoreStars(score: number): string {
    if (score >= 80) return '⭐⭐⭐⭐⭐';
    if (score >= 65) return '⭐⭐⭐⭐';
    if (score >= 50) return '⭐⭐⭐';
    if (score >= 35) return '⭐⭐';
    return '⭐';
  }

  function getRemarkStyle(remark: string): string {
    if (remark.includes('超高')) return 'wl-quant-remark-ultra';
    if (remark.includes('高度')) return 'wl-quant-remark-high';
    if (remark.includes('中度')) return 'wl-quant-remark-mid';
    return 'wl-quant-remark-low';
  }

  function getChipStyle(pts: number): string {
    if (pts >= 7) return 'wl-quant-pts-high';
    if (pts >= 4) return 'wl-quant-pts-mid';
    return 'wl-quant-pts-low';
  }

  function getCumRetStyle(cumRet: string): string {
    const val = parseFloat(cumRet);
    if (isNaN(val)) return '';
    return val >= 0 ? 'wl-quant-ret-pos' : 'wl-quant-ret-neg';
  }

  function renderAiQuantChips(stockCode: string) {
    const qd = quantDataMap[stockCode];
    if (!qd || !qd.aiQuanBackDataComment) return null;

    const aiRemark = qd.aiQuanBackDataComment.remark ?? '--';
    const cumRet = qd.aiQuanBackDataComment.cum_ret ?? '--';
    const ptsRaw = qd.chipStability ? parseFloat(qd.chipStability.pts) : null;
    const chipLabel = ptsRaw === null ? '--' :
      ptsRaw >= 9 ? '最乾淨' :
      ptsRaw >= 7 ? '非常穩定' :
      ptsRaw >= 5 ? '穩定' :
      ptsRaw >= 3 ? '普通' : '凌亂';
    const cumDisplay = cumRet === '--' ? '--' : (cumRet.startsWith('-') ? cumRet : `+${cumRet}`);

    return (
      <div className="wl-quant-chips">
        <span className={`wl-quant-chip wl-quant-chip-remark ${getRemarkStyle(aiRemark)}`}>
          🤖 {aiRemark}
        </span>
        <span className={`wl-quant-chip wl-quant-chip-ret ${getCumRetStyle(cumRet)}`}>
          📊 累積報酬 {cumDisplay}
        </span>
        <span className={`wl-quant-chip wl-quant-chip-pts ${ptsRaw !== null ? getChipStyle(ptsRaw) : ''}`}>
          🔒 籌碼 {ptsRaw !== null ? `${ptsRaw.toFixed(0)}分` : '--'} {chipLabel}
        </span>
      </div>
    );
  }

  async function handleRemove(stockCode: string) {
    await removeFromWatchlist(stockCode);
    setRemoveConfirm(null);
  }

  // AI 推薦等級轉分數（超高度 > 高度 > 中度 > 低度）
  function getRemarkScore(stockCode: string): number {
    const remark = quantDataMap[stockCode]?.aiQuanBackDataComment?.remark ?? '';
    if (remark.includes('超高')) return 4;
    if (remark.includes('高度')) return 3;
    if (remark.includes('中度')) return 2;
    if (remark.includes('低度')) return 1;
    return 0;
  }

  // 排序：有訊號 > 無訊號但無警告 > 有警告的排最後；同層內再按 AI 推薦等級（超高度→低度）排序
  const sortedWatchlist = [...watchlist]
    .sort((a, b) => {
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
      const priDiff = priority(sigB, warnB) - priority(sigA, warnA);
      if (priDiff !== 0) return priDiff;
      // 同優先層內：按 AI 推薦等級降冪（超高度最前）
      return getRemarkScore(b.stockCode) - getRemarkScore(a.stockCode);
    })
    .filter(w => {
      if (filterSignalOnly) return !!getSignalForStock(w.stockCode);
      if (filterWarnOnly)   return getWarningForStock(w.stockCode)?.level === 'remove';
      if (filterAiSignal !== 'all') return getAiSignalForStock(w.stockCode) === filterAiSignal;
      return true;
    });

  const signalCount = watchlistSignals.length;
  const warningCount = watchlistWarnings.filter(w => w.level === 'remove').length;

  // AI 訊號統計
  const aiSignalCounts = watchlist.reduce((acc, w) => {
    const sig = getAiSignalForStock(w.stockCode);
    acc[sig] = (acc[sig] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const hasAnyQuantData = Object.keys(quantDataMap).length > 0;

  return (
    <div className="watchlist-page">
      {/* 全頁 Loading Overlay */}
      {dataLoading && (
        <div className="wl-loading-overlay">
          <div className="wl-loading-card">
            <div className="wl-loading-bear">🐻</div>
            <div className="wl-loading-rings">
              <div className="wl-loading-ring wl-ring-1" />
              <div className="wl-loading-ring wl-ring-2" />
              <div className="wl-loading-ring wl-ring-3" />
            </div>
            <div className="wl-loading-title">資料抓取中</div>
            <div className="wl-loading-step">{loadingStep}</div>
            <div className="wl-loading-dots">
              <span /><span /><span />
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <h1 className="page-title">👁️ 觀察名單</h1>
      </div>

      {/* 數據來源與更新時間 */}
      {watchlist.length > 0 && (
        <div className="wl-data-source">
          {lastAnalyzedAt ? (
            <>
              <span>📡 IFAlgo K線 API</span>
              <span className="wl-data-sep">·</span>
              <span>📅 {latestKlineDate || '—'}</span>
              <span className="wl-data-sep">·</span>
              <span>🕐 {lastAnalyzedAt}</span>
              {getCacheTTL(CACHE_KEYS.WATCHLIST_FULL) > 0 && (
                <span className="wl-cache-badge">⚡ 快取中</span>
              )}
              <button
                className="wl-refresh-btn"
                title="重新抓取最新資料"
                onClick={() => {
                  clearCache(CACHE_KEYS.WATCHLIST_FULL);
                  setLastAnalyzedAt(null);
                  setLiveQuotes({});
                  setQuantDataMap({});
                  setSimonsRecMap({});
                }}
              >
                🔄 重新抓取
              </button>
            </>
          ) : watchlistSignalsLoading ? (
            <span>正在抓取數據中...</span>
          ) : (
            <span>進入頁面後自動分析</span>
          )}
        </div>
      )}

      {/* 訊號摘要 */}
      {signalCount > 0 && (
        <div
          className={`wl-alert-banner${filterSignalOnly ? ' wl-alert-banner-active' : ''}`}
          onClick={() => {
            setFilterSignalOnly(f => !f);
            setFilterWarnOnly(false);
            setFilterAiSignal('all');
          }}
          style={{ cursor: 'pointer' }}
        >
          <div className="wl-alert-icon">{filterSignalOnly ? '✅' : '🔔'}</div>
          <div className="wl-alert-text">
            <div className="wl-alert-title">
              有 {signalCount} 檔股票出現進場訊號！
              {filterSignalOnly && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>（篩選中，再按取消）</span>}
            </div>
            <div className="wl-alert-desc">{filterSignalOnly ? '只顯示有進場訊號的股票' : '點擊只顯示有進場訊號的股票 →'}</div>
          </div>
        </div>
      )}

      {/* 建議移除摘要 */}
      {warningCount > 0 && (
        <div
          className={`wl-warn-banner${filterWarnOnly ? ' wl-warn-banner-active' : ''}`}
          onClick={() => {
            setFilterWarnOnly(f => !f);
            setFilterSignalOnly(false);
            setFilterAiSignal('all');
          }}
          style={{ cursor: 'pointer' }}
        >
          <div className="wl-alert-icon">{filterWarnOnly ? '✅' : '⚠️'}</div>
          <div className="wl-alert-text">
            <div className="wl-warn-title">
              有 {warningCount} 檔股票建議移除
              {filterWarnOnly && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: '#ef4444' }}>（篩選中，再按取消）</span>}
            </div>
            <div className="wl-alert-desc">{filterWarnOnly ? '只顯示建議移除的股票' : '點擊只顯示建議移除的股票 →'}</div>
          </div>
        </div>
      )}

      {/* AI 進出場訊號篩選 */}
      {hasAnyQuantData && watchlist.length > 0 && (
        <div className="wl-ai-filter-bar">
          <div className="wl-ai-filter-title">🤖 Simons AI 訊號篩選</div>
          <div className="wl-ai-filter-cards">
            <button
              className={`wl-ai-filter-card wl-ai-fcard-buy${filterAiSignal === 'buy' ? ' active' : ''}`}
              onClick={() => { setFilterAiSignal(filterAiSignal === 'buy' ? 'all' : 'buy'); setFilterSignalOnly(false); setFilterWarnOnly(false); }}
            >
              <div className="wl-ai-fcard-icon wl-ai-ficon-buy">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </svg>
              </div>
              <div className="wl-ai-fcard-label">AI進場</div>
              <div className="wl-ai-fcard-count">{aiSignalCounts['buy'] || 0} 檔</div>
            </button>
            <button
              className={`wl-ai-filter-card wl-ai-fcard-neutral${filterAiSignal === 'neutral' ? ' active' : ''}`}
              onClick={() => { setFilterAiSignal(filterAiSignal === 'neutral' ? 'all' : 'neutral'); setFilterSignalOnly(false); setFilterWarnOnly(false); }}
            >
              <div className="wl-ai-fcard-icon wl-ai-ficon-neutral">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </div>
              <div className="wl-ai-fcard-label">AI中立</div>
              <div className="wl-ai-fcard-count">{aiSignalCounts['neutral'] || 0} 檔</div>
            </button>
            <button
              className={`wl-ai-filter-card wl-ai-fcard-sell${filterAiSignal === 'sell' ? ' active' : ''}`}
              onClick={() => { setFilterAiSignal(filterAiSignal === 'sell' ? 'all' : 'sell'); setFilterSignalOnly(false); setFilterWarnOnly(false); }}
            >
              <div className="wl-ai-fcard-icon wl-ai-ficon-sell">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
                  <polyline points="17 18 23 18 23 12" />
                </svg>
              </div>
              <div className="wl-ai-fcard-label">AI出場</div>
              <div className="wl-ai-fcard-count">{aiSignalCounts['sell'] || 0} 檔</div>
            </button>
          </div>
          {filterAiSignal !== 'all' && (
            <div className="wl-ai-filter-active-hint">
              篩選中：{filterAiSignal === 'buy' ? '🔴 AI進場' : filterAiSignal === 'sell' ? '🟢 AI出場' : '⚪ AI中立'}
              <button className="wl-ai-filter-clear" onClick={() => setFilterAiSignal('all')}>✕ 取消篩選</button>
            </div>
          )}
        </div>
      )}

      {watchlistSignalsLoading && watchlist.length > 0 && !dataLoading && (
        <div className="wl-loading-bar">
          <span className="wl-inline-spinner" />
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
            const simonsRec = simonsRecMap[w.stockCode];
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
                    <div className="wl-rec-meta">
                      <span className="wl-rec-category">{simonsRec?.category || industryMap[w.stockCode] || '—'}</span>
                      {simonsRec && <span className="wl-rec-stars">{getScoreStars(simonsRec.score)}</span>}
                    </div>
                    <div className="wl-rec-badges">
                      {getAiSignalBadge(w.stockCode)}
                      {simonsRec && getAdviceBadge(simonsRec.advice)}
                      {simonsRec && <span className="wl-badge wl-badge-premium">💎 Simons量化評分 {simonsRec.score}分</span>}
                    </div>
                    {renderAiQuantChips(w.stockCode)}
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
          <div className="wl-legend-section">🤖 AI 進出場訊號（Simons 量化模型）</div>
          <div className="wl-legend-item">
            <span className="wl-ai-icon-badge wl-ai-icon-buy" style={{ transform: 'scale(0.8)', transformOrigin: 'left center' }}>
              <span className="wl-ai-icon-circle wl-ai-circle-buy" style={{ width: 28, height: 28 }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
              </span>
              <span className="wl-ai-icon-label">AI進場</span>
            </span>
            <span>Simons 模型判斷 AI 持倉中，量化策略認為可加碼</span>
          </div>
          <div className="wl-legend-item">
            <span className="wl-ai-icon-badge wl-ai-icon-neutral" style={{ transform: 'scale(0.8)', transformOrigin: 'left center' }}>
              <span className="wl-ai-icon-circle wl-ai-circle-neutral" style={{ width: 28, height: 28 }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </span>
              <span className="wl-ai-icon-label">AI中立</span>
            </span>
            <span>Simons 模型無明確方向，建議觀望等待更好時機</span>
          </div>
          <div className="wl-legend-item">
            <span className="wl-ai-icon-badge wl-ai-icon-sell" style={{ transform: 'scale(0.8)', transformOrigin: 'left center' }}>
              <span className="wl-ai-icon-circle wl-ai-circle-sell" style={{ width: 28, height: 28 }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></svg>
              </span>
              <span className="wl-ai-icon-label">AI出場</span>
            </span>
            <span>Simons 模型已出場，量化策略判斷風險升高</span>
          </div>
          <div className="wl-legend-section" style={{ marginTop: 12 }}>技術面進場訊號</div>
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
