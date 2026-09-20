import type { StockPrice, StockTradingSignal } from '../types.js';

export type OfficialMarket = 'listed' | 'otc';

export type StockChartMergeResult = {
  prices: StockPrice[];
  ifalgoLatestDate: string;
  chartLatestDate: string;
  supplemented: boolean;
  officialOnly: boolean;
};

export function getStockChartDataNote(
  chart: StockChartMergeResult,
  officialLatestDate: string,
  officialHistoryFailed: boolean,
): { text: string; tone: 'info' | 'warning' } {
  const chartBehindQuote = Boolean(
    chart.chartLatestDate && officialLatestDate && chart.chartLatestDate < officialLatestDate,
  );
  const source = chart.officialOnly
    ? `目前使用官方日K至 ${chart.chartLatestDate}；IFAlgo／AI訊號資料暫時不可用，因此不顯示AI箭頭。`
    : chart.supplemented
      ? `官方日K已補至 ${chart.chartLatestDate}；IFAlgo／AI訊號資料仍到 ${chart.ifalgoLatestDate}，補入的K線不會產生AI箭頭。`
      : chart.ifalgoLatestDate
        ? `IFAlgo 線圖仍停在 ${chart.ifalgoLatestDate}。`
        : '';
  if (chartBehindQuote) {
    return {
      text: `${source}官方收盤已到 ${officialLatestDate}，線圖仍有缺口${officialHistoryFailed ? '；官方日K目前無法補入。' : '，正在等待官方日K資料。'}`,
      tone: 'warning',
    };
  }
  if (chart.officialOnly || chart.supplemented) return { text: source, tone: 'info' };
  if (officialHistoryFailed && chart.ifalgoLatestDate) {
    return {
      text: `目前顯示 IFAlgo 日K至 ${chart.ifalgoLatestDate}；官方日K暫時無法載入。`,
      tone: 'warning',
    };
  }
  return { text: '', tone: 'info' };
}

export function isIsoCalendarDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function limitSignalsToIfalgoDates(
  signals: StockTradingSignal[],
  ifalgoPrices: StockPrice[],
): StockTradingSignal[] {
  const ifalgoDates = new Set(
    ifalgoPrices.map(price => normalizeDate(price.mdate)).filter(Boolean),
  );
  return signals.map(signal => ({
    ...signal,
    inDate: ifalgoDates.has(normalizeDate(signal.inDate)) ? signal.inDate : '',
    outDate: ifalgoDates.has(normalizeDate(signal.outDate)) ? signal.outDate : '',
  }));
}

type HistoryPayload = {
  stat?: string;
  data?: unknown[];
  tables?: Array<{ data?: unknown[] }>;
};

function normalizeDate(value: unknown): string {
  const raw = String(value ?? '').trim();
  const rocMatch = raw.match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
  if (rocMatch) {
    return `${Number(rocMatch[1]) + 1911}-${rocMatch[2]}-${rocMatch[3]}`;
  }
  const isoMatch = raw.replace(/\//g, '-').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const compactMatch = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  return compactMatch ? `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}` : '';
}

function parseNumber(value: unknown): number | null {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!normalized || normalized === '--') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRows(coid: string, rows: unknown[], volumeDivisor: number): StockPrice[] {
  return rows.flatMap(row => {
    if (!Array.isArray(row)) return [];
    const [dateValue, volumeValue, , openValue, highValue, lowValue, closeValue] = row;
    const mdate = normalizeDate(dateValue);
    const open = parseNumber(openValue);
    const high = parseNumber(highValue);
    const low = parseNumber(lowValue);
    const close = parseNumber(closeValue);
    const volume = parseNumber(volumeValue);
    if (!mdate || open === null || high === null || low === null || close === null || volume === null) return [];
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) return [];

    return [{
      coid,
      mdate,
      open_d: open.toFixed(2),
      high_d: high.toFixed(2),
      low_d: low.toFixed(2),
      close_d: close.toFixed(2),
      volume: volume / volumeDivisor,
      pe_ratio: '',
      pb_ratio: '',
      roia: null,
    } satisfies StockPrice];
  });
}

export function normalizeTwseHistory(coid: string, payload: unknown): StockPrice[] {
  const typed = payload as HistoryPayload;
  if (typed?.stat !== 'OK' || !Array.isArray(typed.data)) return [];
  return normalizeRows(coid, typed.data, 1000);
}

export function normalizeTpexHistory(coid: string, payload: unknown): StockPrice[] {
  const typed = payload as HistoryPayload;
  const rows = typed?.tables?.[0]?.data;
  if (String(typed?.stat || '').toLowerCase() !== 'ok' || !Array.isArray(rows)) return [];
  return normalizeRows(coid, rows, 1);
}

export function mergeStockChartPrices(
  ifalgoPrices: StockPrice[],
  officialPrices: StockPrice[],
): StockChartMergeResult {
  const sortedIfalgo = [...ifalgoPrices]
    .filter(price => Boolean(normalizeDate(price.mdate)))
    .sort((a, b) => normalizeDate(a.mdate).localeCompare(normalizeDate(b.mdate)));
  const ifalgoLatestDate = normalizeDate(sortedIfalgo[sortedIfalgo.length - 1]?.mdate || '');
  const priceByDate = new Map<string, StockPrice>();

  for (const price of sortedIfalgo) {
    priceByDate.set(normalizeDate(price.mdate), price);
  }
  for (const price of officialPrices) {
    const date = normalizeDate(price.mdate);
    if (date && (!ifalgoLatestDate || date > ifalgoLatestDate)) {
      priceByDate.set(date, { ...price, mdate: date });
    }
  }

  const prices = [...priceByDate.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([, price]) => price);
  const chartLatestDate = normalizeDate(prices[prices.length - 1]?.mdate || '');
  return {
    prices,
    ifalgoLatestDate,
    chartLatestDate,
    supplemented: Boolean(ifalgoLatestDate && chartLatestDate > ifalgoLatestDate),
    officialOnly: Boolean(!ifalgoLatestDate && chartLatestDate),
  };
}

export function getOfficialHistoryMonths(
  sinceDate: string,
  todayDate: string,
  maxMonths = 3,
): string[] {
  const normalizedToday = normalizeDate(todayDate);
  if (!isIsoCalendarDate(normalizedToday)) return [];
  const normalizedSince = normalizeDate(sinceDate);
  const end = new Date(`${normalizedToday.slice(0, 7)}-01T00:00:00Z`);
  const boundedMaxMonths = Math.max(1, Math.floor(maxMonths));
  const earliest = new Date(end);
  earliest.setUTCMonth(earliest.getUTCMonth() - boundedMaxMonths + 1);
  const requestedStart = isIsoCalendarDate(normalizedSince)
    ? new Date(`${normalizedSince.slice(0, 7)}-01T00:00:00Z`)
    : new Date(end);
  const start = requestedStart < earliest ? earliest : requestedStart;
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return [];

  const months: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    months.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}01`);
  }
  return months;
}
