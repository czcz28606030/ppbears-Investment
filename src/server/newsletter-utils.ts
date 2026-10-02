import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getWeeklyTop } from './weekly-top.js';
import { getStrategySignalsForUser } from './strategy-service.js';
import type { StrategyDecision } from '../utils/trendStrategy.js';

export const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
export const resend = new Resend(process.env.RESEND_API_KEY);
// Legacy export names remain for callers during migration; values are weekly candidates only.
export interface SimonsItem {
  mdate: string; coid: string; stkname: string; close: string;
  weeklyRank?: number; source?: 'stoxgauge-weekly'; weeklyObservedAt?: string; firstObservedDate?: string;
}
export interface FilteredStock extends SimonsItem { remark: string; decision?: StrategyDecision }
export interface HoldingRow {
  stock_code: string; stock_name: string; total_shares: number; avg_cost: number;
  current_price: number; signal?: string; decision?: StrategyDecision;
}
export interface UserRow { id: string; email: string; display_name: string; newsletter_strategy?: string }
export const DAILY_NEWSLETTER_FEATURE_KEY = 'daily_newsletter';
export const STRATEGY_LABELS: Record<string, string> = { A: '週榜趨勢', B: '週榜趨勢', C: '週榜趨勢', D: '週榜趨勢', E: '週榜趨勢', F: '週榜趨勢' };
export const calculateScore = (_item: SimonsItem): null => null;
export async function fetchWeeklyNewsletterCandidates(): Promise<SimonsItem[]> {
  const weekly = await getWeeklyTop();
  const observedAt = new Date().toISOString();
  return weekly.items.map(item => ({ coid: item.ticker, stkname: item.name, mdate: item.weekEndDate,
    close: '', weeklyRank: item.rank, source: 'stoxgauge-weekly', weeklyObservedAt: observedAt,
    firstObservedDate: getTodayTW() }));
}
export const fetchLatestSimonsData = fetchWeeklyNewsletterCandidates;
export function filterByStrategy(stocks: SimonsItem[], _strategy: string): FilteredStock[] {
  return [...stocks].sort((a,b) => (a.weeklyRank ?? Infinity) - (b.weeklyRank ?? Infinity))
    .map(stock => ({ ...stock, remark: '週榜候選' }));
}
export async function filterByAI(stocks: SimonsItem[]): Promise<FilteredStock[]> { return filterByStrategy(stocks, ''); }
export async function generateStocksAnalysis(_stocks: FilteredStock[]): Promise<void> { /* Rule decisions are rendered directly. */ }
export async function buildHoldingsWithSignals(userId: string, _allStockCoids: Set<string>): Promise<HoldingRow[]> {
  const { data, error } = await supabase.from('holdings')
    .select('stock_code, stock_name, total_shares, avg_cost, current_price').eq('user_id', userId);
  if (error) throw new Error(error.message);
  if (!data?.length) return [];
  const { signals } = await getStrategySignalsForUser(userId, data.map(h => h.stock_code));
  return data.map(h => ({ ...h, total_shares: Number(h.total_shares), avg_cost: Number(h.avg_cost),
    current_price: Number(h.current_price), signal: signals[h.stock_code]?.label ?? '資料不足', decision: signals[h.stock_code] }));
}
export function escapeNewsletterHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]!));
}
function decisionHtml(decision?: StrategyDecision): string {
  const escape = escapeNewsletterHtml;
  if (!decision) return '<p>資料不足：尚未取得規則狀態</p>';
  return `<p><strong>${escape(decision.label)}</strong>：${escape(decision.reason)}</p>
    <p>價格日期：${escape(decision.dataDate || '無')} ｜收盤：${escape(decision.close ?? '無')}
    ｜保護線：${escape(decision.protectionPrice ?? '無')} ｜建議新增股數：${escape(decision.suggestedQuantity ?? '無')}</p>`;
}
export function buildEmailHtml(recipientName: string, stocks: FilteredStock[], holdings: HoldingRow[], todayDate: string, _strategyLabel?: string): string {
  const escape = escapeNewsletterHtml;
  const stockHtml = stocks.map(s => `<article style="border:1px solid #eee;padding:16px;margin-bottom:12px">
    <h3>${escape(s.coid)} ${escape(s.stkname)}</h3><p>週榜第 ${escape(s.weeklyRank ?? '無')} 名 · 週期 ${escape(s.mdate)}</p>${decisionHtml(s.decision)}</article>`).join('');
  const holdingsHtml = holdings.map(h => `<article style="border:1px solid #eee;padding:16px;margin-bottom:12px">
    <h3>${escape(h.stock_code)} ${escape(h.stock_name)}</h3>${decisionHtml(h.decision)}</article>`).join('');
  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>PPBears 每日投資電子報 ${escape(todayDate)}</title></head>
    <body style="font-family:sans-serif;background:#fafafa"><main style="max-width:600px;margin:auto;padding:24px;background:white">
    <h1>🐻 PPBears 每日投資電子報</h1><p>嗨 ${escape(recipientName)}！資料準備時間：${escape(getNewsletterDataLabelTW(todayDate))}</p>
    <h2>週榜候選與趨勢規則</h2><p>週榜只定義候選池；上榜不等於進場或加碼。既有電子報偏好保留，訊號統一依週榜趨勢規則計算。</p>
    ${stockHtml}${holdings.length ? `<h2>個人持倉規則狀態</h2>${holdingsHtml}` : ''}
    <p>持倉決策依實際交易、現金及風險限制計算；資料不足時停止加碼。收盤規則不代替即時委託，平台不自動下單。</p>
    <a href="https://ppbears-investment.vercel.app">進入平台查看詳情</a><p>可於平台調整每日電子報偏好。以上資訊僅供學習參考。</p></main></body></html>`;
}
async function userHasFeature(userId: string, tier: string, key: string): Promise<boolean> {
  const { data, error } = await supabase.from('feature_overrides').select('enabled').eq('user_id', userId).eq('feature_key', key).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? Boolean(data.enabled) : tier === 'premium';
}
export const userHasAiFeature = (userId: string, tier: string) => userHasFeature(userId, tier, 'ai_stock_picking');
export const userHasNewsletterFeature = (userId: string, tier: string) => userHasFeature(userId, tier, DAILY_NEWSLETTER_FEATURE_KEY);
export async function sendNewsletterToUser(user: UserRow & {tier:string}, allStocks: SimonsItem[], _cache: FilteredStock[] | null, todayDate: string): Promise<{success:boolean;error?:string}> {
  try {
    if (!await userHasNewsletterFeature(user.id, user.tier)) return {success:false,error:'此帳號的每日電子報已關閉'};
    const candidates = allStocks.filter(s => s.source === 'stoxgauge-weekly');
    if (!candidates.length) return {success:false,error:'週榜候選資料尚未備妥'};
    const {signals} = await getStrategySignalsForUser(user.id, candidates.map(s => s.coid));
    const stocks = filterByStrategy(candidates, user.newsletter_strategy || '').map(s => ({...s, decision: signals[s.coid]}));
    const holdings = await buildHoldingsWithSignals(user.id, new Set(candidates.map(s => s.coid)));
    const {error} = await resend.emails.send({ from:'PPBears Investment <newsletter@investment.ppbears.com>', to:user.email,
      subject:`🐻 PPBears 電子報 ${todayDate} ｜週榜趨勢 ${stocks.length} 檔`, html:buildEmailHtml(user.display_name, stocks, holdings, todayDate) });
    return error ? {success:false,error:error.message} : {success:true};
  } catch (error) { return {success:false,error:String(error)}; }
}
export interface NewsletterCache { cache_date:string; all_stocks:SimonsItem[]; ai_filtered:FilteredStock[]; created_at?:string }
export function getTodayTW(): string { return new Date(Date.now()+8*3600000).toISOString().slice(0,10); }
export function getLatestCompletedTradingDateTW(now=Date.now()): string {
  const day=new Date(now+8*3600000); day.setUTCHours(0,0,0,0); day.setUTCDate(day.getUTCDate()-1);
  while ([0,6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate()-1);
  return day.toISOString().slice(0,10);
}
export function normalizeSimonsDate(value:unknown):string {
  const raw=String(value??'').trim(); return /^\d{8}$/.test(raw) ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}` : raw.slice(0,10).replace(/\//g,'-');
}
export function getSimonsItemDataDate(items:SimonsItem[]):string {return normalizeSimonsDate(items[0]?.mdate);}
export function isSimonsDataReadyForDate(items:SimonsItem[], date:string):boolean {return !!items.length && getSimonsItemDataDate(items)===date;}
// Retired date-specific source: never backfill historical candidate eligibility using today's weekly list.
export async function fetchSimonsDataForDate(_date:string):Promise<SimonsItem[]> {return [];}
export function getNewsletterCacheDateTW(now=Date.now()):string {
  const day=new Date(now+8*3600000); if(day.getUTCHours()<8)day.setUTCDate(day.getUTCDate()-1);return day.toISOString().slice(0,10);
}
export function getNewsletterDataLabelTW(date:string):string {return `${date} 08:00 台灣時間`;}
export async function saveTodayCache(data:NewsletterCache):Promise<void> {
  const {data: existing, error: readError} = await supabase.from('newsletter_daily_cache')
    .select('all_stocks,created_at').eq('cache_date', data.cache_date).maybeSingle();
  if (readError) throw new Error(readError.message);
  const previous = new Map<string, SimonsItem>((existing?.all_stocks || []).map((item: SimonsItem) => [`${item.mdate}:${item.coid}`, item]));
  const allStocks = data.all_stocks.map(item => {
    const prior = previous.get(`${item.mdate}:${item.coid}`);
    return prior?.source === 'stoxgauge-weekly' && prior.weeklyObservedAt
      ? {...item, weeklyObservedAt: prior.weeklyObservedAt, firstObservedDate: prior.firstObservedDate ?? item.firstObservedDate}
      : item;
  });
  const {error}=await supabase.from('newsletter_daily_cache').upsert({...data, all_stocks: allStocks,
    ai_filtered:[], created_at:data.created_at ?? existing?.created_at ?? new Date().toISOString()}, {onConflict:'cache_date'});
  if(error)throw new Error(error.message);
}
export async function loadTodayCache(date=getNewsletterCacheDateTW()):Promise<NewsletterCache|null> {
  const {data,error}=await supabase.from('newsletter_daily_cache').select('cache_date,all_stocks,ai_filtered,created_at').eq('cache_date',date).maybeSingle();
  if(error||!data||!Array.isArray(data.all_stocks)||!data.all_stocks.length||data.all_stocks.some((s:SimonsItem)=>s.source!=='stoxgauge-weekly'||!s.weeklyObservedAt))return null;
  return {...data,ai_filtered:[]} as NewsletterCache;
}
