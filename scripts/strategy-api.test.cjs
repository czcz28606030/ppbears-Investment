const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const compiled=ts.transpileModule(fs.readFileSync('api/app-cache.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(options={}) {
 const calls=[];const queryCalls=[];let providerCalls=0;
 const account={id:'signed-in-user',role:'parent',parent_id:null,tier:'premium',is_admin:false,subscription_expires_at:null,...options.account};
 const client={auth:{getUser:async token=>({data:{user:token==='valid-jwt'?{id:account.id}:null},error:null})},from(table){
  const filters=[];const query={select(){return this;},eq(key,value){filters.push([key,value]);queryCalls.push({table,key,value});return this;},in(){return this;},
   single:async()=>({data:account,error:null}),maybeSingle:async()=>({data:null,error:null}),
   then(resolve,reject){return Promise.resolve({data:table==='feature_overrides'?(options.overrides||[]):table==='holdings'?(options.holdings||[]):[],error:null}).then(resolve,reject);}};
  return query;
 }};
 const services={getStrategySignalsForUser:async(user,codes)=>{calls.push({kind:'signals',user,codes});return {source:'weekly-trend-v1',signals:{}};},
  getStrategyPrices:async()=>{calls.push({kind:'prices'});if(options.priceFailure)throw new Error('official provider unavailable');return [];},
  getStrategyMarketMap:async()=>({}),getStrategyWeekly:async()=>({items:[],weekEndDate:'2026-10-02'}),collectWeeklyStrategySnapshot:async()=>{calls.push({kind:'snapshot'});return {saved:true};}};
 const dependencies={'@supabase/supabase-js':{createClient:()=>client},'../src/server/strategy-service.js':services,
  '../src/server/institution-cost.js':{default:()=>{throw new Error('unexpected institution endpoint');}},'../src/server/user-market-cache.js':{buildAndSaveUserMarketCaches:async()=>{calls.push({kind:'warmup'});return {};}}};
 const exports={};const context={exports,require:name=>{assert.ok(dependencies[name],`unexpected dependency ${name}`);return dependencies[name];},process:{env:{NODE_ENV:'production',...(options.env||{})}},console,Date,Set,Map,Number,String,Array,Math,Promise,Error,AbortSignal,
  fetch:async()=>{providerCalls++;throw new Error('official fetch unavailable');}};
 vm.runInNewContext(compiled,context,{filename:'app-cache.test-runtime.cjs'});
 async function request(type,query={},headers={}) {
  const response={statusCode:null,headers:{},body:null,setHeader(key,value){this.headers[key]=value;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
  await exports.default({method:'GET',query:{type,...query},headers},response);return response;
 }
 return {request,calls,queryCalls,providers:()=>providerCalls};
}
test('every retired signal endpoint returns 410 without any provider or strategy service calls',async()=>{
 const f=fixture();for(const type of ['ifalgo-stock','stock-trading-signals','stock-quant','stock-quant-history','stock-quant-snapshot','simons','simons-rec-counts','simons-institution-cost']) {
  const response=await f.request(type,{coid:'2330'});assert.equal(response.statusCode,410);assert.equal(response.headers['Cache-Control'],'no-store, max-age=0');
 }assert.equal(f.providers(),0);assert.equal(f.calls.length,0);assert.equal(f.queryCalls.length,0);
});
test('personal strategy signals require JWT',async()=>{
 const f=fixture();assert.equal((await f.request('strategy-signals',{coids:'2330'})).statusCode,401);assert.equal(f.calls.length,0);
});
test('explicit disabled feature overrides deny premium member signals',async()=>{
 const f=fixture({overrides:[{user_id:'signed-in-user',feature_key:'ai_stock_picking',enabled:false},{user_id:'signed-in-user',feature_key:'ai_portfolio_advice',enabled:false}]});
 assert.equal((await f.request('strategy-signals',{coids:'2330'},{authorization:'Bearer valid-jwt'})).statusCode,403);assert.equal(f.calls.length,0);
});
test('query userId is ignored and service receives authenticated owner only',async()=>{
 const f=fixture();assert.equal((await f.request('strategy-signals',{coids:'2330',userId:'another-user'},{authorization:'Bearer valid-jwt'})).statusCode,200);
 assert.equal(f.calls[0].user,'signed-in-user');assert.equal(f.calls[0].codes.join(','),'2330');assert.ok(f.queryCalls.every(call=>call.value!=='another-user'));
});
test('portfolio-only permission cannot request non-held codes',async()=>{
 const f=fixture({overrides:[{user_id:'signed-in-user',feature_key:'ai_stock_picking',enabled:false},{user_id:'signed-in-user',feature_key:'ai_portfolio_advice',enabled:true}],holdings:[{stock_code:'2330',total_shares:100}]});
 assert.equal((await f.request('strategy-signals',{coids:'2330,2317'},{authorization:'Bearer valid-jwt'})).statusCode,403);assert.equal(f.calls.length,0);
 assert.equal((await f.request('strategy-signals',{coids:'2330'},{authorization:'Bearer valid-jwt'})).statusCode,200);assert.equal(f.calls[0].user,'signed-in-user');
 assert.ok(f.queryCalls.some(call=>call.table==='holdings'&&call.key==='user_id'&&call.value==='signed-in-user'));
});
test('warmup without configured cron secret refuses even a forged bearer',async()=>{
 const f=fixture();assert.equal((await f.request('warmup',{}, {authorization:'Bearer undefined'})).statusCode,401);assert.equal(f.calls.length,0);assert.equal(f.providers(),0);
});
test('official provider failure returns non-cacheable 502',async()=>{
 const f=fixture({priceFailure:true});const response=await f.request('official-stock-history',{coid:'2330'});
 assert.equal(response.statusCode,502);assert.equal(response.headers['Cache-Control'],'no-store, max-age=0');assert.equal(response.body.error,'official provider unavailable');
 const all=await f.request('official-prices');assert.equal(all.statusCode,502);assert.equal(all.headers['Cache-Control'],'no-store, max-age=0');assert.equal(f.providers(),2);
});
