import type { VercelRequest, VercelResponse } from '@vercel/node';
import {createClient} from '@supabase/supabase-js';
import {collectWeeklyStrategySnapshot,getStrategyPrices} from '../src/server/strategy-service.js';
import {getWeeklyTop} from '../src/server/weekly-top.js';
export const config={maxDuration:300};
// Records real candidate snapshots and official OHLC only; no inferred historical signals.
export default async function handler(req:VercelRequest,res:VercelResponse){
  const secret=process.env.CRON_SECRET;
  if((secret && req.headers.authorization!==`Bearer ${secret}`)||(!secret && process.env.NODE_ENV==='production'))return res.status(401).json({error:'Unauthorized'});
  const db=createClient(process.env.VITE_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!);
  try{
    const snapshot=await collectWeeklyStrategySnapshot();
    const [weekly,holdings,watchlist]=await Promise.all([getWeeklyTop(),db.from('holdings').select('stock_code').limit(500),db.from('watchlist').select('stock_code').limit(500)]);
    if(holdings.error||watchlist.error)throw new Error(holdings.error?.message||watchlist.error?.message);
    const codes=[...new Set([...weekly.items.map(s=>s.ticker),...(holdings.data||[]).map(s=>s.stock_code),...(watchlist.data||[]).map(s=>s.stock_code)])].filter(code=>/^\d{4,6}$/.test(code));
    let collected=0;const failures:string[]=[];
    for(let offset=0;offset<codes.length;offset+=4){
      const batch=codes.slice(offset,offset+4);
      const results=await Promise.allSettled(batch.map(async code=>{
        const prices=await getStrategyPrices(code);
        if(!prices.length)throw new Error('官方行情資料不足');
        const rows=prices.map(p=>({coid:code,mdate:p.mdate,open_d:Number(p.open_d),high_d:Number(p.high_d),low_d:Number(p.low_d),close_d:Number(p.close_d),volume:p.volume}));
        const {error}=await db.from('stock_price_history').upsert(rows,{onConflict:'coid,mdate'});
        if(error)throw new Error(error.message);
      }));
      results.forEach((result,index)=>{
        if(result.status==='fulfilled')collected++;
        else failures.push(`${batch[index]}: ${String(result.reason)}`);
      });
    }
    return res.status(200).json({success:failures.length===0,source:'weekly-trend-v1',snapshot,targetCount:codes.length,collected,failures});
  }catch(error){return res.status(500).json({success:false,error:String(error)});}
}
