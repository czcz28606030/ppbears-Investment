import {useEffect,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {supabase} from '../supabase';
import {useStore,formatMoney} from '../store';
import type {PaperState,PaperDailyRecord} from '../utils/paperTrading';
import {paperReceivables} from '../utils/paperTrading';
import '../components/PaperTradingBanner.css';
export default function PaperTrading() {
  const {user}=useStore();const [params]=useSearchParams();const accountId=params.get('account')||user?.id;
  const [account,setAccount]=useState<{state:PaperState;last_run_at:string|null;last_error:string|null}|null>(null);
  const [days,setDays]=useState<PaperDailyRecord[]>([]);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
  const [loadedId,setLoadedId]=useState<string|undefined>();
  useEffect(()=>{let active=true;
    async function load(){
      if(!supabase||!accountId)throw new Error('請先登入');
      const [a,d]=await Promise.all([supabase.from('paper_trading_accounts').select('state,last_run_at,last_error').eq('user_id',accountId).maybeSingle(),supabase.from('paper_trading_days').select('payload').eq('user_id',accountId).order('record_date',{ascending:true}).limit(400)]);
      if(a.error||d.error)throw new Error('模擬紀錄讀取失敗');if(!a.data)throw new Error('此帳號沒有可查看的模擬測試');
      if(active){setError('');setAccount(a.data);setDays((d.data||[]).map(r=>r.payload as PaperDailyRecord));}
    }void load().catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active){setLoading(false);setLoadedId(accountId);}});return()=>{active=false};
  },[accountId]);
  if(loading||loadedId!==accountId)return <p>正在讀取模擬帳本…</p>;if(error||!account)return <p role="alert">{error}</p>;
  const s=account.state;const latest=days.at(-1);const equity=s.cash+s.positions.reduce((sum,p)=>sum+p.quantity*p.currentPrice,0)+paperReceivables(s);
  const months=new Map<string,PaperDailyRecord>();for(const d of days)months.set(d.date.slice(0,7),d);
  const sales=s.trades.filter(t=>t.type==='sell');const fees=s.trades.reduce((sum,t)=>sum+t.fee+t.tax,0);
  return <div className="paper-report"><h1>🧸 一年自動模擬績效</h1><p>{s.startDate} 至 {s.endDate}｜{s.status==='completed'?'測試已結束':'測試進行中'}<br/>每週候選自動觀察，收盤訊號建立委託，下一有效交易日開盤模擬成交；每日18:30保存結果。</p>
    {account.last_error&&<p role="alert" className="paper-error">最近執行未完成：{account.last_error}</p>}
    <div className="paper-stats">{[['起始資金',`NT$ ${formatMoney(s.initialCash)}`],['目前總資產',`NT$ ${formatMoney(equity)}`],['總報酬',`${((equity/s.initialCash-1)*100).toFixed(2)}%`],['最大回撤',`${s.maxDrawdownPct.toFixed(2)}%`],['模擬成交',`${s.trades.length} 筆`],['交易費用與稅',`NT$ ${formatMoney(fees)}`]].map(([label,value])=><div className="paper-stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <p>可用現金 NT$ {formatMoney(s.cash)}｜持股 {s.positions.length} 檔｜待成交委託 {s.orders.length} 筆<br/>最近收盤：{s.lastProcessedDate||'等待啟用後第一個完整收盤'}｜累計觀察 {s.watchlist.length} 檔｜賣出紀錄 {sales.length} 筆<br/>現金股利：已入帳 NT$ {formatMoney(s.dividends.filter(d=>d.paid).reduce((sum,d)=>sum+d.amount,0))}，應收 NT$ {formatMoney(paperReceivables(s))}</p>
    <h2>每月累積績效</h2><div className="paper-table-wrap"><table><thead><tr><th>月份／截至</th><th>總資產</th><th>策略報酬</th><th>0050報酬</th><th>最大回撤</th></tr></thead><tbody>{[...months.entries()].map(([month,d])=><tr key={month}><td>{d.date}</td><td>{formatMoney(d.equity)}</td><td>{d.returnPct.toFixed(2)}%</td><td>{d.benchmarkEquity===null?'—':`${((d.benchmarkEquity/s.initialCash-1)*100).toFixed(2)}%`}</td><td>{d.maxDrawdownPct.toFixed(2)}%</td></tr>)}</tbody></table>{!days.length&&<p>帳號已啟用，首日收盤紀錄完成後會顯示績效。</p>}</div>
    <details><summary>固定交易規則與成本</summary><p>策略 weekly-trend-v1；每筆風險0.5%、單檔20%上限。手續費0.1425%，最低20元；賣出證交稅0.3%；單邊滑價0.1%。以整股模擬零股交易，開盤價是統一的成交模型，並非真實撮合。到期停止交易，剩餘部位採最後收盤估值。</p><p className="paper-note">報酬包含未實現損益、交易成本及已核對現金股利（除息前持股取得資格，實際發放日入帳；不含個人所得稅與補充保費）。0050採相同資金、買入成本與現金股利計算。股利來源未核對、股票分割或減資尚未調整時，紀錄會顯示警告，這些期間的績效需要核對後再解讀。</p></details>
    <details open><summary>最新每日訊號與委託</summary>{latest?<><p>{latest.date}｜當日成交 {latest.trades.length} 筆</p><ul>{Object.values(latest.signals).map(signal=><li key={signal.code}>{s.watchlist.find(w=>w.code===signal.code)?.name||signal.code} {signal.code}：{signal.label} — {signal.reason}</li>)}</ul>{latest.warnings.length>0&&<><strong>資料與未成交原因</strong><ul>{latest.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></>}</>:<p>尚未處理啟用前的訊號，等待首日收盤。</p>}{s.orders.length>0&&<ul>{s.orders.map(o=><li key={o.id}>{o.name} {o.code}｜{o.signalDate} {o.action}｜委託 {o.quantity} 股，等待下一有效開盤</li>)}</ul>}</details>
    <details><summary>每日資產紀錄（{days.length}天）</summary><div className="paper-table-wrap"><table><thead><tr><th>日期</th><th>現金</th><th>總資產</th><th>成交</th><th>資料警告</th></tr></thead><tbody>{[...days].reverse().map(d=><tr key={d.date}><td>{d.date}</td><td>{formatMoney(d.cash)}</td><td>{formatMoney(d.equity)}</td><td>{d.trades.length}</td><td>{d.warnings.length}</td></tr>)}</tbody></table></div></details>
  </div>;
}
