import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrendStrategy, type StrategyBar } from './trendStrategy.ts';

const bars = (n = 85): StrategyBar[] => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10), open: 100 + i * .1, high: 102 + i * .1, low: 98 + i * .1, close: 100 + i * .1, volume: 1000 }));
const base = () => ({ code: '2308', bars: bars(), weeklyRank: 1, weeklyDate: '2026-08-20', weeklyAvailable: true, nowDate: '2026-08-24', latestPriceDate: '2026-08-24', holding: null, trades: [], equity: 100000, cash: 100000, history: [] });
test('unheld breakout needs fresh candidate, rising MA60 and excludes current high', () => {
  const input = base(); input.bars.at(-1)!.close = 115; input.bars.at(-1)!.high = 116;
  assert.equal(evaluateTrendStrategy(input).action, 'entry');
  assert.equal(evaluateTrendStrategy({ ...input, weeklyRank: null }).action, 'neutral');
  assert.equal(evaluateTrendStrategy({ ...input, weeklyAvailable: false }).action, 'unavailable');
});
test('no future bars, missing history and stale prices cannot generate advice', () => {
  const input = base();
  assert.equal(evaluateTrendStrategy({ ...input, bars: input.bars.slice(0, 25) }).action, 'unavailable');
  assert.equal(evaluateTrendStrategy({ ...input, latestPriceDate: '2026-08-25' }).action, 'unavailable');
  const decision = evaluateTrendStrategy({ ...input, bars: [...input.bars, { ...input.bars.at(-1)!, date: '2026-08-26', close: 999 }] });
  assert.equal(decision.close, input.bars.at(-1)!.close);
});
test('actual first entry anchors initial R; additional buys do not reset it', () => {
  const input = base();
  const trades = [{ date: input.bars[70].date, type: 'buy' as const, quantity: 100, price: 107 }, { date: input.bars[78].date, type: 'buy' as const, quantity: 20, price: 110 }];
  const one = evaluateTrendStrategy({ ...input, holding: { quantity: 100, avgCost: 107 }, trades: trades.slice(0, 1) });
  const two = evaluateTrendStrategy({ ...input, holding: { quantity: 120, avgCost: 107.5 }, trades });
  assert.equal(one.initialRisk, 10);
  assert.equal(two.initialRisk, one.initialRisk);
  assert.equal(two.addTriggerPrice, 127);
});
test('exit has priority and protection never loosens when ATR rises', () => {
  const input = base();
  const trades = [{ date: input.bars[70].date, type: 'buy' as const, quantity: 100, price: 107 }];
  input.bars.at(-1)!.close = 90; input.bars.at(-1)!.low = 89;
  const result = evaluateTrendStrategy({ ...input, holding: { quantity: 100, avgCost: 107 }, trades });
  assert.equal(result.action, 'exit');
  assert.ok(result.protectionPrice! >= 97);
});
test('unknown legacy position cannot fabricate risk or add recommendations', () => {
  const result = evaluateTrendStrategy({ ...base(), holding: { quantity: 100, avgCost: 90 } });
  assert.equal(result.initialRisk, null);
  assert.notEqual(result.action, 'add');
  assert.match(result.reason, /交易|風險/);
});
test('current weekly list never creates historical entry arrows', () => {
  const input = base(); input.bars.at(-1)!.close = 115; input.bars.at(-1)!.high = 116;
  assert.deepEqual(evaluateTrendStrategy(input).events, []);
});
test('a missing middle month cannot masquerade as a complete daily series', () => {
  const input = base();
  const gap = input.bars.filter((_, i) => i < 20 || i > 40);
  // Keep enough candles to distinguish a gap from the ordinary warmup guard.
  const prefix = Array.from({ length: 20 }, (_, i) => ({ ...input.bars[0], date: new Date(Date.UTC(2026, 4, 12 + i)).toISOString().slice(0, 10) }));
  const result = evaluateTrendStrategy({ ...input, bars: [...prefix, ...gap] });
  assert.equal(result.action, 'unavailable');
  assert.match(result.reason, /缺口/);
});
test('future weekly membership cannot qualify the current close', () => {
  const input = base(); input.bars.at(-1)!.close = 115; input.bars.at(-1)!.high = 116;
  assert.equal(evaluateTrendStrategy({ ...input, weeklyDate: '2026-08-25' }).action, 'unavailable');
});
test('matching share counts cannot certify an inconsistent actual cost basis', () => {
  const input = base(); input.bars.at(-1)!.close = 130; input.bars.at(-1)!.high = 132;
  const result = evaluateTrendStrategy({ ...input, holding: { quantity: 10, avgCost: 50 }, trades: [{ date: input.bars[70].date, type: 'buy', quantity: 10, price: 107 }] });
  assert.equal(result.action, 'unavailable');
  assert.equal(result.initialRisk, null);
  assert.equal(result.suggestedQuantity, 0);
});
