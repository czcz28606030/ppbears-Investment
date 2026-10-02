// Run only after the schema and application are deployed. Uses existing local-only credentials.
import fs from 'node:fs';
import pg from 'pg';
import {createPaperState,advancePaperTrading} from '../src/utils/paperTrading.ts';
if(!process.argv.includes('--activate'))throw Error('Explicit --activate is required');
const targetId='f591c5a8-2645-4b6f-afb9-c2ffb1f556dc';const email='till@ppbears.com';
const initial=JSON.parse(fs.readFileSync('.qa.local/paper-initial-weekly.json','utf8'));
const observed=new Date(Date.parse(initial.observedAt)+8*3600000);const date=observed.toISOString().slice(0,10);
if(date!=='2026-10-02')throw Error('Initial observation date must match authorized start');
const quotes=await fetch('https://ppbears-investment.vercel.app/api/app-cache?type=official-prices').then(r=>{if(!r.ok)throw Error('Quotes unavailable');return r.json();});
const prices=Object.fromEntries(initial.weekly.items.map(i=>{const q=quotes.prices[i.ticker];const close=Number(q?.close||0);const d=String(q?.date||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');return [i.ticker,close>0?[{date:d,open:close,high:close,low:close,close,volume:1}]:[]];}));
// Initial quote references seed the watchlist only; no synthetic OHLC is archived or evaluated.
const minutes=observed.getUTCHours()*60+observed.getUTCMinutes();
const state=advancePaperTrading(createPaperState(date),{observedDate:date,availableDate:minutes<13*60+30?date:'2026-10-03',completedDate:'2026-10-01',weekly:{date:initial.weekly.weekEndDate,items:initial.weekly.items.map(i=>({code:i.ticker,name:i.name,rank:i.rank}))},prices}).state;
const c=JSON.parse(fs.readFileSync('.qa.local/paper-db-credentials.local','utf8').replace(/^\uFEFF/,''));
const db=new pg.Client({host:c.PGHOST,port:Number(c.PGPORT),user:c.PGUSER,password:c.PGPASSWORD,database:c.PGDATABASE,ssl:{rejectUnauthorized:true,ca:fs.readFileSync('.qa.local/supabase-ca.crt','utf8')}});
await db.connect();await db.query('SET ROLE postgres');
const fingerprint=async()=>{
  const result={};
  for(const [table,key] of [['users','id'],['holdings','user_id'],['trades','user_id'],['watchlist','user_id'],['dividend_payments','user_id'],['withdrawal_requests','child_id']]) {
    result[table]=(await db.query(`select count(*)::int as count,md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) as fingerprint from public.${table} t where ${key}<>$1`,[targetId])).rows[0];
  }return result;
};
try {
  await db.query('BEGIN');
  const user=(await db.query('select id,email,display_name from public.users where id=$1 for update',[targetId])).rows[0];
  if(user?.email!==email||user?.display_name!=='小熊熊')throw Error('Target identity mismatch');
  if((await db.query('select 1 from public.paper_trading_accounts where user_id=$1',[targetId])).rowCount)throw Error('Paper account already exists; refusing reset');
  const before=await fingerprint();const deleted={};
  for(const [table,key] of [['dividend_payments','user_id'],['withdrawal_requests','child_id'],['holdings','user_id'],['trades','user_id'],['watchlist','user_id'],['user_market_daily_cache','user_id']])deleted[table]=(await db.query(`delete from public.${table} where ${key}=$1`,[targetId])).rowCount;
  await db.query('update public.users set available_balance=1000000,initial_balance=1000000,paper_trading_enabled=true where id=$1',[targetId]);
  await db.query('insert into public.paper_trading_accounts(user_id,state) values($1,$2::jsonb)',[targetId,JSON.stringify(state)]);
  const after=await fingerprint();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Another account changed; rolling back');
  await db.query('COMMIT');
  console.log(JSON.stringify({activated:true,account:user.display_name,email,start:state.startDate,end:state.endDate,cash:state.cash,holdings:state.positions.length,weeklyCandidates:state.watchlist.length,observedAt:initial.observedAt,deleted,otherAccountsUnchanged:true}));
} catch(e) {await db.query('ROLLBACK');throw e;} finally {await db.end();}
