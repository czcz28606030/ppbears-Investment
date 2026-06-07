import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchStockData, fetchSimonsData, fetchStockQuantData, fetchInstitutionCostData, fetchStockQuantHistory, fetchStockTradingSignals, fetchSimonsInstitutionCostData, toRecommendation, POPULAR_STOCKS, fetchTWSEStockPrice, fetchTPEXStockPrice, getOrGenerateKidFriendlyDesc, fetchTWSEDividendYields, getFreshStockAnalysis, calculateSimonsScore, clearQuantSignalTTLCache, clearSimonsDataTTLCache, fetchDailyAiCacheVersion, getKnownDailyAiCacheVersion, rememberDailyAiCacheVersion, fetchActiveEtfRadarMap, fetchSimonsRecommendationCounts } from '../api';
import type { ActiveEtfRadarItem, InstitutionCostData, SimonsInstitutionCostData, StockQuantData, StockQuantHistoryPoint } from '../api';
import type { TWSTEStockQuote, TPEXStockQuote } from '../api';
import { useStore, formatPrice, formatMoney } from '../store';
import type { StockData, StockPrice, StockRecommendation, StockLiveAnalysis, SimonsItem, StockTradingSignal } from '../types';
import StockChart from '../components/TradingViewChart';
import MarketBadge from '../components/MarketBadge';
import { calculateAddPriority } from '../utils/addPriority';
import { getIndustryTailwind, getIndustryTailwindScore } from '../utils/industryTailwinds';
import './StockDetail.css';

type ChipHistoryDays = 30 | 60;
const DAILY_AI_CACHE_POLL_MS = 90 * 1000;

function formatTrendDate(date: string): string {
  const [, month, day] = date.split('-');
  return month && day ? `${month}/${day}` : date;
}

function ChipStabilityTrendChart({
  points,
  days,
  loading,
}: {
  points: StockQuantHistoryPoint[];
  days: ChipHistoryDays;
  loading: boolean;
}) {
  const visiblePoints = points.slice(-days);
  const width = 640;
  const height = 190;
  const chart = { left: 38, top: 16, right: 14, bottom: 34 };
  const chartWidth = width - chart.left - chart.right;
  const chartHeight = height - chart.top - chart.bottom;
  const valueToY = (value: number) => chart.top + ((10 - value) / 10) * chartHeight;
  const xForIndex = (index: number) => {
    if (visiblePoints.length <= 1) return chart.left + chartWidth / 2;
    return chart.left + (index / (visiblePoints.length - 1)) * chartWidth;
  };

  const path = visiblePoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xForIndex(index).toFixed(1)} ${valueToY(point.chipPts).toFixed(1)}`)
    .join(' ');
  const areaPath = visiblePoints.length > 1
    ? `${path} L ${xForIndex(visiblePoints.length - 1).toFixed(1)} ${chart.top + chartHeight} L ${chart.left} ${chart.top + chartHeight} Z`
    : '';
  const latest = visiblePoints[visiblePoints.length - 1] ?? null;
  const first = visiblePoints[0] ?? null;
  const avg = visiblePoints.length > 0
    ? visiblePoints.reduce((sum, point) => sum + point.chipPts, 0) / visiblePoints.length
    : null;
  const delta = latest && first ? latest.chipPts - first.chipPts : null;
  const trendClass = delta === null ? 'flat' : delta >= 0.5 ? 'up' : delta <= -0.5 ? 'down' : 'flat';
  const trendLabel = delta === null ? '等待資料' : delta >= 0.5 ? '轉穩' : delta <= -0.5 ? '轉亂' : '持平';
  const labelIndexes = visiblePoints.length > 2
    ? [0, Math.floor((visiblePoints.length - 1) / 2), visiblePoints.length - 1]
    : visiblePoints.map((_, index) => index);

  return (
    <div className="chip-history-card">
      <div className="chip-history-summary">
        <div>
          <div className="chip-history-kicker">籌碼穩定度趨勢</div>
          <div className="chip-history-title">{days} 天追蹤</div>
        </div>
        <div className="chip-history-stats">
          <div>
            <span>最新</span>
            <strong>{latest ? latest.chipPts.toFixed(1) : '--'}</strong>
          </div>
          <div>
            <span>平均</span>
            <strong>{avg !== null ? avg.toFixed(1) : '--'}</strong>
          </div>
          <div className={`chip-history-trend ${trendClass}`}>
            <span>{trendLabel}</span>
            <strong>{delta !== null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}` : '--'}</strong>
          </div>
        </div>
      </div>

      <div className="chip-history-plot-wrap">
        {loading ? (
          <div className="chip-history-empty">正在讀取籌碼歷史資料...</div>
        ) : visiblePoints.length === 0 ? (
          <div className="chip-history-empty">目前還沒有歷史快照，今晚收集後會開始累積。</div>
        ) : (
          <svg className="chip-history-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`近 ${days} 天籌碼穩定度趨勢`}>
            {[0, 5, 10].map(value => (
              <g key={value}>
                <line
                  x1={chart.left}
                  x2={width - chart.right}
                  y1={valueToY(value)}
                  y2={valueToY(value)}
                  className="chip-history-grid-line"
                />
                <text x="8" y={valueToY(value) + 4} className="chip-history-axis-text">{value}</text>
              </g>
            ))}
            {areaPath && <path d={areaPath} className="chip-history-area" />}
            {path && <path d={path} className="chip-history-line" />}
            {visiblePoints.map((point, index) => (
              <circle
                key={`${point.date}-${index}`}
                cx={xForIndex(index)}
                cy={valueToY(point.chipPts)}
                r={index === visiblePoints.length - 1 ? 4.8 : 3.2}
                className={index === visiblePoints.length - 1 ? 'chip-history-dot latest' : 'chip-history-dot'}
              >
                <title>{`${point.date} ${point.chipPts.toFixed(1)} 分`}</title>
              </circle>
            ))}
            {labelIndexes.map(index => (
              <text
                key={`label-${index}`}
                x={xForIndex(index)}
                y={height - 10}
                textAnchor={index === 0 ? 'start' : index === visiblePoints.length - 1 ? 'end' : 'middle'}
                className="chip-history-axis-text"
              >
                {formatTrendDate(visiblePoints[index].date)}
              </text>
            ))}
          </svg>
        )}
      </div>

      <div className="chip-history-foot">
        <span>已累積 {visiblePoints.length} 筆</span>
        {latest && <span>最新日期 {latest.date}</span>}
      </div>
    </div>
  );
}

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
  const [quantLoading, setQuantLoading] = useState(true);
  const [institutionCostLoading, setInstitutionCostLoading] = useState(true);
  const [pageReleased, setPageReleased] = useState(false);
  const [isStockMiniBarVisible, setStockMiniBarVisible] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [kidDesc, setKidDesc] = useState('');
  const [liveAnalysis, setLiveAnalysis] = useState<StockLiveAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisRetryTick, setAnalysisRetryTick] = useState(0);
  const [tradeMode, setTradeMode] = useState<'buy' | 'sell' | null>(null);
  const [quantity, setQuantity] = useState('');
  const [tradeUnit, setTradeUnit] = useState<'share' | 'lot'>('share');
  const [tradeReason, setTradeReason] = useState('');
  const [tradeResult, setTradeResult] = useState<{ success: boolean; message: string } | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const [isTrading, setIsTrading] = useState(false);
  const [latestYield, setLatestYield] = useState<number | null>(null);
  const [quantData, setQuantData] = useState<StockQuantData | null>(null);
  const [quantHistory, setQuantHistory] = useState<StockQuantHistoryPoint[]>([]);
  const [quantHistoryDays, setQuantHistoryDays] = useState<ChipHistoryDays>(60);
  const [quantHistoryLoading, setQuantHistoryLoading] = useState(false);
  const [activeEtfRadar, setActiveEtfRadar] = useState<ActiveEtfRadarItem | null>(null);
  const [activeEtfLoading, setActiveEtfLoading] = useState(false);
  const [recommendationCount, setRecommendationCount] = useState(0);
  const [institutionCostData, setInstitutionCostData] = useState<InstitutionCostData | null>(null);
  const [simonsInstitutionCostData, setSimonsInstitutionCostData] = useState<SimonsInstitutionCostData | null>(null);
  const [tradingSignals, setTradingSignals] = useState<StockTradingSignal[]>([]);
  const [tradingSignalDate, setTradingSignalDate] = useState('');
  const [tradingSignalUpdatedAt, setTradingSignalUpdatedAt] = useState('');
  const [tradingSignalLoading, setTradingSignalLoading] = useState(false);
  const [tradingSignalError, setTradingSignalError] = useState<string | null>(null);
  const [showMa5, setShowMa5] = useState(true);
  const [showMa20, setShowMa20] = useState(true);
  const [chartRetrying, setChartRetrying] = useState(false);

  useLayoutEffect(() => {
    if (!code) return;
    setStockMiniBarVisible(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [code]);

  useEffect(() => {
    if (!pageReleased) {
      setStockMiniBarVisible(false);
      return;
    }

    const handleScroll = () => {
      setStockMiniBarVisible(window.scrollY > 260);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [pageReleased, code]);

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
  
  const { user, holdings, dataReady, executeBuy, executeSell, getPortfolioSummary, hasFeature, isInWatchlist, addToWatchlist, removeFromWatchlist } = useStore();
  const hasAiFeature = hasFeature('ai_stock_picking');
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
  type RiskWarning = {
    title: string;
    message: string;
    tip: string;
    icon: string;
    level?: 'info' | 'caution' | 'danger';
    details?: Array<{ label: string; value: string; tone?: 'normal' | 'profit' | 'loss' | 'warning' }>;
  };
  const [pendingWarnings, setPendingWarnings] = useState<RiskWarning[]>([]);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const analysisRequestRef = useRef<{ key: string; startedAt: number }>({ key: '', startedAt: 0 });

  const stockEmoji = POPULAR_STOCKS.find(s => s.code === code)?.emoji || '📊';

  useEffect(() => {
    // 切換到不同股票時，重置所有下單狀態，避免 isTrading 卡住
    setTradeMode(null);
    setQuantity('');
    setTradeUnit('share');
    setTradeReason('');
    setTradeResult(null);
    setIsTrading(false);
    setLiveAnalysis(null);
    setAnalysisError(null);
    setAnalysisRetryTick(0);
    setDescLoading(true);
    setQuantLoading(true);
    setInstitutionCostLoading(true);
    setPageReleased(false);
    analysisRequestRef.current = { key: '', startedAt: 0 };
    setStockData(null);
    setLatestPrice(null);
    setTwseQuote(null);
    setTpexQuote(null);
    setKidDesc('');
    setQuantData(null);
    setQuantHistory([]);
    setActiveEtfRadar(null);
    setRecommendationCount(0);
    setInstitutionCostData(null);
    setSimonsInstitutionCostData(null);
    setTradingSignals([]);
    setTradingSignalDate('');
    setTradingSignalUpdatedAt('');
    setTradingSignalError(null);
    if (code) loadStock(code);
  }, [code]);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setActiveEtfLoading(true);
    setActiveEtfRadar(null);
    setRecommendationCount(0);

    Promise.all([
      fetchActiveEtfRadarMap([code], 5),
      fetchSimonsRecommendationCounts([code], 90),
    ])
      .then(([radarMap, counts]) => {
        if (cancelled) return;
        setActiveEtfRadar(radarMap[code] ?? null);
        setRecommendationCount(counts[code] || 0);
      })
      .catch(() => {
        if (!cancelled) {
          setActiveEtfRadar(null);
          setRecommendationCount(0);
        }
      })
      .finally(() => {
        if (!cancelled) setActiveEtfLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (!code) return;
    if (!hasAiFeature) {
      setTradingSignals([]);
      setTradingSignalDate('');
      setTradingSignalUpdatedAt('');
      setTradingSignalLoading(false);
      setTradingSignalError(null);
      return;
    }

    let cancelled = false;
    setTradingSignalLoading(true);
    setTradingSignalError(null);
    fetchStockTradingSignals(code)
      .then(payload => {
        if (cancelled) return;
        if (!payload) {
          setTradingSignals([]);
          setTradingSignalDate('');
          setTradingSignalUpdatedAt('');
          setTradingSignalError('進出場訊號讀取失敗');
          return;
        }
        setTradingSignals(payload.signals);
        setTradingSignalDate(payload.dataDate);
        setTradingSignalUpdatedAt(payload.signalUpdatedAt);
      })
      .catch(() => {
        if (!cancelled) {
          setTradingSignals([]);
          setTradingSignalDate('');
          setTradingSignalUpdatedAt('');
          setTradingSignalError('進出場訊號讀取失敗');
        }
      })
      .finally(() => {
        if (!cancelled) setTradingSignalLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code, hasAiFeature, user?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadQuantHistory() {
      if (!code) return;
      setQuantHistoryLoading(true);
      const points = await fetchStockQuantHistory(code, 60);
      if (!cancelled) {
        setQuantHistory(points);
        setQuantHistoryLoading(false);
      }
    }

    void loadQuantHistory();
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (!code) return;
    const stockCode = code;
    let cancelled = false;
    async function checkSharedAiCacheVersion() {
      if (loading) return;
      const latest = await fetchDailyAiCacheVersion();
      if (cancelled || !latest?.version) return;
      const known = getKnownDailyAiCacheVersion('stock-detail');
      if (!known) {
        rememberDailyAiCacheVersion(latest.version, 'stock-detail');
        return;
      }
      if (latest.version !== known) {
        rememberDailyAiCacheVersion(latest.version, 'stock-detail');
        clearQuantSignalTTLCache();
        clearSimonsDataTTLCache();
        setQuantLoading(true);
        fetchSimonsData(undefined, { forceFresh: true })
          .then(items => {
            if (cancelled) return;
            const match = items.find(item => item.coid === stockCode);
            if (match) {
              setSimonsMeta(match);
              setRecommendation(toRecommendation(match));
            }
          })
          .catch(() => {});
        fetchStockQuantData(stockCode, undefined, { forceFresh: true })
          .then(qd => { if (!cancelled) setQuantData(qd); })
          .catch(() => {})
          .finally(() => { if (!cancelled) setQuantLoading(false); });
        fetchStockQuantHistory(stockCode, 60)
          .then(points => { if (!cancelled) setQuantHistory(points); })
          .catch(() => {});
      }
    }

    checkSharedAiCacheVersion();
    const timer = window.setInterval(checkSharedAiCacheVersion, DAILY_AI_CACHE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [code, loading]);

  async function loadStock(coid: string) {
    setLoading(true);
    setQuantLoading(true);
    setInstitutionCostLoading(true);
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

    // Simons 量化模型與籌碼成本非同步載入，但首次進頁會等它們結束後再揭露完整頁面。
    fetchStockQuantData(coid)
      .then(qd => setQuantData(qd))
      .catch(() => {})
      .finally(() => setQuantLoading(false));
    Promise.all([
      fetchInstitutionCostData(coid),
      fetchSimonsInstitutionCostData(coid),
    ])
      .then(([institutionData, simonsCostData]) => {
        setInstitutionCostData(institutionData);
        setSimonsInstitutionCostData(simonsCostData);
      })
      .catch(() => {})
      .finally(() => setInstitutionCostLoading(false));
  }

  async function retryStockChart() {
    if (!code || chartRetrying) return;
    setChartRetrying(true);
    try {
      const stockRes = await fetchStockData(code);
      if (stockRes) {
        setStockData(stockRes);
        const prices = stockRes.prices;
        if (prices?.length > 0) {
          setLatestPrice(prices[prices.length - 1]);
        }
      }
    } finally {
      setChartRetrying(false);
    }
  }

  // 【NEW】當量化數據加載完成時，如果是 Premium 會員且有 AI 推薦等級，重新用 Simons 評分計算
  useEffect(() => {
    if (!quantData?.aiQuanBackDataComment || !simonsMeta || !hasAiFeature) return;
    // 已有量化數據 + 是 Premium 會員 + 有 SimonsItem 原始數據 → 用 Simons 評分重新計算
    const simonsResult = calculateSimonsScore(simonsMeta, quantData);
    setRecommendation({
      ...simonsMeta,
      advice: simonsResult.advice,
      adviceText: simonsResult.text,
      kidAdvice: simonsResult.kidText,
      score: simonsResult.score,
    });
  }, [quantData, simonsMeta, hasAiFeature]);

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

  // 首屏只等待行情、量化與籌碼成本；公司介紹與 AI 三面向整理可用快取/背景補齊，
  // 避免外部 AI 或新聞來源延遲時把整個個股頁卡在進度畫面。
  const initialPageReady = !loading && !quantLoading && !institutionCostLoading;

  useEffect(() => {
    if (initialPageReady) {
      setPageReleased(true);
    }
  }, [initialPageReady]);

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

  const quantityNumber = parseInt(quantity, 10);
  const tradeShares = Number.isFinite(quantityNumber) && quantityNumber > 0
    ? quantityNumber * (tradeUnit === 'lot' ? 1000 : 1)
    : 0;
  const tradeUnitLabel = tradeUnit === 'lot' ? '張' : '股';

  async function handleTrade() {
    if (!code || !tradeMode || price <= 0) return;
    const qty = tradeShares;

    // ─── Only check risk on BUY ──────────────────────────────────────
    if (tradeMode === 'buy') {
      const warnings: RiskWarning[] = [];
      const totalAssets = summary.totalAssets;
      const buyAmount = qty * price;
      const feeRate = user?.brokerFeeRate ?? 0.001425;
      const minFee = user?.brokerMinFee ?? 20;
      const estimatedFee = Math.max(minFee, Math.round(buyAmount * feeRate));
      const finalBuyCost = buyAmount + estimatedFee;
      const stopLossPct = Math.min(80, Math.max(1, user?.stopLossAlertPct ?? 20));
      const stopLossPrice = price * (1 - stopLossPct / 100);
      const existingShares = holding?.totalShares ?? 0;
      const existingAvgCost = holding?.avgCost ?? 0;
      const existingCost = existingShares * existingAvgCost;
      const existingMarketValue = existingShares * price;
      const existingPnL = existingMarketValue - existingCost;
      const existingPnLPct = existingCost > 0 ? (existingPnL / existingCost) * 100 : 0;
      const newShares = existingShares + qty;
      const newAvgCost = newShares > 0 ? (existingCost + buyAmount) / newShares : price;
      const newPositionValue = newShares * price;
      const newPositionWeight = totalAssets > 0 ? (newPositionValue / totalAssets) * 100 : 0;
      const newPositionCost = existingCost + buyAmount;
      const balanceAfter = user ? user.availableBalance - finalBuyCost : null;
      const addOnStopLossLoss = Math.round(Math.max(0, price - stopLossPrice) * qty);
      const wholePositionStopLossPnL = Math.round((stopLossPrice - newAvgCost) * newShares);
      const addOnDetails: RiskWarning['details'] = holding ? [
        { label: '目前持股', value: `${existingShares.toLocaleString('zh-TW')} 股` },
        { label: '目前平均成本', value: `NT$ ${formatPrice(existingAvgCost)}` },
        { label: '目前價格', value: `NT$ ${formatPrice(price)}` },
        {
          label: '目前帳面損益',
          value: `${existingPnL >= 0 ? '+' : '-'}NT$ ${formatMoney(Math.abs(existingPnL))} (${existingPnLPct >= 0 ? '+' : ''}${existingPnLPct.toFixed(1)}%)`,
          tone: existingPnL >= 0 ? 'profit' : 'loss',
        },
        { label: '這次買入', value: `${qty.toLocaleString('zh-TW')} 股 / NT$ ${formatMoney(buyAmount)}` },
        { label: '預估含手續費花費', value: `NT$ ${formatMoney(finalBuyCost)}`, tone: 'warning' },
        { label: '買後總持股', value: `${newShares.toLocaleString('zh-TW')} 股` },
        { label: '買後平均成本', value: `NT$ ${formatPrice(newAvgCost)}`, tone: price < existingAvgCost ? 'warning' : 'normal' },
        { label: '買後總投入成本', value: `NT$ ${formatMoney(newPositionCost)}` },
        { label: '買後部位市值', value: `NT$ ${formatMoney(newPositionValue)}（總資產 ${newPositionWeight.toFixed(1)}%）`, tone: newPositionWeight > 15 ? 'warning' : 'normal' },
        { label: `跌到 -${stopLossPct}% 參考價`, value: `NT$ ${formatPrice(stopLossPrice)}` },
        { label: '本次加碼可能損失', value: `NT$ ${formatMoney(addOnStopLossLoss)}`, tone: 'loss' },
        {
          label: '整檔到參考價損益',
          value: `${wholePositionStopLossPnL >= 0 ? '+' : '-'}NT$ ${formatMoney(Math.abs(wholePositionStopLossPnL))}`,
          tone: wholePositionStopLossPnL >= 0 ? 'profit' : 'loss',
        },
        ...(balanceAfter !== null ? [{ label: '買後可用餘額', value: `NT$ ${formatMoney(balanceAfter)}`, tone: balanceAfter < 0 ? 'loss' : 'normal' } as const] : []),
      ] : undefined;

      // Risk 1: 買入後單一該股超過總資金 15%
      if (totalAssets > 0 && newPositionValue / totalAssets > 0.15) {
        const pct = newPositionWeight.toFixed(1);
        warnings.push({
          icon: '📦',
          title: '單一股票部位偏高',
          message: `買入後，「${stockData?.stkname || code}」將占你總資金的 ${pct}%，超過了建議的 15% 上限。`,
          tip: '部位太集中時，單一股票下跌會明顯影響整體資產。下單前請確認這不是因為一時看好而把資金壓得太集中。',
          level: 'danger',
          details: [
            { label: '買後部位市值', value: `NT$ ${formatMoney(newPositionValue)}` },
            { label: '買後總資產占比', value: `${pct}%`, tone: 'warning' },
            { label: '建議上限', value: '15%' },
          ],
        });
      }

      // Risk 2: 已持股再買，依獲利/攤平狀態顯示加碼後果
      if (holding) {
        if (price > holding.avgCost) {
          const profitRate = ((price - holding.avgCost) / holding.avgCost) * 100;
          warnings.push({
            icon: '📈',
            title: '獲利中加碼提醒',
            message: `目前這檔已有 ${profitRate.toFixed(1)}% 帳面獲利。獲利加碼可以是順勢，但買完後平均成本會提高，部位也會變大。`,
            tip: '請確認這次加碼是因為新的理由仍然成立，而不是因為目前賺錢就追高。加碼後如果回跌，原本獲利可能會被吃掉。',
            level: 'caution',
            details: addOnDetails,
          });
        } else if (price < holding.avgCost) {
          const lossRate = ((holding.avgCost - price) / holding.avgCost) * 100;
          const halfStopLossPct = stopLossPct / 2;
          const isOverStopLoss = lossRate >= stopLossPct;
          const isNearStopLoss = !isOverStopLoss && lossRate >= halfStopLossPct;
          warnings.push({
            icon: isOverStopLoss ? '🛑' : isNearStopLoss ? '🚨' : '⚠️',
            title: isOverStopLoss
              ? '超過停損提醒仍想攤平'
              : isNearStopLoss
                ? '接近停損區攤平警告'
                : '虧損中攤平警告',
            message: isOverStopLoss
              ? `目前已虧損 ${lossRate.toFixed(1)}%，超過你設定的 -${stopLossPct}% 停損提醒。這次買入會降低平均成本，但也會把更多資金放進正在虧損的股票。`
              : isNearStopLoss
                ? `目前已虧損 ${lossRate.toFixed(1)}%，接近你設定的 -${stopLossPct}% 停損提醒。攤平前要先確認走勢或理由是否真的改善。`
                : `目前已虧損 ${lossRate.toFixed(1)}%。攤平會讓平均成本下降，但帳面虧損不會消失，總投入金額會變大。`,
            tip: isOverStopLoss
              ? '這是最高風險加碼情境。請確認不是因為不想認賠而加碼；如果投資理由已經改變，先停下來比繼續投入更重要。'
              : '攤平不是降低風險，只是用更多資金換一個較低的平均成本。請把加碼後的總投入、總部位和可能損失一起看。',
            level: isOverStopLoss || isNearStopLoss ? 'danger' : 'caution',
            details: addOnDetails,
          });
        } else {
          warnings.push({
            icon: '⚖️',
            title: '接近成本加碼提醒',
            message: '目前價格接近你的平均成本。這次買入後部位會變大，後續上漲或下跌對帳戶的影響也會放大。',
            tip: '加碼前請先確認這筆新增資金的目的，是提高長期部位，還是只是因為價格沒有明顯變動就順手買進。',
            level: 'info',
            details: addOnDetails,
          });
        }
      }

      // Risk 3: 一次買超過現有持股的 1/3
      if (holding && holding.totalShares > 0) {
        const oneThirdShares = holding.totalShares / 3;
        if (qty > oneThirdShares) {
          const addOnPct = (qty / holding.totalShares) * 100;
          warnings.push({
            icon: '⚠️',
            title: '一次加碼太多了！',
            message: `你已持有 ${holding.totalShares.toLocaleString('zh-TW')} 股，這次想再買 ${qty.toLocaleString('zh-TW')} 股，等於現持股的 ${addOnPct.toFixed(1)}%，超過建議的 1/3。`,
            tip: '穩健的加碼方式通常是分批，而不是一次把部位拉大。請確認這筆單就算判斷錯了，帳戶仍然承受得住。',
            level: 'danger',
            details: [
              { label: '目前持股', value: `${holding.totalShares.toLocaleString('zh-TW')} 股` },
              { label: '本次加碼', value: `${qty.toLocaleString('zh-TW')} 股` },
              { label: '加碼比例', value: `${addOnPct.toFixed(1)}%`, tone: 'warning' },
              { label: '建議上限', value: `${Math.floor(oneThirdShares).toLocaleString('zh-TW')} 股以內` },
            ],
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
    const qty = tradeShares;

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
        setTradeUnit('share');
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
  const marketBadge = twseQuote
    ? 'listed' as const
    : tpexQuote
      ? 'otc' as const
      : null;
  const stockDisplayName = stockData?.stkname || twseQuote?.Name || tpexQuote?.CompanyName || '';
  const chartPrices = Array.isArray(stockData?.prices) ? stockData.prices : [];
  const hasChartPrices = chartPrices.length > 0;
  const finmindFlowItems = institutionCostData?.finmind?.items || [];
  const formatFlowShares = (shares: number) => {
    const lots = Math.round(shares / 1000);
    return `${lots >= 0 ? '+' : ''}${lots.toLocaleString()}張`;
  };

  const goodinfoCostMap = new Map(
    (institutionCostData?.items || [])
      .filter(item => item.estimatedCost !== null && item.estimatedCost > 0)
      .map(item => [item.key, item.estimatedCost as number])
  );
  const parseCostValue = (value: string | number | null | undefined): number | null => {
    const n = typeof value === 'number'
      ? value
      : parseFloat(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const recommendationCostData: SimonsInstitutionCostData | null = recommendation && (
    parseCostValue(recommendation.fcost) ||
    parseCostValue(recommendation.tcost) ||
    parseCostValue(recommendation.dcost) ||
    parseCostValue(recommendation.wtcost)
  ) ? {
      coid: recommendation.coid,
      stockName: recommendation.stkname,
      date: recommendation.mdate,
      source: 'simons-recommendation',
      foreignCost: parseCostValue(recommendation.fcost),
      trustCost: parseCostValue(recommendation.tcost),
      dealerCost: parseCostValue(recommendation.dcost),
      weightedAverage: parseCostValue(recommendation.wtcost),
      close: parseCostValue(recommendation.close),
    } : null;
  const activeSimonsCostData = simonsInstitutionCostData || recommendationCostData;
  const buildChipCostItem = (
    key: 'foreign' | 'trust' | 'dealer',
    label: string,
    shortLabel: string,
    simonsValue: number | null | undefined,
    color: string
  ) => {
    const simonsCost = simonsValue || 0;
    const goodinfoCost = goodinfoCostMap.get(key) || 0;
    const value = simonsCost > 0 ? simonsCost : goodinfoCost;
    if (value <= 0) return null;
    return {
      key,
      label,
      shortLabel,
      value,
      color,
      source: simonsCost > 0 ? '⭐ Simons' : 'IFAlgo原資料',
      sourceKind: simonsCost > 0 ? 'simons' as const : 'fallback' as const,
      isEstimated: simonsCost <= 0,
    };
  };
  const chipCostItems = [
    buildChipCostItem('foreign', '外資成本', '外資', activeSimonsCostData?.foreignCost, '#10b981'),
    buildChipCostItem('trust', '投信成本', '投信', activeSimonsCostData?.trustCost, '#3b82f6'),
    buildChipCostItem('dealer', '自營商成本', '自營商', activeSimonsCostData?.dealerCost, '#8b5cf6'),
  ].filter((item): item is NonNullable<typeof item> => item !== null);
  const chipCostSources = Array.from(
    new Map(chipCostItems.map(item => [item.source, { label: item.source, kind: item.sourceKind }])).values()
  );
  const hasGoodinfoEstimatedCost = chipCostItems.some(item => item.isEstimated);
  const simonsWeightedAverageCost = activeSimonsCostData?.weightedAverage || 0;
  const avgInstitutionCost = simonsWeightedAverageCost > 0
    ? simonsWeightedAverageCost
    : chipCostItems.length > 0
      ? chipCostItems.reduce((sum, item) => sum + item.value, 0) / chipCostItems.length
      : 0;
  const avgInstitutionCostLabel = simonsWeightedAverageCost > 0
    ? 'Simons 加權平均成本'
    : '法人平均估算成本';
  const latestChipCostSourceDate = activeSimonsCostData?.date || '';
  const belowInstitutionCosts = chipCostItems.filter(item => price > 0 && price < item.value);
  const nearestInstitutionCost = chipCostItems.length > 0
    ? chipCostItems.reduce((prev, current) =>
      Math.abs(current.value - price) < Math.abs(prev.value - price) ? current : prev
    )
    : null;
  const costGapPct = avgInstitutionCost > 0 && price > 0
    ? ((price - avgInstitutionCost) / avgInstitutionCost) * 100
    : null;
  const chipCostStatus = chipCostItems.length === 0 ? '尚無法人成本' :
    belowInstitutionCosts.length >= 2 ? '低於多數法人估算成本' :
    belowInstitutionCosts.length === 1 ? '接近法人估算成本區' : '高於主要法人估算成本';
  const chipCostStatusClass = chipCostItems.length === 0 ? 'sm-badge-mute' :
    belowInstitutionCosts.length >= 2 ? 'sm-badge-good' :
    belowInstitutionCosts.length === 1 ? 'sm-badge-warn' : 'sm-badge-bad';
  const chipCostSummary = chipCostItems.length === 0
    ? '這檔目前沒有抓到外資、投信或自營商成本資料，可以先看技術線圖和即時整理。'
    : belowInstitutionCosts.length >= 2
      ? '現價仍低於多數法人平均布局區，單看籌碼成本不算追高。'
      : belowInstitutionCosts.length === 1
        ? '現價貼近部分法人成本，適合搭配技術線圖確認是否有續航力。'
        : '現價已高於主要法人成本，代表市場先漲一段，追價前要更謹慎。';
  const tvChartSubtitle = hasAiFeature
    ? tradingSignalLoading
      ? '日K · MA5 · MA20 · 成交量 · 進出場訊號讀取中'
      : tradingSignalDate
        ? `日K · MA5 · MA20 · 成交量 · IFAlgo訊號 ${tradingSignalDate}`
        : '日K · MA5 · MA20 · 成交量 · 會員進出場訊號'
    : '日K · MA5 · MA20 · 成交量';
  const tvChartSignalNote = hasAiFeature
    ? tradingSignalError
      ? tradingSignalError
      : tradingSignalDate
        ? `IFAlgo 進出場訊號資料日期：${tradingSignalDate}${tradingSignalUpdatedAt ? `；訊號更新：${tradingSignalUpdatedAt.slice(0, 10)}` : ''}。綠箭頭代表前方未結束模型訊號出清或結束。`
        : tradingSignalLoading
          ? '正在讀取 IFAlgo 進出場訊號...'
          : '目前沒有可顯示的 IFAlgo 進出場訊號'
    : '';

  const parsePercentValue = (value: string | null | undefined): number | null => {
    const parsed = parseFloat(String(value ?? '').replace('%', '').replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  };
  const activeEtfLabel = activeEtfRadar
    ? activeEtfRadar.holdingEtfCount > 0
      ? `ETF+${activeEtfRadar.holdingEtfCount}`
      : 'ETF支撐 無'
    : activeEtfLoading
      ? 'ETF支撐 讀取中'
      : 'ETF支撐 無紀錄';
  const activeEtfTone = activeEtfRadar?.signal ?? 'neutral';
  const currentAiSignal = hasAiFeature ? quantData?.currentSignal ?? 'neutral' : 'neutral';
  const currentAiSignalLabel = currentAiSignal === 'buy' ? 'AI進場' : currentAiSignal === 'sell' ? 'AI出場' : 'AI中立';
  const chipPtsValue = quantData?.chipStability ? parseFloat(quantData.chipStability.pts) : null;
  const cumRetPct = parsePercentValue(quantData?.aiQuanBackDataComment?.cum_ret);
  const tailwind = code ? getIndustryTailwind(code) : null;
  const tailwindScore = code ? getIndustryTailwindScore(code) : null;
  const addPriority = calculateAddPriority({
    simonsScore: recommendation?.score ?? null,
    aiSignal: currentAiSignal,
    techTailwindScore: tailwindScore,
    activeEtfScore: activeEtfRadar?.score ?? null,
    activeEtfSignal: activeEtfRadar?.signal ?? null,
    recommendationCount,
    chipPts: chipPtsValue,
    cumRetPct,
  });
  const addPriorityCaution = cumRetPct !== null && cumRetPct > 35
    ? '累積報酬已偏高，代表模型歷史表現強，但也可能已有一段漲幅；加碼時要控制部位，不適合只因分數高就追價。'
    : currentAiSignal === 'sell'
      ? '目前 AI 訊號偏出場，若仍想加碼，應先確認股價、籌碼與原本投資理由是否仍成立。'
      : addPriority.level === 'strong'
        ? '目前條件較集中，可以優先研究加碼，但仍需搭配部位大小與停損設定。'
        : addPriority.level === 'avoid'
          ? '目前條件不夠集中，系統判斷偏向暫緩，先觀察比急著加碼更合理。'
          : '目前條件有部分支持，但還不是全數集中，適合小心評估而不是一次把部位拉大。';
  const addPriorityMetrics = [
    {
      key: 'simons',
      label: '股票本質',
      value: recommendation?.score ?? null,
      display: recommendation ? `${recommendation.score}分` : '尚無資料',
      note: 'Simons量化評分',
    },
    {
      key: 'tailwind',
      label: '科技順風',
      value: tailwindScore !== null ? tailwindScore * 10 : null,
      display: tailwindScore !== null ? `${tailwindScore}/10` : '未列入',
      note: tailwind?.label || '產業受惠鏈',
    },
    {
      key: 'activeEtf',
      label: 'ETF支撐',
      value: activeEtfRadar?.score ?? null,
      display: activeEtfRadar ? `${activeEtfRadar.score}分` : activeEtfLoading ? '讀取中' : '無紀錄',
      note: activeEtfRadar ? activeEtfLabel : '近5日資金流',
    },
    {
      key: 'chip',
      label: '籌碼穩定',
      value: chipPtsValue !== null && Number.isFinite(chipPtsValue) ? chipPtsValue * 10 : null,
      display: chipPtsValue !== null && Number.isFinite(chipPtsValue) ? `${chipPtsValue.toFixed(1)}/10` : '尚無資料',
      note: '籌碼乾淨程度',
    },
    {
      key: 'recCount',
      label: '推薦次數',
      value: Math.min(recommendationCount, 6) / 6 * 100,
      display: `${recommendationCount}次`,
      note: '近90日重複出現',
    },
    {
      key: 'cumRet',
      label: '累積報酬',
      value: cumRetPct !== null ? Math.min(Math.abs(cumRetPct), 100) : null,
      display: cumRetPct !== null ? `${cumRetPct >= 0 ? '+' : ''}${cumRetPct.toFixed(1)}%` : '尚無資料',
      note: cumRetPct !== null && cumRetPct > 35 ? '偏高要防追價' : '回測參考',
    },
  ];
  const getActiveEtfActionLabel = (action: ActiveEtfRadarItem['etfs'][number]['action']): string => {
    switch (action) {
      case 'added': return '新進';
      case 'increased': return '加碼';
      case 'decreased': return '減碼';
      case 'removed': return '剔除';
      case 'held': return '持有';
      default: return '持有';
    }
  };
  const formatEtfWeight = (value: number | null): string => (
    value === null || !Number.isFinite(value) ? '--' : `${value.toFixed(2)}%`
  );
  const formatEtfShares = (value: number | null | undefined): string => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '--';
    return Math.round(value).toLocaleString('zh-TW');
  };
  const formatEtfShareChange = (value: number | null | undefined, action: ActiveEtfRadarItem['etfs'][number]['action']): string => {
    if (action === 'added') return '新上榜';
    if (action === 'removed') return '移出';
    if (value === null || value === undefined || !Number.isFinite(value)) return '--';
    if (value === 0) return '持平';
    return `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString('zh-TW')}`;
  };

  const loadingSteps = [
    { label: '股價與基本資料', done: !loading },
    { label: '技術線與量化訊號', done: !loading && !quantLoading },
    { label: '籌碼面成本資料', done: !loading && !institutionCostLoading },
    { label: 'PPBear 公司介紹', done: !loading && !descLoading },
    { label: 'AI 三面向整理', done: !loading && !analysisLoading },
  ];
  const loadingDoneCount = loadingSteps.filter(step => step.done).length;
  const loadingProgress = Math.max(8, Math.round((loadingDoneCount / loadingSteps.length) * 100));
  const currentLoadingStep = loadingSteps.find(step => !step.done)?.label || '準備公布完整個股頁';

  if (!pageReleased) {
    return (
      <div className="stock-detail">
        <div className="page-header">
          <button className="page-header-back" onClick={() => navigate(-1)}>←</button>
          <h1 className="page-title">{code ? `${code} 資料整理中` : '載入中...'}</h1>
        </div>
        <div className="stock-loading-panel">
          <div className="stock-loading-orbit">
            <img src="/ppbear.png" alt="PPBear" />
            <span />
          </div>
          <div className="stock-loading-title">正在整理完整個股資料</div>
          <div className="stock-loading-subtitle">
            目前進度：{currentLoadingStep}
          </div>
          <div className="stock-loading-progress" aria-label={`載入進度 ${loadingProgress}%`}>
            <div style={{ width: `${loadingProgress}%` }} />
          </div>
          <div className="stock-loading-percent">{loadingProgress}%</div>
          <div className="stock-loading-steps">
            {loadingSteps.map(step => (
              <div
                className={`stock-loading-step ${step.done ? 'done' : step.label === currentLoadingStep ? 'active' : 'pending'}`}
                key={step.label}
              >
                <span>{step.done ? '✓' : ''}</span>
                <strong>{step.label}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stock-detail">
      <div className={`stock-context-bar ${isStockMiniBarVisible ? 'is-visible' : ''}`}>
        <button
          type="button"
          className="stock-context-bar-inner"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="回到個股頁上方"
        >
          <span className="stock-context-identity">
            <span className="stock-context-code">{code}</span>
            <span className="stock-context-name">{stockDisplayName || '個股資料'}</span>
          </span>
          <span className="stock-context-price">
            <strong>NT$ {formatPrice(price)}</strong>
            <span className={isUp ? 'text-profit' : 'text-loss'}>
              {isUp ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
            </span>
          </span>
        </button>
      </div>

      {/* Header */}
      <div className="page-header" style={{ justifyContent: 'space-between', borderBottom: 'none', paddingBottom: 0 }}>
        <button className="page-header-back" onClick={() => navigate(-1)}>←</button>
        <span className="detail-code" style={{ opacity: 0.5 }}>{code}</span>
      </div>

      {/* 價格區 */}
      <div className="price-hero" style={{ textAlign: 'center', paddingTop: '12px' }}>
        <div className="stock-title-line">
          <MarketBadge market={marketBadge} />
          <span className="stock-title-symbol">{stockEmoji}</span>
          <span>{code} {stockDisplayName}</span>
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

      {/* 📈 技術線圖（使用 ifalgo K 線資料） */}
      {code && (
        <div className="card tv-chart-card">
          <div className="tv-chart-header">
            <div className="tv-chart-heading">
              <span className="tv-chart-title">📈 技術線圖</span>
              <span className="tv-chart-subtitle">{tvChartSubtitle}</span>
            </div>
            <div className="tv-chart-controls" aria-label="均線顯示設定">
              <button
                type="button"
                className={`tv-chart-toggle ${showMa5 ? 'active ma5' : ''}`}
                aria-pressed={showMa5}
                onClick={() => setShowMa5(value => !value)}
              >
                MA5
              </button>
              <button
                type="button"
                className={`tv-chart-toggle ${showMa20 ? 'active ma20' : ''}`}
                aria-pressed={showMa20}
                onClick={() => setShowMa20(value => !value)}
              >
                MA20
              </button>
            </div>
          </div>
          {hasAiFeature && tvChartSignalNote && (
            <div className={`tv-chart-signal-note ${tradingSignalError ? 'is-error' : ''}`}>
              {!tradingSignalError && tradingSignals.length > 0 && (
                <span className="tv-chart-signal-legend">
                  <span><i className="tv-signal-arrow entry">↑</i>建立 / 加碼</span>
                  <span><i className="tv-signal-arrow exit">↓</i>出清 / 結束</span>
                </span>
              )}
              <span>{tvChartSignalNote}</span>
            </div>
          )}
          <div className="tv-chart-wrapper">
            {hasChartPrices ? (
              <StockChart
                prices={chartPrices}
                stockName={stockData?.stkname || stockDisplayName || code}
                tradingSignals={hasAiFeature ? tradingSignals : undefined}
                showMa5={showMa5}
                showMa20={showMa20}
              />
            ) : (
              <div className="tv-chart-fallback">
                <div className="tv-chart-fallback-icon">📈</div>
                <div className="tv-chart-fallback-text">
                  技術線圖資料暫時沒有載入成功，股價資訊仍會先用官方收盤資料顯示。
                </div>
                <button
                  type="button"
                  className="tv-chart-fallback-btn"
                  onClick={retryStockChart}
                  disabled={chartRetrying}
                >
                  {chartRetrying ? '重新讀取中...' : '重新讀取線圖'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <section className={`card add-decision-card add-decision-card-${addPriority.level}`}>
        <div className="add-decision-header">
          <div>
            <div className="add-decision-kicker">加碼決策雷達</div>
            <div className="add-decision-title">
              <span>加碼時機</span>
              <strong>{addPriority.score}分</strong>
              <em>{addPriority.label}</em>
            </div>
          </div>
          <div className={`add-decision-etf-badge add-decision-etf-${activeEtfTone}`}>
            {activeEtfLabel}
          </div>
        </div>

        <div className="add-decision-summary">
          <div>
            <span>主要理由</span>
            <strong>{addPriority.reason}</strong>
          </div>
          <div>
            <span>AI狀態</span>
            <strong>{currentAiSignalLabel}</strong>
          </div>
          <div>
            <span>判讀提醒</span>
            <p>{addPriorityCaution}</p>
          </div>
        </div>

        <div className="add-decision-grid">
          {addPriorityMetrics.map(metric => (
            <div className="add-decision-metric" key={metric.key}>
              <div className="add-decision-metric-top">
                <span>{metric.label}</span>
                <strong>{metric.display}</strong>
              </div>
              <div className="add-decision-meter" aria-hidden="true">
                <div style={{ width: `${metric.value !== null ? Math.max(4, Math.min(metric.value, 100)) : 0}%` }} />
              </div>
              <small>{metric.note}</small>
            </div>
          ))}
        </div>

        <details className="add-decision-details">
          <summary>查看 ETF 支撐明細與分數來源</summary>
          <div className="add-decision-detail-body">
            <div className="add-decision-detail-block">
              <div className="add-decision-detail-title">ETF 支撐近5日資金流</div>
              {activeEtfRadar ? (
                <>
                  <div className="add-decision-etf-stats">
                    <span>新進 {activeEtfRadar.addedEtfCount}</span>
                    <span>加碼 {activeEtfRadar.increasedEtfCount}</span>
                    <span>減碼 {activeEtfRadar.decreasedEtfCount}</span>
                    <span>剔除 {activeEtfRadar.removedEtfCount}</span>
                    <span>淨權重 {activeEtfRadar.netWeightChangePct >= 0 ? '+' : ''}{activeEtfRadar.netWeightChangePct.toFixed(2)}%</span>
                  </div>
                  <div className="add-decision-etf-table" role="table" aria-label="ETF 支撐明細">
                    <div className="add-decision-etf-table-head" role="row">
                      <span>基金名稱</span>
                      <span>持有比例</span>
                      <span>持股增減</span>
                    </div>
                    {activeEtfRadar.etfs.map(etf => (
                      <div className={`add-decision-etf-table-row add-decision-etf-row-${etf.action}`} key={`${etf.etfCode}-${etf.action}`} role="row">
                        <div className="add-decision-etf-name">
                          <strong>{etf.etfName || etf.etfCode}</strong>
                          <span>{etf.etfCode} · {getActiveEtfActionLabel(etf.action)}</span>
                        </div>
                        <div>
                          <strong>{formatEtfWeight(etf.weightPct)}</strong>
                          <span>變動 {formatEtfWeight(etf.weightChangePct)}</span>
                        </div>
                        <div>
                          <strong>{formatEtfShareChange(etf.shareChange, etf.action)}</strong>
                          <span>持股 {formatEtfShares(etf.shares)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="add-decision-footnote">資料日：{activeEtfRadar.latestDate || '待同步'}；來源：{activeEtfRadar.source}</p>
                </>
              ) : (
                <p className="add-decision-empty">
                  {activeEtfLoading ? '正在讀取 ETF 支撐資料...' : '近5日沒有看到追蹤 ETF 對這檔股票的新進、加碼、減碼或剔除紀錄。'}
                </p>
              )}
            </div>

            <div className="add-decision-detail-block">
              <div className="add-decision-detail-title">加碼時機怎麼算</div>
              <p>
                分數會綜合股票本質、科技順風、ETF支撐、籌碼穩定、推薦次數與累積報酬，再依 AI 進出場與 ETF 多空訊號加減分。
              </p>
              <p>
                這個分數用來回答「現在是否值得優先研究加碼」，不等於自動買進；真正下單前仍需看部位大小、平均成本與停損設定。
              </p>
            </div>
          </div>
        </details>
      </section>

      {/* 籌碼面摘要：讓大戶平均成本區回到個股頁主要視線內 */}
      <div className="card chip-cost-summary-card">
        <div className="chip-cost-summary-head">
          <div>
            <div className="chip-cost-summary-title">🧮 籌碼面</div>
            <div className="chip-cost-summary-subtitle">
              法人估算成本區與現在價格比較
              {chipCostSources.length > 0 && (
                <span className="chip-cost-source-row">
                  來源：
                  {chipCostSources.map(source => (
                    <span
                      className={`chip-cost-source ${source.kind === 'simons' ? 'chip-cost-source-simons' : ''}`}
                      key={source.label}
                    >
                      {source.label}
                      {source.kind === 'simons' && latestChipCostSourceDate ? ` ${latestChipCostSourceDate}` : ''}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </div>
          <span className={`sm-badge ${chipCostStatusClass}`}>{chipCostStatus}</span>
        </div>

        <div className="chip-cost-summary-main">
          <div className="chip-cost-main-metric">
            <span className="chip-cost-main-label">{avgInstitutionCostLabel}</span>
            <strong>{avgInstitutionCost > 0 ? `NT$ ${avgInstitutionCost.toFixed(2)}` : '--'}</strong>
            {costGapPct !== null && (
              <small className={costGapPct <= 0 ? 'text-profit' : 'text-loss'}>
                現價{costGapPct <= 0 ? '低於' : '高於'}均價 {Math.abs(costGapPct).toFixed(1)}%
              </small>
            )}
          </div>

          <div className="chip-cost-mini-metrics">
            <div>
              <span>現在價格</span>
              <strong>NT$ {formatPrice(price)}</strong>
            </div>
            <div>
              <span>低於幾個法人估算成本</span>
              <strong>{belowInstitutionCosts.length} / {chipCostItems.length || 3}</strong>
            </div>
            <div>
              <span>最近成本位置</span>
              <strong>{nearestInstitutionCost?.shortLabel || '--'}</strong>
            </div>
          </div>
        </div>

        <div className="chip-cost-pill-row">
          {chipCostItems.length > 0 ? chipCostItems.map(item => (
            <div className="chip-cost-pill" key={item.key} style={{ '--chip-cost-color': item.color } as React.CSSProperties}>
              <span>{item.label}</span>
              <strong>
                NT$ {item.value.toFixed(2)}
                {item.isEstimated && <em>估</em>}
              </strong>
            </div>
          )) : (
            <div className="chip-cost-empty">暫時沒有外資、投信、自營商成本資料</div>
          )}
        </div>

        <div className="chip-cost-summary-footer">
          <p>{chipCostSummary}</p>
          {finmindFlowItems.length > 0 && (
            <div className="chip-cost-flow-row">
              <span className="chip-cost-flow-label">FinMind近10日</span>
              {finmindFlowItems.map(item => (
                <span
                  className={`chip-cost-flow-pill ${item.netShares >= 0 ? 'chip-cost-flow-buy' : 'chip-cost-flow-sell'}`}
                  key={item.key}
                >
                  {item.label} {formatFlowShares(item.netShares)}
                </span>
              ))}
            </div>
          )}
          {hasGoodinfoEstimatedCost && institutionCostData?.note && (
            <p className="chip-cost-note">{institutionCostData.period} Goodinfo：{institutionCostData.note}</p>
          )}
          {institutionCostData?.finmind?.note && (
            <p className="chip-cost-note">{institutionCostData.finmind.period} FinMind：{institutionCostData.finmind.note}</p>
          )}
        </div>
      </div>

      {/* 公司介紹 */}
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
            <div className="stock-live-analysis-subtitle">整合今日技術面、籌碼面與消息面重點，資料會使用每日快取</div>
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
            {quantData?.aiQuanBackDataComment && hasAiFeature ? (
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
      {quantData && hasAiFeature && (() => {
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
                  <div className="sm-card-sub">股票本質（GVI 推導）</div>
                </div>
                <span className={`sm-badge ${chipClass}`}>{chipLabel}</span>
              </div>
              {activeTooltip === 'simonsChip' && (
                <TooltipBox id="simonsChip">
                  <p><strong>籌碼穩定度</strong></p>
                  <p>股票本質 = 地基，由 GVI 氣動指數推導而來。數值越高，代表籌碼越乾淨，主力掌控力越強；加碼時機 = 進場燈號，用來判斷現在是否適合加碼。</p>
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

            <div className="chip-history-shell">
              <div className="chip-history-toolbar" role="tablist" aria-label="籌碼穩定度天數">
                {[30, 60].map(days => (
                  <button
                    key={days}
                    type="button"
                    className={`chip-history-range-btn ${quantHistoryDays === days ? 'active' : ''}`}
                    onClick={() => setQuantHistoryDays(days as ChipHistoryDays)}
                    role="tab"
                    aria-selected={quantHistoryDays === days}
                  >
                    {days}天
                  </button>
                ))}
              </div>
              <ChipStabilityTrendChart
                points={quantHistory}
                days={quantHistoryDays}
                loading={quantHistoryLoading}
              />
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
      {!dataReady && (
        <div style={{
          background: 'rgba(255, 160, 0, 0.1)',
          border: '1px solid rgba(255, 160, 0, 0.35)',
          borderRadius: 10,
          padding: '10px 16px',
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: '0.85rem',
          color: '#b07000',
        }}>
          <span style={{ width: 14, height: 14, border: '2px solid #FFA000', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          帳號資料同步中，請稍候再下單以確保數據正確
        </div>
      )}
      <div className="trade-buttons">
        <button
          className="btn btn-buy btn-lg"
          style={{ flex: 1, opacity: dataReady ? 1 : 0.45, cursor: dataReady ? 'pointer' : 'not-allowed' }}
          disabled={!dataReady}
          onClick={() => { setTradeMode('buy'); setTradeResult(null); }}
        >
          {dataReady ? '🛒 買入' : '⏳ 同步中...'}
        </button>
        <button
          className="btn btn-sell btn-lg"
          style={{ flex: 1, opacity: dataReady ? 1 : 0.45, cursor: (!holding || !dataReady) ? 'not-allowed' : 'pointer' }}
          disabled={!holding || !dataReady}
          onClick={() => { setTradeMode('sell'); setTradeResult(null); }}
        >
          {dataReady ? '💰 賣出' : '⏳ 同步中...'}
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
                  <div className="trade-unit-header">
                    <label className="input-label">交易單位</label>
                    <div className="trade-unit-toggle" role="group" aria-label="選擇交易單位">
                      <button
                        type="button"
                        className={`trade-unit-btn${tradeUnit === 'share' ? ' active' : ''}`}
                        onClick={() => setTradeUnit('share')}
                      >
                        股
                      </button>
                      <button
                        type="button"
                        className={`trade-unit-btn${tradeUnit === 'lot' ? ' active' : ''}`}
                        onClick={() => setTradeUnit('lot')}
                      >
                        張
                      </button>
                    </div>
                  </div>
                  <input
                    className="input-field"
                    type="number"
                    min="1"
                    step="1"
                    placeholder={tradeUnit === 'lot' ? '輸入要交易的張數' : '輸入要交易的股數'}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                  <div className="trade-unit-hint">
                    {quantity && tradeShares > 0
                      ? `${quantity} ${tradeUnitLabel} = ${tradeShares.toLocaleString('zh-TW')} 股`
                      : tradeUnit === 'lot'
                        ? '1 張 = 1,000 股'
                        : '以 1 股為單位交易'}
                  </div>
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

                {quantity && tradeShares > 0 && (() => {
                  const q = tradeShares;
                  const baseValue = q * price;
                  const feeRate = user?.brokerFeeRate ?? 0.001425;
                  const minFee = user?.brokerMinFee ?? 20;
                  const taxRate = user?.brokerTaxRate ?? 0.003;
                  
                  const estFee = Math.max(minFee, Math.round(baseValue * feeRate));
                  const estTax = tradeMode === 'sell' ? Math.round(baseValue * taxRate) : 0;
                  const finalTotal = tradeMode === 'buy' ? baseValue + estFee : baseValue - estFee - estTax;
                  const stopLossPct = Math.min(80, Math.max(1, user?.stopLossAlertPct ?? 20));
                  const stopLossPrice = price * (1 - stopLossPct / 100);
                  const estimatedStopLossLoss = Math.round((price - stopLossPrice) * q);
                  const affordableLossPct = user?.availableBalance
                    ? (estimatedStopLossLoss / Math.max(user.availableBalance, 1)) * 100
                    : 0;

                  return (
                    <div className="trade-preview" style={{ background: '#f8f9fa', padding: '12px', borderRadius: '8px', marginTop: '12px' }}>
                      <div className="trade-preview-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#666', marginBottom: '4px' }}>
                        <span>交易股數</span>
                        <span>{q.toLocaleString('zh-TW')} 股</span>
                      </div>
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
                      {tradeMode === 'buy' && (
                        <div className="trade-risk-preview" style={{ marginTop: 12, padding: '12px', borderRadius: 12, background: 'rgba(255, 89, 94, 0.08)', border: '1.5px solid rgba(255, 89, 94, 0.22)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                            <span style={{ fontWeight: 900, color: '#c62828', fontSize: 14 }}>🛡️ 停損風險預估</span>
                            <span style={{ fontSize: 12, fontWeight: 900, color: '#c62828', background: '#fff', borderRadius: 999, padding: '3px 8px' }}>
                              -{stopLossPct}%
                            </span>
                          </div>
                          <div className="trade-preview-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#666', marginBottom: '4px' }}>
                            <span>停損參考價</span>
                            <span>NT$ {formatPrice(stopLossPrice)}</span>
                          </div>
                          <div className="trade-preview-row" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#666', marginBottom: '4px' }}>
                            <span>跌到停損時預估損失</span>
                            <span style={{ color: '#c62828', fontWeight: 900 }}>NT$ {formatMoney(estimatedStopLossLoss)}</span>
                          </div>
                          <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.5, color: '#7a3f00', fontWeight: 700 }}>
                            如果股價跌到 NT$ {formatPrice(stopLossPrice)}，這筆單大約會虧 NT$ {formatMoney(estimatedStopLossLoss)}
                            {user?.availableBalance ? `，約佔目前可用餘額 ${affordableLossPct.toFixed(1)}%。` : '。'}
                            下單前先想想：這個損失你能接受嗎？
                          </div>
                        </div>
                      )}
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
                  disabled={isTrading || !dataReady}
                  onClick={() => {
                    if (!dataReady) {
                      alert('⚠️ 帳號資料尚未同步完成，請稍候幾秒後再下單！');
                      return;
                    }
                    if (!quantity || tradeShares <= 0) {
                      alert(`⚠️ 請輸入大於 0 的正確交易${tradeUnitLabel}數！`);
                      return;
                    }
                    if (!tradeReason.trim()) {
                      alert(`⚠️ 下單前請先填寫「投資筆記」，告訴 PPBear 為什麼想${tradeMode === 'buy' ? '買' : '賣'}這檔股票喔！`);
                      return;
                    }
                    handleTrade();
                  }}
                  style={(isTrading || !dataReady) ? { opacity: 0.85, cursor: 'not-allowed' } : {}}
                >
                  {!dataReady ? (
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
                      資料同步中...
                    </span>
                  ) : isTrading ? (
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
                background: w.level === 'danger' ? '#fff8f8' : w.level === 'caution' ? '#fffaf0' : '#f7fbff',
                border: `1.5px solid ${w.level === 'danger' ? '#ffcccc' : w.level === 'caution' ? '#ffd98a' : '#b8d9ff'}`,
                borderRadius: 12,
                padding: '14px 16px', marginBottom: 12
              }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>
                  {w.icon} <span style={{
                    fontWeight: 800,
                    fontSize: 15,
                    color: w.level === 'danger' ? '#cc0000' : w.level === 'caution' ? '#a85f00' : '#1d5f99',
                  }}>{w.title}</span>
                </div>
                <p style={{ margin: '0 0 8px', fontSize: 14, color: '#333' }}>{w.message}</p>
                {w.details && w.details.length > 0 && (
                  <div style={{
                    background: '#fff',
                    border: '1px solid rgba(0,0,0,0.07)',
                    borderRadius: 10,
                    overflow: 'hidden',
                    marginBottom: 10,
                  }}>
                    {w.details.map((detail, detailIdx) => (
                      <div key={`${detail.label}-${detailIdx}`} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '8px 10px',
                        borderTop: detailIdx === 0 ? 'none' : '1px solid rgba(0,0,0,0.06)',
                        fontSize: 13,
                        lineHeight: 1.35,
                      }}>
                        <span style={{ color: '#666', flex: '0 0 42%' }}>{detail.label}</span>
                        <span style={{
                          color: detail.tone === 'profit'
                            ? 'var(--profit-color)'
                            : detail.tone === 'loss'
                              ? 'var(--loss-color)'
                              : detail.tone === 'warning'
                                ? '#b06a00'
                                : 'var(--text-primary)',
                          fontWeight: 900,
                          textAlign: 'right',
                          wordBreak: 'break-word',
                        }}>
                          {detail.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
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
                  ) : pendingWarnings.some(w => w.level === 'danger')
                    ? '我知道後果，仍要買'
                    : '我已看過數據，仍要買'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
