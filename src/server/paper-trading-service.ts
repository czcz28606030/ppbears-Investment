import { createClient } from '@supabase/supabase-js';
import { getStrategyPrices, getStrategyWeekly, getStrategyMarketMap } from './strategy-service.js';
import { advancePaperTrading, nextPaperCalendarDate, type PaperState } from '../utils/paperTrading.js';
import type { StrategyBar } from '../utils/trendStrategy.js';
import {fetchPaperDividends} from './paper-dividends.js';
export async function runPaperTrading() {
  const db=createClient(process.env.VITE_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data:accounts,error}=await db.from('paper_trading_accounts').select('user_id,revision,state');
  if(error)throw new Error(error.message);
  const local=new Date(Date.now()+8*3600000);const today=local.toISOString().slice(0,10);
  const minutes=local.getUTCHours()*60+local.getUTCMinutes();
  const completed=minutes>=14*60?today:new Date(local.getTime()-86400000).toISOString().slice(0,10);
  const [weeklyResult,mapResult]=await Promise.allSettled([getStrategyWeekly(),getStrategyMarketMap()]);
  const weekly=weeklyResult.status==='fulfilled'?weeklyResult.value:null;
  const map=mapResult.status==='fulfilled'?mapResult.value:{};
  const results:Array<{userId:string;success:boolean;processed:number;trades:number;observed:number;error?:string}>=[];
  for(const row of accounts||[]) {
    const state=row.state as PaperState;
    if(state.status!=='active')continue;
    try {
      const latestCodes=state.weeks.at(-1)?.codes||[];
      const codes=[...new Set(['0050',...(weekly?.items.map(i=>i.ticker)||latestCodes),...state.positions.map(p=>p.code),...state.orders.map(o=>o.code)])];
      const prices:Record<string,StrategyBar[]>={};
      for(let start=0;start<codes.length;start+=4) {
        const batch=await Promise.all(codes.slice(start,start+4).map(async code=>{
          const rows=await getStrategyPrices(code,map[code]?.market);
          if(!rows.length)throw new Error(`${code} 官方行情不足，暫停本次模擬並等待重試`);
          const bars=rows.filter(p=>p.mdate<=completed).map(p=>({date:p.mdate,open:Number(p.open_d),high:Number(p.high_d),low:Number(p.low_d),close:Number(p.close_d),volume:Number(p.volume)}));
          const {error:priceSaveError}=await db.from('paper_trading_prices').upsert(bars.map(bar=>({user_id:row.user_id,code,price_date:bar.date,bar})),{onConflict:'user_id,code,price_date',ignoreDuplicates:true});
          if(priceSaveError)throw new Error(`${code} 日K觀測保存失敗`);
          const archived:StrategyBar[]=[];
          for(let offset=0;;offset+=1000){
            const {data:history,error:historyError}=await db.from('paper_trading_prices').select('bar').eq('user_id',row.user_id).eq('code',code).lte('price_date',completed).order('price_date',{ascending:true}).range(offset,offset+999);
            if(historyError)throw new Error(`${code} 日K觀測讀取失敗`);
            archived.push(...(history||[]).map(h=>h.bar as StrategyBar));if(!history||history.length<1000)break;
          }
          prices[code]=archived;
        }));void batch;
      }
      const dividends=await fetchPaperDividends([...new Set(['0050',...state.positions.map(p=>p.code)])]);
      const result=advancePaperTrading(state,{observedDate:today,availableDate:minutes>=13*60+30?nextPaperCalendarDate(today):today,completedDate:completed,
        weekly:weekly?{date:weekly.weekEndDate,items:weekly.items.map(i=>({code:i.ticker,name:i.name,rank:i.rank}))}:null,prices,dividends:dividends.events,dividendWarnings:dividends.warnings});
      const {error:commitError}=await db.rpc('commit_paper_trading',{p_user_id:row.user_id,p_revision:row.revision,p_state:result.state,p_records:result.records});
      if(commitError)throw new Error(commitError.message);
      results.push({userId:row.user_id,success:true,processed:result.records.length,trades:result.state.trades.length-state.trades.length,observed:result.state.watchlist.length});
    } catch(e) {
      const error=e instanceof Error?e.message:'模擬執行失敗';
      if(!error.includes('paper_revision_conflict')) await db.from('paper_trading_accounts').update({last_run_at:new Date().toISOString(),last_error:error}).eq('user_id',row.user_id);
      results.push({userId:row.user_id,success:false,processed:0,trades:0,observed:state.watchlist.length,error});
    }
  }
  return {success:results.every(r=>r.success),date:today,completedDate:completed,accounts:results};
}
