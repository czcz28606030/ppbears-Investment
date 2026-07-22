import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateRealizedTradeStats } from './tradeRealizedStats.ts';

test('calculates all realized account statistics from stock trades', () => {
  const stats = calculateRealizedTradeStats([
    { tradeType: 'buy', stockCode: '2330', totalAmount: 500 },
    { tradeType: 'sell', stockCode: '2330', totalAmount: 330, profit: 80 },
    { tradeType: 'sell', stockCode: '2317', totalAmount: 170, profit: -30 },
    { tradeType: 'buy', stockCode: '2317', totalAmount: 200 },
    { tradeType: 'deposit', stockCode: '', totalAmount: 1000 },
    { tradeType: 'withdraw', stockCode: '', totalAmount: 50 },
  ]);

  assert.equal(stats.realizedProfit, 50);
  assert.equal(stats.realizedCostBasis, 450);
  assert.equal(stats.realizedReturnPct, (50 / 450) * 100);
  assert.equal(stats.winCount, 1);
  assert.equal(stats.lossCount, 1);
  assert.equal(stats.winRatePct, 50);
  assert.equal(stats.stockCount, 2);
  assert.equal(stats.tradeCount, 4);
});

test('excludes break-even sells from win rate but keeps their cost and trade count', () => {
  const stats = calculateRealizedTradeStats([
    { tradeType: 'sell', stockCode: '0050', totalAmount: 100, profit: 0 },
  ]);

  assert.equal(stats.realizedProfit, 0);
  assert.equal(stats.realizedCostBasis, 100);
  assert.equal(stats.realizedReturnPct, 0);
  assert.equal(stats.winCount, 0);
  assert.equal(stats.lossCount, 0);
  assert.equal(stats.winRatePct, null);
  assert.equal(stats.stockCount, 1);
  assert.equal(stats.tradeCount, 1);
});

test('returns unavailable percentages when there is no valid sell denominator', () => {
  const stats = calculateRealizedTradeStats([
    { tradeType: 'buy', stockCode: '0050', totalAmount: 100 },
  ]);

  assert.equal(stats.realizedProfit, 0);
  assert.equal(stats.realizedCostBasis, 0);
  assert.equal(stats.realizedReturnPct, null);
  assert.equal(stats.winRatePct, null);
  assert.equal(stats.stockCount, 1);
  assert.equal(stats.tradeCount, 1);
});

test('ignores invalid numeric fields without producing NaN', () => {
  const stats = calculateRealizedTradeStats([
    { tradeType: 'sell', stockCode: '1101', totalAmount: 100, profit: 'invalid' },
    { tradeType: 'sell', stockCode: '1101', totalAmount: 'invalid', profit: 10 },
    { tradeType: 'sell', stockCode: '', totalAmount: 55, profit: 5 },
  ]);

  assert.equal(stats.realizedProfit, 15);
  assert.equal(stats.realizedCostBasis, 50);
  assert.equal(stats.realizedReturnPct, 30);
  assert.equal(stats.winCount, 2);
  assert.equal(stats.lossCount, 0);
  assert.equal(stats.winRatePct, 100);
  assert.equal(stats.stockCount, 1);
  assert.equal(stats.tradeCount, 3);
  assert.equal(Number.isNaN(stats.realizedProfit), false);
});
