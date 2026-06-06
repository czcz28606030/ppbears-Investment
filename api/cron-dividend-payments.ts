import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type TradeStockRow = {
  user_id: string;
  stock_code: string;
  stock_name: string;
};

type DividendInfo = {
  stockCode: string;
  exDate: string;
  payDate: string;
  cashDividend: number;
  sourcePayload: Record<string, unknown>;
};

export const config = {
  maxDuration: 60,
};

function getAdminClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('Missing Supabase server configuration');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function toDateOnly(value: string): string {
  return value.slice(0, 10);
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 PPBearsInvestment/1.0',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function parseYahooDividend(stockCode: string, html: string): DividendInfo | null {
  const latestMatch = html.match(
    /"latestDividend":\{"year":"(?<year>[^"]*)","period":"(?<period>[^"]*)","isUpcoming":(?<isUpcoming>true|false),"exDividend":\{"cash":"(?<cash>[^"]*)","cashPayDate":"(?<payDate>[^"]*)","cashPayYear":"(?<payYear>[^"]*)","date":"(?<exDate>[^"]*)"/
  );
  const fallbackMatch = html.match(
    /"exDividend":\{"date":"(?<exDate>[^"]*)","cashPayDate":"(?<payDate>[^"]*)"/
  );

  const cash = latestMatch?.groups?.cash ? Number(latestMatch.groups.cash) : NaN;
  const exDate = latestMatch?.groups?.exDate || fallbackMatch?.groups?.exDate;
  const payDate = latestMatch?.groups?.payDate || fallbackMatch?.groups?.payDate;
  if (!exDate || !payDate || !Number.isFinite(cash) || cash <= 0) return null;

  return {
    stockCode,
    exDate: toDateOnly(exDate),
    payDate: toDateOnly(payDate),
    cashDividend: cash,
    sourcePayload: {
      provider: 'Yahoo Taiwan Stock',
      year: latestMatch?.groups?.year ?? null,
      period: latestMatch?.groups?.period ?? null,
      isUpcoming: latestMatch?.groups?.isUpcoming === 'true',
      rawExDate: exDate,
      rawPayDate: payDate,
    },
  };
}

async function fetchYahooDividend(stockCode: string): Promise<DividendInfo | null> {
  const symbols = [`${stockCode}.TW`, `${stockCode}.TWO`];
  for (const symbol of symbols) {
    try {
      const res = await fetchWithTimeout(`https://tw.stock.yahoo.com/quote/${symbol}/dividend`);
      if (!res.ok) continue;
      const html = await res.text();
      const parsed = parseYahooDividend(stockCode, html);
      if (parsed) return parsed;
    } catch (err) {
      console.error(`[Dividend] Yahoo fetch failed for ${symbol}`, err);
    }
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getAdminClient();
  const { data: trades, error } = await supabase
    .from('trades')
    .select('user_id, stock_code, stock_name')
    .eq('trade_type', 'buy');

  if (error) return res.status(500).json({ error: error.message });

  const rows = (trades || []) as TradeStockRow[];
  const pairMap = new Map<string, TradeStockRow>();
  const stockNameMap = new Map<string, string>();
  for (const row of rows) {
    pairMap.set(`${row.user_id}:${row.stock_code}`, row);
    if (!stockNameMap.has(row.stock_code)) stockNameMap.set(row.stock_code, row.stock_name);
  }

  const dividendMap = new Map<string, DividendInfo | null>();
  for (const stockCode of [...stockNameMap.keys()]) {
    dividendMap.set(stockCode, await fetchYahooDividend(stockCode));
  }

  const results: unknown[] = [];
  let creditedCount = 0;
  let scheduledCount = 0;
  let skippedCount = 0;

  for (const pair of pairMap.values()) {
    const info = dividendMap.get(pair.stock_code);
    if (!info) {
      skippedCount += 1;
      continue;
    }

    const { data, error: rpcError } = await (supabase as any).rpc('upsert_and_credit_dividend', {
      p_user_id: pair.user_id,
      p_stock_code: pair.stock_code,
      p_stock_name: pair.stock_name,
      p_ex_date: info.exDate,
      p_pay_date: info.payDate,
      p_cash_dividend: info.cashDividend,
      p_source: 'yahoo',
      p_source_payload: info.sourcePayload,
    });

    if (rpcError) {
      results.push({ stockCode: pair.stock_code, userId: pair.user_id, error: rpcError.message });
      continue;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row?.credited) creditedCount += 1;
    else if (row?.status === 'scheduled') scheduledCount += 1;
    else skippedCount += 1;
    results.push({ stockCode: pair.stock_code, userId: pair.user_id, result: row });
  }

  return res.status(200).json({
    success: true,
    stocksChecked: stockNameMap.size,
    userStockPairsChecked: pairMap.size,
    creditedCount,
    scheduledCount,
    skippedCount,
    results,
  });
}
