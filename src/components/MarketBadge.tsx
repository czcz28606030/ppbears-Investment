import './MarketBadge.css';

export type MarketKind = 'listed' | 'otc' | null | undefined;

type MarketBadgeProps = {
  market: MarketKind;
  compact?: boolean;
};

export default function MarketBadge({ market, compact = false }: MarketBadgeProps) {
  if (!market) return null;

  const label = market === 'listed' ? '上市' : '上櫃';
  const icon = market === 'listed' ? '🏰' : '🍯';

  return (
    <span className={`market-badge market-badge-${market}${compact ? ' market-badge-compact' : ''}`}>
      <span className="market-badge-icon">{icon}</span>
      <span>{label}</span>
    </span>
  );
}
