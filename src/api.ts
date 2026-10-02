import { fetchMarketResponse } from './utils/marketRequest';
import type { StockData, StockPrice, SimonsItem, StockQuote, StockRecommendation, AIAdvice, StockLiveAnalysis, StockTradingSignal } from './types';
import { supabase } from './supabase';

import type { StrategySignalsPayload } from './utils/trendStrategy';
import { getStockIndustryFromSource } from './data/stockIndustryClassifications';
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
  try { localStorage.setItem(key, JSON.stringify({ date: _todayStr(), data })); } catch { /* Browser storage can be unavailable. */ }
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
  } catch { /* Browser storage can be unavailable. */ }
}
/** 清除指定 key 的 TTL 快取（手動強制刷新用） */
export function clearTTLCache(key: string): void {
  try { localStorage.removeItem(key); } catch { /* Browser storage can be unavailable. */ }
}

/** 清除所有本機量化訊號 TTL 快取，避免手動刷新時仍吃到舊瀏覽器暫存。 */
export function clearQuantSignalTTLCache(): void {
  try {
    const keys = Object.keys(localStorage).filter(key => key.startsWith('ppbears_quant30_'));
    keys.forEach(key => localStorage.removeItem(key));
  } catch { /* Browser storage can be unavailable. */ }
}

/** 清除 Simons 每日推薦 TTL 快取，手動刷新後需重新讀雲端每日快取。 */
export function clearSimonsDataTTLCache(): void {
  try {
    const keys = Object.keys(localStorage).filter(key => key.startsWith('ppbears_simons_daily7_'));
    keys.forEach(key => localStorage.removeItem(key));
  } catch { /* Browser storage can be unavailable. */ }
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
// Simons 每日推薦由雲端每日 08:00 預抓；本機保存到隔天早上 10 點，手動刷新可再檢查一次。
const OFFICIAL_PRICE_MAP_CACHE_KEY = 'ppbears_official_price_map_daily_7am_v2';

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
  } catch { /* Browser storage can be unavailable. */ }
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
  return { simonsStatus: 'unknown', source: 'retired', snapshotOk: 0, snapshotTotal: stockCodes.length };
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

export async function fetchOfficialPriceMap(options: { forceFresh?: boolean } = {}): Promise<OfficialPriceMap> {
  if (options.forceFresh) {
    clearOfficialPriceMapCache();
    twseCache = null;
    tpexCache = null;
  }
  const cacheKey = OFFICIAL_PRICE_MAP_CACHE_KEY;
  const cached = getTTLCache<OfficialPriceMap>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchMarketResponse(`/api/app-cache?type=official-prices${options.forceFresh ? '&fresh=1' : ''}`);
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
      const items: Array<Record<string, string>> = await res.json();
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
      const items: Array<Record<string, string>> = await res.json();
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
  const cacheKey = `ppbears_daily_analysis_official_v3_${code}`;
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
export async function fetchStrategySignals(codes: string[], options: { forceFresh?: boolean } = {}): Promise<StrategySignalsPayload | null> {
  const unique = [...new Set(codes.map(code => String(code).trim()).filter(code => /^\d{4,6}$/.test(code)))];
  if (!unique.length) return null;
  const sessionResult = supabase ? await supabase.auth.getSession() : null;
  const token = sessionResult?.data.session?.access_token;
  if (!token) throw new Error('請先登入以取得帳戶策略訊號');
  const params = new URLSearchParams({ type: 'strategy-signals', coids: unique.join(',') });
  if (options.forceFresh) params.set('fresh', String(Date.now()));
  const response = await fetch(`/api/app-cache?${params.toString()}`, {
    cache: 'no-store', headers: { accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`策略訊號讀取失敗 (${response.status})`);
  const payload = await response.json() as StrategySignalsPayload;
  if (payload?.source !== 'weekly-trend-v1' || typeof payload.generatedAt !== 'string' || !payload.signals || typeof payload.signals !== 'object' || Array.isArray(payload.signals)) throw new Error('策略訊號資料格式錯誤');
  const allowedActions = new Set(['entry', 'neutral', 'add', 'hold', 'reduce', 'exit', 'unavailable']);
  for (const code of unique) {
    const decision = payload.signals[code];
    if (!decision || decision.code !== code || decision.source !== 'weekly-trend-v1' || !allowedActions.has(decision.action)
      || !['ready', 'unavailable'].includes(decision.status) || typeof decision.label !== 'string' || typeof decision.reason !== 'string' || !Array.isArray(decision.events)
      || typeof decision.held !== 'boolean' || typeof decision.dataDate !== 'string' || typeof decision.weeklyDate !== 'string'
      || !Number.isFinite(decision.suggestedQuantity) || decision.suggestedQuantity < 0) throw new Error('策略訊號資料不完整');
    const indicators = [decision.close, decision.ma20, decision.ma60, decision.breakoutPrice, decision.atr, decision.initialRisk, decision.protectionPrice, decision.addTriggerPrice, decision.weeklyRank];
    if (indicators.some(value => value !== null && (typeof value !== 'number' || !Number.isFinite(value)))) throw new Error('策略指標格式錯誤');
    if (decision.events.some(event => !event || !['entry', 'add', 'reduce', 'exit'].includes(event.action)
      || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || typeof event.label !== 'string' || typeof event.reason !== 'string')) throw new Error('策略事件格式錯誤');
  }
  return payload;
}

export async function fetchStrategyPrices(code: string, market?: 'listed' | 'otc'): Promise<StockPrice[]> {
  if (!/^\d{4,6}$/.test(code)) throw new Error('股票代號格式錯誤');
  const params = new URLSearchParams({ type: 'strategy-prices', coid: code });
  if (market) params.set('market', market);
  const response = await fetch(`/api/app-cache?${params.toString()}`, { cache: 'no-store', headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`官方日 K 讀取失敗 (${response.status})`);
  const payload = await response.json() as { source?: string; prices?: StockPrice[] };
  if (payload.source !== 'official-daily' || !Array.isArray(payload.prices)) throw new Error('官方日 K 資料格式錯誤');
  return payload.prices;
}

export async function fetchStockData(coid: string): Promise<StockData | null> {
  if (!/^\d{4,6}$/.test(coid)) return null;
  try {
    const map = await fetchOfficialPriceMap();
    const entry = map[coid];
    const prices = await fetchStrategyPrices(coid, entry?.market);
    if (!entry && !prices.length) return null;
    return { coid, stkname: entry?.name || POPULAR_STOCKS.find(s => s.code === coid)?.name || coid,
      subindustry: getStockIndustryFromSource(coid) || '', status: entry?.market === 'otc' ? '上櫃' : entry?.market === 'listed' ? '上市' : '', prices };
  } catch (error) { console.error('fetchStockData official history error:', error); return null; }
}

export type OfficialStockHistoryPayload = {
  coid: string;
  market: 'listed' | 'otc';
  sinceDate: string;
  latestDate: string;
  source: 'twse-stock-day' | 'tpex-trading-stock';
  prices: StockPrice[];
  generatedAt: string;
};

export async function fetchOfficialStockHistory(
  coid: string,
  market: 'listed' | 'otc',
  sinceDate = '',
): Promise<OfficialStockHistoryPayload | null> {
  try {
    const params = new URLSearchParams({ type: 'official-stock-history', coid, market });
    if (sinceDate) params.set('sinceDate', sinceDate);
    const response = await fetch(`/api/app-cache?${params.toString()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload = await response.json() as OfficialStockHistoryPayload;
    return Array.isArray(payload?.prices) ? payload : null;
  } catch (error) {
    console.error('fetchOfficialStockHistory error:', error);
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

export async function fetchStockTradingSignals(_coid: string): Promise<StockTradingSignalsPayload | null> {
  void _coid;
  return null;
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
  reentryAfterExit: {
    hasReentry: boolean;
    exitDate: string;
    entryDate: string;
  } | null;
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
  source: 'goodinfo' | 'finmind';
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
  void coid; void days;
  return [];
}

export async function fetchSimonsRecommendationCounts(coids: string[], days = 90): Promise<Record<string, number>> {
  void coids; void days;
  return {};
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
  void coid; void days;
  return null;
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

export async function fetchStockQuantData(_coid: string, _sinceDate?: string, _options: { forceFresh?: boolean } = {}): Promise<StockQuantData> {
  void _coid; void _sinceDate; void _options;
  return { aiQuanBackDataComment: null, chipStability: null, stockInfo: null, currentSignal: 'neutral',
    signalStreak: { signal: null, count: 0 }, reentryAfterExit: null,
    meta: { source: 'empty', dataDate: '', fetchedAt: new Date().toISOString(), fixedUpdateTime: '已停用', scheduleLabel: '舊訊號已停用，請改用週榜趨勢訊號', cacheStatus: 'miss' } };
}

export async function fetchSimonsData(_date?: string, _options: { forceFresh?: boolean; updateSharedCache?: boolean } = {}): Promise<SimonsItem[]> {
  void _date; void _options;
  return [];
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

/** Retired predictions are never read from local or shared caches. */
function getHomeMarketSummaryCache(): null {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ppbears_home_market_summary_')) localStorage.removeItem(key);
    }
  } catch { /* Browser storage can be unavailable. */ }
  return null;
}

export async function fetchHomeMarketSummary(): Promise<HomeMarketSummary | null> {
  return getHomeMarketSummaryCache();
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
