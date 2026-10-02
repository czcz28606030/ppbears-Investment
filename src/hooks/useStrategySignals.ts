import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStrategySignals } from '../api';
import { useStore } from '../store';
import type { StrategyDecision } from '../utils/trendStrategy';
import { createDailyResourceCache } from '../utils/dailyResourceCache';

type CachedSignal = { decision: StrategyDecision; journalUnavailable: boolean };
const dailySignals = createDailyResourceCache<CachedSignal>('ppbears_strategy_daily_v2');
const decisions = (items: Record<string, CachedSignal>) => Object.fromEntries(Object.entries(items).map(([code, item]) => [code, item.decision]));

export function useStrategySignals(codes: string[], enabled = true) {
  const { user, holdings, trades, session, dataReady } = useStore();
  const codesKey = [...new Set(codes)].sort().join(',');
  const accountKey = `${user?.id || ''}|${user?.availableBalance || 0}|${holdings.map(h => `${h.stockCode}:${h.totalShares}:${h.avgCost}`).sort().join(',')}|${trades.length}:${trades[0]?.timestamp || 0}`;
  const active = Boolean(enabled && session?.access_token && user && dataReady);
  const initial = active ? dailySignals.peek(accountKey, codesKey.split(',')) : {};
  const [signals, setSignals] = useState<Record<string, StrategyDecision>>(() => decisions(initial));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const sequence = useRef(0);
  const load = useCallback(async (force = false) => {
    const request = ++sequence.current;
    if (!active || !codesKey) { setSignals({}); setLoading(false); setError(''); setWarning(''); return; }
    const requested = codesKey.split(',');
    const cached = dailySignals.peek(accountKey, requested);
    setSignals(decisions(cached));
    setLoading(force || requested.some(code => !cached[code])); setError('');
    try {
      const result = await dailySignals.load(accountKey, requested, async missing => {
        const collected: Record<string, CachedSignal> = {};
        for (let start = 0; start < missing.length; start += 20) {
          const payload = await fetchStrategySignals(missing.slice(start, start + 20), { forceFresh: force });
          if (!payload || payload.source !== 'weekly-trend-v1') throw new Error('週榜趨勢訊號暫時無法取得');
          for (const [code, decision] of Object.entries(payload.signals)) collected[code] = { decision, journalUnavailable: payload.journalStatus === 'unavailable' };
        }
        return collected;
      }, force);
      if (request === sequence.current) {
        setSignals(decisions(result));
        setWarning(Object.values(result).some(item => item.journalUnavailable) ? '策略歷史保存暫時無法完成；歷史箭頭可能不完整。' : '');
      }
    } catch (failure) {
      if (request === sequence.current) setError(failure instanceof Error ? failure.message : '訊號讀取失敗');
    } finally { if (request === sequence.current) setLoading(false); }
  }, [active, codesKey, accountKey]);
  const refresh = useCallback(() => load(true), [load]);
  useEffect(() => {
    void load();
    // Checks the Taipei day locally. Same-day visibility and timer events never re-fetch valid results.
    const show = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(show, 60000);
    document.addEventListener('visibilitychange', show);
    // Invalidate async requests rather than capture a DOM ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { ++sequence.current; window.clearInterval(timer); document.removeEventListener('visibilitychange', show); };
  }, [load]);
  return { signals, loading, error, warning, refresh };
}
