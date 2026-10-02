export interface WeeklyTopItem {
  ticker: string;
  name: string;
  changeType: 'ADDED' | 'UNCHANGED';
  rank: number;
  previousRank: number | null;
  rankChange: number | null;
  aitValue: number;
  previousAitValue: number | null;
  weekEndDate: string;
  refreshedAt: string;
}
export interface WeeklyTopPayload {
  items: WeeklyTopItem[];
  weekEndDate: string;
  updatedAt: string;
  source: 'stoxgauge-weekly';
}

export function normalizeWeeklyTop(payload: unknown): WeeklyTopPayload {
  const raw = payload as { data?: Record<string, unknown>[]; data_updated_at?: string };
  if (!raw || !Array.isArray(raw.data)) throw new Error('週榜資料格式不正確');
  const items = raw.data.filter(row => row.change_type !== 'REMOVED').map(row => {
    if (!/^\d{4,6}$/.test(String(row.ticker)) || !row.name
      || !Number.isInteger(row.latest_rank) || Number(row.latest_rank) < 1
      || typeof row.latest_cumulative_ait_value !== 'number' || !Number.isFinite(row.latest_cumulative_ait_value)
      || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.latest_week_end_date))
      || !['ADDED', 'UNCHANGED'].includes(String(row.change_type))) throw new Error('週榜股票資料不完整');
    return {
      ticker: String(row.ticker), name: String(row.name),
      changeType: row.change_type as WeeklyTopItem['changeType'],
      rank: Number(row.latest_rank), previousRank: row.previous_rank == null ? null : Number(row.previous_rank),
      rankChange: row.rank_change == null ? null : Number(row.rank_change),
      aitValue: row.latest_cumulative_ait_value,
      previousAitValue: row.previous_cumulative_ait_value == null ? null : Number(row.previous_cumulative_ait_value),
      weekEndDate: String(row.latest_week_end_date), refreshedAt: String(row.refreshed_at || ''),
    };
  }).sort((a, b) => a.rank - b.rank);
  if (new Set(items.map(item => item.ticker)).size !== items.length) throw new Error('週榜股票代號重複');
  if (new Set(items.map(item => item.weekEndDate)).size > 1) throw new Error('週榜週期不一致');
  return { items, weekEndDate: items[0]?.weekEndDate || '', updatedAt: raw.data_updated_at || '', source: 'stoxgauge-weekly' };
}
