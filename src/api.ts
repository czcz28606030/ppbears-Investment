import type { StockData, SimonsItem, StockQuote, StockRecommendation, AIAdvice, StockLiveAnalysis } from './types';

const IFALGO_BASE = '/api/ifalgo';

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
// Simons 每日推薦快取 TTL：30 分鐘（Simons 盤後更新，但寧可多抓幾次也不錯過）
const SIMONS_DATA_TTL_MS = 30 * 60 * 1000;

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
async function fetchMISRealtime(code: string, market: 'tse' | 'otc'): Promise<{ price: number; name: string; date: string } | null> {
  try {
    const url = `/api/mis/getStockInfo.jsp?ex_ch=${market}_${code}.tw&json=1&delay=0`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const item = json?.msgArray?.[0];
    if (!item) return null;
    const name: string = item.n || item.nf || '';
    const date: string = item.d || '';
    // z = 最新成交價，若 "-" 表示目前無成交（如鎖漲停），取 h（今日最高）
    const zRaw = item.z;
    const hRaw = item.h;
    const price = (zRaw && zRaw !== '-') ? parseFloat(zRaw) : (hRaw && hRaw !== '-' ? parseFloat(hRaw) : 0);
    if (!price || price <= 0) return null;
    return { price, name, date };
  } catch {
    return null;
  }
}

/**
 * 統一入口：優先使用 MIS 即時報價（盤中/漲跌停即時反映），
 * 再 fallback 到 TWSE/TPEx OpenAPI 昨日收盤。
 * 回傳 { price, name, date } —— date 為西元 YYYYMMDD 格式
 */
export async function fetchOfficialClosePrice(code: string): Promise<{ price: number; name: string; date: string } | null> {
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

export function makeKidFriendly(_code: string, name: string, status: string, _industry: string): string {
  if (status?.includes('全球第一') || status?.includes('全球最大')) {
    return `這是一間世界第一名的大公司！他們把產品賣到全世界各地，真的超厲害！🏆🌍`;
  }
  if (status?.includes('台灣') || name) {
    return `這是一間在台灣努力打拼的好公司！他們認真製造很棒的產品給大家使用喔！🇹🇼🏢`;
  }
  return '一間認真做事、努力賺錢，也為社會貢獻的好公司 🏢✨';
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
    const response = await fetch(`${supabaseUrl}/functions/v1/get-kid-description`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`,
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
  const cacheKey = `ppbears_daily_analysis_${code}`;
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
      technical: data.technical,
      chips: data.chips,
      news: data.news,
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
    const res = await fetch(url);
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
  currentSignal: 'buy' | 'sell' | 'neutral'; // 從 aiQuanBackDataTradingList 最新一筆 sell_sig 判斷
}

export async function fetchStockQuantData(coid: string): Promise<StockQuantData> {
  const empty: StockQuantData = { aiQuanBackDataComment: null, chipStability: null, stockInfo: null, currentSignal: 'neutral' };
  // v5: 改用 30 分鐘 TTL 快取（原每日快取會讓訊號延遲整天，盤中訊號不可接受）
  const cacheKey = `ppbears_quant30_${coid}`;
  const cached = getTTLCache<StockQuantData>(cacheKey);
  if (cached) return cached;
  try {
    const url = `${IFALGO_BASE}/stock?coid=${coid}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    const stock = json.data?.stock;
    const pos = stock?.position;
    if (!stock) return empty;

    // ── 從 aiQuanBackDataTradingList 判斷目前訊號 ──────────────────────────────
    // 判斷邏輯（優先序由高到低）：
    //   1. 最後一筆「沒有 out_date」或 sell_sig 屬於進場類    → AI 持倉中  → 「AI 進場」
    //   2. 最後一筆「有 out_date」且 sell_sig 屬於出場類      → AI 已出場  → 「AI 出場」
    //   3. 其餘（sell_sig='中立'、空值、或無任何紀錄）        → 無明確方向 → 「AI 中立」
    //
    // ⚠️ 重要：sell_sig 實際值依 IFAlgo API 有：
    //   進場類：'進場' | '加碼' | '買進' | 'buy'
    //   出場類：'出場' | '賣出' | '減碼' | 'sell'
    //   中立類：'中立' | '' | null | undefined
    const BUY_SIGS  = new Set(['進場', '加碼', '買進', 'buy',  'Buy',  'BUY']);
    const SELL_SIGS = new Set(['出場', '賣出', '減碼', 'sell', 'Sell', 'SELL']);

    const tradingList: any[] = stock.aiQuanBackDataTradingList || [];
    let currentSignal: 'buy' | 'sell' | 'neutral' = 'neutral';
    if (tradingList.length > 0) {
      const last = tradingList[tradingList.length - 1];
      const outDate: string = (last?.out_date ?? '').trim();
      const sig: string     = (last?.sell_sig  ?? '').trim();
      // 沒有出場日期 → 仍在持倉中
      const hasOpenPosition = !outDate || outDate === 'NA' || outDate === 'null' || outDate === '-';
      console.log(`[QuantData] ${coid} | out_date='${outDate}' | sell_sig='${sig}' | hasOpenPosition=${hasOpenPosition}`);

      if (hasOpenPosition || BUY_SIGS.has(sig)) {
        currentSignal = 'buy';    // AI 持倉中或明確進場訊號 → AI 進場
      } else if (SELL_SIGS.has(sig)) {
        currentSignal = 'sell';   // AI 明確出場訊號 → AI 出場
      } else {
        currentSignal = 'neutral'; // 中立或未知 → AI 中立
      }
    }

    const result: StockQuantData = {
      aiQuanBackDataComment: stock.aiQuanBackDataComment ?? null,
      chipStability: pos?.chipStability ?? null,
      stockInfo: pos?.stockInfo ?? null,
      currentSignal,
    };
    // 寫入 30 分鐘 TTL 快取
    setTTLCache(cacheKey, result, QUANT_SIGNAL_TTL_MS);
    return result;
  } catch (err) {
    console.error('fetchStockQuantData error:', err);
    return empty;
  }
}

// 取得 Simons 每日推薦
// 改用 30 分鐘 TTL 快取：Simons 資料盤後更新，但寧可多抓幾次也不用一整天的舊資料
export async function fetchSimonsData(date?: string): Promise<SimonsItem[]> {
  const d = date || _todayStr();
  // 指定日期查詢（歷史資料）時仍用每日快取；今日資料用 30 分鐘 TTL
  const isToday = !date || date === _todayStr();
  const cacheKey = isToday
    ? `ppbears_simons30_${d}`          // 今日：30 分鐘 TTL
    : `ppbears_daily_simons_${d}`;     // 歷史：每日快取
  const cached = isToday
    ? getTTLCache<SimonsItem[]>(cacheKey)
    : getDailyCache<SimonsItem[]>(cacheKey);
  if (cached) return cached;
  try {
    const url = `${IFALGO_BASE}/common/getSimonsData?searchDate=${d}&_t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json();
    const items: SimonsItem[] = json.data?.dataItems || [];
    if (items.length > 0) {
      if (isToday) {
        setTTLCache(cacheKey, items, SIMONS_DATA_TTL_MS);
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
    text = `綜合評分 ${score}分，趨勢向上，法人成本支撐，建議可以考慮買進。`;
    kidText = `PPBear 說：「這間公司最近表現很棒，就像考試考了 ${score} 分！很多投資大人都在買這檔股票喔，可以考慮買一些～」 🐻👍`;
  } else if (score >= 40) {
    advice = 'hold';
    text = `綜合評分 ${score}分，趨勢不明確，建議觀望等待更好的機會。`;
    kidText = `PPBear 說：「這間公司最近表現還可以，考了 ${score} 分，不算差但也不是最好。我們先看看，不急著買或賣唷！」 🐻🤔`;
  } else {
    advice = 'sell';
    text = `綜合評分 ${score}分，趨勢偏弱，建議保守或考慮出場。`;
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
