import type { VercelRequest, VercelResponse } from '@vercel/node';

type MarketIndicator = {
  label: string;
  description: string;
  active?: boolean;
};

type MarketAnalysisRequest = {
  updateDate?: string;
  monthLabel?: string;
  macroScore?: number;
  monthlyPrediction?: { score?: number; label?: string };
  dailyPrediction?: { score?: number; maxScore?: number };
  marketMood?: {
    primary?: string;
    reason?: string;
    indicators?: MarketIndicator[];
  };
  marginMaintenance?: {
    todayRate?: number;
    safeLine?: number;
    minLine?: number;
    unit?: string;
  };
  latestMomentum?: {
    label?: string;
    moneyMomentum?: number;
    taiex?: number;
  };
  previousMomentum?: {
    label?: string;
    moneyMomentum?: number;
    taiex?: number;
  };
};

export const config = {
  maxDuration: 30,
};

async function readRawBody(req: VercelRequest): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function parseRequestBody(req: VercelRequest): Promise<MarketAnalysisRequest> {
  const directBody = req.body as unknown;

  if (directBody && typeof directBody === 'object' && !Buffer.isBuffer(directBody)) {
    return directBody as MarketAnalysisRequest;
  }

  if (typeof directBody === 'string') {
    const trimmed = directBody.trim();
    return trimmed ? JSON.parse(trimmed) as MarketAnalysisRequest : {};
  }

  if (Buffer.isBuffer(directBody)) {
    const text = directBody.toString('utf-8').trim();
    return text ? JSON.parse(text) as MarketAnalysisRequest : {};
  }

  const raw = await readRawBody(req);
  const trimmed = raw.trim();
  return trimmed ? JSON.parse(trimmed) as MarketAnalysisRequest : {};
}

async function fetchWithTimeout(url: string, init?: RequestInit, ms = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function clampText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function buildRuleBasedConclusion(body: MarketAnalysisRequest) {
  const primary = body.marketMood?.primary || '冷靜';
  const reason = body.marketMood?.reason || '今日原始訊號不夠一致，先用冷靜觀察。';
  const monthlyLabel = body.monthlyPrediction?.label || '觀察中';
  const dailyScore = Number(body.dailyPrediction?.score ?? 0);
  const maxDaily = Math.max(Number(body.dailyPrediction?.maxScore ?? 8), 1);
  const dailyPct = Math.round((dailyScore / maxDaily) * 100);
  const todayRate = Number(body.marginMaintenance?.todayRate ?? 0);
  const safeLine = Number(body.marginMaintenance?.safeLine ?? 0);

  return {
    title: `今天市場氛圍：${primary}`,
    summary: `今天市場氛圍四選一為「${primary}」。月預測 ${monthlyLabel}、日預測約 ${dailyPct} 分，融資維持率 ${todayRate.toFixed(2)}% 相對安全線 ${safeLine.toFixed(2)}%。${reason}`,
    actionTone: primary === '貪婪'
      ? '追價氣氛較強，先確認風險再行動。'
      : primary === '樂觀'
        ? '中期方向偏正面，但仍要留意短線波動。'
        : primary === '放鬆'
          ? '槓桿壓力相對不緊繃，可以用穩定心態觀察。'
          : '訊號較不一致，先保持耐心。',
    keyPoints: [
      `今日只選一個氛圍：${primary}。`,
      reason,
      `融資維持率 ${todayRate.toFixed(2)}%，用來判斷市場槓桿壓力是否靠近危險區。`,
    ],
    generatedAt: new Date().toISOString(),
    source: 'rules' as const,
  };
}

async function generateAiConclusion(body: MarketAnalysisRequest) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

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
${JSON.stringify(body, null, 2)}`;

  try {
    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.35,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    if (!parsed?.title || !parsed?.summary || !Array.isArray(parsed?.keyPoints)) return null;

    return {
      title: clampText(parsed.title, 80),
      summary: clampText(parsed.summary, 260),
      actionTone: clampText(parsed.actionTone, 160),
      keyPoints: parsed.keyPoints.slice(0, 4).map((point: unknown) => clampText(point, 140)),
      generatedAt: new Date().toISOString(),
      source: 'ai' as const,
    };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body: MarketAnalysisRequest = {};
  try {
    body = await parseRequestBody(req);
  } catch (err) {
    console.error('home-market-analysis body parse error:', err);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const fallback = buildRuleBasedConclusion(body);
  const aiConclusion = await generateAiConclusion(body);
  return res.status(200).json(aiConclusion || fallback);
}
