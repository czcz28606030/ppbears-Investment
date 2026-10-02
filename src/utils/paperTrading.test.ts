import test from 'node:test';
import assert from 'node:assert/strict';
import { createPaperState, advancePaperTrading, type PaperInput } from './paperTrading.ts';
import type { StrategyBar } from './trendStrategy.ts';

const bars = (): StrategyBar[] => Array.from({ length: 85 }, (_, i) => ({ date: new Date(Date.UTC(2026, 6, 10 + i)).toISOString().slice(0, 10), open: 100 + i * .1, high: 102 + i * .1, low: 98 + i * .1, close: 100 + i * .1, volume: 1000 }));
function fixture() {
  const prices = bars();
  prices.at(-1)!.close = 115; prices.at(-1)!.high = 116;
  const date = prices.at(-1)!.date;
  const state = createPaperState(date, 1000000);
  const input: PaperInput = { observedDate: date, availableDate: date, completedDate: date, weekly: { date, items: [{ code: '2308', name: '台達電', rank: 1 }] }, prices: { '2308': prices, '0050': structuredClone(prices) } };
  return { state, input, date };
}
test('start day records all weekly candidates but never fills on signal close', () => {
  const {state,input,date} = fixture(); const result = advancePaperTrading(state,input);
  assert.equal(result.state.watchlist.length,1);
  assert.equal(result.state.trades.length,0);
  assert.equal(result.state.orders.length,1);
  assert.equal(result.records[0].signals['2308'].action,'entry');
  assert.equal(result.state.orders[0].signalDate,date);
});
test('next session open fills with costs, repeated execution is idempotent', () => {
  const {state,input,date} = fixture(); const first = advancePaperTrading(state,input);
  const next = new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
  for (const code of Object.keys(input.prices)) input.prices[code].push({date:next,open:116,high:119,low:115,close:118,volume:1000});
  input.observedDate=next; input.completedDate=next;
  const second=advancePaperTrading(first.state,input);
  assert.equal(second.state.trades.length,1);
  const trade=second.state.trades[0];
  assert.equal(trade.date,next); assert.equal(trade.price,116.116);
  assert.ok(trade.fee>=20); assert.equal(trade.tax,0);
  assert.equal(second.state.cash,Math.round((1000000-trade.totalAmount)*100)/100);
  assert.ok(trade.quantity*trade.price<=1000000*.2);
  const repeated=advancePaperTrading(second.state,input);
  assert.deepEqual(repeated.state,second.state); assert.equal(repeated.records.length,0);
});
test('first observation does not backfill old breakouts or after-close weekly eligibility', () => {
  const {state,input,date}=fixture(); input.availableDate=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
  assert.equal(advancePaperTrading(state,input).state.orders.length,0);
  input.completedDate=new Date(Date.parse(date)-86400000).toISOString().slice(0,10);
  const result=advancePaperTrading(state,input);
  assert.equal(result.records.length,0); assert.equal(result.state.trades.length,0);
  assert.equal(result.state.watchlist.length,1);
});
test('missing quote leaves an order pending and cannot invent a fill', () => {
  const {state,input,date}=fixture(); const first=advancePaperTrading(state,input);
  const next=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
  input.prices['0050'].push({date:next,open:116,high:119,low:115,close:118,volume:1000});
  input.observedDate=next; input.completedDate=next;
  const result=advancePaperTrading(first.state,input);
  assert.equal(result.state.trades.length,0); assert.equal(result.state.orders.length,1);
  assert.ok(result.records[0].warnings.some(s=>s.includes('2308')));
});
test('removed weekly candidate cannot produce a new buy and end date stops execution', () => {
  const {state,input,date}=fixture(); const first=advancePaperTrading(state,input);
  input.weekly={date,items:[]}; input.availableDate=date;
  // A new observation with the same week can replace its membership, but remains audited.
  const next=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
  input.observedDate=next;input.availableDate=next;input.completedDate=next;
  input.prices['2308'].push({date:next,open:116,high:119,low:115,close:118,volume:1000});
  input.prices['0050'].push({date:next,open:116,high:119,low:115,close:118,volume:1000});
  first.state.endDate=next;
  const result=advancePaperTrading(first.state,input);
  assert.equal(result.state.trades.length,0);assert.equal(result.state.status,'completed');
});
test('cash dividends accrue only for pre-ex-date shares and pay once on the actual pay date', () => {
  const {state,input,date}=fixture();const first=advancePaperTrading(state,input);
  const next=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
  for(const code of Object.keys(input.prices))input.prices[code].push({date:next,open:116,high:119,low:115,close:118,volume:1000});
  input.observedDate=next;input.completedDate=next;
  input.dividends=[{code:'2308',exDate:next,payDate:next,perShare:2}];
  const bought=advancePaperTrading(first.state,input);assert.equal(bought.state.dividends.length,0);
  const ex=new Date(Date.parse(next)+86400000).toISOString().slice(0,10);
  const pay=new Date(Date.parse(ex)+86400000).toISOString().slice(0,10);
  for(const code of Object.keys(input.prices))input.prices[code].push({date:ex,open:116,high:119,low:115,close:118,volume:1000});
  input.dividends=[{code:'2308',exDate:ex,payDate:pay,perShare:2}];input.observedDate=ex;input.completedDate=ex;
  const accrued=advancePaperTrading(bought.state,input);assert.equal(accrued.state.dividends.length,1);
  const entitlement=accrued.state.dividends[0];assert.equal(entitlement.amount,bought.state.positions[0].quantity*2);
  assert.equal(accrued.state.cash,bought.state.cash);
  assert.equal(accrued.records[0].equity,Math.round((accrued.state.cash+accrued.state.positions[0].quantity*118+entitlement.amount)*100)/100);
  input.observedDate=pay;input.completedDate=pay;
  const paid=advancePaperTrading(accrued.state,input);assert.equal(paid.state.cash,Math.round((accrued.state.cash+entitlement.amount)*100)/100);
  assert.equal(paid.state.dividends[0].paid,true);
  assert.equal(advancePaperTrading(paid.state,input).state.cash,paid.state.cash);
});
function nextSession(input:PaperInput,close:number,open=close) {
  const date=new Date(Date.parse(input.completedDate)+86400000).toISOString().slice(0,10);
  input.observedDate=date;input.completedDate=date;
  for(const code of Object.keys(input.prices))input.prices[code].push({date,open,high:Math.max(open,close)+1,low:Math.min(open,close)-1,close,volume:1000});
  return date;
}
test('exit signal liquidates on next open and charges sale tax and both-side fees',()=>{
  const {state,input}=fixture();let result=advancePaperTrading(state,input);
  nextSession(input,118,116);result=advancePaperTrading(result.state,input);
  nextSession(input,90,100);result=advancePaperTrading(result.state,input);
  assert.equal(result.state.orders[0].action,'exit');assert.equal(result.state.trades.length,1);
  const sellDate=nextSession(input,88,85);result=advancePaperTrading(result.state,input);
  const sell=result.state.trades[1];assert.equal(sell.action,'exit');assert.equal(sell.date,sellDate);
  assert.equal(result.state.positions.length,0);assert.ok(sell.tax>0);assert.ok(sell.fee>=20);assert.ok(sell.profit!<0);
  assert.equal(result.state.cash,Math.round((1000000+sell.profit!)*100)/100);
});
test('two-day MA20 reduction sells half once and does not repeatedly halve a continuing decline',()=>{
  const {state,input}=fixture();let result=advancePaperTrading(state,input);
  nextSession(input,118,116);result=advancePaperTrading(result.state,input);
  const quantity=result.state.positions[0].quantity;
  nextSession(input,107,110);result=advancePaperTrading(result.state,input);
  nextSession(input,106,107);result=advancePaperTrading(result.state,input);
  assert.equal(result.state.orders[0].action,'reduce');
  nextSession(input,106,107);result=advancePaperTrading(result.state,input);
  assert.equal(result.state.trades[1].quantity,Math.ceil(quantity/2));
  assert.equal(result.state.positions[0].quantity,Math.floor(quantity/2));
  assert.equal(result.state.orders.filter(o=>o.action==='reduce').length,0);
});
test('qualified 2R re-breakout creates an add capped at 75% of first purchase',()=>{
  const {state,input}=fixture();let result=advancePaperTrading(state,input);
  nextSession(input,118,116);result=advancePaperTrading(result.state,input);
  const trade=result.state.trades[0];trade.quantity=40;trade.totalAmount=Math.round((40*trade.price+20)*100)/100;trade.fee=20;
  result.state.positions[0].quantity=40;result.state.positions[0].costBasis=trade.totalAmount;result.state.cash=1000000-trade.totalAmount;
  nextSession(input,117,118);result=advancePaperTrading(result.state,input);
  nextSession(input,146,120);result=advancePaperTrading(result.state,input);
  assert.equal(result.state.orders[0].action,'add');assert.equal(result.state.orders[0].quantity,30);
  nextSession(input,149,148);result=advancePaperTrading(result.state,input);
  assert.equal(result.state.trades[1].action,'add');assert.equal(result.state.positions[0].quantity,70);
  assert.equal(result.state.orders.filter(o=>o.action==='add').length,0);
});
