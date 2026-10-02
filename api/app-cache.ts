import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import handleInstitutionCost from '../src/server/institution-cost.js';
import { getStrategySignalsForUser, getStrategyPrices, getStrategyMarketMap, getStrategyWeekly, collectWeeklyStrategySnapshot } from '../src/server/strategy-service.js';
import { buildAndSaveUserMarketCaches } from '../src/server/user-market-cache.js';
import handlePaperTrading from '../src/server/paper-trading-handler.js';
export const config = { maxDuration: 300 };
const RETIRED = new Set(['ifalgo-stock','stock-trading-signals','stock-quant','stock-quant-history','stock-quant-snapshot','simons','simons-rec-counts','simons-institution-cost']);
const todayTaipei = () => new Date(Date.now()+8*3600000).toISOString().slice(0,10);
function daysAgoTaipei(days:number) { return new Date(Date.now()+8*3600000-days*86400000).toISOString().slice(0,10); }
function getAdminClient() { return createClient(process.env.VITE_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}}); }
function parseMarketNumber(value:unknown):number {const n=Number(String(value??'').replace(/[,%+]/g,''));return Number.isFinite(n)?n:0;}
function parseNumericOrNull(value:unknown):number|null {if(value==null||value===''||value==='NA')return null;const n=Number(String(value).replace(/,/g,''));return Number.isFinite(n)?n:null;}
function clampMarketValue(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}
function normalizeIsoSignalDate(value:unknown):string {const raw=String(value??'').replace(/\//g,'-');return /^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`:raw.slice(0,10);}
function normalizeActiveEtfAction(value:unknown):ActiveEtfAction {const raw=String(value||'').toLowerCase();return raw==='added'||raw==='new'?'added':raw==='increased'||raw==='increase'?'increased':raw==='decreased'||raw==='decrease'?'decreased':raw==='removed'||raw==='remove'?'removed':'held';}

type AccountRow = {id:string;role:string;parent_id:string|null;tier:string;is_admin:boolean;subscription_expires_at:string|null;paper_trading_enabled?:boolean};
function premium(row:AccountRow|null){return !!row&&(row.is_admin||(row.tier==='premium'&&(!row.subscription_expires_at||new Date(row.subscription_expires_at)>new Date())));}
async function strategyAccess(req:VercelRequest) {
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token)return null;
  const client=getAdminClient();const {data,error}=await client.auth.getUser(token);
  if(error||!data.user)return null;
  const {data:account,error:accountError}=await client.from('users').select('id,role,parent_id,tier,is_admin,subscription_expires_at,paper_trading_enabled').eq('id',data.user.id).single<AccountRow>();
  if(accountError||!account)throw new Error('無法讀取帳戶權限');
  const ids=[account.id,...(account.role==='child'&&account.parent_id?[account.parent_id]:[])];
  const {data:overrides,error:overrideError}=await client.from('feature_overrides').select('user_id,feature_key,enabled').in('user_id',ids).in('feature_key',['ai_stock_picking','ai_portfolio_advice']);
  if(overrideError)throw new Error('無法確認訊號權限');
  const parent=ids.length>1?(await client.from('users').select('id,role,parent_id,tier,is_admin,subscription_expires_at').eq('id',account.parent_id!).maybeSingle<AccountRow>()).data:null;
  const allowed=(key:string)=>{if(account.is_admin)return true;const own=overrides?.find(o=>o.user_id===account.id&&o.feature_key===key);if(own)return Boolean(own.enabled);if(premium(account))return true;const inherited=overrides?.find(o=>o.user_id===parent?.id&&o.feature_key===key);return inherited?Boolean(inherited.enabled):premium(parent);};
  return {id:account.id,paper:Boolean(account.paper_trading_enabled),picking:Boolean(account.paper_trading_enabled)||allowed('ai_stock_picking'),portfolio:Boolean(account.paper_trading_enabled)||allowed('ai_portfolio_advice')};
}
type ActiveEtfAction = 'added' | 'increased' | 'decreased' | 'removed' | 'held';
type ActiveEtfRadarItem = {
  coid: string;
  stockName: string | null;
  signal: 'bullish' | 'watch' | 'neutral' | 'bearish';
  score: number;
  days: number;
  fromDate: string;
  latestDate: string | null;
  holdingEtfCount: number;
  addedEtfCount: number;
  increasedEtfCount: number;
  decreasedEtfCount: number;
  removedEtfCount: number;
  netWeightChangePct: number;
  etfs: Array<{
    etfCode: string;
    etfName: string;
    action: ActiveEtfAction;
    weightPct: number | null;
    previousWeightPct: number | null;
    weightChangePct: number | null;
    shares: number | null;
    previousShares: number | null;
    shareChange: number | null;
  }>;
  source: string;
};


function getActiveEtfSignal(score: number): ActiveEtfRadarItem['signal'] {
  if (score >= 68) return 'bullish';
  if (score >= 52) return 'watch';
  if (score <= 35) return 'bearish';
  return 'neutral';
}

function buildActiveEtfRadarItem(coid: string, rows: any[], days: number, fromDate: string): ActiveEtfRadarItem {
  let stockName: string | null = null;
  let latestDate: string | null = null;
  let addedEtfCount = 0;
  let increasedEtfCount = 0;
  let decreasedEtfCount = 0;
  let removedEtfCount = 0;
  let netWeightChangePct = 0;
  const latestByEtf = new Map<string, ActiveEtfRadarItem['etfs'][number]>();
  const activeHoldingEtfs = new Set<string>();

  const sortedRows = [...rows].sort((a, b) => String(a.flow_date || '').localeCompare(String(b.flow_date || '')));
  for (const row of sortedRows) {
    const action = normalizeActiveEtfAction(row.action);
    const etfCode = String(row.etf_code || '').trim();
    if (!etfCode) continue;
    const flowDate = String(row.flow_date || '');
    if (flowDate && (!latestDate || flowDate > latestDate)) latestDate = flowDate;
    if (!stockName && row.stkname) stockName = String(row.stkname);

    const weightChangePct = parseNumericOrNull(row.weight_change_pct);
    const weightPct = parseNumericOrNull(row.weight_pct);
    const previousWeightPct = parseNumericOrNull(row.previous_weight_pct);
    const shares = parseNumericOrNull(row.shares);
    const previousShares = parseNumericOrNull(row.previous_shares);
    const shareChange = parseNumericOrNull(row.share_change);
    if (weightChangePct !== null) netWeightChangePct += weightChangePct;

    if (action === 'added') addedEtfCount += 1;
    if (action === 'increased') increasedEtfCount += 1;
    if (action === 'decreased') decreasedEtfCount += 1;
    if (action === 'removed') removedEtfCount += 1;

    if (action === 'removed') activeHoldingEtfs.delete(etfCode);
    else activeHoldingEtfs.add(etfCode);

    latestByEtf.set(etfCode, {
      etfCode,
      etfName: String(row.etf_name || etfCode),
      action,
      weightPct,
      previousWeightPct,
      weightChangePct,
      shares,
      previousShares,
      shareChange,
    });
  }

  const rawScore = 50
    + addedEtfCount * 16
    + increasedEtfCount * 8
    - decreasedEtfCount * 7
    - removedEtfCount * 16
    + netWeightChangePct * 10
    + activeHoldingEtfs.size * 2;
  const score = Math.round(clampMarketValue(rawScore, 0, 100));
  const etfs = [...latestByEtf.values()]
    .sort((a, b) => {
      const priority: Record<ActiveEtfAction, number> = { added: 5, increased: 4, held: 3, decreased: 2, removed: 1 };
      return priority[b.action] - priority[a.action];
    })
    .slice(0, 8);

  return {
    coid,
    stockName,
    signal: getActiveEtfSignal(score),
    score,
    days,
    fromDate,
    latestDate,
    holdingEtfCount: activeHoldingEtfs.size,
    addedEtfCount,
    increasedEtfCount,
    decreasedEtfCount,
    removedEtfCount,
    netWeightChangePct: Number(netWeightChangePct.toFixed(3)),
    etfs,
    source: 'active_etf_stock_flows',
  };
}

async function getActiveEtfRadar(coids: string[], days: number): Promise<{
  days: number;
  fromDate: string;
  items: Record<string, ActiveEtfRadarItem>;
  source: string;
}> {
  const uniqueCoids = [...new Set(coids.map(coid => coid.trim()).filter(coid => /^\d{4,6}$/.test(coid)))].slice(0, 200);
  const boundedDays = Math.max(1, Math.min(20, days || 5));
  const fromDate = daysAgoTaipei(boundedDays);
  const items: Record<string, ActiveEtfRadarItem> = {};

  if (uniqueCoids.length === 0) return { days: boundedDays, fromDate, items, source: 'active_etf_stock_flows' };

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { days: boundedDays, fromDate, items, source: 'active_etf_stock_flows' };

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from('active_etf_stock_flows')
    .select('flow_date,etf_code,etf_name,coid,stkname,action,weight_pct,previous_weight_pct,weight_change_pct,shares,previous_shares,share_change')
    .in('coid', uniqueCoids)
    .gte('flow_date', fromDate)
    .order('flow_date', { ascending: false });

  if (error) {
    console.warn('getActiveEtfRadar error:', error.message);
    return { days: boundedDays, fromDate, items, source: 'active_etf_stock_flows' };
  }

  const rowsByCoid = new Map<string, any[]>();
  for (const row of data || []) {
    const coid = String((row as { coid?: unknown }).coid || '');
    if (!coid) continue;
    const rows = rowsByCoid.get(coid) || [];
    rows.push(row);
    rowsByCoid.set(coid, rows);
  }

  for (const coid of uniqueCoids) {
    const rows = rowsByCoid.get(coid) || [];
    if (rows.length > 0) items[coid] = buildActiveEtfRadarItem(coid, rows, boundedDays, fromDate);
  }

  return { days: boundedDays, fromDate, items, source: 'active_etf_stock_flows' };
}


export default async function handler(req:VercelRequest,res:VercelResponse) {
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const type=String(req.query.type||'warmup');
 res.setHeader('Cache-Control','no-store, max-age=0');
 if(RETIRED.has(type))return res.status(410).json({error:'舊 IFAlgo 訊號來源已停用，請更新頁面使用週榜趨勢訊號',source:'retired',items:[],signals:[]});
 try {
  if(type==='paper-trading-run')return await handlePaperTrading(req,res);
  if(type==='institution-cost')return await handleInstitutionCost(req,res);
  if(type==='weekly-top'){res.setHeader('Cache-Control','s-maxage=3600');return res.status(200).json(await getStrategyWeekly());}
  if(type==='strategy-signals') {
   const access=await strategyAccess(req);if(!access)return res.status(401).json({error:'請先登入會員帳號'});
   if(!access.picking&&!access.portfolio)return res.status(403).json({error:'此帳號尚未開啟策略訊號功能'});
   let codes=[...new Set(String(req.query.coids||req.query.coid||'').split(',').filter(Boolean))];
   if(!codes.length||codes.length>60||codes.some(code=>!/^\d{4,6}$/.test(code)))return res.status(400).json({error:'股票代號格式或數量不正確'});
   if(!access.picking) {
    const {data,error}=await getAdminClient().from('holdings').select('stock_code,total_shares').eq('user_id',access.id).in('stock_code',codes);
    if(error)throw new Error('無法確認持倉權限');
    const held=new Set((data||[]).filter(h=>Number(h.total_shares)>0).map(h=>h.stock_code));
    if(codes.some(code=>!held.has(code)))return res.status(403).json({error:'此帳號僅能查看已持倉的策略訊號'});
   }
   return res.status(200).json(await getStrategySignalsForUser(access.id,codes));
  }
  if(type==='strategy-prices'||type==='official-stock-history'||type==='official-stock') {
   const code=String(req.query.coid||'');const market=String(req.query.market||'');
   if(!/^\d{4,6}$/.test(code)||(market&&market!=='listed'&&market!=='otc'))return res.status(400).json({error:'Invalid stock code or market'});
   const prices=await getStrategyPrices(code,market as 'listed'|'otc'||undefined);
   if(type==='official-stock'){const map=await getStrategyMarketMap();return res.status(200).json({stock:{coid:code,stkname:map[code]?.name||code,subindustry:'',status:map[code]?.market||'',prices}});}
   res.setHeader('Cache-Control','s-maxage=900');
   return res.status(200).json({coid:code,prices,latestDate:prices.at(-1)?.mdate||'',source:'official-daily',generatedAt:new Date().toISOString()});
  }
  if(type==='official-prices') {
   const map = await getStrategyMarketMap();
   const prices = Object.fromEntries(Object.entries(map).map(([code, quote]) => [code, {
    name: quote.name, close: String(quote.close), change: quote.change,
    volume: Math.floor(quote.volume), date: quote.date.replace(/-/g, ''), market: quote.market,
   }]));
   if (!Object.keys(prices).length) throw new Error('官方行情暫時無法取得');
   res.setHeader('Cache-Control', 's-maxage=300');
   return res.status(200).json({ cacheDate: todayTaipei(), count: Object.keys(prices).length, prices });
  }
  if(type==='active-etf-radar'){res.setHeader('Cache-Control','s-maxage=1800');const codes=String(req.query.coids||'').split(',').filter(c=>/^\d{4,6}$/.test(c));return res.status(200).json(await getActiveEtfRadar(codes,Number(req.query.days||5)));}
  if(type==='home-summary')return res.status(503).json({error:'舊市場預測來源已停用；個股改採週榜趨勢規則',source:'unavailable'});
  if(type==='ai-cache-version'){const weekly=await getStrategyWeekly();return res.status(200).json({version:`weekly-trend-v1:${weekly.weekEndDate}`,source:'weekly-trend-v1',generatedAt:new Date().toISOString()});}
  if(type==='user-market-cache'){
   const access=await strategyAccess(req);if(!access)return res.status(401).json({error:'Unauthorized'});
   if(access.paper)return res.status(404).json({error:'paper account uses immutable simulation journal'});
   const surface=String(req.query.surface||'');if(!['watchlist','portfolio'].includes(surface))return res.status(400).json({error:'Invalid surface'});
   if(surface==='watchlist'?!access.picking:!access.portfolio)return res.status(403).json({error:'Feature unavailable'});
   const {data,error}=await getAdminClient().from('user_market_daily_cache').select('*').eq('user_id',access.id).eq('surface',surface).eq('cache_date',todayTaipei()).maybeSingle();
   if(error)throw new Error('快取讀取失敗');if(!data||data.payload?.source!=='weekly-trend-v1')return res.status(404).json({error:'cache miss'});return res.status(200).json({cache:data});
  }
  if(type==='warmup'){
   const secret=process.env.CRON_SECRET;if(!secret||req.headers.authorization!==`Bearer ${secret}`)return res.status(401).json({error:'Unauthorized'});
   const snapshot=await collectWeeklyStrategySnapshot();const warmed=await buildAndSaveUserMarketCaches(req);return res.status(200).json({success:true,source:'weekly-trend-v1',snapshot,warmed});
  }
  return res.status(400).json({error:'Unknown cache type'});
 }catch(error){res.setHeader('Cache-Control','no-store, max-age=0');return res.status(502).json({error:error instanceof Error?error.message:'資料來源暫時無法取得'});}
}
