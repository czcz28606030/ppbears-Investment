import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Compile the actual modules; replace unrelated service imports at the test boundary.
async function load(relative, imports = '') {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } });
  const code = imports + outputText.replace(/^import[\s\S]*?;\s*/gm, '');
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

test('API refresh integration: cached price is bypassed and errors never become quant cache', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const helper = new URL('../src/utils/marketRequest.ts', import.meta.url).href;
  const api = await load('../src/api.ts', `import { fetchMarketResponse } from '${helper}'; const supabase = null;\n`);
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ prices: { '2356': { close: String(60 + calls) } } }); };
    assert.equal((await api.fetchOfficialPriceMap())['2356'].close, '61');
    assert.equal((await api.fetchOfficialPriceMap())['2356'].close, '61');
    assert.equal((await api.fetchOfficialPriceMap({ forceFresh: true }))['2356'].close, '62');
    assert.equal(calls, 2);
    let quantCalls = 0;
    globalThis.fetch = async () => {
      quantCalls++;
      return Response.json({ data: { aiQuanBackDataComment: null, meta: { source: 'empty' } } });
    };
    await api.fetchStockQuantData('2356');
    await api.fetchStockQuantData('2356');
    assert.equal(quantCalls, 2, 'empty quant results must not be cached for 30 minutes');
  } finally { globalThis.fetch = previousFetch; globalThis.localStorage = previousStorage; }
});

test('backend timeout returns non-cacheable 502 instead of a cached HTTP 200', async () => {
  const { default: handler } = await load('../api/app-cache.ts');
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('This operation was aborted'); };
  const headers = {};
  let status;
  let body;
  const response = {
    setHeader: (key, value) => { headers[key] = value; },
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  };
  try {
    await handler({ method: 'GET', query: { type: 'ifalgo-stock', coid: '2356' } }, response);
    assert.equal(status, 502);
    assert.equal(headers['Cache-Control'], 'no-store, max-age=0');
    assert.equal(body.error, 'This operation was aborted');
  } finally { globalThis.fetch = previousFetch; }
});
