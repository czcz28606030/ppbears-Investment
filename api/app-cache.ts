import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  fetchSimonsDataForDate,
  getLatestCompletedTradingDateTW,
  getSimonsItemDataDate,
  getTodayTW,
  isSimonsDataReadyForDate,
  loadTodayCache,
  saveTodayCache,
} from '../src/server/newsletter-utils.js';
import handleInstitutionCost from '../src/server/institution-cost.js';
import { buildAndSaveUserMarketCaches } from '../src/server/user-market-cache.js';

const IFALGO_BASE = 'https://api.ifalgo.com.tw/frontapi';
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

type OfficialPriceMapEntry = {
  close: string;
  change: string;
  name: string;
  volume: number;
  date: string;
  market?: 'listed' | 'otc';
};

type OfficialPriceMap = Record<string, OfficialPriceMapEntry>;
type MoodLabel = '貪婪' | '樂觀' | '放鬆' | '冷靜';
type MarketMomentumPoint = { label: string; moneyMomentum: number; taiex: number };
type MarginMaintenancePoint = { label: string; rate: number };
type StockQuantData = {
  aiQuanBackDataComment: { remark: string; cum_ret: string; freq: number } | null;
  chipStability: { pts: string } | null;
  stockInfo: { gvi: number; mediangvi: string } | null;
  currentSignal: 'buy' | 'sell' | 'neutral';
  signalStreak: { signal: 'buy' | 'sell' | null; count: number };
  reentryAfterExit: { hasReentry: boolean; exitDate: string; entryDate: string } | null;
  meta?: StockQuantMeta;
};

type StockQuantHistoryPoint = {
  date: string;
  coid: string;
  stkname: string | null;
  chipPts: number;
  aiRemark: string | null;
  aiCumRet: string | null;
  gvi: number | null;
  mediangvi: number | null;
  source: 'stock_quant_daily_snapshots' | 'simons_daily_snapshots' | 'ifalgo-live';
};

type SimonsRecommendationCounts = Record<string, number>;
type SimonsInstitutionCostData = {
  coid: string;
  stockName: string;
  date: string;
  source: 'simons-recommendation';
  foreignCost: number | null;
  trustCost: number | null;
  dealerCost: number | null;
  weightedAverage: number | null;
  close: number | null;
};

type ActiveEtfAction = 'added' | 'increased' | 'decreased' | 'removed' | 'held';
type ActiveEtfRadarItem = {
  coid: string;
  stockName: string | null;
  signal: 'bullish' | 'watch' | 'neutral' | 'bearish';
  score: number;
  days: number;
  fromDate: string;
  latestDate: string | null;
  holdingEtfCount: number;
  addedEtfCount: number;
  increasedEtfCount: number;
  decreasedEtfCount: number;
  removedEtfCount: number;
  netWeightChangePct: number;
  etfs: Array<{
    etfCode: string;
    etfName: string;
    action: ActiveEtfAction;
    weightPct: number | null;
    previousWeightPct: number | null;
    weightChangePct: number | null;
    shares: number | null;
    previousShares: number | null;
    shareChange: number | null;
  }>;
  source: string;
};

type UserRow = {
  id: string;
  role: 'parent' | 'child';
  parent_id: string | null;
  tier: 'free' | 'premium';
  is_admin: boolean;
  subscription_expires_at: string | null;
};

type FeatureOverrideRow = {
  enabled: boolean;
};

type StockTradingSignal = {
  id: string;
  coid: string;
  stockName: string;
  inDate: string;
  buyClose: number | null;
  outDate: string;
  sellClose: number | null;
  signal: string;
  returnPct: string;
  createdAt: string;
  updatedAt: string;
};

type StockSignalAccessResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

type StockQuantMeta = {
  source: 'shared-cache' | 'ifalgo-live' | 'empty';
  dataDate: string;
  fetchedAt: string;
  fixedUpdateTime: string;
  scheduleLabel: string;
  cacheStatus: 'hit' | 'miss' | 'fresh';
};

const AI_SYNC_LABEL = '08:00 自動檢查；可手動重新抓取';
const AI_SYNC_SCHEDULE_LABEL = 'AI訊號每日 08:00 檢查 Simons 完成狀態；手動重新抓取可再檢查一次；價格資料獨立更新';
const STOCK_SIGNAL_FEATURE_KEY = 'ai_stock_picking';

type IFAlgoIndexFirstZoneData = {
  lastImrset?: { mdate?: string; lmrToday?: string | number; boundary?: string | number };
  imrsetList?: Array<{ mdate?: string; lmrToday?: string | number }>;
  lastForcastMonthly?: { mdate?: string; conv1?: string | number; mforecast?: string | number; longshort?: string };
  lastForecastMonthly?: { mdate?: string; conv1?: string | number; mforecast?: string | number; longshort?: string };
  forcastMonthlyList?: Array<string | number>;
  forcastMonthlyDateList?: string[];
  currencyList?: Array<string | number>;
  lastPtsTw?: { mdate?: string; pts?: string | number };
};

export const config = {
  maxDuration: 300,
};

function secondsUntilNextTaipeiHour(hour: number): number {
  const now = Date.now();
  const taipei = new Date(now + TAIPEI_OFFSET_MS);
  let next = Date.UTC(taipei.getUTCFullYear(), taipei.getUTCMonth(), taipei.getUTCDate(), hour, 0, 0, 0);
  if (taipei.getTime() >= next) next += 24 * 60 * 60 * 1000;
  return Math.max(300, Math.floor((next - TAIPEI_OFFSET_MS - now) / 1000));
}

function setDailyCacheHeaders(res: VercelResponse) {
  res.setHeader('Cache-Control', `s-maxage=${secondsUntilNextTaipeiHour(7)}, stale-while-revalidate=3600`);
}

function isTaipeiWeekday(): boolean {
  const taipei = new Date(Date.now() + TAIPEI_OFFSET_MS);
  const day = taipei.getUTCDay();
  return day >= 1 && day <= 5;
}

function isSimonsDataAtLeastTarget(items: any[] | undefined, targetDate: string): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  const dataDate = getSimonsItemDataDate(items);
  return Boolean(dataDate && dataDate >= targetDate);
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getAdminClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase server configuration');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isPremiumUserRow(row: Pick<UserRow, 'tier' | 'is_admin' | 'subscription_expires_at'> | null): boolean {
  if (!row) return false;
  if (row.is_admin) return true;
  if (row.tier !== 'premium') return false;
  if (!row.subscription_expires_at) return true;
  return new Date(row.subscription_expires_at) > new Date();
}

async function requireStockSignalFeature(req: VercelRequest): Promise<StockSignalAccessResult> {
  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) {
    return { ok: true };
  }

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, status: 401, error: '請先登入會員帳號' };

  const supabase = getAdminClient();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return { ok: false, status: 401, error: '登入狀態已失效，請重新登入' };
  }

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id,role,parent_id,tier,is_admin,subscription_expires_at')
    .eq('id', authData.user.id)
    .maybeSingle<UserRow>();
  if (userError) return { ok: false, status: 500, error: userError.message };
  if (!user) return { ok: false, status: 403, error: '找不到會員資料' };
  if (user.is_admin) return { ok: true };

  const { data: override } = await supabase
    .from('feature_overrides')
    .select('enabled')
    .eq('user_id', user.id)
    .eq('feature_key', STOCK_SIGNAL_FEATURE_KEY)
    .maybeSingle<FeatureOverrideRow>();
  if (override) {
    return override.enabled
      ? { ok: true }
      : { ok: false, status: 403, error: '此量化訊號僅限 Premium 會員使用' };
  }

  if (isPremiumUserRow(user)) return { ok: true };
  if (user.role === 'child' && user.parent_id) {
    const { data: parent } = await supabase
      .from('users')
      .select('tier,is_admin,subscription_expires_at')
      .eq('id', user.parent_id)
      .maybeSingle<Pick<UserRow, 'tier' | 'is_admin' | 'subscription_expires_at'>>();
    if (isPremiumUserRow(parent || null)) return { ok: true };
  }

  return { ok: false, status: 403, error: '此量化訊號僅限 Premium 會員使用' };
}

function parseMarketNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = parseFloat(String(value ?? '').replace(/,/g, '').replace(/\+/g, '').replace(/%/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function clampMarketValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseMonthlyForecast(value: unknown): number | undefined {
  const forecast = parseMarketNumber(value);
  return Number.isFinite(forecast) && forecast !== 0 ? forecast : undefined;
}

function getMonthlyDirectionScore(label: string, forecast?: number, fallbackScore = 50): number {
  const normalized = String(label || '');
  if (normalized.includes('偏多') || normalized.includes('多') || (forecast ?? 0) > 0) return 82;
  if (normalized.includes('偏空') || normalized.includes('偏弱') || normalized.includes('空') || (forecast ?? 0) < 0) return 18;
  if (normalized.includes('穩健')) return 62;
  return Math.round(clampMarketValue(fallbackScore, 0, 100));
}

function normalizeRocOrIsoDate(value: unknown): string {
  const raw = String(value ?? '');
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 7) return `${parseInt(digits.slice(0, 3), 10) + 1911}${digits.slice(3)}`;
  return raw.replace(/[-/]/g, '');
}

function normalizeIsoSignalDate(value: unknown): string {
  const raw = String(value ?? '').trim().replace(/\//g, '-');
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return raw;
}

function normalizeActiveEtfAction(value: unknown): ActiveEtfAction {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'added' || raw === 'new' || raw.includes('新進')) return 'added';
  if (raw === 'increased' || raw === 'increase' || raw.includes('加碼') || raw.includes('增')) return 'increased';
  if (raw === 'decreased' || raw === 'decrease' || raw.includes('減碼') || raw.includes('減')) return 'decreased';
  if (raw === 'removed' || raw === 'delete' || raw.includes('剔除') || raw.includes('刪')) return 'removed';
  return 'held';
}

async function getSimonsPayload(options: { allowCurrentDate?: boolean } = {}) {
  const today = getTodayTW();
  const targetDate = getLatestCompletedTradingDateTW();
  const existing = await loadTodayCache(today);

  if (options.allowCurrentDate && isTaipeiWeekday() && today > targetDate) {
    const currentItems = await fetchSimonsDataForDate(today);
    if (isSimonsDataReadyForDate(currentItems, today)) {
      await saveTodayCache({
        cache_date: today,
        all_stocks: currentItems,
        ai_filtered: existing?.ai_filtered || [],
      });
      return {
        cacheDate: today,
        targetDate: today,
        dataDate: getSimonsItemDataDate(currentItems),
        items: currentItems,
        source: 'ifalgo-live',
        status: 'ready',
        cacheUpdatedAt: new Date().toISOString(),
      };
    }
  }

  if (existing?.all_stocks?.length) {
    const dataDate = getSimonsItemDataDate(existing.all_stocks);
    if (isSimonsDataAtLeastTarget(existing.all_stocks, targetDate)) {
      return {
        cacheDate: today,
        targetDate: dataDate > targetDate ? dataDate : targetDate,
        dataDate,
        items: existing.all_stocks,
        source: 'supabase-cache',
        status: 'ready',
        cacheUpdatedAt: existing.created_at,
      };
    }
  }

  const items = await fetchSimonsDataForDate(targetDate);
  if (isSimonsDataReadyForDate(items, targetDate)) {
    await saveTodayCache({
      cache_date: today,
      all_stocks: items,
      ai_filtered: existing?.ai_filtered || [],
    });
    return {
      cacheDate: today,
      targetDate,
      dataDate: getSimonsItemDataDate(items),
      items,
      source: 'ifalgo-live',
      status: 'ready',
      cacheUpdatedAt: new Date().toISOString(),
    };
  }

  return {
    cacheDate: today,
    targetDate,
    dataDate: existing?.all_stocks?.length ? getSimonsItemDataDate(existing.all_stocks) : '',
    items: existing?.all_stocks || [],
    source: existing?.all_stocks?.length ? 'supabase-cache' : 'empty',
    status: 'waiting-simons',
    cacheUpdatedAt: existing?.created_at,
  };
}

async function getDailyAiCacheVersion() {
  const cacheDate = getTodayTW();
  const cache = await loadTodayCache(cacheDate);
  const items = cache?.all_stocks || [];
  const dataDate = items.length ? getSimonsItemDataDate(items) : '';
  const updatedAt = cache?.created_at || '';
  return {
    cacheDate,
    dataDate,
    updatedAt,
    itemCount: items.length,
    status: items.length > 0 && dataDate ? 'ready' : 'empty',
    version: [cacheDate, dataDate, updatedAt, items.length].join('|'),
    generatedAt: new Date().toISOString(),
  };
}

async function getOfficialPrices(): Promise<OfficialPriceMap> {
  const [twseResponse, tpexResponse] = await Promise.allSettled([
    fetchWithTimeout('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', { headers: { accept: 'application/json' } }),
    fetchWithTimeout('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', { headers: { accept: 'application/json' } }),
  ]);

  const prices: OfficialPriceMap = {};

  if (twseResponse.status === 'fulfilled' && twseResponse.value.ok) {
    try {
      const rows = await twseResponse.value.json() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const code = String(row.Code || '');
        const close = String(row.ClosingPrice || '');
        if (!code || !close) continue;
        prices[code] = {
          close,
          change: String(row.Change || '0'),
          name: String(row.Name || ''),
          volume: Math.floor(parseInt(String(row.TradeVolume || '0'), 10) / 1000),
          date: normalizeRocOrIsoDate(row.Date),
          market: 'listed',
        };
      }
    } catch (error) {
      console.warn('official-prices TWSE parse failed:', error instanceof Error ? error.message : String(error));
    }
  }

  if (tpexResponse.status === 'fulfilled' && tpexResponse.value.ok) {
    try {
      const rows = await tpexResponse.value.json() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const code = String(row.SecuritiesCompanyCode || '');
        const close = String(row.Close || '');
        if (!code || !close || prices[code]) continue;
        prices[code] = {
          close,
          change: String(row.Change || '0'),
          name: String(row.CompanyName || ''),
          volume: Math.floor(parseInt(String(row.TradingShares || '0'), 10) / 1000),
          date: normalizeRocOrIsoDate(row.Date),
          market: 'otc',
        };
      }
    } catch (error) {
      console.warn('official-prices TPEx parse failed:', error instanceof Error ? error.message : String(error));
    }
  }

  return prices;
}

function todayTaipei(): string {
  return new Date(Date.now() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

function daysAgoTaipei(days: number): string {
  const date = new Date(Date.now() + TAIPEI_OFFSET_MS);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function parseNumericOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === 'NA') return null;
  const n = parseFloat(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function getRecentTaipeiDates(days: number): string[] {
  const boundedDays = Math.max(1, Math.min(120, days || 90));
  const dates: string[] = [];
  for (let i = 0; i <= boundedDays; i++) {
    const taipei = new Date(Date.now() + TAIPEI_OFFSET_MS);
    taipei.setUTCDate(taipei.getUTCDate() - i);
    const day = taipei.getUTCDay();
    if (day === 0 || day === 6) continue;
    dates.push(taipei.toISOString().slice(0, 10));
  }
  return dates;
}

function mapSimonsInstitutionCostItem(item: any, date: string): SimonsInstitutionCostData | null {
  const foreignCost = parseNumericOrNull(item?.fcost);
  const trustCost = parseNumericOrNull(item?.tcost);
  const dealerCost = parseNumericOrNull(item?.dcost);
  const weightedAverage = parseNumericOrNull(item?.wtcost);
  if (!foreignCost && !trustCost && !dealerCost && !weightedAverage) return null;

  return {
    coid: String(item?.coid || ''),
    stockName: String(item?.stkname || ''),
    date: String(item?.mdate || date).slice(0, 10),
    source: 'simons-recommendation',
    foreignCost,
    trustCost,
    dealerCost,
    weightedAverage,
    close: parseNumericOrNull(item?.close),
  };
}

async function findSimonsInstitutionCost(coid: string, days: number): Promise<SimonsInstitutionCostData | null> {
  const dates = getRecentTaipeiDates(days);
  const batchSize = 8;

  for (let i = 0; i < dates.length; i += batchSize) {
    const batch = dates.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async date => {
      try {
        const items = await fetchSimonsDataForDate(date);
        const match = items.find((item: any) => String(item?.coid || '') === coid);
        return match ? mapSimonsInstitutionCostItem(match, date) : null;
      } catch (error) {
        console.warn('findSimonsInstitutionCost error:', date, error instanceof Error ? error.message : error);
        return null;
      }
    }));
    const found = results.find(item => item !== null);
    if (found) return found;
  }

  return null;
}

async function getSimonsInstitutionCostPayload(coid: string, days: number) {
  const boundedDays = Math.max(1, Math.min(120, days || 90));
  const cost = await findSimonsInstitutionCost(coid, boundedDays);
  return {
    coid,
    days: boundedDays,
    cost,
    source: cost ? 'simons-recommendation-history' : 'empty',
    generatedAt: new Date().toISOString(),
  };
}

function normalizeSignalText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeAiQuanBackDataComment(stock: any): StockQuantData['aiQuanBackDataComment'] {
  const comment = stock?.aiQuanBackDataComment;
  if (!comment || typeof comment !== 'object') return null;

  const cumRet = normalizeSignalText(
    comment.cum_ret ?? comment.cumRet ?? comment.cumRetPct ?? comment.total_return ?? comment.totalReturn
  );
  const remark = normalizeSignalText(comment.remark);
  const freq = parseNumericOrNull(comment.freq);

  if (!cumRet && !remark && freq === null) return null;
  return {
    remark,
    cum_ret: cumRet,
    freq: freq ?? 0,
  };
}

const BUY_SIGNAL_TEXTS = new Set(['進場', '加碼', '買進', 'buy', 'Buy', 'BUY']);
const SELL_SIGNAL_TEXTS = new Set(['出場', '賣出', '減碼', 'sell', 'Sell', 'SELL']);

function normalizeSignalDate(value: unknown): string {
  const raw = normalizeSignalText(value).replace(/\//g, '-');
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return raw;
}

function isOpenOutDate(outDate: string, inDate: string, today: string): boolean {
  return !outDate || outDate === 'NA' || outDate === 'null' || outDate === '-' || outDate === inDate || outDate === today;
}

function getCurrentSignalForDataDate(tradingList: any[], dataDate: string): StockQuantData['currentSignal'] {
  const targetDate = normalizeSignalDate(dataDate);
  if (!targetDate || !Array.isArray(tradingList)) return 'neutral';

  let hasBuyEvent = false;
  let hasSellEvent = false;

  for (const item of tradingList) {
    const inDate = normalizeSignalDate(item?.in_date);
    const outDate = normalizeSignalDate(item?.out_date);
    const sig = normalizeSignalText(item?.sell_sig);

    if (BUY_SIGNAL_TEXTS.has(sig) && inDate === targetDate) hasBuyEvent = true;
    if (SELL_SIGNAL_TEXTS.has(sig) && (outDate || inDate) === targetDate) hasSellEvent = true;
  }

  if (hasSellEvent) return 'sell';
  if (hasBuyEvent) return 'buy';
  return 'neutral';
}

function buildSignalEventMap(tradingList: any[], sinceDate?: string): Map<string, 'buy' | 'sell' | 'neutral'> {
  const today = todayTaipei();
  const eventMap = new Map<string, 'buy' | 'sell' | 'neutral'>();
  const setEvent = (eventDate: string, signal: 'buy' | 'sell' | 'neutral') => {
    if (!eventDate || (sinceDate && eventDate < sinceDate)) return;
    const current = eventMap.get(eventDate);
    if (signal === 'sell' || (signal === 'buy' && current !== 'sell') || !current) eventMap.set(eventDate, signal);
  };

  for (const item of tradingList) {
    const outDateRaw = normalizeSignalText(item?.out_date);
    const inDateRaw = normalizeSignalText(item?.in_date);
    const outDate = normalizeSignalDate(outDateRaw);
    const inDate = normalizeSignalDate(inDateRaw);
    const sig = normalizeSignalText(item?.sell_sig);
    const hasOpenPosition = isOpenOutDate(outDateRaw, inDateRaw, today);
    setEvent(inDate, 'buy');
    if (!hasOpenPosition) setEvent(outDate || inDate, sig === '中立' ? 'neutral' : 'sell');
  }

  return eventMap;
}

function getSortedSignalEvents(tradingList: any[], sinceDate?: string) {
  return [...buildSignalEventMap(tradingList, sinceDate).entries()]
    .map(([eventDate, signal]) => ({ eventDate, signal }))
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}

function calculateSignalStreak(tradingList: any[], sinceDate?: string): StockQuantData['signalStreak'] {
  let activeSignal: 'buy' | 'sell' | null = null;
  let count = 0;
  const signalEvents = getSortedSignalEvents(tradingList, sinceDate);

  for (const { signal } of signalEvents) {
    if (signal === 'neutral') continue;
    if (activeSignal === signal) count += 1;
    else {
      activeSignal = signal;
      count = 1;
    }
  }
  return { signal: activeSignal, count };
}

function calculateReentryAfterExit(tradingList: any[], sinceDate?: string): StockQuantData['reentryAfterExit'] {
  let previousSignal: 'buy' | 'sell' | null = null;
  let previousDate = '';
  let latestReentry: StockQuantData['reentryAfterExit'] = null;

  for (const { eventDate, signal } of getSortedSignalEvents(tradingList, sinceDate)) {
    if (signal === 'neutral') continue;
    if (signal === 'buy' && previousSignal === 'sell' && previousDate && eventDate > previousDate) {
      latestReentry = { hasReentry: true, exitDate: previousDate, entryDate: eventDate };
    }
    previousSignal = signal;
    previousDate = eventDate;
  }

  return previousSignal === 'buy' && latestReentry?.entryDate === previousDate ? latestReentry : null;
}

function emptyQuantData(): StockQuantData {
  return {
    aiQuanBackDataComment: null,
    chipStability: null,
    stockInfo: null,
    currentSignal: 'neutral',
    signalStreak: { signal: null, count: 0 },
    reentryAfterExit: null,
    meta: {
      source: 'empty',
      dataDate: todayTaipei(),
      fetchedAt: new Date().toISOString(),
      fixedUpdateTime: AI_SYNC_LABEL,
      scheduleLabel: AI_SYNC_SCHEDULE_LABEL,
      cacheStatus: 'miss',
    },
  };
}

function buildQuantMeta(
  source: StockQuantMeta['source'],
  dataDate: string,
  fetchedAt: string,
  cacheStatus: StockQuantMeta['cacheStatus'],
): StockQuantMeta {
  return {
    source,
    dataDate,
    fetchedAt,
    fixedUpdateTime: AI_SYNC_LABEL,
    scheduleLabel: AI_SYNC_SCHEDULE_LABEL,
    cacheStatus,
  };
}

function parseQuantData(stock: any, sinceDate?: string, dataDate = todayTaipei()): StockQuantData {
  const tradingList: any[] = stock?.aiQuanBackDataTradingList || [];
  const signalStreak = calculateSignalStreak(tradingList, sinceDate);
  const reentryAfterExit = calculateReentryAfterExit(tradingList, sinceDate);
  const currentSignal = getCurrentSignalForDataDate(tradingList, dataDate);

  return {
    aiQuanBackDataComment: normalizeAiQuanBackDataComment(stock),
    chipStability: stock?.position?.chipStability ?? null,
    stockInfo: stock?.position?.stockInfo ?? null,
    currentSignal,
    signalStreak,
    reentryAfterExit,
  };
}

function sanitizeIfalgoStockPayload(payload: any) {
  const stock = payload?.data?.stock;
  if (!stock || typeof stock !== 'object') return payload;
  return {
    ...payload,
    data: {
      ...payload.data,
      stock: {
        lastMdate: stock.lastMdate,
        position: stock.position,
      },
    },
  };
}

async function getSanitizedIfalgoStock(coid: string) {
  if (!/^\d{4,6}$/.test(coid)) return { error: 'Invalid coid' };
  const response = await fetchWithTimeout(`${IFALGO_BASE}/stock?coid=${encodeURIComponent(coid)}`, {
    headers: { accept: 'application/json' },
  }, 10000);
  if (!response.ok) return { error: `IFAlgo HTTP ${response.status}` };
  const json = await response.json() as any;
  return sanitizeIfalgoStockPayload(json);
}

function parseTradingSignalPrice(value: unknown): number | null {
  const n = parseFloat(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

async function getStockTradingSignals(coid: string) {
  if (!/^\d{4,6}$/.test(coid)) return { error: 'Invalid coid' };
  const response = await fetchWithTimeout(`${IFALGO_BASE}/stock?coid=${encodeURIComponent(coid)}`, {
    headers: { accept: 'application/json' },
  }, 10000);
  if (!response.ok) return { error: `IFAlgo HTTP ${response.status}` };
  const json = await response.json() as any;
  const stock = json?.data?.stock;
  const rows = Array.isArray(stock?.aiQuanBackDataTradingList) ? stock.aiQuanBackDataTradingList : [];
  const signals: StockTradingSignal[] = rows.map((row: any) => ({
    id: String(row.id ?? `${row.coid || coid}-${row.in_date || ''}-${row.out_date || ''}`),
    coid: String(row.coid || coid),
    stockName: String(row.stkname || ''),
    inDate: normalizeIsoSignalDate(row.in_date),
    buyClose: parseTradingSignalPrice(row.buy_close),
    outDate: normalizeIsoSignalDate(row.out_date),
    sellClose: parseTradingSignalPrice(row.sell_close),
    signal: String(row.sell_sig || '').trim(),
    returnPct: String(row.return || '').trim(),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }));
  const updatedDates = signals
    .map(signal => signal.updatedAt || signal.createdAt)
    .filter(Boolean)
    .sort();

  return {
    coid,
    dataDate: normalizeIsoSignalDate(stock?.lastMdate || stock?.position?.chipStability?.mdate || ''),
    signalUpdatedAt: updatedDates.length > 0 ? updatedDates[updatedDates.length - 1] : '',
    source: 'ifalgo-aiQuanBackDataTradingList',
    signals,
    generatedAt: new Date().toISOString(),
  };
}

async function getStockQuantData(coid: string, sinceDate?: string) {
  if (!/^\d{4,6}$/.test(coid)) return emptyQuantData();
  const response = await fetchWithTimeout(`${IFALGO_BASE}/stock?coid=${coid}`, {}, 10000);
  if (!response.ok) return emptyQuantData();
  const json = await response.json() as any;
  const stock = json?.data?.stock;
  if (!stock) return emptyQuantData();
  const dataDate = String(stock?.position?.chipStability?.mdate || todayTaipei());
  return {
    ...parseQuantData(stock, sinceDate, dataDate),
    meta: buildQuantMeta('ifalgo-live', dataDate, new Date().toISOString(), 'fresh'),
  };
}

function mapStockQuantSnapshotToData(row: any): StockQuantData {
  const signal = String(row.current_signal || 'neutral') as StockQuantData['currentSignal'];
  const normalizedSignal = signal === 'buy' || signal === 'sell' || signal === 'neutral' ? signal : 'neutral';
  return {
    aiQuanBackDataComment: row.ai_remark || row.ai_cum_ret || row.ai_freq !== null
      ? {
          remark: row.ai_remark ? String(row.ai_remark) : '',
          cum_ret: row.ai_cum_ret ? String(row.ai_cum_ret) : '',
          freq: Number(row.ai_freq || 0),
        }
      : null,
    chipStability: row.chip_pts !== null && row.chip_pts !== undefined ? { pts: String(row.chip_pts) } : null,
    stockInfo: row.gvi !== null || row.mediangvi !== null
      ? { gvi: Number(row.gvi || 0), mediangvi: String(row.mediangvi ?? '') }
      : null,
    currentSignal: normalizedSignal,
    signalStreak: { signal: normalizedSignal === 'neutral' ? null : normalizedSignal, count: normalizedSignal === 'neutral' ? 0 : 1 },
    reentryAfterExit: null,
    meta: buildQuantMeta(
      'shared-cache',
      String(row.snapshot_date || todayTaipei()),
      String(row.collected_at || new Date().toISOString()),
      'hit',
    ),
  };
}

async function getCachedStockQuantData(coid: string): Promise<StockQuantData | null> {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('stock_quant_daily_snapshots')
    .select('snapshot_date,coid,stkname,chip_pts,ai_remark,ai_cum_ret,ai_freq,gvi,mediangvi,current_signal,source,collected_at')
    .eq('coid', coid)
    .order('snapshot_date', { ascending: false })
    .order('collected_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return mapStockQuantSnapshotToData(data);
}

async function getStockQuantPayload(coid: string, sinceDate?: string, forceFresh = false) {
  if (!forceFresh) {
    const cached = await getCachedStockQuantData(coid);
    if (cached) return cached;
    return emptyQuantData();
  }

  const live = await getStockQuantData(coid, sinceDate);
  if (!sinceDate && live.meta?.source === 'ifalgo-live') {
    await persistStockQuantSnapshot(coid, undefined, { allowCurrentDate: forceFresh }).catch(() => undefined);
  }
  return {
    ...live,
    meta: live.meta ? { ...live.meta, cacheStatus: forceFresh ? 'fresh' : 'miss' } : live.meta,
  };
}

async function fetchLiveStockQuantHistoryPoint(coid: string): Promise<StockQuantHistoryPoint | null> {
  try {
    const response = await fetchWithTimeout(`${IFALGO_BASE}/stock?coid=${encodeURIComponent(coid)}`, {}, 10000);
    if (!response.ok) return null;
    const json = await response.json() as any;
    const stock = json?.data?.stock;
    const position = stock?.position;
    const chipPts = parseNumericOrNull(position?.chipStability?.pts);
    if (chipPts === null) return null;
    const comment = normalizeAiQuanBackDataComment(stock);

    return {
      date: String(position?.chipStability?.mdate || todayTaipei()),
      coid,
      stkname: String(position?.stkname || stock?.stkname || '') || null,
      chipPts,
      aiRemark: comment?.remark || null,
      aiCumRet: comment?.cum_ret || null,
      gvi: parseNumericOrNull(position?.stockInfo?.gvi),
      mediangvi: parseNumericOrNull(position?.stockInfo?.mediangvi),
      source: 'ifalgo-live',
    };
  } catch {
    return null;
  }
}

async function fetchStockQuantSnapshotRow(coid: string, fallbackName?: string) {
  const response = await fetchWithTimeout(`${IFALGO_BASE}/stock?coid=${encodeURIComponent(coid)}`, {}, 10000);
  if (!response.ok) return null;
  const json = await response.json() as any;
  const stock = json?.data?.stock;
  const position = stock?.position;
  const chipPts = parseNumericOrNull(position?.chipStability?.pts);
  if (!stock || chipPts === null) return null;

  const snapshotDate = String(position?.chipStability?.mdate || todayTaipei());
  const quantData = parseQuantData(stock, undefined, snapshotDate);
  const comment = quantData.aiQuanBackDataComment;
  return {
    snapshot_date: snapshotDate,
    coid,
    stkname: String(position?.stkname || fallbackName || stock?.stkname || coid),
    chip_pts: chipPts,
    ai_remark: comment?.remark || null,
    ai_cum_ret: comment?.cum_ret || null,
    ai_freq: parseNumericOrNull(comment?.freq),
    gvi: parseNumericOrNull(position?.stockInfo?.gvi),
    mediangvi: parseNumericOrNull(position?.stockInfo?.mediangvi),
    current_signal: quantData.currentSignal,
    source: 'ifalgo-stock',
    collected_at: new Date().toISOString(),
  };
}

function isAcceptableQuantSnapshotDate(snapshotDate: string, allowCurrentDate: boolean): boolean {
  const completedTargetDate = getLatestCompletedTradingDateTW();
  if (snapshotDate === completedTargetDate) return true;
  return allowCurrentDate && isTaipeiWeekday() && snapshotDate === getTodayTW();
}

async function persistStockQuantSnapshot(coid: string, fallbackName?: string, options: { allowCurrentDate?: boolean } = {}) {
  if (!/^\d{4,6}$/.test(coid)) return { saved: false, error: 'Invalid coid' };
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { saved: false, error: 'Supabase service role is not configured' };

  const row = await fetchStockQuantSnapshotRow(coid, fallbackName);
  if (!row) return { saved: false, coid, error: 'No Simons quant snapshot available' };
  const targetDate = getLatestCompletedTradingDateTW();
  if (!isAcceptableQuantSnapshotDate(row.snapshot_date, Boolean(options.allowCurrentDate))) {
    return {
      saved: false,
      coid,
      date: row.snapshot_date,
      targetDate: options.allowCurrentDate && isTaipeiWeekday() ? getTodayTW() : targetDate,
      error: 'Simons latest completed trading day data is not ready yet',
    };
  }

  const supabase = createClient(url, key);
  const { error } = await supabase
    .from('stock_quant_daily_snapshots')
    .upsert(row, { onConflict: 'snapshot_date,coid', ignoreDuplicates: false });

  if (error) return { saved: false, coid, date: row.snapshot_date, error: error.message };
  return { saved: true, coid, date: row.snapshot_date, chipPts: row.chip_pts };
}

function mapStockQuantHistoryRow(row: any, source: StockQuantHistoryPoint['source']): StockQuantHistoryPoint {
  return {
    date: String(row.snapshot_date),
    coid: String(row.coid),
    stkname: row.stkname ? String(row.stkname) : null,
    chipPts: Number(row.chip_pts),
    aiRemark: row.ai_remark ? String(row.ai_remark) : null,
    aiCumRet: row.ai_cum_ret ? String(row.ai_cum_ret) : null,
    gvi: row.gvi === null ? null : Number(row.gvi),
    mediangvi: row.mediangvi === null ? null : Number(row.mediangvi),
    source,
  };
}

function mergeStockQuantHistoryPoints(...groups: StockQuantHistoryPoint[][]): StockQuantHistoryPoint[] {
  const byDate = new Map<string, StockQuantHistoryPoint>();
  for (const group of groups) {
    for (const point of group) {
      if (!point.date || !Number.isFinite(point.chipPts)) continue;
      byDate.set(point.date, point);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function getStockQuantHistory(coid: string, days: number) {
  const boundedDays = Math.max(30, Math.min(60, days || 60));
  const fromDate = daysAgoTaipei(boundedDays + 7);
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let snapshotPoints: StockQuantHistoryPoint[] = [];
  let simonsPoints: StockQuantHistoryPoint[] = [];

  if (url && key) {
    const supabase = createClient(url, key);

    const snapshotResult = await supabase
      .from('stock_quant_daily_snapshots')
      .select('snapshot_date,coid,stkname,chip_pts,ai_remark,ai_cum_ret,gvi,mediangvi')
      .eq('coid', coid)
      .gte('snapshot_date', fromDate)
      .not('chip_pts', 'is', null)
      .order('snapshot_date', { ascending: true });

    if (!snapshotResult.error) {
      snapshotPoints = (snapshotResult.data || []).map(row => mapStockQuantHistoryRow(row, 'stock_quant_daily_snapshots'));
    }

    const simonsResult = await supabase
      .from('simons_daily_snapshots')
      .select('snapshot_date,coid,stkname,chip_pts,ai_remark,ai_cum_ret,gvi,mediangvi')
      .eq('coid', coid)
      .gte('snapshot_date', fromDate)
      .not('chip_pts', 'is', null)
      .order('snapshot_date', { ascending: true });

    if (!simonsResult.error) {
      simonsPoints = (simonsResult.data || []).map(row => mapStockQuantHistoryRow(row, 'simons_daily_snapshots'));
    }
  }

  const livePoint = await fetchLiveStockQuantHistoryPoint(coid);
  const points = mergeStockQuantHistoryPoints(simonsPoints, snapshotPoints, livePoint ? [livePoint] : [])
    .filter(point => point.date >= fromDate)
    .slice(-boundedDays);

  return {
    coid,
    days: boundedDays,
    points,
    count: points.length,
    generatedAt: new Date().toISOString(),
  };
}

async function getSimonsRecommendationCounts(coids: string[], days: number): Promise<{
  days: number;
  fromDate: string;
  counts: SimonsRecommendationCounts;
}> {
  const uniqueCoids = [...new Set(coids.map(coid => coid.trim()).filter(coid => /^\d{4,6}$/.test(coid)))].slice(0, 200);
  const boundedDays = Math.max(1, Math.min(90, days || 90));
  const fromDate = daysAgoTaipei(boundedDays);
  const counts: SimonsRecommendationCounts = {};
  uniqueCoids.forEach(coid => { counts[coid] = 0; });

  if (uniqueCoids.length === 0) {
    return { days: boundedDays, fromDate, counts };
  }

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { days: boundedDays, fromDate, counts };
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('simons_daily_snapshots')
    .select('coid')
    .in('coid', uniqueCoids)
    .gte('snapshot_date', fromDate);

  if (error) {
    console.warn('getSimonsRecommendationCounts error:', error.message);
    return { days: boundedDays, fromDate, counts };
  }

  for (const row of data || []) {
    const coid = String((row as { coid?: unknown }).coid || '');
    if (!coid) continue;
    counts[coid] = (counts[coid] || 0) + 1;
  }

  return { days: boundedDays, fromDate, counts };
}

function getActiveEtfSignal(score: number): ActiveEtfRadarItem['signal'] {
  if (score >= 68) return 'bullish';
  if (score >= 52) return 'watch';
  if (score <= 35) return 'bearish';
  return 'neutral';
}

function buildActiveEtfRadarItem(coid: string, rows: any[], days: number, fromDate: string): ActiveEtfRadarItem {
  let stockName: string | null = null;
  let latestDate: string | null = null;
  let addedEtfCount = 0;
  let increasedEtfCount = 0;
  let decreasedEtfCount = 0;
  let removedEtfCount = 0;
  let netWeightChangePct = 0;
  const latestByEtf = new Map<string, ActiveEtfRadarItem['etfs'][number]>();
  const activeHoldingEtfs = new Set<string>();

  const sortedRows = [...rows].sort((a, b) => String(a.flow_date || '').localeCompare(String(b.flow_date || '')));
  for (const row of sortedRows) {
    const action = normalizeActiveEtfAction(row.action);
    const etfCode = String(row.etf_code || '').trim();
    if (!etfCode) continue;
    const flowDate = String(row.flow_date || '');
    if (flowDate && (!latestDate || flowDate > latestDate)) latestDate = flowDate;
    if (!stockName && row.stkname) stockName = String(row.stkname);

    const weightChangePct = parseNumericOrNull(row.weight_change_pct);
    const weightPct = parseNumericOrNull(row.weight_pct);
    const previousWeightPct = parseNumericOrNull(row.previous_weight_pct);
    const shares = parseNumericOrNull(row.shares);
    const previousShares = parseNumericOrNull(row.previous_shares);
    const shareChange = parseNumericOrNull(row.share_change);
    if (weightChangePct !== null) netWeightChangePct += weightChangePct;

    if (action === 'added') addedEtfCount += 1;
    if (action === 'increased') increasedEtfCount += 1;
    if (action === 'decreased') decreasedEtfCount += 1;
    if (action === 'removed') removedEtfCount += 1;

    if (action === 'removed') activeHoldingEtfs.delete(etfCode);
    else activeHoldingEtfs.add(etfCode);

    latestByEtf.set(etfCode, {
      etfCode,
      etfName: String(row.etf_name || etfCode),
      action,
      weightPct,
      previousWeightPct,
      weightChangePct,
      shares,
      previousShares,
      shareChange,
    });
  }

  const rawScore = 50
    + addedEtfCount * 16
    + increasedEtfCount * 8
    - decreasedEtfCount * 7
    - removedEtfCount * 16
    + netWeightChangePct * 10
    + activeHoldingEtfs.size * 2;
  const score = Math.round(clampMarketValue(rawScore, 0, 100));
  const etfs = [...latestByEtf.values()]
    .sort((a, b) => {
      const priority: Record<ActiveEtfAction, number> = { added: 5, increased: 4, held: 3, decreased: 2, removed: 1 };
      return priority[b.action] - priority[a.action];
    })
    .slice(0, 8);

  return {
    coid,
    stockName,
    signal: getActiveEtfSignal(score),
    score,
    days,
    fromDate,
    latestDate,
    holdingEtfCount: activeHoldingEtfs.size,
    addedEtfCount,
    increasedEtfCount,
    decreasedEtfCount,
    removedEtfCount,
    netWeightChangePct: Number(netWeightChangePct.toFixed(3)),
    etfs,
    source: 'active_etf_stock_flows',
  };
}

async function getActiveEtfRadar(coids: string[], days: number): Promise<{
  days: number;
  fromDate: string;
  items: Record<string, ActiveEtfRadarItem>;
  source: string;
}> {
  const uniqueCoids = [...new Set(coids.map(coid => coid.trim()).filter(coid => /^\d{4,6}$/.test(coid)))].slice(0, 200);
  const boundedDays = Math.max(1, Math.min(20, days || 5));
  const fromDate = daysAgoTaipei(boundedDays);
  const items: Record<string, ActiveEtfRadarItem> = {};

  if (uniqueCoids.length === 0) return { days: boundedDays, fromDate, items, source: 'active_etf_stock_flows' };

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { days: boundedDays, fromDate, items, source: 'active_etf_stock_flows' };

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('active_etf_stock_flows')
    .select('flow_date,etf_code,etf_name,coid,stkname,action,weight_pct,previous_weight_pct,weight_change_pct,shares,previous_shares,share_change')
    .in('coid', uniqueCoids)
    .gte('flow_date', fromDate)
    .order('flow_date', { ascending: false });

  if (error) {
    console.warn('getActiveEtfRadar error:', error.message);
    return { days: boundedDays, fromDate, items, source: 'active_etf_stock_flows' };
  }

  const rowsByCoid = new Map<string, any[]>();
  for (const row of data || []) {
    const coid = String((row as { coid?: unknown }).coid || '');
    if (!coid) continue;
    const rows = rowsByCoid.get(coid) || [];
    rows.push(row);
    rowsByCoid.set(coid, rows);
  }

  for (const coid of uniqueCoids) {
    const rows = rowsByCoid.get(coid) || [];
    if (rows.length > 0) items[coid] = buildActiveEtfRadarItem(coid, rows, boundedDays, fromDate);
  }

  return { days: boundedDays, fromDate, items, source: 'active_etf_stock_flows' };
}

function buildMomentumPoints(firstZone: IFAlgoIndexFirstZoneData): MarketMomentumPoint[] {
  const dates = firstZone.forcastMonthlyDateList ?? [];
  const momentum = firstZone.currencyList ?? [];
  const taiex = firstZone.forcastMonthlyList ?? [];
  return dates.map((date, index) => ({
    label: String(date || '').slice(0, 7).replace('-', '/'),
    moneyMomentum: parseMarketNumber(momentum[index]),
    taiex: parseMarketNumber(taiex[index]),
  })).filter(point => point.label && Number.isFinite(point.moneyMomentum) && point.taiex > 0);
}

function buildMarginPoints(firstZone: IFAlgoIndexFirstZoneData): MarginMaintenancePoint[] {
  return (firstZone.imrsetList ?? []).map(row => ({
    label: String(row.mdate || '').replace(/-/g, '/'),
    rate: parseMarketNumber(row.lmrToday),
  })).filter(point => point.label && point.rate > 0);
}

function calculateMarketMood(points: MarketMomentumPoint[], macroScore: number, monthlyScore: number, monthlyLabel: string, dailyScore: number, marginRate: number, safeLine: number) {
  const latest = points[points.length - 1] ?? { label: '', moneyMomentum: -0.8, taiex: 0 };
  const previous = points[points.length - 2] ?? latest;
  const dailyNormalized = clampMarketValue((dailyScore / 8) * 100, 0, 100);
  const taiexChangePct = previous.taiex > 0 ? ((latest.taiex - previous.taiex) / previous.taiex) * 100 : 0;
  const marginGap = marginRate - safeLine;
  const isMonthlyBullish = monthlyLabel.includes('偏多') || (macroScore >= 70 && monthlyScore >= 70);
  const isMonthlyBearish = monthlyLabel.includes('偏空');
  const isDailyHot = dailyNormalized >= 72;
  const isDailyWeak = dailyNormalized <= 40;
  const isIndexRunning = taiexChangePct >= 4;
  const isMarginVeryLoose = marginGap >= 24;
  const isMarginSafe = marginGap >= 8;
  const isMarginTight = marginGap < 4;
  let primary: MoodLabel = '冷靜';
  let reason = '原始訊號沒有明顯偏熱或偏多，先以冷靜觀察為主。';

  if (isMarginTight || (isMonthlyBearish && isDailyWeak && marginGap < 24)) {
    primary = '冷靜';
    reason = isMarginTight
      ? `融資維持率 ${marginRate.toFixed(2)}% 接近安全線 ${safeLine.toFixed(2)}%，槓桿安全距離不夠，今日氛圍偏冷靜。`
      : `AI 月預測為${monthlyLabel || '偏弱'}、AI 日預測 ${dailyScore}/8 偏低，短線與中期訊號不夠一致，今日氛圍偏冷靜。`;
  } else if (isDailyHot && (isMonthlyBearish || macroScore < 70 || (!isMonthlyBullish && isIndexRunning))) {
    primary = '貪婪';
    reason = `AI 日預測 ${dailyScore}/8 偏熱，且月線或總體訊號沒有完全同步偏多，代表短線追價情緒較明顯。`;
  } else if (isMonthlyBullish && isMarginVeryLoose) {
    primary = '放鬆';
    reason = `AI 月預測為${monthlyLabel || '偏多'}，且融資維持率 ${marginRate.toFixed(2)}% 明顯高於安全線 ${safeLine.toFixed(2)}%，槓桿壓力較低，今日氛圍偏放鬆。`;
  } else if (isMonthlyBullish || isMarginSafe || macroScore >= 70) {
    primary = '樂觀';
    reason = `AI 月預測為${monthlyLabel || '觀察中'}，市場方向偏正面但沒有判定為短線過熱。`;
  }

  const descriptions: Record<MoodLabel, string> = {
    貪婪: '短線追價情緒明顯，通常來自 AI 日預測偏熱，但中期或總體訊號沒有完全同步。',
    樂觀: '中期方向偏正面，市場方向不差，但尚未判斷為過熱追價或壓力完全放鬆。',
    放鬆: 'AI 月預測偏多且融資維持率明顯高於安全線，槓桿壓力較低。',
    冷靜: 'AI 日預測偏低、月線偏空或融資安全距離不足時，適合降低追價衝動。',
  };
  const labels: MoodLabel[] = ['貪婪', '樂觀', '放鬆', '冷靜'];
  return {
    primary,
    reason,
    indicators: labels.map(label => ({ label, active: label === primary, description: descriptions[label] })),
  };
}

function buildRuleBasedConclusion(summary: any) {
  const dailyPct = Math.round((summary.dailyPrediction.score / summary.dailyPrediction.maxScore) * 100);
  const monthlyText = summary.monthlyPrediction?.label
    ? summary.monthlyPrediction.label
    : `${summary.monthlyPrediction.score} 分`;
  return {
    title: `今天市場氛圍：${summary.marketMood.primary}`,
    summary: `依今日原始數據判斷，市場氛圍四選一為「${summary.marketMood.primary}」。月預測 ${monthlyText}、日預測約 ${dailyPct} 分，融資維持率 ${summary.marginMaintenance.todayRate.toFixed(2)}%，${summary.marketMood.reason}`,
    actionTone: summary.marketMood.primary === '貪婪'
      ? '市場追價感較強，解讀時要特別避免把偏熱訊號當成無風險上漲。'
      : summary.marketMood.primary === '樂觀'
        ? '中期方向偏正面，可以觀察趨勢延續，但仍要留意追價風險。'
        : summary.marketMood.primary === '放鬆'
          ? '槓桿壓力相對不緊繃，今天可以用較穩定的心態觀察市場。'
          : '訊號較不一致或風險需要觀察，先降低衝動，等待更清楚的方向。',
    keyPoints: [
      `今日氛圍只選一個：${summary.marketMood.primary}。`,
      summary.marketMood.reason,
      `融資維持率今日 ${summary.marginMaintenance.todayRate.toFixed(2)}%，安全線 ${summary.marginMaintenance.safeLine.toFixed(2)}%。`,
    ],
    generatedAt: new Date().toISOString(),
    source: 'rules',
  };
}

async function generateAiConclusion(summary: any) {
  const openaiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
  if (!openaiKey) return null;
  const visibleSummary = {
    ...summary,
    macroScore: undefined,
    monthlyPrediction: {
      label: summary.monthlyPrediction?.label,
      directionScore: summary.monthlyPrediction?.directionScore,
      forecast: summary.monthlyPrediction?.forecast,
    },
  };
  const prompt = `你是 PPBears App 的台股市場解說助手，讀者包含小朋友和家長。請只回傳 JSON，不要 markdown。

請根據首頁市場數字，產生今天市場狀況的綜合結論。不要給個股買賣指令，不要保證漲跌。市場情緒只能四選一：貪婪、樂觀、放鬆、冷靜。不要把四個情緒都列成分數。

輸出格式：
{
  "title": "18字以內標題",
  "summary": "90到150字，白話說明今天市場狀況",
  "actionTone": "40到80字，說明今天操作心態",
  "keyPoints": ["重點1", "重點2", "重點3"]
}

資料：
${JSON.stringify(visibleSummary, null, 2)}`;
  try {
    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.35,
      }),
    }, 15000);
    if (!response.ok) return null;
    const data = await response.json() as any;
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
    if (!parsed?.title || !parsed?.summary || !Array.isArray(parsed?.keyPoints)) return null;
    return {
      title: String(parsed.title).slice(0, 80),
      summary: String(parsed.summary).replace(/\s+/g, ' ').trim().slice(0, 260),
      actionTone: String(parsed.actionTone || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      keyPoints: parsed.keyPoints.slice(0, 4).map((point: unknown) => String(point).replace(/\s+/g, ' ').trim().slice(0, 140)),
      generatedAt: new Date().toISOString(),
      source: 'ai',
    };
  } catch {
    return null;
  }
}

async function buildHomeSummary() {
  const response = await fetchWithTimeout(`${IFALGO_BASE}/index/firstZoneData`, {}, 12000);
  if (!response.ok) return null;
  const json = await response.json() as any;
  const firstZone = json?.data?.first as IFAlgoIndexFirstZoneData | null;
  if (!firstZone) return null;
  const monthly = firstZone.lastForecastMonthly ?? firstZone.lastForcastMonthly;
  const monthlyScore = Math.round(clampMarketValue(parseMarketNumber(monthly?.conv1), 0, 100)) || 50;
  const monthlyForecast = parseMonthlyForecast(monthly?.mforecast);
  const dailyScore = Math.round(clampMarketValue(parseMarketNumber(firstZone.lastPtsTw?.pts), 0, 8)) || 4;
  const monthDate = String(monthly?.mdate || firstZone.lastPtsTw?.mdate || '');
  const month = /^\d{4}-\d{2}-\d{2}$/.test(monthDate)
    ? Number(monthDate.slice(5, 7))
    : new Date(Date.now() + TAIPEI_OFFSET_MS).getUTCMonth() + 1;
  const monthlyLabel = monthly?.longshort || (monthlyScore >= 70 ? '偏多' : monthlyScore >= 55 ? '穩健' : monthlyScore >= 40 ? '觀望' : '偏弱');
  const points = buildMomentumPoints(firstZone);
  const marginPoints = buildMarginPoints(firstZone);
  const todayRate = parseMarketNumber(firstZone.lastImrset?.lmrToday);
  const safeLine = parseMarketNumber(firstZone.lastImrset?.boundary) || 151.4;
  const marginRates = marginPoints.map(point => point.rate).filter(rate => rate > 0);
  if (points.length === 0 || marginPoints.length === 0 || todayRate <= 0) return null;
  const summary: any = {
    updateDate: firstZone.lastPtsTw?.mdate || firstZone.lastImrset?.mdate || todayTaipei(),
    monthLabel: `${month}月`,
    macroScore: monthlyScore,
    monthlyPrediction: {
      score: monthlyScore,
      label: monthlyLabel,
      directionScore: getMonthlyDirectionScore(monthlyLabel, monthlyForecast, monthlyScore),
      rawScore: monthlyScore,
      forecast: monthlyForecast,
    },
    dailyPrediction: { score: dailyScore, maxScore: 8 },
    marketFundMomentum: { points, momentumRange: [-1.5, 0], taiexRange: [2000, 48000] },
    marginMaintenance: {
      points: marginPoints,
      todayRate,
      safeLine,
      minLine: Math.min(...marginRates, 146.3),
      unit: '%',
    },
  };
  summary.marketMood = calculateMarketMood(points, monthlyScore, monthlyScore, monthlyLabel, dailyScore, todayRate, safeLine);
  summary.aiConclusion = await generateAiConclusion(summary) || buildRuleBasedConclusion(summary);
  return summary;
}

function getBaseUrl(req: VercelRequest): string {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

async function warmUrl(url: string) {
  try {
    const cronSecret = process.env.CRON_SECRET || '';
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
      },
    });
    return { url, ok: response.ok, status: response.status };
  } catch (error) {
    return { url, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getUserStockCodes(limit = 80): Promise<string[]> {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [];
  const supabase = createClient(url, key);
  const [holdingsResult, watchlistResult] = await Promise.all([
    supabase.from('holdings').select('stock_code').limit(300),
    supabase.from('watchlist').select('stock_code').limit(300),
  ]);
  return [...new Set([
    ...(holdingsResult.data || []).map(row => String(row.stock_code || '')).filter(Boolean),
    ...(watchlistResult.data || []).map(row => String(row.stock_code || '')).filter(Boolean),
  ])].slice(0, limit);
}

async function warmInBatches(baseUrl: string, coids: string[], batchSize = 8) {
  const results: Awaited<ReturnType<typeof warmUrl>>[] = [];
  for (let i = 0; i < coids.length; i += batchSize) {
    const batch = coids.slice(i, i + batchSize);
    results.push(...await Promise.all(batch.map(coid => warmUrl(`${baseUrl}/api/app-cache?type=stock-quant-snapshot&coid=${encodeURIComponent(coid)}`))));
  }
  return results;
}

async function handleWarmup(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const baseUrl = getBaseUrl(req);
  const today = getTodayTW();
  const targetDate = getLatestCompletedTradingDateTW();
  const existing = await loadTodayCache(today);
  const existingReady = Boolean(existing?.all_stocks?.length && isSimonsDataReadyForDate(existing.all_stocks, targetDate));
  const fetchedItems = existingReady ? [] : await fetchSimonsDataForDate(targetDate);
  const fetchedReady = isSimonsDataReadyForDate(fetchedItems, targetDate);
  const simonsItems = existingReady ? existing!.all_stocks : fetchedReady ? fetchedItems : [];
  if (!existingReady && fetchedReady) {
    await saveTodayCache({ cache_date: today, all_stocks: simonsItems, ai_filtered: existing?.ai_filtered || [] });
  }

  const warmResults = await Promise.all([
    warmUrl(`${baseUrl}/api/app-cache?type=home-summary`),
    warmUrl(`${baseUrl}/api/app-cache?type=simons`),
  ]);
  const stockCodes = simonsItems.length > 0 ? [...new Set([
    ...simonsItems.map(item => String(item.coid)).filter(Boolean).slice(0, 60),
    ...await getUserStockCodes(80),
  ])].slice(0, 120) : [];
  const stockWarmResults = stockCodes.length > 0 ? await warmInBatches(baseUrl, stockCodes) : [];
  const userMarketWarmup = await buildAndSaveUserMarketCaches(req).catch(error => ({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }));

  return res.status(200).json({
    success: true,
    date: today,
    targetDate,
    simonsStatus: simonsItems.length > 0 ? 'ready' : 'waiting-simons',
    stockCount: stockCodes.length,
    coreWarm: `${warmResults.filter(r => r.ok).length}/${warmResults.length}`,
    stockWarm: `${stockWarmResults.filter(r => r.ok).length}/${stockWarmResults.length}`,
    userMarketWarmup,
    failed: stockWarmResults.filter(r => !r.ok).slice(0, 10),
  });
}

async function handleUserMarketCache(req: VercelRequest, res: VercelResponse) {
  const surface = String(req.query.surface || '').trim();
  if (surface !== 'watchlist' && surface !== 'portfolio') return res.status(400).json({ error: 'Invalid surface' });

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: '請先登入會員帳號' });

  const supabase = getAdminClient();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return res.status(401).json({ error: '登入狀態已失效，請重新登入' });

  const { data, error } = await supabase
    .from('user_market_daily_cache')
    .select('cache_date,user_id,surface,signature,payload,status,data_date,generated_at,stale_reason')
    .eq('cache_date', todayTaipei())
    .eq('user_id', authData.user.id)
    .eq('surface', surface)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'cache miss' });

  res.setHeader('Cache-Control', 'private, max-age=60');
  return res.status(200).json({ cache: data });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const type = String(req.query.type || 'warmup');

  if (type === 'institution-cost') {
    return handleInstitutionCost(req, res);
  }

  try {
    if (type === 'warmup') return await handleWarmup(req, res);
    if (type === 'user-market-cache') return await handleUserMarketCache(req, res);
    if (type === 'ifalgo-stock') {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      const coid = String(req.query.coid || '').trim();
      return res.status(200).json(await getSanitizedIfalgoStock(coid));
    }

    if (type === 'stock-trading-signals') {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      const access = await requireStockSignalFeature(req);
      if (access.ok === false) return res.status(access.status).json({ error: access.error });
      const coid = String(req.query.coid || '').trim();
      return res.status(200).json(await getStockTradingSignals(coid));
    }

    if (type === 'stock-quant') {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      const access = await requireStockSignalFeature(req);
      if (access.ok === false) return res.status(access.status).json({ error: access.error });
      const coid = String(req.query.coid || '').trim();
      const sinceDate = typeof req.query.sinceDate === 'string' ? req.query.sinceDate : undefined;
      const forceFresh = Boolean(req.query.fresh);
      const data = await getStockQuantPayload(coid, sinceDate, forceFresh);
      return res.status(200).json({
        data,
        source: data.meta?.source || 'ifalgo-live',
        dataDate: data.meta?.dataDate,
        fetchedAt: data.meta?.fetchedAt,
        fixedUpdateTime: data.meta?.fixedUpdateTime,
        generatedAt: new Date().toISOString(),
      });
    }

    if (type === 'stock-quant-history') {
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
      const coid = String(req.query.coid || '').trim();
      const days = parseInt(String(req.query.days || '60'), 10) || 60;
      if (!/^\d{4,6}$/.test(coid)) return res.status(400).json({ error: 'Invalid coid' });
      return res.status(200).json(await getStockQuantHistory(coid, days));
    }

    if (type === 'simons-rec-counts') {
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
      const days = parseInt(String(req.query.days || '90'), 10) || 90;
      const coids = String(req.query.coids || '')
        .split(',')
        .map(coid => coid.trim())
        .filter(Boolean);
      return res.status(200).json(await getSimonsRecommendationCounts(coids, days));
    }

    if (type === 'active-etf-radar') {
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
      const days = parseInt(String(req.query.days || '5'), 10) || 5;
      const coids = String(req.query.coids || '')
        .split(',')
        .map(coid => coid.trim())
        .filter(Boolean);
      return res.status(200).json(await getActiveEtfRadar(coids, days));
    }

    if (type === 'simons-institution-cost') {
      res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
      const coid = String(req.query.coid || '').trim();
      const days = parseInt(String(req.query.days || '90'), 10) || 90;
      if (!/^\d{4,6}$/.test(coid)) return res.status(400).json({ error: 'Invalid coid' });
      return res.status(200).json(await getSimonsInstitutionCostPayload(coid, days));
    }

    if (type === 'stock-quant-snapshot') {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      const access = await requireStockSignalFeature(req);
      if (access.ok === false) return res.status(access.status).json({ error: access.error });
      const coid = String(req.query.coid || '').trim();
      const stockName = typeof req.query.stockName === 'string' ? req.query.stockName.trim() : undefined;
      const allowCurrentDate = Boolean(req.query.manual || req.query.fresh || req.query.current);
      if (!/^\d{4,6}$/.test(coid)) return res.status(400).json({ error: 'Invalid coid' });
      return res.status(200).json(await persistStockQuantSnapshot(coid, stockName, { allowCurrentDate }));
    }

    if (type === 'ai-cache-version') {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.status(200).json(await getDailyAiCacheVersion());
    }

    const shouldUpdateSharedDailyCache = Boolean(req.query.manual || req.query.fresh || req.query.current);
    const shouldBypassDailyCacheHeaders = shouldUpdateSharedDailyCache || Boolean(req.query.read || req.query.sync);
    if (shouldBypassDailyCacheHeaders) {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
    } else {
      setDailyCacheHeaders(res);
    }
    if (type === 'home-summary') {
      const summary = await buildHomeSummary();
      if (!summary) {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        return res.status(503).json({ error: 'market summary unavailable' });
      }
      return res.status(200).json({ summary, source: 'ifalgo-cloud-cache', generatedAt: new Date().toISOString() });
    }
    if (type === 'simons') return res.status(200).json(await getSimonsPayload({ allowCurrentDate: shouldUpdateSharedDailyCache }));
    if (type === 'official-prices') {
      const prices = await getOfficialPrices();
      return res.status(200).json({ cacheDate: getTodayTW(), count: Object.keys(prices).length, prices });
    }

    return res.status(400).json({ error: 'Unknown cache type' });
  } catch (error) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=300');
    return res.status(200).json({
      error: error instanceof Error ? error.message : String(error),
      data: type === 'stock-quant' ? emptyQuantData() : undefined,
      items: type === 'simons' ? [] : undefined,
      prices: type === 'official-prices' ? {} : undefined,
    });
  }
}
