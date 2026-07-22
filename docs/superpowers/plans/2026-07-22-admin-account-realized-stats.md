# Admin Account Realized Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show all-time realized profit, realized return, win/loss counts, win rate, stock count, and stock-trade count on every Admin account card while keeping Trade History calculations consistent.

**Architecture:** Add a framework-independent statistics utility and test it directly with Node's test runner. Trade History will call the same utility for its selected visible trades, while Admin Dashboard will background-load minimal trade columns once, group them by user, and render cached per-user results with explicit loading and error states.

**Tech Stack:** React 19, TypeScript 6, Zustand data types, Supabase JS, Node test runner, Vite 8, vanilla CSS.

## Global Constraints

- Admin statistics use the all-time range, matching Trade History's `全部` range.
- Realized return is `realizedProfit / realizedCostBasis * 100`, where each valid sell cost basis is `totalAmount - profit`.
- Win rate is `winCount / (winCount + lossCount) * 100`; break-even sells are excluded from that denominator.
- Buy and sell rows count toward stock/trade totals; deposit and withdrawal rows do not.
- Missing denominators render as `--`, query failures never render as zero, and account-list loading stays non-blocking.
- Positive values use the Taiwan-market profit color, negative values use the loss color, and zero is neutral.
- No new dependency or database migration is allowed.
- Release version is `1.24.109` and release closeout includes changelog, build, production deploy, live verification, commit, and Git push.

---

### Task 1: Shared realized-trade statistics utility

**Files:**
- Create: `src/utils/tradeRealizedStats.ts`
- Create: `src/utils/tradeRealizedStats.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: rows with `tradeType`, `stockCode`, `totalAmount`, and optional `profit`.
- Produces: `calculateRealizedTradeStats(trades: RealizedTradeInput[]): RealizedTradeStats`.

- [ ] **Step 1: Write the failing utility tests**

Create tests that import `calculateRealizedTradeStats` and assert exact values for mixed wins/losses, break-even sells, duplicate stock codes, cash rows, empty input, and invalid numeric values. The primary fixture must expect `realizedProfit = 50`, `realizedCostBasis = 450`, `realizedReturnPct = 50 / 450 * 100`, `winCount = 1`, `lossCount = 1`, `winRatePct = 50`, `stockCount = 2`, and `tradeCount = 4`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test --test-isolation=none --experimental-strip-types src/utils/tradeRealizedStats.test.ts
```

Expected: FAIL because `src/utils/tradeRealizedStats.ts` or its export does not exist.

- [ ] **Step 3: Implement the pure calculator**

Create these public types and function:

```ts
export type RealizedTradeInput = {
  tradeType: string;
  stockCode: string;
  totalAmount: unknown;
  profit?: unknown;
};

export type RealizedTradeStats = {
  realizedProfit: number;
  realizedCostBasis: number;
  realizedReturnPct: number | null;
  winCount: number;
  lossCount: number;
  winRatePct: number | null;
  stockCount: number;
  tradeCount: number;
};

export function calculateRealizedTradeStats(trades: RealizedTradeInput[]): RealizedTradeStats;
```

Use `Number.isFinite` after numeric conversion. Count only buy/sell rows in `tradeCount` and `stockCount`; sum a sell's cost basis only when both amount and profit are finite and the derived cost is positive. A finite profit still contributes to realized profit and win/loss even if its amount is invalid.

- [ ] **Step 4: Run the utility tests and verify GREEN**

Run the same Node test command. Expected: all tests pass with zero failures.

- [ ] **Step 5: Add the reusable test script**

Add to `package.json`:

```json
"test:trade-stats": "node --test --test-isolation=none --experimental-strip-types src/utils/tradeRealizedStats.test.ts"
```

- [ ] **Step 6: Commit Task 1**

```powershell
git add package.json src/utils/tradeRealizedStats.ts src/utils/tradeRealizedStats.test.ts
git commit -m "test: add realized trade statistics"
```

### Task 2: Reuse the calculator in Trade History

**Files:**
- Modify: `src/pages/TradeHistory.tsx`

**Interfaces:**
- Consumes: `calculateRealizedTradeStats` from Task 1 and the page's already filtered visible trades.
- Produces: unchanged Trade History copy and layout backed by shared statistics.

- [ ] **Step 1: Replace the page-local realized loop**

Import `calculateRealizedTradeStats`. In the existing `stats` memo, filter `rangeFilteredTrades` to `visibleTradeIds`, then pass the result to the shared utility. Keep the page's current range and search behavior.

- [ ] **Step 2: Update JSX field names**

Render `stats.realizedProfit`, `stats.winCount`, `stats.lossCount`, `stats.stockCount`, and `stats.tradeCount`. Preserve the existing `區間已實現損益`, `勝`, `敗`, and `檔・筆` labels and colors.

- [ ] **Step 3: Verify Trade History compilation and utility tests**

Run:

```powershell
npm run test:trade-stats
npm run build
```

Expected: test pass and build exit code 0.

- [ ] **Step 4: Commit Task 2**

```powershell
git add src/pages/TradeHistory.tsx
git commit -m "refactor: share realized trade totals"
```

### Task 3: Load and display per-account Admin statistics

**Files:**
- Modify: `src/pages/AdminDashboard.tsx`
- Modify: `src/pages/AdminDashboard.css`

**Interfaces:**
- Consumes: minimal Supabase trade rows and `calculateRealizedTradeStats`.
- Produces: a per-user `Record<string, RealizedTradeStats>` and two visible Admin statistics rows per account.

- [ ] **Step 1: Add Admin trade row state**

Define an `AdminTradeStatRow` with `userId` plus the shared calculator fields. Add state for rows and status:

```ts
const [allTradeStatsRows, setAllTradeStatsRows] = useState<AdminTradeStatRow[]>([]);
const [tradeStatsStatus, setTradeStatsStatus] = useState<'loading' | 'success' | 'error'>('loading');
```

- [ ] **Step 2: Background-load minimal trade columns independently**

Inside the admin data effect, start a separate Supabase request so holdings/quote failure cannot hide realized statistics and trade failure cannot hide holdings:

```ts
supabase
  .from('trades')
  .select('user_id, stock_code, trade_type, total_amount, profit')
```

Map snake_case fields to the calculator input, set status to `success`, and on error log the failure, clear rows, and set status to `error`.

- [ ] **Step 3: Memoize per-user statistics**

Group rows by `userId` in one `useMemo`, call `calculateRealizedTradeStats` once per group, and use `calculateRealizedTradeStats([])` as the successful empty-account fallback.

- [ ] **Step 4: Render loading, error, and success states**

Under the existing balance/unrealized line, show:

```text
📈 已實現：+NT$ 17,273（+11.2%）
🏆 勝 11・敗 50・勝率 18.0%・44 檔／184 筆
```

Use one-decimal percentage formatting with a leading plus sign for positive realized return. For `null`, render `--`. During loading render `📈 已實現統計讀取中...`; on error render `⚠️ 已實現統計暫時無法讀取`.

- [ ] **Step 5: Add responsive CSS**

Add focused classes for the realized amount and detail line. Allow wrapping with `display: flex`, `flex-wrap: wrap`, and a small row/column gap. Keep metric text at 12–13px and do not change account-card actions or badges.

- [ ] **Step 6: Run targeted and static verification**

Run:

```powershell
npm run test:trade-stats
npm run lint
npm run build
```

Expected: zero test failures, zero ESLint errors, and build exit code 0.

- [ ] **Step 7: Commit Task 3**

```powershell
git add src/pages/AdminDashboard.tsx src/pages/AdminDashboard.css
git commit -m "feat: show admin realized account stats"
```

### Task 4: Version, full verification, deployment, and Git closeout

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: verified Tasks 1–3.
- Produces: production version `1.24.109` with live and Git evidence.

- [ ] **Step 1: Bump version and changelog**

Run `npm version 1.24.109 --no-git-tag-version`, then add a `v1.24.109` entry dated `2026-07-22`. State that Admin account cards now show all-time realized P/L, realized return, wins/losses, win rate, stock count, and trade count, using shared Trade History calculations.

- [ ] **Step 2: Run the full fresh verification gate**

Run:

```powershell
npm run test:trend
npm run test:watchlist-priority
npm run test:trade-stats
npm run lint
npm run build
git diff --check
```

Expected: all tests pass, lint/build exit 0, and `git diff --check` has no output.

- [ ] **Step 3: Review generated assets and source diff**

Run `git status --short`, `git diff --stat`, and inspect the relevant source diff. Confirm only planned files changed and no secrets or generated `dist` files are tracked.

- [ ] **Step 4: Commit the release metadata**

```powershell
git add package.json package-lock.json CHANGELOG.md
git commit -m "release: v1.24.109"
```

- [ ] **Step 5: Deploy production**

Run:

```powershell
npx vercel --prod --yes
```

Expected: successful production deployment and alias to `https://ppbears-investment.vercel.app`.

- [ ] **Step 6: Verify live production**

Fetch `/` and `/admin`; confirm HTTP 200, confirm the current HTML references the newly built JS/CSS asset names, and confirm the production JS bundle contains the new Admin copy `已實現統計讀取中` and `勝率`.

- [ ] **Step 7: Push Git and verify synchronization**

Push the current named feature branch to `origin`, then verify `git status --short --branch` is clean and the upstream branch points to the release commit. Do not force-push.
