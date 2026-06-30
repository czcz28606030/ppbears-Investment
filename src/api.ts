import type { StockData, SimonsItem, StockQuote, StockRecommendation, AIAdvice, StockLiveAnalysis, StockTradingSignal } from './types';
import { supabase } from './supabase';

const IFALGO_BASE = '/api/ifalgo';
const DAILY_CACHE_TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function getMillisecondsUntilNextTaipeiHour(hour: number): number {
  const taipei = new Date(Date.now() + DAILY_CACHE_TAIPEI_OFFSET_MS);
  let next = Date.UTC(
    taipei.getUTCFullYear(),
    taipei.getUTCMonth(),
    taipei.getUTCDate(),
    hour,
    0,
    0,
    0
  );
  if (taipei.getTime() >= next) {
    next += 24 * 60 * 60 * 1000;
  }
  return Math.max(5 * 60 * 1000, next - DAILY_CACHE_TAIPEI_OFFSET_MS - Date.now());
}

// ── 每日快取工具（key 帶日期，隔天自動過期）────────────────────────────────────
function _todayStr(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
function getDailyCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: { date: string; data: T } = JSON.parse(raw);
    if (parsed.date !== _todayStr()) { localStorage.removeItem(key); return null; }
    return parsed.data;
  } catch { return null; }
}
function setDailyCache<T>(key: string, data: T): void {
  try { localStorage.setItem(key, JSON.stringify({ date: _todayStr(), data })); } catch {}
}

// ── TTL 短效快取工具（適合盤中訊號，避免全天使用過期資料）──────────────────────
// 使用 expiry timestamp，可設定任意毫秒 TTL
function getTTLCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: { expiry: number; data: T } = JSON.parse(raw);
    if (Date.now() > parsed.expiry) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch { return null; }
}
function setTTLCache<T>(key: string, data: T, ttlMs: number): void {
  try {
    localStorage.setItem(key, JSON.stringify({ expiry: Date.now() + ttlMs, data }));
  } catch {}
}
/** 清除指定 key 的 TTL 快取（手動強制刷新用） */
export function clearTTLCache(key: string): void {
  try { localStorage.removeItem(key); } catch {}
}

/** 清除所有本機量化訊號 TTL 快取，避免手動刷新時仍吃到舊瀏覽器暫存。 */
export function clearQuantSignalTTLCache(): void {
  try {
    const keys = Object.keys(localStorage).filter(key => key.startsWith('ppbears_quant30_'));
    keys.forEach(key => localStorage.removeItem(key));
  } catch {}
}

/** 清除 Simons 每日推薦 TTL 快取，手動刷新後需重新讀雲端每日快取。 */
export function clearSimonsDataTTLCache(): void {
  try {
    const keys = Object.keys(localStorage).filter(key => key.startsWith('ppbears_simons_daily7_'));
    keys.forEach(key => localStorage.removeItem(key));
  } catch {}
}
/** 取得剩餘 TTL 秒數（0 = 已過期或不存在） */
export function getTTLRemaining(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const parsed: { expiry: number } = JSON.parse(raw);
    return Math.max(0, Math.round((parsed.expiry - Date.now()) / 1000));
  } catch { return 0; }
}

// 量化訊號快取 TTL：30 分鐘（盤中最多延遲 30 分鐘，避免錯過買賣訊號）
const QUANT_SIGNAL_TTL_MS = 30 * 60 * 1000;
const QUANT_SIGNAL_CACHE_VERSION = 'v4';
// Simons 每日推薦由雲端每日 08:00 預抓；本機保存到隔天早上 10 點，手動刷新可再檢查一次。
const getSimonsDataTtlMs = () => getMillisecondsUntilNextTaipeiHour(10);
const OFFICIAL_PRICE_MAP_CACHE_KEY = 'ppbears_official_price_map_daily_7am_v2';
const AI_SYNC_LABEL = '08:00 自動檢查；可手動重新抓取';
const AI_SYNC_SCHEDULE_LABEL = 'AI訊號每日 08:00 檢查 Simons 完成狀態；手動重新抓取可再檢查一次';

export function clearOfficialPriceMapCache(): void {
  clearTTLCache(OFFICIAL_PRICE_MAP_CACHE_KEY);
}

export type DailyAiCacheRefreshResult = {
  simonsStatus: 'ready' | 'waiting-simons' | 'unknown';
  targetDate?: string;
  dataDate?: string;
  source?: string;
  snapshotOk: number;
  snapshotTotal: number;
};

export type DailyAiCacheVersion = {
  cacheDate: string;
  dataDate: string;
  updatedAt: string;
  itemCount: number;
  status: 'ready' | 'empty';
  version: string;
  generatedAt: string;
};

export type UserMarketCacheSurface = 'watchlist' | 'portfolio';

export type UserMarketDailyCache<T = unknown> = {
  cache_date: string;
  user_id: string;
  surface: UserMarketCacheSurface;
  signature: string;
  payload: T;
  status: 'ready' | 'partial' | 'waiting-simons' | 'empty';
  data_date: string | null;
  generated_at: string;
  stale_reason: string | null;
};

const DAILY_AI_CACHE_VERSION_KEY = 'ppbears_daily_ai_cache_version_v1';
const DAILY_AI_CACHE_GLOBAL_SURFACE = 'global';

function toDailyAiVersionToken(version: string | null | undefined): string {
  if (!version) return 'unversioned';
  return version.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
}

function getDailyAiCacheVersionToken(): string {
  return toDailyAiVersionToken(getKnownDailyAiCacheVersion(DAILY_AI_CACHE_GLOBAL_SURFACE));
}

export async function fetchDailyAiCacheVersion(): Promise<DailyAiCacheVersion | null> {
  try {
    const res = await fetch(`/api/app-cache?type=ai-cache-version&t=${Date.now()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.version || data?.status !== 'ready') return null;
    return data as DailyAiCacheVersion;
  } catch {
    return null;
  }
}

export function getKnownDailyAiCacheVersion(surface = DAILY_AI_CACHE_GLOBAL_SURFACE): string | null {
  try {
    const surfaceVersion = localStorage.getItem(`${DAILY_AI_CACHE_VERSION_KEY}_${surface}`);
    if (surfaceVersion) return surfaceVersion;
    if (surface !== DAILY_AI_CACHE_GLOBAL_SURFACE) {
      return localStorage.getItem(`${DAILY_AI_CACHE_VERSION_KEY}_${DAILY_AI_CACHE_GLOBAL_SURFACE}`);
    }
    return null;
  } catch {
    return null;
  }
}

export function rememberDailyAiCacheVersion(version: string, surface = DAILY_AI_CACHE_GLOBAL_SURFACE): void {
  try {
    localStorage.setItem(`${DAILY_AI_CACHE_VERSION_KEY}_${DAILY_AI_CACHE_GLOBAL_SURFACE}`, version);
    localStorage.setItem(`${DAILY_AI_CACHE_VERSION_KEY}_${surface}`, version);
  } catch {}
}

export async function ensureDailyAiCacheVersion(surface = DAILY_AI_CACHE_GLOBAL_SURFACE, forceFetch = false): Promise<string | null> {
  if (!forceFetch) {
    const known = getKnownDailyAiCacheVersion(surface);
    if (known) return known;
  }
  const latest = await fetchDailyAiCacheVersion();
  if (latest?.version) {
    rememberDailyAiCacheVersion(latest.version, surface);
    return latest.version;
  }
  return getKnownDailyAiCacheVersion(surface);
}

export async function fetchUserMarketDailyCache<T>(surface: UserMarketCacheSurface): Promise<UserMarketDailyCache<T> | null> {
  try {
    const sessionResult = supabase ? await supabase.auth.getSession().catch(() => null) : null;
    const token = sessionResult?.data.session?.access_token;
    if (!token) return null;
    const params = new URLSearchParams({ type: 'user-market-cache', surface, t: String(Date.now()) });
    const res = await fetch(`/api/app-cache?${params.toString()}`, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.cache || null;
  } catch {
    return null;
  }
}

export async function refreshDailyAiCache(stockCodes: string[] = []): Promise<DailyAiCacheRefreshResult> {
  const uniqueCodes = [...new Set(stockCodes.map(code => String(code || '').trim()).filter(code => /^\d{4,6}$/.test(code)))].slice(0, 80);
  const result: DailyAiCacheRefreshResult = {
    simonsStatus: 'unknown',
    snapshotOk: 0,
    snapshotTotal: uniqueCodes.length,
  };

  try {
    const simonsRes = await fetch(`/api/app-cache?type=simons&manual=${Date.now()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (simonsRes.ok) {
      const payload = await simonsRes.json();
      result.simonsStatus = payload?.status === 'ready' ? 'ready' : payload?.status === 'waiting-simons' ? 'waiting-simons' : 'unknown';
      result.targetDate = payload?.targetDate;
      result.dataDate = payload?.dataDate;
      result.source = payload?.source;
    }
  } catch (err) {
    console.error('refreshDailyAiCache simons check failed:', err);
  }

  if (result.simonsStatus !== 'ready' || uniqueCodes.length === 0) {
    return result;
  }

  const sessionResult = supabase ? await supabase.auth.getSession().catch(() => null) : null;
  const token = sessionResult?.data.session?.access_token;
  const responses = await Promise.all(uniqueCodes.map(async code => {
    try {
      const res = await fetch(`/api/app-cache?type=stock-quant-snapshot&coid=${encodeURIComponent(code)}&manual=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) return false;
      const payload = await res.json();
      return Boolean(payload?.saved || payload?.skipped || payload?.data?.meta);
    } catch {
      return false;
    }
  }));
  result.snapshotOk = responses.filter(Boolean).length;
  return result;
}

// TWSE OpenAPI Base
const TWSE_BASE = '/api/twse';

// TWSE 即時行情資料 (毎交易日更新)
export interface TWSTEStockQuote {
  Code: string;
  Name: string;
  ClosingPrice: string;
  Change: string;
  OpeningPrice: string;
  HighestPrice: string;
  LowestPrice: string;
  TradeVolume: string;
  Transaction: string;
  Date: string;
}

// ── TPEX 上櫃資料 ─────────────────────────────────────────────────────────────
export interface TPEXStockQuote {
  SecuritiesCompanyCode: string;
  CompanyName: string;
  Close: string;
  Change: string;
  Open: string;
  High: string;
  Low: string;
  Average: string;
  TradingShares: string;    // 成交股數
  TransactionAmount: string; // 成交金額
  TransactionNumber: string; // 成交筆數
  Date?: string;             // 民國7碼 e.g. "1150414"
  LatestBidPrice?: string;
  LatesAskPrice?: string;
  Capitals?: string;
  NextReferencePrice?: string;
  NextLimitUp?: string;
  NextLimitDown?: string;
}

export type OfficialPriceMapEntry = {
  close: string;
  change: string;
  name: string;
  volume: number;
  date: string;
  market?: 'listed' | 'otc';
};

export type OfficialPriceMap = Record<string, OfficialPriceMapEntry>;

const TPEX_BASE = '/api/tpex';

let tpexCache: TPEXStockQuote[] | null = null;
let tpexCacheDate: string | null = null;

export async function fetchTPEXAllStocks(): Promise<TPEXStockQuote[]> {
  try {
    const today = new Date().toISOString().split('T')[0];
    if (tpexCache && tpexCacheDate === today) return tpexCache;
    const url = `${TPEX_BASE}/tpex_mainboard_daily_close_quotes`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`TPEX API error: ${res.status}`);
    const data: TPEXStockQuote[] = await res.json();
    tpexCache = data;
    tpexCacheDate = today;
    return data;
  } catch (err) {
    console.error('fetchTPEXAllStocks error:', err);
    return [];
  }
}

// 快取 TWSE 全市場資料（避免重複請求）
let twseCache: TWSTEStockQuote[] | null = null;
let twseCacheDate: string | null = null;

export async function fetchTWSEAllStocks(): Promise<TWSTEStockQuote[]> {
  try {
    const today = new Date().toISOString().split('T')[0];
    // 使用快取（同一天同一個執行期間只抓一次）
    if (twseCache && twseCacheDate === today) {
      return twseCache;
    }
    const url = `${TWSE_BASE}/exchangeReport/STOCK_DAY_ALL`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`TWSE API error: ${res.status}`);
    const data: TWSTEStockQuote[] = await res.json();
    twseCache = data;
    twseCacheDate = today;
    return data;
  } catch (err) {
    console.error('fetchTWSEAllStocks error:', err);
    return [];
  }
}

export async function fetchOfficialPriceMap(): Promise<OfficialPriceMap> {
  const cacheKey = OFFICIAL_PRICE_MAP_CACHE_KEY;
  const cached = getTTLCache<OfficialPriceMap>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch('/api/app-cache?type=official-prices');
    if (response.ok) {
      const json = await response.json();
      const prices = json?.prices as OfficialPriceMap | undefined;
      if (prices && Object.keys(prices).length > 0) {
        setTTLCache(cacheKey, prices, getMillisecondsUntilNextTaipeiHour(7));
        return prices;
      }
    }
  } catch {
    // Local/offline fallback below.
  }

  const [twseAll, tpexAll] = await Promise.all([fetchTWSEAllStocks(), fetchTPEXAllStocks()]);
  const map: OfficialPriceMap = {};

  for (const s of twseAll) {
    if (s.ClosingPrice) {
      const d = s.Date || '';
      const date = d.length === 7
        ? `${parseInt(d.slice(0, 3), 10) + 1911}${d.slice(3)}`
        : d.replace(/-/g, '');
      map[s.Code] = {
        close: s.ClosingPrice,
        change: s.Change,
        name: s.Name || '',
        volume: Math.floor(parseInt(s.TradeVolume || '0', 10) / 1000),
        date,
        market: 'listed',
      };
    }
  }

  for (const s of tpexAll) {
    if (s.Close && !map[s.SecuritiesCompanyCode]) {
      const d = s.Date || '';
      const date = d.length === 7
        ? `${parseInt(d.slice(0, 3), 10) + 1911}${d.slice(3)}`
        : d.replace(/-/g, '');
      map[s.SecuritiesCompanyCode] = {
        close: s.Close,
        change: s.Change || '0',
        name: s.CompanyName || '',
        volume: Math.floor(parseInt(s.TradingShares || '0', 10) / 1000),
        date,
        market: 'otc',
      };
    }
  }

  if (Object.keys(map).length > 0) {
    setTTLCache(cacheKey, map, getMillisecondsUntilNextTaipeiHour(7));
  }
  return map;
}

// TWSE 殖利率與本益比資料
export interface TWSEDividendYield {
  Code: string;
  Name: string;
  PEratio: string;
  DividendYield: string;
  PBratio: string;
}

let twseDividendCache: TWSEDividendYield[] | null = null;
let twseDividendCacheDate: string | null = null;

export async function fetchTWSEDividendYields(): Promise<TWSEDividendYield[]> {
  try {
    const today = new Date().toISOString().split('T')[0];
    if (twseDividendCache && twseDividendCacheDate === today) {
      return twseDividendCache;
    }
    const url = `${TWSE_BASE}/exchangeReport/BWIBBU_ALL`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`TWSE API error: ${res.status}`);
    const data: TWSEDividendYield[] = await res.json();
    twseDividendCache = data;
    twseDividendCacheDate = today;
    return data;
  } catch (err) {
    console.error('fetchTWSEDividendYields error:', err);
    return [];
  }
}

// ── 除權息預告資料（TWSE + TPEx）────────────────────────────────────────────────

// 台灣民國年格式 "1150420" → JS Date
function parseTWDate(twDate: string): Date | null {
  if (!twDate || twDate.length < 7) return null;
  const year = parseInt(twDate.substring(0, 3), 10) + 1911;
  const month = parseInt(twDate.substring(3, 5), 10);
  const day = parseInt(twDate.substring(5, 7), 10);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatDateTW(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export interface ExDividendInfo {
  stockCode: string;
  exDateStr: string;           // 除息日 "2026/04/20"
  cashDividend: number;        // 現金股利（元/股）
  estimatedPayDateStr: string; // 預估發放日（除息 +45 天）
}

let exDivCache: Map<string, ExDividendInfo> | null = null;
let exDivCacheDate: string | null = null;

/** 取兩個市場的除權息預告，回傳 stockCode → ExDividendInfo 的 Map */
export async function fetchExDividendCalendar(): Promise<Map<string, ExDividendInfo>> {
  const today = new Date().toISOString().split('T')[0];
  if (exDivCache && exDivCacheDate === today) return exDivCache;

  const map = new Map<string, ExDividendInfo>();

  // ① TWSE 上市股票除權息預告表
  try {
    const res = await fetch('/api/twse/exchangeReport/TWT48U_ALL', { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const items: any[] = await res.json();
      for (const item of items) {
        const cashDiv = parseFloat(item.CashDividend);
        if (!item.CashDividend || isNaN(cashDiv) || cashDiv <= 0) continue;
        const exDate = parseTWDate(item.Date);
        if (!exDate) continue;
        const payDate = new Date(exDate);
        payDate.setDate(payDate.getDate() + 45);
        map.set(item.Code, {
          stockCode: item.Code,
          exDateStr: formatDateTW(exDate),
          cashDividend: cashDiv,
          estimatedPayDateStr: formatDateTW(payDate),
        });
      }
    }
  } catch (e) {
    console.error('TWSE ex-div fetch error:', e);
  }

  // ② TPEx 上櫃股票除權息預告表
  try {
    const res = await fetch('/api/tpex/tpex_exright_prepost', { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const items: any[] = await res.json();
      for (const item of items) {
        const cashDiv = parseFloat(item.CashDividend);
        if (!item.CashDividend || isNaN(cashDiv) || cashDiv <= 0) continue;
        const exDate = parseTWDate(item.ExRrightsExDividendDate);
        if (!exDate) continue;
        const payDate = new Date(exDate);
        payDate.setDate(payDate.getDate() + 45);
        map.set(item.SecuritiesCompanyCode, {
          stockCode: item.SecuritiesCompanyCode,
          exDateStr: formatDateTW(exDate),
          cashDividend: cashDiv,
          estimatedPayDateStr: formatDateTW(payDate),
        });
      }
    }
  } catch (e) {
    console.error('TPEx ex-div fetch error:', e);
  }

  exDivCache = map;
  exDivCacheDate = today;
  return map;
}

// 近10年平均殖利率快取
const yieldHistoryCache: Record<string, number> = {};

/**
 * 抓取個股近10年12月份的殖利率，計算平均值
 * 資料來源：TWSE exchangeReport/BWIBBU（個股月查詢）
 */
export async function fetchStock10YrAvgYield(stockCode: string): Promise<number | null> {
  if (yieldHistoryCache[stockCode] !== undefined) {
    return yieldHistoryCache[stockCode];
  }
  try {
    const TWSE_REPORT_BASE = '/api/twse-report';
    const currentYear = new Date().getFullYear();
    const yearlyYields: number[] = [];

    // 每年抓12月份資料（並行10個請求）
    const requests = Array.from({ length: 10 }, (_, i) => {
      const year = currentYear - 1 - i; // 從去年往前推10年
      const dateStr = `${year}1201`; // YYYYMMDD 西元
      const url = `${TWSE_REPORT_BASE}/BWIBBU?response=json&stockNo=${stockCode}&date=${dateStr}`;
      return fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
    });

    const results = await Promise.all(requests);

    results.forEach(json => {
      if (!json || json.stat !== 'OK' || !json.data || json.data.length === 0) return;
      // 取最後一筆（月底最後一個交易日）
      const lastRow = json.data[json.data.length - 1];
      const yieldVal = parseFloat(lastRow[1]); // index 1 = 殖利率(%)
      if (!isNaN(yieldVal) && yieldVal > 0) {
        yearlyYields.push(yieldVal);
      }
    });

    if (yearlyYields.length === 0) return null;
    const avg = yearlyYields.reduce((a, b) => a + b, 0) / yearlyYields.length;
    yieldHistoryCache[stockCode] = avg;
    return avg;
  } catch (err) {
    console.error('fetchStock10YrAvgYield error:', err);
    return null;
  }
}

// 查詢單一股票的 TWSE 即時收盤價
export async function fetchTWSEStockPrice(code: string): Promise<TWSTEStockQuote | null> {
  const all = await fetchTWSEAllStocks();
  const stock = all.find(s => s.Code === code);
  return stock || null;
}

/** 查詢單一上櫃股票的今日官方收盤價（來自 TPEx tpex_mainboard_daily_close_quotes） */
export async function fetchTPEXStockPrice(code: string): Promise<TPEXStockQuote | null> {
  const all = await fetchTPEXAllStocks();
  const stock = all.find(s => s.SecuritiesCompanyCode === code);
  return stock || null;
}

/**
 * 透過 TWSE MIS 即時報價 API 取得今日現價
 * ex: tse_{code}.tw = 上市, otc_{code}.tw = 上櫃
 * z = 最新成交價（可能是 "-" 表示鎖漲停）, h = 今日最高, y = 昨收, n = 公司名, d = 日期 YYYYMMDD
 */
export type OfficialClosePrice = {
  price: number;
  name: string;
  date: string;
  previousClose?: number;
};

function parseMISPrice(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  const levels = raw.split('_').map(level => level.trim()).filter(Boolean);
  for (const level of levels) {
    if (level === '-') continue;
    const price = parseFloat(level);
    if (Number.isFinite(price) && price > 0) return price;
  }
  return 0;
}

async function fetchMISRealtime(code: string, market: 'tse' | 'otc'): Promise<OfficialClosePrice | null> {
  try {
    const url = `/api/mis/getStockInfo.jsp?ex_ch=${market}_${code}.tw&json=1&delay=0`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const item = json?.msgArray?.[0];
    if (!item) return null;
    const name: string = item.n || item.nf || '';
    const date: string = item.d || '';
    // z = 最新成交價；若暫無成交，用買一/賣一作為目前可成交參考，不使用 h 今日最高價。
    const price = parseMISPrice(item.z) || parseMISPrice(item.b) || parseMISPrice(item.a);
    if (!price || price <= 0) return null;
    const previousClose = parseMISPrice(item.y) || undefined;
    return {
      price,
      name,
      date,
      previousClose: previousClose && previousClose > 0 ? previousClose : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 統一入口：優先使用 MIS 即時報價（盤中/漲跌停即時反映），
 * 再 fallback 到 TWSE/TPEx OpenAPI 昨日收盤。
 * 回傳 { price, name, date } —— date 為西元 YYYYMMDD 格式
 */
export async function fetchOfficialClosePrice(code: string): Promise<OfficialClosePrice | null> {
  // 先試上市 (tse)，再試上櫃 (otc)，MIS 即時資料優先
  const misTse = await fetchMISRealtime(code, 'tse');
  if (misTse) return misTse;
  const misOtc = await fetchMISRealtime(code, 'otc');
  if (misOtc) return misOtc;

  // MIS 失敗時 fallback 到舊有 OpenAPI（盤後延遲資料）
  const twse = await fetchTWSEStockPrice(code);
  if (twse && twse.ClosingPrice && parseFloat(twse.ClosingPrice) > 0) {
    const d = twse.Date || '';
    const date = d.length === 7
      ? `${parseInt(d.slice(0, 3)) + 1911}${d.slice(3)}`
      : d.replace(/-/g, '').replace(/\//g, '');
    return { price: parseFloat(twse.ClosingPrice), name: twse.Name, date };
  }
  const tpex = await fetchTPEXStockPrice(code);
  if (tpex && tpex.Close && parseFloat(tpex.Close) > 0) {
    const d = tpex.Date || '';
    const date = d.length === 7
      ? `${parseInt(d.slice(0, 3)) + 1911}${d.slice(3)}`
      : d.replace(/-/g, '').replace(/\//g, '');
    return { price: parseFloat(tpex.Close), name: tpex.CompanyName, date };
  }
  return null;
}

export function makeKidFriendly(code: string, name: string, status: string, industry: string): string {
  const profileText = `${status || ''} ${industry || ''}`;
  if (
    profileText.includes('電源管理') ||
    profileText.includes('功率元件') ||
    profileText.includes('功率半導體') ||
    profileText.includes('類比IC') ||
    profileText.includes('IC設計') ||
    profileText.includes('分離式元件') ||
    profileText.includes('電晶體') ||
    profileText.toUpperCase().includes('MOSFET') ||
    profileText.includes('電源供應器') ||
    profileText.includes('金仁寶') ||
    profileText.includes('資料中心') ||
    profileText.includes('伺服器') ||
    profileText.includes('車用充電')
  ) {
    return `${code} ${name} 是一間做電源管理與功率元件的半導體公司，產品包含類比 IC、分離式元件與電晶體。它們常用在電腦、手機、車用電子或各種需要穩定供電的設備裡，幫電流轉換、控制和保護電路。🔌`;
  }
  if (status?.includes('全球第一') || status?.includes('全球最大')) {
    return `${code} ${name} 是一間在全球市場很有份量的公司。它的產品或服務能賣到很多國家，代表技術、品質或規模有一定競爭力。看公司時，可以再觀察它最主要的產品、客戶和營收來源。🏆`;
  }
  if (status?.includes('台灣') || name) {
    const parts = [status, industry].filter(Boolean).join('；');
    return `${code} ${name} 是一間台灣公司。${parts ? `目前可看到的資料是：${parts}。` : ''}PPBear 需要更多公司產品資料才能講得更精準，建議稍後重新整理讓系統抓 MoneyDJ 公司百科。`;
  }
  return `${code} ${name} 的公司資料暫時不足，PPBear 需要更多產品與服務資訊才能準確介紹。`;
}

function descriptionMatchesStockProfile(description: string, name: string, status: string, industry: string): boolean {
  const desc = description.replace(/\s+/g, ' ').trim();
  if (!desc.includes(name) && !desc.includes(name.slice(0, 2))) return false;

  const source = `${status || ''} ${industry || ''}`;
  const keywords = [
    '電源管理', '功率元件', '功率半導體', 'MOSFET',
    '類比IC', 'IC設計', '分離式元件', '電晶體',
    '半導體', '晶片', '控制IC', '濾波器', '被動元件',
    '電感', '電容', '伺服器', '資料中心', '網通',
    '金融', '銀行', '保險', '航運', '鋼鐵', '水泥', '食品', '電信',
  ].filter(keyword => source.toUpperCase().includes(keyword.toUpperCase()));

  if (keywords.length === 0) return true;
  return keywords.some(keyword => desc.toUpperCase().includes(keyword.toUpperCase()));
}

function normalizeStockAnalysisTone(text: unknown): string {
  return String(text || '')
    .replace(/法人叔叔阿姨/g, '法人')
    .replace(/大機構（法人）/g, '法人')
    .replace(/大機構/g, '法人')
    .replace(/這支股票/g, '該股')
    .replace(/還不錯喔/g, '相對穩定')
    .replace(/不錯喔/g, '相對穩定')
    .replace(/好消息/g, '偏正面訊號')
    .replace(/大家都在關注/g, '市場關注')
    .replace(/可以自己上新聞網站找找看/g, '可再查閱主流財經新聞')
    .replace(/先別急著下決定/g, '暫時不宜只依單一資料判斷')
    .replace(/再和家人討論下一步/g, '再評估後續策略')
    .replace(/喔[！!]?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 動態取得或生成兒童版股票介紹（透過 Supabase Edge Function，API key 存在伺服器端）
export async function getOrGenerateKidFriendlyDesc(
  code: string,
  name: string,
  status: string,
  industry: string,
  onChunk?: (text: string) => void
): Promise<string> {
  const fallbackDesc = makeKidFriendly(code, name, status, industry);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return fallbackDesc;

  try {
    const { data: sessionData } = supabase
      ? await supabase.auth.getSession()
      : { data: { session: null } };
    const authToken = sessionData.session?.access_token || supabaseAnonKey;

    const response = await fetch(`${supabaseUrl}/functions/v1/get-kid-description`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ code, name, status, industry }),
    });

    if (!response.ok) {
      console.error('Edge Function HTTP error:', response.status);
      return fallbackDesc;
    }

    const data = await response.json();
    const description: string = data?.description || '';
    if (!description) return fallbackDesc;
    if (!descriptionMatchesStockProfile(description, name, status, industry)) return fallbackDesc;

    if (onChunk) onChunk(description);
    return description;
  } catch (err) {
    console.error('getOrGenerateKidFriendlyDesc error:', err);
    return fallbackDesc;
  }
}

export async function getFreshStockAnalysis(
  code: string,
  name: string,
  industry: string,
  status: string
): Promise<StockLiveAnalysis | null> {
  const cacheKey = `ppbears_daily_analysis_v2_${code}`;
  const cached = getDailyCache<StockLiveAnalysis>(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetch('/api/stock-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      cache: 'no-store',
      body: JSON.stringify({ code, name, industry, status }),
    });

    if (!response.ok) {
      console.error('stock-analysis HTTP error:', response.status);
      return null;
    }

    const data = await response.json();
    if (!data?.technical || !data?.chips || !data?.news) return null;

    const result: StockLiveAnalysis = {
      technical: normalizeStockAnalysisTone(data.technical),
      chips: normalizeStockAnalysisTone(data.chips),
      news: normalizeStockAnalysisTone(data.news),
      headlines: Array.isArray(data.headlines) ? data.headlines : [],
      generatedAt: data.generatedAt || new Date().toISOString(),
    };
    setDailyCache(cacheKey, result);
    return result;
  } catch (err) {
    console.error('getFreshStockAnalysis error:', err);
    return null;
  }
}


// 取得個股資料
export async function fetchStockData(coid: string): Promise<StockData | null> {
  try {
    const url = `${IFALGO_BASE}/stock?coid=${coid}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    if (json.data?.stock?.position) {
      return json.data.stock.position;
    }
    return null;
  } catch (err) {
    console.error('fetchStockData error:', err);
    return null;
  }
}

export type StockTradingSignalsPayload = {
  coid: string;
  dataDate: string;
  signalUpdatedAt: string;
  source: string;
  signals: StockTradingSignal[];
  generatedAt: string;
};

export async function fetchStockTradingSignals(coid: string): Promise<StockTradingSignalsPayload | null> {
  try {
    const { data } = supabase
      ? await supabase.auth.getSession()
      : { data: { session: null } };
    const token = data.session?.access_token;
    if (!token) return null;

    const res = await fetch(`/api/app-cache?type=stock-trading-signals&coid=${encodeURIComponent(coid)}`, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json?.signals) ? json as StockTradingSignalsPayload : null;
  } catch (err) {
    console.error('fetchStockTradingSignals error:', err);
    return null;
  }
}

export interface StockQuantData {
  aiQuanBackDataComment: {
    remark: string;    // AI推薦等級，例：超高度、高度、中度、低度
    cum_ret: string;   // 累積報酬，例：27.4%
    freq: number;
  } | null;
  chipStability: {
    pts: string;       // 籌碼穩定度分數 0-10，8 = 最乾淨
  } | null;
  stockInfo: {
    gvi: number;
    mediangvi: string;
  } | null;
  currentSignal: 'buy' | 'sell' | 'neutral'; // 依最新資料日當天的 aiQuanBackDataTradingList 事件判斷
  signalStreak: {
    signal: 'buy' | 'sell' | null;
    count: number;
  };
  meta?: StockQuantMeta;
}

export interface StockQuantMeta {
  source: 'shared-cache' | 'ifalgo-live' | 'empty';
  dataDate: string;
  fetchedAt: string;
  fixedUpdateTime: string;
  scheduleLabel: string;
  cacheStatus: 'hit' | 'miss' | 'fresh';
}

export interface StockQuantHistoryPoint {
  date: string;
  coid: string;
  stkname: string | null;
  chipPts: number;
  aiRemark: string | null;
  aiCumRet: string | null;
  gvi: number | null;
  mediangvi: number | null;
  source: 'stock_quant_daily_snapshots' | 'simons_daily_snapshots' | 'ifalgo-live';
}

export interface InstitutionCostData {
  code: string;
  source: 'goodinfo';
  sourceUrl: string;
  period: string;
  note: string;
  items: Array<{
    key: 'foreign' | 'trust' | 'dealer';
    label: string;
    estimatedCost: number | null;
    buyShares: number;
    buyAmount: number;
  }>;
  finmind?: {
    sourceUrl: string;
    period: string;
    note: string;
    items: Array<{
      key: 'foreign' | 'trust' | 'dealer';
      label: string;
      buyShares: number;
      sellShares: number;
      netShares: number;
    }>;
  };
  generatedAt: string;
}

export async function fetchStockQuantHistory(coid: string, days = 60): Promise<StockQuantHistoryPoint[]> {
  try {
    const params = new URLSearchParams({
      type: 'stock-quant-history',
      coid,
      days: String(days),
    });
    const res = await fetch(`/api/app-cache?${params.toString()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.points) ? data.points : [];
  } catch (err) {
    console.error('fetchStockQuantHistory error:', err);
    return [];
  }
}

export async function fetchSimonsRecommendationCounts(coids: string[], days = 90): Promise<Record<string, number>> {
  const uniqueCoids = [...new Set(coids.filter(Boolean))];
  if (uniqueCoids.length === 0) return {};

  try {
    const params = new URLSearchParams({
      type: 'simons-rec-counts',
      coids: uniqueCoids.join(','),
      days: String(days),
    });
    const res = await fetch(`/api/app-cache?${params.toString()}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data?.counts && typeof data.counts === 'object'
      ? data.counts as Record<string, number>
      : {};
  } catch (err) {
    console.error('fetchSimonsRecommendationCounts error:', err);
    return {};
  }
}

export type ActiveEtfAction = 'added' | 'increased' | 'decreased' | 'removed' | 'held';

export interface ActiveEtfRadarEtf {
  etfCode: string;
  etfName: string;
  action: ActiveEtfAction;
  weightPct: number | null;
  previousWeightPct: number | null;
  weightChangePct: number | null;
  shares: number | null;
  previousShares: number | null;
  shareChange: number | null;
}

export interface ActiveEtfRadarItem {
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
  etfs: ActiveEtfRadarEtf[];
  source: string;
}

export async function fetchActiveEtfRadarMap(coids: string[], days = 5): Promise<Record<string, ActiveEtfRadarItem>> {
  const uniqueCoids = [...new Set(coids.map(code => String(code || '').trim()).filter(Boolean))];
  if (uniqueCoids.length === 0) return {};

  try {
    const params = new URLSearchParams({
      type: 'active-etf-radar',
      coids: uniqueCoids.join(','),
      days: String(days),
      t: String(Date.now()),
    });
    const res = await fetch(`/api/app-cache?${params.toString()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data?.items && typeof data.items === 'object'
      ? data.items as Record<string, ActiveEtfRadarItem>
      : {};
  } catch (err) {
    console.error('fetchActiveEtfRadarMap error:', err);
    return {};
  }
}

export interface SimonsInstitutionCostData {
  coid: string;
  stockName: string;
  date: string;
  source: 'simons-recommendation';
  foreignCost: number | null;
  trustCost: number | null;
  dealerCost: number | null;
  weightedAverage: number | null;
  close: number | null;
}

export async function fetchSimonsInstitutionCostData(coid: string, days = 90): Promise<SimonsInstitutionCostData | null> {
  try {
    const params = new URLSearchParams({
      type: 'simons-institution-cost',
      coid,
      days: String(days),
    });
    const res = await fetch(`/api/app-cache?${params.toString()}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.cost && typeof data.cost === 'object'
      ? data.cost as SimonsInstitutionCostData
      : null;
  } catch (err) {
    console.error('fetchSimonsInstitutionCostData error:', err);
    return null;
  }
}

export async function fetchInstitutionCostData(coid: string): Promise<InstitutionCostData | null> {
  try {
    const res = await fetch(`/api/institution-cost?code=${encodeURIComponent(coid)}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.items)) return null;
    return data as InstitutionCostData;
  } catch (err) {
    console.error('fetchInstitutionCostData error:', err);
    return null;
  }
}

function normalizeSignalText(value: unknown): string {
  return String(value ?? '').trim();
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

function calculateSignalStreak(tradingList: any[], sinceDate?: string): StockQuantData['signalStreak'] {
  let activeSignal: 'buy' | 'sell' | null = null;
  let count = 0;
  const today = _todayStr();
  const eventMap = new Map<string, 'buy' | 'sell' | 'neutral'>();

  const setEvent = (eventDate: string, signal: 'buy' | 'sell' | 'neutral') => {
    if (!eventDate) return;
    if (sinceDate && eventDate < sinceDate) return;

    const current = eventMap.get(eventDate);
    if (signal === 'sell' || (signal === 'buy' && current !== 'sell') || !current) {
      eventMap.set(eventDate, signal);
    }
  };

  for (const item of tradingList) {
    const outDate = normalizeSignalText(item?.out_date);
    const inDate = normalizeSignalText(item?.in_date);
    const sig = normalizeSignalText(item?.sell_sig);
    const hasOpenPosition = isOpenOutDate(outDate, inDate, today);

    setEvent(inDate, 'buy');

    if (!hasOpenPosition) {
      if (sig === '中立') setEvent(outDate, 'neutral');
      else setEvent(outDate || inDate, 'sell');
    }
  }

  const signalEvents = [...eventMap.entries()]
    .map(([eventDate, signal]) => ({ eventDate, signal }))
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

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

export async function fetchStockQuantData(coid: string, sinceDate?: string, options: { forceFresh?: boolean } = {}): Promise<StockQuantData> {
  const empty: StockQuantData = {
    aiQuanBackDataComment: null,
    chipStability: null,
    stockInfo: null,
    currentSignal: 'neutral',
    signalStreak: { signal: null, count: 0 },
    meta: {
      source: 'empty',
      dataDate: _todayStr(),
      fetchedAt: new Date().toISOString(),
      fixedUpdateTime: AI_SYNC_LABEL,
      scheduleLabel: AI_SYNC_SCHEDULE_LABEL,
      cacheStatus: 'miss',
    },
  };
  // v5: 改用 30 分鐘 TTL 快取（原每日快取會讓訊號延遲整天，盤中訊號不可接受）
  const dailyVersionToken = getDailyAiCacheVersionToken();
  const cacheKey = sinceDate ? `ppbears_quant30_${QUANT_SIGNAL_CACHE_VERSION}_${dailyVersionToken}_${coid}_${sinceDate}` : `ppbears_quant30_${QUANT_SIGNAL_CACHE_VERSION}_${dailyVersionToken}_${coid}`;
  const legacyCacheKey = sinceDate ? `ppbears_quant30_${coid}_${sinceDate}` : `ppbears_quant30_${coid}`;
  if (!options.forceFresh) {
    const cached = getTTLCache<StockQuantData>(cacheKey);
    if (cached) return cached;
  }
  try {
    const params = new URLSearchParams({ coid });
    if (sinceDate) params.set('sinceDate', sinceDate);
    if (options.forceFresh) params.set('fresh', String(Date.now()));
    try {
      params.set('type', 'stock-quant');
      const sessionResult = supabase ? await supabase.auth.getSession().catch(() => null) : null;
      const token = sessionResult?.data.session?.access_token;
      const cloudRes = await fetch(`/api/app-cache?${params.toString()}`, {
        ...(options.forceFresh ? { cache: 'no-store' as RequestCache } : {}),
        headers: {
          accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (cloudRes.ok) {
        const cloudData = await cloudRes.json();
        if (cloudData?.data?.aiQuanBackDataComment !== undefined) {
          const result = cloudData.data as StockQuantData;
          setTTLCache(cacheKey, result, QUANT_SIGNAL_TTL_MS);
          clearTTLCache(legacyCacheKey);
          return result;
        }
      }
    } catch {
      // Local/offline fallback below.
    }

    const url = `${IFALGO_BASE}/stock?coid=${coid}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    const stock = json.data?.stock;
    const pos = stock?.position;
    if (!stock) return empty;

    const tradingList: any[] = stock.aiQuanBackDataTradingList || [];
    const signalStreak = calculateSignalStreak(tradingList, sinceDate);
    const dataDate = String(pos?.chipStability?.mdate || _todayStr());
    const currentSignal = getCurrentSignalForDataDate(tradingList, dataDate);


    const result: StockQuantData = {
      aiQuanBackDataComment: stock.aiQuanBackDataComment ?? null,
      chipStability: pos?.chipStability ?? null,
      stockInfo: pos?.stockInfo ?? null,
      currentSignal,
      signalStreak,
      meta: {
        source: 'ifalgo-live',
        dataDate,
        fetchedAt: new Date().toISOString(),
        fixedUpdateTime: AI_SYNC_LABEL,
        scheduleLabel: AI_SYNC_SCHEDULE_LABEL,
        cacheStatus: options.forceFresh ? 'fresh' : 'miss',
      },
    };
    // 寫入 30 分鐘 TTL 快取
    setTTLCache(cacheKey, result, QUANT_SIGNAL_TTL_MS);
    clearTTLCache(legacyCacheKey);
    return result;
  } catch (err) {
    console.error('fetchStockQuantData error:', err);
    return empty;
  }
}

// 取得 Simons 每日推薦
// 今日資料優先讀取雲端每日快取；雲端沒有時才回原始 IFAlgo。
export async function fetchSimonsData(
  date?: string,
  options: { forceFresh?: boolean; updateSharedCache?: boolean } = {}
): Promise<SimonsItem[]> {
  const d = date || _todayStr();
  // 指定歷史日期時仍用每日快取；今日資料保存到隔天早上 7 點
  const isToday = !date || date === _todayStr();
  const dailyVersionToken = isToday ? getDailyAiCacheVersionToken() : '';
  const cacheKey = isToday
    ? `ppbears_simons_daily7_${d}_${dailyVersionToken}`
    : `ppbears_daily_simons_${d}`;     // 歷史：每日快取
  const cached = options.forceFresh
    ? null
    : isToday
      ? getTTLCache<SimonsItem[]>(cacheKey)
      : getDailyCache<SimonsItem[]>(cacheKey);
  if (cached) return cached;
  try {
    if (isToday) {
      try {
        const cloudUrl = options.forceFresh
          ? options.updateSharedCache
            ? `/api/app-cache?type=simons&manual=${Date.now()}`
            : `/api/app-cache?type=simons&read=${Date.now()}`
          : '/api/app-cache?type=simons';
        const cloudRes = await fetch(cloudUrl, options.forceFresh ? { cache: 'no-store' } : undefined);
        if (cloudRes.ok) {
          const cloudJson = await cloudRes.json();
          const cloudItems: SimonsItem[] = Array.isArray(cloudJson?.items) ? cloudJson.items : [];
          if (cloudItems.length > 0) {
            setTTLCache(cacheKey, cloudItems, getSimonsDataTtlMs());
            return cloudItems;
          }
        }
      } catch {
        // Local/offline fallback below.
      }
    }

    const url = `${IFALGO_BASE}/common/getSimonsData?searchDate=${d}&_t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    const items: SimonsItem[] = json.data?.dataItems || [];
    if (items.length > 0) {
      if (isToday) {
        setTTLCache(cacheKey, items, getSimonsDataTtlMs());
      } else {
        setDailyCache(cacheKey, items);
      }
    }
    return items;
  } catch (err) {
    console.error('fetchSimonsData error:', err);
    return [];
  }
}

export interface MarketMomentumPoint {
  label: string;
  moneyMomentum: number;
  taiex: number;
}

export interface MarginMaintenancePoint {
  label: string;
  rate: number;
}

export interface HomeMarketSummary {
  updateDate: string;
  monthLabel: string;
  macroScore: number;
  aiConclusion?: {
    title: string;
    summary: string;
    actionTone: string;
    keyPoints: string[];
    generatedAt: string;
    source: 'ai' | 'rules';
  };
  marketMood: {
    primary: '貪婪' | '樂觀' | '放鬆' | '冷靜';
    reason: string;
    indicators: Array<{
      label: '貪婪' | '樂觀' | '放鬆' | '冷靜';
      active: boolean;
      description: string;
    }>;
  };
  monthlyPrediction: {
    score: number;
    label: string;
    directionScore?: number;
    rawScore?: number;
    forecast?: number;
  };
  dailyPrediction: {
    score: number;
    maxScore: number;
    sourceStock?: string;
  };
  marketFundMomentum: {
    points: MarketMomentumPoint[];
    momentumRange: [number, number];
    taiexRange: [number, number];
  };
  marginMaintenance: {
    points: MarginMaintenancePoint[];
    todayRate: number;
    safeLine: number;
    minLine: number;
    unit: string;
  };
}

interface IFAlgoStockPayload {
  data?: {
    stock?: {
      position?: {
        ewgin?: Array<{ mdate: string; gin3?: number; gin7?: number; gin8?: number }>;
      };
    };
  };
}

interface IFAlgoIndexFirstZoneData {
  lastImrset?: {
    mdate?: string;
    lmrToday?: string | number;
    lmrSafe?: string | number;
    boundary?: string | number;
  };
  imrsetList?: Array<{
    mdate?: string;
    lmrToday?: string | number;
    lmrSafe?: string | number;
    boundary?: string | number;
  }>;
  lastForcastMonthly?: {
    mdate?: string;
    conv1?: string | number;
    mforecast?: string | number;
    longshort?: string;
  };
  lastForecastMonthly?: {
    mdate?: string;
    conv1?: string | number;
    mforecast?: string | number;
    longshort?: string;
  };
  forcastMonthlyList?: Array<string | number>;
  forcastMonthlyDateList?: string[];
  currencyList?: Array<string | number>;
  lastForcastDaily?: {
    mdate?: string;
    longshort?: string;
  };
  lastPtsTw?: {
    mdate?: string;
    pts?: string | number;
    mforecast?: string | number;
    wforecast?: string | number;
    dforecast?: string | number;
  };
}

const HOME_MARKET_MOMENTUM_POINTS: MarketMomentumPoint[] = [
  { label: '2022/07', moneyMomentum: -0.3150, taiex: 14800 },
  { label: '2022/08', moneyMomentum: -0.4660, taiex: 14900 },
  { label: '2022/09', moneyMomentum: -0.2860, taiex: 15050 },
  { label: '2022/10', moneyMomentum: -0.4410, taiex: 13900 },
  { label: '2022/11', moneyMomentum: -0.8620, taiex: 13650 },
  { label: '2022/12', moneyMomentum: -1.0010, taiex: 14600 },
  { label: '2023/01', moneyMomentum: -1.0000, taiex: 14200 },
  { label: '2023/02', moneyMomentum: -1.2210, taiex: 15150 },
  { label: '2023/03', moneyMomentum: -1.3990, taiex: 15400 },
  { label: '2023/04', moneyMomentum: -1.3290, taiex: 15600 },
  { label: '2023/05', moneyMomentum: -1.2350, taiex: 16000 },
  { label: '2023/06', moneyMomentum: -1.1130, taiex: 16600 },
  { label: '2023/07', moneyMomentum: -1.1630, taiex: 16950 },
  { label: '2023/08', moneyMomentum: -1.0820, taiex: 16500 },
  { label: '2023/09', moneyMomentum: -1.0570, taiex: 16100 },
  { label: '2023/10', moneyMomentum: -0.8980, taiex: 17800 },
  { label: '2023/11', moneyMomentum: -0.8800, taiex: 18600 },
  { label: '2023/12', moneyMomentum: -0.7990, taiex: 18500 },
  { label: '2024/01', moneyMomentum: -0.6320, taiex: 19700 },
  { label: '2024/02', moneyMomentum: -0.5900, taiex: 20400 },
  { label: '2024/03', moneyMomentum: -0.6370, taiex: 21100 },
  { label: '2024/04', moneyMomentum: -0.6100, taiex: 22600 },
  { label: '2024/05', moneyMomentum: -0.6000, taiex: 24500 },
  { label: '2024/06', moneyMomentum: -0.7550, taiex: 23800 },
  { label: '2024/07', moneyMomentum: -0.6810, taiex: 24100 },
  { label: '2024/08', moneyMomentum: -0.5900, taiex: 23600 },
  { label: '2024/09', moneyMomentum: -0.6500, taiex: 24500 },
  { label: '2024/10', moneyMomentum: -0.5960, taiex: 25100 },
  { label: '2024/11', moneyMomentum: -0.7000, taiex: 24700 },
  { label: '2024/12', moneyMomentum: -0.6600, taiex: 22000 },
  { label: '2025/01', moneyMomentum: -0.5110, taiex: 21000 },
  { label: '2025/02', moneyMomentum: -0.4700, taiex: 22200 },
  { label: '2025/03', moneyMomentum: -0.9320, taiex: 23200 },
  { label: '2025/04', moneyMomentum: -0.8420, taiex: 24100 },
  { label: '2025/05', moneyMomentum: -0.7000, taiex: 25800 },
  { label: '2025/06', moneyMomentum: -0.6020, taiex: 27600 },
  { label: '2025/07', moneyMomentum: -0.5120, taiex: 27100 },
  { label: '2025/08', moneyMomentum: -0.4720, taiex: 28900 },
  { label: '2025/09', moneyMomentum: -0.4430, taiex: 33000 },
  { label: '2025/10', moneyMomentum: -0.4310, taiex: 36200 },
  { label: '2025/11', moneyMomentum: -0.4300, taiex: 33000 },
  { label: '2025/12', moneyMomentum: -0.3200, taiex: 39700 },
  { label: '2026/01', moneyMomentum: -0.3130, taiex: 32063.8 },
  { label: '2026/02', moneyMomentum: -0.0406, taiex: 35414.5 },
  { label: '2026/03', moneyMomentum: -0.1934, taiex: 31723.0 },
  { label: '2026/04', moneyMomentum: -0.1934, taiex: 38926.6 },
  { label: '2026/05', moneyMomentum: -0.1934, taiex: 40769.3 },
];

const HOME_MARGIN_POINTS: MarginMaintenancePoint[] = [
  { label: '2025/12/01', rate: 154.0 },
  { label: '2025/12/08', rate: 153.2 },
  { label: '2025/12/15', rate: 154.1 },
  { label: '2025/12/22', rate: 154.5 },
  { label: '2025/12/29', rate: 154.2 },
  { label: '2026/01/05', rate: 155.7 },
  { label: '2026/01/12', rate: 155.8 },
  { label: '2026/01/19', rate: 156.2 },
  { label: '2026/01/26', rate: 157.1 },
  { label: '2026/02/02', rate: 159.5 },
  { label: '2026/02/09', rate: 160.1 },
  { label: '2026/02/16', rate: 155.5 },
  { label: '2026/02/23', rate: 154.8 },
  { label: '2026/03/02', rate: 158.0 },
  { label: '2026/03/09', rate: 161.6 },
  { label: '2026/03/16', rate: 151.2 },
  { label: '2026/03/23', rate: 156.9 },
  { label: '2026/03/30', rate: 159.7 },
  { label: '2026/04/06', rate: 156.2 },
  { label: '2026/04/13', rate: 150.8 },
  { label: '2026/04/20', rate: 153.3 },
  { label: '2026/04/27', rate: 157.6 },
  { label: '2026/05/01', rate: 160.3 },
];

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const HOME_MARKET_SUMMARY_CACHE_KEY = 'ppbears_home_market_summary_daily_7am_v17';

function getTaipeiShiftedDate(date = new Date()): Date {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS);
}

function getHomeMarketRefreshSlot(date = new Date()): string {
  const taipei = getTaipeiShiftedDate(date);
  return taipei.toISOString().slice(0, 10);
}

function getNextHomeMarketRefreshTime(date = new Date()): number {
  const taipei = getTaipeiShiftedDate(date);
  let nextTaipeiEight = Date.UTC(
    taipei.getUTCFullYear(),
    taipei.getUTCMonth(),
    taipei.getUTCDate(),
    7,
    0,
    0,
    0
  );
  if (taipei.getTime() >= nextTaipeiEight) {
    nextTaipeiEight += 24 * 60 * 60 * 1000;
  }
  return nextTaipeiEight - TAIPEI_OFFSET_MS;
}

function getHomeMarketSummaryCache(): HomeMarketSummary | null {
  try {
    for (const key of Object.keys(localStorage)) {
      if (
        (key.startsWith('ppbears_home_market_summary_daily_8am_')
          || key.startsWith('ppbears_home_market_summary_daily_7am_'))
        && key !== HOME_MARKET_SUMMARY_CACHE_KEY
      ) {
        localStorage.removeItem(key);
      }
    }
    const raw = localStorage.getItem(HOME_MARKET_SUMMARY_CACHE_KEY);
    if (!raw) return null;
    const parsed: { refreshSlot: string; expiry: number; data: HomeMarketSummary } = JSON.parse(raw);
    const hasLegacyMood = !parsed.data?.marketMood?.reason
      || String(parsed.data?.aiConclusion?.summary || '').includes('四個情緒可以同時成立')
      || String(parsed.data?.aiConclusion?.summary || '').includes('分開判讀')
      || String(parsed.data?.aiConclusion?.summary || '').includes('undefined')
      || parsed.data?.marketMood?.indicators?.some(indicator => (
      ['追價熱度', '趨勢信心', '槓桿安全', '波動穩定'].includes(String(indicator.label)) || 'score' in indicator
    ));
    if (hasLegacyMood) {
      localStorage.removeItem(HOME_MARKET_SUMMARY_CACHE_KEY);
      return null;
    }
    if (parsed.refreshSlot !== getHomeMarketRefreshSlot() || Date.now() > parsed.expiry) {
      localStorage.removeItem(HOME_MARKET_SUMMARY_CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function isValidHomeMarketSummary(data: unknown): data is HomeMarketSummary {
  const summary = data as Partial<HomeMarketSummary> | null;
  return !!summary
    && typeof summary.updateDate === 'string'
    && typeof summary.macroScore === 'number'
    && !!summary.marketMood?.primary
    && Array.isArray(summary.marketFundMomentum?.points)
    && Array.isArray(summary.marginMaintenance?.points)
    && typeof summary.marginMaintenance?.todayRate === 'number';
}

async function fetchCloudHomeMarketSummary(): Promise<HomeMarketSummary | null> {
  try {
    const response = await fetch('/api/app-cache?type=home-summary');
    if (!response.ok) return null;
    const json = await response.json();
    const summary = json?.summary ?? json;
    return isValidHomeMarketSummary(summary) ? summary : null;
  } catch {
    return null;
  }
}

function setHomeMarketSummaryCache(data: HomeMarketSummary): void {
  try {
    localStorage.setItem(HOME_MARKET_SUMMARY_CACHE_KEY, JSON.stringify({
      refreshSlot: getHomeMarketRefreshSlot(),
      expiry: getNextHomeMarketRefreshTime(),
      data,
    }));
  } catch {}
}

function parseMarketNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? '')
    .replace(/,/g, '')
    .replace(/\+/g, '')
    .replace(/%/g, '')
    .trim();
  const n = parseFloat(normalized);
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

function toYmd(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function toIsoDate(date: Date): string {
  const ymd = toYmd(date);
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function rocDateToIso(value: string): string {
  const raw = String(value || '').replace(/\D/g, '');
  if (raw.length !== 7) return value;
  const year = Number(raw.slice(0, 3)) + 1911;
  return `${year}-${raw.slice(3, 5)}-${raw.slice(5, 7)}`;
}

function rocDateToMonthLabel(value: string): string {
  const iso = rocDateToIso(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return value;
  return `${iso.slice(0, 4)}/${iso.slice(5, 7)}`;
}

function getRecentDates(days: number): Date[] {
  const dates: Date[] = [];
  const current = new Date();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(current);
    d.setDate(current.getDate() - i);
    dates.push(d);
  }
  return dates;
}

async function fetchLatestSimonsSnapshot(): Promise<{ date: string; items: SimonsItem[] }> {
  for (const date of getRecentDates(12)) {
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const iso = toIsoDate(date);
    const items = await fetchSimonsData(iso);
    if (items.length > 0) return { date: iso, items };
  }
  return { date: _todayStr(), items: [] };
}

async function fetchIfalgoIndexFirstZoneData(): Promise<IFAlgoIndexFirstZoneData | null> {
  try {
    const res = await fetch(`${IFALGO_BASE}/index/firstZoneData`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.first ?? null;
  } catch {
    return null;
  }
}

async function fetchSimonsEwginData(coid = '2383'): Promise<Array<{ mdate: string; gin3: number; gin7: number; gin8: number }>> {
  try {
    const res = await fetch(`${IFALGO_BASE}/stock?coid=${coid}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json: IFAlgoStockPayload = await res.json();
    const ewgin = json.data?.stock?.position?.ewgin || [];
    return ewgin
      .map(item => ({
        mdate: item.mdate,
        gin3: parseMarketNumber(item.gin3),
        gin7: parseMarketNumber(item.gin7),
        gin8: parseMarketNumber(item.gin8),
      }))
      .filter(item => item.mdate && Number.isFinite(item.gin8));
  } catch {
    return [];
  }
}

function buildIfalgoMomentumPoints(firstZone: IFAlgoIndexFirstZoneData | null): MarketMomentumPoint[] {
  const dates = firstZone?.forcastMonthlyDateList ?? [];
  const momentum = firstZone?.currencyList ?? [];
  const taiex = firstZone?.forcastMonthlyList ?? [];
  const points = dates.map((date, index) => ({
    label: String(date || '').slice(0, 7).replace('-', '/'),
    moneyMomentum: parseMarketNumber(momentum[index]),
    taiex: parseMarketNumber(taiex[index]),
  })).filter(point => point.label && Number.isFinite(point.moneyMomentum) && point.taiex > 0);
  return points.length > 0 ? points : HOME_MARKET_MOMENTUM_POINTS;
}

function buildIfalgoMarginPoints(firstZone: IFAlgoIndexFirstZoneData | null): MarginMaintenancePoint[] {
  const rows = firstZone?.imrsetList ?? [];
  const points = rows.map(row => ({
    label: String(row.mdate || '').replace(/-/g, '/'),
    rate: parseMarketNumber(row.lmrToday),
  })).filter(point => point.label && point.rate > 0);
  return points.length > 0 ? points : HOME_MARGIN_POINTS;
}

function buildIfalgoMarketScores(
  firstZone: IFAlgoIndexFirstZoneData | null,
  fallback: Pick<HomeMarketSummary, 'monthLabel' | 'macroScore' | 'monthlyPrediction' | 'dailyPrediction'>
): Pick<HomeMarketSummary, 'monthLabel' | 'macroScore' | 'monthlyPrediction' | 'dailyPrediction'> {
  const monthly = firstZone?.lastForecastMonthly ?? firstZone?.lastForcastMonthly;
  const monthlyScore = parseMarketNumber(monthly?.conv1);
  const monthlyForecast = parseMonthlyForecast(monthly?.mforecast);
  const dailyScore = parseMarketNumber(firstZone?.lastPtsTw?.pts);
  const monthDate = String(monthly?.mdate || firstZone?.lastPtsTw?.mdate || '');
  const month = /^\d{4}-\d{2}-\d{2}$/.test(monthDate)
    ? Number(monthDate.slice(5, 7))
    : Number(fallback.monthLabel.replace(/\D/g, '')) || new Date().getMonth() + 1;

  return {
    monthLabel: `${month}月`,
    macroScore: monthlyScore > 0 ? Math.round(clampMarketValue(monthlyScore, 0, 100)) : fallback.macroScore,
    monthlyPrediction: monthlyScore > 0
      ? {
        score: Math.round(clampMarketValue(monthlyScore, 0, 100)),
        label: monthly?.longshort || fallback.monthlyPrediction.label,
        directionScore: getMonthlyDirectionScore(monthly?.longshort || fallback.monthlyPrediction.label, monthlyForecast, monthlyScore),
        rawScore: Math.round(clampMarketValue(monthlyScore, 0, 100)),
        forecast: monthlyForecast,
      }
      : fallback.monthlyPrediction,
    dailyPrediction: dailyScore > 0
      ? {
        score: Math.round(clampMarketValue(dailyScore, 0, 8)),
        maxScore: 8,
      }
      : fallback.dailyPrediction,
  };
}

async function fetchSimonsDailyPrediction(items: SimonsItem[]): Promise<HomeMarketSummary['dailyPrediction'] | null> {
  if (items.length === 0) return null;
  const rows = await Promise.all(items.map(async item => {
    const ewgin = await fetchSimonsEwginData(item.coid);
    const latest = ewgin
      .filter(point => !item.mdate || point.mdate <= item.mdate)
      .sort((a, b) => a.mdate.localeCompare(b.mdate))
      .pop();
    return latest
      ? {
        coid: item.coid,
        name: item.stkname,
        mdate: latest.mdate,
        gin8: latest.gin8,
      }
      : null;
  }));
  const best = rows
    .filter((row): row is NonNullable<typeof row> => !!row && Number.isFinite(row.gin8))
    .sort((a, b) => b.gin8 - a.gin8)[0];
  if (!best) return null;
  return {
    score: Math.round(clampMarketValue(best.gin8, 0, 8)),
    maxScore: 8,
    sourceStock: `${best.coid} ${best.name}`,
  };
}

async function fetchLatestTaiexPoint(): Promise<{ label: string; taiex: number } | null> {
  for (const date of getRecentDates(10)) {
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    try {
      const res = await fetch(`/api/twse-report/FMTQIK?response=json&date=${toYmd(date)}`, { cache: 'no-store' });
      if (!res.ok) continue;
      const data: any[] = await res.json();
      const latest = [...data]
        .filter(item => parseMarketNumber(item?.TAIEX) > 0)
        .sort((a, b) => String(a.Date).localeCompare(String(b.Date)))
        .pop();
      if (!latest) continue;
      return {
        label: rocDateToMonthLabel(String(latest.Date)),
        taiex: parseMarketNumber(latest.TAIEX),
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchMonthlyMarketMomentum(): Promise<MarketMomentumPoint[]> {
  const latestTaiex = await fetchLatestTaiexPoint();
  const points = HOME_MARKET_MOMENTUM_POINTS.map(point => ({ ...point }));
  if (latestTaiex && latestTaiex.label === points[points.length - 1].label) {
    const last = points[points.length - 1];
    points[points.length - 1] = {
      ...last,
      taiex: latestTaiex.taiex,
    };
  }
  return points;
}

function calculateSimonsMarketScores(
  items: SimonsItem[],
  dailyPrediction: HomeMarketSummary['dailyPrediction'] | null
): Pick<HomeMarketSummary, 'monthLabel' | 'macroScore' | 'monthlyPrediction' | 'dailyPrediction'> {
  if (items.length === 0) {
    return {
      monthLabel: `${new Date().getMonth() + 1}月`,
      macroScore: 50,
      monthlyPrediction: { score: 50, label: '觀望' },
      dailyPrediction: { score: 4, maxScore: 8 },
    };
  }

  const date = String(items[0]?.mdate || _todayStr());
  const month = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Number(date.slice(5, 7)) : new Date().getMonth() + 1;

  const sampleSize = Math.max(items.length, 1);
  const riseMonth = items.filter(item => item.ret_m === 'rise').length;
  const dropMonth = items.filter(item => item.ret_m === 'drop').length;
  const riseWeek = items.filter(item => item.ret_w === 'rise').length;
  const yflowCount = items.filter(item => String(item.yflow).toUpperCase() === 'Y').length;
  const avgPsr = items.reduce((sum, item) => sum + parseMarketNumber(item.psr), 0) / sampleSize;
  const avgStrength = items.reduce((sum, item) => sum + parseMarketNumber(item.strength), 0) / sampleSize;

  const monthlyScore = Math.round(clampMarketValue(
    50
      + ((riseMonth - dropMonth) / sampleSize) * 24
      + ((yflowCount / sampleSize) - 0.5) * 18
      + (avgPsr - 5) * 3
      + (avgStrength - 0.8) * 8,
    0,
    100
  ));

  const dailyScore = dailyPrediction?.score ?? Math.round(clampMarketValue(
      (yflowCount / sampleSize) * 2.5
        + (riseWeek / sampleSize) * 2.5
        + (items.filter(item => parseMarketNumber(item.psr) >= 7).length / sampleSize) * 1.5
        + clampMarketValue(avgStrength / 1.6, 0, 1) * 1.5,
      0,
      8
    ));

  const normalizedDaily = (dailyScore / 8) * 100;
  const macroScore = Math.round(clampMarketValue(monthlyScore * 0.65 + normalizedDaily * 0.35, 0, 100));
  const label = monthlyScore >= 70 ? '偏多' : monthlyScore >= 55 ? '穩健' : monthlyScore >= 40 ? '觀望' : '偏弱';

  return {
    monthLabel: `${month}月`,
    macroScore,
    monthlyPrediction: {
      score: monthlyScore,
      label,
      directionScore: getMonthlyDirectionScore(label, undefined, monthlyScore),
      rawScore: monthlyScore,
    },
    dailyPrediction: dailyPrediction ?? { score: dailyScore, maxScore: 8 },
  };
}

function calculateMarketMood(
  points: MarketMomentumPoint[],
  macroScore: number,
  monthlyScore: number,
  monthlyLabel: string,
  dailyScore: number,
  marginRate: number,
  safeLine: number
): HomeMarketSummary['marketMood'] {
  const latest = points[points.length - 1] ?? { label: _todayStr().replace(/-/g, '/'), moneyMomentum: -0.8, taiex: 0 };
  const previous = points[points.length - 2] ?? latest;
  const dailyNormalized = clampMarketValue((dailyScore / 8) * 100, 0, 100);
  const taiexChangePct = previous?.taiex > 0 ? ((latest.taiex - previous.taiex) / previous.taiex) * 100 : 0;
  const marginGap = marginRate - safeLine;
  const isMonthlyBullish = monthlyLabel.includes('偏多') || (macroScore >= 70 && monthlyScore >= 70);
  const isMonthlyBearish = monthlyLabel.includes('偏空');
  const isDailyHot = dailyNormalized >= 72;
  const isDailyWeak = dailyNormalized <= 40;
  const isIndexRunning = taiexChangePct >= 4;
  const isMarginVeryLoose = marginGap >= 24;
  const isMarginSafe = marginGap >= 8;
  const isMarginTight = marginGap < 4;

  let primary: HomeMarketSummary['marketMood']['primary'] = '冷靜';
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

  const descriptions: Record<HomeMarketSummary['marketMood']['primary'], string> = {
    貪婪: '短線追價情緒明顯，通常來自 AI 日預測偏熱，但中期或總體訊號沒有完全同步。',
    樂觀: '中期方向偏正面，市場方向不差，但尚未判斷為過熱追價或壓力完全放鬆。',
    放鬆: 'AI 月預測偏多且融資維持率明顯高於安全線，槓桿壓力較低。',
    冷靜: 'AI 日預測偏低、月線偏空或融資安全距離不足時，適合降低追價衝動。',
  };
  const labels: HomeMarketSummary['marketMood']['primary'][] = ['貪婪', '樂觀', '放鬆', '冷靜'];

  return {
    primary,
    reason,
    indicators: labels.map(label => ({
      label,
      active: label === primary,
      description: descriptions[label],
    })),
  };
}

async function fetchCurrentMarginMaintenanceRate(): Promise<{ date: string; rate: number | null }> {
  try {
    const response = await fetch('/api/market-margin-maintenance', { cache: 'no-store' });
    if (response.ok) {
      const latest = await response.json();
      const rate = parseMarketNumber(latest?.rate);
      if (rate > 0 && typeof latest?.date === 'string') {
        return { date: latest.date, rate };
      }
    }
  } catch {
    // Local Vite does not serve Vercel functions; fall through to TWSE client-side approximation.
  }

  const closes = await fetchTWSEAllStocks();
  const closeMap = new Map(closes.map(item => [item.Code, parseMarketNumber(item.ClosingPrice)]));
  for (const date of getRecentDates(10)) {
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const ymd = toYmd(date);
    try {
      const res = await fetch(`/api/twse-report/MI_MARGN?response=json&date=${ymd}&selectType=MS`, { cache: 'no-store' });
      if (!res.ok) continue;
      const rows: any[] = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) continue;
      let marginMarketValue = 0;
      for (const row of rows) {
        const code = String(row?.['股票代號'] || '');
        if (!/^\d{4}$/.test(code)) continue;
        const close = closeMap.get(code) || 0;
        const lots = parseMarketNumber(row?.['融資今日餘額']);
        if (close <= 0 || lots <= 0) continue;
        marginMarketValue += lots * close * 1000;
      }
      if (marginMarketValue <= 0) continue;
      // Public sources define the rate as financed shares market value divided by margin financing balance.
      // TWSE JSON exposes shares by security but not every account's original financing cost, so this is a
      // live approximation anchored to the normal 60% listed-stock financing ratio.
      const estimatedLoanBalance = marginMarketValue * 0.6;
      return { date: toIsoDate(date), rate: Number(((marginMarketValue / estimatedLoanBalance) * 100).toFixed(2)) };
    } catch {
      continue;
    }
  }
  return { date: _todayStr(), rate: null };
}

function buildMarginSeries(currentRate: number | null): MarginMaintenancePoint[] {
  if (!currentRate) return HOME_MARGIN_POINTS;
  const base = HOME_MARGIN_POINTS.slice(-22);
  return [
    ...base,
    { label: _todayStr().replace(/-/g, '/'), rate: currentRate },
  ];
}

function buildRuleBasedMarketConclusion(summary: HomeMarketSummary): NonNullable<HomeMarketSummary['aiConclusion']> {
  const dailyPct = Math.round((summary.dailyPrediction.score / summary.dailyPrediction.maxScore) * 100);
  const monthlyText = summary.monthlyPrediction.label
    ? summary.monthlyPrediction.label
    : `${summary.monthlyPrediction.score} 分`;
  const title = `今天市場氛圍：${summary.marketMood.primary}`;

  return {
    title,
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
      `融資維持率今日 ${summary.marginMaintenance.todayRate.toFixed(2)}%，安全線 ${summary.marginMaintenance.safeLine.toFixed(2)}%，可用來觀察槓桿壓力是否升高。`,
    ],
    generatedAt: new Date().toISOString(),
    source: 'rules',
  };
}

async function fetchHomeMarketAiConclusion(summary: HomeMarketSummary): Promise<NonNullable<HomeMarketSummary['aiConclusion']>> {
  const fallback = buildRuleBasedMarketConclusion(summary);
  try {
    const response = await fetch('/api/home-market-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      cache: 'no-store',
      body: JSON.stringify({
        updateDate: summary.updateDate,
        monthLabel: summary.monthLabel,
        monthlyPrediction: {
          label: summary.monthlyPrediction.label,
          directionScore: summary.monthlyPrediction.directionScore,
          forecast: summary.monthlyPrediction.forecast,
        },
        dailyPrediction: summary.dailyPrediction,
        marketMood: summary.marketMood,
        marginMaintenance: {
          todayRate: summary.marginMaintenance.todayRate,
          safeLine: summary.marginMaintenance.safeLine,
          minLine: summary.marginMaintenance.minLine,
          unit: summary.marginMaintenance.unit,
        },
        latestMomentum: summary.marketFundMomentum.points[summary.marketFundMomentum.points.length - 1],
        previousMomentum: summary.marketFundMomentum.points[summary.marketFundMomentum.points.length - 2],
      }),
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    if (!data?.title || !data?.summary || !Array.isArray(data?.keyPoints)) return fallback;
    return {
      title: String(data.title).slice(0, 80),
      summary: String(data.summary).slice(0, 260),
      actionTone: String(data.actionTone || fallback.actionTone).slice(0, 160),
      keyPoints: data.keyPoints.slice(0, 4).map((point: unknown) => String(point).slice(0, 140)),
      generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : new Date().toISOString(),
      source: data.source === 'ai' ? 'ai' : 'rules',
    };
  } catch {
    return fallback;
  }
}

export async function fetchHomeMarketSummary(): Promise<HomeMarketSummary | null> {
  const cached = getHomeMarketSummaryCache();
  if (cached) return cached;

  const cloudSummary = await fetchCloudHomeMarketSummary();
  if (cloudSummary) {
    setHomeMarketSummaryCache(cloudSummary);
    return cloudSummary;
  }

  const [simons, firstZone, fallbackMomentumPoints, fallbackMargin] = await Promise.all([
    fetchLatestSimonsSnapshot(),
    fetchIfalgoIndexFirstZoneData(),
    fetchMonthlyMarketMomentum(),
    fetchCurrentMarginMaintenanceRate(),
  ]);
  const fallbackDailyPrediction = firstZone?.lastPtsTw?.pts ? null : await fetchSimonsDailyPrediction(simons.items);
  const fallbackScores = calculateSimonsMarketScores(simons.items, fallbackDailyPrediction);
  const scores = buildIfalgoMarketScores(firstZone, fallbackScores);
  const points = firstZone ? buildIfalgoMomentumPoints(firstZone) : fallbackMomentumPoints;
  const marginPoints = firstZone ? buildIfalgoMarginPoints(firstZone) : buildMarginSeries(fallbackMargin.rate);
  const marginRates = marginPoints.map(point => point.rate).filter(value => value > 0);
  const todayRate = parseMarketNumber(firstZone?.lastImrset?.lmrToday)
    || fallbackMargin.rate
    || HOME_MARGIN_POINTS[HOME_MARGIN_POINTS.length - 1].rate;
  const safeLine = parseMarketNumber(firstZone?.lastImrset?.boundary) || 151.4;
  const minLine = Math.min(...marginRates, 146.3);
  const updateDate = firstZone?.lastPtsTw?.mdate
    || firstZone?.lastImrset?.mdate
    || (simons.items.length > 0 ? simons.date : fallbackMargin.date);
  const summary: HomeMarketSummary = {
    updateDate,
    ...scores,
    marketMood: calculateMarketMood(
      points,
      scores.macroScore,
      scores.monthlyPrediction.score,
      scores.monthlyPrediction.label,
      scores.dailyPrediction.score,
      todayRate,
      safeLine
    ),
    marketFundMomentum: {
      points,
      momentumRange: [-1.5, 0],
      taiexRange: [2000, 48000],
    },
    marginMaintenance: {
      points: marginPoints,
      todayRate,
      safeLine,
      minLine,
      unit: '%',
    },
  };
  summary.aiConclusion = await fetchHomeMarketAiConclusion(summary);
  setHomeMarketSummaryCache(summary);
  return summary;
}

// 【Premium 專屬】基於 Simons 量化模型計算評分
export function calculateSimonsScore(
  item: SimonsItem,
  quantData: StockQuantData
): { advice: AIAdvice; text: string; kidText: string; score: number } {
  let score = 50; // 基礎分

  // ========== 1️⃣ AI推薦等級 (40分) ==========
  const remark = quantData.aiQuanBackDataComment?.remark ?? '';
  if (remark.includes('超高')) {
    score += 30; // 超高度 → +30 分
  } else if (remark.includes('高度')) {
    score += 22; // 高度 → +22 分
  } else if (remark.includes('中度')) {
    score += 12; // 中度 → +12 分
  } else if (remark.includes('低度')) {
    score += 2; // 低度 → +2 分
  }

  // ========== 2️⃣ 熱度值 PSR (30分) ==========
  const psr = item.psr || 0;
  // PSR 標準：7+ 優秀、5-7 正常、<5 低溫
  score += Math.max(-15, Math.min(20, (psr - 5) * 2));

  // ========== 3️⃣ 強度指標 Strength (20分) ==========
  const strength = parseFloat(item.strength) || 0;
  if (strength > 2.5) {
    score += 15; // 強度極佳
  } else if (strength > 2.0) {
    score += 12; // 強度優良
  } else if (strength > 1.5) {
    score += 8; // 強度不錯
  } else if (strength > 1.0) {
    score += 3; // 強度一般
  } else if (strength < 0.5) {
    score -= 12; // 強度偏弱
  }

  // ========== 4️⃣ 氣動指數 GVI (15分) ==========
  const gvi = item.gvi || 0;
  const mediangvi = parseFloat(item.mediangvi) || 0;
  // GVI > 中位數 表示資金流入強
  if (gvi > mediangvi * 1.2) {
    score += 12; // 資金流入明顯
  } else if (gvi > mediangvi) {
    score += 6; // 資金流入溫和
  } else if (gvi < mediangvi * 0.8) {
    score -= 10; // 資金流出明顯
  }

  // ========== 5️⃣ 籌碼穩定度 Chip Stability (10分) ==========
  const chipPts = quantData.chipStability ? parseFloat(quantData.chipStability.pts) : null;
  if (chipPts !== null) {
    if (chipPts >= 8) {
      score += 10; // 最乾淨
    } else if (chipPts >= 6) {
      score += 6; // 很穩定
    } else if (chipPts >= 4) {
      score += 2; // 穩定
    } else if (chipPts < 2) {
      score -= 8; // 凌亂
    }
  }

  // ========== 6️⃣ 累積報酬信心度 (可選) ==========
  const cumRet = quantData.aiQuanBackDataComment?.cum_ret ?? '';
  const cumRetNum = parseFloat(cumRet);
  if (!isNaN(cumRetNum)) {
    if (cumRetNum > 100) {
      score += 5; // 歷史回測超群
    } else if (cumRetNum > 50) {
      score += 3;
    } else if (cumRetNum < 0) {
      score -= 5; // 負報酬警示
    }
  }

  // ========== 邊界限制 ==========
  score = Math.max(0, Math.min(100, score));

  let advice: AIAdvice;
  let text: string;
  let kidText: string;

  // 評級邏輯（根據 Simons 五維評分）
  if (score >= 75) {
    advice = 'buy';
    text = `Simons 量化評分 ${score}分！AI推薦等級高、籌碼穩定、資金流入明顯，強烈建議買進。`;
    kidText = `🐻 Simons說：「這間公司五個指標都亮綠燈！考了 ${score} 分，是天選之股～」 🌟`;
  } else if (score >= 60) {
    advice = 'buy';
    text = `Simons 量化評分 ${score}分，多數指標向好，建議可以考慮買進。`;
    kidText = `🐻 Simons說：「這間公司表現不錯，考了 ${score} 分，可以買喔～」 👍`;
  } else if (score >= 45) {
    advice = 'hold';
    text = `Simons 量化評分 ${score}分，指標混合訊號，建議繼續觀望。`;
    kidText = `🐻 Simons說：「這間公司還在考慮中，考了 ${score} 分，先看看～」 🤔`;
  } else if (score >= 30) {
    advice = 'hold';
    text = `Simons 量化評分 ${score}分，部分指標偏弱，建議保守等待。`;
    kidText = `🐻 Simons說：「這間公司最近比較普通，考了 ${score} 分，先不急喔～」 😐`;
  } else {
    advice = 'sell';
    text = `Simons 量化評分 ${score}分，多數指標偏弱，建議避免或考慮出場。`;
    kidText = `🐻 Simons說：「這間公司現在不太好，只有 ${score} 分，先等等吧～」 ❌`;
  }

  return { advice, text, kidText, score };
}

// 計算 AI 投資建議
export function calculateAdvice(item: SimonsItem): { advice: AIAdvice; text: string; kidText: string; score: number } {
  const psr = item.psr || 0;
  const strength = parseFloat(item.strength) || 0;
  const close = parseFloat(item.close) || 0;
  const wtcost = parseFloat(item.wtcost) || 0;
  const fcost = parseFloat(item.fcost) || 0;
  const retW = item.ret_w;
  const retM = item.ret_m;
  const unusual = item.unusual;

  let score = 50; // 基礎分

  // PSR 評分 (10分制 → 30分佔比)
  score += (psr - 5) * 6;

  // 趨勢加分
  if (retW === 'rise') score += 8;
  if (retM === 'rise') score += 8;
  if (retW === 'drop') score -= 8;
  if (retM === 'drop') score -= 8;

  // 強度加分
  if (strength > 2) score += 10;
  else if (strength > 1.5) score += 5;
  else if (strength < 0.5) score -= 10;

  // 法人成本比較
  if (close < wtcost && close < fcost) {
    score += 10; // 收盤價低於法人成本 → 有空間
  } else if (close > wtcost * 1.1 && close > fcost * 1.1) {
    score -= 5; // 收盤價遠高於法人成本 → 注意
  }

  // 異常訊號
  if (unusual && unusual !== 'N') {
    if (unusual.includes('紅K') || unusual.includes('上影線')) {
      score += 3;
    }
  }

  // 邊界限制
  score = Math.max(0, Math.min(100, score));

  let advice: AIAdvice;
  let text: string;
  let kidText: string;

  if (score >= 70) {
    advice = 'buy';
    text = `股票本質 ${score}分，地基較穩，趨勢向上且有法人成本支撐；是否加碼仍需搭配加碼時機燈號。`;
    kidText = `PPBear 說：「這間公司最近表現很棒，就像考試考了 ${score} 分！很多投資大人都在買這檔股票喔，可以考慮買一些～」 🐻👍`;
  } else if (score >= 40) {
    advice = 'hold';
    text = `股票本質 ${score}分，地基尚可但趨勢不明確；建議等待加碼時機燈號更清楚。`;
    kidText = `PPBear 說：「這間公司最近表現還可以，考了 ${score} 分，不算差但也不是最好。我們先看看，不急著買或賣唷！」 🐻🤔`;
  } else {
    advice = 'sell';
    text = `股票本質 ${score}分，地基偏弱且趨勢較不利；建議保守處理，不因短線燈號單獨加碼。`;
    kidText = `PPBear 說：「這間公司最近比較辛苦，只有 ${score} 分...如果你有買的話，可以考慮先賣掉，把錢存起來等更好的機會喔！」 🐻💤`;
  }

  return { advice, text, kidText, score };
}

// 轉換為推薦格式
export function toRecommendation(
  item: SimonsItem,
  quantData?: StockQuantData
): StockRecommendation {
  // 如果有量化資料且有 AI 推薦等級，使用 Premium Simons 評分
  let result;
  if (quantData?.aiQuanBackDataComment) {
    result = calculateSimonsScore(item, quantData);
  } else {
    result = calculateAdvice(item);
  }

  const { advice, text, kidText, score } = result;
  return {
    ...item,
    advice,
    adviceText: text,
    kidAdvice: kidText,
    score,
  };
}

// 轉換為股票報價格式
export function simonsToQuote(item: SimonsItem): StockQuote {
  const close = parseFloat(item.close) || 0;
  return {
    code: item.coid,
    name: item.stkname,
    price: close,
    change: 0,
    changePercent: 0,
    pe: 0,
    pb: 0,
    volume: 0,
    industry: item.category || '',
    status: item.status || '',
    kidFriendlyDesc: makeKidFriendly(item.coid || '', item.stkname || '', item.status || '', item.category || ''),
  };
}

// 熱門股票列表（預設推薦）
export const POPULAR_STOCKS = [
  { code: '2330', name: '台積電', emoji: '🏭' },
  { code: '2317', name: '鴻海', emoji: '📱' },
  { code: '2454', name: '聯發科', emoji: '📡' },
  { code: '2412', name: '中華電', emoji: '📶' },
  { code: '2881', name: '富邦金', emoji: '🏦' },
  { code: '2882', name: '國泰金', emoji: '💳' },
  { code: '2303', name: '聯電', emoji: '⚡' },
  { code: '3711', name: '日月光', emoji: '🌙' },
  { code: '2308', name: '台達電', emoji: '🔋' },
  { code: '2383', name: '台光電', emoji: '💡' },
  { code: '1301', name: '台塑', emoji: '🧪' },
  { code: '2002', name: '中鋼', emoji: '🔩' },
];

// 產業分類
export const INDUSTRY_CATEGORIES = [
  { key: 'all', label: '全部', emoji: '🌟' },
  { key: '半導體', label: '半導體', emoji: '🧠' },
  { key: '電子組件', label: '電子', emoji: '🔩' },
  { key: '金融', label: '金融', emoji: '🏦' },
  { key: '電機機械', label: '機械', emoji: '⚙️' },
  { key: '光電', label: '光電', emoji: '💡' },
  { key: '傳產', label: '傳產', emoji: '🏗️' },
];