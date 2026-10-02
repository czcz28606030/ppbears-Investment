import type { SupabaseClient } from '@supabase/supabase-js';
import type { StrategyDecision, StrategyEvent, StrategySignalsPayload } from '../utils/trendStrategy.js';

const SOURCE = 'weekly-trend-v1';
type CacheRow = {
  cache_date: string; user_id: string; surface: 'watchlist' | 'portfolio'; signature: string;
  payload: Record<string, unknown>; status: 'ready' | 'partial' | 'empty';
  data_date: string | null; generated_at: string; stale_reason: string | null;
};
type JournalResult = StrategySignalsPayload & { journalStatus?: 'saved' | 'unavailable'; journalError?: string };
const locks = new Map<string, Promise<unknown>>();

function validSignals(value: unknown): Record<string, StrategyDecision> {
  if (!value || typeof value !== 'object') return {};
  const payload = value as Partial<StrategySignalsPayload>;
  if (payload.source !== SOURCE || !payload.signals || typeof payload.signals !== 'object') return {};
  return Object.fromEntries(Object.entries(payload.signals).filter(([code, decision]) => /^\d{4,6}$/.test(code)
    && decision && decision.source === SOURCE && decision.code === code && Array.isArray(decision.events)));
}
function mergeEvents(history: StrategyEvent[], current: StrategyEvent[], maxDate: string): StrategyEvent[] {
  const events = new Map<string, StrategyEvent>();
  for (const event of [...history, ...current]) {
    if (!event || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || event.date > maxDate
      || !['entry', 'add', 'reduce', 'exit'].includes(event.action)
      || typeof event.label !== 'string' || typeof event.reason !== 'string') continue;
    events.set(`${event.date}|${event.action}`, event);
  }
  return [...events.values()].sort((a, b) => a.date.localeCompare(b.date) || a.action.localeCompare(b.action));
}

// Serializes saves in this worker and re-reads the destination immediately before write.
// A cross-instance atomic merge would require a database RPC/schema migration.
export async function saveStrategyCacheRowPreservingSignals(client: SupabaseClient, row: CacheRow): Promise<void> {
  const key = `${row.user_id}|${row.cache_date}|${row.surface}`;
  const previous = locks.get(key) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const existing = await client.from('user_market_daily_cache').select('payload')
      .eq('user_id', row.user_id).eq('cache_date', row.cache_date).eq('surface', row.surface).limit(1);
    if (existing.error) throw new Error(existing.error.message);
    const oldSignals = validSignals(existing.data?.[0]?.payload);
    const currentSignals = validSignals(row.payload);
    const signals = { ...oldSignals };
    for (const [code, current] of Object.entries(currentSignals)) {
      signals[code] = { ...current, events: mergeEvents(oldSignals[code]?.events || [], current.events,
        current.dataDate || row.generated_at.slice(0, 10)) };
    }
    const entries = Object.values(signals);
    const incomplete = entries.filter(signal => signal.status !== 'ready').map(signal => signal.code);
    const dates = entries.map(signal => signal.dataDate).filter(Boolean).sort();
    const merged: CacheRow = {
      ...row, signature: Object.keys(signals).sort().join(','),
      payload: { source: SOURCE, generatedAt: row.generated_at, signals },
      status: entries.length ? incomplete.length ? 'partial' : 'ready' : 'empty',
      data_date: dates[0] || null,
      stale_reason: incomplete.length ? `Incomplete strategy data: ${incomplete.join(',')}` : null,
    };
    const result = await client.from('user_market_daily_cache').upsert(merged,
      { onConflict: 'cache_date,user_id,surface', ignoreDuplicates: false });
    if (result.error) throw new Error(result.error.message);
  });
  locks.set(key, task);
  try { await task; } finally { if (locks.get(key) === task) locks.delete(key); }
}

export async function mergeAndSaveStrategyJournal(client: SupabaseClient, userId: string, payload: StrategySignalsPayload): Promise<JournalResult> {
  const generatedDate = new Date(Date.parse(payload.generatedAt) + 8 * 3600000).toISOString().slice(0, 10);
  const currentPayload: StrategySignalsPayload = { ...payload, signals: Object.fromEntries(Object.entries(payload.signals).map(([code, signal]) => {
    const events = [...signal.events];
    if (signal.source === SOURCE && signal.status === 'ready' && ['entry', 'add', 'reduce', 'exit'].includes(signal.action)
      && /^\d{4}-\d{2}-\d{2}$/.test(signal.dataDate) && signal.dataDate <= generatedDate
      && !events.some(event => event.date === signal.dataDate && event.action === signal.action)) {
      events.push({ date: signal.dataDate, action: signal.action as StrategyEvent['action'], label: signal.label, reason: signal.reason });
    }
    return [code, { ...signal, events }];
  })) };
  try {
    if (payload.source !== SOURCE) throw new Error('Unexpected strategy source');
    const history = await client.from('user_market_daily_cache').select('payload')
      .eq('user_id', userId).order('cache_date', { ascending: false }).limit(400);
    if (history.error) throw new Error(history.error.message);
    const historicalEvents: Record<string, StrategyEvent[]> = {};
    for (const row of history.data || []) {
      for (const [code, signal] of Object.entries(validSignals(row.payload))) {
        historicalEvents[code] = [...(historicalEvents[code] || []), ...signal.events];
      }
    }
    const signals = Object.fromEntries(Object.entries(currentPayload.signals).map(([code, current]) => [code,
      { ...current, events: mergeEvents(historicalEvents[code] || [], current.events,
        current.dataDate || payload.generatedAt.slice(0, 10)) }]));
    const combined: StrategySignalsPayload = { ...payload, signals };
    const date = new Date(Date.parse(payload.generatedAt) + 8 * 3600000).toISOString().slice(0, 10);
    await saveStrategyCacheRowPreservingSignals(client, {
      cache_date: date, user_id: userId, surface: 'watchlist', signature: Object.keys(signals).sort().join(','),
      payload: combined, status: 'ready', data_date: null,
      generated_at: payload.generatedAt, stale_reason: null,
    });
    return { ...combined, journalStatus: 'saved' };
  } catch (error) {
    return { ...currentPayload, journalStatus: 'unavailable', journalError: error instanceof Error ? error.message : String(error) };
  }
}
