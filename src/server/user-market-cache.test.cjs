const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(rows) {
 const calls = []; const saved = [];
 const db = {from(table) {const builder = {select(){return builder},order(){return builder},in(){return builder},then(resolve){return Promise.resolve({data:rows[table]||[],error:null}).then(resolve)},upsert(chunk){saved.push(...(Array.isArray(chunk)?chunk:[chunk]));return Promise.resolve({error:null})},update(){return builder},eq(){return builder}};return builder}};
 const module = {exports:{}};
 const js = ts.transpileModule(fs.readFileSync(__dirname+'/user-market-cache.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{module,exports:module.exports,process:{env:{VITE_SUPABASE_URL:'url',SUPABASE_SERVICE_ROLE_KEY:'private'}},Date,Map,Set,Promise,URLSearchParams,fetch:async()=>({ok:false}),console,require(name){if(name==='@supabase/supabase-js')return {createClient:()=>db};if(name.includes('strategy-journal'))return {saveStrategyCacheRowPreservingSignals:async(client,row)=>{const result=await client.from('user_market_daily_cache').upsert(row);if(result.error)throw Error(result.error.message)}};if(name.includes('strategy-service'))return {collectWeeklyStrategySnapshot:async()=>{},getStrategySignalsForUser:async(user,codes)=>{calls.push({user,codes});if(rows.failUser===user)throw Error("user calculation failed");return {source:'weekly-trend-v1',generatedAt:new Date().toISOString(),signals:Object.fromEntries(codes.map(code=>[code,{code,status:rows.unavailableCode===code?'unavailable':'ready',dataDate:'2026-10-01'}]))}},getStrategyPrices:async()=>[]};throw Error(name)}});
 return {run:module.exports.buildAndSaveUserMarketCaches,calls,saved};
}
test('warms only entitled surfaces and applies parent overrides',async()=>{
 const parent={id:'p',role:'parent',parent_id:null,tier:'premium',is_admin:false,subscription_expires_at:null};const child={...parent,id:'c',role:'child',parent_id:'p',tier:'free'};
 const x=load({users:[parent,child],holdings:[{user_id:'c',stock_code:'2330',total_shares:10}],watchlist:[{user_id:'c',stock_code:'2317'}],feature_overrides:[{user_id:'p',feature_key:'ai_stock_picking',enabled:false}]});
 await x.run({headers:{}});assert.deepEqual(x.saved.map(row=>row.surface),['portfolio']);assert.equal(x.calls.length,1);assert.equal(x.calls[0].user,'c');assert.equal(x.saved[0].payload.source,'weekly-trend-v1');assert.equal(x.saved[0].payload.signals['2330'].dataDate,'2026-10-01');assert.equal(x.saved[0].signature,'2330');
});
test('a child feature override wins over inherited denial',async()=>{
 const x=load({users:[{id:'p',role:'parent',tier:'premium'},{id:'c',role:'child',parent_id:'p',tier:'free'}],watchlist:[{user_id:'c',stock_code:'2317'}],feature_overrides:[{user_id:'p',feature_key:'ai_stock_picking',enabled:false},{user_id:'c',feature_key:'ai_stock_picking',enabled:true}]});await x.run({headers:{}});assert.equal(x.saved.length,1);assert.equal(x.saved[0].surface,'watchlist');assert.equal(x.saved[0].payload.source,'weekly-trend-v1');
});


test('marks unavailable decisions partial rather than ready',async()=>{
 const x=load({users:[{id:'p',role:'parent',tier:'premium'}],watchlist:[{user_id:'p',stock_code:'2317'}],unavailableCode:'2317'});await x.run({headers:{}});assert.equal(x.saved[0].status,'partial');assert.match(x.saved[0].stale_reason,/2317/);
});
test('isolates a failed user and reports incomplete warming',async()=>{
 const x=load({users:[{id:'p',role:'parent',tier:'premium'},{id:'q',role:'parent',tier:'premium'}],watchlist:[{user_id:'p',stock_code:'2317'},{user_id:'q',stock_code:'2330'}],failUser:'p'});const result=await x.run({headers:{}});assert.equal(result.success,false);assert.equal(result.failed[0].userId,'p');assert.equal(x.saved.length,1);assert.equal(x.saved[0].user_id,'q');
});
