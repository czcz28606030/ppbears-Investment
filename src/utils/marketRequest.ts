type Options = {
  fetcher?: typeof fetch;
  delayMs?: number;
  timeoutMs?: number;
  validate?: (payload: any) => boolean;
};

let sequence = 0;
let active = 0;
const waiting: Array<() => void> = [];

// Bound bursts from portfolio/watchlist batches, including automatic retries.
async function acquire() {
  if (active >= 6) await new Promise<void>(resolve => waiting.push(resolve));
  else active++;
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

/** Read-only market requests: never reuse an edge-cached error or accept it as data. */
export async function fetchMarketResponse(url: string, init: RequestInit = {}, options: Options = {}): Promise<Response> {
  if (init.method && init.method !== 'GET') throw new Error('Market requests must be GET');
  for (let attempt = 0; attempt < 3; attempt++) {
    await acquire();
    const controller = new AbortController();
    const abort = () => controller.abort();
    init.signal?.addEventListener('abort', abort, { once: true });
    if (init.signal?.aborted) controller.abort();
    const timer = setTimeout(abort, options.timeoutMs ?? 15000);
    try {
      const requestUrl = `${url}${url.includes('?') ? '&' : '?'}_request=${Date.now()}-${++sequence}`;
      const response = await (options.fetcher ?? fetch)(requestUrl, { ...init, cache: 'no-store', signal: controller.signal });
      if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) return response;
      if (!response.ok) throw new Error(`Market HTTP ${response.status}`);
      // Include body download/JSON parsing in the timeout and retry boundary.
      const payload = await response.clone().json();
      if (payload?.error) throw new Error(String(payload.error));
      if (options.validate && !options.validate(payload)) throw new Error('Market data unavailable');
      return response;
    } catch (error) {
      if (attempt === 2 || init.signal?.aborted) throw error;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abort);
      release();
    }
    await new Promise(resolve => setTimeout(resolve, (options.delayMs ?? 300) * (attempt + 1)));
  }
  throw new Error('Market data unavailable');
}
