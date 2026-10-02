import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

import { getStrategyPrices } from '../src/server/strategy-service.js';
import type { StockPrice as PricePoint } from '../src/types.js';

type AnalysisResponse = {
  technical: string;
  chips: string;
  news: string;
  headlines: string[];
  generatedAt: string;
};

type CachedAnalysisRow = {
  cache_date: string;
  payload: AnalysisResponse;
};

const LIVE_ANALYSIS_CACHE_TYPE = 'live_analysis_official_v3';

export const config = {
  maxDuration: 30,
};

type AnalysisRequestBody = {
  code?: string;
  name?: string;
  industry?: string;
  status?: string;
};

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function parseRequestBody(req: VercelRequest): Promise<AnalysisRequestBody> {
  const directBody = req.body as unknown;

  if (directBody && typeof directBody === 'object' && !Buffer.isBuffer(directBody)) {
    return directBody as AnalysisRequestBody;
  }

  if (typeof directBody === 'string') {
    const trimmed = directBody.trim();
    return trimmed ? JSON.parse(trimmed) as AnalysisRequestBody : {};
  }

  if (Buffer.isBuffer(directBody)) {
    const text = directBody.toString('utf-8').trim();
    return text ? JSON.parse(text) as AnalysisRequestBody : {};
  }

  const raw = await readRawBody(req);
  const trimmed = raw.trim();
  return trimmed ? JSON.parse(trimmed) as AnalysisRequestBody : {};
}

async function fetchWithTimeout(url: string, init?: RequestInit, ms = 7000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getTodayTaipei(): string {
  const taipei = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return taipei.toISOString().slice(0, 10);
}

function getSupabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function isValidAnalysisPayload(payload: unknown): payload is AnalysisResponse {
  if (!payload || typeof payload !== 'object') return false;
  const value = payload as Partial<AnalysisResponse>;
  return typeof value.technical === 'string'
    && typeof value.chips === 'string'
    && typeof value.news === 'string'
    && Array.isArray(value.headlines)
    && typeof value.generatedAt === 'string';
}

async function loadCachedAnalysis(code: string, cacheDate: string): Promise<AnalysisResponse | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

    const { data, error } = await supabase
      .from('stock_daily_cache')
      .select('cache_date, payload')
      .eq('stock_code', code)
      .eq('cache_type', LIVE_ANALYSIS_CACHE_TYPE)
      .maybeSingle<CachedAnalysisRow>();

  if (error || !data || data.cache_date !== cacheDate || !isValidAnalysisPayload(data.payload)) return null;
  return data.payload;
}

async function cleanupStaleStockCache(): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const staleBefore = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('stock_daily_cache')
    .delete()
    .lt('updated_at', staleBefore);

  if (error) {
    console.error('stock-analysis cache cleanup error:', error.message);
  }
}

async function saveCachedAnalysis(
  code: string,
  cacheDate: string,
  payload: AnalysisResponse,
  source: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const { error } = await supabase
    .from('stock_daily_cache')
    .upsert({
      stock_code: code,
      cache_date: cacheDate,
      cache_type: LIVE_ANALYSIS_CACHE_TYPE,
      payload,
      source,
      generated_at: payload.generatedAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stock_code,cache_type' });

  if (error) {
    console.error('stock-analysis cache save error:', error.message);
  }
}

async function fetchYahooHeadlines(code: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(`https://tw.stock.yahoo.com/quote/${code}/news`, {}, 5000);
    if (!res.ok) return [];
    const html = await res.text();
    const matches = [...html.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)];
    return matches
      .map(match => match[1].replace(/<[^>]+>/g, '').trim())
      .filter(text => text && text !== '個股相關新聞與公告')
      .slice(0, 5);
  } catch {
    return [];
  }
}

function buildFallbackAnalysis(
  prices: PricePoint[],
  headlines: string[]
): AnalysisResponse {
  const closes = prices.map(item => parseFloat(item.close_d)).filter(price => !Number.isNaN(price) && price > 0);
  const lastClose = closes.length > 0 ? closes[closes.length - 1] : 0;
  const firstClose = closes[0] || lastClose;
  const recentAvg = closes.length > 0 ? closes.reduce((sum, price) => sum + price, 0) / closes.length : lastClose;
  const trendUp = lastClose >= recentAvg && lastClose >= firstClose;

  const technical = closes.length === 0
    ? '官方日 K 資料暫時不足，無法確認近期價格與量能變化。'
    : `官方日 K 顯示最新收盤 ${lastClose.toFixed(2)} 元，近期 ${closes.length} 個交易日平均 ${recentAvg.toFixed(2)} 元，收盤${trendUp ? '高於或接近' : '低於'}近期平均。這是價格摘要，並非帳戶進出場訊號。`;
  const chips = '目前這份摘要未提供三大法人實際買賣超或成本資料，不能從價格推定法人籌碼穩定度。請搭配個股頁的 Goodinfo 估算成本與 FinMind 買賣超紀錄觀察。';
  const news = headlines.length > 0
    ? `近期新聞重點為「${headlines[0]}」。消息面可作為輔助判斷，但仍需搭配營收、法人籌碼與股價反應一起評估。`
    : `目前奇摩股市未抓到明確最新新聞。消息面暫無重大訊號時，可優先回到營收、產業趨勢與籌碼變化判斷。`;

  return {
    technical,
    chips,
    news,
    headlines,
    generatedAt: new Date().toISOString(),
  };
}

async function generateAiAnalysis(
  code: string,
  name: string,
  industry: string,
  status: string,
  prices: PricePoint[],
  headlines: string[]
): Promise<AnalysisResponse | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  const compactPrices = prices.map(item => ({
    date: item.mdate,
    open: item.open_d,
    high: item.high_d,
    low: item.low_d,
    close: item.close_d,
    volume: item.volume,
    pe: item.pe_ratio,
    pb: item.pb_ratio,
    changePct: item.roia,
  }));

  const prompt = `你是 PPBears App 的台股分析助手。請用「專業但白話」的語氣，幫一般投資使用者快速掌握重點。請只回傳 JSON，不要加任何 markdown。

請針對以下單一股票，整理三段繁體中文說明：技術面、籌碼面、消息面。

規則：
1. 每段 55 到 110 字，語氣要專業、直接、白話，不要使用小朋友口吻，不要出現「喔、叔叔阿姨、大家、很棒、快來」等童趣用語。
2. 技術面：僅根據官方日 K 價格與成交量描述，不可亂編技術指標數值、估值或策略績效。缺少價格時須明確說明資料不足。
3. 籌碼面：本次未提供法人持倉與買賣超資料，須明確說明資料不足，不能推測法人資金、成本或籌碼穩定度。引導查看個股頁的 Goodinfo 與 FinMind 實際資料。
4. 消息面：根據奇摩股市新聞標題說明最近發生什麼事；若沒有新聞，明確說明目前沒找到新聞，不能捏造。
5. 全程不寫停損價、不給明確買賣操作指令；這是公開行情摘要，不含使用者持倉與週榜資格，不能生成或宣稱任何當前交易訊號。
6. 不要保證漲跌，不要使用煽動語句；重點是讓使用者知道目前資料透露的風險與觀察方向。

請輸出格式：
{
  "technical": "...",
  "chips": "...",
  "news": "..."
}

股票資料：
${JSON.stringify({
  code,
  name,
  industry,
  status,
  recentPrices: compactPrices,
  yahooHeadlines: headlines,
}, null, 2)}`;

  try {
    const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.5,
      }),
    }, 12000);

    if (!res.ok) return null;
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    if (!parsed?.technical || !parsed?.chips || !parsed?.news) return null;

    return {
      technical: parsed.technical,
      chips: parsed.chips,
      news: parsed.news,
      headlines,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body: AnalysisRequestBody = {};
  try {
    body = await parseRequestBody(req);
  } catch (err) {
    console.error('stock-analysis body parse error:', err);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { code, name, industry, status } = body;

  if (!code || !/^\d{4,6}$/.test(String(code).trim())) {
    return res.status(400).json({ error: 'Missing code' });
  }

  try {
    const normalizedCode = String(code).trim();
    const cacheDate = getTodayTaipei();
    const cached = await loadCachedAnalysis(normalizedCode, cacheDate);
    if (cached) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
      return res.status(200).json(cached);
    }

    const [officialPrices, headlines] = await Promise.all([
      getStrategyPrices(normalizedCode).catch(() => [] as PricePoint[]),
      fetchYahooHeadlines(normalizedCode),
    ]);
    const prices = [...officialPrices].sort((a, b) => a.mdate.localeCompare(b.mdate)).slice(-10);
    const stockName = name || normalizedCode;
    const stockIndustry = industry || '';
    const stockStatus = status || '';
    const fallback = buildFallbackAnalysis(prices, headlines);
    const aiAnalysis = await generateAiAnalysis(normalizedCode, stockName, stockIndustry, stockStatus, prices, headlines);
    const result = aiAnalysis || fallback;
    await cleanupStaleStockCache();
    await saveCachedAnalysis(normalizedCode, cacheDate, result, aiAnalysis ? 'openai' : 'rule_fallback');

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json(result);
  } catch (err) {
    console.error('stock-analysis error:', err);
    return res.status(200).json({
      technical: '目前技術面資料整理時發生問題，暫時無法判斷近期價格與量能變化。建議稍後重新整理，再搭配 K 線與成交量確認。',
      chips: '目前籌碼面資料暫時讀取不到，無法確認法人資金與成本區間。建議先觀察外資、投信與自營商後續動向。',
      news: '目前消息面暫時抓取失敗，請稍後重新整理頁面，或先查看公司公告與主流財經新聞。',
      headlines: [],
      generatedAt: new Date().toISOString(),
    } satisfies AnalysisResponse);
  }
}
