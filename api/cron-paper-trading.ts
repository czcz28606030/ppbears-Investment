import type {VercelRequest,VercelResponse} from '@vercel/node';
import {runPaperTrading} from '../src/server/paper-trading-service.js';
export const config={maxDuration:300};
export default async function handler(req:VercelRequest,res:VercelResponse) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'&&req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const secret=process.env.CRON_SECRET;
  if(!secret||req.headers.authorization!==`Bearer ${secret}`)return res.status(401).json({error:'Unauthorized'});
  try {const result=await runPaperTrading();return res.status(result.success?200:503).json(result);}
  catch(e){console.error('[paper-trading]',e instanceof Error?e.message:'failed');return res.status(500).json({success:false,error:'模擬執行失敗，請檢查服務端紀錄'});}
}
