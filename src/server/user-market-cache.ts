import type { VercelRequest } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { saveStrategyCacheRowPreservingSignals } from './strategy-journal.js';
import { collectWeeklyStrategySnapshot, getStrategySignalsForUser } from './strategy-service.js';

const SOURCE = 'weekly-trend-v1' as const;
type Surface = 'watchlist' | 'portfolio';
type UserRow = {
  id: string;
  role: 'parent' | 'child';
  parent_id: string | null;
  tier: 'free' | 'premium';
  is_admin: boolean;
  subscription_expires_at: string | null;
};
type FeatureOverrideRow = { user_id: string; feature_key: string; enabled: boolean };
type StockRow = { user_id: string; stock_code: string; total_shares?: number | string };
export type UserMarketCacheRow = {
  cache_date: string;
  user_id: string;
  surface: Surface;
  signature: string;
  payload: Record<string, unknown>;
  status: 'ready' | 'partial' | 'empty';
  data_date: string | null;
  generated_at: string;
  stale_reason: string | null;
};

export function todayTaipei(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function getAdminClient(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase server configuration');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function hasFeature(user: UserRow, key: string, users: Map<string, UserRow>, overrides: FeatureOverrideRow[], seen = new Set<string>()): boolean {
  if (seen.has(user.id)) return false;
  seen.add(user.id);
  const override = overrides.find(row => row.user_id === user.id && row.feature_key === key);
  if (override) return override.enabled;
  if (user.is_admin) return true;
  if (user.tier === 'premium' && (!user.subscription_expires_at || new Date(user.subscription_expires_at).getTime() > Date.now())) return true;
  const parent = user.role === 'child' && user.parent_id ? users.get(user.parent_id) : undefined;
  return parent ? hasFeature(parent, key, users, overrides, seen) : false;
}

function codesFor(rows: StockRow[], userId: string): string[] {
  return [...new Set(rows.filter(row => row.user_id === userId)
    .map(row => row.stock_code.trim()).filter(code => /^\d{4,6}$/.test(code)))].sort();
}

// Called only after the app-cache handler authenticates its scheduler request.
// Direct service calls retain the actual user's holdings/cash/trades and avoid self HTTP.
export async function buildAndSaveUserMarketCaches(_req: VercelRequest) {
  void _req;
  const supabase = getAdminClient();
  const [usersResult, holdingsResult, watchlistResult, overridesResult] = await Promise.all([
    supabase.from('users').select('id,role,parent_id,tier,is_admin,subscription_expires_at'),
    supabase.from('holdings').select('user_id,stock_code,total_shares'),
    supabase.from('watchlist').select('user_id,stock_code'),
    supabase.from('feature_overrides').select('user_id,feature_key,enabled')
      .in('feature_key', ['ai_stock_picking', 'ai_portfolio_advice']),
  ]);
  for (const result of [usersResult, holdingsResult, watchlistResult, overridesResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const users = (usersResult.data || []) as UserRow[];
  const holdings = ((holdingsResult.data || []) as StockRow[]).filter(row => Number(row.total_shares) > 0);
  const watchlist = (watchlistResult.data || []) as StockRow[];
  const overrides = (overridesResult.data || []) as FeatureOverrideRow[];
  const usersById = new Map(users.map(user => [user.id, user]));
  const date = todayTaipei();
  const rows: UserMarketCacheRow[] = [];
  const failed: Array<{ userId?: string; start?: number; error: string }> = [];
  const warmedCodes = new Set<string>();
  await collectWeeklyStrategySnapshot();

  for (const user of users) {
    const surfaces: Array<{ surface: Surface; codes: string[] }> = [];
    if (hasFeature(user, 'ai_stock_picking', usersById, overrides)) {
      const codes = codesFor(watchlist, user.id);
      if (codes.length) surfaces.push({ surface: 'watchlist', codes });
    }
    if (hasFeature(user, 'ai_portfolio_advice', usersById, overrides)) {
      const codes = codesFor(holdings, user.id);
      if (codes.length) surfaces.push({ surface: 'portfolio', codes });
    }
    if (!surfaces.length) continue;
    const codes = [...new Set(surfaces.flatMap(item => item.codes))];
    try {
      const result = await getStrategySignalsForUser(user.id, codes);
      if (result.source !== SOURCE) throw new Error('Unexpected strategy source');
      for (const code of codes) warmedCodes.add(code);
      for (const { surface, codes: surfaceCodes } of surfaces) {
        const signals = Object.fromEntries(surfaceCodes.filter(code => result.signals[code])
          .map(code => [code, result.signals[code]]));
        const unavailable = surfaceCodes.filter(code => !signals[code] || signals[code].status !== 'ready');
        const dates = Object.values(signals).map(signal => signal.dataDate).filter(Boolean).sort();
        rows.push({
          cache_date: date,
          user_id: user.id,
          surface,
          signature: surfaceCodes.join(','),
          payload: { source: SOURCE, generatedAt: result.generatedAt, signals },
          status: unavailable.length ? 'partial' : 'ready',
          data_date: dates[0] || null,
          generated_at: result.generatedAt,
          stale_reason: unavailable.length ? `Incomplete strategy data: ${unavailable.join(',')}` : null,
        });
      }
    } catch (error) {
      failed.push({ userId: user.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  let savedRows = 0;
  for (let start = 0; start < rows.length; start++) {
    try {
      await saveStrategyCacheRowPreservingSignals(supabase, rows[start]);
      savedRows++;
    } catch (error) {
      failed.push({ start, userId: rows[start].user_id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    success: failed.length === 0,
    source: SOURCE,
    date,
    userCount: users.length,
    stockCount: warmedCodes.size,
    cacheRows: rows.length,
    savedRows,
    failed,
  };
}
