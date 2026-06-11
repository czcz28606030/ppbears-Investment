import type { VercelRequest, VercelResponse } from '@vercel/node';

type InstitutionKey = 'foreign' | 'trust' | 'dealer';

type InstitutionCostItem = {
  key: InstitutionKey;
  label: string;
  estimatedCost: number | null;
  buyShares: number;
  buyAmount: number;
};

type FinMindFlowItem = {
  key: InstitutionKey;
  label: string;
  buyShares: number;
  sellShares: number;
  netShares: number;
};

type FinMindFlowResponse = {
  sourceUrl: string;
  period: string;
  note: string;
  items: FinMindFlowItem[];
  estimatedCostItems: InstitutionCostItem[];
};

type InstitutionCostResponse = {
  code: string;
  source: 'goodinfo';
  sourceUrl: string;
  period: string;
  note: string;
  items: InstitutionCostItem[];
  finmind?: {
    sourceUrl: string;
    period: string;
    note: string;
    items: FinMindFlowItem[];
  };
  generatedAt: string;
};

export const config = {
  maxDuration: 20,
};

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntity(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToText(html: string): string {
  return decodeHtmlEntity(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(tr|div|p|li|table|tbody|thead|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function parseNumber(text: string): number {
  const cleaned = text.replace(/,/g, '').replace(/[+%]/g, '').trim();
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function parseMoneyToNtd(text: string): number {
  const cleaned = text.replace(/,/g, '').replace(/\+/g, '').trim();
  const value = parseFloat(cleaned);
  if (!Number.isFinite(value)) return 0;
  if (cleaned.includes('兆')) return value * 1_000_000_000_000;
  if (cleaned.includes('億')) return value * 100_000_000;
  if (cleaned.includes('萬')) return value * 10_000;
  return value;
}

function extractSummaryTable(html: string): string {
  const direct = html.match(/<div id=['"]divSum['"][\s\S]*?(<table id=['"]tblSum['"][\s\S]*?<\/table>)/i);
  if (direct?.[1]) return direct[1];

  const embedded = html.match(/oHTML\['tblSum'\]\s*=\s*'([\s\S]*?)';/);
  if (!embedded?.[1]) return '';
  return embedded[1]
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\t/g, ' ')
    .replace(/\\n/g, '');
}

function extractRedirectPath(html: string): string | null {
  const redirectMatch = html.match(/window\.location\.replace\('([^']+)'\)/);
  return redirectMatch?.[1] || null;
}

function toGoodinfoUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `https://goodinfo.tw/tw/${pathOrUrl.replace(/^\.\//, '')}`;
}

function extractGoodinfoClientKey(html: string): string | null {
  const arrValues = new Map<number, string>();
  for (const match of html.matchAll(/arr\[(\d+)\]\s*=\s*'([^']*)'/g)) {
    arrValues.set(Number(match[1]), match[2]);
  }

  const version = arrValues.get(0);
  const seedA = arrValues.get(1);
  const seedB = arrValues.get(2);
  if (!version || !seedA || !seedB) return null;

  const timezoneOffset = -480;
  const excelNow = Date.now() / 86400000 - timezoneOffset / 1440 + 25569;
  const values = [
    version,
    seedA,
    seedB,
    String(timezoneOffset),
    String(excelNow),
    arrValues.get(5) || '0',
    arrValues.get(6) || '0',
    arrValues.get(7) || '0',
  ];

  return `CLIENT_KEY=${values.join('|')}`;
}

async function fetchGoodinfoHtml(url: string, cookie?: string, referer = 'https://goodinfo.tw/tw/index.asp'): Promise<string> {
  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
      'Referer': referer,
      ...(cookie ? { 'Cookie': cookie } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Goodinfo HTTP ${response.status}`);
  }

  const bytes = await response.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const big5 = new TextDecoder('big5').decode(bytes);
  return utf8.includes('tblSum') || utf8.includes('三大法人') || utf8.includes('CLIENT_KEY') ? utf8 : big5;
}

async function fetchGoodinfoPage(sourceUrl: string): Promise<string> {
  let currentUrl = sourceUrl;
  let referer = 'https://goodinfo.tw/tw/index.asp';
  let cookie: string | undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const html = await fetchGoodinfoHtml(currentUrl, cookie, referer);
    const tableHtml = extractSummaryTable(html);
    if (tableHtml) return html;

    const nextPath = extractRedirectPath(html);
    if (!nextPath) return html;

    cookie = extractGoodinfoClientKey(html) || cookie;
    referer = currentUrl;
    currentUrl = toGoodinfoUrl(nextPath);
  }

  return fetchGoodinfoHtml(currentUrl, cookie, referer);
}

function getTableCells(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
    .map(match => htmlToText(match[1]).trim())
    .filter(text => text.length > 0);
}

function parseInstitution(tableHtml: string, label: string, key: InstitutionKey): InstitutionCostItem {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => match[1]);
  let labelSeen = false;
  let buyShares = 0;
  let buyAmount = 0;

  for (const rowHtml of rows) {
    const cells = getTableCells(rowHtml);
    if (cells.includes(label)) labelSeen = true;
    if (!labelSeen) continue;

    const nextMainLabel = cells.find(cell => ['外資', '投信', '自營商', '總計'].includes(cell) && cell !== label);
    if (nextMainLabel) break;

    const metricIndex = cells.indexOf('張數');
    if (metricIndex >= 0 && buyShares === 0) {
      buyShares = parseNumber(cells[metricIndex + 1] || '');
    }

    const amountIndex = cells.indexOf('金額(元)');
    if (amountIndex >= 0 && buyAmount === 0) {
      buyAmount = parseMoneyToNtd(cells[amountIndex + 1] || '');
    }

    if (buyShares > 0 && buyAmount > 0) break;
  }

  const estimatedCost = buyShares > 0 && buyAmount > 0 ? buyAmount / (buyShares * 1000) : null;

  return { key, label, estimatedCost, buyShares, buyAmount };
}

function extractPeriod(text: string): string {
  const matched = text.match(/(\d{4}年)\s*買賣超統計/);
  return matched?.[1] || '年度';
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function mapFinMindName(name: string): InstitutionKey | null {
  if (name === 'Foreign_Investor' || name === 'Foreign_Dealer_Self') return 'foreign';
  if (name === 'Investment_Trust') return 'trust';
  if (name === 'Dealer_self' || name === 'Dealer_Hedging') return 'dealer';
  return null;
}

function getInstitutionLabel(key: InstitutionKey): string {
  if (key === 'foreign') return '外資';
  if (key === 'trust') return '投信';
  return '自營商';
}

async function fetchIfalgoCloseMap(code: string): Promise<Map<string, number>> {
  const response = await fetchWithTimeout(`https://api.ifalgo.com.tw/frontapi/stock?coid=${encodeURIComponent(code)}`, {
    headers: { accept: 'application/json' },
  }, 10000);
  if (!response.ok) throw new Error(`IFAlgo HTTP ${response.status}`);
  const json = await response.json() as { data?: { stock?: { position?: { prices?: Array<{ mdate?: string; close_d?: string }> } } } };
  const prices = json.data?.stock?.position?.prices || [];
  const closeMap = new Map<string, number>();
  for (const price of prices) {
    const date = String(price.mdate || '').trim();
    const close = parseNumber(String(price.close_d || ''));
    if (date && close > 0) closeMap.set(date, close);
  }
  return closeMap;
}

async function fetchFinMindFlows(code: string): Promise<FinMindFlowResponse> {
  const end = new Date();
  const start = addDays(end, -18);
  const sourceUrl = 'https://api.finmindtrade.com/api/v4/data';
  const params = new URLSearchParams({
    dataset: 'TaiwanStockInstitutionalInvestorsBuySell',
    data_id: code,
    start_date: toIsoDate(start),
    end_date: toIsoDate(end),
  });
  const token = process.env.FINMIND_API_TOKEN || '';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchWithTimeout(`${sourceUrl}?${params.toString()}`, { headers }, 10000);
  if (!response.ok) throw new Error(`FinMind HTTP ${response.status}`);
  const json = await response.json() as { data?: Array<{ date?: string; name?: string; buy?: number; sell?: number }> };
  const rows = Array.isArray(json.data) ? json.data : [];
  const latestDates = Array.from(new Set(rows.map(row => String(row.date || '')).filter(Boolean)))
    .sort()
    .slice(-10);
  const latestDateSet = new Set(latestDates);
  const closeMap = await fetchIfalgoCloseMap(code).catch(() => new Map<string, number>());
  const totals: Record<InstitutionKey, FinMindFlowItem> = {
    foreign: { key: 'foreign', label: '外資', buyShares: 0, sellShares: 0, netShares: 0 },
    trust: { key: 'trust', label: '投信', buyShares: 0, sellShares: 0, netShares: 0 },
    dealer: { key: 'dealer', label: '自營商', buyShares: 0, sellShares: 0, netShares: 0 },
  };
  const weightedBuyAmount: Record<InstitutionKey, number> = { foreign: 0, trust: 0, dealer: 0 };
  const weightedBuyShares: Record<InstitutionKey, number> = { foreign: 0, trust: 0, dealer: 0 };

  for (const row of rows) {
    const date = String(row.date || '');
    if (!latestDateSet.has(date)) continue;
    const key = mapFinMindName(String(row.name || ''));
    if (!key) continue;
    const buyShares = Number(row.buy || 0);
    totals[key].buyShares += buyShares;
    totals[key].sellShares += Number(row.sell || 0);
    const close = closeMap.get(date) || 0;
    if (buyShares > 0 && close > 0) {
      weightedBuyShares[key] += buyShares;
      weightedBuyAmount[key] += buyShares * close;
    }
  }

  for (const key of Object.keys(totals) as InstitutionKey[]) {
    totals[key].netShares = totals[key].buyShares - totals[key].sellShares;
      totals[key].label = getInstitutionLabel(key);
  }
  const estimatedCostItems = (Object.keys(totals) as InstitutionKey[]).map(key => ({
    key,
    label: getInstitutionLabel(key),
    estimatedCost: weightedBuyShares[key] > 0 ? weightedBuyAmount[key] / weightedBuyShares[key] : null,
    buyShares: Math.round(totals[key].buyShares / 1000),
    buyAmount: weightedBuyShares[key] > 0 ? Math.round(weightedBuyAmount[key] * 1000) : 0,
  }));

  return {
    sourceUrl,
    period: latestDates.length > 0 ? `${latestDates[0]} ~ ${latestDates[latestDates.length - 1]}` : '近10個交易日',
    note: 'FinMind 提供三大法人買進與賣出股數，可輔助判斷近期籌碼流向；免費資料沒有買進金額或均價，因此不拿來直接計算成本。',
    items: Object.values(totals),
    estimatedCostItems,
  };
}

async function fetchGoodinfoInstitutionCost(code: string): Promise<InstitutionCostResponse> {
  const sourceUrl = `https://goodinfo.tw/tw/ShowBuySaleChart.asp?CHT_CAT=YEAR&STOCK_ID=${encodeURIComponent(code)}`;
  const html = await fetchGoodinfoPage(sourceUrl);
  const text = htmlToText(html);
  const tableHtml = extractSummaryTable(html);

  const items = [
    parseInstitution(tableHtml, '外資', 'foreign'),
    parseInstitution(tableHtml, '投信', 'trust'),
    parseInstitution(tableHtml, '自營商', 'dealer'),
  ];

  return {
    code,
    source: 'goodinfo',
    sourceUrl,
    period: extractPeriod(text),
    note: 'Goodinfo 提供法人買進張數與買進金額，本 API 以買進金額 ÷ 買進張數估算買進均價，並非交易所公布的精準持倉成本。',
    items,
    generatedAt: new Date().toISOString(),
  };
}

export default async function handleInstitutionCost(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const code = String(req.query.code || '').trim();
  if (!/^\d{4,6}$/.test(code)) {
    return res.status(400).json({ error: 'Missing or invalid stock code' });
  }

  try {
    const finmind = await fetchFinMindFlows(code).catch(err => {
      console.warn('finmind flow warning:', err);
      return null;
    });
    const data = await fetchGoodinfoInstitutionCost(code);
    if (finmind) {
      data.finmind = {
        sourceUrl: finmind.sourceUrl,
        period: finmind.period,
        note: finmind.note,
        items: finmind.items,
      };
    }
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json(data);
  } catch (err) {
    console.error('institution-cost error:', err);
    const finmind = await fetchFinMindFlows(code).catch(flowErr => {
      console.warn('institution-cost finmind fallback warning:', flowErr);
      return null;
    });
    if (finmind && finmind.estimatedCostItems.some(item => item.estimatedCost !== null && item.estimatedCost > 0)) {
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=21600');
      return res.status(200).json({
        code,
        source: 'goodinfo',
        sourceUrl: finmind.sourceUrl,
        period: finmind.period,
        note: 'Goodinfo 雲端讀取失敗，暫以 FinMind 近10日法人買進股數搭配 IFAlgo 日收盤價估算近期買進成本；這不是官方持倉成本。',
        items: finmind.estimatedCostItems,
        finmind: {
          sourceUrl: finmind.sourceUrl,
          period: finmind.period,
          note: finmind.note,
          items: finmind.items,
        },
        generatedAt: new Date().toISOString(),
      } satisfies InstitutionCostResponse);
    }
    return res.status(200).json({
      code,
      source: 'goodinfo',
      sourceUrl: `https://goodinfo.tw/tw/ShowBuySaleChart.asp?CHT_CAT=YEAR&STOCK_ID=${encodeURIComponent(code)}`,
      period: '年度',
      note: 'Goodinfo 資料暫時讀取失敗，請稍後再試。',
      items: [],
      generatedAt: new Date().toISOString(),
    } satisfies InstitutionCostResponse);
  }
}
