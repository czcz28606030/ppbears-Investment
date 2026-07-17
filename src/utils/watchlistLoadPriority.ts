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
