import { normalizeWeeklyTop } from '../utils/weeklyTop.js';

export async function getWeeklyTop(token = process.env.STOXGAUGE_ACCESS_TOKEN) {
  if (!token) throw new Error('週榜來源尚未設定 STOXGAUGE_ACCESS_TOKEN');
  const url = new URL('https://investment-platform.zeabur.app/api/public/v1/stoxgauge/weekly-top');
  url.searchParams.set('lookbackDays', '10');
  url.searchParams.set('access_token', token);
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error('週榜來源連線失敗，請稍後重試');
  }
  if (!response.ok) throw new Error(`週榜來源回應失敗 (${response.status})`);
  try {
    return normalizeWeeklyTop(await response.json());
  } catch {
    throw new Error('週榜來源回傳的資料格式不正確');
  }
}
