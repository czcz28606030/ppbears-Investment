import { createClient } from '@supabase/supabase-js';
import { evaluateTrendStrategy, STRATEGY_SOURCE, type StrategySignalsPayload } from '../utils/trendStrategy.js';
import type { PaperState } from '../utils/paperTrading.js';
export async function getPaperSignals(userId:string,codes:string[]):Promise<StrategySignalsPayload> {
  const db=createClient(process.env.VITE_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data:account,error}=await db.from('paper_trading_accounts').select('state,last_run_at').eq('user_id',userId).single();
  if(error||!account)throw new Error('模擬帳本暫時無法讀取');
  const state=account.state as PaperState;
  const {data:day,error:dayError}=await db.from('paper_trading_days').select('payload').eq('user_id',userId).order('record_date',{ascending:false}).limit(1).maybeSingle();
  if(dayError)throw new Error('模擬訊號紀錄讀取失敗');
  const saved=(day?.payload?.signals||{}) as StrategySignalsPayload['signals'];
  const signals:StrategySignalsPayload['signals']={};
  for(const code of codes) {
    signals[code]=saved[code]||{...evaluateTrendStrategy({code,bars:[],weeklyRank:null,weeklyDate:state.weeks.at(-1)?.weekEndDate||'',weeklyAvailable:false,nowDate:state.startDate,latestPriceDate:'',holding:null,trades:[],equity:state.initialCash,cash:state.cash,history:[]}),reason:'模擬帳號已啟用，等待啟用後的完整收盤資料；不回填舊訊號'};
  }
  return {source:STRATEGY_SOURCE,generatedAt:account.last_run_at||new Date().toISOString(),signals,journalStatus:'saved'};
}
