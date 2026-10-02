import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function fixture({enabled=true,cache=null}={}) {
  const sent=[];const calls=[];const writes=[];
  const query={select(){return this;},eq(){return this;},maybeSingle:async()=>({data:cache}),upsert:async row=>{writes.push(row);return {error:null};}};
  const db={from(table){if(table==='feature_overrides')return {...query,maybeSingle:async()=>({data:{enabled}})};
    if(table==='holdings')return {...query,eq:async()=>({data:[]})};return query;}};
  const decision={label:'資料不足 <script>',reason:'缺少交易 & 現金',dataDate:'2026-10-01',close:123,protectionPrice:null,suggestedQuantity:0};
  const dependencies={ '@supabase/supabase-js':{createClient:()=>db},resend:{Resend:class{emails={send:async mail=>{sent.push(mail);return {error:null};}}}},
    './weekly-top.js':{getWeeklyTop:async()=>({items:[{ticker:'2330',name:'台積電',rank:1,weekEndDate:'2026-09-25'}]})},
    './strategy-service.js':{getStrategySignalsForUser:async(user,codes)=>{calls.push({user,codes});return {signals:{2330:decision}};}}};
  const compiled=ts.transpileModule(readFileSync(new URL('./newsletter-utils.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};new Function('require','exports',compiled)(name=>dependencies[name],exports);
  return {exports,sent,calls,writes};
}
test('weekly candidates never imply a buy and legacy historical lookup never backfills',async()=>{
  const {exports:u}=fixture();const candidates=await u.fetchWeeklyNewsletterCandidates();
  assert.equal(candidates[0].weeklyRank,1);assert.equal(candidates[0].close,'');
  assert.ok(Date.now()-Date.parse(candidates[0].weeklyObservedAt)<1000);
  assert.equal(u.calculateScore(candidates[0]),null);
  assert.deepEqual(await u.fetchSimonsDataForDate('2020-01-01'),[]);
});
test('preparation preserves first weekly observation and explicit creation time',async()=>{
  const original={coid:'2330',mdate:'2026-09-25',source:'stoxgauge-weekly',weeklyObservedAt:'2026-10-01T01:00:00Z',firstObservedDate:'2026-10-01'};
  const {exports:u,writes}=fixture({cache:{all_stocks:[original],created_at:'2026-10-01T01:00:00Z'}});
  await u.saveTodayCache({cache_date:'2026-10-02',all_stocks:await u.fetchWeeklyNewsletterCandidates(),ai_filtered:[],created_at:'2026-10-02T00:00:00Z'});
  assert.equal(writes[0].all_stocks[0].weeklyObservedAt,original.weeklyObservedAt);
  assert.equal(writes[0].all_stocks[0].firstObservedDate,'2026-10-01');
  assert.equal(writes[0].created_at,'2026-10-02T00:00:00Z');
  assert.equal(writes[0].cache_date,'2026-10-02');
});
test('old cache is rejected and email opt-out prevents delivery',async()=>{
  const {exports:u,sent,calls}=fixture({enabled:false,cache:{all_stocks:[{coid:'2330'}]}});
  assert.equal(await u.loadTodayCache('2026-10-02'),null);
  const result=await u.sendNewsletterToUser({id:'user-1',tier:'premium',email:'test@example.invalid',display_name:'Test'},await u.fetchWeeklyNewsletterCandidates(),null,'2026-10-02');
  assert.equal(result.success,false);assert.equal(sent.length,0);assert.equal(calls.length,0);
});
test('delivery uses personal decisions and escapes all external HTML',async()=>{
  const {exports:u,sent,calls}=fixture();
  const candidates=await u.fetchWeeklyNewsletterCandidates();candidates[0].stkname='<img src=x>';
  await u.sendNewsletterToUser({id:'user-2',tier:'premium',email:'test@example.invalid',display_name:'<script>'},candidates,null,'2026-10-02');
  assert.deepEqual(calls[0],{user:'user-2',codes:['2330']});assert.equal(sent.length,1);
  assert.ok(sent[0].html.includes('&lt;img src=x&gt;'));assert.ok(sent[0].html.includes('&lt;script&gt;'));
  assert.ok(sent[0].html.includes('缺少交易 &amp; 現金'));assert.ok(!sent[0].html.includes('報酬趨勢'));
});
