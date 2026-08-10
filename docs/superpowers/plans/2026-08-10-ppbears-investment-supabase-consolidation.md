# PPBears Investment Supabase Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This session executes inline because parallel subagents were not requested.

**Goal:** Move `ppbears-investment` from Supabase project `bkbxzdbthxwccdfcwsub` into the existing `ppbears desing Project` (`ilboytxdlydyrrdnwlon`) without overwriting the design platform, then cut the Vercel app over with a tested rollback path.

**Architecture:** Keep all Investment tables and functions in the target project's `public` schema because the live table/function names do not conflict with the design platform. Merge Auth users while mapping the one duplicate email from source user id `5b5aaa97-ac1a-4597-a7d2-b1d0672a32a4` to target user id `f591c5a8-2645-4b6f-afb9-c2ffb1f556dc`. Copy the `trade-attachments` bucket through the Storage API, deploy `get-kid-description`, then atomically switch Vercel environment variables and deploy.

**Tech Stack:** Supabase CLI 2.113, PostgreSQL 17, `pg`, `@supabase/supabase-js`, Node.js test runner, Vite, Vercel CLI.

## Global Constraints

- Do not drop, rename, truncate, or overwrite any pre-existing target table, function, Auth user, bucket, or Storage object.
- Keep source project `bkbxzdbthxwccdfcwsub` active until the production deployment and a real user login are confirmed.
- Never print, commit, or persist database passwords, service-role keys, anon keys, OpenAI keys, or Vercel secrets.
- Preserve the 20 source Auth accounts and password hashes; the duplicate email must use the existing target Auth identity.
- Preserve the baseline 27 public tables and their data, 8 public functions, 66 Storage objects, and 3,659,758 Storage bytes.
- Treat target project `ilboytxdlydyrrdnwlon` as shared production infrastructure; target baseline is 38 public tables, 15 public functions, 1 Auth user, 8 buckets, 15,937 Storage objects, and 31,082,120,450 Storage bytes.
- Existing browser sessions will be invalid after project-ref cutover; users must sign in again.

---

### Task 1: Add tested migration primitives

**Files:**
- Create: `scripts/supabase-investment-migration/core.mjs`
- Create: `scripts/supabase-investment-migration/core.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `remapValue(value, idMap)`, `chunkRows(rows, size)`, `getCommonColumns(sourceColumns, targetColumns, excluded)`, and `assertSummary(actual, expected)`.
- Consumes: Node.js values returned by `pg` and Supabase REST APIs.

- [x] **Step 1: Write failing tests for recursive UUID remapping, deterministic batching, safe column intersection, and count mismatch failures.**
- [x] **Step 2: Run `node --test scripts/supabase-investment-migration/core.test.mjs` and confirm it fails because `core.mjs` is absent.**
- [x] **Step 3: Implement only the four exported helpers in `core.mjs`.**
- [x] **Step 4: Run the focused test and confirm all cases pass.**
- [x] **Step 5: Add `pg` as a development dependency and add `test:supabase-migration` to `package.json`.**

### Task 2: Build a dry-run inventory and credential-safe launcher

**Files:**
- Create: `scripts/supabase-investment-migration/run.ps1`
- Create: `scripts/supabase-investment-migration/run.mjs`

**Interfaces:**
- `run.ps1 -Mode inventory|apply|verify` obtains temporary database credentials and API keys in process memory and launches Node without echoing them.
- `run.mjs` consumes `MIGRATION_SOURCE_*` and `MIGRATION_TARGET_*` process variables and emits only resource names, counts, sizes, and validation errors.

- [x] **Step 1: Add a failing dry-run test fixture proving secrets are redacted and destructive mode requires `-Mode apply`.**
- [x] **Step 2: Run the test and confirm failure because the launcher/runner does not exist.**
- [x] **Step 3: Implement credential parsing, source/target connection setup, and read-only inventory.**
- [x] **Step 4: Run `run.ps1 -Mode inventory` and compare live source/target counts against Global Constraints.**
- [x] **Step 5: Confirm `git diff` and command output contain no secret values.**

### Task 3: Create Investment schema in the shared target

**Files:**
- Read: `supabase-schema.sql`
- Read: `supabase-trade-rpc.sql`
- Read: `supabase-watchlist.sql`
- Read: `supabase-learning-schema.sql`
- Read: `supabase-rewards-schema.sql`
- Read: `supabase-dividend-schema.sql`
- Read: `supabase-backtest-schema.sql`
- Read: `supabase-active-etf-schema.sql`
- Read: `supabase/migrations/20260630050000_user_market_daily_cache.sql`
- Read: `supabase/migrations/20260711010000_trade_attachments.sql`
- Read: `supabase/migrations/20260711020000_trade_attachment_retention.sql`

**Interfaces:**
- Consumes: schema files in the exact order listed above.
- Produces: 27 empty Investment tables, 8 public functions, Investment RLS policies, and private bucket `trade-attachments` in the target.

- [x] **Step 1: Have the runner reject apply if any Investment table/function/bucket already exists with an incompatible definition.**
- [x] **Step 2: Run inventory and confirm the target has no Investment-named tables, functions, or bucket.**
- [x] **Step 3: Apply the ordered schema list in one target transaction; exclude `supabase-learning-reset-2026-05-05.sql` and duplicate stock-quant migration.**
- [x] **Step 4: Query target metadata and confirm all expected tables/functions/policies/bucket exist while all pre-existing target counts remain unchanged.**

### Task 4: Migrate Auth, public data, and Storage

**Files:**
- Modify: `scripts/supabase-investment-migration/run.mjs`

**Interfaces:**
- Auth import copies `auth.users` and `auth.identities`, skipping the duplicate source identity and remapping its UUID to the existing target UUID.
- Public import copies every source `public` table with recursive UUID remapping, disables triggers only inside the target transaction, and uses conflict-safe inserts.
- Storage import recursively downloads each `trade-attachments` object and uploads it to the target with the same path and MIME type.

- [x] **Step 1: Add failing tests for duplicate Auth mapping, nested UUID remapping, idempotent conflict behavior, and Storage path preservation.**
- [x] **Step 2: Run tests and verify the intended failures.**
- [x] **Step 3: Implement Auth/public/Storage apply logic with transaction rollback on any database error.**
- [x] **Step 4: Execute `run.ps1 -Mode apply`; do not modify Vercel yet.**
- [x] **Step 5: Execute `run.ps1 -Mode verify` and require exact Auth/public table/Storage object counts plus zero source-only orphan foreign keys.**

### Task 5: Deploy the Edge Function and configure shared-project Auth

**Files:**
- Read: `supabase/functions/get-kid-description/index.ts`
- Read: `supabase/functions/get-kid-description/config.toml`

**Interfaces:**
- Produces: target Edge Function `get-kid-description` with JWT verification enabled and `OPENAI_API_KEY` set from the existing local secret without logging it.
- Preserves both design and Investment Auth redirect URLs.

- [x] **Step 1: Set `OPENAI_API_KEY` on target through stdin/in-process environment only.**
- [x] **Step 2: Deploy with `npx supabase functions deploy get-kid-description --project-ref ilboytxdlydyrrdnwlon --use-api`.**
- [x] **Step 3: Verify function status is `ACTIVE`, JWT verification is enabled, and an unauthenticated request is rejected by Auth rather than returning a deployment error.**
- [x] **Step 4: Verify target Auth health/settings and ensure the Investment production `/update-password` URL remains allowlisted before cutover.**

### Task 6: Cut Vercel production over and preserve rollback

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Updates `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` for Vercel Development, Preview, and Production.
- Produces a Vercel production deployment using target Supabase while source values remain available in `.env.local` until verification ends.

- [ ] **Step 1: Bump patch version and add a changelog entry describing the infrastructure migration and expected sign-out.**
- [ ] **Step 2: Run migration tests, existing focused tests, `npm run build`, and verify zero failures.**
- [ ] **Step 3: Update all three Vercel variables without printing values.**
- [ ] **Step 4: Deploy with `npx vercel --prod --yes`.**
- [ ] **Step 5: Verify `/`, `/login`, Auth health/settings, REST access, copied table counts, Storage downloads, and `get-kid-description` on the public production alias.**
- [ ] **Step 6: Commit and push only the plan, migration tooling, tests, dependency/version files, and changelog after live verification.**
- [ ] **Step 7: Ask for one real user login confirmation; only after confirmation pause source project `bkbxzdbthxwccdfcwsub`. Do not delete it.**

## Self-Review

- Spec coverage: source/target inventory, non-conflicting schema merge, duplicate Auth identity, public data, Storage, Edge Function, Vercel cutover, rollback, verification, and cost-stop pause are covered.
- Placeholder scan: no TODO/TBD/implement-later steps remain.
- Type consistency: helper names and `run.ps1 -Mode inventory|apply|verify` are consistent across tasks.
