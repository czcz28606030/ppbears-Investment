import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import * as fs from 'node:fs';
import { getWeeklyTop } from './src/server/weekly-top';
import { getStrategyPrices, getStrategyMarketMap } from './src/server/strategy-service';
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const retired = new Set(['ifalgo-stock','stock-trading-signals','stock-quant','stock-quant-history','stock-quant-snapshot','simons','simons-rec-counts','simons-institution-cost']);
function ppbearsDevApiPlugin(env:Record<string,string>):Plugin {
 return {name:'ppbears-dev-api',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  const url=new URL(req.url||'','http://127.0.0.1');const type=url.searchParams.get('type')||'';
  const send=(status:number,body:unknown)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));};
  if(url.pathname.startsWith('/api/ifalgo/')||url.pathname==='/api/stock-trading-signals'||(url.pathname==='/api/app-cache'&&retired.has(type)))return send(410,{error:'舊訊號來源已停用，請使用週榜趨勢訊號'});
  if(req.method!=='GET'||url.pathname!=='/api/app-cache')return next();
  try{
   if(type==='weekly-top')return send(200,await getWeeklyTop(env.STOXGAUGE_ACCESS_TOKEN));
   if(type==='strategy-prices'||type==='official-stock-history'||type==='official-stock'){
    const code=String(url.searchParams.get('coid')||'');const market=url.searchParams.get('market');
    if(!/^\d{4,6}$/.test(code)||(market&&market!=='listed'&&market!=='otc'))return send(400,{error:'Invalid stock code or market'});
    const prices=await getStrategyPrices(code,market as 'listed'|'otc'||undefined);
    if(type==='official-stock'){const map=await getStrategyMarketMap();return send(200,{stock:{coid:code,stkname:map[code]?.name||code,subindustry:'',status:map[code]?.market||'',prices}});}
    return send(200,{prices,source:'official-daily',latestDate:prices.at(-1)?.mdate||''});
   }
  }catch(error){return send(502,{error:error instanceof Error?error.message:'官方資料讀取失敗'});}
  return next();
 });}};
}
export default defineConfig(({mode})=>{
 const env=loadEnv(mode,process.cwd(),'');
 const productionProxy={target:'https://ppbears-investment.vercel.app',changeOrigin:true};
 return {plugins:[ppbearsDevApiPlugin(env),react()],define:{'import.meta.env.VITE_APP_VERSION':JSON.stringify(packageJson.version)},server:{proxy:{
  '/api/stock-analysis':productionProxy,'/api/institution-cost':productionProxy,'/api/send-newsletter-single':productionProxy,'/api/app-cache':productionProxy,'/api/cron-newsletter':productionProxy,
  '/api/twse':{target:'https://openapi.twse.com.tw/v1',changeOrigin:true,rewrite:path=>path.replace(/^\/api\/twse/,'')},
  '/api/twse-report':{target:'https://www.twse.com.tw/exchangeReport',changeOrigin:true,rewrite:path=>path.replace(/^\/api\/twse-report/,'')},
  '/api/tpex':{target:'https://www.tpex.org.tw/openapi/v1',changeOrigin:true,rewrite:path=>path.replace(/^\/api\/tpex/,'')},
  '/api/mis':{target:'https://mis.twse.com.tw/stock/api',changeOrigin:true,rewrite:path=>path.replace(/^\/api\/mis/,'')},
 }}};
});
