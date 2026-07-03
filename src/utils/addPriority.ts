export type AddPriorityLevel = 'strong' | 'normal' | 'watch' | 'avoid';

export interface AddPriorityInput {
  simonsScore?: number | null;
  aiSignal?: 'buy' | 'sell' | 'neutral' | null;
  activeEtfScore?: number | null;
  activeEtfSignal?: 'bullish' | 'watch' | 'neutral' | 'bearish' | null;
  recommendationCount?: number | null;
  chipPts?: number | null;
  cumRetPct?: number | null;
}

export interface AddPriorityResult {
  score: number;
  level: AddPriorityLevel;
  label: string;
  reason: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreToLevel(score: number): AddPriorityLevel {
  if (score >= 78) return 'strong';
  if (score >= 64) return 'normal';
  if (score >= 45) return 'watch';
  return 'avoid';
}

function levelLabel(level: AddPriorityLevel): string {
  switch (level) {
    case 'strong': return '時機佳';
    case 'normal': return '時機尚可';
    case 'watch': return '等待確認';
    case 'avoid': return '暫緩';
    default: return '等待確認';
  }
}

export function calculateAddPriority(input: AddPriorityInput): AddPriorityResult {
  const components: Array<{ value: number; weight: number }> = [];
  if (input.simonsScore !== null && input.simonsScore !== undefined) {
    components.push({ value: clamp(input.simonsScore, 0, 100), weight: 0.34 });
  }
  if (input.activeEtfScore !== null && input.activeEtfScore !== undefined) {
    components.push({ value: clamp(input.activeEtfScore, 0, 100), weight: 0.20 });
  }
  if (input.chipPts !== null && input.chipPts !== undefined) {
    components.push({ value: clamp(input.chipPts, 0, 10) * 10, weight: 0.16 });
  }
  if ((input.recommendationCount || 0) > 0) {
    components.push({ value: clamp(Number(input.recommendationCount || 0), 0, 6) / 6 * 100, weight: 0.10 });
  }
  const cumRet = Number(input.cumRetPct);

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  let score = totalWeight > 0
    ? components.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight
    : 35;

  if (input.aiSignal === 'buy') score += 8;
  if (input.aiSignal === 'sell') score -= 14;
  if (input.activeEtfSignal === 'bullish') score += 6;
  if (input.activeEtfSignal === 'bearish') score -= 10;
  if (Number.isFinite(cumRet)) {
    if (cumRet > 35) score -= 5;
    else if (cumRet > 8) score += 4;
    else if (cumRet < -15) score -= 5;
  }

  const finalScore = Math.round(clamp(score, 0, 100));
  const level = scoreToLevel(finalScore);
  const reasons: string[] = [];
  if (input.aiSignal === 'buy') reasons.push('AI 進場');
  if (input.aiSignal === 'sell') reasons.push('AI 出場扣分');
  if (input.activeEtfSignal === 'bullish') reasons.push('ETF 支撐增加');
  if (input.activeEtfSignal === 'bearish') reasons.push('ETF 支撐減少');
  if ((input.recommendationCount || 0) >= 2) reasons.push(`推薦重複 ${input.recommendationCount} 次`);
  if ((input.chipPts || 0) >= 7) reasons.push('籌碼穩定');

  return {
    score: finalScore,
    level,
    label: levelLabel(level),
    reason: reasons.length > 0 ? reasons.join('、') : '條件尚未集中',
  };
}
