import StrategySignalBadge from '../components/StrategySignalBadge';
import {useCallback,useEffect,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useStore,formatPrice} from '../store';
import {fetchOfficialPriceMap,fetchStockData,getCachedStrategyPrices,fetchActiveEtfRadarMap,clearOfficialPriceMapCache} from '../api';
import type {OfficialPriceMapEntry,ActiveEtfRadarItem} from '../api';
import type {StockPrice} from '../types';
import {useStrategySignals} from '../hooks/useStrategySignals';
import MarketBadge from '../components/MarketBadge';
import IndustryIcon from '../components/IndustryIcon';
import {canAutoRefreshPrices,PRICE_AUTO_REFRESH_MS} from '../utils/priceAutoRefresh';
import './Watchlist.css';
type ActiveEtfInfoDialog={stockCode:string;stockName:string;radar?:ActiveEtfRadarItem};
export default function Watchlist(){
 const navigate=useNavigate();const {watchlist,holdings,removeFromWatchlist,fetchWatchlist,hasFeature,dataReady}=useStore();
 const hasAiFeature=hasFeature('ai_stock_picking');
 const {signals,loading,error,refresh}=useStrategySignals(watchlist.map(w=>w.stockCode),hasAiFeature);
 const [marketMap,setMarketMap]=useState<Record<string,OfficialPriceMapEntry>>({});
 const [klineMap,setKlineMap]=useState<Record<string,StockPrice[]>>(()=>Object.fromEntries(watchlist.flatMap(w=>{const prices=getCachedStrategyPrices(w.stockCode);return prices?[[w.stockCode,prices]]:[]})));
 const [activeEtfMap,setActiveEtfMap]=useState<Record<string,ActiveEtfRadarItem>>({});
 const [activeEtfDialog,setActiveEtfDialog]=useState<ActiveEtfInfoDialog|null>(null);
 const [search,setSearch]=useState('');const [filter,setFilter]=useState('all');const [removeConfirm,setRemoveConfirm]=useState<string|null>(null);const [refreshing,setRefreshing]=useState(false);const [priceError,setPriceError]=useState('');
 useEffect(()=>{if(dataReady&&watchlist.length===0)void fetchWatchlist()},[dataReady,watchlist.length,fetchWatchlist]);
 const codesKey=watchlist.map(w=>w.stockCode).join(',');
 const loadQuotes=useCallback(async(force=false)=>{if(force)clearOfficialPriceMapCache();try{const map=await fetchOfficialPriceMap();setMarketMap(map);setPriceError(Object.keys(map).length?'':'官方行情暫未取得，保留加入價參考');}catch{setPriceError('官方行情暫未取得，保留加入價參考')}},[]);
 useEffect(()=>{void loadQuotes();const timer=window.setInterval(()=>{if(canAutoRefreshPrices())void loadQuotes(true)},PRICE_AUTO_REFRESH_MS);return()=>window.clearInterval(timer)},[loadQuotes]);
 useEffect(()=>{let active=true;const codes=codesKey.split(',').filter(Boolean);fetchActiveEtfRadarMap(codes,5).then(map=>{if(active)setActiveEtfMap(map)}).catch(()=>{});async function load(){const map:Record<string,StockPrice[]>={};for(let i=0;i<codes.length;i+=4){await Promise.all(codes.slice(i,i+4).map(async code=>{const data=await fetchStockData(code).catch(()=>null);if(data)map[code]=data.prices}));if(!active)return;}setKlineMap(map)}void load();return()=>{active=false}},[codesKey]);
  function getActiveEtfActionLabel(action: ActiveEtfRadarItem['etfs'][number]['action']): string {
    switch (action) {
      case 'added': return '新進';
      case 'increased': return '加碼';
      case 'decreased': return '減碼';
      case 'removed': return '剔除';
      default: return '持有';
    }
  }

  function getActiveEtfDetailText(radar?: ActiveEtfRadarItem): string {
    if (!radar) {
      const hasImportedData = Object.keys(activeEtfMap).length > 0;
      return hasImportedData
        ? '大型台股 ETF 已有匯入資料，但近 5 日沒有看到這檔股票的新進、加碼、減碼、剔除或持有紀錄。'
        : '目前大型台股 ETF 的每日持股差異還沒有匯入。匯入後會顯示近 5 日新進、加碼、減碼、剔除次數。';
    }
    const detail = radar.etfs
      .map(item => `${item.etfName || item.etfCode} ${getActiveEtfActionLabel(item.action)}`)
      .join('、');
    return `近${radar.days}日：新進${radar.addedEtfCount}、加碼${radar.increasedEtfCount}、減碼${radar.decreasedEtfCount}、剔除${radar.removedEtfCount}。${detail || '尚無 ETF 明細'}。資料日：${radar.latestDate || '待同步'}。`;
  }

  function renderActiveEtfRadarChip(stockCode: string, stockName: string, showPlaceholder = false) {
    const radar = activeEtfMap[stockCode];
    if (!radar) {
      if (!showPlaceholder) return null;
      const hasImportedData = Object.keys(activeEtfMap).length > 0;
      return (
        <button
          type="button"
          className="wl-quant-chip wl-active-etf-chip wl-active-etf-chip-neutral"
          title="點擊查看 ETF 支撐說明"
          onClick={(e) => {
            e.stopPropagation();
            setActiveEtfDialog({ stockCode, stockName });
          }}
        >
          ETF支撐 {hasImportedData ? '無紀錄' : '待匯入'}
        </button>
      );
    }
    if (radar.holdingEtfCount <= 0) return null;
    const label = `ETF+${radar.holdingEtfCount}`;
    return (
      <button
        type="button"
        className={`wl-quant-chip wl-active-etf-chip wl-active-etf-chip-${radar.signal}`}
        title={`目前有 ${radar.holdingEtfCount} 檔追蹤 ETF 持有，點擊查看 ETF 支撐詳細說明`}
        onClick={(e) => {
          e.stopPropagation();
          setActiveEtfDialog({ stockCode, stockName, radar });
        }}
      >
        {label}
      </button>
    );
  }

  function renderHalfYearKlineChart(stockCode: string, currentPrice: number) {
    const rawRows = klineMap[stockCode] || [];
    const points = rawRows
      .map(row => ({
        date: row.mdate,
        open: parseFloat(row.open_d),
        high: parseFloat(row.high_d),
        low: parseFloat(row.low_d),
        close: parseFloat(row.close_d),
      }))
      .filter(row =>
        row.date &&
        Number.isFinite(row.open) &&
        Number.isFinite(row.high) &&
        Number.isFinite(row.low) &&
        Number.isFinite(row.close) &&
        row.high >= row.low
      )
      .slice(-126);

    if (points.length < 12) {
      return (
        <div className="wl-kline-panel wl-kline-empty" aria-label="半年 K 線資料不足">
          <div className="wl-kline-title">半年K線</div>
          <div className="wl-kline-placeholder">資料累積中</div>
        </div>
      );
    }

    const width = 230;
    const height = 112;
    const padX = 8;
    const padTop = 8;
    const padBottom = 15;
    const chartHeight = height - padTop - padBottom;
    const highs = points.map(point => point.high);
    const lows = points.map(point => point.low);
    const maxPrice = Math.max(...highs);
    const minPrice = Math.min(...lows);
    const range = Math.max(maxPrice - minPrice, maxPrice * 0.02, 1);
    const y = (value: number) => padTop + ((maxPrice - value) / range) * chartHeight;
    const xStep = (width - padX * 2) / Math.max(points.length - 1, 1);
    const candleWidth = Math.max(1, Math.min(5, xStep * 0.64));
    const firstClose = points[0].close;
    const lastClose = points[points.length - 1].close || currentPrice;
    const halfYearChange = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;
    const isTrendUp = halfYearChange >= 0;
    const ma20 = points.map((_, index) => {
      if (index < 19) return null;
      const window = points.slice(index - 19, index + 1);
      return window.reduce((sum, point) => sum + point.close, 0) / window.length;
    });
    const maPath = ma20
      .map((value, index) => value === null ? '' : `${padX + index * xStep},${y(value)}`)
      .filter(Boolean)
      .join(' ');
    const startLabel = points[0].date.slice(5).replace('-', '/');
    const endLabel = points[points.length - 1].date.slice(5).replace('-', '/');

    return (
      <div className="wl-kline-panel" aria-label={`${stockCode} 半年日 K 線`}>
        <div className="wl-kline-head">
          <span>半年K線</span>
          <span className={isTrendUp ? 'text-profit' : 'text-loss'}>
            {isTrendUp ? '+' : ''}{halfYearChange.toFixed(1)}%
          </span>
        </div>
        <svg className="wl-kline-svg" viewBox={`0 0 ${width} ${height}`} role="img">
          {[0.25, 0.5, 0.75].map(level => (
            <line
              key={level}
              x1={padX}
              x2={width - padX}
              y1={padTop + chartHeight * level}
              y2={padTop + chartHeight * level}
              className="wl-kline-grid"
            />
          ))}
          {maPath && (
            <polyline
              points={maPath}
              className="wl-kline-ma"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {points.map((point, index) => {
            const x = padX + index * xStep;
            const openY = y(point.open);
            const closeY = y(point.close);
            const highY = y(point.high);
            const lowY = y(point.low);
            const up = point.close >= point.open;
            const bodyY = Math.min(openY, closeY);
            const bodyHeight = Math.max(Math.abs(closeY - openY), 1.4);
            return (
              <g key={`${point.date}-${index}`} className={up ? 'wl-kline-up' : 'wl-kline-down'}>
                <line x1={x} x2={x} y1={highY} y2={lowY} vectorEffect="non-scaling-stroke" />
                <rect
                  x={x - candleWidth / 2}
                  y={bodyY}
                  width={candleWidth}
                  height={bodyHeight}
                  rx="0.8"
                />
              </g>
            );
          })}
          <text x={padX} y={height - 3} className="wl-kline-date">{startLabel}</text>
          <text x={width - padX} y={height - 3} textAnchor="end" className="wl-kline-date">{endLabel}</text>
        </svg>
      </div>
    );
  }


 async function handleRemove(code:string){await removeFromWatchlist(code);setRemoveConfirm(null)}
 const rows=watchlist.filter(w=>(w.stockCode+' '+w.stockName).toLowerCase().includes(search.trim().toLowerCase())&&(filter==='all'||signals[w.stockCode]?.action===filter));
 return <div className="watchlist"><div className="page-header"><h1 className="page-title">觀察名單</h1><button className="btn btn-primary" onClick={()=>navigate('/explore')}>新增股票</button></div>
 <div className="wl-data-source"><span>週榜趨勢訊號｜官方日 K｜收盤判斷</span><button disabled={loading||refreshing} className="wl-refresh-btn" onClick={async()=>{setRefreshing(true);try{await Promise.all([refresh(),loadQuotes(true)]);const map=await fetchActiveEtfRadarMap(watchlist.map(w=>w.stockCode),5);setActiveEtfMap(map)}finally{setRefreshing(false)}}}>{loading||refreshing?'讀取中':'重新抓取'}</button></div>
 {(error||priceError)&&<p role="alert">{error||priceError}</p>}
 <p className="wl-strategy-note">訊號與半年 K 線每天取得一次；同日返回直接使用快取。已持有股票顯示持倉管理訊號；週榜候選資格不回填歷史。收盤策略不會自動下單。</p>
 <div className="wl-strategy-filters"><input aria-label="搜尋觀察名單" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜尋名稱或代號"/>{hasAiFeature&&<select aria-label="訊號篩選" value={filter} onChange={e=>setFilter(e.target.value)}>{[['all','全部'],['entry','進場'],['neutral','觀察'],['add','加碼'],['hold','續抱'],['reduce','減碼'],['exit','出場'],['unavailable','資料不足']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>}</div>
 <div className="wl-list">{rows.map(w=>{const signal=signals[w.stockCode];const quote=marketMap[w.stockCode];const price=Number(quote?.close)||w.addedPrice;const change=Number(quote?.change)||0;const held=holdings.some(h=>h.stockCode===w.stockCode&&h.totalShares>0);return <div key={w.stockCode} className={`wl-card strategy-${signal?.action||'unavailable'}`} onClick={()=>navigate(`/stock/${w.stockCode}`)}><div className="wl-card-header"><div className="wl-stock-info"><div className="wl-stock-name-row"><IndustryIcon stockCode={w.stockCode} compact/><span className="wl-stock-name">{w.stockName}</span>{held&&<small>已持有</small>}</div><div className="wl-stock-code-row"><MarketBadge market={quote?.market} compact/><span>{w.stockCode}</span></div>{hasAiFeature&&<div className="wl-strategy-details"><StrategySignalBadge action={signal?.action} loading={!signal && loading}/><span>{signal?.reason||'等待完整價格、週榜或交易資料'}</span><small>資料日：{signal?.dataDate||'尚未取得'}{signal?.weeklyDate?`｜週榜：${signal.weeklyDate}`:''}</small>{signal?.protectionPrice!=null&&<span>保護線 {formatPrice(signal.protectionPrice)}</span>}{signal?.addTriggerPrice!=null&&<span>2R 加碼門檻 {formatPrice(signal.addTriggerPrice)}</span>}{signal?.suggestedQuantity!=null&&<span>建議股數 {signal.suggestedQuantity}</span>}</div>}{renderActiveEtfRadarChip(w.stockCode,w.stockName,true)}</div><div className="wl-price-info"><div className="wl-price">NT$ {formatPrice(price)}</div><div className={change>=0?'text-profit':'text-loss'}>{change>=0?'+':''}{formatPrice(change)}</div><small>{quote?.date||'加入價參考'}</small>{renderHalfYearKlineChart(w.stockCode,price)}</div></div><div className="wl-card-body"><span>加入價 NT$ {formatPrice(w.addedPrice)}</span><span>自加入漲跌 {w.addedPrice>0?((price-w.addedPrice)/w.addedPrice*100).toFixed(2):'—'}%</span></div><div className="wl-card-actions">{removeConfirm===w.stockCode?<div className="wl-remove-confirm"><span>確定移除？</span><button onClick={e=>{e.stopPropagation();void handleRemove(w.stockCode)}}>是</button><button onClick={e=>{e.stopPropagation();setRemoveConfirm(null)}}>否</button></div>:<button className="wl-remove-btn" onClick={e=>{e.stopPropagation();setRemoveConfirm(w.stockCode)}}>移除</button>}</div></div>})}</div>
 {rows.length===0&&<div className="empty-state">{watchlist.length?'沒有符合篩選的股票':'尚未加入觀察股票'}</div>}
 {activeEtfDialog&&<div className="wl-info-overlay" onClick={()=>setActiveEtfDialog(null)}><div className="wl-info-dialog" role="dialog" aria-modal="true" aria-label="ETF 支撐" onClick={e=>e.stopPropagation()}><button onClick={()=>setActiveEtfDialog(null)} aria-label="關閉">×</button><h3>{activeEtfDialog.stockName} {activeEtfDialog.stockCode}｜ETF 支撐</h3><p>{getActiveEtfDetailText(activeEtfDialog.radar)}</p><p>ETF 持股異動是獨立參考，不代表週榜趨勢訊號。</p></div></div>}
 </div>;
}
