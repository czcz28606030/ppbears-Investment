import test from 'node:test';
import assert from 'node:assert/strict';
import type { StockPrice } from '../types.ts';
import type { StockTradingSignal } from '../types.ts';
import {
  getStockChartDataNote,
  getOfficialHistoryMonths,
  isIsoCalendarDate,
  limitSignalsToIfalgoDates,
  mergeStockChartPrices,
  normalizeTpexHistory,
  normalizeTwseHistory,
} from './officialStockHistory.ts';

const ifalgoPrices: StockPrice[] = [
  {
    coid: '4967',
    mdate: '2026-09-11',
    open_d: '278.00',
    high_d: '283.00',
    low_d: '276.00',
    close_d: '280.50',
    volume: 3105,
    pe_ratio: '4.20',
    pb_ratio: '2.14',
    roia: null,
  },
];

test('TWSE history normalization converts ROC dates and shares to lots', () => {
  const prices = normalizeTwseHistory('4967', {
    stat: 'OK',
    data: [
      ['115/09/14', '2,000,000', '0', '280.00', '285.00', '278.00', '284.00', '+3.50', '8,100', ''],
      ['115/09/15', '1,500,000', '0', '--', '--', '--', '--', '0.00', '0', ''],
    ],
  });

  assert.deepEqual(prices, [{
    coid: '4967',
    mdate: '2026-09-14',
    open_d: '280.00',
    high_d: '285.00',
    low_d: '278.00',
    close_d: '284.00',
    volume: 2000,
    pe_ratio: '',
    pb_ratio: '',
    roia: null,
  }]);
});

test('TPEx history normalization keeps exchange-provided lot volume', () => {
  const prices = normalizeTpexHistory('8069', {
    stat: 'ok',
    tables: [{
      data: [
        ['115/09/16', '3,921', '579,467', '147.00', '149.00', '146.50', '148.00', '2.00', '3,083'],
      ],
    }],
  });

  assert.equal(prices.length, 1);
  assert.equal(prices[0].mdate, '2026-09-16');
  assert.equal(prices[0].volume, 3921);
  assert.equal(prices[0].close_d, '148.00');
});

test('chart merge supplements only dates after the last IFAlgo candle', () => {
  const officialPrices: StockPrice[] = [
    { ...ifalgoPrices[0], close_d: '999.00' },
    { ...ifalgoPrices[0], mdate: '2026-09-14', close_d: '284.00' },
    { ...ifalgoPrices[0], mdate: '2026-09-16', close_d: '275.00' },
  ];

  const result = mergeStockChartPrices(ifalgoPrices, officialPrices);

  assert.deepEqual(result.prices.map(price => [price.mdate, price.close_d]), [
    ['2026-09-11', '280.50'],
    ['2026-09-14', '284.00'],
    ['2026-09-16', '275.00'],
  ]);
  assert.equal(result.ifalgoLatestDate, '2026-09-11');
  assert.equal(result.chartLatestDate, '2026-09-16');
  assert.equal(result.supplemented, true);
});

test('history month selection crosses month boundaries without unbounded requests', () => {
  assert.deepEqual(
    getOfficialHistoryMonths('2026-08-29', '2026-09-17'),
    ['20260801', '20260901'],
  );
  assert.deepEqual(
    getOfficialHistoryMonths('2025-01-01', '2026-09-17'),
    ['20260701', '20260801', '20260901'],
  );
});

test('official-only chart is identified when IFAlgo has no candles', () => {
  const officialPrices: StockPrice[] = [
    { ...ifalgoPrices[0], mdate: '2026-09-16', close_d: '275.00' },
  ];

  const result = mergeStockChartPrices([], officialPrices);

  assert.equal(result.officialOnly, true);
  assert.equal(result.supplemented, false);
  assert.equal(result.chartLatestDate, '2026-09-16');
});

test('AI signal dates are removed when no matching IFAlgo candle exists', () => {
  const signals: StockTradingSignal[] = [{
    id: 'signal-1',
    coid: '4967',
    stockName: '十銓',
    inDate: '2026-09-14',
    buyClose: 273.5,
    outDate: '2026-09-11',
    sellClose: 280.5,
    signal: '賣出',
    returnPct: '0%',
    createdAt: '',
    updatedAt: '',
  }];

  const result = limitSignalsToIfalgoDates(signals, ifalgoPrices);

  assert.equal(result[0].inDate, '');
  assert.equal(result[0].outDate, '2026-09-11');
});

test('calendar date validation rejects impossible ISO dates', () => {
  assert.equal(isIsoCalendarDate('2026-02-28'), true);
  assert.equal(isIsoCalendarDate('2026-02-31'), false);
  assert.equal(isIsoCalendarDate('2026-13-01'), false);
});

test('chart note warns when official history only partly catches up with the quote', () => {
  const partial = mergeStockChartPrices(ifalgoPrices, [
    { ...ifalgoPrices[0], mdate: '2026-09-14' },
  ]);
  const note = getStockChartDataNote(partial, '2026-09-16', false);
  assert.equal(note.tone, 'warning');
  assert.match(note.text, /2026-09-14/);
  assert.match(note.text, /2026-09-16/);
});

test('chart note marks complete official supplementation without a gap warning', () => {
  const complete = mergeStockChartPrices(ifalgoPrices, [
    { ...ifalgoPrices[0], mdate: '2026-09-16' },
  ]);
  const note = getStockChartDataNote(complete, '2026-09-16', false);
  assert.equal(note.tone, 'info');
  assert.match(note.text, /2026-09-16/);
});

test('chart note reports an empty official response as unavailable after loading', () => {
  const unchanged = mergeStockChartPrices(ifalgoPrices, []);
  const note = getStockChartDataNote(unchanged, '2026-09-16', true);
  assert.equal(note.tone, 'warning');
  assert.match(note.text, /無法補入/);
});
