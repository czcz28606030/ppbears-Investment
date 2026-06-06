export const PRICE_AUTO_REFRESH_MS = 5 * 60 * 1000;

export function isTaiwanMarketOpen(now = new Date()): boolean {
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const day = taipei.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = taipei.getUTCHours() * 60 + taipei.getUTCMinutes();
  return minutes >= 9 * 60 && minutes < 13 * 60 + 30;
}

export function canAutoRefreshPrices(): boolean {
  return document.visibilityState === 'visible' && isTaiwanMarketOpen();
}
