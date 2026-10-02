export const STRATEGY_SOURCE = 'weekly-trend-v1' as const;
export type StrategyAction = 'entry' | 'neutral' | 'add' | 'hold' | 'reduce' | 'exit' | 'unavailable';
export type StrategyEvent = { date: string; action: 'entry' | 'add' | 'reduce' | 'exit'; label: string; reason: string };
export type StrategyBar = { date: string; open: number; high: number; low: number; close: number; volume: number };
export type StrategyTrade = { date: string; type: 'buy' | 'sell'; quantity: number; price: number; timestamp?: number };
export type WeeklyMembership = { availableDate: string; weekEndDate: string; codes: string[] };
export type StrategyDecision = {
  code: string; action: StrategyAction; label: string; reason: string; dataDate: string;
  source: typeof STRATEGY_SOURCE; held: boolean; close: number | null; ma20: number | null; ma60: number | null;
  breakoutPrice: number | null; atr: number | null; initialRisk: number | null; protectionPrice: number | null;
  addTriggerPrice: number | null; suggestedQuantity: number; events: StrategyEvent[];
  weeklyRank: number | null; weeklyDate: string; status: 'ready' | 'unavailable';
};
export type StrategySignalsPayload = { source: typeof STRATEGY_SOURCE; generatedAt: string; signals: Record<string, StrategyDecision>; journalStatus?: 'saved' | 'unavailable' };
export type StrategyInput = {
  code: string; bars: StrategyBar[]; weeklyRank: number | null; weeklyDate: string; weeklyAvailable: boolean;
  nowDate: string; latestPriceDate: string; holding: { quantity: number; avgCost: number } | null;
  trades: StrategyTrade[]; equity: number; cash: number; history: WeeklyMembership[];
  corporateActionPending?: boolean;
};
const labels: Record<StrategyAction, string> = { entry: '進場', neutral: '中立', add: '加碼', hold: '續抱', reduce: '減碼', exit: '出場', unavailable: '資料不足' };
const round = (n: number) => Math.round(n * 10000) / 10000;
const mean = (numbers: number[]) => numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
function atrAt(bars: StrategyBar[], index: number): number | null {
  if (index < 14) return null;
  return mean(bars.slice(index - 13, index + 1).map((bar, j) => {
    const prev = bars[index - 14 + j].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - prev), Math.abs(bar.low - prev));
  }));
}
function indicators(bars: StrategyBar[], i: number) {
  if (i < 64) return null;
  const ma20 = mean(bars.slice(i - 19, i + 1).map(b => b.close));
  const ma60 = mean(bars.slice(i - 59, i + 1).map(b => b.close));
  const oldMa60 = mean(bars.slice(i - 64, i - 4).map(b => b.close));
  const high = Math.max(...bars.slice(i - 20, i).map(b => b.high));
  const previousHigh = Math.max(...bars.slice(i - 21, i - 1).map(b => b.high));
  return { ma20, ma60, atr: atrAt(bars, i)!, high, rising: ma60 > oldMa60 && bars[i].close > ma60,
    newBreakout: bars[i].close > high && bars[i - 1].close <= previousHigh };
}
function historicalMember(input: StrategyInput, date: string): boolean {
  const known = [...input.history].filter(row => row.availableDate <= date && row.weekEndDate <= date).sort((a, b) => a.availableDate.localeCompare(b.availableDate)).at(-1);
  return Boolean(known && known.codes.includes(input.code) && (Date.parse(date) - Date.parse(known.weekEndDate)) / 86400000 <= 14);
}

export function evaluateTrendStrategy(input: StrategyInput): StrategyDecision {
  const bars = [...input.bars].filter(b => b.date <= input.nowDate).sort((a, b) => a.date.localeCompare(b.date));
  const current = bars.at(-1);
  const held = Boolean(input.holding && input.holding.quantity > 0);
  const result: StrategyDecision = { code: input.code, source: STRATEGY_SOURCE, action: 'unavailable', label: labels.unavailable,
    reason: '', status: 'unavailable', held, dataDate: current?.date || '', close: current?.close ?? null,
    ma20: null, ma60: null, atr: null, breakoutPrice: null, initialRisk: null, protectionPrice: null,
    addTriggerPrice: null, suggestedQuantity: 0, events: [], weeklyRank: input.weeklyRank, weeklyDate: input.weeklyDate };
  const unavailable = (reason: string) => ({ ...result, reason });
  if (bars.length < 65) return unavailable('官方日K不足65個交易日，無法確認季線趨勢');
  if (bars.some((b, i) => !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || ![b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite)
    || b.low <= 0 || b.close <= 0 || b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close) || (i > 0 && b.date === bars[i - 1].date))) return unavailable('官方日K不完整或重複，暫停訊號');
  if (bars.some((bar, i) => i > 0 && (Date.parse(bar.date) - Date.parse(bars[i - 1].date)) / 86400000 > 14)) return unavailable('官方日K有超過兩週的缺口，等待補齊後再判斷');
  if (!input.latestPriceDate || current!.date < input.latestPriceDate) return unavailable('官方日K落後最新官方收盤，等待補齊');
  if ((Date.parse(input.nowDate) - Date.parse(current!.date)) / 86400000 > 7) return unavailable('官方價格超過7天未更新，暫停訊號');
  if (input.corporateActionPending || Math.abs(current!.close / bars.at(-2)!.close - 1) > .25) return unavailable('價格可能有除權息或分割，等待調整確認');
  const nowIndicators = indicators(bars, bars.length - 1)!;
  Object.assign(result, { ma20: round(nowIndicators.ma20), ma60: round(nowIndicators.ma60), atr: round(nowIndicators.atr), breakoutPrice: round(nowIndicators.high) });
  const set = (action: StrategyAction, reason: string, quantity = 0): StrategyDecision => ({ ...result, action, label: labels[action], status: action === 'unavailable' ? 'unavailable' : 'ready', reason, suggestedQuantity: quantity });

  const validTrades = input.trades.filter(t => t.date <= input.nowDate && t.quantity > 0 && t.price > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.timestamp || 0) - (b.timestamp || 0));
  let quantity = 0, averageCost = 0, firstEntry: StrategyTrade | null = null, initialRisk: number | null = null;
  let protection: number | null = null, peak = 0, addCount = 0, belowCount = 0, exitTriggered = false;
  let lastAddDate = '', lastReduceDate = '', lastSellDate = '', lastBuyDate = '', inconsistentTrades = false;
  let tradeIndex = 0;
  const events: StrategyEvent[] = [];
  // Reconstruct actual episodes. No synthetic buy fills or retrospective weekly membership.
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    while (tradeIndex < validTrades.length && validTrades[tradeIndex].date <= bar.date) {
      const trade = validTrades[tradeIndex++];
      if (trade.type === 'buy') {
        lastBuyDate = trade.date;
        if (quantity <= 0) {
          firstEntry = trade; addCount = 0; peak = trade.price; protection = null; exitTriggered = false;
          belowCount = 0; lastReduceDate = ''; lastAddDate = '';
          const beforeBuyIndex = bars.findLastIndex(b => b.date < trade.date);
          const firstAtr = beforeBuyIndex >= 0 ? atrAt(bars, beforeBuyIndex) : null;
          initialRisk = firstAtr && firstAtr > 0 ? firstAtr * 2.5 : null;
          if (initialRisk) protection = Math.max(.01, trade.price - initialRisk);
        } else addCount++;
        averageCost = (averageCost * quantity + trade.price * trade.quantity) / (quantity + trade.quantity);
        quantity += trade.quantity;
      } else {
        if (quantity < trade.quantity) inconsistentTrades = true;
        quantity = Math.max(0, quantity - trade.quantity);
        lastSellDate = trade.date;
        if (quantity === 0) { averageCost = 0; firstEntry = null; initialRisk = null; protection = null; peak = 0; exitTriggered = false; belowCount = 0; }
      }
    }
    const ind = indicators(bars, i);
    const member = historicalMember(input, bar.date);
    if (quantity <= 0) {
      if (ind && member && ind.rising && ind.newBreakout) events.push({ date: bar.date, action: 'entry', label: '進場', reason: '當時週榜候選，季線向上且新突破20日高點' });
      continue;
    }
    peak = Math.max(peak, bar.close);
    // Test the protection active BEFORE this close. A newly raised stop applies on the next bar.
    const breached = protection !== null && bar.close < protection;
    const previousBelow = belowCount;
    belowCount = ind && bar.close < ind.ma20 ? belowCount + 1 : 0;
    if (breached && !exitTriggered) {
      events.push({ date: bar.date, action: 'exit', label: '出場', reason: '收盤跌破持有期保護線' });
      exitTriggered = true;
    } else if (!exitTriggered && belowCount === 2 && previousBelow === 1) {
      lastReduceDate = bar.date;
      events.push({ date: bar.date, action: 'reduce', label: '減碼', reason: '連續兩日收盤低於20日均線' });
    } else if (!exitTriggered && ind && member && ind.rising && ind.newBreakout && firstEntry && initialRisk
      && bar.close >= firstEntry.price + 2 * initialRisk && bar.date > firstEntry.date && addCount < 2) {
      // Historical risk budgets are not available: do not fabricate add arrows.
      lastAddDate = bar.date;
    }
    const dayAtr = atrAt(bars, i);
    if (protection !== null && dayAtr !== null) protection = Math.max(protection, peak - 3 * dayAtr);
  }
  // Trades on dates outside the fetched history must not create an invented episode.
  if (tradeIndex < validTrades.length) inconsistentTrades = true;
  result.events = events;
  if (!held) {
    if (!input.weeklyAvailable) return set('unavailable', '週榜暫時無法讀取，無法核對進場資格');
    if (input.weeklyDate > current!.date) return set('unavailable', '週榜日期晚於官方收盤日，等待行情與候選日期對齊');
    if (!input.weeklyDate || (Date.parse(input.nowDate) - Date.parse(input.weeklyDate)) / 86400000 > 14) return set('unavailable', '週榜超過兩週未更新，暫停新進場');
    if (input.weeklyRank === null) return set('neutral', '不在最新週榜，暫停新進場');
    if (!nowIndicators.rising) return set('neutral', '等待股價站上向上的60日均線');
    if (!nowIndicators.newBreakout) return set('neutral', `等待新的收盤突破此前20日高點 ${result.breakoutPrice} 元`);
    if (quantity > 0) return set('unavailable', '交易紀錄與目前庫存不一致，請先核對');
    return set('entry', '位於最新週榜，季線向上，收盤首次突破此前20日高點');
  }
  // Allow ordinary fee/rounding differences; refuse mismatched corporate-adjusted or incomplete cost bases.
  const costMatches = Math.abs(averageCost - input.holding!.avgCost) <= Math.max(.01, averageCost * .005);
  const reconstructed = firstEntry && quantity === input.holding!.quantity && costMatches && !inconsistentTrades;
  if (!reconstructed) {
    result.events = [];
    const prevInd = indicators(bars, bars.length - 2);
    if (prevInd && current!.close < nowIndicators.ma20 && bars.at(-2)!.close < prevInd.ma20) return set('reduce', '連續兩日低於20日均線；交易紀錄不足，未建立初始R與保護線', Math.ceil(input.holding!.quantity / 2));
    return set('unavailable', '交易紀錄與庫存無法完整核對，暫停加碼；需要首次進場資料建立風險基準');
  }
  result.initialRisk = initialRisk === null ? null : round(initialRisk);
  result.protectionPrice = protection === null ? null : round(protection);
  result.addTriggerPrice = firstEntry && initialRisk ? round(firstEntry.price + 2 * initialRisk) : null;
  if (exitTriggered) return set('exit', '已跌破保護線；出場條件持續有效，優先處理剩餘部位', quantity);
  if (belowCount >= 2 && lastReduceDate > lastSellDate) return set('reduce', '連續兩日低於20日均線，建議先減少一半；本次條件不重複觸發', Math.ceil(quantity / 2));
  if (!initialRisk || !firstEntry) return set('unavailable', '首次買入前的官方K線不足，無法建立初始R；暫停加碼');
  if (!input.weeklyAvailable || !input.weeklyDate || input.weeklyDate > current!.date || input.weeklyRank === null || (Date.parse(input.nowDate) - Date.parse(input.weeklyDate)) / 86400000 > 14) return set('hold', '保護線未破；週榜資格不足，停止加碼並續抱觀察');
  if (!(nowIndicators.newBreakout && nowIndicators.rising && current!.close >= result.addTriggerPrice! && current!.close > input.holding!.avgCost)) return set('hold', `等待獲利達2R（${result.addTriggerPrice}元）且整理後再次突破；保護線 ${result.protectionPrice} 元`);
  if (current!.date <= firstEntry.date || lastBuyDate === current!.date || lastSellDate === current!.date || addCount >= 2) return set('hold', '當日已有交易或已達兩次加碼上限，維持部位');
  const stopDistance = current!.close - protection!;
  const riskBudget = input.equity * .005;
  const allowedByRisk = stopDistance > 0 ? riskBudget / stopDistance - quantity : 0;
  const allowedByWeight = input.equity * .2 / current!.close - quantity;
  const suggested = Math.floor(Math.min(firstEntry.quantity * .75, allowedByRisk, allowedByWeight, input.cash / (current!.close * 1.002)));
  if (!(input.equity > 0) || !(suggested > 0)) return set('hold', '已達2R與突破條件，但加碼會超過0.5%風險、20%單檔上限或可用現金');
  // Only a fully risk-qualified CURRENT signal may become an add event.
  if (lastAddDate === current!.date && historicalMember(input, current!.date)) result.events.push({ date: current!.date, action: 'add', label: '加碼', reason: '獲利2R、再次突破且帳戶風險合格' });
  return set('add', '獲利達2R，整理後再次突破；股數已受風險、權重與現金限制', suggested);
}
