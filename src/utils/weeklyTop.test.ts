import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWeeklyTop } from './weeklyTop.ts';

const row = { ticker: '2308', name: '台達電', change_type: 'ADDED', latest_week_end_date: '2026-09-24', previous_week_end_date: '2026-09-18', latest_rank: 1, previous_rank: null, rank_change: null, latest_cumulative_ait_value: 977291.65, previous_cumulative_ait_value: null, refreshed_at: '2026-09-28T22:51:43+00:00' };
test('keeps weekly ranking and separates publication time from week date', () => {
  const result = normalizeWeeklyTop({ data: [{ ...row, ticker: '2303', latest_rank: 2 }, row, { ...row, ticker: '1111', latest_rank: null, change_type: 'REMOVED' }], data_updated_at: '2026-10-01T22:09:08+00:00' });
  assert.deepEqual(result.items.map(r => r.ticker), ['2308', '2303']);
  assert.equal(result.weekEndDate, '2026-09-24');
  assert.equal(result.updatedAt, '2026-10-01T22:09:08+00:00');
  assert.equal(result.items[0].previousRank, null);
  assert.equal(result.items[0].aitValue, 977291.65);
});
test('rejects malformed payloads instead of falling back to old signals', () => {
  assert.throws(() => normalizeWeeklyTop({ error: 'Unauthorized' }));
  assert.throws(() => normalizeWeeklyTop({ data: [{ ...row, latest_cumulative_ait_value: 'bad' }] }));
  assert.deepEqual(normalizeWeeklyTop({ data: [] }).items, []);
});
