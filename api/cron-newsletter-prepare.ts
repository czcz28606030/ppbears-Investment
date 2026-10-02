import type { VercelRequest, VercelResponse } from '@vercel/node';
import {fetchWeeklyNewsletterCandidates, saveTodayCache, getTodayTW} from '../src/server/newsletter-utils.js';
import {collectWeeklyStrategySnapshot} from '../src/server/strategy-service.js';
export const config={maxDuration:60};
export default async function handler(req:VercelRequest,res:VercelResponse){
  if((!process.env.CRON_SECRET || req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`) && process.env.NODE_ENV==='production')return res.status(401).json({error:'Unauthorized'});
  try{
    const snapshot=await collectWeeklyStrategySnapshot();
    const stocks=await fetchWeeklyNewsletterCandidates();
    if(!stocks.length)return res.status(200).json({success:false,error:'週榜資料尚未備妥'});
    const date=getTodayTW();
    await saveTodayCache({cache_date:date,all_stocks:stocks,ai_filtered:[]});
    return res.status(200).json({success:true,message:`週榜電子報資料已備妥（${date}）`,stockCount:stocks.length,snapshot});
  }catch(error){return res.status(500).json({success:false,error:String(error)});}
}
