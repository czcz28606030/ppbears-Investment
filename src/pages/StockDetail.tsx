import StrategySignalBadge from '../components/StrategySignalBadge';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchStockData, fetchStrategyPrices, fetchInstitutionCostData, fetchTWSEStockPrice, fetchTPEXStockPrice, getOrGenerateKidFriendlyDesc, fetchTWSEDividendYields, getFreshStockAnalysis, fetchActiveEtfRadarMap } from '../api';
import type { ActiveEtfRadarItem, InstitutionCostData, TWSTEStockQuote, TPEXStockQuote, TWSEDividendYield } from '../api';
import type { StockData, StockPrice, StockLiveAnalysis } from '../types';
import { useStrategySignals } from '../hooks/useStrategySignals';
import { useStore, formatPrice, formatMoney } from '../store';
import StockChart from '../components/TradingViewChart';
import MarketBadge from '../components/MarketBadge';
import IndustryIcon from '../components/IndustryIcon';
import StockTradeModal from '../components/StockTradeModal';
import './StockDetail.css';

type ExploreStock = { coid: string; name: string; close: string };
const numeric = (value: string | number | null | undefined) => {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? n : null;
};
const display = (value: number | null | undefined) => value == null ? '--' : formatPrice(value);

export default function StockDetail() {
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user, holdings, dataReady, hasFeature, isInWatchlist, addToWatchlist, removeFromWatchlist } = useStore();
  const holding = holdings.find(h => h.stockCode === code);
  const enabled = Boolean(user && (hasFeature('ai_stock_picking') || (holding && hasFeature('ai_portfolio_advice'))));
  const { signals, loading: strategyLoading, error: strategyError, warning: strategyWarning, refresh } = useStrategySignals([code], enabled);
  const strategy = signals[code];
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [chartPrices, setChartPrices] = useState<StockPrice[]>([]);
  const [twseQuote, setTwseQuote] = useState<TWSTEStockQuote | null>(null);
  const [tpexQuote, setTpexQuote] = useState<TPEXStockQuote | null>(null);
  const [valuation, setValuation] = useState<TWSEDividendYield | null>(null);
  const [institution, setInstitution] = useState<InstitutionCostData | null>(null);
  const [etf, setEtf] = useState<ActiveEtfRadarItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryTick, setRetryTick] = useState(0);
  const [desc, setDesc] = useState('');
  const [analysis, setAnalysis] = useState<StockLiveAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisTick, setAnalysisTick] = useState(0);
  const [tradeMode, setTradeMode] = useState<'buy' | 'sell' | null>(null);
  const [wlBusy, setWlBusy] = useState(false);
  const [showMa5, setShowMa5] = useState(true);
  const [showMa20, setShowMa20] = useState(true);
  const [period, setPeriod] = useState(130);
  const [miniVisible, setMiniVisible] = useState(false);
  const relatedRef = useRef<HTMLDivElement>(null);
  const explore = useMemo(() => {
    try {
      const payload = JSON.parse(sessionStorage.getItem('explore_stock_list') || 'null');
      return payload?.source === 'stoxgauge-weekly' && Array.isArray(payload.items)
        ? payload.items.filter((s: ExploreStock) => s.coid && s.name) as ExploreStock[] : [];
    } catch { return []; }
  }, []);
  const index = explore.findIndex(s => s.coid === code);
  useLayoutEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); setMiniVisible(false); }, [code]);
  useEffect(() => {
    const onScroll = () => setMiniVisible(window.scrollY > 260);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setStockData(null); setChartPrices([]); setTwseQuote(null); setTpexQuote(null);
    setInstitution(null); setEtf(null); setValuation(null); setDesc(''); setAnalysis(null); setTradeMode(null);
    async function load() {
      const results = await Promise.allSettled([
        fetchStockData(code), fetchTWSEStockPrice(code), fetchTPEXStockPrice(code),
        fetchInstitutionCostData(code), fetchActiveEtfRadarMap([code]), fetchTWSEDividendYields(), fetchStrategyPrices(code),
      ]);
      if (cancelled) return;
      const [stock, twse, tpex, costs, radar, yields, prices] = results;
      const data = stock.status === 'fulfilled' ? stock.value : null;
      setStockData(data);
      setTwseQuote(twse.status === 'fulfilled' ? twse.value : null);
      setTpexQuote(tpex.status === 'fulfilled' ? tpex.value : null);
      setInstitution(costs.status === 'fulfilled' ? costs.value : null);
      setEtf(radar.status === 'fulfilled' ? radar.value[code] || null : null);
      setValuation(yields.status === 'fulfilled' ? yields.value.find(v => v.Code === code) || null : null);
      setChartPrices(prices.status === 'fulfilled' && prices.value.length ? prices.value : data?.prices || []);
      setLoading(false);
      const name = data?.stkname || (twse.status === 'fulfilled' ? twse.value?.Name : '') || (tpex.status === 'fulfilled' ? tpex.value?.CompanyName : '') || code;
      const description = await getOrGenerateKidFriendlyDesc(code, name, data?.status || '', data?.subindustry || '').catch(() => '公司介紹暫時無法讀取。');
      if (!cancelled) setDesc(description);
    }
    void load();
    return () => { cancelled = true; };
  }, [code, retryTick]);
  const name = stockData?.stkname || twseQuote?.Name || tpexQuote?.CompanyName || code;
  useEffect(() => {
    if (loading || !enabled) return;
    let cancelled = false;
    setAnalysisLoading(true); setAnalysis(null);
    void getFreshStockAnalysis(code, name, stockData?.subindustry || '', stockData?.status || '').then(result => {
      if (!cancelled) { setAnalysis(result); setAnalysisLoading(false); }
    }).catch(() => { if (!cancelled) setAnalysisLoading(false); });
    return () => { cancelled = true; };
  }, [code, loading, enabled, name, stockData?.subindustry, stockData?.status, analysisTick]);
  const orderedPrices = useMemo(() => [...chartPrices].sort((a, b) => a.mdate.localeCompare(b.mdate)), [chartPrices]);
  const latest = orderedPrices.at(-1);
  const price = numeric(twseQuote?.ClosingPrice || tpexQuote?.Close || latest?.close_d) || 0;
  const changeAmount = numeric(twseQuote?.Change || tpexQuote?.Change);
  const previous = changeAmount !== null ? price - changeAmount : numeric(orderedPrices.at(-2)?.close_d);
  const change = previous && previous > 0 ? (price - previous) / previous * 100 : null;
  const market = twseQuote ? 'listed' as const : tpexQuote ? 'otc' as const : null;
  const priceDate = twseQuote?.Date || tpexQuote?.Date || latest?.mdate || '--';
  const related = explore.filter(s => s.coid !== code);
  const valuationItems = [
    ['本益比 (P/E)', display(numeric(valuation?.PEratio || latest?.pe_ratio))],
    ['股價淨值比 (P/B)', display(numeric(valuation?.PBratio || latest?.pb_ratio))],
    ['殖利率', valuation?.DividendYield ? `${valuation.DividendYield}%` : '--'],
    ['成交量（張）', latest ? latest.volume.toLocaleString('zh-TW', { maximumFractionDigits: 0 }) : '--'],
    ['產業類別', stockData?.subindustry || holding?.industry || '--'],
  ];
  async function toggleWatchlist() {
    setWlBusy(true);
    try { if (isInWatchlist(code)) await removeFromWatchlist(code); else await addToWatchlist(code, name, price); }
    finally { setWlBusy(false); }
  }
  return <div className="stock-detail">
    <div className={`stock-context-bar ${miniVisible ? 'is-visible' : ''}`}>
      <button className="stock-context-bar-inner" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
        <span className="stock-context-identity"><span className="stock-context-code">{code}</span><span className="stock-context-name">{name}</span></span>
        <span className="stock-context-price">NT$ {display(price || null)}</span>
      </button>
    </div>
    <div className="stock-detail-actions">
      <button className="btn btn-outline" onClick={() => navigate(-1)}>← 返回</button>
      {index >= 0 && explore.length > 1 && <>
        <button className="btn btn-outline" onClick={() => navigate(`/stock/${explore[(index - 1 + explore.length) % explore.length].coid}`, { replace: true })}>上一檔</button>
        <span>{index + 1} / {explore.length}</span>
        <button className="btn btn-outline" onClick={() => navigate(`/stock/${explore[(index + 1) % explore.length].coid}`, { replace: true })}>下一檔</button>
      </>}
    </div>
    <div className="card">
      <h1><MarketBadge market={market} /> {code} {name}</h1>
      <div className={`stock-price ${change !== null && change < 0 ? 'text-loss' : 'text-profit'}`}>NT$ {display(price || null)} {change !== null && <small>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</small>}</div>
      <p className="stock-detail-note">官方收盤行情 · {priceDate}{loading ? ' · 讀取中…' : ''}</p>
      <div className="stock-detail-actions"><IndustryIcon stockCode={code} industry={stockData?.subindustry} compact={false} />
        <button className="btn btn-outline" disabled={wlBusy || !user} onClick={() => void toggleWatchlist()}>{wlBusy ? '處理中…' : isInWatchlist(code) ? '已觀察 · 移除' : '加入觀察'}</button>
      </div>
    </div>
    <section className="card strategy-detail-panel" aria-busy={strategyLoading}>
      <div className="section-header"><h2 className="section-title">週榜趨勢訊號</h2><button className="btn btn-outline" disabled={!enabled || strategyLoading} onClick={() => void refresh()}>更新訊號</button></div>
      {enabled ? <StrategySignalBadge action={strategy?.action} loading={!strategy && strategyLoading}/> : <strong>登入並啟用策略功能後查看</strong>}
      <p>{strategyError || strategy?.reason || '尚無完整的價格、候選資格與帳戶資料。'}</p>
      {strategy && <>
        <p className="stock-detail-note">當前狀態 · 資料日 {strategy.dataDate || '--'} · {strategy.held ? '已有持倉' : '未持倉'} · 週榜 {strategy.weeklyDate || '--'}{strategy.weeklyRank != null ? ` 第 ${strategy.weeklyRank} 名` : ''}</p>
        <div className="stat-grid">{[
          ['MA20', strategy.ma20], ['MA60', strategy.ma60], ['突破參考價', strategy.breakoutPrice], ['ATR14', strategy.atr],
          ['初始風險 R', strategy.initialRisk], ['保護價', strategy.protectionPrice], ['加碼門檻', strategy.addTriggerPrice], ['建議股數', strategy.suggestedQuantity],
        ].map(([label, value]) => <div className="stat-item" key={String(label)}><div className="stat-label">{label}</div><div className="stat-value">{display(value as number | null)}</div></div>)}</div>
      </>}
      <details><summary>判斷規則與風險限制</summary><p>週榜候選股須 MA60 上升且突破前 20 根最高價。首次實際進場保護線為進場價減 2.5 ATR；盈利達 2R 才檢查加碼，最多兩次。持有期最高收盤減 3 ATR 的保護線只上調。連兩日低於 MA20 先減碼；出場優先於減碼、加碼與續抱。</p><p>新增股數受初始股數 75%、可用現金、單檔權重 20% 及整筆風險不超過帳戶淨值 0.5% 限制。資料不足時不推測風險。收盤策略供研究與人工決策，不自動下單。</p></details>
    </section>
    <section className="card tv-chart-card">
      <div className="tv-chart-header"><h2 className="tv-chart-title">技術線圖 · 官方日 K</h2><div className="tv-chart-controls">
        {[30, 60, 130, 0].map(days => <button key={days} className={`tv-chart-toggle ${period === days ? 'active' : ''}`} onClick={() => setPeriod(days)}>{days ? `${days}日` : '全部'}</button>)}
        <button className={`tv-chart-toggle ${showMa5 ? 'active ma5' : ''}`} aria-pressed={showMa5} onClick={() => setShowMa5(v => !v)}>MA5</button>
        <button className={`tv-chart-toggle ${showMa20 ? 'active ma20' : ''}`} aria-pressed={showMa20} onClick={() => setShowMa20(v => !v)}>MA20</button>
      </div></div>
      <p className="stock-detail-note">歷史事件與當前狀態分開顯示。箭頭只來自保存的當時候選資格與實際帳戶交易；不以本週名單回填歷史。</p>
      {strategyWarning && <p className="stock-detail-note" role="status">{strategyWarning}</p>}
      <div className="strategy-event-legend"><span style={{ color: '#7c3aed' }}>↑ 進場</span><span style={{ color: '#2563eb' }}>↑ 加碼</span><span style={{ color: '#d97706' }}>↓ 減碼</span><span style={{ color: '#111827' }}>↓ 出場</span></div>
      {!strategy?.events?.length && <p className="stock-detail-note">尚無可驗證的歷史策略事件。</p>}
      <div className="tv-chart-wrapper">{orderedPrices.length ? <StockChart prices={orderedPrices} visibleBars={period} stockName={name} strategyEvents={enabled ? strategy?.events : undefined} showMa5={showMa5} showMa20={showMa20} /> : <div className="tv-chart-fallback"><p>{loading ? '正在讀取官方線圖…' : '官方線圖暫時無法讀取。'}</p><button className="btn btn-outline" disabled={loading} onClick={() => setRetryTick(v => v + 1)}>重新讀取</button></div>}</div>
      {strategy?.events?.length ? <details><summary>已保存的歷史事件</summary><ul>{strategy.events.map((event, i) => <li key={`${event.date}-${event.action}-${i}`}>{event.date} · {event.label}：{event.reason}</li>)}</ul></details> : null}
    </section>
    <section className="card"><h2 className="section-title">法人估算成本與實際買賣超</h2>
      <div className="stat-grid">{institution?.items.map(item => <div className="stat-item" key={item.key}><div className="stat-label">{item.label}估算成本</div><div className="stat-value">{display(item.estimatedCost)}</div></div>)}</div>
      {!institution && <p>暫無法人資料。</p>}
      <p className="stock-detail-note">{institution?.period} {institution?.note}</p>
      {institution?.finmind && <><p>FinMind · {institution.finmind.period}</p><div className="chip-cost-flow-row">{institution.finmind.items.map(item => <span key={item.key}>{item.label} {(item.netShares / 1000).toLocaleString()} 張</span>)}</div><p className="stock-detail-note">{institution.finmind.note}</p></>}
    </section>
    <section className="card"><h2 className="section-title">主動式 ETF 持股變動</h2>{etf ? <>
      <p>資料日 {etf.latestDate || '--'} · 持有 {etf.holdingEtfCount} 檔 · 新進 {etf.addedEtfCount} · 加碼 {etf.increasedEtfCount} · 減碼 {etf.decreasedEtfCount} · 剔除 {etf.removedEtfCount}</p>
      <p>淨權重變化 {etf.netWeightChangePct.toFixed(2)}%</p><ul>{etf.etfs.map(item => <li key={item.etfCode}>{item.etfCode} {item.etfName} · 權重 {item.weightPct == null ? '--' : `${item.weightPct.toFixed(2)}%`} · 變化 {item.weightChangePct == null ? '--' : `${item.weightChangePct.toFixed(2)}%`}</li>)}</ul><p className="stock-detail-note">來源：{etf.source}</p>
    </> : <p>目前無持股變動紀錄。</p>}</section>
    <section className="card kid-desc-card"><h2 className="section-title">PPBear 公司介紹</h2><p>{desc || '正在讀取公司介紹…'}</p></section>
    {enabled && <section className="card"><div className="section-header"><h2 className="section-title">公司與新聞整理</h2><button className="btn btn-outline" disabled={analysisLoading} onClick={() => setAnalysisTick(v => v + 1)}>重試整理</button></div>{analysisLoading ? <p>整理中…</p> : analysis ? <><h3>技術面</h3><p>{analysis.technical}</p><h3>法人與籌碼</h3><p>{analysis.chips}</p><h3>新聞</h3><p>{analysis.news}</p><ul>{analysis.headlines.map((headline, i) => <li key={i}>{headline}</li>)}</ul><p className="stock-detail-note">整理時間 {new Date(analysis.generatedAt).toLocaleString('zh-TW')}；策略判斷以週榜趨勢訊號為準。</p></> : <p>目前無法整理，請稍後重試。</p>}</section>}
    <section className="card"><h2 className="section-title">基本面分析</h2><div className="stat-grid">{valuationItems.map(([label, value]) => <div className="stat-item" key={label}><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div>)}</div></section>
    {holding && <section className="card holding-card"><h2 className="section-title">我的持股</h2><div className="holding-info-grid"><div>持有股數<br />{holding.totalShares.toLocaleString()} 股</div><div>平均成本<br />NT$ {display(holding.avgCost)}</div><div>目前損益<br />{price ? formatMoney((price - holding.avgCost) * holding.totalShares) : '--'}</div><div>報酬率<br />{price && holding.avgCost > 0 ? `${((price - holding.avgCost) / holding.avgCost * 100).toFixed(1)}%` : '--'}</div></div></section>}
    {related.length > 0 && <section className="related-stocks-section"><div className="section-header"><h2 className="section-title">同週候選股票</h2><div className="related-scroll-arrows"><button className="related-arrow-btn" onClick={() => relatedRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}>◀</button><button className="related-arrow-btn" onClick={() => relatedRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}>▶</button></div></div><div className="related-stocks-scroll" ref={relatedRef}>{related.map(s => <button key={s.coid} className="related-stock-card" onClick={() => navigate(`/stock/${s.coid}`, { replace: true })}><span className="related-stock-name">{s.name}</span><span className="related-stock-code">{s.coid}</span><span className="related-stock-price">NT$ {s.close || '--'}</span><span className="stock-detail-note">週榜候選 · 個別訊號以帳戶資料計算</span></button>)}</div></section>}
    {!dataReady && <p>帳戶資料同步中，請稍候再記錄交易。</p>}
    <div className="trade-buttons"><button className="btn btn-buy btn-lg" disabled={!dataReady || !price} onClick={() => setTradeMode('buy')}>買入</button><button className="btn btn-sell btn-lg" disabled={!dataReady || !holding || !price} onClick={() => setTradeMode('sell')}>賣出</button></div>
    {tradeMode && <StockTradeModal isOpen mode={tradeMode} stockCode={code} stockName={name} price={price} industry={stockData?.subindustry || holding?.industry || ''} snapshotContext={{ market: market || undefined, changePercent: change ?? undefined, changeAmount, open: twseQuote?.OpeningPrice || tpexQuote?.Open || latest?.open_d, high: twseQuote?.HighestPrice || tpexQuote?.High || latest?.high_d, low: twseQuote?.LowestPrice || tpexQuote?.Low || latest?.low_d, volume: twseQuote?.TradeVolume || tpexQuote?.TradingShares || latest?.volume, priceDate, strategyLabel: strategy?.label || null, strategyReason: strategy?.reason || null, strategyDate: strategy?.dataDate || null, protectionPrice: strategy?.protectionPrice ?? null, addTriggerPrice: strategy?.addTriggerPrice ?? null, initialRisk: strategy?.initialRisk ?? null, suggestedQuantity: strategy?.suggestedQuantity ?? null, aiRecommendation: null, aiSignalLabel: strategy?.label || '資料不足', addPriorityScore: null, addPriorityLabel: null, stockEssenceScore: null, cumulativeReturn: null, chipScore: null, chipLabel: null, cautionLabel: strategy?.reason || null, chartPrices: orderedPrices }} onClose={() => { setTradeMode(null); void refresh(); }} />}
  </div>;
}
