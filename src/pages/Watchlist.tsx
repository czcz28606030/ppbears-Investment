import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatPrice } from '../store';
import { fetchOfficialClosePrice, fetchOfficialPriceMap, fetchSimonsData, fetchStockData, fetchStockQuantData, toRecommendation, fetchSimonsRecommendationCounts, refreshDailyAiCache, clearQuantSignalTTLCache, clearSimonsDataTTLCache, fetchDailyAiCacheVersion, getKnownDailyAiCacheVersion, rememberDailyAiCacheVersion, ensureDailyAiCacheVersion, fetchActiveEtfRadarMap, fetchUserMarketDailyCache } from '../api';
import type { ActiveEtfRadarItem, OfficialClosePrice, OfficialPriceMapEntry, StockQuantData, StockQuantMeta } from '../api';
import type { SimonsItem, StockData, StockPrice, StockRecommendation, WatchlistSignal, WatchlistWarning } from '../types';
import { getCache, setCache, clearCache, getVersionedCache, getPersistentCache, getVersionedPersistentCache, setPersistentCache, invalidateDailyMarketDataCaches, CACHE_KEYS } from '../cache';
import MarketBadge from '../components/MarketBadge';
import IndustryIcon from '../components/IndustryIcon';
import { canAutoRefreshPrices, formatPriceUpdateLabel, PRICE_AUTO_REFRESH_MS } from '../utils/priceAutoRefresh';
import './Watchlist.css';

const WATCHLIST_FILTER_STORAGE_KEY = 'ppbears_watchlist_filters_v2';
const WATCHLIST_PERSISTENT_CACHE_KEY = 'ppbears_watchlist_full_v4';
const WATCHLIST_CACHE_VERSION = 'score-fallback-kline-v4';
type WatchlistAiFilter = 'all' | 'buy' | 'neutral' | 'sell' | 'reentry';
type WatchlistRemarkFilter = 'all' | 'ultra' | 'high' | 'mid' | 'low';
type WatchlistSortKey = 'simonsScore' | 'recommendationCount' | 'cumRet' | 'chipPts' | 'createdAt';
type WatchlistSortDirection = 'desc' | 'asc';
type WatchlistFilterState = {
  warnOnly: boolean;
  aiSignal: WatchlistAiFilter;
  aiRemark: WatchlistRemarkFilter;
  sortKey: WatchlistSortKey;
  sortDirection: WatchlistSortDirection;
  search: string;
};
type WatchlistInfoDialog = {
  kind: 'score';
  stockName: string;
  stockCode: string;
  rec: StockRecommendation;
  quantData?: StockQuantData;
};
type ActiveEtfInfoDialog = {
  stockName: string;
  stockCode: string;
  radar?: ActiveEtfRadarItem;
};
type SmallChipInfoDialog = {
  title: string;
  subtitle: string;
  text: string;
  details: string[];
  note?: string;
};

const WATCHLIST_FULL_TTL_MS = 18 * 60 * 60 * 1000;
const DEFAULT_WATCHLIST_SORT_KEY: WatchlistSortKey = 'simonsScore';
const DAILY_AI_CACHE_POLL_MS = 90 * 1000;
const DATA_REFRESH_SCHEDULE = [
  { label: '08:00', minutes: 8 * 60 },
];

function getTodayString(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function formatAnalyzeTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function getRefreshSlotInfo() {
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  let currentIndex = DATA_REFRESH_SCHEDULE.findIndex(slot => minutesNow < slot.minutes) - 1;
  let slotDate = new Date(now);
  if (currentIndex < 0) {
    currentIndex = DATA_REFRESH_SCHEDULE.length - 1;
    slotDate.setDate(slotDate.getDate() - 1);
  }
  const currentSlot = DATA_REFRESH_SCHEDULE[currentIndex];
  const nextSlot = DATA_REFRESH_SCHEDULE[(currentIndex + 1) % DATA_REFRESH_SCHEDULE.length];
  slotDate.setHours(Math.floor(currentSlot.minutes / 60), currentSlot.minutes % 60, 0, 0);
  const nextDate = new Date(now);
  nextDate.setHours(Math.floor(nextSlot.minutes / 60), nextSlot.minutes % 60, 0, 0);
  if (nextSlot.minutes <= minutesNow) nextDate.setDate(nextDate.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateKey = `${slotDate.getFullYear()}-${pad(slotDate.getMonth() + 1)}-${pad(slotDate.getDate())}`;
  return {
    key: `${dateKey}-${currentSlot.label}`,
    ttlMs: Math.max(5 * 60 * 1000, nextDate.getTime() - now.getTime()),
    startedAt: slotDate,
  };
}

function formatMetaDateTime(value?: string): string {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getLatestQuantMeta(map: Record<string, StockQuantData>): StockQuantMeta | null {
  const metas = Object.values(map).map(item => item.meta).filter(Boolean) as StockQuantMeta[];
  if (metas.length === 0) return null;
  return metas.sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime())[0];
}

function getDataFreshness(meta: StockQuantMeta | null, loading: boolean, hasData: boolean) {
  if (loading) {
    return { className: 'wl-data-freshness-updating', label: '正在讀取每日快取與更新價格' };
  }
  if (!hasData) {
    return { className: 'wl-data-freshness-waiting', label: '等待 Simons 最新交易日資料' };
  }

  if (meta?.cacheStatus === 'fresh') {
    return { className: 'wl-data-freshness-fresh', label: '已重新讀取每日快取' };
  }

  return { className: 'wl-data-freshness-fresh', label: '已使用每日 AI 訊號快取' };
}


function cacheCoversWatchlist(cacheKeys: string | undefined, stockCodes: string[]): boolean {
  if (!cacheKeys || stockCodes.length === 0) return false;
  const cachedCodes = new Set(cacheKeys.split(',').map(code => code.trim()).filter(Boolean));
  return stockCodes.every(code => cachedCodes.has(code));
}

function getMissingKlineCodes(klineMap: Record<string, StockPrice[]> | undefined, stockCodes: string[]): string[] {
  return stockCodes.filter(code => (klineMap?.[code] || []).length < 12);
}

function hasUsableWatchlistCache(
  cache: {
    quotes?: Record<string, { close: number; change: number }>;
    klineMap?: Record<string, StockPrice[]>;
    quantDataMap?: Record<string, StockQuantData>;
    simonsRecMap?: Record<string, StockRecommendation>;
  },
  stockCodes: string[],
  hasAiFeature: boolean
): boolean {
  if (stockCodes.length === 0) return false;
  const hasQuote = stockCodes.some(code => Boolean(cache.quotes?.[code]));
  const hasKline = stockCodes.some(code => (cache.klineMap?.[code] || []).length >= 12);
  if (!hasAiFeature) return hasQuote || hasKline;
  const hasQuant = stockCodes.some(code => Boolean(cache.quantDataMap?.[code]));
  const hasRecommendation = stockCodes.some(code => Boolean(cache.simonsRecMap?.[code]));
  return hasQuote || hasKline || hasQuant || hasRecommendation;
}

function formatTodayDate(): string {
  return getTodayString().replace(/-/g, '/');
}

function getFixedUpdateLabel(): string {
  return '08:00 自動檢查；可手動重新抓取';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => window.setTimeout(() => resolve(null), ms)),
  ]);
}

function readSavedWatchlistFilters(): WatchlistFilterState {
  const fallback: WatchlistFilterState = {
    warnOnly: false,
    aiSignal: 'all',
    aiRemark: 'all',
    sortKey: DEFAULT_WATCHLIST_SORT_KEY,
    sortDirection: 'desc',
    search: '',
  };
  try {
    const raw = sessionStorage.getItem(WATCHLIST_FILTER_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<WatchlistFilterState>;
    const aiSignal: WatchlistAiFilter =
      parsed.aiSignal === 'buy' || parsed.aiSignal === 'neutral' || parsed.aiSignal === 'sell' || parsed.aiSignal === 'reentry'
        ? parsed.aiSignal
        : 'all';
    const aiRemark: WatchlistRemarkFilter =
      parsed.aiRemark === 'ultra' || parsed.aiRemark === 'high' || parsed.aiRemark === 'mid' || parsed.aiRemark === 'low'
        ? parsed.aiRemark
        : 'all';
    return {
      warnOnly: Boolean(parsed.warnOnly),
      aiSignal,
      aiRemark,
      sortKey: parsed.sortKey === 'simonsScore' || parsed.sortKey === 'recommendationCount' || parsed.sortKey === 'cumRet' || parsed.sortKey === 'chipPts' || parsed.sortKey === 'createdAt'
        ? parsed.sortKey
        : DEFAULT_WATCHLIST_SORT_KEY,
      sortDirection: parsed.sortDirection === 'asc' ? 'asc' : 'desc',
      search: typeof parsed.search === 'string' ? parsed.search : '',
    };
  } catch {
    return fallback;
  }
}

export default function Watchlist() {
  const navigate = useNavigate();
  const {
    watchlist, watchlistSignals, watchlistWarnings, watchlistSignalsLoading,
    holdings, removeFromWatchlist, checkWatchlistSignals, fetchWatchlist, hasFeature,
  } = useStore();
  const hasAiFeature = hasFeature('ai_stock_picking');
  const savedFilters = readSavedWatchlistFilters();

  const [liveQuotes, setLiveQuotes] = useState<Record<string, { close: number; change: number }>>({});
  const [, setQuotesLoading] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<string | null>(null);
  const [, setLatestKlineDate] = useState<string | null>(null);
  const [industryMap, setIndustryMap] = useState<Record<string, string>>({});
  const [marketMap, setMarketMap] = useState<Record<string, OfficialPriceMapEntry>>({});
  const [klineMap, setKlineMap] = useState<Record<string, StockPrice[]>>({});
  const [quantDataMap, setQuantDataMap] = useState<Record<string, StockQuantData>>({});
  const [simonsRecMap, setSimonsRecMap] = useState<Record<string, StockRecommendation>>({});
  const [quantSyncingCodes, setQuantSyncingCodes] = useState<Set<string>>(new Set());
  const [quantFailedCodes, setQuantFailedCodes] = useState<Set<string>>(new Set());
  const [filterWarnOnly, setFilterWarnOnly] = useState(savedFilters.warnOnly);   // 只顯示建議移除的
  const [filterAiSignal, setFilterAiSignal] = useState<WatchlistAiFilter>(savedFilters.aiSignal); // AI 進出場訊號篩選
  const [filterAiRemark, setFilterAiRemark] = useState<WatchlistRemarkFilter>(savedFilters.aiRemark);
  const [sortKey, setSortKey] = useState<WatchlistSortKey>(savedFilters.sortKey);
  const [sortDirection, setSortDirection] = useState<WatchlistSortDirection>(savedFilters.sortDirection);
  const [watchlistSearch, setWatchlistSearch] = useState(savedFilters.search);
  const [dataLoading, setDataLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('正在連線...');
  const [refreshKey, setRefreshKey] = useState(0);
  const [, setUsingWatchlistCache] = useState(false);
  const [infoDialog, setInfoDialog] = useState<WatchlistInfoDialog | null>(null);
  const [activeEtfDialog, setActiveEtfDialog] = useState<ActiveEtfInfoDialog | null>(null);
  const [smallChipDialog, setSmallChipDialog] = useState<SmallChipInfoDialog | null>(null);
  const [recommendationCounts, setRecommendationCounts] = useState<Record<string, number>>({});
  const [activeEtfMap, setActiveEtfMap] = useState<Record<string, ActiveEtfRadarItem>>({});
  const [priceUpdatedLabel, setPriceUpdatedLabel] = useState('');
  const [dailyDataVersion, setDailyDataVersion] = useState(() => getKnownDailyAiCacheVersion('watchlist') || '');

  // 進入頁面時抓取即時報價 + 訊號分析
  useEffect(() => {
    async function loadData() {
      await fetchWatchlist();
    }
    loadData();
  }, []);

  useEffect(() => {
    sessionStorage.setItem(WATCHLIST_FILTER_STORAGE_KEY, JSON.stringify({
      warnOnly: filterWarnOnly,
      aiSignal: filterAiSignal,
      aiRemark: filterAiRemark,
      sortKey,
      sortDirection,
      search: watchlistSearch,
    }));
  }, [filterWarnOnly, filterAiSignal, filterAiRemark, sortKey, sortDirection, watchlistSearch]);
  useEffect(() => {
    if (dailyDataVersion) return;
    let cancelled = false;
    ensureDailyAiCacheVersion('watchlist').then(version => {
      if (!cancelled && version) setDailyDataVersion(version);
    });
    return () => { cancelled = true; };
  }, [dailyDataVersion]);

  useEffect(() => {
    if (hasAiFeature) return;
    if (filterAiSignal !== 'all') setFilterAiSignal('all');
    if (filterAiRemark !== 'all') setFilterAiRemark('all');
    if (sortKey === 'cumRet' || sortKey === 'chipPts') setSortKey(DEFAULT_WATCHLIST_SORT_KEY);
    if (sortDirection !== 'desc') setSortDirection('desc');
    setQuantDataMap({});
    setQuantSyncingCodes(new Set());
    setQuantFailedCodes(new Set());
  }, [hasAiFeature, filterAiSignal, filterAiRemark, sortKey, sortDirection]);

  useEffect(() => {
    const heldCodes = new Set(
      holdings
        .filter(h => h.totalShares > 0)
        .map(h => h.stockCode)
    );
    const heldWatchlistCodes = watchlist
      .filter(w => heldCodes.has(w.stockCode))
      .map(w => w.stockCode);

    if (heldWatchlistCodes.length === 0) return;

    clearCache(CACHE_KEYS.WATCHLIST_FULL);
    setRemoveConfirm(current => (
      current && heldWatchlistCodes.includes(current) ? null : current
    ));
    setLiveQuotes(prev => {
      const next = { ...prev };
      heldWatchlistCodes.forEach(code => { delete next[code]; });
      return next;
    });
    setKlineMap(prev => {
      const next = { ...prev };
      heldWatchlistCodes.forEach(code => { delete next[code]; });
      return next;
    });
    setQuantDataMap(prev => {
      const next = { ...prev };
      heldWatchlistCodes.forEach(code => { delete next[code]; });
      return next;
    });
    setSimonsRecMap(prev => {
      const next = { ...prev };
      heldWatchlistCodes.forEach(code => { delete next[code]; });
      return next;
    });

    heldWatchlistCodes.forEach(code => {
      removeFromWatchlist(code).catch(() => {});
    });
  }, [holdings, watchlist, removeFromWatchlist]);

  useEffect(() => {
    const codes = watchlist.map(w => w.stockCode);
    if (codes.length === 0) {
      setRecommendationCounts({});
      setActiveEtfMap({});
      return;
    }

    let cancelled = false;
    fetchSimonsRecommendationCounts(codes, 90).then(counts => {
      if (!cancelled) setRecommendationCounts(counts);
    });
    fetchActiveEtfRadarMap(codes, 5).then(items => {
      if (!cancelled) setActiveEtfMap(items);
    });

    return () => { cancelled = true; };
  }, [watchlist, refreshKey]);

  useEffect(() => {
    if (watchlist.length === 0) return;
    if (!hasAiFeature) return;
    let cancelled = false;
    async function checkSharedAiCacheVersion() {
      if (dataLoading) return;
      const latest = await fetchDailyAiCacheVersion();
      if (cancelled || !latest?.version) return;
      const known = getKnownDailyAiCacheVersion('watchlist');
      if (!known) {
        rememberDailyAiCacheVersion(latest.version, 'watchlist');
        setDailyDataVersion(latest.version);
        return;
      }
      if (latest.version !== known) {
        rememberDailyAiCacheVersion(latest.version, 'watchlist');
        setDailyDataVersion(latest.version);
        invalidateDailyMarketDataCaches();
        setLastAnalyzedAt(null);
        setUsingWatchlistCache(false);
        setLiveQuotes({});
        setPriceUpdatedLabel('');
        setKlineMap({});
        setQuantDataMap({});
        setSimonsRecMap({});
        setRefreshKey(k => k + 1);
      }
    }

    function handlePageShow() {
      checkSharedAiCacheVersion();
    }

    checkSharedAiCacheVersion();
    const timer = window.setInterval(checkSharedAiCacheVersion, DAILY_AI_CACHE_POLL_MS);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [watchlist.length, dataLoading, hasAiFeature]);

  useEffect(() => {
    if (watchlist.length === 0) return;

    // 只有今天且仍在 TTL 內的快取才直接使用；否則進頁自動重新分析。
    type WatchlistCacheData = {
      quotes: Record<string, { close: number; change: number }>;
      industryMap: Record<string, string>;
      marketMap: Record<string, OfficialPriceMapEntry>;
      klineMap: Record<string, StockPrice[]>;
      quantDataMap: Record<string, StockQuantData>;
      simonsRecMap: Record<string, StockRecommendation>;
      latestKlineDate: string;
      analyzedAt: string;
      analyzedDate?: string;
      watchlistKeys: string; // 用來檢測觀察名單是否變更
      cacheVersion?: string;
      accessScope?: 'ai' | 'basic';
      refreshSlot?: string;
      priceUpdatedLabel?: string;
      recommendationCounts?: Record<string, number>;
      activeEtfMap?: Record<string, ActiveEtfRadarItem>;
      _dataVersion?: string;
    };
    const cacheKey = CACHE_KEYS.WATCHLIST_FULL;
    const watchlistCodes = watchlist.map(w => w.stockCode);
    const watchlistKeys = watchlistCodes.slice().sort().join(',');
    const refreshSlot = getRefreshSlotInfo();
    const dataVersion = dailyDataVersion || getKnownDailyAiCacheVersion('watchlist');
    if (refreshKey === 0 && hasAiFeature && !dataVersion) {
      ensureDailyAiCacheVersion('watchlist', true).then(version => {
        setDailyDataVersion(version || 'unversioned');
      });
      return;
    }
    const cached = refreshKey === 0
      ? getVersionedCache<WatchlistCacheData>(cacheKey, dataVersion) || getVersionedPersistentCache<WatchlistCacheData>(WATCHLIST_PERSISTENT_CACHE_KEY, refreshSlot.key, dataVersion)
      : null;

    function applyWatchlistCache(cache: WatchlistCacheData) {
      setLiveQuotes(cache.quotes || {});
      setIndustryMap(cache.industryMap || {});
      setMarketMap(cache.marketMap || {});
      setKlineMap(cache.klineMap || {});
      setQuantDataMap(hasAiFeature ? cache.quantDataMap || {} : {});
      setSimonsRecMap(cache.simonsRecMap || {});
      setRecommendationCounts(cache.recommendationCounts || {});
      setActiveEtfMap(cache.activeEtfMap || {});
      setLatestKlineDate(cache.latestKlineDate || '');
      setLastAnalyzedAt(cache.analyzedAt);
      setPriceUpdatedLabel(cache.priceUpdatedLabel || '');
      setUsingWatchlistCache(true);
    }

    async function refreshMissingCacheData(baseCache: WatchlistCacheData) {
      const missingKlineCodes = getMissingKlineCodes(baseCache.klineMap, watchlistCodes);
      const needsRecommendation = hasAiFeature && watchlistCodes.some(code => !baseCache.simonsRecMap?.[code]);
      if (missingKlineCodes.length === 0 && !needsRecommendation) return;

      const stockDataMap: Record<string, StockData | null> = {};
      watchlist.forEach(item => {
        const cachedPrices = baseCache.klineMap?.[item.stockCode] || [];
        stockDataMap[item.stockCode] = cachedPrices.length > 0
          ? {
              coid: item.stockCode,
              stkname: item.stockName,
              subindustry: baseCache.industryMap?.[item.stockCode] || '',
              status: '',
              prices: cachedPrices,
            }
          : null;
      });

      const fetchedRows = await Promise.all(
        missingKlineCodes.map(code => fetchStockData(code).catch(() => null))
      );
      const mergedQuotes = { ...(baseCache.quotes || {}) };
      const mergedIndustry = { ...(baseCache.industryMap || {}) };
      const mergedKline = { ...(baseCache.klineMap || {}) };
      missingKlineCodes.forEach((code, index) => {
        const data = fetchedRows[index];
        stockDataMap[code] = data;
        if (!data?.prices?.length) return;
        mergedIndustry[code] = data.subindustry || mergedIndustry[code] || '';
        mergedKline[code] = data.prices.slice(-126);
        const latest = data.prices[data.prices.length - 1];
        const prev = data.prices.length > 1 ? data.prices[data.prices.length - 2] : null;
        const close = Number(latest?.close_d);
        const prevClose = Number(prev?.close_d);
        if (Number.isFinite(close) && close > 0) {
          mergedQuotes[code] = {
            close,
            change: Number.isFinite(prevClose) && prevClose > 0 ? close - prevClose : mergedQuotes[code]?.change || 0,
          };
        }
      });

      const mergedQuant = { ...(baseCache.quantDataMap || {}) };
      const mergedRec = { ...(baseCache.simonsRecMap || {}) };
      if (needsRecommendation) {
        const simonsItems = await fetchSimonsData(undefined, { forceFresh: false }).catch(() => []);
        const simonsItemMap: Record<string, SimonsItem> = {};
        simonsItems.forEach(item => { simonsItemMap[item.coid] = item; });
        watchlist.forEach(item => {
          if (mergedRec[item.stockCode]) return;
          const qd = mergedQuant[item.stockCode];
          const simonsItem = simonsItemMap[item.stockCode];
          if (simonsItem) {
            mergedRec[item.stockCode] = toRecommendation(simonsItem, hasAiFeature ? qd : undefined);
          } else if (qd?.aiQuanBackDataComment) {
            mergedRec[item.stockCode] = toRecommendation(
              buildFallbackSimonsItem(item.stockCode, item.stockName, qd, stockDataMap[item.stockCode], mergedQuotes[item.stockCode]),
              qd
            );
          }
        });
      }

      const latestKlineDate = watchlistCodes.reduce((latest, code) => {
        const rows = mergedKline[code] || [];
        const date = rows[rows.length - 1]?.mdate || '';
        return date > latest ? date : latest;
      }, baseCache.latestKlineDate || '');
      const refreshedCache: WatchlistCacheData = {
        ...baseCache,
        quotes: mergedQuotes,
        industryMap: mergedIndustry,
        klineMap: mergedKline,
        quantDataMap: mergedQuant,
        simonsRecMap: mergedRec,
        latestKlineDate,
        watchlistKeys,
        refreshSlot: refreshSlot.key,
        _dataVersion: dataVersion || baseCache._dataVersion,
      };

      setLiveQuotes(mergedQuotes);
      setIndustryMap(mergedIndustry);
      setKlineMap(mergedKline);
      setSimonsRecMap(mergedRec);
      setLatestKlineDate(latestKlineDate);
      setCache<WatchlistCacheData>(cacheKey, refreshedCache, Math.min(WATCHLIST_FULL_TTL_MS, refreshSlot.ttlMs));
      setPersistentCache<WatchlistCacheData>(WATCHLIST_PERSISTENT_CACHE_KEY, refreshedCache, Math.min(WATCHLIST_FULL_TTL_MS, refreshSlot.ttlMs), refreshSlot.key);
      if (missingKlineCodes.length > 0) {
        checkWatchlistSignals(stockDataMap).catch(() => {});
      }
    }
    if (
      refreshKey === 0 &&
      cached &&
      cacheCoversWatchlist(cached.watchlistKeys, watchlistCodes) &&
      cached.analyzedDate === getTodayString() &&
      cached.cacheVersion === WATCHLIST_CACHE_VERSION &&
      cached.accessScope === (hasAiFeature ? 'ai' : 'basic') &&
      cached.refreshSlot === refreshSlot.key &&
      hasUsableWatchlistCache(cached, watchlistCodes, hasAiFeature)
    ) {
      const normalizedCache: WatchlistCacheData = {
        ...cached,
        watchlistKeys,
        refreshSlot: refreshSlot.key,
        _dataVersion: dataVersion || cached._dataVersion,
      };
      applyWatchlistCache(normalizedCache);
      setCache(cacheKey, normalizedCache, refreshSlot.ttlMs);
      setPersistentCache(WATCHLIST_PERSISTENT_CACHE_KEY, normalizedCache, refreshSlot.ttlMs, refreshSlot.key);
      refreshMissingCacheData(normalizedCache).catch(() => {});
      return;
    }

    async function tryLoadCloudCache(): Promise<boolean> {
      if (refreshKey !== 0) return false;
      const cloud = await fetchUserMarketDailyCache<WatchlistCacheData>('watchlist');
      if (!cloud?.payload) return false;
      const payload = cloud.payload;
      if (
        cloud.status === 'waiting-simons' ||
        cloud.status === 'empty' ||
        !cacheCoversWatchlist(cloud.signature, watchlistCodes) ||
        !cacheCoversWatchlist(payload.watchlistKeys, watchlistCodes) ||
        payload.analyzedDate !== getTodayString() ||
        payload.cacheVersion !== WATCHLIST_CACHE_VERSION ||
        payload.accessScope !== (hasAiFeature ? 'ai' : 'basic') ||
        !hasUsableWatchlistCache(payload, watchlistCodes, hasAiFeature)
      ) {
        return false;
      }

      const cloudCache: WatchlistCacheData = {
        ...payload,
        watchlistKeys,
        refreshSlot: refreshSlot.key,
        _dataVersion: dataVersion || payload._dataVersion,
      };
      applyWatchlistCache(cloudCache);
      setCache<WatchlistCacheData>(cacheKey, cloudCache, Math.min(WATCHLIST_FULL_TTL_MS, refreshSlot.ttlMs));
      setPersistentCache<WatchlistCacheData>(WATCHLIST_PERSISTENT_CACHE_KEY, cloudCache, Math.min(WATCHLIST_FULL_TTL_MS, refreshSlot.ttlMs), refreshSlot.key);
      refreshMissingCacheData(cloudCache).catch(() => {});
      return true;
    }

    async function fetchQuotesAndSignals() {
      setUsingWatchlistCache(false);
      setDataLoading(true);
      setLoadingStep(`正在抓取 ${watchlist.length} 支股票報價...`);
      setQuotesLoading(true);

      const forceFresh = refreshKey > 0;

      const cachedOfficialMap = getCache<Record<string, OfficialPriceMapEntry>>(CACHE_KEYS.TWSE_PRICE_MAP);
      const shouldRefreshPrices = canAutoRefreshPrices();
      const officialMapPromise = shouldRefreshPrices
        ? fetchOfficialPriceMap().catch(() => cachedOfficialMap || {} as Record<string, OfficialPriceMapEntry>)
        : Promise.resolve(cachedOfficialMap || {} as Record<string, OfficialPriceMapEntry>);
      const realtimeQuotesPromise = shouldRefreshPrices
        ? Promise.all(watchlist.map(w => fetchOfficialClosePrice(w.stockCode).catch((): OfficialClosePrice | null => null)))
        : Promise.resolve([] as Array<OfficialClosePrice | null>);

      // 平行抓取觀察股票 K 線、盤中即時價與官方報價；非開盤時官方報價只讀前端快取。
      const [stockDatas, officialMap, realtimeQuotes] = await Promise.all([
        Promise.all(watchlist.map(w => fetchStockData(w.stockCode).catch(() => null))),
        officialMapPromise,
        realtimeQuotesPromise,
      ]);
      setMarketMap(officialMap);

      const quotes: Record<string, { close: number; change: number }> = {};
      let realtimeQuoteCount = 0;
      const stockDataMap: Record<string, StockData | null> = {};
      const nextKlineMap: Record<string, StockPrice[]> = {};
      stockDatas.forEach((res, idx) => {
        const code = watchlist[idx].stockCode;
        const realtime = realtimeQuotes[idx];
        const realtimeClose = realtime?.price && realtime.price > 0 ? realtime.price : 0;
        stockDataMap[code] = res;
        if (realtimeClose > 0) {
          realtimeQuoteCount++;
          quotes[code] = {
            close: realtimeClose,
            change: realtime?.previousClose && realtime.previousClose > 0
              ? realtimeClose - realtime.previousClose
              : 0,
          };
        }
        if (res && res.prices && res.prices.length >= 2) {
          nextKlineMap[code] = res.prices.slice(-126);
          const latest = res.prices[res.prices.length - 1];
          const prev = res.prices[res.prices.length - 2];
          const close = realtimeClose || parseFloat(latest.close_d);
          const prevClose = parseFloat(prev.close_d);

          const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
          const latestDateStr = (realtime?.date || latest.mdate || '').replace(/-/g, '');
          const isToday = latestDateStr === todayStr;
          const changeBase = realtime?.previousClose && realtime.previousClose > 0
            ? close - realtime.previousClose
            : close - prevClose;

          quotes[code] = {
            close,
            change: isToday ? changeBase : 0,
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
      setKlineMap(nextKlineMap);
      setQuotesLoading(false);
      const nextPriceUpdatedLabel = realtimeQuoteCount > 0 && canAutoRefreshPrices()
        ? formatPriceUpdateLabel()
        : '';
      if (nextPriceUpdatedLabel) setPriceUpdatedLabel(nextPriceUpdatedLabel);

      // 記錄最新 K 線日期
      let latestDate = '';
      stockDatas.forEach(res => {
        if (res?.prices?.length) {
          const d = res.prices[res.prices.length - 1].mdate;
          if (d && d > latestDate) latestDate = d;
        }
      });
      if (latestDate) setLatestKlineDate(latestDate);

      setLoadingStep(hasAiFeature ? '正在載入 Simons 量化模型...' : '正在載入股票本質資料...');

      const simonsItems = await fetchSimonsData(undefined, { forceFresh }).catch(() => []);

      const simonsItemMap: Record<string, SimonsItem> = {};
      simonsItems.forEach((item) => {
        simonsItemMap[item.coid] = item;
      });

      const nextQuantDataMap: Record<string, StockQuantData> = {};
      const nextSimonsRecMap: Record<string, StockRecommendation> = {};

      setLoadingStep('正在分析 MA5 與量能訊號...');
      // 訊號 + 警告分析
      await checkWatchlistSignals(stockDataMap);
      setLiveQuotes(quotes);
      setDataLoading(false);

      if (!hasAiFeature) {
        watchlist.forEach((w) => {
          const simonsItem = simonsItemMap[w.stockCode];
          if (simonsItem) {
            nextSimonsRecMap[w.stockCode] = toRecommendation(simonsItem);
          }
        });
        setQuantDataMap({});
        setSimonsRecMap(nextSimonsRecMap);
        setQuantFailedCodes(new Set());
        setQuantSyncingCodes(new Set());

        const analyzedAt = formatAnalyzeTimestamp();
        const analyzedDate = getTodayString();
        setLastAnalyzedAt(analyzedAt);

        const cacheData: WatchlistCacheData = {
          quotes,
          industryMap: nextIndustryMap,
          marketMap: officialMap,
          klineMap: nextKlineMap,
          quantDataMap: {},
          simonsRecMap: nextSimonsRecMap,
          latestKlineDate: latestDate,
          analyzedAt,
          analyzedDate,
          watchlistKeys,
          cacheVersion: WATCHLIST_CACHE_VERSION,
          accessScope: 'basic',
          refreshSlot: refreshSlot.key,
          priceUpdatedLabel: nextPriceUpdatedLabel || undefined,
          _dataVersion: dataVersion || undefined,
        };
        const ttlMs = Math.min(WATCHLIST_FULL_TTL_MS, refreshSlot.ttlMs);
        setCache<WatchlistCacheData>(cacheKey, cacheData, ttlMs);
        setPersistentCache<WatchlistCacheData>(WATCHLIST_PERSISTENT_CACHE_KEY, cacheData, ttlMs, refreshSlot.key);
        return;
      }

      setLoadingStep(`正在同步最新 AI 訊號 0/${watchlist.length}...`);
      setDataLoading(true);
      setQuantDataMap({});
      setSimonsRecMap({});
      setQuantFailedCodes(new Set());
      setQuantSyncingCodes(new Set(watchlistCodes));

      let completed = 0;
      const queue = [...watchlist];
      const workerCount = Math.min(4, queue.length);
      async function runWorker() {
        while (queue.length > 0) {
          const w = queue.shift();
          if (!w) return;
          const qd = await withTimeout(
            fetchStockQuantData(w.stockCode, undefined, { forceFresh }),
            12000
          ).catch(() => null);

          if (qd) {
            nextQuantDataMap[w.stockCode] = qd;
            const simonsItem = simonsItemMap[w.stockCode];
            let rec: StockRecommendation | null = null;
            if (simonsItem) {
              rec = toRecommendation(simonsItem, qd);
            } else if (qd.aiQuanBackDataComment) {
              rec = toRecommendation(
                buildFallbackSimonsItem(w.stockCode, w.stockName, qd, stockDataMap[w.stockCode], quotes[w.stockCode]),
                qd
              );
            }
            if (rec) nextSimonsRecMap[w.stockCode] = rec;
            setQuantDataMap(prev => ({ ...prev, [w.stockCode]: qd }));
            if (rec) setSimonsRecMap(prev => ({ ...prev, [w.stockCode]: rec }));
          } else {
            setQuantFailedCodes(prev => {
              const next = new Set(prev);
              next.add(w.stockCode);
              return next;
            });
          }

          completed += 1;
          setQuantSyncingCodes(prev => {
            const next = new Set(prev);
            next.delete(w.stockCode);
            return next;
          });
          setLoadingStep(`正在同步最新 AI 訊號 ${completed}/${watchlist.length}...`);
        }
      }

      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

      // 記錄分析完成時間
      const analyzedAt = formatAnalyzeTimestamp();
      const analyzedDate = getTodayString();
      setLastAnalyzedAt(analyzedAt);

      // 寫入短效快取，避免切頁時重複分析，但過期或跨日後進頁會自動更新。
      const cacheData: WatchlistCacheData = {
        quotes,
        industryMap: nextIndustryMap,
        marketMap: officialMap,
        klineMap: nextKlineMap,
        quantDataMap: nextQuantDataMap,
        simonsRecMap: nextSimonsRecMap,
        latestKlineDate: latestDate,
        analyzedAt,
        analyzedDate,
        watchlistKeys,
        cacheVersion: WATCHLIST_CACHE_VERSION,
        accessScope: 'ai',
        refreshSlot: refreshSlot.key,
        priceUpdatedLabel: nextPriceUpdatedLabel || undefined,
          _dataVersion: dataVersion || undefined,
        };
      const ttlMs = Math.min(WATCHLIST_FULL_TTL_MS, refreshSlot.ttlMs);
      setCache<WatchlistCacheData>(cacheKey, cacheData, ttlMs);
      setPersistentCache<WatchlistCacheData>(WATCHLIST_PERSISTENT_CACHE_KEY, cacheData, ttlMs, refreshSlot.key);

      setDataLoading(false);
    }

    tryLoadCloudCache()
      .then((loaded) => {
        if (!loaded) return fetchQuotesAndSignals();
        return undefined;
      })
      .catch((err) => {
        console.error('watchlist fetchQuotesAndSignals error:', err);
        setDataLoading(false);
        setQuotesLoading(false);
        setLoadingStep('資料讀取失敗，請稍後再試或手動重新抓取');
      });
  }, [watchlist, refreshKey, checkWatchlistSignals, hasAiFeature, dailyDataVersion]);

  useEffect(() => {
    if (watchlist.length === 0) return;
    let cancelled = false;
    let running = false;

    async function refreshWatchlistPrices() {
      if (running || cancelled || !canAutoRefreshPrices()) return;
      running = true;
      const codes = watchlist.map(w => w.stockCode);
      const realtimeQuotes = await Promise.all(
        codes.map(code => fetchOfficialClosePrice(code).catch((): OfficialClosePrice | null => null))
      );
      if (!cancelled) {
        const nextQuotes: Record<string, { close: number; change: number }> = {};
        codes.forEach((code, index) => {
          const result = realtimeQuotes[index];
          if (!result) return;
          const price = Number(result.price);
          if (!Number.isFinite(price) || price <= 0) return;
          nextQuotes[code] = {
            close: price,
            change: result.previousClose && result.previousClose > 0
              ? price - result.previousClose
              : liveQuotes[code]?.change ?? 0,
          };
        });

        if (Object.keys(nextQuotes).length > 0) {
          const nextPriceUpdatedLabel = formatPriceUpdateLabel();
          setPriceUpdatedLabel(nextPriceUpdatedLabel);
          setLiveQuotes(prev => {
            const merged = { ...prev, ...nextQuotes };
            const refreshSlot = getRefreshSlotInfo();
            const cacheData = getCache<any>(CACHE_KEYS.WATCHLIST_FULL)
              || getPersistentCache<any>(WATCHLIST_PERSISTENT_CACHE_KEY, refreshSlot.key);
            if (cacheData?.quotes) {
              const updatedCache = {
                ...cacheData,
                quotes: { ...cacheData.quotes, ...nextQuotes },
                priceUpdatedLabel: nextPriceUpdatedLabel,
              };
              setCache(CACHE_KEYS.WATCHLIST_FULL, updatedCache, refreshSlot.ttlMs);
              setPersistentCache(WATCHLIST_PERSISTENT_CACHE_KEY, updatedCache, refreshSlot.ttlMs, refreshSlot.key);
            }
            return merged;
          });
        }
      }
      running = false;
    }

    const intervalId = window.setInterval(refreshWatchlistPrices, PRICE_AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshWatchlistPrices);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshWatchlistPrices);
    };
  }, [watchlist, liveQuotes]);

  function getSignalForStock(stockCode: string): WatchlistSignal | undefined {
    return watchlistSignals.find(s => s.stockCode === stockCode);
  }

  function getWarningForStock(stockCode: string): WatchlistWarning | undefined {
    return watchlistWarnings.find(w => w.stockCode === stockCode);
  }

  function renderRecommendationCountBadge(stockCode: string) {
    const count = recommendationCounts[stockCode] || 0;
    if (count <= 1) return null;
    return (
      <span className="wl-rec-count-badge" title="最近90天內重複出現在找股票推薦">
        推薦X{count}
      </span>
    );
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

  function buildFallbackSimonsItem(
    stockCode: string,
    stockName: string,
    qd: StockQuantData,
    stockData?: StockData | null,
    quote?: { close: number; change: number }
  ): SimonsItem {
    const latestPrice = stockData?.prices?.at(-1)?.close_d ?? String(quote?.close || 0);
    const prevPrice = stockData?.prices?.at(-2)?.close_d;
    const latestClose = parseFloat(latestPrice) || quote?.close || 0;
    const previousClose = parseFloat(prevPrice || '') || latestClose;
    const retW = latestClose >= previousClose ? 'rise' : 'drop';
    const gvi = qd.stockInfo?.gvi ?? 0;
    const mediangvi = qd.stockInfo?.mediangvi ?? '0';

    return {
      mdate: stockData?.prices?.at(-1)?.mdate || getTodayString(),
      coid: stockCode,
      stkname: stockName,
      close: String(latestClose || ''),
      strength: '1.2',
      psr: 5,
      subindustry: stockData?.subindustry || null,
      status: stockData?.status || null,
      unusual: 'N',
      category: stockData?.subindustry || '',
      value: '',
      ret_w: retW,
      ret_m: retW,
      wtcost: String(latestClose || ''),
      fcost: String(latestClose || ''),
      tcost: null,
      dcost: String(latestClose || ''),
      gvi,
      mediangvi: String(mediangvi),
      yflow: '',
      tcr_today: '',
      fcr_today: '',
    };
  }

  function getAiSignalBadge(stockCode: string) {
    if (!hasAiFeature) return null;
    const qd = quantDataMap[stockCode];
    if (!qd && quantSyncingCodes.has(stockCode)) {
      return (
        <div className="wl-ai-icon-badge wl-ai-icon-syncing">
          <div className="wl-ai-icon-circle wl-ai-circle-syncing">
            <span className="wl-inline-spinner" />
          </div>
          <span className="wl-ai-icon-label">AI同步中</span>
        </div>
      );
    }
    if (!qd && quantFailedCodes.has(stockCode)) {
      return (
        <div className="wl-ai-icon-badge wl-ai-icon-pending">
          <div className="wl-ai-icon-circle wl-ai-circle-pending">!</div>
          <span className="wl-ai-icon-label">待重抓</span>
        </div>
      );
    }
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
    if (!hasAiFeature) return 'neutral';
    return quantDataMap[stockCode]?.currentSignal ?? 'neutral';
  }

  function hasReentryAfterExit(stockCode: string): boolean {
    if (!hasAiFeature) return false;
    return Boolean(quantDataMap[stockCode]?.reentryAfterExit?.hasReentry);
  }

  function getAiSignalFilterLabel(filter: WatchlistAiFilter): string {
    switch (filter) {
      case 'buy': return 'AI進場';
      case 'sell': return 'AI出場';
      case 'neutral': return 'AI中立';
      case 'reentry': return '出場後再進場';
      default: return '全部';
    }
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

  function getRemarkFilterFromRemark(remark: string): WatchlistRemarkFilter {
    if (remark.includes('超高')) return 'ultra';
    if (remark.includes('高度')) return 'high';
    if (remark.includes('中度')) return 'mid';
    if (remark.includes('低度')) return 'low';
    return 'all';
  }

  function getAiRecommendationBadge(stockCode: string) {
    if (!hasAiFeature) return null;
    const qd = quantDataMap[stockCode];
    const remark = qd?.aiQuanBackDataComment?.remark;
    if (!remark) return null;
    const remarkFilter = getRemarkFilterFromRemark(remark);
    return (
      <div className={`wl-ai-rank-badge ${getRemarkStyle(remark)}`}>
        <span className={`wl-ai-rank-icon wl-remark-ficon wl-remark-ficon-${remarkFilter}`}>
          {getRemarkFilterIcon(remarkFilter)}
        </span>
        <span className="wl-ai-rank-text">
          <span className="wl-ai-rank-title">AI推薦</span>
          <strong>{remark}</strong>
        </span>
      </div>
    );
  }

  function getWatchlistCleanupAlert(stockCode: string): { type: 'low'; title: string; desc: string } | null {
    if (!hasAiFeature) return null;
    const remark = quantDataMap[stockCode]?.aiQuanBackDataComment?.remark || '';
    const isLowRank = getRemarkFilterFromRemark(remark) === 'low';

    if (!isLowRank) return null;
    return {
      type: 'low',
      title: 'AI低度觀察清理',
      desc: '目前推薦等級降到低度，若沒有其他理由追蹤，可直接移除觀察。',
    };
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

  function renderAiQuantChips(stockCode: string, stockName: string) {
    if (!hasAiFeature) return null;
    const qd = quantDataMap[stockCode];
    if (!qd || !qd.aiQuanBackDataComment) return null;

    const cumRet = qd.aiQuanBackDataComment.cum_ret ?? '--';
    const ptsRaw = qd.chipStability ? parseFloat(qd.chipStability.pts) : null;
    const chipLabel = ptsRaw === null ? '--' :
      ptsRaw >= 9 ? '最乾淨' :
      ptsRaw >= 7 ? '非常穩定' :
      ptsRaw >= 5 ? '穩定' :
      ptsRaw >= 3 ? '普通' : '凌亂';
    const cumDisplay = cumRet === '--' ? '--' : (cumRet.startsWith('-') ? cumRet : `+${cumRet}`);

    return (
      <>
        <button
          type="button"
          className={`wl-quant-chip wl-quant-chip-ret ${getCumRetStyle(cumRet)}`}
          title="點擊查看累積報酬說明"
          onClick={(e) => {
            e.stopPropagation();
            setSmallChipDialog({
              title: `${stockName} ${stockCode}`,
              subtitle: `累積報酬 ${cumDisplay}`,
              text: '累積報酬來自 Simons 量化模型的歷史策略結果，用來輔助理解這檔股票在模型中的過往表現。',
              details: [
                `目前顯示：${cumDisplay}`,
                '正值代表模型歷史策略累積為正報酬；負值代表歷史策略累積為負報酬。',
                '數值很高時，代表模型歷史表現強，但也可能表示股價或題材已經走了一大段。',
              ],
              note: '累積報酬不是未來報酬保證，仍需搭配 AI 進場訊號、股票本質、籌碼與風險控管。',
            });
          }}
        >
          📊 累積報酬 {cumDisplay}
        </button>
        <button
          type="button"
          className={`wl-quant-chip wl-quant-chip-pts ${ptsRaw !== null ? getChipStyle(ptsRaw) : ''}`}
          title="點擊查看籌碼分數說明"
          onClick={(e) => {
            e.stopPropagation();
            setSmallChipDialog({
              title: `${stockName} ${stockCode}`,
              subtitle: `籌碼 ${ptsRaw !== null ? `${ptsRaw.toFixed(0)}分` : '--'} ${chipLabel}`,
              text: '籌碼分數用來觀察籌碼結構是否穩定，分數越高代表模型看到的籌碼越乾淨、波動干擾較少。',
              details: [
                `目前顯示：${ptsRaw !== null ? `${ptsRaw.toFixed(0)}分 ${chipLabel}` : '尚無資料'}`,
                '7分以上：籌碼相對穩定，可列為加分條件。',
                '3到6分：籌碼普通或中性，需要搭配其他訊號。',
                '3分以下：籌碼較凌亂，通常不適合只因題材追價。',
              ],
              note: '籌碼穩定不等於一定上漲，它只是降低雜訊的一個輔助指標。',
            });
          }}
        >
          🔒 籌碼 {ptsRaw !== null ? `${ptsRaw.toFixed(0)}分` : '--'} {chipLabel}
        </button>
      </>
    );
  }

  function getActiveEtfActionLabel(action: ActiveEtfRadarItem['etfs'][number]['action']): string {
    switch (action) {
      case 'added': return '新進';
      case 'increased': return '加碼';
      case 'decreased': return '減碼';
      case 'removed': return '剔除';
      default: return '持有';
    }
  }

  function getActiveEtfDetailText(radar?: ActiveEtfRadarItem): string {
    if (!radar) {
      const hasImportedData = Object.keys(activeEtfMap).length > 0;
      return hasImportedData
        ? '大型台股 ETF 已有匯入資料，但近 5 日沒有看到這檔股票的新進、加碼、減碼、剔除或持有紀錄。'
        : '目前大型台股 ETF 的每日持股差異還沒有匯入。匯入後會顯示近 5 日新進、加碼、減碼、剔除次數。';
    }
    const detail = radar.etfs
      .map(item => `${item.etfName || item.etfCode} ${getActiveEtfActionLabel(item.action)}`)
      .join('、');
    return `近${radar.days}日：新進${radar.addedEtfCount}、加碼${radar.increasedEtfCount}、減碼${radar.decreasedEtfCount}、剔除${radar.removedEtfCount}。${detail || '尚無 ETF 明細'}。資料日：${radar.latestDate || '待同步'}。`;
  }

  function renderActiveEtfRadarChip(stockCode: string, stockName: string, showPlaceholder = false) {
    const radar = activeEtfMap[stockCode];
    if (!radar) {
      if (!showPlaceholder) return null;
      const hasImportedData = Object.keys(activeEtfMap).length > 0;
      return (
        <button
          type="button"
          className="wl-quant-chip wl-active-etf-chip wl-active-etf-chip-neutral"
          title="點擊查看 ETF 支撐說明"
          onClick={(e) => {
            e.stopPropagation();
            setActiveEtfDialog({ stockCode, stockName });
          }}
        >
          ETF支撐 {hasImportedData ? '無紀錄' : '待匯入'}
        </button>
      );
    }
    if (radar.holdingEtfCount <= 0) return null;
    const label = `ETF+${radar.holdingEtfCount}`;
    return (
      <button
        type="button"
        className={`wl-quant-chip wl-active-etf-chip wl-active-etf-chip-${radar.signal}`}
        title={`目前有 ${radar.holdingEtfCount} 檔追蹤 ETF 持有，點擊查看 ETF 支撐詳細說明`}
        onClick={(e) => {
          e.stopPropagation();
          setActiveEtfDialog({ stockCode, stockName, radar });
        }}
      >
        {label}
      </button>
    );
  }

  function renderHalfYearKlineChart(stockCode: string, currentPrice: number) {
    const rawRows = klineMap[stockCode] || [];
    const points = rawRows
      .map(row => ({
        date: row.mdate,
        open: parseFloat(row.open_d),
        high: parseFloat(row.high_d),
        low: parseFloat(row.low_d),
        close: parseFloat(row.close_d),
      }))
      .filter(row =>
        row.date &&
        Number.isFinite(row.open) &&
        Number.isFinite(row.high) &&
        Number.isFinite(row.low) &&
        Number.isFinite(row.close) &&
        row.high >= row.low
      )
      .slice(-126);

    if (points.length < 12) {
      return (
        <div className="wl-kline-panel wl-kline-empty" aria-label="半年 K 線資料不足">
          <div className="wl-kline-title">半年K線</div>
          <div className="wl-kline-placeholder">資料累積中</div>
        </div>
      );
    }

    const width = 230;
    const height = 112;
    const padX = 8;
    const padTop = 8;
    const padBottom = 15;
    const chartHeight = height - padTop - padBottom;
    const highs = points.map(point => point.high);
    const lows = points.map(point => point.low);
    const maxPrice = Math.max(...highs);
    const minPrice = Math.min(...lows);
    const range = Math.max(maxPrice - minPrice, maxPrice * 0.02, 1);
    const y = (value: number) => padTop + ((maxPrice - value) / range) * chartHeight;
    const xStep = (width - padX * 2) / Math.max(points.length - 1, 1);
    const candleWidth = Math.max(1, Math.min(5, xStep * 0.64));
    const firstClose = points[0].close;
    const lastClose = points[points.length - 1].close || currentPrice;
    const halfYearChange = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;
    const isTrendUp = halfYearChange >= 0;
    const ma20 = points.map((_, index) => {
      if (index < 19) return null;
      const window = points.slice(index - 19, index + 1);
      return window.reduce((sum, point) => sum + point.close, 0) / window.length;
    });
    const maPath = ma20
      .map((value, index) => value === null ? '' : `${padX + index * xStep},${y(value)}`)
      .filter(Boolean)
      .join(' ');
    const startLabel = points[0].date.slice(5).replace('-', '/');
    const endLabel = points[points.length - 1].date.slice(5).replace('-', '/');

    return (
      <div className="wl-kline-panel" aria-label={`${stockCode} 半年日 K 線`}>
        <div className="wl-kline-head">
          <span>半年K線</span>
          <span className={isTrendUp ? 'text-profit' : 'text-loss'}>
            {isTrendUp ? '+' : ''}{halfYearChange.toFixed(1)}%
          </span>
        </div>
        <svg className="wl-kline-svg" viewBox={`0 0 ${width} ${height}`} role="img">
          {[0.25, 0.5, 0.75].map(level => (
            <line
              key={level}
              x1={padX}
              x2={width - padX}
              y1={padTop + chartHeight * level}
              y2={padTop + chartHeight * level}
              className="wl-kline-grid"
            />
          ))}
          {maPath && (
            <polyline
              points={maPath}
              className="wl-kline-ma"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {points.map((point, index) => {
            const x = padX + index * xStep;
            const openY = y(point.open);
            const closeY = y(point.close);
            const highY = y(point.high);
            const lowY = y(point.low);
            const up = point.close >= point.open;
            const bodyY = Math.min(openY, closeY);
            const bodyHeight = Math.max(Math.abs(closeY - openY), 1.4);
            return (
              <g key={`${point.date}-${index}`} className={up ? 'wl-kline-up' : 'wl-kline-down'}>
                <line x1={x} x2={x} y1={highY} y2={lowY} vectorEffect="non-scaling-stroke" />
                <rect
                  x={x - candleWidth / 2}
                  y={bodyY}
                  width={candleWidth}
                  height={bodyHeight}
                  rx="0.8"
                />
              </g>
            );
          })}
          <text x={padX} y={height - 3} className="wl-kline-date">{startLabel}</text>
          <text x={width - padX} y={height - 3} textAnchor="end" className="wl-kline-date">{endLabel}</text>
        </svg>
      </div>
    );
  }

  async function handleRemove(stockCode: string) {
    await removeFromWatchlist(stockCode);
    setRemoveConfirm(null);
  }

  // AI 推薦等級轉分數（超高度 > 高度 > 中度 > 低度）
  function getRemarkScore(stockCode: string): number {
    if (!hasAiFeature) return 0;
    const remark = quantDataMap[stockCode]?.aiQuanBackDataComment?.remark ?? '';
    if (remark.includes('超高')) return 4;
    if (remark.includes('高度')) return 3;
    if (remark.includes('中度')) return 2;
    if (remark.includes('低度')) return 1;
    return 0;
  }

  function getCumRetValue(stockCode: string): number | null {
    const raw = quantDataMap[stockCode]?.aiQuanBackDataComment?.cum_ret;
    if (!raw) return null;
    const parsed = parseFloat(String(raw).replace('%', '').replace('+', '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  function getChipPtsValue(stockCode: string): number | null {
    const raw = quantDataMap[stockCode]?.chipStability?.pts;
    if (raw === undefined || raw === null) return null;
    const parsed = parseFloat(String(raw));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function getSimonsScoreValue(stockCode: string): number | null {
    const score = simonsRecMap[stockCode]?.score;
    return Number.isFinite(score) ? score : null;
  }

  function getCreatedAtValue(stockCode: string): number | null {
    const item = watchlist.find(w => w.stockCode === stockCode);
    const value = item?.createdAt ? new Date(item.createdAt).getTime() : NaN;
    return Number.isFinite(value) ? value : null;
  }

  function getSortValue(stockCode: string): number | null {
    const activeSortKey = hasAiFeature ? sortKey : DEFAULT_WATCHLIST_SORT_KEY;
    switch (activeSortKey) {
      case 'recommendationCount': return recommendationCounts[stockCode] || 0;
      case 'cumRet': return getCumRetValue(stockCode);
      case 'chipPts': return getChipPtsValue(stockCode);
      case 'createdAt': return getCreatedAtValue(stockCode);
      case 'simonsScore': return getSimonsScoreValue(stockCode);
      default: return null;
    }
  }

  function getSortLabel(key: WatchlistSortKey): string {
    switch (key) {
      case 'recommendationCount': return '推薦次數';
      case 'cumRet': return '累計報酬';
      case 'chipPts': return '籌碼分數';
      case 'createdAt': return '觀察時間';
      case 'simonsScore': return '股票本質';
      default: return '股票本質';
    }
  }

  function getSortDirectionLabel(direction: WatchlistSortDirection): string {
    return direction === 'asc' ? '遞增排序' : '遞減排序';
  }

  function getRemarkFilterForStock(stockCode: string): WatchlistRemarkFilter {
    if (!hasAiFeature) return 'all';
    const remark = quantDataMap[stockCode]?.aiQuanBackDataComment?.remark ?? '';
    return getRemarkFilterFromRemark(remark);
  }

  function getRemarkFilterLabel(filter: WatchlistRemarkFilter): string {
    switch (filter) {
      case 'ultra': return '超高度';
      case 'high': return '高度';
      case 'mid': return '中度';
      case 'low': return '低度';
      default: return '全部';
    }
  }

  function getRemarkFilterIcon(filter: WatchlistRemarkFilter): ReactNode {
    switch (filter) {
      case 'ultra': return '💎';
      case 'high':
      case 'mid':
      case 'low':
        return (
          <span className={`wl-mineral-icon wl-mineral-${filter}`} aria-hidden="true">
            <span className="wl-mineral-piece wl-mineral-piece-main" />
            <span className="wl-mineral-piece wl-mineral-piece-left" />
            <span className="wl-mineral-piece wl-mineral-piece-right" />
          </span>
        );
      default: return '💎';
    }
  }

  const clearCompositeFilters = () => {
    setFilterAiSignal('all');
    setFilterAiRemark('all');
  };

  const normalizedWatchlistSearch = watchlistSearch.trim().toLowerCase();

  // 排序：預設用股票本質；同分或缺資料時再用技術訊號與 AI 推薦等級補排序。
  const sortedWatchlist = [...watchlist]
    .sort((a, b) => {
      const valA = getSortValue(a.stockCode);
      const valB = getSortValue(b.stockCode);
      if (valA !== null || valB !== null) {
        if (valA === null) return 1;
        if (valB === null) return -1;
        const activeSortDirection = hasAiFeature ? sortDirection : 'desc';
        const sortDiff = activeSortDirection === 'asc' ? valA - valB : valB - valA;
        if (sortDiff !== 0) return sortDiff;
      }

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
      if (normalizedWatchlistSearch) {
        const code = w.stockCode.toLowerCase();
        const name = w.stockName.toLowerCase();
        if (!code.includes(normalizedWatchlistSearch) && !name.includes(normalizedWatchlistSearch)) return false;
      }
      if (filterWarnOnly)   return getWarningForStock(w.stockCode)?.level === 'remove';
      if (hasAiFeature && filterAiSignal === 'reentry' && !hasReentryAfterExit(w.stockCode)) return false;
      if (hasAiFeature && filterAiSignal !== 'all' && filterAiSignal !== 'reentry' && getAiSignalForStock(w.stockCode) !== filterAiSignal) return false;
      if (hasAiFeature && filterAiRemark !== 'all' && getRemarkFilterForStock(w.stockCode) !== filterAiRemark) return false;
      return true;
    });

  const warningCount = watchlistWarnings.filter(w => w.level === 'remove').length;

  // AI 訊號統計
  const aiSignalCounts = watchlist.reduce((acc, w) => {
    const sig = getAiSignalForStock(w.stockCode);
    acc[sig] = (acc[sig] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const reentryAfterExitCount = watchlist.reduce((count, w) => count + (hasReentryAfterExit(w.stockCode) ? 1 : 0), 0);
  const hasAnyQuantData = Object.keys(quantDataMap).length > 0;
  const latestQuantMeta = getLatestQuantMeta(quantDataMap);
  const activeEtfRadarCount = Object.keys(activeEtfMap).length;
  const dataUpdateLabel = latestQuantMeta ? formatMetaDateTime(latestQuantMeta.fetchedAt) : lastAnalyzedAt || '同步中';
  const dataDateLabel = latestQuantMeta?.dataDate ? latestQuantMeta.dataDate.replace(/-/g, '/') : '同步中';
  const dataFreshness = hasAiFeature
    ? getDataFreshness(latestQuantMeta, dataLoading, Boolean(lastAnalyzedAt || hasAnyQuantData))
    : dataLoading
      ? { className: 'wl-data-freshness-updating', label: '正在讀取觀察資料與更新價格' }
      : { className: 'wl-data-freshness-fresh', label: '已使用觀察資料快取' };
  const activeCompositeFilterCount =
    (hasAiFeature && filterAiSignal !== 'all' ? 1 : 0)
    + (hasAiFeature && filterAiRemark !== 'all' ? 1 : 0)
    + (hasAiFeature && (sortKey !== DEFAULT_WATCHLIST_SORT_KEY || sortDirection !== 'desc') ? 1 : 0)
    + (normalizedWatchlistSearch ? 1 : 0);
  const remarkFilterCounts = watchlist.reduce((acc, w) => {
    const remark = getRemarkFilterForStock(w.stockCode);
    if (remark !== 'all') acc[remark] = (acc[remark] || 0) + 1;
    return acc;
  }, {} as Record<WatchlistRemarkFilter, number>);

  return (
    <div className="watchlist-page">
      <div className="page-header">
        <h1 className="page-title">👁️ 觀察名單</h1>
      </div>

      {watchlist.length > 0 && (
        <div className="wl-search-bar" role="search">
          <span className="wl-search-icon" aria-hidden="true">🔎</span>
          <input
            className="wl-search-input"
            type="text"
            placeholder="搜尋觀察股票名稱或代號..."
            value={watchlistSearch}
            onChange={(event) => setWatchlistSearch(event.target.value)}
            aria-label="搜尋觀察名單股票"
          />
          {watchlistSearch.trim() && (
            <button
              className="wl-search-clear"
              type="button"
              onClick={() => setWatchlistSearch('')}
              aria-label="清除觀察搜尋"
            >
              清除
            </button>
          )}
        </div>
      )}

      {dataLoading && watchlist.length > 0 && (
        <div className="wl-loading-bar wl-loading-bar-soft">
          <span className="wl-inline-spinner" />
          <span>{loadingStep}</span>
        </div>
      )}

      {/* 數據來源與更新時間 */}
      {watchlist.length > 0 && (
        <div className="wl-data-source">
          <div className="wl-data-meta-lines">
            <span className={`wl-data-freshness ${dataFreshness.className}`}>{dataFreshness.label}</span>
            <span className="wl-data-meta-today">今天日期：{formatTodayDate()}</span>
            <span className="wl-data-meta-updated">資料更新：{dataUpdateLabel}</span>
            <span className="wl-data-meta-updated">資料日期：{dataDateLabel}</span>
            <span className="wl-data-meta-schedule">固定更新：{getFixedUpdateLabel()}</span>
            <span className="wl-data-meta-schedule">價格：進頁與盤中背景自動檢查</span>
            <span className="wl-data-meta-schedule">ETF支撐：{activeEtfRadarCount > 0 ? `已接入 ${activeEtfRadarCount} 檔股票紀錄` : '等待每日持股差異匯入'}</span>
            {watchlistSignalsLoading && <span className="wl-data-meta-schedule">正在抓取數據中...</span>}
          </div>
          <button
            className="wl-refresh-btn"
            title={hasAiFeature ? '手動檢查每日 AI 快取並更新價格' : '手動重新整理觀察資料'}
            disabled={dataLoading}
            onClick={async () => {
              invalidateDailyMarketDataCaches();
              clearSimonsDataTTLCache();
              if (hasAiFeature) {
                clearQuantSignalTTLCache();
                setLoadingStep('正在手動檢查 Simons 每日資料...');
                await refreshDailyAiCache(watchlist.map(item => item.stockCode));
                const latest = await fetchDailyAiCacheVersion();
                if (latest?.version) {
                  rememberDailyAiCacheVersion(latest.version, 'watchlist');
                  setDailyDataVersion(latest.version);
                  invalidateDailyMarketDataCaches();
                }
              }
              // 重新讀取每日快取。
              setLastAnalyzedAt(null);
              setUsingWatchlistCache(false);
              setLiveQuotes({});
              setPriceUpdatedLabel('');
              setKlineMap({});
              setQuantDataMap({});
              setSimonsRecMap({});
              setRefreshKey(k => k + 1);
            }}
          >
            🔄 重新抓取
          </button>
        </div>
      )}

      {infoDialog && (
        <div className="wl-info-overlay" onClick={() => setInfoDialog(null)}>
          <div className="wl-info-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="wl-info-close" type="button" onClick={() => setInfoDialog(null)} aria-label="關閉">×</button>
            <div className="wl-info-title">
              {infoDialog.stockName} {infoDialog.stockCode}
            </div>
            <div className="wl-info-subtitle">💎 股票本質 {infoDialog.rec.score}分</div>
            <p className="wl-info-text">
              股票本質 = 地基，用來看這檔股票本身條件是否夠好。
            </p>
            <div className="wl-info-rule-list">
              {hasAiFeature && <div>AI 推薦等級：{infoDialog.quantData?.aiQuanBackDataComment?.remark || '尚無資料'}</div>}
              <div>PSR 熱度：{infoDialog.rec.psr ?? '—'}</div>
              <div>Strength 強度：{infoDialog.rec.strength || '—'}</div>
              {hasAiFeature && <div>籌碼穩定度：{infoDialog.quantData?.chipStability?.pts ?? '—'}</div>}
              {hasAiFeature && <div>累積報酬：{infoDialog.quantData?.aiQuanBackDataComment?.cum_ret || '—'}</div>}
            </div>
            <p className="wl-info-note">
              這仍然只是輔助判斷，不等於保證會上漲。
            </p>
          </div>
        </div>
      )}

      {activeEtfDialog && (
        <div className="wl-info-overlay" onClick={() => setActiveEtfDialog(null)}>
          <div className="wl-info-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="wl-info-close" type="button" onClick={() => setActiveEtfDialog(null)} aria-label="關閉">×</button>
            <div className="wl-info-title">
              {activeEtfDialog.stockName} {activeEtfDialog.stockCode}
            </div>
            <div className="wl-info-subtitle">ETF 支撐</div>
            <p className="wl-info-text">
              這張小卡只顯示大型台股 ETF 近 5 日的持股異動次數，不用分數呈現。
            </p>
            <div className="wl-info-rule-list">
              <div>{getActiveEtfDetailText(activeEtfDialog.radar)}</div>
              <div>ETF+N：代表目前有 N 檔追蹤 ETF 持有這支股票。</div>
              <div>明細會列出近 5 日新進、加碼、減碼、剔除與持有狀態。</div>
            </div>
            <p className="wl-info-note">
              ETF 支撐是資金底盤參考，不等於單獨買賣建議，仍需搭配 AI 進場訊號、股票本質與風險控管。
            </p>
          </div>
        </div>
      )}

      {smallChipDialog && (
        <div className="wl-info-overlay" onClick={() => setSmallChipDialog(null)}>
          <div className="wl-info-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="wl-info-close" type="button" onClick={() => setSmallChipDialog(null)} aria-label="關閉">×</button>
            <div className="wl-info-title">{smallChipDialog.title}</div>
            <div className="wl-info-subtitle">{smallChipDialog.subtitle}</div>
            <p className="wl-info-text">{smallChipDialog.text}</p>
            <div className="wl-info-rule-list">
              {smallChipDialog.details.map((detail, index) => (
                <div key={`${detail}-${index}`}>{detail}</div>
              ))}
            </div>
            {smallChipDialog.note && (
              <p className="wl-info-note">{smallChipDialog.note}</p>
            )}
          </div>
        </div>
      )}

      {/* 建議移除摘要 */}
      {warningCount > 0 && (
        <div
          className={`wl-warn-banner${filterWarnOnly ? ' wl-warn-banner-active' : ''}`}
          onClick={() => {
            setFilterWarnOnly(f => !f);
            clearCompositeFilters();
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
      {hasAiFeature && hasAnyQuantData && watchlist.length > 0 && (
        <div className="wl-ai-filter-bar">
          <div className="wl-ai-filter-title">🤖 複合篩選</div>
          <div className="wl-combo-filter-section wl-combo-filter-section-primary wl-combo-filter-section-signal">
            <div className="wl-combo-filter-label wl-combo-filter-label-primary">模型進出場</div>
            <div className="wl-ai-filter-cards">
              <button
                className={`wl-ai-filter-card wl-ai-fcard-buy${filterAiSignal === 'buy' ? ' active' : ''}`}
                onClick={() => { setFilterAiSignal(filterAiSignal === 'buy' ? 'all' : 'buy'); setFilterWarnOnly(false); }}
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
                onClick={() => { setFilterAiSignal(filterAiSignal === 'neutral' ? 'all' : 'neutral'); setFilterWarnOnly(false); }}
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
                onClick={() => { setFilterAiSignal(filterAiSignal === 'sell' ? 'all' : 'sell'); setFilterWarnOnly(false); }}
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
              <button
                className={`wl-ai-filter-card wl-ai-fcard-reentry${filterAiSignal === 'reentry' ? ' active' : ''}`}
                onClick={() => { setFilterAiSignal(filterAiSignal === 'reentry' ? 'all' : 'reentry'); setFilterWarnOnly(false); }}
              >
                <div className="wl-ai-fcard-icon wl-ai-ficon-reentry">
                  <span aria-hidden="true">↗</span>
                </div>
                <div className="wl-ai-fcard-label">出場後再進場</div>
                <div className="wl-ai-fcard-count">{reentryAfterExitCount} 檔</div>
              </button>
            </div>
          </div>

          <div className="wl-combo-filter-section wl-combo-filter-section-remark">
            <div className="wl-combo-filter-label">AI推薦等級</div>
            <div className="wl-remark-filter-cards">
              {(['ultra', 'high', 'mid', 'low'] as WatchlistRemarkFilter[]).map(filter => (
                <button
                  key={filter}
                  className={`wl-ai-filter-card wl-remark-filter-card wl-remark-card-${filter}${filterAiRemark === filter ? ' active' : ''}`}
                  onClick={() => { setFilterAiRemark(filterAiRemark === filter ? 'all' : filter); setFilterWarnOnly(false); }}
                >
                  <div className={`wl-ai-fcard-icon wl-remark-ficon wl-remark-ficon-${filter}`}>
                    {getRemarkFilterIcon(filter)}
                  </div>
                  <div className="wl-ai-fcard-label">{getRemarkFilterLabel(filter)}</div>
                  <div className="wl-ai-fcard-count">{remarkFilterCounts[filter] || 0} 檔</div>
                </button>
              ))}
            </div>
          </div>

          <div className="wl-combo-filter-section wl-sort-filter-section">
            <div className="wl-combo-filter-label">排序方式</div>
            <div className="wl-combo-filter-pills">
              {(['simonsScore', 'createdAt', 'cumRet', 'chipPts', 'recommendationCount'] as WatchlistSortKey[]).map(key => (
                <button
                  key={key}
                  className={`wl-combo-pill wl-sort-pill${sortKey === key ? ' active' : ''}`}
                  onClick={() => setSortKey(key)}
                >
                  {getSortLabel(key)}
                </button>
              ))}
            </div>
            <div className="wl-sort-direction-row">
              <span className="wl-sort-direction-label">排序方向</span>
              <button
                className={`wl-combo-pill wl-sort-direction-pill${sortDirection === 'desc' ? ' active' : ''}`}
                onClick={() => setSortDirection('desc')}
                type="button"
              >
                遞減排序
                <span>{sortKey === 'createdAt' ? '新→舊' : '高→低'}</span>
              </button>
              <button
                className={`wl-combo-pill wl-sort-direction-pill${sortDirection === 'asc' ? ' active' : ''}`}
                onClick={() => setSortDirection('asc')}
                type="button"
              >
                遞增排序
                <span>{sortKey === 'createdAt' ? '舊→新' : '低→高'}</span>
              </button>
            </div>
          </div>

          {activeCompositeFilterCount > 0 && (
            <div className="wl-ai-filter-active-hint">
              篩選中：
              {filterAiSignal !== 'all' && <span>{getAiSignalFilterLabel(filterAiSignal)}</span>}
              {filterAiRemark !== 'all' && <span>{getRemarkFilterLabel(filterAiRemark)}</span>}
              {(sortKey !== DEFAULT_WATCHLIST_SORT_KEY || sortDirection !== 'desc') && <span>排序：{getSortLabel(sortKey)}・{getSortDirectionLabel(sortDirection)}</span>}
              {normalizedWatchlistSearch && <span>搜尋：{watchlistSearch.trim()}</span>}
              <strong>{sortedWatchlist.length} 檔符合</strong>
              <button className="wl-ai-filter-clear" onClick={() => { clearCompositeFilters(); setSortKey(DEFAULT_WATCHLIST_SORT_KEY); setSortDirection('desc'); setWatchlistSearch(''); }}>✕ 清除全部</button>
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

      {watchlist.length > 0 && sortedWatchlist.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🔎</div>
          <div className="empty-state-title">{normalizedWatchlistSearch ? '找不到觀察股票' : '沒有符合條件的股票'}</div>
          <div className="empty-state-desc">
            {normalizedWatchlistSearch
              ? `觀察名單內沒有符合「${watchlistSearch.trim()}」的股票。`
              : '可以放寬其中一個條件，或清除篩選後重新查看全部觀察名單。'}
          </div>
          <button
            className="btn btn-primary btn-lg"
            onClick={() => {
              setWatchlistSearch('');
              setFilterWarnOnly(false);
              clearCompositeFilters();
              setSortKey(DEFAULT_WATCHLIST_SORT_KEY);
              setSortDirection('desc');
            }}
          >
            {normalizedWatchlistSearch ? '清除搜尋與篩選' : '清除所有篩選'}
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
            const quantData = quantDataMap[w.stockCode];
            const cleanupAlert = getWatchlistCleanupAlert(w.stockCode);
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
                    <div className="wl-stock-name-row">
                      <IndustryIcon stockCode={w.stockCode} industry={simonsRec?.category || industryMap[w.stockCode]} compact />
                      <span className="wl-stock-name">{w.stockName}</span>
                      {renderRecommendationCountBadge(w.stockCode)}
                    </div>
                    <div className="wl-stock-code-row">
                      <MarketBadge market={marketMap[w.stockCode]?.market} compact />
                      <span className="wl-stock-code">{w.stockCode}</span>
                    </div>
                    <div className="wl-rec-meta">
                      <span className="wl-rec-category">{simonsRec?.category || industryMap[w.stockCode] || '—'}</span>
                      {simonsRec && <span className="wl-rec-stars">{getScoreStars(simonsRec.score)}</span>}
                    </div>
                    <div className="wl-primary-badges">
                      {getAiRecommendationBadge(w.stockCode)}
                      {getAiSignalBadge(w.stockCode)}
                    </div>
                    {simonsRec && (
                      <div className="wl-score-row">
                        <button
                          type="button"
                          className="wl-badge wl-badge-click wl-badge-premium"
                          onClick={(e) => {
                            e.stopPropagation();
                            setInfoDialog({ kind: 'score', stockName: w.stockName, stockCode: w.stockCode, rec: simonsRec, quantData });
                          }}
                        >
                          💎 股票本質 {simonsRec.score}分
                        </button>
                      </div>
                    )}
                    <div className="wl-small-tag-grid">
                      {renderActiveEtfRadarChip(w.stockCode, w.stockName)}
                      {renderAiQuantChips(w.stockCode, w.stockName)}
                    </div>
                  </div>
                  <div className="wl-price-info">
                    {priceUpdatedLabel && (
                      <div className="wl-price-updated">{priceUpdatedLabel}</div>
                    )}
                    <div className={`wl-price ${todayIsUp ? 'text-profit' : 'text-loss'}`}>
                      NT$ {formatPrice(currentPrice)}
                    </div>
                    {todayChange !== 0 && (
                      <div className={`wl-change ${todayIsUp ? 'text-profit' : 'text-loss'}`}>
                        {todayIsUp ? '▲' : '▼'} {formatPrice(Math.abs(todayChange))}
                      </div>
                    )}
                    {renderHalfYearKlineChart(w.stockCode, currentPrice)}
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

                {cleanupAlert && (
                  <div className={`wl-ai-exit-remove-box wl-ai-exit-remove-box-${cleanupAlert.type}`}>
                    <div>
                      <div className="wl-ai-exit-remove-title">{cleanupAlert.title}</div>
                      <div className="wl-ai-exit-remove-desc">{cleanupAlert.desc}</div>
                    </div>
                    <button
                      type="button"
                      className="wl-ai-exit-remove-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(w.stockCode);
                      }}
                    >
                      一鍵移除觀察
                    </button>
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
          {hasAiFeature && (
            <>
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
            </>
          )}
          <div className="wl-legend-section" style={{ marginTop: hasAiFeature ? 12 : 0 }}>技術面進場訊號</div>
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
