import type {PaperDividendEvent} from '../utils/paperTrading.js';
// Same published dividend detail source used by the existing dividend service.
export async function fetchPaperDividends(codes:string[]) {
  const events:PaperDividendEvent[]=[];const warnings:string[]=[];
  for(let offset=0;offset<codes.length;offset+=4)await Promise.all(codes.slice(offset,offset+4).map(async code=>{
    let fetched=false;let recognized=false;
    for(const market of ['TW','TWO']) {
      try {
        const res=await fetch(`https://tw.stock.yahoo.com/quote/${code}.${market}/dividend`,{signal:AbortSignal.timeout(10000)});
        if(!res.ok)continue;const html=await res.text();fetched=true;
        const match=html.match(/"latestDividend":\{"year":"[^"]*","period":"[^"]*","isUpcoming":(?:true|false),"exDividend":\{"cash":"([^"]*)","cashPayDate":"([^"]*)","cashPayYear":"[^"]*","date":"([^"]*)"/);
        if(match) {
          recognized=true;
          const event={code,perShare:Number(match[1]),payDate:match[2].slice(0,10),exDate:match[3].slice(0,10)};
          if(event.perShare>0&&/^\d{4}-\d{2}-\d{2}$/.test(event.exDate)&&/^\d{4}-\d{2}-\d{2}$/.test(event.payDate))events.push(event);
          else if(event.perShare>0)warnings.push(`${code} 股利日期不完整，未估算或提前入帳`);
          break;
        }
        if(html.includes('"latestDividend":null'))recognized=true;
      }catch{ /* retain known entitlements; no invented dividends */ }
    }
    if(!fetched)warnings.push(`${code} 現金股利來源暫時無法核對`);
    else if(!recognized)warnings.push(`${code} 股利資料格式無法確認，等待來源核對`);
  }));
  return {events,warnings};
}
