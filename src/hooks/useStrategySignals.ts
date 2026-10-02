import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStrategySignals } from '../api';
import { useStore } from '../store';
import type { StrategyDecision } from '../utils/trendStrategy';

export function useStrategySignals(codes: string[], enabled = true) {
  const { user, holdings, trades, session } = useStore();
  const codesKey = [...new Set(codes)].sort().join(',');
  const accountKey = `${user?.id || ''}|${user?.availableBalance || 0}|${holdings.map(h => `${h.stockCode}:${h.totalShares}:${h.avgCost}`).sort().join(',')}|${trades.length}:${trades[0]?.timestamp || 0}`;
  const [signals, setSignals] = useState<Record<string, StrategyDecision>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const sequence = useRef(0);
  const mounted = useRef(true);
  const token = session?.access_token;
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    if (!enabled || !token || !codesKey) { setSignals({}); setLoading(false); setError(''); setWarning(''); return; }
    setLoading(true); setError(''); setWarning('');
    try {
      const results: Record<string, StrategyDecision> = {};
      const requested = codesKey.split(',');
      let journalUnavailable = false;
      for (let start = 0; start < requested.length; start += 20) {
        const payload = await fetchStrategySignals(requested.slice(start, start + 20), { forceFresh: true });
        if (!payload || payload.source !== 'weekly-trend-v1') throw new Error('週榜趨勢訊號暫時無法取得');
        Object.assign(results, payload.signals);
        journalUnavailable ||= payload.journalStatus === 'unavailable';
      }
      if (mounted.current && request === sequence.current) { setSignals(results); setWarning(journalUnavailable ? '策略歷史保存暫時無法完成；目前顯示本次判斷，歷史箭頭可能不完整。' : ''); }
    } catch (failure) {
      if (mounted.current && request === sequence.current) { setSignals({}); setError(failure instanceof Error ? failure.message : '訊號讀取失敗'); }
    } finally { if (mounted.current && request === sequence.current) setLoading(false); }
  // accountKey invalidates recommendations after actual buys/sells/cash changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token, codesKey, accountKey]);
  useEffect(() => {
    mounted.current = true;
    setSignals({});
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15 * 60 * 1000);
    const show = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', show);
    // This counter invalidates requests; it is not a DOM reference captured by the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { mounted.current = false; ++sequence.current; window.clearInterval(timer); document.removeEventListener('visibilitychange', show); };
  }, [refresh]);
  return { signals, loading, error, warning, refresh };
}
