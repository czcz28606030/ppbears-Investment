import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { getWeeklyTop } from './weekly-top.js';
import { mergeAndSaveStrategyJournal } from './strategy-journal.js';
import type { StockPrice } from '../types.js';
import type { WeeklyTopPayload } from '../utils/weeklyTop.js';
import { normalizeTwseHistory, normalizeTpexHistory, getOfficialHistoryMonths } from '../utils/officialStockHistory.js';
import { evaluateTrendStrategy, STRATEGY_SOURCE, type StrategyTrade, type StrategySignalsPayload, type WeeklyMembership } from '../utils/trendStrategy.js';

const taipeiDate = (timestamp = Date.now()) => new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10);
const db = () => createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }) } });
type MarketPrice = { name: string; close: number; date: string; market: 'listed' | 'otc'; change: string; volume: number };
let priceMapCache: { at: number; value: Record<string, MarketPrice> } | null = null;
let weeklyCache: { at: number; value: WeeklyTopPayload } | null = null;
const priceCache = new Map<string, { at: number; value: StockPrice[] }>();
const pricePending = new Map<string, Promise<StockPrice[]>>();
const num = (value: unknown) => Number(String(value ?? '').replace(/,/g, ''));
const isoDate = (value: unknown) => {
  const raw = String(value ?? '').replace(/\D/g, '');
  const digits = raw.length === 7 ? `${Number(raw.slice(0, 3)) + 1911}${raw.slice(3)}` : raw;
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : '';
};
async function json(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`官方行情來源 HTTP ${response.status}`);
  return response.json();
}
export async function getStrategyMarketMap(): Promise<Record<string, MarketPrice>> {
  if (priceMapCache && Date.now() - priceMapCache.at < 300000) return priceMapCache.value;
  const results = await Promise.allSettled([
    json('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'),
    json('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'),
  ]);
  const map: Record<string, MarketPrice> = {};
  results.forEach((result, i) => {
    if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return;
    result.value.forEach(row => {
      const code = String(i === 0 ? row.Code : row.SecuritiesCompanyCode);
      const close = num(i === 0 ? row.ClosingPrice : row.Close);
      const date = isoDate(row.Date);
      if (/^\d{4,6}$/.test(code) && close > 0 && date) map[code] = { name: String(i === 0 ? row.Name : row.CompanyName), close, date, market: i === 0 ? 'listed' : 'otc', change: String(row.Change || 0), volume: num(i === 0 ? row.TradeVolume : row.TradingShares) / 1000 };
    });
  });
  // The OpenAPI host may reject cloud reads. Keep OTC market identification on the
  // exchange's own after-trading endpoint rather than silently treating OTC codes as absent.
  if (!Object.values(map).some(price => price.market === 'otc')) {
    const fallback = await json('https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?response=json').catch(() => null) as { date?: string; stat?: string; tables?: Array<{ data?: unknown[][] }> } | null;
    const date = isoDate(fallback?.date);
    if (String(fallback?.stat).toLowerCase() === 'ok' && date) {
      for (const row of fallback?.tables?.[0]?.data || []) {
        const code = String(row[0]); const close = num(row[2]);
        if (/^\d{4,6}$/.test(code) && close > 0) map[code] = { name: String(row[1]), close, date, market: 'otc', change: String(row[3] || 0), volume: num(row[8]) / 1000 };
      }
    }
  }
  if (!Object.keys(map).length) throw new Error('官方收盤來源暫時無法讀取');
  if (Object.values(map).some(price => price.market === 'listed') && Object.values(map).some(price => price.market === 'otc')) priceMapCache = { at: Date.now(), value: map };
  return map;
}
export async function getStrategyWeekly(): Promise<WeeklyTopPayload> {
  if (weeklyCache && Date.now() - weeklyCache.at < 300000) return weeklyCache.value;
  const value = await getWeeklyTop();
  weeklyCache = { at: Date.now(), value };
  return value;
}

export async function getStrategyPrices(code: string, market?: 'listed' | 'otc'): Promise<StockPrice[]> {
  if (!/^\d{4,6}$/.test(code)) throw new Error('股票代號格式不正確');
  const cache = priceCache.get(code);
  if (cache && Date.now() - cache.at < 900000) return cache.value;
  const pending = pricePending.get(code);
  if (pending) return pending;
  const task = (async () => {
    const resolvedMarket = market || (await getStrategyMarketMap())[code]?.market;
    if (!resolvedMarket) return [];
    const today = taipeiDate();
    const since = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); since.setUTCMonth(since.getUTCMonth() - 8);
    const months = getOfficialHistoryMonths(since.toISOString().slice(0, 10), today, 12);
    const monthly: StockPrice[] = [];
    // Bound provider requests. Missing months produce incomplete signals, never invented OHLC.
    for (let start = 0; start < months.length; start += 3) {
      const batch = await Promise.allSettled(months.slice(start, start + 3).map(async month => {
        const payload = resolvedMarket === 'listed'
          ? await json(`https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${month}&stockNo=${code}`)
          : await json(`https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${code}&date=${month.slice(0, 4)}/${month.slice(4, 6)}/01&response=json`);
        const normalized = resolvedMarket === 'listed' ? normalizeTwseHistory(code, payload) : normalizeTpexHistory(code, payload);
        const raw = payload as { stat?: string; data?: unknown[]; tables?: Array<{ data?: unknown[] }> };
        const rows = resolvedMarket === 'listed' ? raw?.data : raw?.tables?.[0]?.data;
        if (String(raw?.stat || '').toLowerCase() !== 'ok') {
          // Providers return a no-data response for IPO months or the not-yet-open current month.
          if (String(raw?.stat || '').includes('沒有符合條件的資料') || String(raw?.stat || '').includes('查無資料')) return [];
          throw new Error('官方日K回應異常，等待來源恢復');
        }
        if (!Array.isArray(rows) || normalized.length !== rows.length) throw new Error('官方日K有無法核對的資料列');
        return normalized;
      }));
      if (batch.some(result => result.status === 'rejected')) throw new Error('官方日K月份擷取不完整，暫停訊號並等待重試');
      batch.forEach(result => { if (result.status === 'fulfilled') monthly.push(...result.value); });
    }
    const byDate = new Map(monthly.map(price => [price.mdate, price]));
    const prices = [...byDate.values()].filter(price => price.mdate <= today).sort((a, b) => a.mdate.localeCompare(b.mdate));
    if (prices.length) priceCache.set(code, { at: Date.now(), value: prices });
    return prices;
  })();
  pricePending.set(code, task);
  try { return await task; } finally { pricePending.delete(code); }
}

// Existing backtest_cache has a separate namespace for observed weekly snapshots.
// The first observation is immutable; no schema changes and no legacy-data deletion.
export async function collectWeeklyStrategySnapshot() {
  const weekly = await getStrategyWeekly();
  const hash = createHash('sha256').update(JSON.stringify(weekly.items.map(item => [item.ticker, item.rank, item.weekEndDate]))).digest('hex').slice(0, 16);
  const key = `weekly-snapshot-v1:${taipeiDate()}:${hash}`;
  const { error } = await db().from('backtest_cache').upsert({ cache_key: key, config: { type: 'weekly-snapshot-v1' },
    result_summary: { source: STRATEGY_SOURCE, weekly, observedAt: new Date().toISOString() }, trade_count: 0 }, { onConflict: 'cache_key', ignoreDuplicates: true });
  if (error) throw new Error('週榜觀測快照保存失敗');
  return { saved: true, count: weekly.items.length, weekEndDate: weekly.weekEndDate };
}

async function loadMembershipHistory(): Promise<WeeklyMembership[]> {
  const { data, error } = await db().from('backtest_cache').select('result_summary').like('cache_key', 'weekly-snapshot-v1:%').order('computed_at', { ascending: false }).limit(400);
  if (error) return [];
  return (data || []).flatMap(row => {
    const record = row.result_summary as { observedAt?: string; weekly?: WeeklyTopPayload };
    if (!record.observedAt || !record.weekly?.items?.length) return [];
    const observed = new Date(record.observedAt);
    // Observations made after TW market close may only qualify the next calendar day.
    const shifted = new Date(observed.getTime() + 8 * 3600000);
    const afterClose = shifted.getUTCHours() * 60 + shifted.getUTCMinutes() >= 13 * 60 + 30;
    return [{ availableDate: taipeiDate(observed.getTime() + (afterClose ? 86400000 : 0)), weekEndDate: record.weekly.weekEndDate, codes: record.weekly.items.map(item => item.ticker) }];
  });
}

export async function getStrategySignalsForUser(userId: string, codes: string[]): Promise<StrategySignalsPayload> {
  const wanted = [...new Set(codes)].filter(code => /^\d{4,6}$/.test(code)).slice(0, 60);
  const client = db();
  const [holdingsResult, accountResult, mapResult, weeklyResult] = await Promise.all([
    client.from('holdings').select('stock_code,total_shares,avg_cost,current_price').eq('user_id', userId),
    client.from('users').select('available_balance').eq('id', userId).single(),
    getStrategyMarketMap().catch(() => ({} as Record<string, MarketPrice>)),
    getStrategyWeekly().catch(() => null),
  ]);
  if (holdingsResult.error || accountResult.error) throw new Error('無法讀取登入帳戶的持倉與現金');
  const holdings = holdingsResult.data || [];
  const cash = num(accountResult.data.available_balance);
  // Refuse to size adds against unverifiable holdings prices.
  const allHoldingsPriced = holdings.every(row => !(num(row.total_shares) > 0) || Boolean(mapResult[row.stock_code]));
  const equity = allHoldingsPriced ? cash + holdings.reduce((sum, row) => sum + num(row.total_shares) * (mapResult[row.stock_code]?.close || 0), 0) : 0;
  const trades: Array<{ stock_code: string; trade_type: string; quantity: number; price: number; timestamp: number }> = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await client.from('trades').select('stock_code,trade_type,quantity,price,timestamp').eq('user_id', userId)
      .in('stock_code', wanted).in('trade_type', ['buy', 'sell']).order('timestamp', { ascending: true }).range(start, start + 999);
    if (error) throw new Error('無法核對登入帳戶的交易紀錄');
    trades.push(...(data || []));
    if (!data || data.length < 1000) break;
    if (start >= 19000) throw new Error('交易紀錄超過單次核對範圍，暫停訊號');
  }
  if (weeklyResult) await collectWeeklyStrategySnapshot().catch(() => {});
  const history = await loadMembershipHistory();
  const signals: StrategySignalsPayload['signals'] = {};
  for (let start = 0; start < wanted.length; start += 4) {
    const results = await Promise.all(wanted.slice(start, start + 4).map(async code => {
      const row = holdings.find(h => h.stock_code === code);
      const prices = await getStrategyPrices(code, mapResult[code]?.market).catch(() => []);
      // Official data may contain today's partial bar: only use completed TW sessions.
      const twNow = new Date(Date.now() + 8 * 3600000);
      const completedDate = twNow.getUTCHours() * 60 + twNow.getUTCMinutes() < 14 * 60 ? taipeiDate(Date.now() - 86400000) : taipeiDate();
      const bars = prices.filter(price => price.mdate <= completedDate).map(price => ({ date: price.mdate, open: num(price.open_d), high: num(price.high_d), low: num(price.low_d), close: num(price.close_d), volume: price.volume }));
      const stockTrades: StrategyTrade[] = trades.filter(t => t.stock_code === code).map(t => ({ date: taipeiDate(Number(t.timestamp)), timestamp: Number(t.timestamp), type: t.trade_type as 'buy' | 'sell', quantity: num(t.quantity), price: num(t.price) }));
      const weeklyItem = weeklyResult?.items.find(item => item.ticker === code);
      return evaluateTrendStrategy({ code, bars, weeklyRank: weeklyItem?.rank ?? null, weeklyDate: weeklyResult?.weekEndDate || '', weeklyAvailable: Boolean(weeklyResult),
        nowDate: taipeiDate(), latestPriceDate: mapResult[code]?.date || '', holding: row && num(row.total_shares) > 0 ? { quantity: num(row.total_shares), avgCost: num(row.avg_cost) } : null,
        trades: stockTrades, equity, cash, history });
    }));
    results.forEach(decision => { signals[decision.code] = decision; });
  }
  return mergeAndSaveStrategyJournal(client, userId, { source: STRATEGY_SOURCE, generatedAt: new Date().toISOString(), signals });
}
