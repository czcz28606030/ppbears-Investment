import assert from 'node:assert/strict';
import test from 'node:test';
import type { StockQuantData } from '../api.ts';
import { prioritizeWatchlistForQuantLoad } from './watchlistLoadPriority.ts';

type Item = { stockCode: string };

function quant({
  signal = 'neutral',
  remark = '',
  reentry = false,
}: {
  signal?: StockQuantData['currentSignal'];
  remark?: string;
  reentry?: boolean;
} = {}): StockQuantData {
  return {
    aiQuanBackDataComment: remark ? { remark, cum_ret: '0%', freq: 0 } : null,
    chipStability: null,
    stockInfo: null,
    currentSignal: signal,
    signalStreak: { signal: null, count: 0 },
    reentryAfterExit: reentry ? { hasReentry: true, exitDate: '2026-07-01', entryDate: '2026-07-02' } : null,
  };
}

test('orders cached classifications by the requested viewing priority', () => {
  const items: Item[] = [
    { stockCode: '1000' },
    { stockCode: '1001' },
    { stockCode: '1002' },
    { stockCode: '1003' },
    { stockCode: '1004' },
  ];
  const result = prioritizeWatchlistForQuantLoad(items, {
    '1000': quant({ signal: 'neutral', remark: '中度' }),
    '1001': quant({ reentry: true }),
    '1002': quant({ signal: 'buy', remark: '高度' }),
    '1003': quant({ signal: 'buy', remark: '超高度' }),
    '1004': quant({ signal: 'sell', remark: '低度' }),
  });

  assert.deepEqual(result.map(item => item.stockCode), ['1003', '1002', '1001', '1000', '1004']);
});

test('keeps the original order within the same priority group', () => {
  const items: Item[] = [{ stockCode: '2002' }, { stockCode: '2001' }, { stockCode: '2003' }];
  const result = prioritizeWatchlistForQuantLoad(items, {
    '2002': quant({ signal: 'buy', remark: '高度' }),
    '2001': quant({ signal: 'buy', remark: '高度推薦' }),
  });

  assert.deepEqual(result.map(item => item.stockCode), ['2002', '2001', '2003']);
});

test('keeps the original order when previous classifications are unavailable', () => {
  const items: Item[] = [{ stockCode: '3002' }, { stockCode: '3001' }, { stockCode: '3003' }];

  assert.deepEqual(
    prioritizeWatchlistForQuantLoad(items, {}).map(item => item.stockCode),
    ['3002', '3001', '3003'],
  );
});

test('uses the highest matching priority without duplicating a stock', () => {
  const items: Item[] = [{ stockCode: '4001' }, { stockCode: '4002' }];
  const result = prioritizeWatchlistForQuantLoad(items, {
    '4001': quant({ signal: 'buy', remark: '超高度', reentry: true }),
    '4002': quant({ signal: 'buy', remark: '高度' }),
  });

  assert.deepEqual(result.map(item => item.stockCode), ['4001', '4002']);
  assert.equal(result.length, items.length);
});

test('does not mutate the Watchlist array used by React state', () => {
  const items: Item[] = [{ stockCode: '5001' }, { stockCode: '5002' }];
  const originalOrder = items.map(item => item.stockCode);

  prioritizeWatchlistForQuantLoad(items, {
    '5002': quant({ signal: 'buy', remark: '超高度' }),
  });

  assert.deepEqual(items.map(item => item.stockCode), originalOrder);
});
