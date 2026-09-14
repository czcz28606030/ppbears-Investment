import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchMarketResponse } from './marketRequest.ts';

test('retries cached HTTP 200 errors with a new URL and returns real data', async () => {
  const urls: string[] = [];
  const response = await fetchMarketResponse('/api/ifalgo/stock?coid=2356', {}, {
    delayMs: 0,
    fetcher: async (url, init) => {
      urls.push(String(url));
      assert.equal(init?.cache, 'no-store');
      return Response.json(urls.length < 3 ? { error: 'This operation was aborted' } : { prices: [1] });
    },
  });
  assert.deepEqual(await response.json(), { prices: [1] });
  assert.equal(new Set(urls).size, 3);
});

test('does not retry authentication failures', async () => {
  let calls = 0;
  const response = await fetchMarketResponse('/api/app-cache?type=stock-quant', {}, {
    delayMs: 0, fetcher: async () => { calls++; return Response.json({ error: 'Forbidden' }, { status: 403 }); },
  });
  assert.equal(response.status, 403);
  assert.equal(calls, 1);
});

test('rejects failures after bounded retries instead of caching empty success', async () => {
  let calls = 0;
  await assert.rejects(fetchMarketResponse('/api/test', {}, {
    delayMs: 0, fetcher: async () => { calls++; return Response.json({ error: 'timeout', data: {} }); },
  }));
  assert.equal(calls, 3);
});

test('retries missing chart data using payload validation', async () => {
  let calls = 0;
  const res = await fetchMarketResponse('/api/test', {}, {
    delayMs: 0,
    validate: json => Array.isArray(json.prices) && json.prices.length > 0,
    fetcher: async () => Response.json(++calls === 1 ? {} : { prices: [1] }),
  });
  assert.equal(calls, 2);
  assert.deepEqual(await res.json(), { prices: [1] });
});

test('times out a stalled response and retries automatically', async () => {
  let calls = 0;
  const res = await fetchMarketResponse('/api/test', {}, {
    delayMs: 0, timeoutMs: 10,
    fetcher: async (_url, init) => {
      if (++calls > 1) return Response.json({ ok: true });
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(await res.json(), { ok: true });
});

test('large stock batches stay within six concurrent requests and release the queue', async () => {
  let active = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: 20 }, (_, i) => fetchMarketResponse(`/api/test?coid=${i}`, {}, {
    fetcher: async () => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      return Response.json({ ok: true });
    },
  })));
  assert.equal(peak, 6);
  assert.equal(active, 0);
});
