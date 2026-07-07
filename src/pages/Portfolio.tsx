import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney, formatPrice } from '../store';
import type { Holding, StockTradingSignal, Trade } from '../types';
import { fetchOfficialPriceMap, fetchStockData, fetchStockQuantData, fetchStockTradingSignals, fetchSimonsRecommendationCounts, clearOfficialPriceMapCache, refreshDailyAiCache, clearQuantSignalTTLCache, fetchDailyAiCacheVersion, getKnownDailyAiCacheVersion, rememberDailyAiCacheVersion, ensureDailyAiCacheVersion, fetchActiveEtfRadarMap, fetchUserMarketDailyCache } from '../api';
import type { ActiveEtfRadarItem, OfficialPriceMapEntry, StockQuantData, StockQuantMeta } from '../api';
import { getCache, setCache, clearCache, getVersionedCache, getVersionedPersistentCache, setPersistentCache, clearPersistentCache, invalidateDailyMarketDataCaches, CACHE_KEYS } from '../cache';
import MarketBadge from '../components/MarketBadge';
import IndustryIcon from '../components/IndustryIcon';
import StockTradeModal from '../components/StockTradeModal';
import { canAutoRefreshPrices, formatPriceUpdateLabel, PRICE_AUTO_REFRESH_MS } from '../utils/priceAutoRefresh';
import { calculateAddPriority } from '../utils/addPriority';
import { calculateTrendStatus, type TrendStatusResult } from '../utils/trendStatus';
import './Portfolio.css';

type PortfolioAiSignal = {
  primaryLabel: string;
  primaryType: 'buy' | 'sell' | 'neutral';
  primaryIcon: string;
  streakCount?: number;
  aiRemark?: string;
  cumRet?: string;
  chipPts?: number;
  trendStatus?: TrendStatusResult;
};
type ActiveEtfInfoDialog = {
  stockCode: string;
  stockName: string;
  radar: ActiveEtfRadarItem;
};

type SignalCacheData = {
  _schema?: string;
  _date: string;
  _holdingKeys: string;
  _refreshSlot?: string;
  _createdAt?: number;
  _quantMeta?: StockQuantMeta;
  _dataVersion?: string;
  _incompleteCodes?: string[];
  [stockCode: string]: PortfolioAiSignal | StockQuantMeta | string | number | string[] | undefined;
};

const HOLDING_ALLOCATION_COLORS = [
  '#ff5a66',
  '#2e9cca',
  '#31b27c',
  '#ffb020',
  '#8b5cf6',
  '#14b8a6',
  '#f97316',
  '#64748b',
];

function formatHoldingCategoryName(industry?: string): string {
  const name = industry?.trim();
  if (!name) return '未分類類別';
  if (name.endsWith('類別')) return name;
  if (name.endsWith('業')) return `${name.slice(0, -1)}類別`;
  return `${name}類別`;
}

function formatCompactCategoryName(categoryName: string): string {
  const base = categoryName
    .replace(/類別$/u, '')
    .split(/[、,，/／｜|]/u)
    .map(part => part.trim())
    .find(Boolean) || categoryName.replace(/類別$/u, '').trim();
  const compact = base.replace(/\s+/g, '');
  if (!compact) return '未分類';
  if (compact.length >= 4) return compact.slice(0, 4);
  if (compact.length >= 3) return `${compact}類`;
  return `${compact}類別`.slice(0, 4);
}

function getChipLabel(pts: number | undefined): string {
  if (pts === undefined || !Number.isFinite(pts)) return '--';
  if (pts >= 9) return '最乾淨';
  if (pts >= 7) return '非常穩定';
  if (pts >= 5) return '穩定';
  if (pts >= 3) return '普通';
  return '凌亂';
}

function getChipClass(pts: number | undefined): string {
  if (pts === undefined || !Number.isFinite(pts)) return '';
  if (pts >= 7) return 'holding-quant-chip-pts-high';
  if (pts >= 4) return 'holding-quant-chip-pts-mid';
  return 'holding-quant-chip-pts-low';
}

function getCumRetClass(cumRet?: string): string {
  const value = parseFloat(cumRet || '');
  if (!Number.isFinite(value)) return '';
  return value >= 0 ? 'holding-quant-chip-ret-pos' : 'holding-quant-chip-ret-neg';
}

function getAiRemarkClass(remark?: string): string {
  if (!remark) return '';
  if (remark.includes('超高度')) return 'holding-quant-chip-ai-ultra';
  if (remark.includes('高度')) return 'holding-quant-chip-ai-high';
  if (remark.includes('中度')) return 'holding-quant-chip-ai-mid';
  if (remark.includes('低度')) return 'holding-quant-chip-ai-low';
  return '';
}

function formatCumRet(cumRet?: string): string {
  if (!cumRet) return '--';
  return cumRet.startsWith('-') ? cumRet : `+${cumRet}`;
}

function parseReturnPct(value?: string): number | null {
  const n = parseFloat(String(value || '').replace(/[%％,+]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function calculateSignalCumRet(signals?: StockTradingSignal[]): string | undefined {
  if (!signals || signals.length === 0) return undefined;
  const returns = signals
    .map(signal => parseReturnPct(signal.returnPct))
    .filter((value): value is number => value !== null);
  if (returns.length === 0) return undefined;
  const compounded = returns.reduce((equity, value) => equity * (1 + value / 100), 1);
  return `${((compounded - 1) * 100).toFixed(1)}%`;
}

type FinMindPriceRow = {
  close: number;
};

const PORTFOLIO_SIGNAL_TTL_MS = 18 * 60 * 60 * 1000;
const PORTFOLIO_SIGNAL_CACHE_SCHEMA = 'portfolio-signal-rich-v3';
const PORTFOLIO_PERSISTENT_CACHE_KEY = 'ppbears_portfolio_signals_v9';
const DAILY_AI_CACHE_POLL_MS = 90 * 1000;
const DATA_REFRESH_SCHEDULE = [
  { label: '08:00', minutes: 8 * 60 },
];

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('portfolio signal timeout')), ms);
    }),
  ]);
}

function toTaiwanDateString(timestamp: number): string {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getTodayString(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function getRefreshSlotInfo() {
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  let currentIndex = DATA_REFRESH_SCHEDULE.findIndex(slot => minutesNow < slot.minutes) - 1;
  const slotDate = new Date(now);
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

function formatSignalTimestamp(timestamp = Date.now()): string {
  const now = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function formatMetaDateTime(value?: string): string {
  if (!value) return '尚未同步';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTodayDate(): string {
  return getTodayString().replace(/-/g, '/');
}

function formatHoldingShares(shares: number): string {
  if (!Number.isFinite(shares)) return '-- 股';
  if (Math.abs(shares) >= 1000) {
    const lots = shares / 1000;
    const formattedLots = lots.toLocaleString('zh-TW', {
      minimumFractionDigits: 0,
      maximumFractionDigits: lots >= 100 ? 0 : 2,
    });
    return `${formattedLots} 張`;
  }
  return `${shares.toLocaleString('zh-TW')} 股`;
}

function getFixedUpdateLabel(): string {
  return '08:00 自動檢查；可手動重新抓取';
}

function getLatestQuantMeta(metas: StockQuantMeta[]): StockQuantMeta | null {
  if (metas.length === 0) return null;
  return metas.sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime())[0];
}

function getDataFreshness(meta: StockQuantMeta | null, loading: boolean, hasData: boolean, priceRefreshError: string | null) {
  if (loading) {
    return { className: 'pf-data-freshness-updating', label: '正在讀取每日快取與更新價格' };
  }
  if (priceRefreshError) {
    return { className: 'pf-data-freshness-stale', label: priceRefreshError };
  }
  if (!hasData) {
    return { className: 'pf-data-freshness-waiting', label: '等待 Simons 最新交易日資料' };
  }

  if (meta?.cacheStatus === 'fresh') {
    return { className: 'pf-data-freshness-fresh', label: '已重新讀取每日快取' };
  }

  return { className: 'pf-data-freshness-fresh', label: '已使用每日 AI 訊號快取' };
}

function isPortfolioSignal(value: unknown): value is PortfolioAiSignal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const signal = value as Partial<PortfolioAiSignal>;
  return typeof signal.primaryLabel === 'string'
    && (signal.primaryType === 'buy' || signal.primaryType === 'sell' || signal.primaryType === 'neutral')
    && typeof signal.primaryIcon === 'string';
}

function hasRichAiSignal(signal: PortfolioAiSignal | undefined): boolean {
  if (!signal) return false;
  if (!signal.trendStatus) return false;
  if (signal.aiRemark || signal.cumRet) return true;
  return signal.chipPts !== undefined && Number.isFinite(signal.chipPts);
}

function isFreshTodaySignalCache(
  cached: SignalCacheData | null,
  holdingKeys: string,
  stockCodes: string[],
  requireRichAiSignals: boolean
): cached is SignalCacheData {
  if (!cached || cached._holdingKeys !== holdingKeys) return false;
  if (cached._schema !== PORTFOLIO_SIGNAL_CACHE_SCHEMA) return false;
  if (cached._incompleteCodes?.length) return false;
  const cacheDate = cached._date?.slice(0, 10);
  if (cacheDate !== getTodayString()) return false;
  if (!requireRichAiSignals) return true;
  return stockCodes.every(code => hasRichAiSignal(isPortfolioSignal(cached[code]) ? cached[code] : undefined));
}

function canUseCloudPortfolioCache(
  cloudStatus: string | undefined,
  cache: SignalCacheData,
  holdingKeys: string,
  stockCodes: string[],
  requireRichAiSignals: boolean
): boolean {
  if (cloudStatus === 'waiting-simons' || cloudStatus === 'empty') return false;
  return isFreshTodaySignalCache(cache, holdingKeys, stockCodes, requireRichAiSignals);
}

function getCurrentHoldingStartDate(stockCode: string, trades: Trade[]): string | undefined {
  let shares = 0;
  let startTimestamp: number | null = null;
  const stockTrades = trades
    .filter(t => t.stockCode === stockCode && (t.tradeType === 'buy' || t.tradeType === 'sell'))
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const trade of stockTrades) {
    if (trade.tradeType === 'buy') {
      if (shares <= 0) startTimestamp = trade.timestamp;
      shares += trade.quantity;
    } else {
      shares -= trade.quantity;
      if (shares <= 0) {
        shares = 0;
        startTimestamp = null;
      }
    }
  }

  return startTimestamp ? toTaiwanDateString(startTimestamp) : undefined;
}

export default function Portfolio() {
  const navigate = useNavigate();
  const { holdings, trades, dataReady, getPortfolioSummary, hasFeature, refreshHoldingPrices } = useStore();
  const hasAiFeature = hasFeature('ai_portfolio_advice');
  const summary = getPortfolioSummary();

  const pl = summary.totalProfitLoss;
  const isProfit = pl >= 0;
  const holdingAllocation = useMemo(() => {
    const categoryMap = holdings.reduce<Record<string, { categoryName: string; marketValue: number; stockCount: number }>>((acc, h) => {
      const marketValue = Math.max(0, h.currentPrice * h.totalShares);
      if (marketValue <= 0) return acc;

      const categoryName = formatHoldingCategoryName(h.industry);
      if (!acc[categoryName]) {
        acc[categoryName] = { categoryName, marketValue: 0, stockCount: 0 };
      }
      acc[categoryName].marketValue += marketValue;
      acc[categoryName].stockCount += 1;
      return acc;
    }, {});

    const rawItems = Object.values(categoryMap)
      .sort((a, b) => b.marketValue - a.marketValue);

    const totalMarketValue = rawItems.reduce((sum, item) => sum + item.marketValue, 0);
    if (totalMarketValue <= 0) {
      return { totalMarketValue: 0, itemCount: 0, categories: [], items: [], gradient: '' };
    }

    const categories = rawItems.map((item, index) => ({
      ...item,
      color: HOLDING_ALLOCATION_COLORS[index % HOLDING_ALLOCATION_COLORS.length],
      percent: (item.marketValue / totalMarketValue) * 100,
    }));

    const primaryItems = rawItems.slice(0, 5);
    const otherItems = rawItems.slice(5);
    const displayItems = primaryItems.map((item, index) => ({
      ...item,
      color: HOLDING_ALLOCATION_COLORS[index % HOLDING_ALLOCATION_COLORS.length],
    }));

    if (otherItems.length > 0) {
      displayItems.push({
        categoryName: `其他 ${otherItems.length} 類別`,
        marketValue: otherItems.reduce((sum, item) => sum + item.marketValue, 0),
        stockCount: otherItems.reduce((sum, item) => sum + item.stockCount, 0),
        color: HOLDING_ALLOCATION_COLORS[HOLDING_ALLOCATION_COLORS.length - 1],
      });
    }

    const items = displayItems.map(item => ({
      ...item,
      percent: (item.marketValue / totalMarketValue) * 100,
    }));

    let cursor = 0;
    const segments = items.map((item, index) => {
      const start = cursor;
      const end = index === items.length - 1 ? 100 : cursor + item.percent;
      cursor = end;
      return `${item.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    });

    return {
      totalMarketValue,
      itemCount: rawItems.length,
      categories,
      items,
      gradient: `conic-gradient(${segments.join(', ')})`,
    };
  }, [holdings]);

  const [aiSignals, setAiSignals] = useState<Record<string, PortfolioAiSignal>>({});
  const [signalDataDate, setSignalDataDate] = useState<string>('');;
  const [priceRefreshing, setPriceRefreshing] = useState(false);
  const [priceRefreshError, setPriceRefreshError] = useState<string | null>(null);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('正在載入資料...');
  const [loadingProgress, setLoadingProgress] = useState(0); // 0-100
  const [refreshKey, setRefreshKey] = useState(0); // 遞增來強制重新抓取
  const [, setUsingSignalCache] = useState(false);
  const [marketMap, setMarketMap] = useState<Record<string, OfficialPriceMapEntry>>({});
  const [recommendationCounts, setRecommendationCounts] = useState<Record<string, number>>({});
  const [activeEtfMap, setActiveEtfMap] = useState<Record<string, ActiveEtfRadarItem>>({});
  const [activeEtfDialog, setActiveEtfDialog] = useState<ActiveEtfInfoDialog | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<{ mode: 'buy' | 'sell'; holding: Holding } | null>(null);
  const [quantMeta, setQuantMeta] = useState<StockQuantMeta | null>(null);
  const [priceUpdatedLabel, setPriceUpdatedLabel] = useState('');
  const [dailyDataVersion, setDailyDataVersion] = useState(() => getKnownDailyAiCacheVersion('portfolio') || '');
  const [enableCustomSignal, setEnableCustomSignal] = useState(() => {
    return localStorage.getItem('ppbears_custom_signal') === 'true';
  });
  const [selectedHoldingCategory, setSelectedHoldingCategory] = useState('ALL');
  const categoryTabsRef = useRef<HTMLDivElement | null>(null);
  const categoryDragRef = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false });
  const categoryClickBlockedRef = useRef(false);
  const [isDraggingCategoryTabs, setIsDraggingCategoryTabs] = useState(false);
  const filteredHoldings = holdings;
  const isRefreshing = priceRefreshing || signalsLoading;

  const selectHoldingCategory = useCallback((categoryName: string) => {
    if (categoryClickBlockedRef.current) {
      categoryClickBlockedRef.current = false;
      return;
    }
    setSelectedHoldingCategory(categoryName);
  }, []);

  const handleCategoryTabsWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const el = categoryTabsRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    el.scrollLeft += event.deltaY;
  }, []);

  const handleCategoryTabsPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const el = categoryTabsRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    categoryDragRef.current = {
      active: true,
      startX: event.clientX,
      scrollLeft: el.scrollLeft,
      moved: false,
    };
    categoryClickBlockedRef.current = false;
    setIsDraggingCategoryTabs(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handleCategoryTabsPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = categoryDragRef.current;
    const el = categoryTabsRef.current;
    if (!drag.active || !el) return;
    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaX) > 4) {
      drag.moved = true;
      categoryClickBlockedRef.current = true;
    }
    el.scrollLeft = drag.scrollLeft - deltaX;
    event.preventDefault();
  }, []);

  const endCategoryTabsDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const moved = categoryDragRef.current.moved;
    categoryDragRef.current.active = false;
    setIsDraggingCategoryTabs(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (moved) {
      window.setTimeout(() => {
        categoryClickBlockedRef.current = false;
      }, 160);
    }
  }, []);

  useEffect(() => {
    if (
      selectedHoldingCategory !== 'ALL' &&
      !holdingAllocation.categories.some(item => item.categoryName === selectedHoldingCategory)
    ) {
      setSelectedHoldingCategory('ALL');
    }
  }, [holdingAllocation.categories, selectedHoldingCategory]);

  const runPriceRefresh = useCallback(async (force: boolean, message: string) => {
    if (holdings.length === 0) return;

    if (force) clearOfficialPriceMapCache();
    setPriceRefreshError(null);
    setPriceRefreshing(true);
    setLoadingMsg(message);
    setLoadingProgress(8);

    let mountedProgress = true;
    const progressTimer = window.setInterval(() => {
      if (!mountedProgress) return;
      setLoadingProgress(prev => Math.min(prev + 7, 48));
    }, 280);

    try {
      const result = await refreshHoldingPrices({ force });
      if (result.checkedCount > 0 && result.priceFoundCount === 0) {
        setPriceRefreshError('價格抓取失敗，畫面仍是上次庫存價格');
      }
      if (result.priceFoundCount > 0 && canAutoRefreshPrices()) {
        setPriceUpdatedLabel(formatPriceUpdateLabel());
      }
      setLoadingProgress(prev => Math.max(prev, 62));
      return result;
    } catch {
      setPriceRefreshError('價格抓取失敗，畫面仍是上次庫存價格');
      return { checkedCount: holdings.length, priceFoundCount: 0, updatedCount: 0 };
    } finally {
      mountedProgress = false;
      window.clearInterval(progressTimer);
      setLoadingProgress(100);
      await new Promise(resolve => window.setTimeout(resolve, 250));
      setPriceRefreshing(false);
    }
  }, [holdings.length, refreshHoldingPrices]);

  // 進入庫存頁時只在開盤期間自動確認價格；收盤與休市時保留上次價格。
  useEffect(() => {
    if (canAutoRefreshPrices()) {
      runPriceRefresh(true, '正在更新持股價格...');
    }
  }, [runPriceRefresh]);

  useEffect(() => {
    if (holdings.length === 0) return;

    function refreshPricesIfVisible() {
      if (canAutoRefreshPrices()) {
        runPriceRefresh(true, '正在同步盤中持股價格...');
      }
    }

    const intervalId = window.setInterval(refreshPricesIfVisible, PRICE_AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshPricesIfVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshPricesIfVisible);
    };
  }, [holdings.length, runPriceRefresh]);

  const toggleCustomSignal = (val: boolean) => {
    setEnableCustomSignal(val);
    localStorage.setItem('ppbears_custom_signal', String(val));
  };
  useEffect(() => {
    if (dailyDataVersion) return;
    let cancelled = false;
    ensureDailyAiCacheVersion('portfolio').then(version => {
      if (!cancelled && version) setDailyDataVersion(version);
    });
    return () => { cancelled = true; };
  }, [dailyDataVersion]);

  const holdingStartDates = useMemo(() => {
    const dates: Record<string, string | undefined> = {};
    holdings.forEach(h => {
      dates[h.stockCode] = getCurrentHoldingStartDate(h.stockCode, trades);
    });
    return dates;
  }, [holdings, trades]);

  useEffect(() => {
    const codes = holdings
      .filter(h => h.totalShares > 0)
      .map(h => h.stockCode);
    if (codes.length === 0) {
      setRecommendationCounts({});
      setActiveEtfMap({});
      return;
    }

    let mounted = true;
    fetchSimonsRecommendationCounts(codes, 90).then(counts => {
      if (mounted) setRecommendationCounts(counts);
    });
    fetchActiveEtfRadarMap(codes, 5).then(items => {
      if (mounted) setActiveEtfMap(items);
    });

    return () => { mounted = false; };
  }, [holdings, refreshKey]);

  useEffect(() => {
    if (holdings.length === 0) return;
    let cancelled = false;
    async function checkSharedAiCacheVersion() {
      if (isRefreshing) return;
      const latest = await fetchDailyAiCacheVersion();
      if (cancelled || !latest?.version) return;
      const known = getKnownDailyAiCacheVersion('portfolio');
      if (!known) {
        rememberDailyAiCacheVersion(latest.version, 'portfolio');
        setDailyDataVersion(latest.version);
        return;
      }
      if (latest.version !== known) {
        rememberDailyAiCacheVersion(latest.version, 'portfolio');
        setDailyDataVersion(latest.version);
        invalidateDailyMarketDataCaches();
        setAiSignals({});
        setSignalDataDate('');
        setQuantMeta(null);
        setLoadingProgress(0);
        setLoadingMsg('偵測到全站資料已更新，正在重新分析...');
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
  }, [holdings.length, isRefreshing]);

  function renderRecommendationCountBadge(stockCode: string) {
    const count = recommendationCounts[stockCode] || 0;
    if (count <= 1) return null;
    return (
      <span className="holding-rec-count-badge" title="最近90天內重複出現在找股票推薦">
        推薦X{count}
      </span>
    );
  }

  function renderMemberQuantChips(signal?: PortfolioAiSignal) {
    if (!signal) return null;
    const hasAiRemark = Boolean(signal.aiRemark);
    const hasCumRet = Boolean(signal.cumRet);
    const hasChipPts = signal.chipPts !== undefined && Number.isFinite(signal.chipPts);
    if (!hasAiRemark && !hasCumRet && !hasChipPts) return null;

    return (
      <>
        {hasAiRemark && (
          <span
            className={`holding-quant-chip holding-quant-chip-ai ${getAiRemarkClass(signal.aiRemark)}`}
            title="目前 Simons 量化模型的 AI 推薦等級，用來輔助判斷是否值得研究加碼"
          >
            🤖 AI推薦 {signal.aiRemark}
          </span>
        )}
        {hasCumRet && (
          <span className={`holding-quant-chip holding-quant-chip-ret ${getCumRetClass(signal.cumRet)}`}>
            📊 累積報酬 {formatCumRet(signal.cumRet)}
          </span>
        )}
        {hasChipPts && (
          <span className={`holding-quant-chip holding-quant-chip-pts ${getChipClass(signal.chipPts)}`}>
            🔒 籌碼 {signal.chipPts!.toFixed(0)}分 {getChipLabel(signal.chipPts)}
          </span>
        )}
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

  function getActiveEtfDetailText(radar: ActiveEtfRadarItem): string {
    const detail = radar.etfs
      .map(item => `${item.etfName || item.etfCode} ${getActiveEtfActionLabel(item.action)}`)
      .join('、');
    return `近${radar.days}日：新進${radar.addedEtfCount}、加碼${radar.increasedEtfCount}、減碼${radar.decreasedEtfCount}、剔除${radar.removedEtfCount}。${detail || '尚無 ETF 明細'}。資料日：${radar.latestDate || '待同步'}。`;
  }

  function renderActiveEtfRadarChip(stockCode: string, stockName: string) {
    const radar = activeEtfMap[stockCode];
    if (!radar) return null;
    if (radar.holdingEtfCount <= 0) return null;
    const label = `ETF+${radar.holdingEtfCount}`;
    return (
      <button
        type="button"
        className={`holding-quant-chip holding-active-etf-chip holding-active-etf-chip-${radar.signal}`}
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

  function renderAddPriorityChip(stockCode: string, signal?: PortfolioAiSignal) {
    const cumRetPct = parseReturnPct(signal?.cumRet);
    const priority = calculateAddPriority({
      aiSignal: signal?.primaryType ?? null,
      activeEtfScore: activeEtfMap[stockCode]?.score ?? null,
      activeEtfSignal: activeEtfMap[stockCode]?.signal ?? null,
      recommendationCount: recommendationCounts[stockCode] || 0,
      chipPts: signal?.chipPts ?? null,
      cumRetPct,
    });
    return (
      <span
        className={`holding-quant-chip holding-add-priority-chip holding-add-priority-chip-${priority.level}`}
        title={`加碼時機：${priority.label}｜${priority.reason}`}
      >
        加碼時機 {priority.score}分
      </span>
    );
  }

  function renderTrendStatusChip(signal?: PortfolioAiSignal) {
    if (!signal?.trendStatus) return null;
    return (
      <span
        className={`holding-quant-chip holding-trend-status-chip holding-trend-status-${signal.trendStatus.level}`}
        title={`趨勢狀態：${signal.trendStatus.label}｜${signal.trendStatus.reason}`}
      >
        {signal.trendStatus.label}
      </span>
    );
  }

  function renderProfitLossLevelBadge(profitLossPct: number, signal?: PortfolioAiSignal) {
    if (!Number.isFinite(profitLossPct)) return null;
    if (profitLossPct <= -20) {
      return (
        <span
          className="holding-pl-level-badge holding-pl-level-stop"
          title={`目前庫存損益 ${profitLossPct.toFixed(1)}%，已達 -20% 停損警示`}
        >
          ⚠ 建議停損
        </span>
      );
    }
    if (!signal || signal.primaryType === 'neutral') return null;

    if (signal.primaryType === 'buy') {
      if (profitLossPct >= 20) {
        return <span className="holding-pl-level-badge holding-pl-level-profit-strong">◇ 順勢加碼</span>;
      }
      if (profitLossPct >= 0) {
        return <span className="holding-pl-level-badge holding-pl-level-profit">△ 小心加碼</span>;
      }
      if (profitLossPct > -10) {
        return <span className="holding-pl-level-badge holding-pl-level-buy-dip">○ 低檔觀察</span>;
      }
      if (profitLossPct > -20) {
        return <span className="holding-pl-level-badge holding-pl-level-buy-cautious">○ 謹慎觀察</span>;
      }
      return <span className="holding-pl-level-badge holding-pl-level-risk-first">☠ 風險優先</span>;
    }

    if (signal.primaryType === 'sell') {
      if (profitLossPct >= 20) {
        return <span className="holding-pl-level-badge holding-pl-level-take-profit">◇ 分批停利</span>;
      }
      return <span className="holding-pl-level-badge holding-pl-level-loss">○ 持續觀察</span>;
    }

    return null;
  }

  useEffect(() => {
    let mounted = true;
    async function loadSignals() {
      if (holdings.length === 0) return;
      if (!hasAiFeature && !enableCustomSignal) {
        if (mounted && Object.keys(aiSignals).length > 0) setAiSignals({});
        return;
      }
      if (mounted) setLoadingProgress(0);

      // 只有今天且仍在 TTL 內的快取才直接使用；否則進頁自動重新分析。
      const holdingKeys = holdings
        .map(h => `${h.stockCode}:${h.totalShares}:${h.avgCost}:${h.currentPrice}:${holdingStartDates[h.stockCode] ?? ''}`)
        .sort()
        .join(',');
      const holdingStockCodes = holdings.map(h => h.stockCode).sort();
      const cacheKey = CACHE_KEYS.PORTFOLIO_SIGNALS;
      const refreshSlot = getRefreshSlotInfo();
      const dataVersion = dailyDataVersion || getKnownDailyAiCacheVersion('portfolio');
      const cached = refreshKey === 0
        ? getVersionedCache<SignalCacheData>(cacheKey, dataVersion) || getVersionedPersistentCache<SignalCacheData>(PORTFOLIO_PERSISTENT_CACHE_KEY, refreshSlot.key, dataVersion)
        : null;
      const canUseCachedSignals = refreshKey === 0 && isFreshTodaySignalCache(cached, holdingKeys, holdingStockCodes, hasAiFeature) && cached._refreshSlot === refreshSlot.key;
      if (canUseCachedSignals) {
        if (mounted) {
          const cachedSignals: Record<string, PortfolioAiSignal> = {};
          Object.entries(cached).forEach(([key, value]) => {
            if (key.startsWith('_')) return;
            cachedSignals[key] = value as PortfolioAiSignal;
          });
          setAiSignals(cachedSignals as Record<string, PortfolioAiSignal>);
          setSignalDataDate(cached._date);
          setQuantMeta(cached._quantMeta || null);
          setUsingSignalCache(true);
          setCache(cacheKey, cached, refreshSlot.ttlMs);
        }
        return;
      }

      if (refreshKey === 0 && hasAiFeature) {
        const holdingCodeSignature = holdingStockCodes.join(',');
        const cloud = await fetchUserMarketDailyCache<SignalCacheData>('portfolio');
        if (mounted && cloud?.payload && cloud.signature === holdingCodeSignature) {
          const cloudCache: SignalCacheData = {
            ...cloud.payload,
            _holdingKeys: holdingKeys,
            _refreshSlot: refreshSlot.key,
            _dataVersion: dataVersion || cloud.payload._dataVersion,
          };
          if (canUseCloudPortfolioCache(cloud.status, cloudCache, holdingKeys, holdingStockCodes, hasAiFeature)) {
            const cloudSignals: Record<string, PortfolioAiSignal> = {};
            Object.entries(cloudCache).forEach(([key, value]) => {
              if (key.startsWith('_')) return;
              cloudSignals[key] = value as PortfolioAiSignal;
            });
            setAiSignals(cloudSignals);
            setSignalDataDate(cloudCache._date);
            setQuantMeta(cloudCache._quantMeta || null);
            setUsingSignalCache(true);
            setSignalsLoading(false);
            setLoadingProgress(0);
            setCache(cacheKey, cloudCache, Math.min(PORTFOLIO_SIGNAL_TTL_MS, refreshSlot.ttlMs));
            setPersistentCache(PORTFOLIO_PERSISTENT_CACHE_KEY, cloudCache, Math.min(PORTFOLIO_SIGNAL_TTL_MS, refreshSlot.ttlMs), refreshSlot.key);
            return;
          }
        }
      }

      if (mounted) {
        setUsingSignalCache(false);
        setSignalsLoading(true);
        setLoadingProgress(5);
        setLoadingMsg('正在連線 AI 量化分析...');
      }
      
      const signals: Record<string, PortfolioAiSignal> = {};
      const incompleteCodes: string[] = [];
      const forceFresh = refreshKey > 0;
      const quantMetas: StockQuantMeta[] = [];

      if (hasAiFeature) {
        // 記錄 Simons 量化模型爬取時間
        if (mounted) {
          setSignalDataDate(formatSignalTimestamp());
        }
        try {
          // 並行取得 AI 量化訊號
          if (mounted) { setLoadingMsg(`正在分析 ${holdings.length} 支持股 AI 訊號...`); setLoadingProgress(20); }

          let doneCount = 0;
          await Promise.all(holdings.map(async (h) => {
            const tradingSignalsPromise = withTimeout(fetchStockTradingSignals(h.stockCode), 8000).catch(() => null);
            const stockDataPromise = withTimeout(fetchStockData(h.stockCode), 9000).catch(() => null);
            const quantData = await withTimeout(
              fetchStockQuantData(h.stockCode, holdingStartDates[h.stockCode], { forceFresh }),
              12000
            ).catch(() => null);
            if (quantData?.meta) quantMetas.push(quantData.meta);
            let displayQuantData: StockQuantData | null = quantData;
            if (!displayQuantData?.aiQuanBackDataComment?.cum_ret) {
              const liveQuantData = await withTimeout(
                fetchStockQuantData(h.stockCode, undefined, { forceFresh: true }),
                10000
              ).catch(() => null);
              if (liveQuantData?.meta) quantMetas.push(liveQuantData.meta);
              if (liveQuantData?.aiQuanBackDataComment?.cum_ret || !displayQuantData) {
                displayQuantData = liveQuantData;
              }
            }
            const tradingSignals = (await tradingSignalsPromise)?.signals || [];
            const fallbackCumRet = displayQuantData?.aiQuanBackDataComment?.cum_ret
              ? undefined
              : calculateSignalCumRet(tradingSignals);

            // ── 主訊號：使用 fetchStockQuantData 裡已解析的 currentSignal ──
            let primaryLabel: string;
            let primaryType: 'buy' | 'sell' | 'neutral';
            let primaryIcon: string;

            const signalSource = quantData || displayQuantData;
            const sig = signalSource?.currentSignal ?? 'neutral';
            if (sig === 'buy') {
              primaryLabel = 'AI 加碼'; primaryType = 'buy'; primaryIcon = '🚀';
            } else if (sig === 'sell') {
              primaryLabel = 'AI 出場'; primaryType = 'sell'; primaryIcon = '⚠️';
            } else {
              primaryLabel = 'AI 中立'; primaryType = 'neutral'; primaryIcon = '⚖️';
            }

            const streak = signalSource?.signalStreak;
            const streakCount = sig !== 'neutral' && streak?.signal === sig ? streak.count : 0;
            const chipPtsRaw = signalSource?.chipStability?.pts;
            const chipPts = chipPtsRaw !== undefined && chipPtsRaw !== null ? parseFloat(String(chipPtsRaw)) : undefined;
            const stockData = await stockDataPromise;
            const trendStatus = calculateTrendStatus({
              aiSignal: primaryType,
              prices: stockData?.prices,
              tradingSignals,
              profitLossPct: h.avgCost > 0 ? ((h.currentPrice - h.avgCost) / h.avgCost) * 100 : null,
              chipPts: Number.isFinite(chipPts) ? chipPts : null,
            });
            signals[h.stockCode] = {
              primaryLabel,
              primaryType,
              primaryIcon,
              streakCount,
              aiRemark: displayQuantData?.aiQuanBackDataComment?.remark,
              cumRet: displayQuantData?.aiQuanBackDataComment?.cum_ret || fallbackCumRet,
              chipPts: Number.isFinite(chipPts) ? chipPts : undefined,
              trendStatus,
            };
            if (!hasRichAiSignal(signals[h.stockCode])) incompleteCodes.push(h.stockCode);
            doneCount++;
            if (mounted) {
              const pct = 20 + Math.round((doneCount / holdings.length) * 70);
              setLoadingProgress(pct);
              setLoadingMsg(`正在分析 ${h.stockName}（${doneCount}/${holdings.length}）...`);
            }
          }));

        } catch (err) {
          console.error('Failed to load AI signals', err);
        }
      } else if (enableCustomSignal) {
        await Promise.all(holdings.map(async (h) => {
          try {
             const start = new Date();
             start.setDate(start.getDate() - 150);
             const _pad2 = (n: number) => String(n).padStart(2, '0');
             const dateStr = `${start.getFullYear()}-${_pad2(start.getMonth() + 1)}-${_pad2(start.getDate())}`;
             const res = await withTimeout(
               fetch(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${h.stockCode}&start_date=${dateStr}`),
               12000
             );
             const json = await res.json();
             const data = json.data as FinMindPriceRow[] | undefined;
             if (data && data.length >= 60) {
               const closes = data.map((d) => Number(d.close)).filter(close => Number.isFinite(close));
               if (closes.length < 60) return;
               const getSMA = (arr: number[], period: number, offset: number = 0) => {
                 const slice = arr.slice(arr.length - period - offset, arr.length - offset);
                 return slice.reduce((a, b) => a + b, 0) / period;
               };
               const lastClose = closes[closes.length - 1];
               const sma60 = getSMA(closes, 60, 0);
               const sma60Prev = getSMA(closes, 60, 1);
               const prevClose = closes[closes.length - 2];
               const max20 = Math.max(...closes.slice(-20));
               if (lastClose > sma60 && lastClose >= max20) {
                 signals[h.stockCode] = { primaryLabel: '技術加碼', primaryType: 'buy', primaryIcon: '🚀' };
               } else if (lastClose < sma60 && prevClose < sma60Prev) {
                 signals[h.stockCode] = { primaryLabel: '技術出場', primaryType: 'sell', primaryIcon: '🚪' };
               } else {
                 signals[h.stockCode] = { primaryLabel: '技術中立', primaryType: 'neutral', primaryIcon: '⚖️' };
               }
             }
          } catch (e) {
             console.error('Fetch technical fail:', e);
          }
        }));
      }

      if (mounted) {
        setLoadingProgress(100);
        setLoadingMsg('分析完成！');
        // 短暫顯示 100% 再關閉
        await new Promise(r => setTimeout(r, 400));
        setAiSignals(signals);
        setSignalsLoading(false);
        // 寫入短效快取，避免切頁時重複分析，但過期後進頁會自動更新。
        const createdAt = Date.now();
        const dateStr = formatSignalTimestamp(createdAt);
        const latestQuantMeta = getLatestQuantMeta(quantMetas);
        setSignalDataDate(dateStr);
        setQuantMeta(latestQuantMeta);
        setUsingSignalCache(false);
        const cacheData: SignalCacheData = {
          ...signals,
          _schema: PORTFOLIO_SIGNAL_CACHE_SCHEMA,
          _date: dateStr,
          _holdingKeys: holdingKeys,
          _refreshSlot: refreshSlot.key,
          _createdAt: createdAt,
          _quantMeta: latestQuantMeta || undefined,
          _dataVersion: dataVersion || undefined,
          _incompleteCodes: incompleteCodes,
        };
        const ttlMs = Math.min(PORTFOLIO_SIGNAL_TTL_MS, refreshSlot.ttlMs);
        setCache(cacheKey, cacheData, ttlMs);
        setPersistentCache(PORTFOLIO_PERSISTENT_CACHE_KEY, cacheData, ttlMs, refreshSlot.key);
      }
    }
    loadSignals().catch(err => {
      console.error('Portfolio signal loader failed', err);
      if (mounted) {
        setSignalsLoading(false);
        setLoadingMsg('分析暫時逾時，已先顯示庫存資料');
        setUsingSignalCache(false);
      }
    });
    return () => { mounted = false; };
  }, [holdings, holdingStartDates, hasAiFeature, enableCustomSignal, refreshKey, dailyDataVersion]);

  useEffect(() => {
    let mounted = true;
    if (holdings.length === 0) return;
    const cachedOfficialMap = getCache<Record<string, OfficialPriceMapEntry>>(CACHE_KEYS.TWSE_PRICE_MAP);
    if (cachedOfficialMap && mounted) setMarketMap(cachedOfficialMap);
    if (!canAutoRefreshPrices() && cachedOfficialMap) {
      return () => { mounted = false; };
    }
    fetchOfficialPriceMap()
      .then(map => {
        if (mounted) {
          setMarketMap(map);
          if (Object.keys(map).length > 0) setCache(CACHE_KEYS.TWSE_PRICE_MAP, map);
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [holdings.length]);

  const dataUpdateLabel = quantMeta ? formatMetaDateTime(quantMeta.fetchedAt) : signalDataDate || '載入中...';
  const dataDateLabel = quantMeta?.dataDate ? quantMeta.dataDate.replace(/-/g, '/') : '同步中';
  const dataFreshness = getDataFreshness(quantMeta, isRefreshing, Boolean(signalDataDate || quantMeta), priceRefreshError);

  return (
    <div className="portfolio">
      <div className="page-header">
        <h1 className="page-title">💼 我的庫存</h1>
      </div>

      {isRefreshing && holdings.length > 0 && (
        <div className={`pf-loading-bar ${priceRefreshing ? 'pf-loading-bar-price' : ''}`}>
          <span className="pf-inline-spinner" />
          <span>{loadingMsg}</span>
          <span className="pf-loading-pct">{loadingProgress}%</span>
        </div>
      )}

      {/* 總覽卡片 */}
      <div className={`card portfolio-summary-card ${summary.totalCost > 0 ? (isProfit ? 'card-profit' : 'card-loss') : 'card-primary'}`}>
        <div className="portfolio-asset-label">我的總資產 💰</div>
        <div className="portfolio-asset-value">
          <span className="portfolio-asset-currency">NT$</span>
          <span className="portfolio-asset-number">{formatMoney(summary.totalAssets)}</span>
        </div>

        <div className="portfolio-asset-details portfolio-asset-details-three">
          <div className="portfolio-asset-detail">
            <span className="portfolio-asset-detail-label">💵 可用現金</span>
            <span className="portfolio-asset-detail-value">
              <span className="portfolio-asset-currency">NT$</span>
              <span className="portfolio-asset-number">{formatMoney(summary.cashBalance)}</span>
            </span>
          </div>
          <div className="portfolio-asset-detail">
            <span className="portfolio-asset-detail-label">📈 股票市值</span>
            <span className="portfolio-asset-detail-value">
              <span className="portfolio-asset-currency">NT$</span>
              <span className="portfolio-asset-number">{formatMoney(summary.totalMarketValue)}</span>
            </span>
          </div>
          <div className="portfolio-asset-detail">
            <span className="portfolio-asset-detail-label">📊 未平倉損益</span>
            <span className={`portfolio-asset-detail-value ${pl > 0 ? 'portfolio-asset-pnl-profit' : pl < 0 ? 'portfolio-asset-pnl-loss' : ''}`}>
              <span className="portfolio-asset-number-row">
                <span>{pl > 0 ? '+' : ''}</span>
                <span className="portfolio-asset-currency">NT$</span>
                <span className="portfolio-asset-number">{formatMoney(pl)}</span>
              </span>
              <span className="portfolio-asset-pct">({summary.profitLossPct > 0 ? '+' : ''}{summary.profitLossPct.toFixed(1)}%)</span>
            </span>
          </div>
        </div>

        {holdingAllocation.totalMarketValue > 0 && (
          <div className="portfolio-stock-mix" aria-label="庫存類別組成">
            <div
              className="portfolio-stock-mix-chart"
              style={{ background: holdingAllocation.gradient }}
            >
              <div className="portfolio-stock-mix-hole">
                <span>類別</span>
                <strong>{holdingAllocation.itemCount} 個</strong>
              </div>
            </div>
            <div className="portfolio-stock-mix-content">
              <div className="portfolio-stock-mix-header">
                <span className="portfolio-stock-mix-title">庫存類別組成</span>
                <span className="portfolio-stock-mix-total">
                  NT$ {formatMoney(holdingAllocation.totalMarketValue)}
                </span>
              </div>
              <div className="portfolio-stock-mix-list">
                {holdingAllocation.items.map(item => (
                  <div className="portfolio-stock-mix-row" key={item.categoryName}>
                    <span
                      className="portfolio-stock-mix-swatch"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="portfolio-stock-mix-name">
                      {item.categoryName}
                      <span className="portfolio-stock-mix-code">{item.stockCount} 檔</span>
                    </span>
                    <span className="portfolio-stock-mix-value">
                      NT$ {formatMoney(item.marketValue)}
                    </span>
                    <span className="portfolio-stock-mix-percent">
                      {item.percent.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="section-header" style={{ marginTop: '24px', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          📊 持股清單 ({holdings.length})
        </h2>
        {!hasAiFeature && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13.5px', color: '#555', cursor: 'pointer', fontWeight: 600, background: '#f5f5f5', padding: '6px 12px', borderRadius: '8px' }}>
              <input 
                type="checkbox" 
                checked={enableCustomSignal} 
                onChange={e => toggleCustomSignal(e.target.checked)} 
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              顯示加碼與出場訊號
            </label>
            {enableCustomSignal && (
              <div style={{ fontSize: '11px', color: '#888', background: '#f5f5f5', padding: '6px 10px', borderRadius: '6px', lineHeight: '1.4' }}>
                <span style={{ color: '#FF2424', fontWeight: 600 }}>加碼：</span>站上季線 + 收盤創 20 日新高<br/>
                <span style={{ color: 'var(--loss-color)', fontWeight: 600 }}>出場：</span>跌破季線連續 2 天
              </div>
            )}
          </div>
        )}
      </div>

      {/* 資料來源小字 */}
      <div className="pf-data-source">
        {hasAiFeature ? (
          <>
            <div className="pf-data-meta-lines">
              <span className={`pf-data-freshness ${dataFreshness.className}`}>{dataFreshness.label}</span>
              <span className="pf-data-meta-today">今天日期：{formatTodayDate()}</span>
              <span className="pf-data-meta-updated">資料更新：{dataUpdateLabel}</span>
              <span className="pf-data-meta-updated">資料日期：{dataDateLabel}</span>
              <span className="pf-data-meta-schedule">固定更新：{getFixedUpdateLabel()}</span>
              <span className="pf-data-meta-schedule">價格：進頁與盤中背景自動檢查</span>
            </div>
            <button
              className="pf-refresh-btn"
              title="手動檢查每日 AI 快取並更新價格"
              disabled={isRefreshing}
              onClick={async () => {
                clearCache(CACHE_KEYS.PORTFOLIO_SIGNALS);
                clearPersistentCache(PORTFOLIO_PERSISTENT_CACHE_KEY);
                clearQuantSignalTTLCache();
                setAiSignals({});
                setSignalDataDate('');
                setQuantMeta(null);
                setLoadingProgress(0);
                setLoadingMsg('正在手動檢查 Simons 每日資料...');
                await refreshDailyAiCache(holdings.map(h => h.stockCode));
                const latest = await fetchDailyAiCacheVersion();
                if (latest?.version) {
                  rememberDailyAiCacheVersion(latest.version, 'portfolio');
                  setDailyDataVersion(latest.version);
                  invalidateDailyMarketDataCaches();
                }
                await runPriceRefresh(true, '正在重新抓取持股價格...');
                // 遞增 refreshKey 重新讀取每日 AI 快取。
                setRefreshKey(k => k + 1);
              }}
            >
              {isRefreshing ? (
                <>
                  <span className="pf-btn-spinner" />
                  抓取中
                </>
              ) : (
                <>🔄 重新抓取</>
              )}
            </button>
          </>
        ) : enableCustomSignal ? (
          <span style={{ color: 'var(--primary)' }}>FinMind 技術指標（近 150 日）</span>
        ) : (
          <span style={{ color: 'var(--text-tertiary)' }}>台灣證券交易所 TWSE（持倉成本為入場均價）</span>
        )}
      </div>

      {holdingAllocation.categories.length > 0 && (
        <div className="portfolio-category-tabs-shell">
          <div
            ref={categoryTabsRef}
            className={`portfolio-category-tabs${isDraggingCategoryTabs ? ' is-dragging' : ''}`}
            aria-label="庫存類別篩選"
            onWheel={handleCategoryTabsWheel}
            onPointerDown={handleCategoryTabsPointerDown}
            onPointerMove={handleCategoryTabsPointerMove}
            onPointerUp={endCategoryTabsDrag}
            onPointerCancel={endCategoryTabsDrag}
            onPointerLeave={endCategoryTabsDrag}
          >
            <button
              type="button"
              className={`portfolio-category-tab ${selectedHoldingCategory === 'ALL' ? 'active' : ''}`}
              onClick={() => selectHoldingCategory('ALL')}
            >
              <span className="portfolio-category-tab-label">全部</span>
              <span className="portfolio-category-tab-count">{holdings.length} 檔</span>
            </button>
            {holdingAllocation.categories.map(item => (
              <button
                type="button"
                key={item.categoryName}
                className={`portfolio-category-tab ${selectedHoldingCategory === item.categoryName ? 'active' : ''}`}
                onClick={() => selectHoldingCategory(item.categoryName)}
                title={`${item.categoryName}：NT$ ${formatMoney(item.marketValue)}，占庫存 ${item.percent.toFixed(1)}%`}
              >
                <span
                  className="portfolio-category-tab-dot"
                  style={{ backgroundColor: item.color }}
                />
                <span className="portfolio-category-tab-label">{formatCompactCategoryName(item.categoryName)}</span>
                <span className="portfolio-category-tab-count">{item.stockCount} 檔</span>
                <span className="portfolio-category-tab-detail" role="tooltip">
                  <strong>{item.categoryName}</strong>
                  <span>NT$ {formatMoney(item.marketValue)}・{item.percent.toFixed(1)}%・{item.stockCount} 檔</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeEtfDialog && (
        <div className="pf-etf-info-overlay" onClick={() => setActiveEtfDialog(null)}>
          <div className="pf-etf-info-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="pf-etf-info-close" type="button" onClick={() => setActiveEtfDialog(null)} aria-label="關閉">×</button>
            <div className="pf-etf-info-title">
              {activeEtfDialog.stockName} {activeEtfDialog.stockCode}
            </div>
            <div className="pf-etf-info-subtitle">ETF 支撐</div>
            <p className="pf-etf-info-text">
              這張小卡顯示大型台股 ETF 近 5 日對這檔股票的持股異動次數，用來補強建倉與加碼信心，不用分數呈現。
            </p>
            <div className="pf-etf-info-rule-list">
              <div>{getActiveEtfDetailText(activeEtfDialog.radar)}</div>
              <div>ETF+N：代表目前有 N 檔追蹤 ETF 持有這支股票。</div>
              <div>明細會列出近 5 日新進、加碼、減碼、剔除與持有狀態。</div>
            </div>
            <p className="pf-etf-info-note">
              ETF 支撐是資金底盤參考，不等於單獨買賣建議，仍需搭配加碼時機、股票本質與風險控管。
            </p>
          </div>
        </div>
      )}


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
          ) : filteredHoldings.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔎</div>
              <div className="empty-state-title">這個類別目前沒有庫存</div>
              <button className="btn btn-primary" onClick={() => setSelectedHoldingCategory('ALL')}>
                顯示全部庫存
              </button>
            </div>
          ) : (
            filteredHoldings.map((h: Holding) => {
              const itemPL = (h.currentPrice - h.avgCost) * h.totalShares;
              const itemPLPct = ((h.currentPrice - h.avgCost) / h.avgCost * 100);
              const itemIsProfit = itemPL >= 0;
              const isStopLossAlert = Number.isFinite(itemPLPct) && itemPLPct <= -20;
              const signal = aiSignals[h.stockCode];
              const memberQuantChips = hasAiFeature ? renderMemberQuantChips(signal) : null;
              return (
                <div
                  key={h.stockCode}
                  className={`holding-item${signal ? ` signal-${signal.primaryType}` : ''}${isStopLossAlert ? ' holding-item-stop-loss' : ''}`}
                  onClick={() => navigate(`/stock/${h.stockCode}`)}
                >
                  <div className="holding-main-row">
                    <div className="holding-left">
                      {signal ? (
                        <div className={`signal-badge signal-badge-${signal.primaryType}`}>
                          <span className="signal-badge-icon">{signal.primaryIcon}</span>
                          <span className="signal-badge-text">{signal.primaryLabel}</span>
                          {signal.streakCount !== undefined && signal.streakCount > 1 && (
                            <span className="signal-badge-count">X{signal.streakCount}</span>
                          )}
                        </div>
                      ) : hasAiFeature ? (
                        <div className="signal-badge signal-badge-loading" aria-label="AI 訊號讀取中">
                          <span className="signal-badge-loading-dot" />
                          <span className="signal-badge-text">讀取中</span>
                        </div>
                      ) : (
                        <div className="holding-emoji">{itemIsProfit ? '😊' : '😢'}</div>
                      )}
                      <div className="holding-info">
                        <div className="holding-name-line">
                          <IndustryIcon stockCode={h.stockCode} industry={h.industry} compact />
                          <span className="holding-name">{h.stockName}</span>
                          <MarketBadge market={marketMap[h.stockCode]?.market} compact />
                        </div>
                        <div className="holding-code-market-line">
                          <span className="holding-code">{h.stockCode}</span>
                        </div>
                        <div className={`holding-rec-line${hasAiFeature ? ' holding-rec-line-quant' : ''}`}>
                          {renderAddPriorityChip(h.stockCode, signal)}
                          {renderTrendStatusChip(signal)}
                          {renderActiveEtfRadarChip(h.stockCode, h.stockName)}
                          {memberQuantChips}
                          {!hasAiFeature && renderRecommendationCountBadge(h.stockCode)}
                          {renderProfitLossLevelBadge(itemPLPct, signal)}
                        </div>
                      </div>
                    </div>
                    <div className="holding-center">
                      <div className="holding-shares">{formatHoldingShares(h.totalShares)}</div>
                      <div className="holding-avg">成本 {formatPrice(h.avgCost)}</div>
                    </div>
                    <div className="holding-right">
                      {priceUpdatedLabel && (
                        <div className="holding-price-updated">{priceUpdatedLabel}</div>
                      )}
                      <div className="holding-current">NT$ {formatPrice(h.currentPrice)}</div>
                      <div className={`holding-pl ${itemIsProfit ? 'text-profit' : 'text-loss'}`}>
                        {itemIsProfit ? '+' : ''}{formatMoney(itemPL)}
                      </div>
                      <div className={`holding-pl-pct ${itemIsProfit ? 'text-profit' : 'text-loss'}`}>
                        ({itemIsProfit ? '+' : ''}{itemPLPct.toFixed(1)}%)
                      </div>
                    </div>
                  </div>
                  <div className="holding-trade-actions" aria-label={`${h.stockName} 快速交易`}>
                    <button
                      type="button"
                      className="holding-trade-btn holding-trade-btn-buy"
                      disabled={!dataReady}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedTrade({ mode: 'buy', holding: h });
                      }}
                    >
                      買入
                    </button>
                    <button
                      type="button"
                      className="holding-trade-btn holding-trade-btn-sell"
                      disabled={!dataReady || h.totalShares <= 0}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedTrade({ mode: 'sell', holding: h });
                      }}
                    >
                      賣出
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      {selectedTrade && (
        <StockTradeModal
          isOpen={Boolean(selectedTrade)}
          mode={selectedTrade.mode}
          stockCode={selectedTrade.holding.stockCode}
          stockName={selectedTrade.holding.stockName}
          price={selectedTrade.holding.currentPrice}
          industry={selectedTrade.holding.industry || ''}
          onClose={() => setSelectedTrade(null)}
        />
      )}
    </div>
  );
}

