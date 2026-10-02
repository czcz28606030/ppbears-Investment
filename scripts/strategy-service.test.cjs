const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function service(fetcher) {
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} }; modules.set(file, module.exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, Date, Map, Set, Promise, Number, AbortSignal, process: { env: {} }, fetch: fetcher,
      require(name) {
        if (name === 'node:crypto') return require(name);
        if (name === '@supabase/supabase-js') return { createClient() { throw Error('Unexpected database access'); } };
        if (name.includes('weekly-top')) return { getWeeklyTop() { throw Error('Unexpected weekly access'); } };
        if (name.includes('strategy-journal')) return {};
        return load(require('node:path').resolve(require('node:path').dirname(file), name.replace(/\.js$/, '.ts')));
      } }, { filename: file });
    return module.exports;
  }
  return load(require('node:path').resolve(__dirname, '../src/server/strategy-service.ts'));
}
test('official HTTP 200 application error never becomes partially cached history', async () => {
  let requests = 0;
  const api = service(async () => { requests++; return { ok: true, json: async () => ({ stat: 'server failed' }) }; });
  await assert.rejects(api.getStrategyPrices('2330', 'listed'), /不完整/);
  await assert.rejects(api.getStrategyPrices('2330', 'listed'), /不完整/);
  assert.equal(requests, 6, 'rejected histories must not be cached');
});
test('missing transport month aborts all signal history instead of returning remaining bars', async () => {
  const api = service(async () => { throw Error('timeout'); });
  await assert.rejects(api.getStrategyPrices('2330', 'listed'), /不完整/);
});
test('malformed official rows reject a seemingly successful month', async () => {
  const api = service(async () => ({ ok: true, json: async () => ({ stat: 'OK', data: [['115/10/01', '--', '', '100', '101', '99', '100']] }) }));
  await assert.rejects(api.getStrategyPrices('2330', 'listed'), /不完整/);
});
test('concurrent identical stock reads share only official provider requests', async () => {
  let requests = 0;
  const api = service(async () => { requests++; return { ok: true, json: async () => ({ stat: 'OK', data: [['115/10/01', '1000000', '', '100', '101', '99', '100']] }) }; });
  const [a, b] = await Promise.all([api.getStrategyPrices('2330', 'listed'), api.getStrategyPrices('2330', 'listed')]);
  assert.equal(requests, 9);
  assert.equal(a, b);
  assert.equal(a.length, 1);
  assert.equal(a[0].volume, 1000);
});
test('official OTC after-trading fallback repairs cloud OpenAPI failure with date and share units', async () => {
  const urls = [];
  const api = service(async url => {
    urls.push(url);
    if (url.includes('tpex_mainboard')) throw Error('cloud source failure');
    const payload = url.includes('dailyQuotes')
      ? { stat: 'ok', date: '20261001', tables: [{ data: [['6488', '環球晶', '1085.00', '+50.00', '', '', '', '', '24,330,441']] }] }
      : [{ Code: '2330', Name: '台積電', Date: '1151001', ClosingPrice: '2510.00', TradeVolume: '1000000', Change: '10' }];
    return { ok: true, json: async () => payload };
  });
  const map = await api.getStrategyMarketMap();
  assert.equal(map['6488'].market, 'otc');
  assert.equal(map['6488'].date, '2026-10-01');
  assert.equal(map['6488'].volume, 24330.441);
  assert.equal(map['2330'].volume, 1000);
  await api.getStrategyMarketMap();
  assert.equal(urls.length, 3, 'only a complete two-market map may be cached');
});
