import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney, formatPrice } from '../store';
import type { Holding } from '../types';
import { fetchOfficialPriceMap, fetchStockData, clearOfficialPriceMapCache, fetchActiveEtfRadarMap } from '../api';
import type { ActiveEtfRadarItem, OfficialPriceMapEntry } from '../api';
import MarketBadge from '../components/MarketBadge';
import IndustryIcon from '../components/IndustryIcon';
import StockTradeModal from '../components/StockTradeModal';
import type { TradeSnapshotPayload } from '../utils/tradeSnapshot';
import { canAutoRefreshPrices, formatPriceUpdateLabel, PRICE_AUTO_REFRESH_MS } from '../utils/priceAutoRefresh';
import { useStrategySignals } from '../hooks/useStrategySignals';
import './Portfolio.css';
type ActiveEtfInfoDialog = {stockCode:string;stockName:string;radar:ActiveEtfRadarItem};
const HOLDING_ALLOCATION_COLORS = [
  '#ff5a66',
  '#2e9cca',
  '#31b27c',
  '#ffb020',
  '#8b5cf6',
  '#14b8a6',
  '#f97316',
  '#64748b',
];

function formatHoldingCategoryName(industry?: string): string {
  const name = industry?.trim();
  if (!name) return '未分類類別';
  if (name.endsWith('類別')) return name;
  if (name.endsWith('業')) return `${name.slice(0, -1)}類別`;
  return `${name}類別`;
}

function formatCompactCategoryName(categoryName: string): string {
  const base = categoryName
    .replace(/類別$/u, '')
    .split(/[、,，/／｜|]/u)
    .map(part => part.trim())
    .find(Boolean) || categoryName.replace(/類別$/u, '').trim();
  const compact = base.replace(/\s+/g, '');
  if (!compact) return '未分類';
  if (compact.length >= 4) return compact.slice(0, 4);
  if (compact.length >= 3) return `${compact}類`;
  return `${compact}類別`.slice(0, 4);
}

function formatHoldingShares(shares: number): string {
  if (!Number.isFinite(shares)) return '-- 股';
  if (Math.abs(shares) >= 1000) {
    const lots = shares / 1000;
    const formattedLots = lots.toLocaleString('zh-TW', {
      minimumFractionDigits: 0,
      maximumFractionDigits: lots >= 100 ? 0 : 2,
    });
    return `${formattedLots} 張`;
  }
  return `${shares.toLocaleString('zh-TW')} 股`;
}


export default function Portfolio(){
 const navigate=useNavigate();
 const {holdings,dataReady,getPortfolioSummary,hasFeature,refreshHoldingPrices}=useStore();
 const hasAiFeature=hasFeature('ai_portfolio_advice');
 const {signals,loading:signalsLoading,error:strategyError,refresh}=useStrategySignals(holdings.map(h=>h.stockCode),hasAiFeature);
  const summary = getPortfolioSummary();

  const pl = summary.totalProfitLoss;
  const isProfit = pl >= 0;
  const holdingAllocation = useMemo(() => {
    const categoryMap = holdings.reduce<Record<string, { categoryName: string; marketValue: number; stockCount: number }>>((acc, h) => {
      const marketValue = Math.max(0, h.currentPrice * h.totalShares);
      if (marketValue <= 0) return acc;

      const categoryName = formatHoldingCategoryName(h.industry);
      if (!acc[categoryName]) {
        acc[categoryName] = { categoryName, marketValue: 0, stockCount: 0 };
      }
      acc[categoryName].marketValue += marketValue;
      acc[categoryName].stockCount += 1;
      return acc;
    }, {});

    const rawItems = Object.values(categoryMap)
      .sort((a, b) => b.marketValue - a.marketValue);

    const totalMarketValue = rawItems.reduce((sum, item) => sum + item.marketValue, 0);
    if (totalMarketValue <= 0) {
      return { totalMarketValue: 0, itemCount: 0, categories: [], items: [], gradient: '' };
    }

    const categories = rawItems.map((item, index) => ({
      ...item,
      color: HOLDING_ALLOCATION_COLORS[index % HOLDING_ALLOCATION_COLORS.length],
      percent: (item.marketValue / totalMarketValue) * 100,
    }));

    const primaryItems = rawItems.slice(0, 5);
    const otherItems = rawItems.slice(5);
    const displayItems = primaryItems.map((item, index) => ({
      ...item,
      color: HOLDING_ALLOCATION_COLORS[index % HOLDING_ALLOCATION_COLORS.length],
    }));

    if (otherItems.length > 0) {
      displayItems.push({
        categoryName: `其他 ${otherItems.length} 類別`,
        marketValue: otherItems.reduce((sum, item) => sum + item.marketValue, 0),
        stockCount: otherItems.reduce((sum, item) => sum + item.stockCount, 0),
        color: HOLDING_ALLOCATION_COLORS[HOLDING_ALLOCATION_COLORS.length - 1],
      });
    }

    const items = displayItems.map(item => ({
      ...item,
      percent: (item.marketValue / totalMarketValue) * 100,
    }));

    let cursor = 0;
    const segments = items.map((item, index) => {
      const start = cursor;
      const end = index === items.length - 1 ? 100 : cursor + item.percent;
      cursor = end;
      return `${item.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    });

    return {
      totalMarketValue,
      itemCount: rawItems.length,
      categories,
      items,
      gradient: `conic-gradient(${segments.join(', ')})`,
    };
  }, [holdings]);


 const [priceRefreshing,setPriceRefreshing]=useState(false);
 const [priceRefreshError,setPriceRefreshError]=useState<string|null>(null);
 const [loadingMsg,setLoadingMsg]=useState('正在讀取週榜趨勢訊號…');
 const [loadingProgress,setLoadingProgress]=useState(0);
 const [marketMap,setMarketMap]=useState<Record<string,OfficialPriceMapEntry>>({});
 const [activeEtfMap,setActiveEtfMap]=useState<Record<string,ActiveEtfRadarItem>>({});
 const [activeEtfDialog,setActiveEtfDialog]=useState<ActiveEtfInfoDialog|null>(null);
 const [selectedTrade,setSelectedTrade]=useState<{mode:'buy'|'sell';holding:Holding}|null>(null);
 const [priceUpdatedLabel,setPriceUpdatedLabel]=useState('');
 const [manualRefreshing,setManualRefreshing]=useState(false);
 const manualRefreshRef=useRef(false);
  const [selectedHoldingCategory, setSelectedHoldingCategory] = useState('ALL');
  const categoryTabsRef = useRef<HTMLDivElement | null>(null);
  const categoryDragRef = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false });
  const categoryClickBlockedRef = useRef(false);
  const [isDraggingCategoryTabs, setIsDraggingCategoryTabs] = useState(false);

 const filteredHoldings=selectedHoldingCategory==='ALL'?holdings:holdings.filter(h=>formatHoldingCategoryName(h.industry)===selectedHoldingCategory);
 const isRefreshing=manualRefreshing||priceRefreshing||signalsLoading;
  const selectHoldingCategory = useCallback((categoryName: string) => {
    if (categoryClickBlockedRef.current) {
      categoryClickBlockedRef.current = false;
      return;
    }
    setSelectedHoldingCategory(categoryName);
  }, []);

  const handleCategoryTabsWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const el = categoryTabsRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    el.scrollLeft += event.deltaY;
  }, []);

  const handleCategoryTabsPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const el = categoryTabsRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    categoryDragRef.current = {
      active: true,
      startX: event.clientX,
      scrollLeft: el.scrollLeft,
      moved: false,
    };
    categoryClickBlockedRef.current = false;
    setIsDraggingCategoryTabs(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handleCategoryTabsPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = categoryDragRef.current;
    const el = categoryTabsRef.current;
    if (!drag.active || !el) return;
    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaX) > 4) {
      drag.moved = true;
      categoryClickBlockedRef.current = true;
    }
    el.scrollLeft = drag.scrollLeft - deltaX;
    event.preventDefault();
  }, []);

  const endCategoryTabsDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const moved = categoryDragRef.current.moved;
    categoryDragRef.current.active = false;
    setIsDraggingCategoryTabs(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (moved) {
      window.setTimeout(() => {
        categoryClickBlockedRef.current = false;
      }, 160);
    }
  }, []);

  useEffect(() => {
    if (
      selectedHoldingCategory !== 'ALL' &&
      !holdingAllocation.categories.some(item => item.categoryName === selectedHoldingCategory)
    ) {
      setSelectedHoldingCategory('ALL');
    }
  }, [holdingAllocation.categories, selectedHoldingCategory]);

  const runPriceRefresh = useCallback(async (force: boolean, message: string) => {
    if (holdings.length === 0) return;

    if (force) clearOfficialPriceMapCache();
    setPriceRefreshError(null);
    setPriceRefreshing(true);
    setLoadingMsg(message);
    setLoadingProgress(8);

    let mountedProgress = true;
    const progressTimer = window.setInterval(() => {
      if (!mountedProgress) return;
      setLoadingProgress(prev => Math.min(prev + 7, 48));
    }, 280);

    try {
      const result = await refreshHoldingPrices({ force });
      if (result.checkedCount > 0 && result.priceFoundCount === 0) {
        setPriceRefreshError('價格抓取失敗，畫面仍是上次庫存價格');
      }
      if (result.priceFoundCount > 0 && canAutoRefreshPrices()) {
        setPriceUpdatedLabel(formatPriceUpdateLabel());
      }
      setLoadingProgress(prev => Math.max(prev, 62));
      return result;
    } catch {
      setPriceRefreshError('價格抓取失敗，畫面仍是上次庫存價格');
      return { checkedCount: holdings.length, priceFoundCount: 0, updatedCount: 0 };
    } finally {
      mountedProgress = false;
      window.clearInterval(progressTimer);
      setLoadingProgress(100);
      await new Promise(resolve => window.setTimeout(resolve, 250));
      setPriceRefreshing(false);
    }
  }, [holdings.length, refreshHoldingPrices]);

  // 進入庫存頁時只在開盤期間自動確認價格；收盤與休市時保留上次價格。
  useEffect(() => {
    if (canAutoRefreshPrices()) {
      runPriceRefresh(true, '正在更新持股價格...');
    }
  }, [runPriceRefresh]);

  useEffect(() => {
    if (holdings.length === 0) return;

    function refreshPricesIfVisible() {
      if (canAutoRefreshPrices()) {
        runPriceRefresh(true, '正在同步盤中持股價格...');
      }
    }

    const intervalId = window.setInterval(refreshPricesIfVisible, PRICE_AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshPricesIfVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshPricesIfVisible);
    };
  }, [holdings.length, runPriceRefresh]);


 useEffect(()=>{let active=true;fetchOfficialPriceMap().then(map=>{if(active)setMarketMap(map)}).catch(()=>{});fetchActiveEtfRadarMap(holdings.map(h=>h.stockCode),5).then(map=>{if(active)setActiveEtfMap(map)}).catch(()=>{});return()=>{active=false}},[holdings]);
  function getActiveEtfActionLabel(action: ActiveEtfRadarItem['etfs'][number]['action']): string {
    switch (action) {
      case 'added': return '新進';
      case 'increased': return '加碼';
      case 'decreased': return '減碼';
      case 'removed': return '剔除';
      default: return '持有';
    }
  }

  function getActiveEtfDetailText(radar: ActiveEtfRadarItem): string {
    const detail = radar.etfs
      .map(item => `${item.etfName || item.etfCode} ${getActiveEtfActionLabel(item.action)}`)
      .join('、');
    return `近${radar.days}日：新進${radar.addedEtfCount}、加碼${radar.increasedEtfCount}、減碼${radar.decreasedEtfCount}、剔除${radar.removedEtfCount}。${detail || '尚無 ETF 明細'}。資料日：${radar.latestDate || '待同步'}。`;
  }

  function renderActiveEtfRadarChip(stockCode: string, stockName: string) {
    const radar = activeEtfMap[stockCode];
    if (!radar) return null;
    if (radar.holdingEtfCount <= 0) return null;
    const label = `ETF+${radar.holdingEtfCount}`;
    return (
      <button
        type="button"
        className={`holding-quant-chip holding-active-etf-chip holding-active-etf-chip-${radar.signal}`}
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


 function getSnapshotContextForHolding(h:Holding):Partial<TradeSnapshotPayload>{const m=marketMap[h.stockCode];const strategy=signals[h.stockCode];return {strategyLabel:strategy?.label||'資料不足',strategyReason:strategy?.reason||'等待完整策略資料',strategyDate:strategy?.dataDate||null,protectionPrice:strategy?.protectionPrice??null,addTriggerPrice:strategy?.addTriggerPrice??null,initialRisk:strategy?.initialRisk??null,suggestedQuantity:strategy?.suggestedQuantity??null,market:m?.market,industry:h.industry||null,volume:m?.volume??null,priceDate:m?.date};}
 async function preparePortfolioSnapshotContext(h:Holding,base:TradeSnapshotPayload):Promise<Partial<TradeSnapshotPayload>>{const data=await fetchStockData(h.stockCode).catch(()=>null);const row=data?.prices?.at(-1);return {chartPrices:data?.prices,open:base.open??row?.open_d??null,high:base.high??row?.high_d??null,low:base.low??row?.low_d??null,volume:base.volume??row?.volume??null,priceDate:base.priceDate||row?.mdate};}
  return (
    <div className="portfolio">
      <div className="page-header">
        <h1 className="page-title">💼 我的庫存</h1>
      </div>

      {isRefreshing && holdings.length > 0 && (
        <div className={`pf-loading-bar ${priceRefreshing ? 'pf-loading-bar-price' : ''}`}>
          <span className="pf-inline-spinner" />
          <span>{loadingMsg}</span>
          <span className="pf-loading-pct">{loadingProgress}%</span>
        </div>
      )}

      {/* 總覽卡片 */}
      <div className={`card portfolio-summary-card ${summary.totalCost > 0 ? (isProfit ? 'card-profit' : 'card-loss') : 'card-primary'}`}>
        <div className="portfolio-asset-label">我的總資產 💰</div>
        <div className="portfolio-asset-value">
          <span className="portfolio-asset-currency">NT$</span>
          <span className="portfolio-asset-number">{formatMoney(summary.totalAssets)}</span>
        </div>

        <div className="portfolio-asset-details portfolio-asset-details-three">
          <div className="portfolio-asset-detail">
            <span className="portfolio-asset-detail-label">💵 可用現金</span>
            <span className="portfolio-asset-detail-value">
              <span className="portfolio-asset-currency">NT$</span>
              <span className="portfolio-asset-number">{formatMoney(summary.cashBalance)}</span>
            </span>
          </div>
          <div className="portfolio-asset-detail">
            <span className="portfolio-asset-detail-label">📈 股票市值</span>
            <span className="portfolio-asset-detail-value">
              <span className="portfolio-asset-currency">NT$</span>
              <span className="portfolio-asset-number">{formatMoney(summary.totalMarketValue)}</span>
            </span>
          </div>
          <div className="portfolio-asset-detail">
            <span className="portfolio-asset-detail-label">📊 未平倉損益</span>
            <span className={`portfolio-asset-detail-value ${pl > 0 ? 'portfolio-asset-pnl-profit' : pl < 0 ? 'portfolio-asset-pnl-loss' : ''}`}>
              <span className="portfolio-asset-number-row">
                <span>{pl > 0 ? '+' : ''}</span>
                <span className="portfolio-asset-currency">NT$</span>
                <span className="portfolio-asset-number">{formatMoney(pl)}</span>
              </span>
              <span className="portfolio-asset-pct">({summary.profitLossPct > 0 ? '+' : ''}{summary.profitLossPct.toFixed(1)}%)</span>
            </span>
          </div>
        </div>

        {holdingAllocation.totalMarketValue > 0 && (
          <div className="portfolio-stock-mix" aria-label="庫存類別組成">
            <div
              className="portfolio-stock-mix-chart"
              style={{ background: holdingAllocation.gradient }}
            >
              <div className="portfolio-stock-mix-hole">
                <span>類別</span>
                <strong>{holdingAllocation.itemCount} 個</strong>
              </div>
            </div>
            <div className="portfolio-stock-mix-content">
              <div className="portfolio-stock-mix-header">
                <span className="portfolio-stock-mix-title">庫存類別組成</span>
                <span className="portfolio-stock-mix-total">
                  NT$ {formatMoney(holdingAllocation.totalMarketValue)}
                </span>
              </div>
              <div className="portfolio-stock-mix-list">
                {holdingAllocation.items.map(item => (
                  <div className="portfolio-stock-mix-row" key={item.categoryName}>
                    <span
                      className="portfolio-stock-mix-swatch"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="portfolio-stock-mix-name">
                      {item.categoryName}
                      <span className="portfolio-stock-mix-code">{item.stockCount} 檔</span>
                    </span>
                    <span className="portfolio-stock-mix-value">
                      NT$ {formatMoney(item.marketValue)}
                    </span>
                    <span className="portfolio-stock-mix-percent">
                      {item.percent.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="section-header" style={{ marginTop: '24px', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          📊 持股清單 ({holdings.length})
        </h2>
      </div>
      <div className="pf-data-source"><span>週榜趨勢訊號｜官方日 K｜收盤判斷</span><button className="pf-refresh-btn" disabled={isRefreshing} onClick={async()=>{if(manualRefreshRef.current)return;manualRefreshRef.current=true;setManualRefreshing(true);try{await Promise.all([refresh(),runPriceRefresh(true,'正在更新持股價格…')]);}finally{manualRefreshRef.current=false;setManualRefreshing(false)}}}>重新抓取</button></div>
      {(strategyError||priceRefreshError)&&<p role="alert">{strategyError||priceRefreshError}</p>}
      <p className="pf-strategy-note">加碼需首次進場價 + 2R、平均成本獲利與風險額度；資料不足時停止加碼。訊號不會自動下單。</p>
      {holdingAllocation.categories.length > 0 && (
        <div className="portfolio-category-tabs-shell">
          <div
            ref={categoryTabsRef}
            className={`portfolio-category-tabs${isDraggingCategoryTabs ? ' is-dragging' : ''}`}
            aria-label="庫存類別篩選"
            onWheel={handleCategoryTabsWheel}
            onPointerDown={handleCategoryTabsPointerDown}
            onPointerMove={handleCategoryTabsPointerMove}
            onPointerUp={endCategoryTabsDrag}
            onPointerCancel={endCategoryTabsDrag}
            onPointerLeave={endCategoryTabsDrag}
          >
            <button
              type="button"
              className={`portfolio-category-tab ${selectedHoldingCategory === 'ALL' ? 'active' : ''}`}
              onClick={() => selectHoldingCategory('ALL')}
            >
              <span className="portfolio-category-tab-label">全部</span>
              <span className="portfolio-category-tab-count">{holdings.length} 檔</span>
            </button>
            {holdingAllocation.categories.map(item => (
              <button
                type="button"
                key={item.categoryName}
                className={`portfolio-category-tab ${selectedHoldingCategory === item.categoryName ? 'active' : ''}`}
                onClick={() => selectHoldingCategory(item.categoryName)}
                title={`${item.categoryName}：NT$ ${formatMoney(item.marketValue)}，占庫存 ${item.percent.toFixed(1)}%`}
              >
                <span
                  className="portfolio-category-tab-dot"
                  style={{ backgroundColor: item.color }}
                />
                <span className="portfolio-category-tab-label">{formatCompactCategoryName(item.categoryName)}</span>
                <span className="portfolio-category-tab-count">{item.stockCount} 檔</span>
                <span className="portfolio-category-tab-detail" role="tooltip">
                  <strong>{item.categoryName}</strong>
                  <span>NT$ {formatMoney(item.marketValue)}・{item.percent.toFixed(1)}%・{item.stockCount} 檔</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeEtfDialog && (
        <div className="pf-etf-info-overlay" onClick={() => setActiveEtfDialog(null)}>
          <div className="pf-etf-info-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="pf-etf-info-close" type="button" onClick={() => setActiveEtfDialog(null)} aria-label="關閉">×</button>
            <div className="pf-etf-info-title">
              {activeEtfDialog.stockName} {activeEtfDialog.stockCode}
            </div>
            <div className="pf-etf-info-subtitle">ETF 支撐</div>
            <p className="pf-etf-info-text">
              這張小卡顯示大型台股 ETF 近 5 日對這檔股票的持股異動次數，用來補強建倉與加碼信心，不用分數呈現。
            </p>
            <div className="pf-etf-info-rule-list">
              <div>{getActiveEtfDetailText(activeEtfDialog.radar)}</div>
              <div>ETF+N：代表目前有 N 檔追蹤 ETF 持有這支股票。</div>
              <div>明細會列出近 5 日新進、加碼、減碼、剔除與持有狀態。</div>
            </div>
            <p className="pf-etf-info-note">
              ETF 支撐是資金底盤參考，不等於單獨買賣建議，仍需搭配加碼時機、股票本質與風險控管。
            </p>
          </div>
        </div>
      )}


      {/* 持股列表 */}
      <div className="holdings-list">
          {holdings.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📭</div>
              <div className="empty-state-title">還沒有持股</div>
              <div className="empty-state-desc">快去探索頁面買你的第一支股票吧！</div>
              <button className="btn btn-primary" onClick={() => navigate('/explore')}>
                🔍 去探索
              </button>
            </div>
          ) : filteredHoldings.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔎</div>
              <div className="empty-state-title">這個類別目前沒有庫存</div>
              <button className="btn btn-primary" onClick={() => setSelectedHoldingCategory('ALL')}>
                顯示全部庫存
              </button>
            </div>
          ) : (
            filteredHoldings.map((h: Holding) => {
              const itemPL = (h.currentPrice - h.avgCost) * h.totalShares;
              const itemPLPct = ((h.currentPrice - h.avgCost) / h.avgCost * 100);
              const itemIsProfit = itemPL >= 0;
              const isStopLossAlert = Number.isFinite(itemPLPct) && itemPLPct <= -20;
              const signal=signals[h.stockCode];
              return (
                <div
                  key={h.stockCode}
                  className={`holding-item${signal ? ` strategy-${signal.action}` : ''}${isStopLossAlert ? ' holding-item-stop-loss' : ''}`}
                  onClick={() => navigate(`/stock/${h.stockCode}`)}
                >
                  <div className="holding-main-row">
                    <div className="holding-left">
                      <div className="signal-badge"><span className="signal-badge-text">{hasAiFeature?(signal?.label||(signalsLoading?'讀取中':'資料不足')):'持股'}</span></div>
                      <div className="holding-info">
                        <div className="holding-name-line">
                          <IndustryIcon stockCode={h.stockCode} industry={h.industry} compact />
                          <span className="holding-name">{h.stockName}</span>
                          <MarketBadge market={marketMap[h.stockCode]?.market} compact />
                        </div>
                        <div className="holding-code-market-line">
                          <span className="holding-code">{h.stockCode}</span>
                        </div>
                        {hasAiFeature&&<div className="holding-strategy-details"><span>{signal?.reason||'等待完整交易與價格資料'}</span><small>資料日：{signal?.dataDate||'尚未取得'}</small>{signal?.protectionPrice!=null&&<span>保護線 {formatPrice(signal.protectionPrice)}</span>}{signal?.addTriggerPrice!=null&&<span>2R 加碼門檻 {formatPrice(signal.addTriggerPrice)}</span>}{signal?.suggestedQuantity!=null&&<span>建議股數 {signal.suggestedQuantity}</span>}</div>}
                        <div className="holding-rec-line">{renderActiveEtfRadarChip(h.stockCode,h.stockName)}</div>
                      </div>
                    </div>
                    <div className="holding-center">
                      <div className="holding-shares">{formatHoldingShares(h.totalShares)}</div>
                      <div className="holding-avg">成本 {formatPrice(h.avgCost)}</div>
                    </div>
                    <div className="holding-right">
                      {priceUpdatedLabel && (
                        <div className="holding-price-updated">{priceUpdatedLabel}</div>
                      )}
                      <div className="holding-current">NT$ {formatPrice(h.currentPrice)}</div>
                      <div className={`holding-pl ${itemIsProfit ? 'text-profit' : 'text-loss'}`}>
                        {itemIsProfit ? '+' : ''}{formatMoney(itemPL)}
                      </div>
                      <div className={`holding-pl-pct ${itemIsProfit ? 'text-profit' : 'text-loss'}`}>
                        ({itemIsProfit ? '+' : ''}{itemPLPct.toFixed(1)}%)
                      </div>
                    </div>
                  </div>
                  <div className="holding-trade-actions" aria-label={`${h.stockName} 快速交易`}>
                    <button
                      type="button"
                      className="holding-trade-btn holding-trade-btn-buy"
                      disabled={!dataReady}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedTrade({ mode: 'buy', holding: h });
                      }}
                    >
                      買入
                    </button>
                    <button
                      type="button"
                      className="holding-trade-btn holding-trade-btn-sell"
                      disabled={!dataReady || h.totalShares <= 0}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedTrade({ mode: 'sell', holding: h });
                      }}
                    >
                      賣出
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      {selectedTrade && (
        <StockTradeModal
          isOpen={Boolean(selectedTrade)}
          mode={selectedTrade.mode}
          stockCode={selectedTrade.holding.stockCode}
          stockName={selectedTrade.holding.stockName}
          price={selectedTrade.holding.currentPrice}
          industry={selectedTrade.holding.industry || ''}
          snapshotContext={getSnapshotContextForHolding(selectedTrade.holding)}
          prepareSnapshotContext={(basePayload) => preparePortfolioSnapshotContext(selectedTrade.holding, basePayload)}
          onClose={() => setSelectedTrade(null)}
        />
      )}
    </div>
  );
}
