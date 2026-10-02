import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyResourceCache } from './dailyResourceCache.ts';
test('returning to another route reuses same-day results and overlapping requests', async () => {
  const cache = createDailyResourceCache<number>('test'); let calls = 0;
  const fetcher = async (codes: string[]) => { calls++; return Object.fromEntries(codes.map(c => [c, 1])); };
  await Promise.all([cache.load('user', ['1', '2'], fetcher), cache.load('user', ['2'], fetcher)]);
  await cache.load('user', ['1'], fetcher); assert.equal(calls, 1);
  await cache.load('user', ['1', '3'], fetcher); assert.equal(calls, 2);
});
test('new day and changed account state require fresh results; token refresh does not enter the cache key', async () => {
  let now = Date.parse('2026-10-02T15:59:00Z'); let calls = 0;
  const cache = createDailyResourceCache<number>('test', { now: () => now });
  const fetcher = async () => ({ '1': ++calls });
  await cache.load('owner:100shares', ['1'], fetcher); now += 120000;
  await cache.load('owner:100shares', ['1'], fetcher); assert.equal(calls, 2);
  await cache.load('owner:200shares', ['1'], fetcher); assert.equal(calls, 3);
  await cache.load('other-user:100shares', ['1'], fetcher); assert.equal(calls, 4);
});
test('reload hydrates daily storage immediately and manual refresh explicitly replaces it', async () => {
  const values = new Map<string, string>(); const store = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const options = { storage: () => store }; let calls = 0;
  const fetcher = async () => ({ '1': ++calls });
  await createDailyResourceCache<number>('test', options).load('user', ['1'], fetcher);
  const reloaded = createDailyResourceCache<number>('test', options);
  assert.deepEqual(reloaded.peek('user', ['1']), { '1': 1 });
  await reloaded.load('user', ['1'], fetcher); assert.equal(calls, 1);
  assert.deepEqual(await reloaded.load('user', ['1'], fetcher, true), { '1': 2 });
});
test('failed loads retry and late prior-day responses cannot populate the new day', async () => {
  let now = Date.parse('2026-10-02T15:59:00Z'); const cache = createDailyResourceCache<number>('test', { now: () => now });
  await assert.rejects(cache.load('user', ['1'], async () => { throw Error('offline'); }));
  const result = await cache.load('user', ['1'], async () => { now += 120000; return { '1': 4 }; });
  assert.equal(result['1'], 4); assert.deepEqual(cache.peek('user', ['1']), {});
  assert.deepEqual(await cache.load('user', ['1'], async () => ({ '1': 5 })), { '1': 5 });
});
