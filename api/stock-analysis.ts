import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type PricePoint = {
  mdate: string;
  close_d: string;
  volume: number;
  pe_ratio: string;
  pb_ratio: string;
  roia: string | null;
};

type SimonsLike = {
  coid: string;
  stkname: string;
  close: string;
  strength: string;
  psr: number;
  subindustry: string | null;
  status: string | null;
  unusual: string;
  category: string;
  ret_w: string;
  ret_m: string;
  wtcost: string;
  fcost: string;
  tcost: string | null;
  dcost: string;
  gvi: number;
  tcr_today: string;
  fcr_today: string;
};

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

const LIVE_ANALYSIS_CACHE_TYPE = 'live_analysis_v2';

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

function getRecentBusinessDates(limit = 7): string[] {
  const dates: string[] = [];
  const cursor = new Date();
  while (dates.length < limit) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().split('T')[0]);
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates;
}

async function fetchIfalgoStock(code: string): Promise<{ name: string; status: string; industry: string; prices: PricePoint[] } | null> {
  try {
    const res = await fetchWithTimeout(`https://api.ifalgo.com.tw/frontapi/stock?coid=${code}`, {}, 6000);
    if (!res.ok) return null;
    const json = await res.json() as any;
    const position = json?.data?.stock?.position;
    if (!position) return null;
    return {
      name: position.stkname || code,
      status: position.status || '',
      industry: position.subindustry || '',
      prices: Array.isArray(position.prices) ? position.prices.slice(-10) : [],
    };
  } catch {
    return null;
  }
}

async function fetchRecentSimonsItem(code: string): Promise<SimonsLike | null> {
  const dates = getRecentBusinessDates(5);
  const results = await Promise.all(
    dates.map(async (date) => {
      try {
        const res = await fetchWithTimeout(`https://api.ifalgo.com.tw/frontapi/common/getSimonsData?searchDate=${date}`, {}, 4500);
        if (!res.ok) return null;
        const json = await res.json() as any;
        const items = (json?.data?.dataItems || []) as SimonsLike[];
        return items.find(item => item.coid === code) || null;
      } catch {
        return null;
      }
    })
  );

  return results.find((item): item is SimonsLike => !!item) || null;
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
  simons: SimonsLike | null,
  headlines: string[]
): AnalysisResponse {
  const closes = prices.map(item => parseFloat(item.close_d)).filter(price => !Number.isNaN(price) && price > 0);
  const lastClose = closes.length > 0 ? closes[closes.length - 1] : 0;
  const firstClose = closes[0] || lastClose;
  const recentAvg = closes.length > 0 ? closes.reduce((sum, price) => sum + price, 0) / closes.length : lastClose;
  const trendUp = lastClose >= recentAvg && lastClose >= firstClose;

  const wtcost = parseFloat(simons?.wtcost || '0');
  const fcost = parseFloat(simons?.fcost || '0');
  const tcost = parseFloat(simons?.tcost || '0');
  const strength = parseFloat(simons?.strength || '0');
  const validCosts = [wtcost, fcost, tcost].filter(cost => !Number.isNaN(cost) && cost > 0);
  const lowerThanCosts = validCosts.filter(cost => lastClose < cost).length;

  const technical = trendUp
    ? `近期股價維持在相對高檔，收盤價高於短期平均，代表買盤仍有支撐。後續可觀察成交量是否同步放大，確認趨勢是否延續。`
    : `近期股價波動較明顯，收盤價尚未穩定站上短期平均，技術面仍偏整理。建議先觀察是否出現量能回溫與價格轉強。`;

  const chips = strength >= 2 && lowerThanCosts >= 1
    ? `法人持股成本與目前股價接近，籌碼面仍有一定支撐。若 strength 維持在較高水準，代表資金承接力道相對穩定。`
    : `目前法人籌碼優勢不算明顯，資金承接力道仍需觀察。若後續 strength 回升，才比較能確認籌碼面轉強。`;

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
  simons: SimonsLike | null,
  headlines: string[]
): Promise<AnalysisResponse | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  const compactPrices = prices.map(item => ({
    date: item.mdate,
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
2. 技術面：根據價格趨勢、成交量、PE/PB、報酬率等已提供資料描述，不可亂編技術指標數值。若提到 PE/PB，請用「估值」白話說明。
3. 籌碼面：根據 strength、外資/投信/自營商成本與相關數據，解釋法人資金、成本區間與籌碼穩定度。只能稱為「法人」、「外資」、「投信」、「自營商」。
4. 消息面：根據奇摩股市新聞標題說明最近發生什麼事；若沒有新聞，明確說明目前沒找到新聞，不能捏造。
5. 全程不寫停損價、不給明確買賣操作指令。
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
  simons: simons ? {
    close: simons.close,
    strength: simons.strength,
    psr: simons.psr,
    unusual: simons.unusual,
    ret_w: simons.ret_w,
    ret_m: simons.ret_m,
    wtcost: simons.wtcost,
    fcost: simons.fcost,
    tcost: simons.tcost,
    tcr_today: simons.tcr_today,
    fcr_today: simons.fcr_today,
    gvi: simons.gvi,
  } : null,
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
    const data = await res.json() as any;
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

  if (!code) {
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

    const [ifalgoStock, simons, headlines] = await Promise.all([
      fetchIfalgoStock(normalizedCode),
      fetchRecentSimonsItem(normalizedCode),
      fetchYahooHeadlines(normalizedCode),
    ]);

    const stockName = ifalgoStock?.name || simons?.stkname || name || normalizedCode;
    const stockIndustry = ifalgoStock?.industry || simons?.subindustry || industry || '';
    const stockStatus = ifalgoStock?.status || simons?.status || status || '';
    const prices = ifalgoStock?.prices || [];

    const fallback = buildFallbackAnalysis(prices, simons, headlines);
    const aiAnalysis = await generateAiAnalysis(normalizedCode, stockName, stockIndustry, stockStatus, prices, simons, headlines);
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
