import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchStockData, fetchSimonsData, fetchStockQuantData, toRecommendation, POPULAR_STOCKS, fetchTWSEStockPrice, fetchTPEXStockPrice, getOrGenerateKidFriendlyDesc, fetchTWSEDividendYields, getFreshStockAnalysis, calculateSimonsScore } from '../api';
import type { StockQuantData } from '../api';
import type { TWSTEStockQuote, TPEXStockQuote } from '../api';
import { useStore, formatPrice, formatMoney } from '../store';
import type { StockData, StockPrice, StockRecommendation, StockLiveAnalysis, SimonsItem } from '../types';
import './StockDetail.css';

export default function StockDetail() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [recommendation, setRecommendation] = useState<StockRecommendation | null>(null);
  const [simonsMeta, setSimonsMeta] = useState<SimonsItem | null>(null); // 【NEW】保存原始 SimonsItem 以便重新評分
  const [latestPrice, setLatestPrice] = useState<StockPrice | null>(null);
  const [twseQuote, setTwseQuote] = useState<TWSTEStockQuote | null>(null);
  const [tpexQuote, setTpexQuote] = useState<TPEXStockQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [descLoading, setDescLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [kidDesc, setKidDesc] = useState('');
  const [liveAnalysis, setLiveAnalysis] = useState<StockLiveAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisRetryTick, setAnalysisRetryTick] = useState(0);
  const [tradeMode, setTradeMode] = useState<'buy' | 'sell' | null>(null);
  const [quantity, setQuantity] = useState('');
  const [tradeReason, setTradeReason] = useState('');
  const [tradeResult, setTradeResult] = useState<{ success: boolean; message: string } | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const [isTrading, setIsTrading] = useState(false);
  const [latestYield, setLatestYield] = useState<number | null>(null);
  const [quantData, setQuantData] = useState<StockQuantData | null>(null);

  useEffect(() => {
    if (!activeTooltip) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveTooltip(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeTooltip]);
  
  const { user, holdings, executeBuy, executeSell, getPortfolioSummary, hasFeature, isInWatchlist, addToWatchlist, removeFromWatchlist } = useStore();
  const holding = holdings.find(h => h.stockCode === code);
  const summary = getPortfolioSummary();
  const [wlBusy, setWlBusy] = useState(false);

  // ─── 响应式 Tooltip 组件 ─────────────────────────────
  const TooltipBox = ({ id, children }: { id: string; children: React.ReactNode }) => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
    
    return (
      <>
        {/* 背景遮蔽层（所有版本） */}
        {activeTooltip === id && (
          <div 
            className="tooltip-overlay"
            onClick={() => setActiveTooltip(null)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              background: isMobile ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.3)',
              zIndex: 999,
              display: activeTooltip === id ? 'block' : 'none'
            }}
          />
        )}
        
        {activeTooltip === id && (
          <div className="tooltip-box">
            {/* 手机版关闭按钮 */}
            {isMobile && (
              <button
                className="tooltip-close-btn"
                onClick={() => setActiveTooltip(null)}
                aria-label="关闭"
              >
                ✕
              </button>
            )}
            {children}
          </div>
        )}
      </>
    );
  };

  // ─── Explore 推薦股票滑塊 ─────────────────────────────
  type ExploreStock = { coid: string; name: string; close: string; aiRemark: string | null; cumRet: string | null; chipPts: number | null };
  const [exploreStockList, setExploreStockList] = useState<ExploreStock[]>([]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('explore_stock_list');
      if (raw) {
        const parsed: ExploreStock[] = JSON.parse(raw);
        setExploreStockList(parsed);
        // 如果量化資料缺失（非 AI 策略進來），批次補抓
        // aiRemark === null 表示尚未抓取（'' 表示已抓但無資料）
        const missing = parsed.filter(s => s.coid !== code && s.aiRemark === null).slice(0, 15);
        if (missing.length > 0) {
          Promise.all(missing.map(async s => {
            try { return await fetchStockQuantData(s.coid); }
            catch { return null; }
          })).then(results => {
            const updated = parsed.map(s => {
              const idx = missing.findIndex(m => m.coid === s.coid);
              if (idx === -1) return s;
              const qd = results[idx];
              return {
                ...s,
                aiRemark: qd?.aiQuanBackDataComment?.remark ?? '',
                cumRet: qd?.aiQuanBackDataComment?.cum_ret ?? '',
                chipPts: qd?.chipStability ? parseFloat(qd.chipStability.pts) : -1,
              };
            });
            setExploreStockList(updated);
            // 寫回 sessionStorage，避免換股時重複抓取
            try { sessionStorage.setItem('explore_stock_list', JSON.stringify(updated)); } catch {}
          }).catch(() => {});
        }
      }
    } catch {}
  }, [code]);
  const relatedStocks = exploreStockList.filter(s => s.coid !== code);
  const relatedScrollRef = useRef<HTMLDivElement>(null);
  function scrollRelated(dir: 'left' | 'right') {
    relatedScrollRef.current?.scrollBy({ left: dir === 'left' ? -170 : 170, behavior: 'smooth' });
  }
  // 桌面拖曳滑動
  useEffect(() => {
    const el = relatedScrollRef.current;
    if (!el) return;
    let isDown = false, startX = 0, scrollLeft = 0;
    const onDown = (e: PointerEvent) => { isDown = true; startX = e.pageX - el.offsetLeft; scrollLeft = el.scrollLeft; el.setPointerCapture(e.pointerId); };
    const onUp = (e: PointerEvent) => { isDown = false; el.releasePointerCapture(e.pointerId); };
    const onMove = (e: PointerEvent) => { if (!isDown) return; e.preventDefault(); el.scrollLeft = scrollLeft - (e.pageX - el.offsetLeft - startX); };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onUp);
    el.addEventListener('pointermove', onMove);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointerleave', onUp); el.removeEventListener('pointermove', onMove); };
  }, [relatedStocks.length]);

  // ─── Risk Warning State ───────────────────────────────
  type RiskWarning = { title: string; message: string; tip: string; icon: string };
  const [pendingWarnings, setPendingWarnings] = useState<RiskWarning[]>([]);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const analysisRequestRef = useRef<{ key: string; startedAt: number }>({ key: '', startedAt: 0 });

  const stockEmoji = POPULAR_STOCKS.find(s => s.code === code)?.emoji || '📊';

  useEffect(() => {
    // 切換到不同股票時，重置所有下單狀態，避免 isTrading 卡住
    setTradeMode(null);
    setQuantity('');
    setTradeReason('');
    setTradeResult(null);
    setIsTrading(false);
    setLiveAnalysis(null);
    setAnalysisError(null);
    setAnalysisRetryTick(0);
    analysisRequestRef.current = { key: '', startedAt: 0 };
    setStockData(null);
    setLatestPrice(null);
    setTwseQuote(null);
    setTpexQuote(null);
    setKidDesc('');
    setQuantData(null);
    if (code) loadStock(code);
  }, [code]);

  async function loadStock(coid: string) {
    setLoading(true);
    try {
      // 同時載入 ifalgo 資料、TWSE（上市）即時行情
      const [stockRes, twseRes] = await Promise.all([
        fetchStockData(coid),
        fetchTWSEStockPrice(coid),
      ]);

      if (stockRes) {
        setStockData(stockRes);
        const prices = stockRes.prices;
        if (prices?.length > 0) {
          setLatestPrice(prices[prices.length - 1]);
        }
      }

      if (twseRes && twseRes.ClosingPrice) {
        // 上市股票：使用 TWSE 官方收盤價
        setTwseQuote(twseRes);
      } else {
        // 上櫃股票：fallback 到 TPEx 官方收盤價（不用 ifalgo，避免時序落差）
        const tpexRes = await fetchTPEXStockPrice(coid);
        if (tpexRes && tpexRes.Close) setTpexQuote(tpexRes);
      }

      // 殖利率資料（最新）
      const divYields = await fetchTWSEDividendYields();
      const divInfo = divYields.find(d => d.Code === coid);
      if (divInfo?.DividendYield) {
        setLatestYield(parseFloat(divInfo.DividendYield));
      }

      // 嘗試載入推薦
      const today = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        if (date.getDay() === 0 || date.getDay() === 6) continue;
        const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        const items = await fetchSimonsData(dateStr);
        const match = items.find(item => item.coid === coid);
        if (match) {
          setSimonsMeta(match); // 【NEW】保存原始 SimonsItem
          setRecommendation(toRecommendation(match));
          break;
        }
      }

    } catch (err) {
      console.error(err);
    }
    // 先把 loading 設為 false，讓 PPBear 即時整理可以立即觸發
    setLoading(false);

    // Simons 量化模型詳細資料非同步載入（不阻塞主流程）
    fetchStockQuantData(coid).then(qd => setQuantData(qd)).catch(() => {});
  }

  // 【NEW】當量化數據加載完成時，如果是 Premium 會員且有 AI 推薦等級，重新用 Simons 評分計算
  useEffect(() => {
    if (!quantData?.aiQuanBackDataComment || !simonsMeta || !hasFeature('ai_stock_picking')) return;
    // 已有量化數據 + 是 Premium 會員 + 有 SimonsItem 原始數據 → 用 Simons 評分重新計算
    const simonsResult = calculateSimonsScore(simonsMeta, quantData);
    setRecommendation({
      ...simonsMeta,
      advice: simonsResult.advice,
      adviceText: simonsResult.text,
      kidAdvice: simonsResult.kidText,
      score: simonsResult.score,
    });
  }, [quantData, simonsMeta, hasFeature('ai_stock_picking')]);

  // 非同步載入公司介紹
  useEffect(() => {
    let typewriterTimer: ReturnType<typeof setInterval> | null = null;

    async function loadDesc() {
      if (!code) return;
      setDescLoading(true);
      setIsStreaming(true);
      setKidDesc('');

      const rawName = stockData?.stkname || twseQuote?.Name || POPULAR_STOCKS.find(s => s.code === code)?.name || code || '';
      const status = stockData?.status || '';
      const industry = stockData?.subindustry || '';
      const desc = await getOrGenerateKidFriendlyDesc(code, rawName, status, industry);

      setDescLoading(false);

      if (!desc) {
        setIsStreaming(false);
        return;
      }

      // 打字機動畫
      let i = 0;
      typewriterTimer = setInterval(() => {
        i += 2; // 每次顯示 2 個字元，速度適中
        setKidDesc(desc.slice(0, i));
        if (i >= desc.length) {
          if (typewriterTimer) clearInterval(typewriterTimer);
          setKidDesc(desc);
          setIsStreaming(false);
        }
      }, 16);
    }

    if (!loading) {
      loadDesc();
    }

    return () => {
      if (typewriterTimer) clearInterval(typewriterTimer);
    };
  }, [code, loading, stockData, twseQuote]);

  useEffect(() => {
    let cancelled = false;

    async function loadLiveAnalysis() {
      if (!code || loading) return;

      const rawName = stockData?.stkname || twseQuote?.Name || tpexQuote?.CompanyName || POPULAR_STOCKS.find(s => s.code === code)?.name || code;
      const requestKey = [code, rawName, stockData?.subindustry || '', stockData?.status || ''].join('|');
      const elapsedMs = Date.now() - analysisRequestRef.current.startedAt;

      // 防呆：同一支股票與同一份資料在短時間內不要重複狂打 API
      if (analysisRetryTick === 0 && analysisRequestRef.current.key === requestKey && elapsedMs < 12000) {
        return;
      }

      analysisRequestRef.current = { key: requestKey, startedAt: Date.now() };
      setAnalysisLoading(true);
      setLiveAnalysis(null);
      setAnalysisError(null);

      const result = await getFreshStockAnalysis(
        code,
        rawName,
        stockData?.subindustry || '',
        stockData?.status || ''
      );

      if (cancelled) return;
      setLiveAnalysis(result);
      if (!result) {
        setAnalysisError('目前連線較忙或資料來源暫時無回應，請按「重試整理」再試一次。');
      }
      setAnalysisLoading(false);
    }

    void loadLiveAnalysis();

    return () => {
      cancelled = true;
    };
  }, [
    code,
    loading,
    analysisRetryTick,
    stockData?.stkname,
    stockData?.subindustry,
    stockData?.status,
    twseQuote?.Name,
    tpexQuote?.CompanyName,
  ]);

  // 價格選擇邏輯：比較官方 API 更新日期與 ifalgo 日期，使用最新的那筆
  // TWSE/TPEx OpenAPI 盤後有 1~3 小時延遲；ifalgo 通常更即時
  // 民國 7 碼 "1150413" → 西元 "20260413"
  const officialDate = (() => {
    const d = twseQuote?.Date || tpexQuote?.Date || '';
    return d.length === 7
      ? `${parseInt(d.slice(0, 3)) + 1911}${d.slice(3)}`
      : d.replace(/-/g, '').replace(/\//g, '');
  })();
  const ifalgoDate = (latestPrice?.mdate || '').replace(/-/g, '').replace(/\//g, '');
  const ifalgoClose = latestPrice ? parseFloat(latestPrice.close_d) : 0;
  // 若 ifalgo 日期較新（官方 API 尚未更新當天收盤），改用 ifalgo
  const useIfalgo = ifalgoClose > 0 && ifalgoDate.length === 8 && officialDate.length === 8 && ifalgoDate > officialDate;
  const price = useIfalgo
    ? ifalgoClose
    : twseQuote?.ClosingPrice
      ? parseFloat(twseQuote.ClosingPrice)
      : tpexQuote?.Close
        ? parseFloat(tpexQuote.Close)
        : ifalgoClose;

  async function handleTrade() {
    if (!code || !tradeMode || price <= 0) return;
    const qty = parseInt(quantity);

    // ─── Only check risk on BUY ──────────────────────────────────────
    if (tradeMode === 'buy') {
      const warnings: RiskWarning[] = [];
      const totalAssets = summary.totalAssets;
      const buyAmount = qty * price;

      // Risk 1: 買入後單一該股超過總資金 15%
      const existingValue = holding ? holding.totalShares * holding.currentPrice : 0;
      const newPositionValue = existingValue + buyAmount;
      if (totalAssets > 0 && newPositionValue / totalAssets > 0.15) {
        const pct = (newPositionValue / totalAssets * 100).toFixed(0);
        warnings.push({
          icon: '👸',
          title: '雞蛋不能放在同一個箐子裡！',
          message: `買入後，「${stockData?.stkname || code}」將占你總資金的 ${pct}%，超過了建議的 15% 上限。`,
          tip: '分散投資就像將雞蛋放入不同的箐子裡，僅一個筐子不小心打破，其他的蛋還是安全的。單一股票超過 15%，万一跨了就欲哭無淚！',
        });
      }

      // Risk 2: 在號損時加碼
      if (holding && price < holding.avgCost) {
        const lossRate = ((holding.avgCost - price) / holding.avgCost * 100).toFixed(1);
        warnings.push({
          icon: '🚨',
          title: '目前正在號損！越跌越買很危険！',
          message: `你的成本是 NT$ ${formatPrice(holding.avgCost)}，目前價格是 NT$ ${formatPrice(price)}，已號損 ${lossRate}%。`,
          tip: '越跌越買（扔平成本）是投資新手最常犯的錯誤。警告：如果镜子不轉，搁整只會讓你輸得更多！只允許在「走勢變強」時才加碼。',
        });
      }

      // Risk 3: 一次買超過現有持股的 1/3
      if (holding && holding.totalShares > 0) {
        const oneThirdShares = holding.totalShares / 3;
        if (qty > oneThirdShares) {
          warnings.push({
            icon: '⚠️',
            title: '一次加碼太多了！',
            message: `你已持有 ${holding.totalShares} 股，此次想再買 ${qty} 股，超過現持股的 1/3（1/${3} = ${Math.floor(oneThirdShares)} 股）。`,
            tip: '穩健的加碼方式，是將資金分拆從小量進場。當走勢問題時，輸少了還有檢討空間；一次 All-in 的話，沒有第二次機會了！',
          });
        }
      }

      if (warnings.length > 0) {
        setPendingWarnings(warnings);
        setShowWarningModal(true);
        return;
      }
    }

    await doExecuteTrade();
  }

  async function doExecuteTrade() {
    if (!code || !tradeMode) return;
    if (price <= 0) {
      setTradeResult({ success: false, message: '❌ 無法取得目前股價，請稍後重試或重新整理頁面。' });
      return;
    }
    if (isTrading) return;
    setIsTrading(true);
    setShowWarningModal(false);
    const qty = parseInt(quantity);

    try {
      let result;
      if (tradeMode === 'buy') {
        const name = stockData?.stkname || twseQuote?.Name || tpexQuote?.CompanyName || code;
        result = await executeBuy(code, name, qty, price, stockData?.subindustry || '', tradeReason.trim());
      } else {
        result = await executeSell(code, qty, price, tradeReason.trim());
      }
      setTradeResult(result);
      if (result.success) {
        setQuantity('');
        setTradeReason('');
      }
    } catch (err) {
      console.error('doExecuteTrade error:', err);
      setTradeResult({ success: false, message: '⚠️ 交易時發生錯誤，請檢查網路後再試一次。' });
    } finally {
      setIsTrading(false);
    }
  }

  // 漲跌計算：TWSE/TPEx Change 是絕對金額，轉為%
  const changeAbsolute = twseQuote?.Change
    ? parseFloat(twseQuote.Change)
    : tpexQuote?.Change
      ? parseFloat(tpexQuote.Change)
      : null;
  const prevPrice = price - (changeAbsolute ?? 0);
  const change = (twseQuote?.ClosingPrice || tpexQuote?.Close) && changeAbsolute !== null && prevPrice > 0
    ? (changeAbsolute / prevPrice) * 100
    : (latestPrice?.roia ? parseFloat(latestPrice.roia) : 0);
  const isUp = change >= 0;

  const pe = latestPrice?.pe_ratio ? parseFloat(latestPrice.pe_ratio) : 0;
  const pb = latestPrice?.pb_ratio ? parseFloat(latestPrice.pb_ratio) : 0;

  // 資料日期顯示（若用 ifalgo 較新資料，顯示 ifalgo 日期）
  const priceDate = useIfalgo
    ? (latestPrice?.mdate || '')
    : twseQuote?.Date
      ? (() => {
          const d = twseQuote.Date;
          if (d.length === 7) {
            return `民國 ${d.slice(0, 3)} 年 ${d.slice(3, 5)} 月 ${d.slice(5, 7)} 日 (TWSE)`;
          }
          return d;
        })()
      : tpexQuote?.Date
        ? (() => {
            const d = tpexQuote.Date;
            if (d.length === 7) {
              return `民國 ${d.slice(0, 3)} 年 ${d.slice(3, 5)} 月 ${d.slice(5, 7)} 日 (TPEx)`;
            }
            return d;
          })()
        : (latestPrice?.mdate || '');

  if (loading) {
    return (
      <div className="stock-detail">
        <div className="page-header">
          <button className="page-header-back" onClick={() => navigate(-1)}>←</button>
          <h1 className="page-title">載入中...</h1>
        </div>
        <div className="loading-spinner">
          <div className="spinner"></div>
          <div className="loading-text">PPBear 正在查資料... 🐻📖</div>
        </div>
      </div>
    );
  }

  return (
    <div className="stock-detail">
      {/* Header */}
      <div className="page-header" style={{ justifyContent: 'space-between', borderBottom: 'none', paddingBottom: 0 }}>
        <button className="page-header-back" onClick={() => navigate(-1)}>←</button>
        <span className="detail-code" style={{ opacity: 0.5 }}>{code}</span>
      </div>

      {/* 價格區 */}
      <div className="price-hero" style={{ textAlign: 'center', paddingTop: '12px' }}>
        <div style={{ fontSize: '36px', fontWeight: 900, marginBottom: '16px', color: 'var(--text-primary)' }}>
          {stockEmoji} {code} {stockData?.stkname || twseQuote?.Name || ''}
        </div>
        <div className="price-main">NT$ {formatPrice(price)}</div>
        <div className={`price-change ${isUp ? 'text-profit' : 'text-loss'}`}>
          {isUp ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
          {changeAbsolute !== null && (
            <span style={{ fontSize: '0.85em', marginLeft: 6 }}>
              ({isUp ? '+' : ''}{changeAbsolute.toFixed(2)} 元)
            </span>
          )}
          <span className="price-change-emoji">{isUp ? '📈' : '📉'}</span>
        </div>
        {twseQuote && (
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8, fontSize: '0.82rem', color: 'var(--color-text-secondary, #888)' }}>
            <span>開 {twseQuote.OpeningPrice}</span>
            <span style={{ color: '#e05050' }}>高 {twseQuote.HighestPrice}</span>
            <span style={{ color: '#3cc464' }}>低 {twseQuote.LowestPrice}</span>
            <span>量 {parseInt(twseQuote.TradeVolume || '0').toLocaleString()} 股</span>
          </div>
        )}
        {!twseQuote && tpexQuote && (
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8, fontSize: '0.82rem', color: 'var(--color-text-secondary, #888)' }}>
            <span>開 {tpexQuote.Open}</span>
            <span style={{ color: '#e05050' }}>高 {tpexQuote.High}</span>
            <span style={{ color: '#3cc464' }}>低 {tpexQuote.Low}</span>
            <span>量 {parseInt(tpexQuote.TradingShares || '0').toLocaleString()} 股</span>
          </div>
        )}
        <div className="price-date">
          收盤價 · {priceDate}
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button 
            className="btn" 
            style={{ 
              background: 'transparent', border: '1px solid #7B2CBF', color: '#7B2CBF', 
              padding: '6px 16px', borderRadius: '20px', fontSize: '14px', fontWeight: 800,
              display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer'
            }}
            onClick={() => window.open(`https://tw.stock.yahoo.com/quote/${code}.TW/technical-analysis`, '_blank')}
          >
            📈 查看 Yahoo 最新技術線圖
          </button>
          <button
            className="btn"
            disabled={wlBusy}
            style={{
              background: isInWatchlist(code!) ? 'rgba(255, 202, 58, 0.15)' : 'transparent',
              border: `1px solid ${isInWatchlist(code!) ? '#FFCA3A' : '#888'}`,
              color: isInWatchlist(code!) ? '#D97706' : '#888',
              padding: '6px 16px', borderRadius: '20px', fontSize: '14px', fontWeight: 800,
              display: 'inline-flex', alignItems: 'center', gap: 6, cursor: wlBusy ? 'wait' : 'pointer',
              opacity: wlBusy ? 0.6 : 1,
            }}
            onClick={async () => {
              if (!code || wlBusy) return;
              setWlBusy(true);
              try {
                if (isInWatchlist(code)) {
                  await removeFromWatchlist(code);
                } else {
                  const name = stockData?.stkname || twseQuote?.Name || tpexQuote?.CompanyName || code;
                  const result = await addToWatchlist(code, name, price);
                  if (result.error) alert(result.error);
                }
              } finally {
                setWlBusy(false);
              }
            }}
          >
            {wlBusy ? '⏳ 處理中...' : isInWatchlist(code!) ? '👁️‍🗨️ 已觀察' : '👁️ 加入觀察'}
          </button>
        </div>
      </div>

      {/* 用小朋友聽得懂的話介紹 */}
      <div className="card kid-desc-card">
        <div className="kid-desc-header">
          <img src="/ppbear.png" alt="PPBear" className="kid-desc-bear" />
          <span className="kid-desc-title">PPBear 介紹</span>
        </div>
        {descLoading ? (
          <p style={{ color: '#888', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="spinner" style={{ width: 14, height: 14, border: '2px solid #ccc', borderTopColor: '#FFA000', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
             PPBear 正在翻閱財經百科全書...
          </p>
        ) : (
          <p className="kid-desc-text">
            {kidDesc}
            {isStreaming && <span style={{ display: 'inline-block', width: '8px', height: '16px', background: '#FFA000', marginLeft: '4px', animation: 'blink 1s step-end infinite', verticalAlign: 'middle' }}></span>}
          </p>
        )}
      </div>

      <div className="card stock-live-analysis-card">
        <div className="stock-live-analysis-header">
          <div>
            <div className="stock-live-analysis-title">🧠 PPBear 即時整理</div>
            <div className="stock-live-analysis-subtitle">每次點入個股頁都會重新整理技術面、籌碼面、消息面</div>
          </div>
          {liveAnalysis && (
            <div className="stock-live-analysis-time">
              更新於 {new Date(liveAnalysis.generatedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>

        {analysisLoading ? (
          <div className="stock-live-analysis-loading">
            <span className="spinner" style={{ width: 14, height: 14, border: '2px solid #ccc', borderTopColor: '#FFA000', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
            正在重新整理奇摩股市新聞與 AI 三面向解析...
          </div>
        ) : liveAnalysis ? (
          <>
            <div className="stock-live-analysis-grid">
              <div className="stock-live-analysis-item">
                <div className="stock-live-analysis-item-title">📈 技術面</div>
                <p className="stock-live-analysis-text">{liveAnalysis.technical}</p>
              </div>
              <div className="stock-live-analysis-item">
                <div className="stock-live-analysis-item-title">💰 籌碼面</div>
                <p className="stock-live-analysis-text">{liveAnalysis.chips}</p>
              </div>
              <div className="stock-live-analysis-item stock-live-analysis-item-full">
                <div className="stock-live-analysis-item-title">📰 消息面</div>
                <p className="stock-live-analysis-text">{liveAnalysis.news}</p>
                {liveAnalysis.headlines.length > 0 && (
                  <div className="stock-live-analysis-headlines">
                    {liveAnalysis.headlines.slice(0, 3).map((headline, idx) => (
                      <div key={`${idx}-${headline}`} className="stock-live-analysis-headline">• {headline}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="stock-live-analysis-empty-wrap">
            <div className="stock-live-analysis-empty">
              {analysisError || '目前暫時無法整理三面向分析，請稍後重新進入頁面再試一次。'}
            </div>
            <button
              type="button"
              className="stock-live-analysis-retry-btn"
              onClick={() => {
                analysisRequestRef.current = { key: '', startedAt: 0 };
                setAnalysisRetryTick(prev => prev + 1);
              }}
            >
              重新整理
            </button>
          </div>
        )}
      </div>

      {/* AI 建議 */}
      {recommendation && (
        <div className={`ai-card ai-card-${recommendation.advice}`}>
          <div className="ai-card-title">
            {recommendation.advice === 'buy' && '🟢 建議考慮買進'}
            {recommendation.advice === 'hold' && '🟡 先觀望看看'}
            {recommendation.advice === 'sell' && '🔴 可以考慮賣出'}
            {/* 【NEW】Premium 會員且有量化資料時顯示 Simons 標籤 */}
            {quantData?.aiQuanBackDataComment && hasFeature('ai_stock_picking') ? (
              <span className="ai-score">
                <button
                  className="simons-score-btn"
                  onClick={e => { e.stopPropagation(); setActiveTooltip(activeTooltip === 'simonsScore' ? null : 'simonsScore'); }}
                  aria-label="Simons 評分說明"
                >
                  💎 Simons量化評分 ({recommendation.score}分) ⓘ
                </button>
                {activeTooltip === 'simonsScore' && (
                  <TooltipBox id="simonsScore">
                    <p><strong>💎 Simons 量化評分計算方式</strong></p>
                    <p>評分由 0–100 分，分數越高表示表現越強。共分六個維度計算：</p>
                    <p className="tooltip-category">
                      <strong>AI 推薦等級</strong>基礎分 +0∼30 分：超高度 +30、高度 +22、中度 +12、低度 +2<br/>
                      <strong>熱度值 PSR</strong>最高 +20 分：PSR 越高資金流入越強，也可減分至 -15<br/>
                      <strong>強度指標 Strength</strong>最高 +15 分：&gt;2.5 強度極佳；&lt;0.5 減 12 分<br/>
                      <strong>氣動指數 GVI</strong>最高 +12 分：GVI 高於中位數 ×1.2 表示資金明顯流入<br/>
                      <strong>籌碼穩定度</strong>最高 +10 分：pts ≥8 最乾淨；pts&lt;2 減 8 分<br/>
                      <strong>累積報酬信心度</strong>最高 +5 分：歷史回測正報酬越高，信心度越高
                    </p>
                    <p className="tooltip-example">
                      <strong>評級標準：</strong><br/>
                      ≥ 75 強力買進　60–74 買進　45–59 觀望　30–44 減碼　&lt;30 出場
                    </p>
                    <p className="tooltip-tip">💡 分數越高表示量化模型越看好該股，建議搭配其他指標綜合判斷</p>
                  </TooltipBox>
                )}
              </span>
            ) : (
              <span className="ai-score">({recommendation.score}分)</span>
            )}
          </div>
          <div className="ai-card-desc">{recommendation.kidAdvice}</div>
        </div>
      )}

      {/* Simons 量化模型資料（限會員）— 統一卡片風格 */}
      {quantData && hasFeature('ai_stock_picking') && (() => {
        // ── 籌碼穩定度（pts 分數越高越乾淨） ──
        const pts = quantData.chipStability ? parseFloat(quantData.chipStability.pts) : null;
        const chipLabel = pts === null ? '尚無資料' :
          pts >= 9 ? '🏆 籌碼最乾淨' :
          pts >= 7 ? '✨ 籌碼非常穩定' :
          pts >= 5 ? '👍 籌碼穩定' :
          pts >= 3 ? '⚠️ 籌碼普通' : '⚠️ 籌碼凌亂';
        const chipClass = pts === null ? 'sm-badge-mute' :
          pts >= 7 ? 'sm-badge-good' :
          pts >= 4 ? 'sm-badge-warn' : 'sm-badge-bad';
        const chipBarClass = pts === null ? 'sm-bar-mute' :
          pts >= 7 ? 'sm-bar-good' :
          pts >= 4 ? 'sm-bar-warn' : 'sm-bar-bad';
        const chipTip = pts === null
          ? '此股暫無籌碼穩定度評分'
          : pts >= 9
            ? '籌碼極度乾淨，主力長期持有，是穩健投資首選之一'
            : pts >= 7
              ? '籌碼相對乾淨，散戶換手少，適合中長期布局'
              : pts >= 5
                ? '籌碼結構正常，需搭配其他指標一起判斷'
                : pts >= 3
                  ? '籌碼普通，主力與散戶換手較頻繁，留意短線波動'
                  : '籌碼凌亂，可能正在洗盤或派發，建議避開或謹慎評估';

        // ── AI 推薦等級 ──
        const aiRemark = quantData.aiQuanBackDataComment?.remark ?? null;
        const cumRet = quantData.aiQuanBackDataComment?.cum_ret ?? null;
        const aiClass = !aiRemark ? 'sm-badge-mute' :
          aiRemark.includes('超高') ? 'sm-badge-good' :
          aiRemark.includes('高') ? 'sm-badge-good' :
          aiRemark.includes('中') ? 'sm-badge-warn' : 'sm-badge-bad';

        // ── 熱度值 PSR ──
        const psr = recommendation?.psr ?? 0;
        const hasPsr = recommendation != null;
        const psrClass = !hasPsr ? 'sm-badge-mute' :
          psr >= 8 ? 'sm-badge-good' :
          psr >= 6 ? 'sm-badge-warn' :
          psr >= 4 ? 'sm-badge-warn' : 'sm-badge-bad';
        const psrBarClass = !hasPsr ? 'sm-bar-mute' :
          psr >= 8 ? 'sm-bar-good' :
          psr >= 6 ? 'sm-bar-warn' :
          psr >= 4 ? 'sm-bar-warn' : 'sm-bar-bad';
        const psrLabel = !hasPsr ? '尚無資料' :
          psr >= 8 ? '🔥 市場火熱' :
          psr >= 6 ? '✨ 資金有看' :
          psr >= 4 ? '😐 關注一般' : '💤 相對冷門';
        const psrTip = !hasPsr
          ? '這檔股票今天不在 Simons 推薦清單內，所以目前沒有對應的 PSR 熱度分數'
          : psr >= 8
            ? '市場關注度很高，代表資金與討論度都集中，但也要留意價格可能已經先反映期待'
            : psr >= 6
              ? '有一定動能與關注度，適合搭配強度指標與法人成本位置一起看，判斷是否仍有延續性'
              : psr >= 4
                ? '市場目前有注意到它，但熱度還不算特別突出，通常需要更多訊號支持'
                : '資金關注度偏低，若沒有基本面或籌碼上的額外亮點，通常不需要特別追價';

        // ── 強度指標 ──
        const strength = recommendation ? parseFloat(recommendation.strength || '0') : 0;
        const hasStrength = recommendation != null && Number.isFinite(strength) && strength > 0;
        const strengthClass = !hasStrength ? 'sm-badge-mute' :
          strength >= 2 ? 'sm-badge-good' :
          strength >= 1.5 ? 'sm-badge-warn' : 'sm-badge-bad';
        const strengthBarClass = !hasStrength ? 'sm-bar-mute' :
          strength >= 2 ? 'sm-bar-good' :
          strength >= 1.5 ? 'sm-bar-warn' : 'sm-bar-bad';
        const strengthLabel = !hasStrength ? '尚無資料' :
          strength >= 2 ? '💪 籌碼有力' :
          strength >= 1.5 ? '🔥 正在轉強' : '💤 力道偏淡';
        const strengthTip = !hasStrength
          ? '這檔股票今天沒有進入 Simons 推薦資料，因此目前抓不到 strength 原始欄位'
          : strength >= 2
            ? '強度高於 2，代表籌碼推動力明顯，通常表示法人布局或市場承接力道較強'
            : strength >= 1.5
              ? '目前已有轉強跡象，但還不到非常突出，建議搭配 PSR 熱度和法人成本位置一起判讀'
              : '目前籌碼推力偏弱，代表上攻續航力還不夠明確，比較適合先觀察後續是否補量轉強';

        // ── 氣動指數對比（GVI 越低 = 籌碼越穩） ──
        const gviNum = recommendation?.gvi ?? quantData.stockInfo?.gvi ?? 0;
        const medianStr = recommendation?.mediangvi ?? quantData.stockInfo?.mediangvi ?? '0';
        const medianNum = parseFloat(medianStr) || 0;
        const hasBoth = gviNum > 0 && medianNum > 0;
        const diff = hasBoth ? ((gviNum - medianNum) / medianNum) * 100 : 0;
        const compClass = !hasBoth ? 'sm-badge-mute' :
          diff <= -10 ? 'sm-badge-good' :
          diff < 10 ? 'sm-badge-warn' : 'sm-badge-bad';
        const compLabel = !hasBoth ? '尚無資料' :
          diff <= -20 ? '🛡️ 籌碼明顯穩健' :
          diff <= -10 ? '💪 比同類穩' :
          diff < 10 ? '⚖️ 與同類接近' :
          diff < 20 ? '🌪️ 較同類凌亂' : '📉 明顯凌亂';
        const compTip = !hasBoth
          ? '此股目前缺少同類股氣動中位數，無法做相對強弱判斷'
          : diff <= -20
            ? '個股氣動明顯低於板塊平均，籌碼結構穩固、主力長期持有意願強，適合穩健投資'
            : diff <= -10
              ? '個股氣動低於板塊平均，籌碼比同類乾淨，可優先觀察'
              : diff < 10
                ? '個股氣動與類股相近，跟著板塊整體方向走，需看大盤臉色'
                : diff < 20
                  ? '個股氣動高於板塊平均，籌碼比同類凌亂，留意短線波動風險'
                  : '個股氣動明顯高於板塊平均，可能正在洗盤、派發或有突發事件，務必查證原因';
        const diffText = !hasBoth ? '' :
          diff <= -10 ? `比同類穩 ${Math.abs(diff).toFixed(1)}%` :
          diff < 10 ? '與同類接近' :
          `比同類凌亂 ${diff.toFixed(1)}%`;
        const diffClass = !hasBoth ? 'sm-diff-mute' :
          diff <= -10 ? 'sm-diff-good' :
          diff < 10 ? 'sm-diff-mute' : 'sm-diff-bad';

        return (
          <section>
            <div className="section-header">
              <h2 className="section-title">🤖 Simons 量化模型</h2>
              <span className="sm-meta-date">資料日期：{recommendation?.mdate ?? '即時資料'}</span>
            </div>

            {/* ─── 卡 1: AI 推薦等級 ─── */}
            <div className="sm-card sm-card-hero">
              <div className="sm-card-head">
                <div>
                  <div className="sm-card-title tooltip-trigger" onClick={() => setActiveTooltip(activeTooltip === 'simonsAI' ? null : 'simonsAI')}>
                    🤖 AI 推薦等級
                    <span className="tooltip-icon">❓</span>
                  </div>
                  <div className="sm-card-sub">Simons 演算法回測評估</div>
                </div>
                <span className={`sm-badge ${aiClass}`}>{aiRemark ?? '尚無資料'}</span>
              </div>
              {activeTooltip === 'simonsAI' && (
                <TooltipBox id="simonsAI">
                  <p><strong>AI 推薦等級</strong></p>
                  <p>Simons 量化演算法對該股票未來上漲潛能的評估等級。</p>
                  <p className="tooltip-category">
                    🔥 <strong>超高度</strong> — 最強訊號，演算法高度看好<br/>
                    💪 <strong>高度</strong> — 強訊號，建議優先關注<br/>
                    👍 <strong>中度</strong> — 中等訊號，可以考慮<br/>
                    😐 <strong>低度</strong> — 弱訊號，觀察為主
                  </p>
                  <p className="tooltip-example">
                    <strong>累積報酬：</strong><br/>
                    歷史回測從發出推薦到現在的累積漲幅百分比
                  </p>
                  <p className="tooltip-tip">💡 搭配周/月趨勢一起看，判斷目前推薦方向是否仍在延續</p>
                </TooltipBox>
              )}
              <div className="sm-big-row">
                <span className="sm-big-value sm-big-purple">{cumRet ?? '--'}</span>
                <span className="sm-big-unit">回測累積報酬</span>
              </div>
              {recommendation && (
                <div className="sm-trend-grid">
                  <div className="sm-trend-cell">
                    <div className="sm-trend-cell-label">📅 週趨勢</div>
                    <span className={`sm-trend-pill ${recommendation.ret_w === 'rise' ? 'sm-trend-up' : recommendation.ret_w === 'drop' ? 'sm-trend-down' : 'sm-trend-flat'}`}>
                      {recommendation.ret_w === 'rise' ? '📈 上漲' : recommendation.ret_w === 'drop' ? '📉 下跌' : '➡️ 持平'}
                    </span>
                  </div>
                  <div className="sm-trend-cell">
                    <div className="sm-trend-cell-label">🗓️ 月趨勢</div>
                    <span className={`sm-trend-pill ${recommendation.ret_m === 'rise' ? 'sm-trend-up' : recommendation.ret_m === 'drop' ? 'sm-trend-down' : 'sm-trend-flat'}`}>
                      {recommendation.ret_m === 'rise' ? '📈 上漲' : recommendation.ret_m === 'drop' ? '📉 下跌' : '➡️ 持平'}
                    </span>
                  </div>
                </div>
              )}
              {recommendation?.unusual && recommendation.unusual !== 'N' && (
                <div className="sm-tip sm-tip-warn">⚡ 異常訊號：{recommendation.unusual}</div>
              )}
            </div>

            <div className="sm-metric-grid">
              {/* ─── 卡 2: 熱度值 PSR ─── */}
              <div className="sm-card sm-card-metric">
                <div className="sm-card-head">
                  <div>
                    <div className="sm-card-title tooltip-trigger" onClick={() => setActiveTooltip(activeTooltip === 'simonsPSR' ? null : 'simonsPSR')}>
                      🔥 熱度值（PSR）
                      <span className="tooltip-icon">❓</span>
                    </div>
                    <div className="sm-card-sub">市場關注度與資金熱度</div>
                  </div>
                  <span className={`sm-badge ${psrClass}`}>{psrLabel}</span>
                </div>
                {activeTooltip === 'simonsPSR' && (
                  <TooltipBox id="simonsPSR">
                    <p><strong>熱度值（PSR）</strong></p>
                    <p>Price Strength Ratio — 衡量市場關注度與資金熱度的指標。</p>
                    <p className="tooltip-category">
                      🔥 <strong>8-10 分</strong> — 市場火熱，資金大幅湧入<br/>
                      ✨ <strong>6-7 分</strong> — 資金有看，市場關注升溫<br/>
                      😐 <strong>4-5 分</strong> — 關注一般，處於平靜階段<br/>
                      💤 <strong>0-3 分</strong> — 相對冷門，市場無特別反應
                    </p>
                    <p className="tooltip-example">
                      <strong>注意：</strong><br/>
                      PSR 高不一定是買點，可能代表已漲多；<br/>
                      要搭配強度指標和法人位置判斷真實買進機會
                    </p>
                    <p className="tooltip-tip">💡 <strong>正常範圍</strong> = 5-7；&gt;7 偏熱；&lt;5 偏冷</p>
                  </TooltipBox>
                )}
                <div className="sm-big-row">
                  <span className="sm-big-value">{hasPsr ? psr.toFixed(0) : '--'}</span>
                  <span className="sm-big-unit">/ 10 分</span>
                </div>
                <div className="sm-bar-track">
                  <div
                    className={`sm-bar-fill ${psrBarClass}`}
                    style={{ width: `${hasPsr ? Math.min(psr * 10, 100) : 0}%` }}
                  />
                </div>
                <div className="sm-bar-labels">
                  <span>0 冷門</span>
                  <span>5 中性</span>
                  <span>10 過熱</span>
                </div>
                <div className="sm-tip">💡 {psrTip}</div>
              </div>

              {/* ─── 卡 3: 強度指標 ─── */}
              <div className="sm-card sm-card-metric">
                <div className="sm-card-head">
                  <div>
                    <div className="sm-card-title tooltip-trigger" onClick={() => setActiveTooltip(activeTooltip === 'simonsStrength' ? null : 'simonsStrength')}>
                      📊 強度指標
                      <span className="tooltip-icon">❓</span>
                    </div>
                    <div className="sm-card-sub">Simons 原始 strength 籌碼推力</div>
                  </div>
                  <span className={`sm-badge ${strengthClass}`}>{strengthLabel}</span>
                </div>
                {activeTooltip === 'simonsStrength' && (
                  <TooltipBox id="simonsStrength">
                    <p><strong>強度指標（Strength）</strong></p>
                    <p>衡量籌碼推動力道的指標。數值越高，代表主力或法人推動力道越強。</p>
                    <p className="tooltip-category">
                      💪 <strong>≥ 2.5 分</strong> — 籌碼極佳，推力最強，最理想<br/>
                      🔥 <strong>2.0-2.4 分</strong> — 籌碼優良，力道明顯<br/>
                      👍 <strong>1.5-1.9 分</strong> — 籌碼不錯，正在轉強<br/>
                      😐 <strong>1.0-1.4 分</strong> — 籌碼一般，力道平淡<br/>
                      ⚠️ <strong>&lt; 1.0 分</strong> — 籌碼凌亂，缺乏推力
                    </p>
                    <p className="tooltip-example">
                      <strong>投資參考：</strong><br/>
                      一般建議買進標準 = 強度 &gt; 1.5 搭配 PSR &gt; 5
                    </p>
                    <p className="tooltip-tip">💡 搭配 PSR 熱度和法人位置，可判斷股價是否有延續力</p>
                  </TooltipBox>
                )}
                <div className="sm-big-row">
                  <span className="sm-big-value">{hasStrength ? strength.toFixed(2) : '--'}</span>
                  <span className="sm-big-unit">力道分數</span>
                </div>
                <div className="sm-bar-track">
                  <div
                    className={`sm-bar-fill ${strengthBarClass}`}
                    style={{ width: `${hasStrength ? Math.min((strength / 3) * 100, 100) : 0}%` }}
                  />
                </div>
                <div className="sm-bar-labels">
                  <span>0 偏弱</span>
                  <span>1.5 轉強</span>
                  <span>2+ 強勁</span>
                </div>
                <div className="sm-tip">💡 {strengthTip}</div>
              </div>
            </div>

            {/* ─── 卡 4: 氣動指數對比 ─── */}
            <div className="sm-card">
              <div className="sm-card-head">
                <div>
                  <div className="sm-card-title tooltip-trigger" onClick={() => setActiveTooltip(activeTooltip === 'simonsGVI' ? null : 'simonsGVI')}>
                    💨 氣動指數對比
                    <span className="tooltip-icon">❓</span>
                  </div>
                  <div className="sm-card-sub">數值越低 = 籌碼越穩定</div>
                </div>
                <span className={`sm-badge ${compClass}`}>{compLabel}</span>
              </div>
              {activeTooltip === 'simonsGVI' && (
                <TooltipBox id="simonsGVI">
                  <p><strong>氣動指數對比（GVI）</strong></p>
                  <p>GVI = 近期異常籌碼活動指數。與同類股板塊平均比較，判斷籌碼穩定性。</p>
                  <p className="tooltip-category">
                    🛡️ <strong>個股 GVI 低於板塊 20% 以上</strong> — 籌碼明顯穩健，長期持有意願強<br/>
                    💪 <strong>低於板塊 10-20%</strong> — 比同類穩定，可優先關注<br/>
                    ⚖️ <strong>與板塊差不多</strong> — 跟著大盤走，無特別優勢<br/>
                    🌪️ <strong>高於板塊 10-20%</strong> — 較同類凌亂，有波動風險<br/>
                    📉 <strong>高於板塊 20% 以上</strong> — 明顯凌亂，可能在洗盤或派發
                  </p>
                  <p className="tooltip-example">
                    <strong>判讀方式：</strong><br/>
                    若個股 GVI = 1.5，板塊中位數 = 1.0<br/>
                    則 (1.5-1.0)/1.0 = 50% 較凌亂
                  </p>
                  <p className="tooltip-tip">💡 <strong>優先選擇 GVI 低於板塊的股票</strong>，代表主力掌控力強</p>
                </TooltipBox>
              )}
              <div className="sm-compare-row">
                <div className="sm-compare-cell">
                  <div className="sm-compare-label">📈 氣動指數（個股）</div>
                  <div className="sm-compare-value">{gviNum > 0 ? gviNum.toFixed(2) : '--'}</div>
                </div>
                <div className="sm-compare-vs">vs</div>
                <div className="sm-compare-cell">
                  <div className="sm-compare-label">🏛️ 板塊氣動值</div>
                  <div className="sm-compare-value muted">{medianNum > 0 ? medianNum.toFixed(2) : '--'}</div>
                </div>
              </div>
              {hasBoth && (
                <div className={`sm-compare-diff ${diffClass}`}>{diffText}</div>
              )}
              <div className="sm-tip">💡 {compTip}</div>
            </div>

            {/* ─── 卡 5: 籌碼穩定度 ─── */}
            <div className="sm-card">
              <div className="sm-card-head">
                <div>
                  <div className="sm-card-title tooltip-trigger" onClick={() => setActiveTooltip(activeTooltip === 'simonsChip' ? null : 'simonsChip')}>
                    🧲 籌碼穩定度
                    <span className="tooltip-icon">❓</span>
                  </div>
                  <div className="sm-card-sub">綜合評分（GVI 推導）</div>
                </div>
                <span className={`sm-badge ${chipClass}`}>{chipLabel}</span>
              </div>
              {activeTooltip === 'simonsChip' && (
                <TooltipBox id="simonsChip">
                  <p><strong>籌碼穩定度</strong></p>
                  <p>綜合評分，由 GVI 氣動指數推導而來。數值越高，代表籌碼越乾淨，主力掌控力越強。</p>
                  <p className="tooltip-category">
                    🏆 <strong>9-10 分</strong> — 籌碼最乾淨，主力意圖明確，最優先買進<br/>
                    ✨ <strong>7-8 分</strong> — 籌碼非常穩定，散戶換手少，很適合中長期<br/>
                    👍 <strong>5-6 分</strong> — 籌碼穩定，結構正常，可考慮<br/>
                    ⚠️ <strong>3-4 分</strong> — 籌碼普通，主力活動較頻繁，需謹慎<br/>
                    🔴 <strong>&lt; 3 分</strong> — 籌碼凌亂，可能洗盤中，建議先觀察
                  </p>
                  <p className="tooltip-example">
                    <strong>買進標準組合：</strong><br/>
                    • 籌碼穩定度 ≥ 7<br/>
                    • 強度指標 &gt; 1.5<br/>
                    • PSR 熱度 &gt; 5<br/>
                    三者皆備時最安心
                  </p>
                  <p className="tooltip-tip">💡 籌碼乾淨的股票，即使短期下跌，也是穩健布局的好時機</p>
                </TooltipBox>
              )}
              <div className="sm-big-row">
                <span className="sm-big-value">{pts !== null ? pts.toFixed(0) : '--'}</span>
                <span className="sm-big-unit">/ 10 分</span>
              </div>
              <div className="sm-bar-track">
                <div
                  className={`sm-bar-fill ${chipBarClass}`}
                  style={{ width: `${pts !== null ? Math.min(pts * 10, 100) : 0}%` }}
                />
              </div>
              <div className="sm-bar-labels">
                <span>0 凌亂</span>
                <span>5 普通</span>
                <span>10 最乾淨</span>
              </div>
              <div className="sm-tip">💡 {chipTip}</div>
            </div>
          </section>
        );
      })()}

      {/* 基本面分析 */}
      <section>
        <div className="section-header">
          <h2 className="section-title">📊 基本面分析</h2>
        </div>
        <div className="stat-grid">
          <div className="stat-item">
            <div className="stat-label">本益比 (P/E)</div>
            <div className="stat-value-row">
              <div className="stat-value">{pe.toFixed(1)}</div>
              <div className={`stat-badge ${
                pe < 15 ? 'badge-cheap' : pe < 25 ? 'badge-ok' : 'badge-expensive'
              }`}>
                {pe < 15 ? '便宜 🤑' : pe < 25 ? '合理 😊' : '偏貴 🤔'}
              </div>
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-label">股價淨值比 (P/B)</div>
            <div className="stat-value-row">
              <div className="stat-value">{pb > 0 ? pb.toFixed(2) : '--'}</div>
              {pb > 0 && (
                <div className={`stat-badge ${
                  pb < 2 ? 'badge-cheap' : pb < 4 ? 'badge-ok' : 'badge-expensive'
                }`}>
                  {pb < 2 ? '可能低估 💰' : pb < 4 ? '合理範圍 😊' : '可能高估 💡'}
                </div>
              )}
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-label">成交量 (張)</div>
            <div className="stat-value">{latestPrice?.volume?.toLocaleString() || '-'}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">產業類別</div>
            <div className="stat-value stat-value-sm">
              {stockData?.subindustry?.split(',')[0] || '-'}
            </div>
          </div>
          <div className="stat-item" style={{ gridColumn: '1 / -1' }}>
            <div className="stat-label">殖利率 💵</div>
            <div className="stat-value-row" style={{ marginTop: 4 }}>
              <div className="stat-value">
                {latestYield !== null ? `${latestYield.toFixed(2)}%` : '--'}
              </div>
              {latestYield !== null && (
                <div className={`stat-badge ${
                  latestYield >= 5 ? 'badge-cheap' : latestYield >= 3 ? 'badge-ok' : 'badge-expensive'
                }`}>
                  {latestYield >= 5 ? '高殖利率 💰' : latestYield >= 3 ? '普通 😊' : '偏低 💡'}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 籌碼面分析 */}
      {recommendation && (
        <section>
          {(() => {
            const wtcost = parseFloat(recommendation.wtcost || '0') || 0;
            const fcost = parseFloat(recommendation.fcost || '0') || 0;
            const tcost = parseFloat(recommendation.tcost || '0') || 0;
            const costItems = [
              { key: 'wt', label: '🌍 外資成本', shortLabel: '外資', value: wtcost, color: '#10b981' },
              { key: 'fc', label: '🏢 投信成本', shortLabel: '投信', value: fcost, color: '#3b82f6' },
              { key: 'tc', label: '🏦 自營商成本', shortLabel: '自營商', value: tcost, color: '#8b5cf6' },
            ].filter(item => item.value > 0);
            const maxVal = Math.max(price, ...costItems.map(item => item.value)) * 1.05 || 1;
            const belowCosts = costItems.filter(item => price < item.value);
            const avgCost = costItems.length > 0
              ? costItems.reduce((sum, item) => sum + item.value, 0) / costItems.length
              : 0;
            const nearestCost = costItems.length > 0
              ? costItems.reduce((prev, current) =>
                Math.abs(current.value - price) < Math.abs(prev.value - price) ? current : prev
              )
              : null;
            const costBadgeClass = costItems.length === 0 ? 'sm-badge-mute' :
              belowCosts.length >= 2 ? 'sm-badge-good' :
              belowCosts.length === 1 ? 'sm-badge-warn' : 'sm-badge-bad';
            const costBadgeLabel = costItems.length === 0 ? '尚無資料' :
              belowCosts.length >= 2 ? '✅ 低於多數法人成本' :
              belowCosts.length === 1 ? '⚖️ 接近法人區間' : '⚠️ 高於法人成本';
            const costSummary = costItems.length === 0
              ? '目前沒有足夠的法人成本資料可比較。'
              : belowCosts.length >= 2
                ? '現在價格還在多數法人成本之下，代表若單看成本區，位置相對不算追高。'
                : belowCosts.length === 1
                  ? '現在價格落在法人觀察區附近，屬於可持續追蹤、但不算特別便宜的位置。'
                  : '現在價格已高於主要法人成本，代表市場已先走一段，操作上要更留意追價風險。';
            const renderBar = (label: string, val: number, color: string, isCurrentPrice = false) => {
              if (val <= 0) return null;
              const width = `${(val / maxVal) * 100}%`;
              let diffText = '';
              let diffClass = '';
              if (!isCurrentPrice) {
                if (price < val) { diffText = '有空間'; diffClass = 'text-profit'; }
                else if (price > val) { diffText = '已在上方'; diffClass = 'text-loss'; }
                else { diffText = '貼近'; diffClass = 'text-muted'; }
              }
              return (
                <div className="cost-bar-row" key={label}>
                  <div className="cost-bar-header">
                    <span className="cost-bar-label">{label}</span>
                    <div className="cost-bar-value-wrap">
                      <span className="cost-bar-value">NT$ {val.toFixed(2)}</span>
                      {!isCurrentPrice && <span className={`cost-bar-diff ${diffClass}`}>{diffText}</span>}
                    </div>
                  </div>
                  <div className="cost-bar-track">
                    <div className={`cost-bar-fill ${isCurrentPrice ? 'pulse-bar' : ''}`} style={{ width, background: color }} />
                  </div>
                </div>
              );
            };

            return (
              <div className="chip-analysis-shell">
                <div className="section-header">
                  <h2 className="section-title">🧮 大人們買在哪裡？</h2>
                  <span className={`sm-badge ${costBadgeClass}`}>{costBadgeLabel}</span>
                </div>

                <div className="chip-analysis-grid">
                  <div className="sm-card chip-overview-card">
                    <div className="sm-card-head">
                      <div>
                        <div className="sm-card-title">🏛️ 法人成本判讀</div>
                        <div className="sm-card-sub">現在價格和主要法人布局區的相對位置</div>
                      </div>
                    </div>

                    <div className="chip-hero-row">
                      <div>
                        <div className="chip-hero-label">現在價格</div>
                        <div className="chip-hero-value">NT$ {price.toFixed(2)}</div>
                      </div>
                    </div>

                    <div className="chip-mini-grid" style={{ position: 'relative' }}>
                      <div className="chip-mini-card">
                        <div 
                          className="chip-mini-label tooltip-trigger"
                          onClick={() => setActiveTooltip(activeTooltip === 'belowCosts' ? null : 'belowCosts')}
                        >
                          低於法人成本
                          <span className="tooltip-icon">❓</span>
                        </div>
                        <div className="chip-mini-value">{belowCosts.length} / {costItems.length}</div>
                        {activeTooltip === 'belowCosts' && (
                          <TooltipBox id="belowCosts">
                            <p><strong>低於法人成本</strong></p>
                            <p>在 3 個主要法人中，現價低於多少個的成本價格。</p>
                            <p className="tooltip-example">
                              <strong>解釋：</strong><br/>
                              「0 / 3」表示有 0 個法人的成本高於現價<br/>
                              也就是全部 3 個法人成本都已 ≤ 現價
                            </p>
                            <p className="tooltip-tip">💡 <strong>數字越大越好</strong> — 表示現價越低於法人布局區（買進機會）</p>
                          </TooltipBox>
                        )}
                      </div>
                      <div className="chip-mini-card">
                        <div 
                          className="chip-mini-label tooltip-trigger"
                          onClick={() => setActiveTooltip(activeTooltip === 'nearestCost' ? null : 'nearestCost')}
                        >
                          最近法人位置
                          <span className="tooltip-icon">❓</span>
                        </div>
                        <div className="chip-mini-value">{nearestCost ? nearestCost.shortLabel : '--'}</div>
                        {activeTooltip === 'nearestCost' && (
                          <TooltipBox id="nearestCost">
                            <p><strong>最近法人位置</strong></p>
                            <p>在所有法人中，誰的成本價格最接近現在股價。</p>
                            <p className="tooltip-example">
                              <strong>例如：</strong><br/>
                              顯示「投信」→ 投信成本最接近現價<br/>
                              代表投信的持股成本區在目前價位附近
                            </p>
                            <p className="tooltip-category">
                              🌍 <strong>外資</strong> — 國際大型基金、外資法人<br/>
                              🏢 <strong>投信</strong> — 台灣投信基金、大型基金<br/>
                              🏦 <strong>自營商</strong> — 證券自營部門
                            </p>
                            <p className="tooltip-tip">💡 「--」表示資料不足或無法計算</p>
                          </TooltipBox>
                        )}
                      </div>
                      <div className="chip-mini-card">
                        <div 
                          className="chip-mini-label tooltip-trigger"
                          onClick={() => setActiveTooltip(activeTooltip === 'avgCost' ? null : 'avgCost')}
                        >
                          法人成本均價
                          <span className="tooltip-icon">❓</span>
                        </div>
                        <div className="chip-mini-value">{avgCost > 0 ? `NT$ ${avgCost.toFixed(2)}` : '--'}</div>
                        {activeTooltip === 'avgCost' && (
                          <TooltipBox id="avgCost">
                            <p><strong>法人成本均價</strong></p>
                            <p>三個主要法人的持股成本平均值。用來判斷現價相對於所有法人的位置。</p>
                            <p className="tooltip-example">
                              <strong>計算方式：</strong><br/>
                              (外資成本 + 投信成本 + 自營商成本) ÷ 3
                            </p>
                            <p className="tooltip-category">
                              💚 <strong>現價 &lt; 均價</strong> → 買進機會（低於法人平均成本）<br/>
                              ⚠️ <strong>現價 ≈ 均價</strong> → 接近法人布局區<br/>
                              📈 <strong>現價 &gt; 均價</strong> → 已高於法人成本（法人有套利空間）
                            </p>
                            <p className="tooltip-tip">💡 對比成本分布圖可更清楚看出買賣時機</p>
                          </TooltipBox>
                        )}
                      </div>
                    </div>

                    <div className="sm-tip">💡 {costSummary}</div>
                  </div>

                  <div className="sm-card chip-bars-card">
                    <div className="sm-card-head">
                      <div>
                        <div className="sm-card-title">📍 成本分布</div>
                        <div className="sm-card-sub">現在價格 vs 外資、投信、自營商的成本區間</div>
                      </div>
                    </div>

                    <div className="cost-comparison cost-comparison-polished">
                      {renderBar('📍 現在價格', price, 'var(--primary)', true)}
                      {renderBar('🌍 外資成本', wtcost, '#10b981')}
                      {renderBar('🏢 投信成本', fcost, '#3b82f6')}
                      {renderBar('🏦 自營商成本', tcost, '#8b5cf6')}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </section>
      )}

      {/* 我的持股 */}
      {holding && (
        <div className="card holding-card">
          <div className="section-title" style={{ marginBottom: 12 }}>💼 我的持股</div>
          <div className="holding-info-grid">
            <div>
              <div className="stat-label">持有股數</div>
              <div className="stat-value">{holding.totalShares} 股</div>
            </div>
            <div>
              <div className="stat-label">平均成本</div>
              <div className="stat-value">NT$ {formatPrice(holding.avgCost)}</div>
            </div>
            <div>
              <div className="stat-label">目前損益</div>
              <div className={`stat-value ${(price - holding.avgCost) >= 0 ? 'text-profit' : 'text-loss'}`}>
                {(price - holding.avgCost) >= 0 ? '+' : ''}{formatMoney((price - holding.avgCost) * holding.totalShares)}
              </div>
            </div>
            <div>
              <div className="stat-label">報酬率</div>
              <div className={`stat-value ${(price - holding.avgCost) >= 0 ? 'text-profit' : 'text-loss'}`}>
                {((price - holding.avgCost) / holding.avgCost * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 同策略推薦股票滑塊 */}
      {relatedStocks.length > 0 && (
        <section className="related-stocks-section">
          <div className="section-header">
            <h2 className="section-title">🔥 同策略推薦</h2>
            <div className="related-scroll-arrows">
              <button className="related-arrow-btn" onClick={() => scrollRelated('left')}>◀</button>
              <button className="related-arrow-btn" onClick={() => scrollRelated('right')}>▶</button>
            </div>
          </div>
          <div className="related-stocks-scroll" ref={relatedScrollRef}>
            {relatedStocks.map(s => {
              const noChipData = s.chipPts !== null && s.chipPts < 0;
              const chipLabel = s.chipPts === null || noChipData ? '--' :
                s.chipPts >= 9 ? '最乾淨' :
                s.chipPts >= 7 ? '非常穩定' :
                s.chipPts >= 5 ? '穩定' :
                s.chipPts >= 3 ? '普通' : '凌亂';
              const cumDisplay = s.cumRet === null ? '載入中…' : !s.cumRet ? '--' : (s.cumRet.startsWith('-') ? s.cumRet : `+${s.cumRet}`);
              // null = 尚未抓取（載入中）, '' = 已抓但無資料
              const aiLabel = s.aiRemark === null ? '載入中…' : s.aiRemark || '無資料';
              const chipText = s.chipPts === null ? '載入中…' : noChipData ? '無資料' : `${s.chipPts.toFixed(0)}分 ${chipLabel}`;
              return (
                <div
                  key={s.coid}
                  className="related-stock-card"
                  onClick={() => navigate(`/stock/${s.coid}`, { replace: true })}
                >
                  <div className="related-stock-name">{s.name}</div>
                  <div className="related-stock-code">{s.coid}</div>
                  <div className="related-stock-price">NT${s.close}</div>
                  <span className={`related-stock-chip ${
                    s.aiRemark === null ? 'rs-chip-loading' :
                    !s.aiRemark ? 'rs-chip-loading' :
                    s.aiRemark.includes('超高') ? 'rs-chip-ultra' :
                    s.aiRemark.includes('高度') ? 'rs-chip-high' :
                    s.aiRemark.includes('中度') ? 'rs-chip-mid' : 'rs-chip-low'
                  }`}>🤖 {aiLabel}</span>
                  <span className={`related-stock-chip ${
                    s.cumRet === null ? 'rs-chip-loading' :
                    !s.cumRet ? 'rs-chip-loading' :
                    parseFloat(s.cumRet) >= 0 ? 'rs-chip-ret-pos' : 'rs-chip-ret-neg'
                  }`}>📊 報酬 {cumDisplay}</span>
                  <span className={`related-stock-chip ${
                    s.chipPts === null || noChipData ? 'rs-chip-loading' :
                    s.chipPts >= 7 ? 'rs-chip-pts-high' :
                    s.chipPts >= 4 ? 'rs-chip-pts-mid' : 'rs-chip-pts-low'
                  }`}>🔒 {chipText}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 交易按鈕 */}
      <div className="trade-buttons">
        <button className="btn btn-buy btn-lg" style={{ flex: 1 }} onClick={() => { setTradeMode('buy'); setTradeResult(null); }}>
          🛒 買入
        </button>
        <button className="btn btn-sell btn-lg" style={{ flex: 1 }} onClick={() => { setTradeMode('sell'); setTradeResult(null); }}
          disabled={!holding}
        >
          💰 賣出
        </button>
      </div>

      {/* 交易面板 */}
      {tradeMode && (
        <div className="modal-overlay" onClick={() => setTradeMode(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle"></div>
            {tradeResult?.success ? (
              <div className="trade-success-screen" style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: '64px', animation: 'bounce 1s infinite' }}>🎉</div>
                <h3 style={{ margin: '16px 0', color: 'var(--text-primary)' }}>{tradeMode === 'buy' ? '買入成功！' : '賣出成功！'}</h3>
                <div className="trade-result trade-success" style={{ marginBottom: 24, fontSize: '16px' }}>
                  {tradeResult.message}
                </div>
                <button
                  className="btn btn-buy btn-lg btn-block"
                  onClick={() => { setTradeMode(null); setTradeResult(null); }}
                >
                  太棒了 🐻
                </button>
              </div>
            ) : (
              <>
                <h3 className="trade-modal-title">
                  {tradeMode === 'buy' ? '🛒 買入' : '💰 賣出'} {stockData?.stkname || code}
                </h3>

                <div className="trade-modal-price">
                  以收盤價 <strong>NT$ {formatPrice(price)}</strong> 交易
                </div>

                {tradeMode === 'buy' && (
                  <div className="trade-modal-balance">
                    可用餘額：NT$ {formatMoney(user!.availableBalance)}
                  </div>
                )}
                {tradeMode === 'sell' && holding && (
                  <div className="trade-modal-balance">
                    可賣股數：{holding.totalShares} 股
                  </div>
                )}

                <div className="input-group">
                  <label className="input-label">股數</label>
                  <input
                    className="input-field"
                    type="number"
                    min="1"
                    placeholder="輸入要交易的股數"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>

                <div className="input-group" style={{ marginTop: 16 }}>
                  <label className="input-label">投資筆記（告訴 PPBear 為什麼想{tradeMode === 'buy' ? '買' : '賣'}？）</label>
                  <textarea
                    className="input-field"
                    style={{ minHeight: 80, resize: 'vertical' }}
                    placeholder="我想要因為..."
                    value={tradeReason}
                    onChange={(e) => setTradeReason(e.target.value)}
                  />
                </div>

                {quantity && parseInt(quantity) > 0 && (() => {
                  const q = parseInt(quantity);
                  const baseValue = q * price;
                  const feeRate = user?.brokerFeeRate ?? 0.001425;
                  const minFee = user?.brokerMinFee ?? 20;
                  const taxRate = user?.brokerTaxRate ?? 0.003;
                  
                  const estFee = Math.max(minFee, Math.round(baseValue * feeRate));
                  const estTax = tradeMode === 'sell' ? Math.round(baseValue * taxRate) : 0;
                  const finalTotal = tradeMode === 'buy' ? baseValue + estFee : baseValue - estFee - estTax;

                  return (
                    <div className="trade-preview" style={{ background: '#f8f9fa', padding: '12px', borderRadius: '8px', marginTop: '12px' }}>
                      <div className="trade-preview-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#666', marginBottom: '4px' }}>
                        <span>股票市值</span>
                        <span>NT$ {formatMoney(baseValue)}</span>
                      </div>
                      <div className="trade-preview-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#666', marginBottom: '4px' }}>
                        <span>券商手續費</span>
                        <span>NT$ {formatMoney(estFee)}</span>
                      </div>
                      {tradeMode === 'sell' && (
                        <div className="trade-preview-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#666', marginBottom: '8px' }}>
                          <span>證交稅</span>
                          <span>NT$ {formatMoney(estTax)}</span>
                        </div>
                      )}
                      <div className="trade-preview-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: 'bold', color: 'var(--text-primary)', borderTop: '1px solid #ddd', paddingTop: '8px', marginTop: '4px' }}>
                        <span>預估{tradeMode === 'buy' ? '總花費' : '實收金額'}</span>
                        <span className={tradeMode === 'buy' ? '' : 'text-profit'}>NT$ {formatMoney(finalTotal)}</span>
                      </div>
                    </div>
                  );
                })()}

                {tradeResult && !tradeResult.success && (
                  <div className="trade-result trade-error">
                    {tradeResult.message}
                  </div>
                )}

                <button
                  className={`btn ${tradeMode === 'buy' ? 'btn-buy' : 'btn-sell'} btn-lg btn-block`}
                  disabled={isTrading}
                  onClick={() => {
                    if (!quantity || parseInt(quantity) <= 0) {
                      alert('⚠️ 請輸入大於 0 的正確交易股數！');
                      return;
                    }
                    if (!tradeReason.trim()) {
                      alert(`⚠️ 下單前請先填寫「投資筆記」，告訴 PPBear 為什麼想${tradeMode === 'buy' ? '買' : '賣'}這檔股票喔！`);
                      return;
                    }
                    handleTrade();
                  }}
                  style={isTrading ? { opacity: 0.85, cursor: 'not-allowed' } : {}}
                >
                  {isTrading ? (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                      <span style={{
                        width: 18, height: 18,
                        border: '3px solid rgba(255,255,255,0.4)',
                        borderTopColor: '#fff',
                        borderRadius: '50%',
                        display: 'inline-block',
                        animation: 'spin 0.7s linear infinite',
                        flexShrink: 0,
                      }} />
                      交易中，請稍候...
                    </span>
                  ) : `確認${tradeMode === 'buy' ? '買入' : '賣出'}`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {/* 風險警示彈窗 */}
      {showWarningModal && (
        <div className="modal-overlay">
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="modal-handle"></div>
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 40 }}>🐻‍❄️</span>
            </div>
            <h3 style={{ textAlign: 'center', color: '#cc0000', marginBottom: 4 }}>讓 PPBear 先警告你！</h3>
            <p style={{ textAlign: 'center', fontSize: 13, color: '#888', marginBottom: 16 }}>
              這次交易有 {pendingWarnings.length} 個地方需要注意，但你還是可以自己決定
            </p>

            {pendingWarnings.map((w, idx) => (
              <div key={idx} style={{
                background: '#fff8f8', border: '1.5px solid #ffcccc', borderRadius: 12,
                padding: '14px 16px', marginBottom: 12
              }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>{w.icon} <span style={{ fontWeight: 800, fontSize: 15, color: '#cc0000' }}>{w.title}</span></div>
                <p style={{ margin: '0 0 8px', fontSize: 14, color: '#333' }}>{w.message}</p>
                <div style={{ background: '#fff3cd', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: '#7a5800', lineHeight: 1.5 }}>
                  💡 <strong>投資教室：</strong> {w.tip}
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button
                className="btn"
                style={{ flex: 1, background: '#f5f5f5', color: '#555', fontWeight: 700 }}
                disabled={isTrading}
                onClick={() => setShowWarningModal(false)}
              >
                再想想🤔
              </button>
              <button
                className="btn btn-buy"
                style={{ flex: 1, background: '#cc4444' }}
                disabled={isTrading}
                onClick={doExecuteTrade}
              >
                {isTrading ? (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                      <span style={{
                        width: 16, height: 16,
                        border: '3px solid rgba(255,255,255,0.4)',
                        borderTopColor: '#fff',
                        borderRadius: '50%',
                        display: 'inline-block',
                        animation: 'spin 0.7s linear infinite',
                        flexShrink: 0,
                      }} />
                      交易中，請稍候...
                    </span>
                  ) : '我瞭解風险，還是要買'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
