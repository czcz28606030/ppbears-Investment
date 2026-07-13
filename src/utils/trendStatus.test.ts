import assert from 'node:assert/strict';
import test from 'node:test';
import type { StockPrice, StockTradingSignal } from '../types.ts';
import { calculateTrendStatus } from './trendStatus.ts';

function prices(closes: number[]): StockPrice[] {
  return closes.map((close, index) => ({
    coid: '3715',
    mdate: `2026-06-${String(index + 1).padStart(2, '0')}`,
    open_d: String(close),
    high_d: String(close),
    low_d: String(close),
    close_d: String(close),
    volume: 1000,
    pe_ratio: '',
    pb_ratio: '',
    roia: null,
  }));
}

function whipsawSignals(): StockTradingSignal[] {
  return [
    ['2026-05-01', '買進'],
    ['2026-05-05', '賣出'],
    ['2026-05-08', '買進'],
    ['2026-05-12', '賣出'],
    ['2026-05-15', '買進'],
  ].map(([date, signal], index) => ({
    id: String(index),
    coid: '3715',
    stockName: '定穎投控',
    inDate: date,
    buyClose: signal === '買進' ? 170 : null,
    outDate: date,
    sellClose: signal === '賣出' ? 170 : null,
    signal,
    returnPct: '0',
    createdAt: date,
    updatedAt: date,
  }));
}

const consolidation = [
  168, 171, 169, 172, 166, 170, 173, 167, 169, 171,
  165, 168, 172, 170, 167, 169, 171, 166, 168, 170,
];

test('returns breakdown after two closes below the consolidation floor', () => {
  const result = calculateTrendStatus({
    aiSignal: 'buy',
    prices: prices([...consolidation, 163, 162]),
  });

  assert.equal(result.level, 'breakdown');
  assert.equal(result.label, '跌破盤整');
});

test('returns weakening on the first small close below the consolidation floor', () => {
  const result = calculateTrendStatus({
    aiSignal: 'buy',
    prices: prices([...consolidation, 164]),
  });

  assert.equal(result.level, 'weakening');
  assert.equal(result.label, '轉弱觀察');
});

test('returns breakdown immediately when the close is at least three percent below the floor', () => {
  const result = calculateTrendStatus({
    aiSignal: 'buy',
    prices: prices([...consolidation, 159]),
  });

  assert.equal(result.level, 'breakdown');
});

test('does not keep breakdown after price recovers above the consolidation floor', () => {
  const result = calculateTrendStatus({
    aiSignal: 'neutral',
    prices: prices([...consolidation, 162, 168]),
  });

  assert.notEqual(result.level, 'breakdown');
});

test('confirmed price breakdown overrides whipsaw AI signals', () => {
  const result = calculateTrendStatus({
    aiSignal: 'buy',
    prices: prices([...consolidation, 163, 162]),
    tradingSignals: whipsawSignals(),
  });

  assert.equal(result.level, 'breakdown');
});

test('keeps sideways when whipsaw AI signals occur inside the consolidation range', () => {
  const result = calculateTrendStatus({
    aiSignal: 'neutral',
    prices: prices([...consolidation, 168, 169]),
    tradingSignals: whipsawSignals(),
  });

  assert.equal(result.level, 'sideways');
});

test('returns the same result when prices arrive in reverse chronological order', () => {
  const chronological = prices([...consolidation, 163, 162]);
  const forward = calculateTrendStatus({ aiSignal: 'buy', prices: chronological });
  const reversed = calculateTrendStatus({ aiSignal: 'buy', prices: [...chronological].reverse() });

  assert.deepEqual(reversed, forward);
});

test('classifies the observed 3715 July breakdown as confirmed', () => {
  const observedCloses = [
    162.5, 166, 166.5, 169, 171, 176, 179, 194.5, 180, 179.5,
    177, 168.5, 166, 176, 172, 175.5, 172, 165, 155.5, 151.5, 151,
  ];
  const result = calculateTrendStatus({
    aiSignal: 'buy',
    prices: prices(observedCloses),
    tradingSignals: whipsawSignals(),
  });

  assert.equal(result.level, 'breakdown');
  assert.equal(result.label, '跌破盤整');
});
