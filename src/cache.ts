/**
 * 模組級快取 (Module-level Cache)
 * 
 * 存活於整個 SPA 生命週期（不跨頁面刷新）
 * 用途：避免切換頁面時重複呼叫相同 API
 *
 * TTL 設計：
 *  - Simons 每日推薦：10 分鐘（盤中幾乎不變）
 *  - TWSE/TPEX 全市場報價：10 分鐘
 *  - 個股量化資料（quant）：10 分鐘
 *  - 觀察名單即時報價：5 分鐘
 *  - Portfolio AI 訊號：5 分鐘
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 分鐘

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface PersistentCacheEntry<T> extends CacheEntry<T> {
  refreshSlot?: string;
}

export type VersionedMarketCache = {
  _dataVersion?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store: Map<string, CacheEntry<any>> = new Map();

/** 取得快取，若不存在或過期則回傳 null */
export function getCache<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

/** 取得帶每日資料版本的快取；版本不合時直接淘汰，避免返回頁還原舊資料。 */
export function getVersionedCache<T extends VersionedMarketCache>(key: string, dataVersion?: string | null): T | null {
  const data = getCache<T>(key);
  if (!data) return null;
  if (dataVersion && data._dataVersion !== dataVersion) {
    clearCache(key);
    return null;
  }
  if (!dataVersion && !data._dataVersion) {
    clearCache(key);
    return null;
  }
  return data;
}

/** 寫入快取 */
export function setCache<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/** 強制清除特定 key（例如手動刷新） */
export function clearCache(key: string): void {
  store.delete(key);
}

/** 讀取可跨頁面刷新保留的快取 */
export function getPersistentCache<T>(key: string, refreshSlot?: string): T | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as PersistentCacheEntry<T>;
    if (Date.now() > entry.expiresAt || (refreshSlot && entry.refreshSlot !== refreshSlot)) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

/** 讀取帶每日資料版本的跨頁快取；版本不合時清除 localStorage。 */
export function getVersionedPersistentCache<T extends VersionedMarketCache>(
  key: string,
  refreshSlot?: string,
  dataVersion?: string | null
): T | null {
  const data = getPersistentCache<T>(key, refreshSlot);
  if (!data) return null;
  if (dataVersion && data._dataVersion !== dataVersion) {
    clearPersistentCache(key);
    return null;
  }
  if (!dataVersion && !data._dataVersion) {
    clearPersistentCache(key);
    return null;
  }
  return data;
}

/** 寫入可跨頁面刷新保留的快取 */
export function setPersistentCache<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS, refreshSlot?: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const entry: PersistentCacheEntry<T> = {
      data,
      expiresAt: Date.now() + ttlMs,
      refreshSlot,
    };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // localStorage 滿了或不可用時，保留記憶體快取即可。
  }
}

/** 清除跨頁面刷新保留的快取 */
export function clearPersistentCache(key: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(key);
}

/** 清除所有快取 */
export function clearAllCache(): void {
  store.clear();
}

/** 清除每日 AI/量化/K 線摘要相關快取；保留非資料性的 UI 偏好。 */
export function invalidateDailyMarketDataCaches(): void {
  store.delete('simons_data');
  store.delete('watchlist_full');
  store.delete('portfolio_signals_v7');
  store.delete('portfolio_signals_v8');
  try {
    const localPrefixes = [
      'ppbears_quant30_',
      'ppbears_simons_daily7_',
    ];
    const exactLocalKeys = [
      'ppbears_watchlist_full_v4',
      'ppbears_portfolio_signals_v7',
      'ppbears_portfolio_signals_v8',
    ];
    Object.keys(localStorage).forEach(key => {
      if (exactLocalKeys.includes(key) || localPrefixes.some(prefix => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    });
  } catch {}
  try {
    sessionStorage.removeItem('explore_stock_list');
  } catch {}
}

/** 取得快取剩餘時間（毫秒），-1 表示不存在 */
export function getCacheTTL(key: string): number {
  const entry = store.get(key);
  if (!entry) return -1;
  return Math.max(0, entry.expiresAt - Date.now());
}

// ── 固定 Key 常數 ────────────────────────────────────────
export const CACHE_KEYS = {
  SIMONS_DATA:     'simons_data',
  TWSE_PRICE_MAP:  'twse_price_map',
  QUANT_DATA:      (code: string) => `quant_${code}`,
  WATCHLIST_QUOTES:'watchlist_quotes',
  WATCHLIST_FULL:  'watchlist_full',      // quotes + quant + simons
  PORTFOLIO_SIGNALS: 'portfolio_signals_v8',
} as const;