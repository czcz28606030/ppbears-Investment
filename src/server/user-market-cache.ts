import type { VercelRequest } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const WATCHLIST_CACHE_VERSION = 'score-fallback-kline-v3';
const PORTFOLIO_CACHE_VERSION = 'portfolio-signal-rich-v2';
const AI_SYNC_LABEL = '08:00 自動檢查；可手動重新抓取';
const AI_SYNC_SCHEDULE_LABEL = 'AI訊號每日 08:00 檢查 Simons 完成狀態；手動重新抓取可再檢查一次；價格資料獨立更新';

type Surface = 'watchlist' | 'portfolio';

type UserRow = {
  id: string;
  role: 'parent' | 'child';
  parent_id: string | null;
  tier: 'free' | 'premium';
  is_admin: boolean;
  subscription_expires_at: string | null;
};

type FeatureOverrideRow = {
  user_id: string;
  feature_key: string;
  enabled: boolean;
};

type HoldingRow = {
  user_id: string;
  stock_code: string;
  stock_name: string;
  total_shares: number | string;
  avg_cost: number | string;
  current_price: number | string;
  industry: string | null;
};

type WatchlistRow = {
  id: string;
  user_id: string;
  stock_code: string;
  stock_name: string;
  added_price: number | string | null;
  note: string | null;
  created_at: string;
};

type OfficialPriceMapEntry = {
  close: string;
  change: string;
  name: string;
  volume: number;
  date: string;
  market?: 'listed' | 'otc';
};

type StockQuantData = {
  aiQuanBackDataComment: { remark: string; cum_ret: string; freq: number } | null;
  chipStability: { pts: string } | null;
  stockInfo: { gvi: number; mediangvi: string } | null;
  currentSignal: 'buy' | 'sell' | 'neutral';
  signalStreak: { signal: 'buy' | 'sell' | null; count: number };
  meta?: {
    source: 'shared-cache' | 'ifalgo-live' | 'empty';
    dataDate: string;
    fetchedAt: string;
    fixedUpdateTime: string;
    scheduleLabel: string;
    cacheStatus: 'hit' | 'miss' | 'fresh';
  };
};

type SimonsItem = {
  mdate?: string;
  coid: string;
  stkname: string;
  close?: string;
  strength?: string;
  psr?: number;
  subindustry?: string | null;
  status?: string | null;
  unusual?: string;
  category?: string;
  value?: string;
  ret_w?: string;
  ret_m?: string;
  wtcost?: string;
  fcost?: string;
  tcost?: string | null;
  dcost?: string;
  gvi?: number;
  mediangvi?: string;
  yflow?: string;
  tcr_today?: string;
  fcr_today?: string;
};

type StockData = {
  coid?: string;
  stkname?: string;
  subindustry?: string;
  status?: string;
  prices?: Array<{ mdate?: string; close_d?: string; volume?: number }>;
};

type WarmContext = {
  generatedAt: string;
  today: string;
  dataVersion: string;
  simonsStatus: 'ready' | 'waiting-simons' | 'unknown';
  simonsDataDate: string;
  officialMap: Record<string, OfficialPriceMapEntry>;
  stockDataMap: Record<string, StockData | null>;
  quantMap: Record<string, StockQuantData>;
  simonsItemMap: Record<string, SimonsItem>;
  recommendationCounts: Record<string, number>;
  activeEtfMap: Record<string, unknown>;
};

export type UserMarketCacheRow = {
  cache_date: string;
  user_id: string;
  surface: Surface;
  signature: string;
  payload: Record<string, unknown>;
  status: 'ready' | 'partial' | 'waiting-simons' | 'empty';
  data_date: string | null;
  generated_at: string;
  stale_reason: string | null;
};

export function todayTaipei(): string {
  return new Date(Date.now() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

export function getAdminClient(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase server configuration');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getBaseUrl(req: VercelRequest): string {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function getAuthHeaders() {
  const cronSecret = process.env.CRON_SECRET || '';
  return {
    accept: 'application/json',
    ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { headers: getAuthHeaders() });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

async function runBatches<T>(items: string[], batchSize: number, worker: (item: string) => Promise<T>) {
  const results: T[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    results.push(...await Promise.all(batch.map(worker)));
  }
  return results;
}

function normalizeCodes(rows: Array<{ stock_code: string }>, limit = 260): string[] {
  return [...new Set(rows.map(row => String(row.stock_code || '').trim()).filter(code => /^\d{4,6}$/.test(code)))].slice(0, limit);
}

function isPremiumUser(row: UserRow | undefined): boolean {
  if (!row) return false;
  if (row.is_admin) return true;
  if (row.tier !== 'premium') return false;
  if (!row.subscription_expires_at) return true;
  return new Date(row.subscription_expires_at) > new Date();
}

function hasFeature(user: UserRow | undefined, overrides: FeatureOverrideRow[], featureKey: string, usersById: Map<string, UserRow>): boolean {
  if (!user) return false;
  const override = overrides.find(row => row.user_id === user.id && row.feature_key === featureKey);
  if (override) return override.enabled;
  if (isPremiumUser(user)) return true;
  if (user.role === 'child' && user.parent_id) {
    return isPremiumUser(usersById.get(user.parent_id));
  }
  return false;
}

function stockListSignature(codes: string[]): string {
  return codes.slice().sort().join(',');
}

function numberValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function latestKlineDate(stocks: Array<StockData | null>): string {
  return stocks.reduce((latest, stock) => {
    const date = stock?.prices?.[stock.prices.length - 1]?.mdate || '';
    return date > latest ? date : latest;
  }, '');
}

function emptyQuantData(): StockQuantData {
  return {
    aiQuanBackDataComment: null,
    chipStability: null,
    stockInfo: null,
    currentSignal: 'neutral',
    signalStreak: { signal: null, count: 0 },
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

function buildRecommendation(item: SimonsItem, quantData?: StockQuantData) {
  let score = 50;
  const remark = quantData?.aiQuanBackDataComment?.remark || '';
  if (remark.includes('超高')) score += 30;
  else if (remark.includes('高度')) score += 22;
  else if (remark.includes('中度')) score += 12;
  else if (remark.includes('低度')) score += 2;

  const psr = numberValue(item.psr);
  score += Math.max(-15, Math.min(20, (psr - 5) * 2));
  const strength = numberValue(item.strength);
  if (strength > 2.5) score += 15;
  else if (strength > 2) score += 12;
  else if (strength > 1.5) score += 8;
  else if (strength > 1) score += 3;
  else if (strength < 0.5) score -= 12;

  const chipPts = numberValue(quantData?.chipStability?.pts);
  if (chipPts >= 8) score += 10;
  else if (chipPts >= 6) score += 6;
  else if (chipPts >= 4) score += 2;
  else if (chipPts > 0 && chipPts < 2) score -= 8;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const advice = score >= 60 ? 'buy' : score >= 30 ? 'hold' : 'sell';
  return {
    ...item,
    advice,
    adviceText: `股票本質 ${score}分，背景快取已先整理主要量化指標；可再搭配加碼時機與風險控管判斷。`,
    kidAdvice: `PPBear 已經先幫你把 ${item.stkname || item.coid} 的主要資料準備好了。`,
    score,
  };
}

function buildWatchlistPayload(rows: WatchlistRow[], ctx: WarmContext, accessScope: 'ai' | 'basic') {
  const codes = rows.map(row => row.stock_code);
  const quotes: Record<string, { close: number; change: number }> = {};
  const industryMap: Record<string, string> = {};
  const klineMap: Record<string, unknown[]> = {};
  const quantDataMap: Record<string, StockQuantData> = {};
  const simonsRecMap: Record<string, unknown> = {};
  const incompleteCodes = new Set<string>();
  const missingKlineCodes: string[] = [];
  const missingRecommendationCodes: string[] = [];

  for (const row of rows) {
    const code = row.stock_code;
    const official = ctx.officialMap[code];
    const stockData = ctx.stockDataMap[code];
    const latest = stockData?.prices?.[stockData.prices.length - 1];
    const prev = stockData?.prices && stockData.prices.length > 1 ? stockData.prices[stockData.prices.length - 2] : null;
    const close = numberValue(official?.close) || numberValue(latest?.close_d) || numberValue(row.added_price);
    const prevClose = numberValue(prev?.close_d);
    if (close > 0) {
      quotes[code] = { close, change: numberValue(official?.change) || (prevClose > 0 ? close - prevClose : 0) };
    } else {
      incompleteCodes.add(code);
    }
    if (stockData?.subindustry) industryMap[code] = stockData.subindustry;
    if (stockData?.prices?.length) {
      klineMap[code] = stockData.prices.slice(-126);
    } else {
      incompleteCodes.add(code);
      missingKlineCodes.push(code);
    }
    const quant = ctx.quantMap[code] || emptyQuantData();
    if (accessScope === 'ai') {
      quantDataMap[code] = quant;
      if (quant.meta?.source === 'empty') incompleteCodes.add(code);
    }
    const simonsItem = ctx.simonsItemMap[code];
    if (simonsItem) {
      simonsRecMap[code] = buildRecommendation(simonsItem, accessScope === 'ai' ? quant : undefined);
    } else if (accessScope === 'ai' && quant.aiQuanBackDataComment) {
      simonsRecMap[code] = buildRecommendation({
        coid: code,
        stkname: row.stock_name,
        close: String(close || ''),
        psr: 0,
        strength: '0',
        subindustry: stockData?.subindustry || row.note || null,
        status: stockData?.status || null,
      }, quant);
    } else {
      missingRecommendationCodes.push(code);
    }
  }

  return {
    quotes,
    industryMap,
    marketMap: Object.fromEntries(codes.map(code => [code, ctx.officialMap[code]]).filter(([, value]) => Boolean(value))),
    klineMap,
    quantDataMap,
    simonsRecMap,
    recommendationCounts: Object.fromEntries(codes.map(code => [code, ctx.recommendationCounts[code] || 0])),
    activeEtfMap: Object.fromEntries(codes.map(code => [code, ctx.activeEtfMap[code]]).filter(([, value]) => Boolean(value))),
    latestKlineDate: latestKlineDate(codes.map(code => ctx.stockDataMap[code] || null)),
    analyzedAt: formatDateTime(ctx.generatedAt),
    analyzedDate: ctx.today,
    watchlistKeys: stockListSignature(codes),
    cacheVersion: WATCHLIST_CACHE_VERSION,
    accessScope,
    priceUpdatedLabel: '',
    _dataVersion: ctx.dataVersion,
    _incompleteCodes: [...incompleteCodes],
    _missingKlineCodes: missingKlineCodes,
    _missingRecommendationCodes: missingRecommendationCodes,
  };
}

function hasCompletePortfolioQuantData(quant: StockQuantData | undefined): boolean {
  if (!quant || quant.meta?.source === 'empty') return false;
  if (quant.aiQuanBackDataComment?.remark || quant.aiQuanBackDataComment?.cum_ret) return true;
  const chipPts = quant.chipStability?.pts;
  return chipPts !== undefined && chipPts !== null && Number.isFinite(Number(chipPts));
}

function buildPortfolioPayload(rows: HoldingRow[], ctx: WarmContext) {
  const signals: Record<string, unknown> = {};
  const metas: NonNullable<StockQuantData['meta']>[] = [];
  const incompleteCodes: string[] = [];
  for (const row of rows) {
    const code = row.stock_code;
    const quant = ctx.quantMap[code] || emptyQuantData();
    if (!hasCompletePortfolioQuantData(ctx.quantMap[code])) incompleteCodes.push(code);
    if (quant.meta) metas.push(quant.meta);
    const signal = quant.currentSignal || 'neutral';
    const chipPtsRaw = quant.chipStability?.pts;
    const chipPts = chipPtsRaw !== undefined ? Number(chipPtsRaw) : undefined;
    signals[code] = {
      primaryLabel: signal === 'buy' ? 'AI 加碼' : signal === 'sell' ? 'AI 出場' : 'AI 中立',
      primaryType: signal,
      primaryIcon: signal === 'buy' ? '🚀' : signal === 'sell' ? '⚠️' : '⚖️',
      streakCount: signal !== 'neutral' && quant.signalStreak?.signal === signal ? quant.signalStreak.count : 0,
      aiRemark: quant.aiQuanBackDataComment?.remark,
      cumRet: quant.aiQuanBackDataComment?.cum_ret,
      chipPts: Number.isFinite(chipPts) ? chipPts : undefined,
    };
  }

  const latestMeta = metas.sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime())[0];
  return {
    ...signals,
    _schema: PORTFOLIO_CACHE_VERSION,
    _date: formatDateTime(ctx.generatedAt),
    _holdingKeys: stockListSignature(rows.map(row => row.stock_code)),
    _createdAt: new Date(ctx.generatedAt).getTime(),
    _quantMeta: latestMeta,
    _dataVersion: ctx.dataVersion,
    _incompleteCodes: incompleteCodes,
  };
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function fetchMapChunks<T>(baseUrl: string, type: string, codes: string[], key: string): Promise<Record<string, T>> {
  const merged: Record<string, T> = {};
  const chunks = [];
  for (let i = 0; i < codes.length; i += 80) chunks.push(codes.slice(i, i + 80));
  for (const chunk of chunks) {
    const params = new URLSearchParams({ type, coids: chunk.join(',') });
    const data = await fetchJson<Record<string, unknown>>(`${baseUrl}/api/app-cache?${params.toString()}`);
    const items = data?.[key];
    if (items && typeof items === 'object') Object.assign(merged, items);
  }
  return merged;
}

async function buildWarmContext(baseUrl: string, codes: string[]): Promise<WarmContext> {
  const generatedAt = new Date().toISOString();
  const [simonsPayload, officialPayload] = await Promise.all([
    fetchJson<{ status?: string; items?: SimonsItem[]; dataDate?: string; cacheDate?: string; cacheUpdatedAt?: string }>(`${baseUrl}/api/app-cache?type=simons&manual=${Date.now()}`),
    fetchJson<{ prices?: Record<string, OfficialPriceMapEntry> }>(`${baseUrl}/api/app-cache?type=official-prices`),
  ]);

  await runBatches(codes, 8, async code => {
    await fetchJson(`${baseUrl}/api/app-cache?type=stock-quant-snapshot&coid=${encodeURIComponent(code)}`);
    return true;
  });

  const [stockRows, quantRows, recommendationCounts, activeEtfMap] = await Promise.all([
    runBatches(codes, 8, async code => {
      const data = await fetchJson<{ data?: { stock?: { position?: StockData } } }>(`${baseUrl}/api/app-cache?type=ifalgo-stock&coid=${encodeURIComponent(code)}`);
      return [code, data?.data?.stock?.position || null] as const;
    }),
    runBatches(codes, 8, async code => {
      const data = await fetchJson<{ data?: StockQuantData }>(`${baseUrl}/api/app-cache?type=stock-quant&coid=${encodeURIComponent(code)}`);
      return [code, data?.data || emptyQuantData()] as const;
    }),
    fetchMapChunks<number>(baseUrl, 'simons-rec-counts', codes, 'counts'),
    fetchMapChunks<unknown>(baseUrl, 'active-etf-radar', codes, 'items'),
  ]);

  const stockDataMap = Object.fromEntries(stockRows);
  const quantMap = Object.fromEntries(quantRows);
  const simonsItems = simonsPayload?.items || [];
  const simonsItemMap = Object.fromEntries(simonsItems.map(item => [String(item.coid), item]));
  const simonsStatus = simonsPayload?.status === 'ready' ? 'ready' : simonsPayload?.status === 'waiting-simons' ? 'waiting-simons' : 'unknown';
  const simonsDataDate = simonsPayload?.dataDate || '';
  const dataVersion = [
    simonsPayload?.cacheDate || todayTaipei(),
    simonsDataDate,
    simonsPayload?.cacheUpdatedAt || generatedAt,
    simonsItems.length,
  ].join('|');

  return {
    generatedAt,
    today: todayTaipei(),
    dataVersion,
    simonsStatus,
    simonsDataDate,
    officialMap: officialPayload?.prices || {},
    stockDataMap,
    quantMap,
    simonsItemMap,
    recommendationCounts,
    activeEtfMap,
  };
}

async function updateHoldingPrices(supabase: SupabaseClient, holdings: HoldingRow[], officialMap: Record<string, OfficialPriceMapEntry>) {
  const updates = holdings
    .map(row => {
      const price = numberValue(officialMap[row.stock_code]?.close);
      return price > 0 && price !== numberValue(row.current_price)
        ? { userId: row.user_id, stockCode: row.stock_code, price }
        : null;
    })
    .filter((row): row is { userId: string; stockCode: string; price: number } => Boolean(row));

  await runBatches(updates.map((_, index) => String(index)), 12, async index => {
    const item = updates[Number(index)];
    await supabase
      .from('holdings')
      .update({ current_price: item.price, updated_at: new Date().toISOString() })
      .eq('user_id', item.userId)
      .eq('stock_code', item.stockCode);
    return true;
  });
  return updates.length;
}

export async function buildAndSaveUserMarketCaches(req: VercelRequest) {
  const supabase = getAdminClient();
  const [usersResult, holdingsResult, watchlistResult, overridesResult] = await Promise.all([
    supabase.from('users').select('id,role,parent_id,tier,is_admin,subscription_expires_at'),
    supabase.from('holdings').select('user_id,stock_code,stock_name,total_shares,avg_cost,current_price,industry'),
    supabase.from('watchlist').select('id,user_id,stock_code,stock_name,added_price,note,created_at').order('created_at', { ascending: false }),
    supabase.from('feature_overrides').select('user_id,feature_key,enabled').in('feature_key', ['ai_stock_picking', 'ai_portfolio_advice']),
  ]);
  if (usersResult.error) throw new Error(usersResult.error.message);
  if (holdingsResult.error) throw new Error(holdingsResult.error.message);
  if (watchlistResult.error) throw new Error(watchlistResult.error.message);

  const users = (usersResult.data || []) as UserRow[];
  const holdings = (holdingsResult.data || []) as HoldingRow[];
  const watchlist = (watchlistResult.data || []) as WatchlistRow[];
  const overrides = (overridesResult.data || []) as FeatureOverrideRow[];
  const usersById = new Map(users.map(user => [user.id, user]));
  const allCodes = normalizeCodes([...holdings, ...watchlist]);
  const ctx = await buildWarmContext(getBaseUrl(req), allCodes);
  const updatedHoldingPrices = await updateHoldingPrices(supabase, holdings, ctx.officialMap);

  const holdingsByUser = new Map<string, HoldingRow[]>();
  const watchlistByUser = new Map<string, WatchlistRow[]>();
  for (const row of holdings) {
    if (numberValue(row.total_shares) <= 0) continue;
    holdingsByUser.set(row.user_id, [...(holdingsByUser.get(row.user_id) || []), row]);
  }
  for (const row of watchlist) watchlistByUser.set(row.user_id, [...(watchlistByUser.get(row.user_id) || []), row]);

  const rows: UserMarketCacheRow[] = [];
  for (const user of users) {
    const userWatchlist = watchlistByUser.get(user.id) || [];
    const userHoldings = holdingsByUser.get(user.id) || [];
    const watchlistAccess = hasFeature(user, overrides, 'ai_stock_picking', usersById) ? 'ai' : 'basic';
    const portfolioAccess = hasFeature(user, overrides, 'ai_portfolio_advice', usersById);

    if (userWatchlist.length > 0) {
      const signature = stockListSignature(userWatchlist.map(row => row.stock_code));
      const watchlistPayload = buildWatchlistPayload(userWatchlist, ctx, watchlistAccess);
      const incompleteCodes = Array.isArray(watchlistPayload._incompleteCodes) ? watchlistPayload._incompleteCodes : [];
      rows.push({
        cache_date: ctx.today,
        user_id: user.id,
        surface: 'watchlist',
        signature,
        payload: watchlistPayload,
        status: ctx.simonsStatus === 'waiting-simons' ? 'waiting-simons' : incompleteCodes.length > 0 ? 'partial' : 'ready',
        data_date: ctx.simonsDataDate || null,
        generated_at: ctx.generatedAt,
        stale_reason: ctx.simonsStatus === 'waiting-simons'
          ? 'Simons latest completed trading day data is not ready yet'
          : incompleteCodes.length > 0
            ? `Missing complete watchlist data for ${incompleteCodes.length} stock(s)`
            : null,
      });
    }

    if (userHoldings.length > 0 && portfolioAccess) {
      const signature = stockListSignature(userHoldings.map(row => row.stock_code));
      const portfolioPayload = buildPortfolioPayload(userHoldings, ctx);
      const incompleteCodes = Array.isArray(portfolioPayload._incompleteCodes) ? portfolioPayload._incompleteCodes : [];
      rows.push({
        cache_date: ctx.today,
        user_id: user.id,
        surface: 'portfolio',
        signature,
        payload: portfolioPayload,
        status: ctx.simonsStatus === 'waiting-simons' ? 'waiting-simons' : incompleteCodes.length > 0 ? 'partial' : 'ready',
        data_date: ctx.simonsDataDate || null,
        generated_at: ctx.generatedAt,
        stale_reason: ctx.simonsStatus === 'waiting-simons'
          ? 'Simons latest completed trading day data is not ready yet'
          : incompleteCodes.length > 0
            ? `Missing complete quant data for ${incompleteCodes.length} portfolio holding(s)`
            : null,
      });
    }
  }

  let savedRows = 0;
  const failed: Array<{ start: number; error: string }> = [];
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await supabase
      .from('user_market_daily_cache')
      .upsert(chunk, { onConflict: 'cache_date,user_id,surface', ignoreDuplicates: false });
    if (error) failed.push({ start: i, error: error.message });
    else savedRows += chunk.length;
  }

  return {
    success: failed.length === 0,
    date: ctx.today,
    simonsStatus: ctx.simonsStatus,
    dataDate: ctx.simonsDataDate,
    userCount: users.length,
    stockCount: allCodes.length,
    cacheRows: rows.length,
    savedRows,
    updatedHoldingPrices,
    failed,
  };
}
