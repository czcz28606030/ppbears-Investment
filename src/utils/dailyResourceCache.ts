type Entry<T> = { day: string; value: T };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const taipeiCacheDay = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);

// Reuse results across routes and reloads. Identity includes account state for private data.
// No JWT or credentials are stored. A failed request is never treated as a completed daily load.
export function createDailyResourceCache<T>(namespace: string, options: { now?: () => number; storage?: () => StorageLike | undefined } = {}) {
  const memory = new Map<string, Entry<T>>();
  const pending = new Map<string, Promise<T>>();
  const day = () => taipeiCacheDay(options.now?.() ?? Date.now());
  const storage = options.storage ?? (() => { try { return typeof sessionStorage === 'undefined' ? undefined : sessionStorage; } catch { return undefined; } });
  const key = (identity: string, code: string) => `${namespace}:${encodeURIComponent(identity)}:${code}`;
  function read(identity: string, code: string): T | undefined {
    const id = key(identity, code);
    let entry = memory.get(id);
    if (!entry) { try { const raw = storage()?.getItem(id); if (raw) entry = JSON.parse(raw); } catch { /* storage unavailable */ } }
    if (entry?.day !== day()) { memory.delete(id); try { storage()?.removeItem(id); } catch { /* optional persistence */ } return undefined; }
    memory.set(id, entry);
    return entry.value;
  }
  const peek = (identity: string, codes: string[]) => Object.fromEntries(codes.flatMap(code => { const value = read(identity, code); return value === undefined ? [] : [[code, value]]; })) as Record<string, T>;
  async function load(identity: string, codes: string[], fetcher: (missing: string[]) => Promise<Record<string, T>>, force = false): Promise<Record<string, T>> {
    const unique = [...new Set(codes)]; const startedDay = day();
    const missing = unique.filter(code => (force || read(identity, code) === undefined) && !pending.has(`${startedDay}|${key(identity, code)}`));
    if (missing.length) {
      const batch = Promise.resolve().then(() => fetcher(missing));
      for (const code of missing) {
        const id = key(identity, code); const pendingKey = `${startedDay}|${id}`;
        const task = batch.then(values => {
          if (!Object.hasOwn(values, code) || values[code] === undefined) throw new Error(`資料不完整：${code}`);
          const value = values[code];
          if (day() === startedDay) { const entry = { day: startedDay, value }; memory.set(id, entry); try { storage()?.setItem(id, JSON.stringify(entry)); } catch { /* memory cache still works */ } }
          return value;
        }).finally(() => { if (pending.get(pendingKey) === task) pending.delete(pendingKey); });
        pending.set(pendingKey, task);
      }
    }
    const pairs = await Promise.all(unique.map(async code => {
      const task = pending.get(`${startedDay}|${key(identity, code)}`);
      return [code, task ? await task : read(identity, code)] as const;
    }));
    return Object.fromEntries(pairs) as Record<string, T>;
  }
  return { peek, load };
}
