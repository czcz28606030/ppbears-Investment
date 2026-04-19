import type { VercelRequest, VercelResponse } from '@vercel/node';

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
    ? `這支股票最近的股價表現還不錯喔！價格一直維持在比較高的位置，感覺買方力道還在。`
    : `這支股票最近股價有點上上下下，還沒有穩穩站住，可以再觀察幾天看看。`;

  const chips = strength >= 2 && lowerThanCosts >= 1
    ? `大機構（法人）買的成本跟現在的股價差不多，表示他們應該還不會急著賣，籌碼比較穩。`
    : `目前大機構的持股優勢不算明顯，需要觀察有沒有更多人願意持續買進這支股票。`;

  const news = headlines.length > 0
    ? `最近市場上跟這支股票有關的新聞，主要是「${headlines[0]}」，大家都在關注公司最新的動態！`
    : `目前奇摩股市沒有抓到這支股票的最新新聞，可以自己上新聞網站找找看最近有沒有重要消息。`;

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

  const prompt = `你是 PPBears App 的台股分析助手，讀者是國小到國中的學生。請只回傳 JSON，不要加任何 markdown。

請針對以下單一股票，整理三段繁體中文說明：技術面、籌碼面、消息面。

規則：
1. 每段 45 到 90 字，使用小朋友也能看懂的白話文，避免艱深術語，必要時加一句解釋。
2. 技術面：根據價格趨勢、成交量、PE/PB、報酬率等已提供資料描述，不可亂編技術指標數值。將專業詞彙用簡單方式說明（例如：成交量代表有多少人在買賣這支股票）。
3. 籌碼面：根據 strength、外資/投信/自營商成本與相關數據，解釋大機構（法人）投資的狀況，用「大機構」或「法人叔叔阿姨」這類稱呼。
4. 消息面：根據奇摩股市新聞標題說明最近發生什麼事；若沒有新聞，明確說明目前沒找到新聞，不能捏造。
5. 全程不寫停損價、不給明確買賣操作指令。

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

    const [ifalgoStock, simons, headlines] = await Promise.all([
      fetchIfalgoStock(code),
      fetchRecentSimonsItem(code),
      fetchYahooHeadlines(code),
    ]);

    const stockName = ifalgoStock?.name || simons?.stkname || name || code;
    const stockIndustry = ifalgoStock?.industry || simons?.subindustry || industry || '';
    const stockStatus = ifalgoStock?.status || simons?.status || status || '';
    const prices = ifalgoStock?.prices || [];

    const fallback = buildFallbackAnalysis(prices, simons, headlines);
    const aiAnalysis = await generateAiAnalysis(code, stockName, stockIndustry, stockStatus, prices, simons, headlines);

    return res.status(200).json(aiAnalysis || fallback);
  } catch (err) {
    console.error('stock-analysis error:', err);
    return res.status(200).json({
      technical: '目前技術面資料整理時發生問題，先別急著下決定，等資料更新後再看一次比較安全。',
      chips: '目前籌碼面資料暫時讀取不到，建議先觀察這支股票幾天，再和家人討論下一步。',
      news: '目前消息面暫時抓取失敗，請稍後重新整理頁面，或先查看公司公告與主流財經新聞。',
      headlines: [],
      generatedAt: new Date().toISOString(),
    } satisfies AnalysisResponse);
  }
}