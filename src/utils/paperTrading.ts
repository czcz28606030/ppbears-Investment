// Frozen copy: live strategy changes must not silently change a running year's experiment.
import { evaluateTrendStrategy, STRATEGY_SOURCE, type StrategyBar, type StrategyDecision, type WeeklyMembership } from './paperTrendStrategyV1.js';

export type PaperWatch = { code: string; name: string; addedDate: string; addedPrice: number; rank: number };
export type PaperPosition = { code: string; name: string; quantity: number; avgCost: number; costBasis: number; currentPrice: number };
export type PaperTrade = { id: string; code: string; name: string; date: string; signalDate: string; action: 'entry'|'add'|'reduce'|'exit'; type: 'buy'|'sell'; quantity: number; price: number; fee: number; tax: number; totalAmount: number; profit: number | null; timestamp: number; reason: string };
export type PaperOrder = { id: string; code: string; name: string; signalDate: string; action: PaperTrade['action']; quantity: number; atr: number; protection: number | null; reason: string };
export type PaperDividendEvent={code:string;exDate:string;payDate:string;perShare:number};
export type PaperDividend=PaperDividendEvent & {id:string;quantity:number;amount:number;benchmarkAmount:number;paid:boolean};
export type PaperState = {
  source: typeof STRATEGY_SOURCE; startDate: string; endDate: string; status: 'active'|'completed'; initialCash: number; cash: number;
  config: { feeRate: number; minFee: number; taxRate: number; slippage: number; riskPct: number; weightPct: number };
  watchlist: PaperWatch[]; positions: PaperPosition[]; trades: PaperTrade[]; orders: PaperOrder[];
  dividendEvents:PaperDividendEvent[];dividends:PaperDividend[];
  weeks: Array<WeeklyMembership & { observedDate: string; items: Array<{code:string;name:string;rank:number}> }>;
  lastProcessedDate: string | null; peakEquity: number; maxDrawdownPct: number; benchmark: { units: number; cash: number; startDate: string } | null;
};
export type PaperInput = { observedDate: string; availableDate: string; completedDate: string; weekly: { date: string; items: Array<{code:string;name:string;rank:number}> } | null; prices: Record<string,StrategyBar[]>;dividends?:PaperDividendEvent[];dividendWarnings?:string[] };
export type PaperDailyRecord = { date: string; cash: number; equity: number; returnPct: number; maxDrawdownPct: number; benchmarkEquity: number | null; positions: PaperPosition[]; signals: Record<string,StrategyDecision>; trades: PaperTrade[]; orders: PaperOrder[]; warnings: string[] };
const money = (n:number) => Math.round(n*100)/100;
export const nextPaperCalendarDate = (date:string) => new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
export function createPaperState(date:string, cash=1000000): PaperState {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(cash>0)) throw new Error('Invalid paper account start');
  const end = new Date(`${date}T00:00:00Z`); end.setUTCFullYear(end.getUTCFullYear()+1);
  return {source:STRATEGY_SOURCE,startDate:date,endDate:end.toISOString().slice(0,10),status:'active',initialCash:cash,cash,
    config:{feeRate:.001425,minFee:20,taxRate:.003,slippage:.001,riskPct:.005,weightPct:.2},
    watchlist:[],positions:[],trades:[],orders:[],weeks:[],dividendEvents:[],dividends:[],lastProcessedDate:null,peakEquity:cash,maxDrawdownPct:0,benchmark:null};
}
function memberAt(state:PaperState,date:string) {
  return state.weeks.filter(w=>w.availableDate<=date && w.weekEndDate<=date).sort((a,b)=>a.availableDate.localeCompare(b.availableDate)||a.observedDate.localeCompare(b.observedDate)).at(-1);
}
export function paperReceivables(state:PaperState) {return (state.dividends||[]).filter(d=>!d.paid).reduce((sum,d)=>sum+d.amount,0);}
function markEquity(state:PaperState) {return state.cash+state.positions.reduce((sum,p)=>sum+p.quantity*p.currentPrice,0)+paperReceivables(state);}
function settleDividends(state:PaperState,date:string) {
  for(const event of state.dividendEvents) {
    if(event.exDate>date||event.exDate<state.startDate||event.exDate>=state.endDate)continue;
    const id=`${event.code}:${event.exDate}`;
    if(state.dividends.some(d=>d.id===id))continue;
    const quantity=state.trades.filter(t=>t.code===event.code&&t.date<event.exDate).reduce((sum,t)=>sum+(t.type==='buy'?t.quantity:-t.quantity),0);
    const benchmarkQuantity=event.code==='0050'&&state.benchmark&&state.benchmark.startDate<event.exDate?state.benchmark.units:0;
    if(quantity>0||benchmarkQuantity>0)state.dividends.push({...event,id,quantity,amount:money(quantity*event.perShare),benchmarkAmount:money(benchmarkQuantity*event.perShare),paid:false});
  }
  for(const dividend of state.dividends) {
    if(dividend.paid||dividend.payDate>date)continue;
    state.cash=money(state.cash+dividend.amount);
    if(state.benchmark)state.benchmark.cash=money(state.benchmark.cash+dividend.benchmarkAmount);
    dividend.paid=true;
  }
}
function fee(state:PaperState, gross:number) {return money(Math.max(state.config.minFee,gross*state.config.feeRate));}
function budgetQuantity(state:PaperState, price:number, risk:number, position:PaperPosition|undefined, maximum:number) {
  const equity=markEquity(state); const held=position?.quantity||0;
  const byRisk=risk>0?Math.floor(equity*state.config.riskPct/risk-held):0;
  const byWeight=Math.floor(equity*state.config.weightPct/price-held);
  const byCash=Math.floor(Math.max(0,state.cash-state.config.minFee)/(price*(1+state.config.feeRate)));
  return Math.max(0,Math.min(byRisk,byWeight,byCash,maximum));
}

/** Daily OHLC opens execute prior orders; closes create future orders. No retrospective fills. */
export function advancePaperTrading(original:PaperState,input:PaperInput): {state:PaperState;records:PaperDailyRecord[]} {
  const state:PaperState=structuredClone(original);const records:PaperDailyRecord[]=[];
  if (state.status==='completed') return {state,records};
  if (state.source!==STRATEGY_SOURCE) throw new Error('策略版本不符，暫停模擬');
  for(const event of input.dividends||[]) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(event.exDate)||!/^\d{4}-\d{2}-\d{2}$/.test(event.payDate)||event.payDate<event.exDate||!(event.perShare>0))continue;
    if(!state.dividendEvents.some(d=>d.code===event.code&&d.exDate===event.exDate))state.dividendEvents.push({...event});
  }
  if(input.weekly && input.observedDate>=state.startDate && input.observedDate<state.endDate) {
    const last=state.weeks.at(-1);
    if(!last || last.weekEndDate!==input.weekly.date || JSON.stringify(last.items)!==JSON.stringify(input.weekly.items)) {
      state.weeks.push({observedDate:input.observedDate,availableDate:input.availableDate,weekEndDate:input.weekly.date,codes:input.weekly.items.map(i=>i.code),items:structuredClone(input.weekly.items)});
    }
    for(const item of input.weekly.items) {
      const existing=state.watchlist.find(w=>w.code===item.code);
      if(existing){existing.rank=item.rank;continue;}
      const price=input.prices[item.code]?.filter(b=>b.date<=input.observedDate).at(-1)?.close||0;
      state.watchlist.push({...item,addedDate:input.observedDate,addedPrice:price});
    }
  }
  const dates=(input.prices['0050']||[]).map(b=>b.date).filter(date=>date>=state.startDate && date>(state.lastProcessedDate||'') && date<=input.completedDate && date<state.endDate).sort();
  for(const date of [...new Set(dates)]) {
    const warnings:string[]=[...(input.dividendWarnings||[])];const dailyTrades:PaperTrade[]=[];
    settleDividends(state,date);
    const eligible=memberAt(state,date);
    const pending:PaperOrder[]=[];
    const orders=[...state.orders].sort((a,b)=>(['exit','reduce'].includes(a.action)?0:1)-(['exit','reduce'].includes(b.action)?0:1)||a.id.localeCompare(b.id));
    for(const order of orders) {
      if(order.signalDate>=date){pending.push(order);continue;}
      const bar=input.prices[order.code]?.find(b=>b.date===date);
      if(!bar || !Number.isFinite(bar.open) || bar.open<=0 || bar.volume<=0){pending.push(order);warnings.push(`${order.code} 缺少有效開盤價或停牌，委託等待`);continue;}
      if(state.trades.some(t=>t.id===order.id))continue;
      const position=state.positions.find(p=>p.code===order.code);
      const buy=order.action==='entry'||order.action==='add';
      const price=Number((bar.open*(1+(buy?1:-1)*state.config.slippage)).toFixed(6));
      let quantity=Math.min(order.quantity, buy?order.quantity:position?.quantity||0);
      if(buy) {
        const membership=memberAt(state,order.signalDate);
        if(!membership?.codes.includes(order.code) || (Date.parse(date)-Date.parse(membership.weekEndDate))/86400000>14){warnings.push(`${order.code} 週榜資格過期，取消買入`);continue;}
        const risk=order.action==='entry'?order.atr*2.5:price-(order.protection||0);
        if(order.action==='add' && (!position || !(price>position.avgCost))){warnings.push(`${order.code} 開盤不再獲利，取消加碼`);continue;}
        if(order.action==='entry' && position){warnings.push(`${order.code} 已有部位，取消重複進場`);continue;}
        quantity=budgetQuantity(state,price,risk,position,quantity);
      }
      if(quantity<=0){warnings.push(`${order.code} 資金、風險或庫存不足，未成交`);continue;}
      const gross=money(quantity*price);const commission=fee(state,gross);const tax=buy?0:money(gross*state.config.taxRate);
      const totalAmount=money(buy?gross+commission:gross-commission-tax);
      if(buy && totalAmount>state.cash){warnings.push(`${order.code} 可用現金不足，未成交`);continue;}
      const profit=buy?null:money(totalAmount-(position!.costBasis/position!.quantity)*quantity);
      const trade:PaperTrade={id:order.id,code:order.code,name:order.name,date,signalDate:order.signalDate,action:order.action,type:buy?'buy':'sell',quantity,price,fee:commission,tax,totalAmount,profit,timestamp:Date.parse(`${date}T09:00:00+08:00`),reason:order.reason};
      state.cash=money(state.cash+(buy?-totalAmount:totalAmount));
      if(buy) {
        if(position){position.avgCost=(position.avgCost*position.quantity+price*quantity)/(position.quantity+quantity);position.costBasis+=totalAmount;position.quantity+=quantity;position.currentPrice=price;}
        else state.positions.push({code:order.code,name:order.name,quantity,avgCost:price,costBasis:totalAmount,currentPrice:price});
      } else {
        position!.costBasis=money(position!.costBasis*(position!.quantity-quantity)/position!.quantity);position!.quantity-=quantity;
        state.positions=state.positions.filter(p=>p.quantity>0);
      }
      state.trades.push(trade);dailyTrades.push(trade);
    }
    state.orders=pending;
    for(const p of state.positions) {
      const bar=input.prices[p.code]?.find(b=>b.date===date);
      if(bar)p.currentPrice=bar.close;else warnings.push(`${p.code} 缺少當日收盤價，資產採前次價格`);
    }
    const benchmarkBar=input.prices['0050'].find(b=>b.date===date)!;
    if(!state.benchmark) {
      const price=benchmarkBar.open*(1+state.config.slippage);
      const units=Math.floor((state.initialCash-state.config.minFee)/(price*(1+state.config.feeRate)));
      state.benchmark={units,cash:money(state.initialCash-units*price-fee(state,units*price)),startDate:date};
    }
    const equity=money(markEquity(state));
    const signals:Record<string,StrategyDecision>={};
    const codes=[...new Set([...(eligible?.codes||[]).filter(code=>state.watchlist.some(w=>w.code===code&&w.addedDate<=date)),...state.positions.map(p=>p.code)])];
    for(const code of codes) {
      const position=state.positions.find(p=>p.code===code);
      const bars=(input.prices[code]||[]).filter(b=>b.date<=date);
      const weeklyItem=eligible?.items.find(i=>i.code===code);
      const decision=evaluateTrendStrategy({code,bars,weeklyRank:weeklyItem?.rank??null,weeklyDate:eligible?.weekEndDate||'',weeklyAvailable:Boolean(eligible),nowDate:date,latestPriceDate:date,
        holding:position?{quantity:position.quantity,avgCost:position.avgCost}:null,
        trades:state.trades.filter(t=>t.code===code).map(t=>({date:t.date,type:t.type,quantity:t.quantity,price:t.price,timestamp:t.timestamp})),cash:state.cash,equity,history:state.weeks});
      signals[code]=decision;
      if(decision.status!=='ready'){warnings.push(`${code} ${decision.reason}`);continue;}
      if(!['entry','add','reduce','exit'].includes(decision.action) || state.orders.some(o=>o.code===code))continue;
      const action=decision.action as PaperOrder['action'];
      const quantity=action==='entry'?budgetQuantity(state,decision.close!,(decision.atr||0)*2.5,undefined,Number.MAX_SAFE_INTEGER):decision.suggestedQuantity;
      if(quantity<=0){warnings.push(`${code} ${decision.label}觸發，但額度不足，未建立委託`);continue;}
      const watch=state.watchlist.find(w=>w.code===code);
      state.orders.push({id:`paper:${date}:${code}:${action}`,code,name:position?.name||watch?.name||code,signalDate:date,action,quantity,atr:decision.atr||0,protection:decision.protectionPrice,reason:decision.reason});
      if(action==='entry')decision.suggestedQuantity=quantity;
    }
    state.peakEquity=Math.max(state.peakEquity,equity);
    state.maxDrawdownPct=Math.max(state.maxDrawdownPct,(1-equity/state.peakEquity)*100);
    state.lastProcessedDate=date;
    const benchmarkReceivables=state.dividends.filter(d=>!d.paid).reduce((sum,d)=>sum+d.benchmarkAmount,0);
    records.push({date,cash:state.cash,equity,returnPct:(equity/state.initialCash-1)*100,maxDrawdownPct:state.maxDrawdownPct,benchmarkEquity:money(state.benchmark.cash+state.benchmark.units*benchmarkBar.close+benchmarkReceivables),positions:structuredClone(state.positions),signals,trades:dailyTrades,orders:structuredClone(state.orders),warnings});
  }
  if(input.observedDate<state.endDate)settleDividends(state,input.observedDate);
  if(input.observedDate>=state.endDate){state.status='completed';state.orders=[];}
  return {state,records};
}
