import type { StockPrice, StockTradingSignal } from '../types';

export type TrendStatusLevel = 'continuing' | 'sideways' | 'weakening' | 'ended';

export interface TrendStatusResult {
  level: TrendStatusLevel;
  label: string;
  reason: string;
}

export interface TrendStatusInput {
  aiSignal?: 'buy' | 'sell' | 'neutral' | null;
  prices?: StockPrice[] | null;
  tradingSignals?: StockTradingSignal[] | null;
  profitLossPct?: number | null;
  chipPts?: number | null;
}

type TradingEvent = {
  date: string;
  type: 'buy' | 'sell';
};

const BUY_TEXTS = new Set(['進場', '加碼', '買進', '建立', 'buy', 'Buy', 'BUY']);
const SELL_TEXTS = new Set(['出場', '賣出', '減碼', '結束', '出清', 'sell', 'Sell', 'SELL']);

function parseNumber(value: unknown): number | null {
  const n = Number(String(value ?? '').replace(/[%％,+]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(value: unknown): string {
  const raw = String(value ?? '').trim().replace(/\//g, '-');
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return raw;
}

function isOpenDate(value: string, inDate: string): boolean {
  return !value || value === 'NA' || value === 'null' || value === '-' || value === inDate;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sma(closes: number[], period: number, offset = 0): number | null {
  const end = closes.length - offset;
  const start = end - period;
  if (start < 0 || end > closes.length) return null;
  return average(closes.slice(start, end));
}

function pctChange(from: number | null, to: number | null): number | null {
  if (!from || !to || from <= 0) return null;
  return ((to - from) / from) * 100;
}

function buildTradingEvents(signals: StockTradingSignal[] | null | undefined): TradingEvent[] {
  const eventMap = new Map<string, TradingEvent['type']>();
  for (const signal of signals || []) {
    const inDate = normalizeDate(signal.inDate);
    const outDate = normalizeDate(signal.outDate);
    const text = String(signal.signal || '').trim();

    if (inDate) eventMap.set(inDate, 'buy');
    if (outDate && !isOpenDate(outDate, inDate) && (SELL_TEXTS.has(text) || signal.sellClose !== null)) {
      eventMap.set(outDate, 'sell');
    } else if (inDate && SELL_TEXTS.has(text)) {
      eventMap.set(inDate, 'sell');
    } else if (inDate && BUY_TEXTS.has(text)) {
      eventMap.set(inDate, 'buy');
    }
  }

  return [...eventMap.entries()]
    .map(([date, type]) => ({ date, type }))
    .filter(event => event.date && (event.type === 'buy' || event.type === 'sell'))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function countFlips(events: TradingEvent[]): number {
  let flips = 0;
  for (let i = 1; i < events.length; i += 1) {
    if (events[i].type !== events[i - 1].type) flips += 1;
  }
  return flips;
}

export function calculateTrendStatus(input: TrendStatusInput): TrendStatusResult {
  const closes = (input.prices || [])
    .map(price => parseNumber(price.close_d))
    .filter((value): value is number => value !== null && value > 0);
  const current = closes.at(-1) ?? null;
  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const ma20Prev10 = sma(closes, 20, 10);
  const return20 = closes.length >= 21 ? pctChange(closes.at(-21) ?? null, current) : null;
  const return40 = closes.length >= 41 ? pctChange(closes.at(-41) ?? null, current) : null;
  const ma20Slope = pctChange(ma20Prev10, ma20);
  const recent30 = closes.slice(-30);
  const recentRangePct = recent30.length >= 12
    ? pctChange(Math.min(...recent30), Math.max(...recent30))
    : null;
  const events = buildTradingEvents(input.tradingSignals);
  const recentEvents = events.slice(-5);
  const recentFlips = countFlips(recentEvents);
  const latestEvent = events.at(-1);
  const previousEvent = events.at(-2);
  const aiSignal = input.aiSignal ?? 'neutral';

  const belowMa20 = Boolean(current && ma20 && current < ma20);
  const aboveTrend = Boolean(current && ma5 && ma20 && current >= ma5 && ma5 >= ma20);
  const establishedUptrend = Boolean(
    (return40 !== null && return40 >= 18) ||
    (ma20Slope !== null && ma20Slope >= 8) ||
    (return20 !== null && return20 >= 12 && ma20Slope !== null && ma20Slope >= 3)
  );
  const sidewaysPrice = Boolean(
    (recentRangePct !== null && recentRangePct <= 28 && return20 !== null && Math.abs(return20) <= 14) ||
    (ma20Slope !== null && Math.abs(ma20Slope) <= 4 && current && ma20 && Math.abs(current - ma20) / ma20 <= 0.08)
  );
  const whipsawSignals = recentEvents.length >= 4 && recentFlips >= 3;
  const cleanExitAfterBuy = latestEvent?.type === 'sell' && previousEvent?.type === 'buy' && !whipsawSignals;
  const weakRisk = Boolean(
    (input.profitLossPct !== null && input.profitLossPct !== undefined && input.profitLossPct <= -20) ||
    (input.chipPts !== null && input.chipPts !== undefined && input.chipPts < 4) ||
    (return20 !== null && return20 <= -10 && belowMa20)
  );

  if (whipsawSignals || (sidewaysPrice && recentFlips >= 2)) {
    return {
      level: 'sideways',
      label: '盤整震盪',
      reason: '近期 AI 加碼與出場反覆，價格也偏區間來回，先視為盤整。',
    };
  }

  if (aiSignal === 'buy' && aboveTrend && (ma20Slope === null || ma20Slope >= 0)) {
    return {
      level: 'continuing',
      label: '趨勢延續',
      reason: 'AI 加碼後價格仍在 MA5/MA20 上方，均線方向維持正面。',
    };
  }

  if (aiSignal === 'sell') {
    if (establishedUptrend && cleanExitAfterBuy) {
      return {
        level: 'ended',
        label: '趨勢結束',
        reason: '前段已有明確上升趨勢，AI 加碼後出現乾淨出場訊號，視為主升段結束警示。',
      };
    }
    if (belowMa20 && weakRisk) {
      return {
        level: 'ended',
        label: '趨勢結束',
        reason: 'AI 出場後價格跌破 MA20，且損益或籌碼同步轉弱。',
      };
    }
    return {
      level: 'weakening',
      label: '轉弱觀察',
      reason: belowMa20
        ? 'AI 出場且價格轉到 MA20 下方，但尚未形成完整趨勢結束確認。'
        : 'AI 出場但價格尚未明顯跌破 MA20，先觀察是否只是回檔。',
    };
  }

  if (sidewaysPrice) {
    return {
      level: 'sideways',
      label: '盤整震盪',
      reason: '價格靠近 MA5/MA20 區間整理，尚未走出明確方向。',
    };
  }

  return {
    level: 'weakening',
    label: '轉弱觀察',
    reason: '目前訊號未形成明確延續或結束，先保守觀察。',
  };
}
