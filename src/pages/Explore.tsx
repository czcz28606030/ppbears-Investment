import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchOfficialClosePrice, fetchOfficialPriceMap } from '../api';
import type { OfficialPriceMapEntry } from '../api';
import type { WeeklyTopItem, WeeklyTopPayload } from '../utils/weeklyTop';
import { fetchMarketResponse } from '../utils/marketRequest';
import { useStore } from '../store';
import { getCache, setCache, CACHE_KEYS } from '../cache';
import AdBanner from '../components/AdBanner';
import MarketBadge from '../components/MarketBadge';
import IndustryIcon from '../components/IndustryIcon';
import { useStrategySignals } from '../hooks/useStrategySignals';
import { canAutoRefreshPrices, formatPriceUpdateLabel, PRICE_AUTO_REFRESH_MS } from '../utils/priceAutoRefresh';
import './Explore.css';

type StockRow = { code: string; name: string; weekly?: WeeklyTopItem };

export default function Explore() {
  const navigate = useNavigate();
  const { hasFeature, isInWatchlist, addToWatchlist, removeFromWatchlist, holdings } = useStore();
  const savedState = useRef<{ search?: string; scrollY?: number } | null>(null);
  const [search, setSearch] = useState(() => {
    try {
      savedState.current = JSON.parse(sessionStorage.getItem('explore_state') || 'null');
      sessionStorage.removeItem('explore_state');
    } catch { /* Ignore invalid navigation state. */ }
    return savedState.current?.search || '';
  });
  const [weekly, setWeekly] = useState<WeeklyTopPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [prices, setPrices] = useState<Record<string, OfficialPriceMapEntry>>({});
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceUpdatedLabel, setPriceUpdatedLabel] = useState('');
  const [wlBusy, setWlBusy] = useState<string | null>(null);
  const [onlyAdded, setOnlyAdded] = useState(false);
  const refreshBusy = useRef(false);
  const mounted = useRef(true);

  async function loadWeekly(forceFresh = false) {
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    setLoading(true);
    setError('');
    try {
      const response = await fetchMarketResponse(`/api/app-cache?type=weekly-top${forceFresh ? `&refresh=${Date.now()}` : ''}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '週榜來源暫時無法讀取');
      if (!Array.isArray(data.items) || data.source !== 'stoxgauge-weekly') throw new Error('週榜資料格式不正確');
      if (mounted.current) setWeekly(data);
    } catch (err) {
      if (mounted.current) {
        setWeekly(null);
        setError(err instanceof Error ? err.message : '載入週榜時發生錯誤');
      }
    } finally {
      refreshBusy.current = false;
      if (mounted.current) setLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    loadWeekly();
    return () => { mounted.current = false; };
  }, []);

  // Prices update independently of the provider's weekly snapshot.
  useEffect(() => {
    let cancelled = false;
    const cached = getCache<Record<string, OfficialPriceMapEntry>>(CACHE_KEYS.TWSE_PRICE_MAP);
    if (cached) setPrices(cached);
    setPriceLoading(true);
    fetchOfficialPriceMap().then(map => {
      if (!cancelled && Object.keys(map).length > 0) {
        setPrices(map);
        setCache(CACHE_KEYS.TWSE_PRICE_MAP, map);
      }
    }).catch(() => {}).finally(() => { if (!cancelled) setPriceLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const heldCodes = useMemo(() => new Set(holdings.filter(h => h.totalShares > 0).map(h => h.stockCode)), [holdings]);
  const filtered = useMemo<StockRow[]>(() => {
    const q = search.trim().toLowerCase();
    const weeklyMap = new Map((weekly?.items || []).map(item => [item.ticker, item]));
    if (q) {
      const result = new Map<string, StockRow>();
      for (const item of weekly?.items || []) {
        if (item.ticker.includes(q) || item.name.toLowerCase().includes(q)) result.set(item.ticker, { code: item.ticker, name: item.name, weekly: item });
      }
      for (const [code, price] of Object.entries(prices)) {
        if (code.includes(q) || price.name.toLowerCase().includes(q)) result.set(code, { code, name: price.name, weekly: weeklyMap.get(code) });
        if (result.size >= 30) break;
      }
      return [...result.values()];
    }
    return (weekly?.items || []).filter(item => !onlyAdded || item.changeType === 'ADDED')
      .map(item => ({ code: item.ticker, name: item.name, weekly: item }));
  }, [search, weekly, prices, onlyAdded]);

  const { signals: strategySignals, loading: strategyLoading, error: strategyError, refresh: refreshStrategy } = useStrategySignals(filtered.map(row => row.code), hasFeature('ai_stock_picking'));

  useEffect(() => {
    if (loading || !savedState.current?.scrollY) return;
    const y = savedState.current.scrollY;
    savedState.current = null;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [loading]);

  const visibleCodesKey = filtered.map(row => row.code).join(',');
  useEffect(() => {
    let cancelled = false;
    let running = false;
    const codes = visibleCodesKey.split(',').filter(Boolean);
    async function updateQuotes() {
      if (running || !canAutoRefreshPrices() || !codes.length) return;
      running = true;
      try {
        const quotes = await Promise.all(codes.map(code => fetchOfficialClosePrice(code).catch(() => null)));
        if (cancelled) return;
        setPrices(prev => {
          const next = { ...prev };
          quotes.forEach((quote, index) => {
            if (!quote || !(quote.price > 0)) return;
            const code = codes[index];
            const old = next[code];
            next[code] = { ...old, name: quote.name || old?.name || code, close: String(quote.price), change: String(quote.price - (quote.previousClose || quote.price)), volume: old?.volume || 0, date: quote.date || old?.date || '' };
          });
          setCache(CACHE_KEYS.TWSE_PRICE_MAP, next);
          return next;
        });
        if (quotes.some(quote => quote && quote.price > 0)) setPriceUpdatedLabel(formatPriceUpdateLabel());
      } finally { running = false; }
    }
    updateQuotes();
    const timer = window.setInterval(updateQuotes, PRICE_AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', updateQuotes);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', updateQuotes); };
  }, [visibleCodesKey]);

  function navigateToStock(code: string) {
    sessionStorage.setItem('explore_state', JSON.stringify({ search, scrollY: window.scrollY }));
    sessionStorage.setItem('explore_stock_list', JSON.stringify({ source: 'stoxgauge-weekly', items: filtered.map(row => ({ coid: row.code, name: row.name, close: prices[row.code]?.close || '', aiRemark: null, cumRet: null, chipPts: null })) }));
    navigate(`/stock/${code}`);
  }

  const weekAge = weekly?.weekEndDate ? (Date.now() - Date.parse(`${weekly.weekEndDate}T00:00:00+08:00`)) / 86400000 : 0;
  const stale = weekAge > 14;
  const updatedAt = weekly?.updatedAt ? new Date(weekly.updatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '尚未同步';

  return (
    <div className="explore">
      <div className="page-header"><h1 className="page-title">🔍 探索股票</h1></div>
      <div className="search-bar"><span className="search-icon">🔎</span><input type="text" placeholder="搜尋股票名稱或代號..." value={search} onChange={event => setSearch(event.target.value)} /></div>
      {!hasFeature('ai_stock_picking') && <AdBanner />}
      <section>
        <div className="filtered-result-header">{search.trim() ? `🔎 搜尋「${search.trim()}」結果` : '📊 StoxGauge 每週股票排行榜'}</div>
        {!search.trim() && <button type="button" className="btn btn-sm" onClick={() => setOnlyAdded(value => !value)} aria-pressed={onlyAdded}>{onlyAdded ? '✓ 只看本週新入榜' : '只看本週新入榜'}</button>}
        <div className="explore-data-meta">
          <div className="explore-data-meta-lines">
            <span className={`explore-data-freshness ${stale || error || !weekly?.items.length ? 'explore-data-freshness-waiting' : 'explore-data-freshness-fresh'}`}>{loading ? '正在讀取週榜' : error ? '週榜讀取失敗' : !weekly?.items.length ? '來源目前沒有週榜資料' : stale ? '榜單超過兩週未更新，請留意資料日期' : '使用最新公布的每週榜單'}</span>
            <span className="explore-data-meta-updated">榜單週期截止：{weekly?.weekEndDate || '尚未同步'}</span>
            <span className="explore-data-meta-updated">來源資料更新：{updatedAt}</span>
            <span className="explore-data-meta-schedule">來源每週更新・回看 10 天・依來源排名排序</span>
            <span className="explore-data-meta-schedule">價格獨立更新；累積 AIT 值為來源指標</span>
          </div>
          <button type="button" className="explore-refresh-btn" onClick={() => Promise.all([loadWeekly(true), refreshStrategy()])} disabled={loading || strategyLoading}>🔄 重新抓取</button>
        </div>
        {loading && <div className="loading-spinner"><div className="spinner" /><div className="loading-text">週榜載入中... 🐻</div></div>}
        {error && <div className="empty-state"><div className="empty-state-title">{error}</div><button className="btn btn-primary btn-sm" onClick={() => loadWeekly(true)}>重試</button></div>}
        {strategyError && <p role="alert">{strategyError}</p>}
        {!loading && (!error || search.trim()) && <div className="recommendation-list">
          {filtered.length === 0 && <div className="empty-state"><div className="empty-state-title">{search.trim() && priceLoading ? '正在搜尋全市場股票...' : onlyAdded ? '本週沒有新入榜股票' : search.trim() ? '找不到結果' : '來源目前沒有週榜資料'}</div></div>}
          {filtered.map(row => {
            const item = row.weekly;
            const held = heldCodes.has(row.code);
            const watched = isInWatchlist(row.code);
            const price = Number(prices[row.code]?.close);
            return <div key={row.code} className="stock-card recommendation-card" onClick={() => navigateToStock(row.code)}>
              <div className="rec-left">
                <div className="rec-header"><IndustryIcon stockCode={row.code} compact /><MarketBadge market={prices[row.code]?.market} compact /><span className="stock-name">{row.name}</span><span className="stock-code">{row.code}</span></div>
                {item ? <>
                  <div className="rec-badges"><span className="badge badge-premium">週榜第 {item.rank} 名</span><span className="badge badge-neutral">{item.changeType === 'ADDED' ? '本週新入榜' : item.rankChange === null || item.rankChange === 0 ? '排名持平' : item.rankChange > 0 ? `排名上升 ${item.rankChange}` : `排名下降 ${Math.abs(item.rankChange)}`}</span></div>
                  <div className="quant-chips"><span className="quant-chip">累積 AIT 值 {item.aitValue.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}</span>{item.previousRank !== null && <span className="quant-chip">前週第 {item.previousRank} 名</span>}</div>
                </> : <div className="rec-meta">全市場搜尋結果</div>}
                {hasFeature('ai_stock_picking') && <div className="quant-chips"><span className="quant-chip">{strategySignals[row.code]?.label || (strategyLoading ? '訊號計算中' : '資料不足')}</span><span className="quant-chip">{strategySignals[row.code]?.reason || '等待官方日K與帳戶資料'}</span></div>}
              </div>
              <button className={`wl-quick-btn wl-spotlight-btn ${watched || held ? 'wl-quick-active' : ''}`} title={held ? '已在庫存' : watched ? '已加入觀察名單' : '加入觀察名單'} aria-label={held ? '已在庫存' : watched ? '已加入觀察名單' : '加入觀察名單'} disabled={wlBusy !== null || held} onClick={async event => {
                event.stopPropagation();
                if (wlBusy || held) return;
                setWlBusy(row.code);
                try {
                  if (watched) await removeFromWatchlist(row.code);
                  else {
                    const quote = price > 0 ? price : (await fetchOfficialClosePrice(row.code))?.price;
                    if (!quote || quote <= 0) { alert('暫時無法取得股價，請稍後再試'); return; }
                    const result = await addToWatchlist(row.code, row.name, quote);
                    if (result.error) alert(result.error);
                  }
                } finally { setWlBusy(null); }
              }}><span className="wl-spotlight-icon">{wlBusy === row.code ? '⏳' : held ? '📦' : watched ? '✅' : '👁️'}</span><span className="wl-spotlight-label">{held ? '庫存' : watched ? '已觀察' : '觀察'}</span></button>
              <div className="rec-right"><div className="rec-price-block">{priceUpdatedLabel && <div className="stock-price-updated">{priceUpdatedLabel}</div>}<div className="stock-price">{price > 0 ? `NT$${prices[row.code].close}` : '價格待更新'}</div></div></div>
            </div>;
          })}
        </div>}
      </section>
    </div>
  );
}
