import {useEffect} from 'react';
import {Link} from 'react-router-dom';
import {useStore} from '../store';
import './PaperTradingBanner.css';
export default function PaperTradingBanner() {
  const {user,paperAccount,loadPaperAccount}=useStore();
  useEffect(()=>{
    if(!user?.paperTrading)return;
    const reload=()=>{if(document.visibilityState==='visible')void loadPaperAccount().catch(()=>{});};
    const timer=window.setInterval(reload,300000);
    document.addEventListener('visibilitychange',reload);
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',reload);};
  },[user?.paperTrading,loadPaperAccount]);
  if(!user?.paperTrading)return null;
  return <aside className="paper-banner" aria-label="自動模擬交易"><div><strong>🧸 一年自動模擬交易</strong><span>{paperAccount?.state.startDate} — {paperAccount?.state.endDate}｜起始100萬元｜僅模擬、不連接券商</span><small>{paperAccount?.last_error?`本次未完成：${paperAccount.last_error}`:`${paperAccount?.state.status==='completed'?'測試已結束':'每日18:30自動記錄'}｜最近收盤紀錄：${paperAccount?.state.lastProcessedDate||'等待今日完整收盤'}`}</small></div><Link to="/paper-trading">查看績效與紀錄 →</Link></aside>;
}
