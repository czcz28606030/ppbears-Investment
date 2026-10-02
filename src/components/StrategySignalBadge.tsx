import type { StrategyAction } from '../utils/trendStrategy';
import './StrategySignalBadge.css';
const presentation: Record<StrategyAction | 'loading', [string, string]> = {
  entry: ['↗', '進場'], neutral: ['⏸', '中立'], add: ['＋', '加碼'], hold: ['🛡', '續抱'],
  reduce: ['－', '減碼'], exit: ['↘', '出場'], unavailable: ['?', '資料不足'], loading: ['⌛', '讀取中'],
};
export default function StrategySignalBadge({ action = 'unavailable', loading = false, tile = false }: { action?: StrategyAction; loading?: boolean; tile?: boolean }) {
  const state = loading ? 'loading' : action;
  const [icon, label] = presentation[state];
  return <span className={`strategy-signal-badge strategy-signal-${state}${tile ? ' strategy-signal-tile' : ''}`} aria-label={`策略訊號：${label}`}>
    <span className="strategy-signal-icon" aria-hidden="true">{icon}</span><span>{label}</span>
  </span>;
}
