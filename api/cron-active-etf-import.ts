import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type ActiveEtfSource = {
  etfCode: string;
  etfName: string;
  url: string;
  fallbackUrls?: string[];
  minHoldings?: number;
  format?: 'auto' | 'html' | 'json';
};

type ActiveEtfHolding = {
  coid: string;
  stkname: string;
  weightPct: number | null;
  shares: number | null;
};

type ActiveEtfFlowAction = 'added' | 'increased' | 'decreased' | 'removed' | 'held';

type ImportResult = {
  etfCode: string;
  etfName: string;
  snapshotDate: string;
  holdings: number;
  flows: number;
  sourceUrl: string;
  error?: string;
};

export const config = {
  maxDuration: 300,
};

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

const DEFAULT_ACTIVE_ETF_SOURCES: ActiveEtfSource[] = [
  {
    etfCode: '0050',
    etfName: '元大台灣50',
    url: 'https://www.yuantaetfs.com/product/detail/0050/ratio',
    fallbackUrls: ['https://www.etfinfo.tw/etf/0050/holdings'],
    minHoldings: 10,
    format: 'html',
  },
  {
    etfCode: '0056',
    etfName: '元大高股息',
    url: 'https://www.yuantaetfs.com/product/detail/0056/ratio',
    fallbackUrls: ['https://www.etfinfo.tw/etf/0056/holdings'],
    minHoldings: 10,
    format: 'html',
  },
  {
    etfCode: '00878',
    etfName: '國泰永續高股息',
    url: 'https://www.etfinfo.tw/etf/00878/holdings',
    minHoldings: 10,
    format: 'html',
  },
  {
    etfCode: '00919',
    etfName: '群益台灣精選高息',
    url: 'https://www.capitalfund.com.tw/etf/product/detail/195/portfolio',
    fallbackUrls: ['https://www.etfinfo.tw/etf/00919/holdings'],
    minHoldings: 10,
    format: 'html',
  },
  {
    etfCode: '006208',
    etfName: '富邦台50',
    url: 'https://websys.fsit.com.tw/FubonETF/Fund/Assets.aspx?stkId=006208',
    format: 'html',
  },
  {
    etfCode: '00981A',
    etfName: '統一台股增長主動式',
    url: 'https://www.zdsetf.com/etf/00981A',
    format: 'html',
  },
  {
    etfCode: '00403A',
    etfName: '統一台股升級50主動式',
    url: 'https://www.zdsetf.com/etf/00403A',
    format: 'html',
  },
];

function todayTaipei(): string {
  return new Date(Date.now() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

function normalizeDate(value: string): string | null {
  const raw = value.trim();
  const match = raw.match(/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function parseNumber(value: unknown): number | null {
  const n = parseFloat(String(value ?? '').replace(/,/g, '').replace(/%/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|tr|td|th|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/\r/g, '\n');
}

function extractLatestDate(text: string): string {
  const dates = [...text.matchAll(/20\d{2}[/-]\d{1,2}[/-]\d{1,2}/g)]
    .map(match => normalizeDate(match[0]))
    .filter((date): date is string => Boolean(date))
    .sort();
  return dates.length > 0 ? dates[dates.length - 1] : todayTaipei();
}

function normalizeLines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseHoldingsFromLines(lines: string[]): ActiveEtfHolding[] {
  const holdings: ActiveEtfHolding[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const labeledMatches = line.matchAll(/(?:商品代碼\s*)?(\d{4})\s+商品名稱\s+(.+?)\s+商品數量\s+([\d,]+)\s+商品權重\s+(\d+(?:\.\d+)?)/g);
    for (const match of labeledMatches) {
      const [, code, name, sharesText, weightText] = match;
      if (seen.has(code)) continue;
      seen.add(code);
      holdings.push({
        coid: code,
        stkname: name.trim(),
        weightPct: parseNumber(weightText),
        shares: parseNumber(sharesText),
      });
    }

    const rowMatch = line.match(/^(\d{4})\s+(.+?)\s+([\d,]+)\s+(\d+(?:\.\d+)?)\s+[\d,.]+$/);
    if (!rowMatch) continue;
    const [, code, name, sharesText, weightText] = rowMatch;
    if (seen.has(code)) continue;
    seen.add(code);
    holdings.push({
      coid: code,
      stkname: name.trim(),
      weightPct: parseNumber(weightText),
      shares: parseNumber(sharesText),
    });
  }

  for (const line of lines) {
    const etfInfoMatches = line.matchAll(/(\d{4})\s+([^\s]+)\s+.*?(\d+(?:\.\d+)?)%\s+([\d,]+)(?:\s|$)/g);
    for (const match of etfInfoMatches) {
      const [, code, name, weightText, sharesText] = match;
      if (seen.has(code)) continue;
      seen.add(code);
      holdings.push({
        coid: code,
        stkname: name.trim(),
        weightPct: parseNumber(weightText),
        shares: parseNumber(sharesText),
      });
    }
  }

  for (let i = 0; i < lines.length - 7; i += 1) {
    if (lines[i] !== '商品代碼') continue;
    const code = lines[i + 1];
    if (!/^\d{4}$/.test(code) || seen.has(code)) continue;
    if (lines[i + 2] !== '商品名稱' || lines[i + 4] !== '商品數量' || lines[i + 6] !== '商品權重') continue;
    seen.add(code);
    holdings.push({
      coid: code,
      stkname: lines[i + 3],
      weightPct: parseNumber(lines[i + 7]),
      shares: parseNumber(lines[i + 5]),
    });
  }

  for (let i = 0; i < lines.length - 3; i += 1) {
    const code = lines[i];
    if (!/^\d{4}$/.test(code) || seen.has(code)) continue;
    const name = lines[i + 1];
    if (!name || /^\d/.test(name) || ['商品名稱', '股票名稱', '名稱'].includes(name)) continue;
    const window = lines.slice(i + 2, i + 14);
    const weightIndex = window.findIndex(cell => /^\d+(?:\.\d+)?%$/.test(cell));
    if (weightIndex < 0) continue;
    const sharesText = window.slice(weightIndex + 1).find(cell => /^[\d,]+$/.test(cell));
    if (!sharesText) continue;
    seen.add(code);
    holdings.push({
      coid: code,
      stkname: name,
      weightPct: parseNumber(window[weightIndex]),
      shares: parseNumber(sharesText),
    });
  }

  for (let i = 0; i < lines.length - 3; i += 1) {
    const code = lines[i];
    if (!/^\d{4}$/.test(code)) continue;
    if (seen.has(code)) continue;
    const name = lines[i + 1];
    const sharesText = lines[i + 2];
    const weightText = lines[i + 3];
    if (!/^[\d,]+(?:\.\d+)?$/.test(sharesText)) continue;
    if (!/^\d+(?:\.\d+)?%?$/.test(weightText)) continue;
    const weightPct = parseNumber(weightText);
    const shares = parseNumber(sharesText);
    if (weightPct === null) continue;

    const key = `${code}-${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    seen.add(code);
    holdings.push({
      coid: code,
      stkname: name,
      weightPct,
      shares,
    });
  }

  return holdings;
}

function decodeHtmlText(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanHoldingCell(cell: string): string {
  return cell
    .replace(/^(商品代碼|商品名稱|商品數量|商品權重|股票代碼|股票代號|股票名稱|股數|持股權重(?:\(%\))?|權重(?:\(%\))?|金額)\s*/u, '')
    .trim();
}

function pushHoldingFromCells(cells: string[], holdings: ActiveEtfHolding[], seen: Set<string>) {
  const cleaned = cells.map(cleanHoldingCell).filter(Boolean);
  const codeIndex = cleaned.findIndex(cell => /^\d{4}$/.test(cell));
  if (codeIndex < 0) return;
  const coid = cleaned[codeIndex];
  if (seen.has(coid)) return;

  const name = cleaned[codeIndex + 1] || coid;
  if (!name || /^\d/.test(name)) return;

  const afterName = cleaned.slice(codeIndex + 2);
  const pctIndex = afterName.findIndex(cell => /^\d+(?:\.\d+)?%?$/.test(cell));
  if (pctIndex < 0) return;

  let weightText = afterName[pctIndex];
  let sharesText = afterName.find((cell, index) => (
    index !== pctIndex && /^[\d,]+$/.test(cell) && parseNumber(cell) !== parseNumber(weightText)
  ));

  if (pctIndex >= 2 && /^[\d,]+$/.test(afterName[0])) {
    sharesText = afterName[0];
    weightText = afterName[pctIndex];
  } else if (pctIndex === 0 && /^[\d,]+$/.test(afterName[1] || '')) {
    sharesText = afterName[1];
  }

  const weightPct = parseNumber(weightText);
  const shares = parseNumber(sharesText);
  if (weightPct === null && shares === null) return;

  seen.add(coid);
  holdings.push({
    coid,
    stkname: name,
    weightPct,
    shares,
  });
}

function parseHoldingsFromHtml(raw: string): ActiveEtfHolding[] {
  const holdings: ActiveEtfHolding[] = [];
  const seen = new Set<string>();
  const tableMatches = raw.matchAll(/<table[^>]*class=["'][^"']*\bholdings\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi);

  for (const tableMatch of tableMatches) {
    const tableHtml = tableMatch[1];
    const rowMatches = tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const rowMatch of rowMatches) {
      const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(match => decodeHtmlText(match[1]));
      const coid = cells[0] || '';
      if (!/^\d{4}$/.test(coid) || seen.has(coid)) continue;
      const shares = parseNumber(cells[2]);
      const weightPct = parseNumber(cells[3]);
      if (shares === null && weightPct === null) continue;
      seen.add(coid);
      holdings.push({
        coid,
        stkname: cells[1] || coid,
        weightPct,
        shares,
      });
    }
  }

  const trMatches = raw.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const rowMatch of trMatches) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(match => decodeHtmlText(match[1]));
    if (cells.length >= 3) pushHoldingFromCells(cells, holdings, seen);
  }

  const divRowMatches = raw.matchAll(/<div[^>]*class=["'][^"']*\btr\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi);
  for (const rowMatch of divRowMatches) {
    const cells = [...rowMatch[1].matchAll(/<div[^>]*class=["'][^"']*\b(?:td|th)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
      .map(match => decodeHtmlText(match[1]));
    if (cells.length >= 3) pushHoldingFromCells(cells, holdings, seen);
  }

  return holdings;
}

function isHoldingLike(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return Boolean(row.coid || row.code || row.stockCode || row.StockCode || row['股票代號']);
}

function collectJsonRows(value: unknown, rows: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    value.forEach(item => collectJsonRows(item, rows));
    return rows;
  }
  if (!value || typeof value !== 'object') return rows;
  if (isHoldingLike(value)) rows.push(value);
  Object.values(value).forEach(child => collectJsonRows(child, rows));
  return rows;
}

function parseHoldingsFromJson(payload: unknown): ActiveEtfHolding[] {
  const rows = collectJsonRows(payload);
  const holdings: ActiveEtfHolding[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const coid = String(row.coid || row.code || row.stockCode || row.StockCode || row['股票代號'] || '').trim();
    if (!/^\d{4}$/.test(coid) || seen.has(coid)) continue;
    seen.add(coid);
    holdings.push({
      coid,
      stkname: String(row.stkname || row.name || row.stockName || row.StockName || row['股票名稱'] || coid).trim(),
      weightPct: parseNumber(row.weightPct || row.weight || row.ratio || row.Weight || row['持股權重(%)'] || row['持股權重']),
      shares: parseNumber(row.shares || row.share || row.qty || row.Quantity || row['股數'] || row['持有股數']),
    });
  }
  return holdings;
}

function getActiveEtfSources(): ActiveEtfSource[] {
  const raw = process.env.ACTIVE_ETF_SOURCES;
  if (!raw) return DEFAULT_ACTIVE_ETF_SOURCES;
  try {
    const parsed = JSON.parse(raw) as ActiveEtfSource[];
    const sources = Array.isArray(parsed)
      ? parsed.filter(item => item.etfCode && item.etfName && item.url)
      : [];
    return sources.length > 0 ? sources : DEFAULT_ACTIVE_ETF_SOURCES;
  } catch {
    return DEFAULT_ACTIVE_ETF_SOURCES;
  }
}

async function fetchHoldingsFromUrl(source: ActiveEtfSource, url: string): Promise<{ snapshotDate: string; holdings: ActiveEtfHolding[]; sourceUrl: string }> {
  const response = await fetch(url, {
    headers: {
      accept: source.format === 'json' ? 'application/json,text/plain,*/*' : 'text/html,application/json,text/plain,*/*',
      'user-agent': 'PPBearsInvestmentBot/1.0 etf-flow-import',
    },
  });
  if (!response.ok) throw new Error(`source HTTP ${response.status}`);
  const raw = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const shouldParseJson = source.format === 'json' || (source.format !== 'html' && contentType.includes('json'));

  if (shouldParseJson) {
    const payload = JSON.parse(raw);
    return {
      snapshotDate: extractLatestDate(raw),
      holdings: parseHoldingsFromJson(payload),
      sourceUrl: url,
    };
  }

  const htmlHoldings = parseHoldingsFromHtml(raw);
  if (htmlHoldings.length > 0) {
    return {
      snapshotDate: extractLatestDate(stripHtml(raw)),
      holdings: htmlHoldings,
      sourceUrl: url,
    };
  }

  const text = stripHtml(raw);
  return {
    snapshotDate: extractLatestDate(text),
    holdings: parseHoldingsFromLines(normalizeLines(text)),
    sourceUrl: url,
  };
}

async function fetchSourceHoldings(source: ActiveEtfSource): Promise<{ snapshotDate: string; holdings: ActiveEtfHolding[]; sourceUrl: string }> {
  const urls = [source.url, ...(source.fallbackUrls || [])];
  const minHoldings = Math.max(1, source.minHoldings || 1);
  let best: { snapshotDate: string; holdings: ActiveEtfHolding[]; sourceUrl: string } | null = null;
  const errors: string[] = [];

  for (const url of urls) {
    try {
      const result = await fetchHoldingsFromUrl(source, url);
      if (!best || result.holdings.length > best.holdings.length) best = result;
      if (result.holdings.length >= minHoldings) return result;
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (best && best.holdings.length > 0) return best;
  throw new Error(errors.length > 0 ? errors.join(' | ') : 'no holdings parsed from source');
}

function getFlowAction(current: ActiveEtfHolding, previous?: ActiveEtfHolding): ActiveEtfFlowAction {
  if (!previous) return 'added';
  const currentWeight = current.weightPct ?? 0;
  const previousWeight = previous.weightPct ?? 0;
  const diff = currentWeight - previousWeight;
  if (diff >= 0.05) return 'increased';
  if (diff <= -0.05) return 'decreased';
  const currentShares = current.shares ?? 0;
  const previousShares = previous.shares ?? 0;
  if (currentShares > previousShares) return 'increased';
  if (currentShares < previousShares) return 'decreased';
  return 'held';
}

function getAdminClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase server configuration');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function importOneSource(source: ActiveEtfSource): Promise<ImportResult> {
  const supabase = getAdminClient();
  const { snapshotDate, holdings, sourceUrl } = await fetchSourceHoldings(source);
  if (holdings.length === 0) throw new Error('no holdings parsed from source');

  const { data: prevDateRows, error: prevDateError } = await supabase
    .from('active_etf_holdings')
    .select('snapshot_date')
    .eq('etf_code', source.etfCode)
    .lt('snapshot_date', snapshotDate)
    .order('snapshot_date', { ascending: false })
    .limit(1);
  if (prevDateError) throw new Error(prevDateError.message);

  const previousDate = prevDateRows?.[0]?.snapshot_date ? String(prevDateRows[0].snapshot_date) : null;
  const previousHoldings = new Map<string, ActiveEtfHolding>();
  if (previousDate) {
    const { data, error } = await supabase
      .from('active_etf_holdings')
      .select('coid,stkname,weight_pct,shares')
      .eq('etf_code', source.etfCode)
      .eq('snapshot_date', previousDate);
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      previousHoldings.set(String(row.coid), {
        coid: String(row.coid),
        stkname: String(row.stkname || row.coid),
        weightPct: parseNumber(row.weight_pct),
        shares: parseNumber(row.shares),
      });
    }
  }

  const holdingRows = holdings.map(item => ({
    snapshot_date: snapshotDate,
    etf_code: source.etfCode,
    etf_name: source.etfName,
    coid: item.coid,
    stkname: item.stkname,
    weight_pct: item.weightPct,
    shares: item.shares,
    source_url: sourceUrl,
    collected_at: new Date().toISOString(),
  }));

  const { error: holdingError } = await supabase
    .from('active_etf_holdings')
    .upsert(holdingRows, { onConflict: 'snapshot_date,etf_code,coid', ignoreDuplicates: false });
  if (holdingError) throw new Error(holdingError.message);

  const currentByCode = new Map(holdings.map(item => [item.coid, item]));
  const flowRows: Array<{
    flow_date: string;
    etf_code: string;
    etf_name: string;
    coid: string;
    stkname: string;
    action: ActiveEtfFlowAction;
    weight_pct: number | null;
    previous_weight_pct: number | null;
    weight_change_pct: number | null;
    shares: number | null;
    previous_shares: number | null;
    share_change: number | null;
    source_url: string;
    collected_at: string;
  }> = holdings.map(item => {
    const prev = previousHoldings.get(item.coid);
    const weightChange = item.weightPct !== null && prev?.weightPct !== null && prev?.weightPct !== undefined
      ? Number((item.weightPct - prev.weightPct).toFixed(4))
      : null;
    const shareChange = item.shares !== null && prev?.shares !== null && prev?.shares !== undefined
      ? item.shares - prev.shares
      : null;
    return {
      flow_date: snapshotDate,
      etf_code: source.etfCode,
      etf_name: source.etfName,
      coid: item.coid,
      stkname: item.stkname,
      action: getFlowAction(item, prev),
      weight_pct: item.weightPct,
      previous_weight_pct: prev?.weightPct ?? null,
      weight_change_pct: weightChange,
      shares: item.shares,
      previous_shares: prev?.shares ?? null,
      share_change: shareChange,
      source_url: sourceUrl,
      collected_at: new Date().toISOString(),
    };
  });

  for (const [coid, prev] of previousHoldings) {
    if (currentByCode.has(coid)) continue;
    flowRows.push({
      flow_date: snapshotDate,
      etf_code: source.etfCode,
      etf_name: source.etfName,
      coid,
      stkname: prev.stkname,
      action: 'removed',
      weight_pct: null,
      previous_weight_pct: prev.weightPct,
      weight_change_pct: prev.weightPct === null ? null : Number((-prev.weightPct).toFixed(4)),
      shares: null,
      previous_shares: prev.shares,
      share_change: prev.shares === null ? null : -prev.shares,
      source_url: sourceUrl,
      collected_at: new Date().toISOString(),
    });
  }

  const { error: flowError } = await supabase
    .from('active_etf_stock_flows')
    .upsert(flowRows, { onConflict: 'flow_date,etf_code,coid', ignoreDuplicates: false });
  if (flowError) throw new Error(flowError.message);

  return {
    etfCode: source.etfCode,
    etfName: source.etfName,
    snapshotDate,
    holdings: holdingRows.length,
    flows: flowRows.length,
    sourceUrl,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sources = getActiveEtfSources();
  const results: ImportResult[] = [];
  for (const source of sources) {
    try {
      results.push(await importOneSource(source));
    } catch (error) {
      results.push({
        etfCode: source.etfCode,
        etfName: source.etfName,
        snapshotDate: todayTaipei(),
        holdings: 0,
        flows: 0,
        sourceUrl: source.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const successCount = results.filter(item => !item.error).length;
  return res.status(successCount > 0 ? 200 : 500).json({
    success: successCount > 0,
    successCount,
    total: results.length,
    results,
    generatedAt: new Date().toISOString(),
  });
}
