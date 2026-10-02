import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateTrendStrategy,type StrategyInput,type StrategyBar} from './trendStrategy.ts';
function fixture(count=85):StrategyInput {
 const bars:StrategyBar[]=Array.from({length:count},(_,i)=>({date:new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10),open:100+i*.1,high:102+i*.1,low:98+i*.1,close:100+i*.1,volume:1000}));
 return {code:'2330',bars,weeklyRank:1,weeklyDate:bars.at(-1)!.date,weeklyAvailable:true,nowDate:bars.at(-1)!.date,latestPriceDate:bars.at(-1)!.date,holding:{quantity:100,avgCost:106},trades:[{date:bars[65].date,type:'buy',quantity:100,price:106}],equity:1000000,cash:1000000,history:[{availableDate:bars[64].date,weekEndDate:bars[64].date,codes:['2330']}]};
}
function closeAt(input:StrategyInput,index:number,close:number,range=2){Object.assign(input.bars[index],{open:close,close,high:close+range,low:close-range});}
function breakout(){const input=fixture();closeAt(input,84,130);return input;}
test('actual same-day add consumes breakout event and cannot recommend a second add',()=>{
 const input=breakout();const before=evaluateTrendStrategy(input);assert.equal(before.action,'add');
 input.trades.push({date:input.nowDate,type:'buy',quantity:10,price:130});input.holding={quantity:110,avgCost:108.2};
 const after=evaluateTrendStrategy(input);assert.notEqual(after.action,'add');assert.equal(after.suggestedQuantity,0);
});
test('holding peak and exit before MA60 warmup are reconstructed from ATR history',()=>{
 const input=fixture();input.trades=[{date:input.bars[20].date,type:'buy',quantity:100,price:102}];input.holding={quantity:100,avgCost:102};
 closeAt(input,30,120);closeAt(input,31,103);
 const decision=evaluateTrendStrategy(input);assert.equal(decision.action,'exit');
 assert.ok(decision.events.some(event=>event.action==='exit'&&event.date===input.bars[31].date));assert.ok(decision.protectionPrice!>103);
});
test('full actual exit then re-entry establishes a new R and new first quantity',()=>{
 const input=fixture();const original=evaluateTrendStrategy(input);
 for(let i=73;i<=77;i++)closeAt(input,i,input.bars[i].close,5);
 input.trades.push({date:input.bars[70].date,type:'sell',quantity:100,price:107},{date:input.bars[78].date,type:'buy',quantity:40,price:108});
 input.holding={quantity:40,avgCost:108};const reentry=evaluateTrendStrategy(input);
 assert.ok(reentry.initialRisk!>original.initialRisk!);assert.ok(Math.abs(reentry.addTriggerPrice!-(108+2*reentry.initialRisk!))<0.0002);
});
test('additional buys keep original 2R baseline and trailing protection never falls with ATR',()=>{
 const input=fixture();const before=evaluateTrendStrategy({...input,bars:input.bars.slice(0,80),nowDate:input.bars[79].date,latestPriceDate:input.bars[79].date});
 input.trades.push({date:input.bars[78].date,type:'buy',quantity:10,price:110});input.holding={quantity:110,avgCost:106.4};
 for(let i=80;i<85;i++)closeAt(input,i,110,10);
 const after=evaluateTrendStrategy(input);assert.equal(after.initialRisk,before.initialRisk);assert.equal(after.addTriggerPrice,126);
 assert.ok(after.protectionPrice!>=before.protectionPrice!);
});
test('two-day MA20 reduction re-arms after reclaim and a real prior reduction',()=>{
 const input=fixture(75);closeAt(input,70,100);closeAt(input,71,100);closeAt(input,72,110);closeAt(input,73,100);closeAt(input,74,100);
 input.trades.push({date:input.bars[72].date,type:'sell',quantity:50,price:110});input.holding={quantity:50,avgCost:106};
 const decision=evaluateTrendStrategy(input);assert.equal(decision.action,'reduce');assert.equal(decision.suggestedQuantity,25);
 assert.deepEqual(decision.events.filter(event=>event.action==='reduce').map(event=>event.date),[input.bars[71].date,input.bars[74].date]);
});
test('add respects exact first-size and cash bounds and whole-position risk ceiling',()=>{
 const input=breakout();const full=evaluateTrendStrategy(input);assert.equal(full.action,'add');assert.equal(full.suggestedQuantity,75);
 const limited=evaluateTrendStrategy({...input,cash:130*1.002*12});assert.equal(limited.action,'add');assert.equal(limited.suggestedQuantity,12);
 const riskLimited=evaluateTrendStrategy({...input,equity:500000});
 assert.ok((100+riskLimited.suggestedQuantity)*(130-riskLimited.protectionPrice!)<=500000*.005+1e-6);
 assert.ok((100+riskLimited.suggestedQuantity)*130<=500000*.2);
 const noCash=evaluateTrendStrategy({...input,cash:0});assert.notEqual(noCash.action,'add');assert.equal(noCash.suggestedQuantity,0);
});
test('profit below original 2R and two actual adds both prevent further additions',()=>{
 const input=breakout();closeAt(input,84,125);assert.equal(evaluateTrendStrategy(input).action,'hold');
 closeAt(input,84,130);input.trades.push({date:input.bars[70].date,type:'buy',quantity:10,price:110},{date:input.bars[78].date,type:'buy',quantity:10,price:115});
 input.holding={quantity:120,avgCost:107.1};const decision=evaluateTrendStrategy(input);
 assert.equal(decision.action,'hold');assert.equal(decision.addTriggerPrice,126);assert.equal(decision.suggestedQuantity,0);
});
test('first entry outside official warmup history cannot invent initial risk',()=>{
 const input=breakout();input.trades=[{date:'2026-05-01',type:'buy',quantity:100,price:99}];input.holding={quantity:100,avgCost:99};
 const decision=evaluateTrendStrategy(input);assert.equal(decision.action,'unavailable');assert.equal(decision.initialRisk,null);assert.equal(decision.suggestedQuantity,0);
});
test('historical profitable breakouts cannot manufacture add arrows without historical budgets',()=>{
 const input=fixture();closeAt(input,83,130);closeAt(input,84,131);
 const decision=evaluateTrendStrategy(input);assert.equal(decision.events.filter(event=>event.action==='add').length,0);
 const noMembership=evaluateTrendStrategy({...breakout(),history:[]});assert.equal(noMembership.events.filter(event=>event.action==='add').length,0);
});


