# Watchlist Priority Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Watchlist AI synchronization fetch the user's most-viewed cached classifications first while continuing to load every remaining stock in the background.

**Architecture:** Extract a small, pure, stable-priority sorter from `Watchlist.tsx`, cover it with Node's built-in test runner, then feed the existing four-worker queue with its output. The sorter reads only the previous `StockQuantData` snapshot; API behavior, concurrency, timeouts, cache rules, filters, and rendering remain unchanged.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Node built-in test runner, existing `StockQuantData` and `WatchlistItem` types.

## Global Constraints

- Priority is exactly: AI進場＋超高度, AI進場＋高度, 出場後再進場, then every other or unknown classification.
- Stocks in the same priority group retain their original Watchlist order.
- A stock appears once and uses its highest matching priority.
- With no previous classification data, loading order remains unchanged.
- Existing maximum concurrency stays at four and the existing per-stock timeout stays at 12 seconds.
- Each completed stock updates the UI immediately; all lower-priority stocks still finish in the background.
- Filter selection, API contracts, Supabase schema, cache TTLs, daily schedule, and default filter buttons do not change.

---

## File Structure

- Create `src/utils/watchlistLoadPriority.ts`: pure classification and stable sorting, with no React or browser dependency.
- Create `src/utils/watchlistLoadPriority.test.ts`: behavioral tests for every priority and fallback rule.
- Modify `src/pages/Watchlist.tsx`: import the sorter, snapshot previous quant data, and create the worker queue from the sorted list.
- Modify `package.json`: add the focused Node test command.
- Modify `CHANGELOG.md`: record the user-visible loading-order improvement after verification.

### Task 1: Pure Watchlist priority sorter

**Files:**
- Create: `src/utils/watchlistLoadPriority.test.ts`
- Create: `src/utils/watchlistLoadPriority.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `StockQuantData` from `src/api.ts` and list items structurally containing `stockCode: string`.
- Produces: `prioritizeWatchlistForQuantLoad<T extends { stockCode: string }>(items: readonly T[], quantDataMap: Readonly<Record<string, StockQuantData | undefined>>): T[]`.

- [ ] **Step 1: Add the focused test command**

Add this script beside `test:trend` in `package.json`:

```json
"test:watchlist-priority": "node --test --test-isolation=none --experimental-strip-types src/utils/watchlistLoadPriority.test.ts"
```

- [ ] **Step 2: Write the failing tests**

Create `src/utils/watchlistLoadPriority.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test and verify RED**

Run: `npm run test:watchlist-priority`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `watchlistLoadPriority.ts`.

- [ ] **Step 4: Implement the minimal stable sorter**

Create `src/utils/watchlistLoadPriority.ts`:

```ts
import type { StockQuantData } from '../api.ts';

function getWatchlistLoadPriority(data?: StockQuantData): number {
  if (!data) return 3;
  const remark = data.aiQuanBackDataComment?.remark || '';
  if (data.currentSignal === 'buy' && remark.includes('超高')) return 0;
  if (data.currentSignal === 'buy' && remark.includes('高度')) return 1;
  if (data.reentryAfterExit?.hasReentry) return 2;
  return 3;
}

export function prioritizeWatchlistForQuantLoad<T extends { stockCode: string }>(
  items: readonly T[],
  quantDataMap: Readonly<Record<string, StockQuantData | undefined>>,
): T[] {
  return items
    .map((item, originalIndex) => ({
      item,
      originalIndex,
      priority: getWatchlistLoadPriority(quantDataMap[item.stockCode]),
    }))
    .sort((left, right) => left.priority - right.priority || left.originalIndex - right.originalIndex)
    .map(entry => entry.item);
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npm run test:watchlist-priority`

Expected: four tests pass, zero failures.

- [ ] **Step 6: Run the existing utility regression test**

Run: `npm run test:trend`

Expected: all existing trend tests pass, zero failures.

- [ ] **Step 7: Commit the pure sorter**

```powershell
git add -- package.json src/utils/watchlistLoadPriority.ts src/utils/watchlistLoadPriority.test.ts
git commit -m "test: define watchlist loading priority"
```

### Task 2: Feed the existing worker pool from the priority queue

**Files:**
- Modify: `src/pages/Watchlist.tsx` near the imports and the AI synchronization worker queue around the current `const queue = [...watchlist]`.
- Test: `src/utils/watchlistLoadPriority.test.ts`

**Interfaces:**
- Consumes: `prioritizeWatchlistForQuantLoad` from Task 1 and the `quantDataMap` value captured by the current Watchlist effect.
- Produces: the same existing four-worker synchronization behavior with a prioritized queue; no new external interface.

- [ ] **Step 1: Add an integration-contract assertion before changing the page**

Append to `src/utils/watchlistLoadPriority.test.ts`:

```ts
test('does not mutate the Watchlist array used by React state', () => {
  const items: Item[] = [{ stockCode: '5001' }, { stockCode: '5002' }];
  const originalOrder = items.map(item => item.stockCode);

  prioritizeWatchlistForQuantLoad(items, {
    '5002': quant({ signal: 'buy', remark: '超高度' }),
  });

  assert.deepEqual(items.map(item => item.stockCode), originalOrder);
});
```

- [ ] **Step 2: Temporarily prove the assertion detects mutation**

Temporarily change the Task 1 implementation to call `.sort(...)` directly on `items` through a copied test-only experiment, run `npm run test:watchlist-priority`, and verify the new test FAILS because the source order changes. Revert that temporary experiment immediately; no temporary code is retained.

- [ ] **Step 3: Verify the restored sorter passes**

Run: `npm run test:watchlist-priority`

Expected: five tests pass, zero failures.

- [ ] **Step 4: Import the sorter into Watchlist**

Add beside the other utility imports in `src/pages/Watchlist.tsx`:

```ts
import { prioritizeWatchlistForQuantLoad } from '../utils/watchlistLoadPriority';
```

- [ ] **Step 5: Build the queue from the pre-clear quant snapshot**

Immediately before the existing calls that clear AI synchronization state, capture and prioritize the queue:

```ts
const priorityQuantDataMap = quantDataMap;
const queue = prioritizeWatchlistForQuantLoad(watchlist, priorityQuantDataMap);

setLoadingStep(`正在同步最新 AI 訊號 0/${watchlist.length}...`);
setDataLoading(true);
setQuantDataMap({});
setSimonsRecMap({});
setQuantFailedCodes(new Set());
setQuantSyncingCodes(new Set(watchlistCodes));
```

Then remove the later original declaration:

```ts
const queue = [...watchlist];
```

Keep `workerCount`, `runWorker`, `queue.shift()`, timeout handling, immediate per-stock state updates, completion count, and the final cache write unchanged.

- [ ] **Step 6: Run targeted tests**

Run: `npm run test:watchlist-priority`

Expected: five tests pass, zero failures.

Run: `npm run test:trend`

Expected: all existing trend tests pass, zero failures.

- [ ] **Step 7: Run the production build**

Run: `npm run build`

Expected: TypeScript build and Vite production build exit with code 0.

- [ ] **Step 8: Inspect the focused diff**

Run: `git diff -- src/pages/Watchlist.tsx src/utils/watchlistLoadPriority.ts src/utils/watchlistLoadPriority.test.ts package.json`

Expected: only the new import, pre-clear priority queue, pure sorter, tests, and test script are present; concurrency and fetch error behavior are unchanged.

- [ ] **Step 9: Commit the page integration**

```powershell
git add -- src/pages/Watchlist.tsx
git commit -m "perf: prioritize watchlist AI loading"
```

### Task 3: Release note and final verification

**Files:**
- Modify: `CHANGELOG.md`
- Verify: all files changed in Tasks 1 and 2.

**Interfaces:**
- Consumes: the tested sorter and Watchlist integration from Tasks 1 and 2.
- Produces: documented, build-verified local change ready for the project's release workflow.

- [ ] **Step 1: Add the changelog entry**

Under the current unreleased/latest version heading in `CHANGELOG.md`, add:

```md
- 觀察頁 AI 資料改依常用分類優先載入：先同步「AI進場＋超高度」、「AI進場＋高度」與「出場後再進場」，其餘分類在背景補齊，縮短主要觀察流程的等待時間。
```

- [ ] **Step 2: Run fresh complete verification**

Run: `npm run test:watchlist-priority`

Expected: five tests pass, zero failures.

Run: `npm run test:trend`

Expected: all existing trend tests pass, zero failures.

Run: `npm run build`

Expected: TypeScript and Vite finish with exit code 0 and no build errors.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 3: Verify every requirement against the diff**

Run: `git diff --stat` and `git diff -- src/pages/Watchlist.tsx src/utils/watchlistLoadPriority.ts src/utils/watchlistLoadPriority.test.ts package.json CHANGELOG.md`.

Confirm all of the following from the output:

```text
[ ] Ultra-high AI entry has priority 0.
[ ] High AI entry has priority 1.
[ ] Reentry after exit has priority 2.
[ ] Every other or missing classification has priority 3.
[ ] Original index is the stable tie-breaker.
[ ] The existing four-worker count and 12-second timeout are unchanged.
[ ] The queue still runs until empty.
[ ] No API, schema, filter-default, cache TTL, or schedule code changed.
```

- [ ] **Step 4: Commit verification documentation**

```powershell
git add -- CHANGELOG.md
git commit -m "docs: note prioritized watchlist loading"
```

- [ ] **Step 5: Check final repository state**

Run: `git status --short` and `git log -4 --oneline`.

Expected: no unintended uncommitted files; the design/plan documentation and implementation commits are visible. If the environment blocks commits on `main`, leave the verified files unstaged and report that exact limitation without using a workaround.
