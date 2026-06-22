import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchOfficialClosePrice, fetchSimonsData, toRecommendation, fetchOfficialPriceMap, fetchStockQuantData, refreshDailyAiCache, clearQuantSignalTTLCache, clearSimonsDataTTLCache, fetchDailyAiCacheVersion, getKnownDailyAiCacheVersion, rememberDailyAiCacheVersion, ensureDailyAiCacheVersion } from '../api';
import type { StockRecommendation } from '../types';
import type { OfficialPriceMapEntry, StockQuantData, StockQuantMeta } from '../api';
import { useStore } from '../store';
import { getCache, setCache, clearCache, getVersionedCache, invalidateDailyMarketDataCaches, CACHE_KEYS } from '../cache';
import AdBanner from '../components/AdBanner';
import MarketBadge from '../components/MarketBadge';
import IndustryIcon from '../components/IndustryIcon';
import { canAutoRefreshPrices, formatPriceUpdateLabel, PRICE_AUTO_REFRESH_MS } from '../utils/priceAutoRefresh';
import './Explore.css';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => window.setTimeout(() => resolve(null), ms)),
  ]);
}

const DAILY_AI_CACHE_POLL_MS = 90 * 1000;

export default function Explore() {
  const navigate = useNavigate();
  const { hasFeature, isInWatchlist, addToWatchlist, removeFromWatchlist, watchlist, holdings } = useStore();
  const hasAiFeature = hasFeature('ai_stock_picking');
  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [wlBusy, setWlBusy] = useState<string | null>(null);

  // 從 sessionStorage 恢復狀態（從 StockDetail 返回時）
  const savedState = useRef(() => {
    try {
      const raw = sessionStorage.getItem('explore_state');
      if (raw) {
        sessionStorage.removeItem('explore_state');
        return JSON.parse(raw) as { search: string; activeStrategy: string; scrollY: number };
      }
    } catch {}
    return null;
  });
  const restored = useRef(savedState.current());

  const restoredStrategy = restored.current?.activeStrategy;
  const initialStrategy = hasAiFeature
    ? 'ai'
    : restoredStrategy && restoredStrategy !== 'ai'
      ? restoredStrategy
      : 'A';

  const [search, setSearch] = useState(restored.current?.search || '');
  const [activeStrategy, setActiveStrategy] = useState(initialStrategy);
  const [error, setError] = useState('');
  const [twsePriceMap, setTwsePriceMap] = useState<Record<string, OfficialPriceMapEntry>>({});
  const [quantDataMap, setQuantDataMap] = useState<Record<string, StockQuantData>>({});
  const [quantLoading, setQuantLoading] = useState(false);
  const [quantProgress, setQuantProgress] = useState(0); // 量化分析進度 (0~100)
  const [quantProgressText, setQuantProgressText] = useState('');
  const [searchQuantLoading, setSearchQuantLoading] = useState(false);
  const [searchPriceLoading, setSearchPriceLoading] = useState(false);
  const [aiQualified, setAiQualified] = useState<Set<string>>(new Set()); // 記錄符合「中度以上 + 正報酬」的股票
  const [aiFilterQualified, setAiFilterQualified] = useState(true); // 預設勾選篩選
  const [simonsMeta, setSimonsMeta] = useState<Record<string, any>>({}); // 保存原始 SimonsItem 供重新評分用
  const [quantMeta, setQuantMeta] = useState<StockQuantMeta | null>(null);
  const [priceUpdatedLabel, setPriceUpdatedLabel] = useState('');
  const [dailyDataVersion, setDailyDataVersion] = useState(() => getKnownDailyAiCacheVersion('explore') || '');
  const resultRef = useRef<HTMLDivElement>(null);
  const forceFreshQuantRef = useRef(false);
  const pendingScrollY = useRef(restored.current?.scrollY ?? 0);
  function getTodayString(): string {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  }

  async function loadData(forceFresh = false) {
    const dataVersion = await ensureDailyAiCacheVersion('explore', forceFresh);
    if (dataVersion && dataVersion !== dailyDataVersion) setDailyDataVersion(dataVersion);

    if (forceFresh) {
      clearCache(CACHE_KEYS.TWSE_PRICE_MAP);
      clearCache(CACHE_KEYS.SIMONS_DATA);
    }

    setLoading(true);
    // 清空舊量化資料，避免重整後新 Phase-1 分數配上舊 quantDataMap 造成數據混滞
    setQuantDataMap({});
    setAiQualified(new Set());
    setQuantMeta(null);
    if (activeStrategy === 'ai') setQuantLoading(true);
    setError('');
    setRecommendations([]);
    try {
      // 非開盤時只讀既有價格快取，避免進頁面就增加報價請求。
      type TwsePriceMapType = Record<string, OfficialPriceMapEntry>;
      const cachedTwse = forceFresh ? null : getCache<TwsePriceMapType>(CACHE_KEYS.TWSE_PRICE_MAP);
      if (cachedTwse) {
        setTwsePriceMap(cachedTwse);
      } else if (forceFresh || canAutoRefreshPrices()) {
        const map = await fetchOfficialPriceMap();
        if (Object.keys(map).length > 0) {
          setTwsePriceMap(map);
          setCache(CACHE_KEYS.TWSE_PRICE_MAP, map);
          if (canAutoRefreshPrices()) setPriceUpdatedLabel(formatPriceUpdateLabel());
        }
      }

      // 檢查 Simons 快取
      type SimonsCacheData = { recs: StockRecommendation[]; meta: Record<string, any>; _dataVersion?: string };
      const cachedSimons = forceFresh ? null : getVersionedCache<SimonsCacheData>(CACHE_KEYS.SIMONS_DATA, dataVersion);
      if (cachedSimons) {
        setSimonsMeta(cachedSimons.meta);
        setRecommendations(cachedSimons.recs);
        setLoading(false);
        return;
      }

      const items = await fetchSimonsData(undefined, { forceFresh });
      if (items.length > 0) {
        // 保存原始 SimonsItem meta 供後續量化評分使用
        const meta: Record<string, any> = {};
        items.forEach(item => {
          meta[item.coid] = item;
        });
        setSimonsMeta(meta);
        const recs = items.map(item => toRecommendation(item));
        recs.sort((a, b) => b.score - a.score);
        setRecommendations(recs);
        setCache<SimonsCacheData>(CACHE_KEYS.SIMONS_DATA, { recs, meta, _dataVersion: dataVersion || undefined });
        setLoading(false);
        return;
      }
      setError('目前沒有可用的推薦數據');
    } catch {
      setError('載入資料時發生錯誤');
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkSharedAiCacheVersion() {
      if (loading || quantLoading) return;
      const latest = await fetchDailyAiCacheVersion();
      if (cancelled || !latest?.version) return;
      const known = getKnownDailyAiCacheVersion('explore');
      if (!known) {
        rememberDailyAiCacheVersion(latest.version, 'explore');
        setDailyDataVersion(latest.version);
        return;
      }
      if (latest.version !== known) {
        rememberDailyAiCacheVersion(latest.version, 'explore');
        setDailyDataVersion(latest.version);
        invalidateDailyMarketDataCaches();
        forceFreshQuantRef.current = true;
        loadData(true);
      }
    }

    function handlePageShow() {
      checkSharedAiCacheVersion();
    }

    checkSharedAiCacheVersion();
    const timer = window.setInterval(checkSharedAiCacheVersion, DAILY_AI_CACHE_POLL_MS);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [loading, quantLoading]);

  useEffect(() => {
    if (hasAiFeature && activeStrategy !== 'ai') {
      setActiveStrategy('ai');
      return;
    }

    if (!hasAiFeature && activeStrategy === 'ai') {
      setActiveStrategy('A');
    }
  }, [activeStrategy, hasAiFeature]);

  // 資料載入完成後恢復捲動位置
  useEffect(() => {
    if (!loading && pendingScrollY.current > 0) {
      const y = pendingScrollY.current;
      pendingScrollY.current = 0;
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
  }, [loading]);

  // 點擊股票卡前保存狀態
  function navigateToStock(coid: string) {
    // 保存 Explore 頁狀態
    sessionStorage.setItem('explore_state', JSON.stringify({
      search,
      activeStrategy,
      scrollY: window.scrollY,
      _dataVersion: dailyDataVersion || getKnownDailyAiCacheVersion('explore') || undefined,
    }));
    // 保存當前篩選列表供 StockDetail 滑塊使用
    const stockList = filtered.map(r => {
      const qd = quantDataMap[r.coid];
      return {
        coid: r.coid,
        name: r.stkname,
        close: getBestClose(r.coid, r.close),
        aiRemark: qd?.aiQuanBackDataComment?.remark ?? null,
        cumRet: qd?.aiQuanBackDataComment?.cum_ret ?? null,
        chipPts: qd?.chipStability ? parseFloat(qd.chipStability.pts) : null,
      };
    });
    sessionStorage.setItem('explore_stock_list', JSON.stringify({
      _dataVersion: dailyDataVersion || getKnownDailyAiCacheVersion('explore') || undefined,
      items: stockList,
    }));
    navigate(`/stock/${coid}`);
  }

  // AI 策略啟用時，批次抓取所有推薦股票的量化三指標（不限制數量，抓全部）
  // 【修改】獲取量化資料後，重新計算 Premium Simons 評分並排序
  useEffect(() => {
    if (activeStrategy !== 'ai' || recommendations.length === 0) return;
    let cancelled = false;
    setQuantLoading(true);
    setQuantProgress(0);
    setQuantProgressText(`正在分析 ${recommendations.length} 支股票...`);
    async function runQuantSync() {
      let completed = 0;
      const total = recommendations.length;
      const results: Array<StockQuantData | null> = Array(total).fill(null);
      const queue = recommendations.map((rec, index) => ({ rec, index }));
      const workerCount = Math.min(4, queue.length);

      async function runWorker() {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item || cancelled) return;
          const result = await withTimeout(
            fetchStockQuantData(item.rec.coid, undefined, { forceFresh: forceFreshQuantRef.current }),
            12000
          ).catch(() => null);
          results[item.index] = result;
          if (!cancelled) {
            completed++;
            setQuantProgress(Math.round((completed / total) * 100));
            setQuantProgressText(`已分析 ${completed} / ${total} 支`);
          }
        }
      }

      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
      if (cancelled) return;
      forceFreshQuantRef.current = false;
      const map: Record<string, StockQuantData> = {};
      const qualified = new Set<string>();
      let updatedRecs: StockRecommendation[] = [];
      const metas = results.map(result => result?.meta).filter(Boolean) as StockQuantMeta[];
      
      recommendations.forEach((r, i) => {
        const qd = results[i];
        if (!qd) {
          updatedRecs.push(r);
          return;
        }
        map[r.coid] = qd;
        // 判斷是否符合「中度以上推薦」且「正報酬」
        const remark = qd.aiQuanBackDataComment?.remark ?? '';
        const cumRet = qd.aiQuanBackDataComment?.cum_ret ?? '';
        const isMidOrAbove = remark.includes('中度') || remark.includes('高度') || remark.includes('超高'); // 判斷是否中度以上
        const cumRetNum = parseFloat(cumRet);
        const isPositive = !isNaN(cumRetNum) && cumRetNum >= 0;
        if (isMidOrAbove && isPositive) {
          qualified.add(r.coid);
        }
        
        // 【NEW】如果有量化資料且有 AI 推薦等級，使用 Simons 量化評分重新計算
        if (qd.aiQuanBackDataComment && simonsMeta[r.coid]) {
          const simonsItem = simonsMeta[r.coid];
          updatedRecs.push(toRecommendation(simonsItem, qd));
        } else {
          // 否則保持原來的評分
          updatedRecs.push(r);
        }
      });
      
      setQuantDataMap(map);
      setAiQualified(qualified);
      setQuantMeta(getLatestQuantMeta(metas));
      
      // 【NEW】使用新的 Simons 評分重新排序（優先有資料的）
      const recsWithData = updatedRecs.filter(rec => map[rec.coid]?.aiQuanBackDataComment);
      const recsNoData = updatedRecs.filter(rec => !map[rec.coid]?.aiQuanBackDataComment);
      const sorted = [
        ...recsWithData.sort((a, b) => b.score - a.score),
        ...recsNoData.sort((a, b) => b.score - a.score),
      ];
      setRecommendations(sorted);
      setQuantLoading(false);
    }

    runQuantSync().catch(() => {
      if (!cancelled) setQuantLoading(false);
    });
    return () => { cancelled = true; };
  // 監聽 simonsMeta（每次 loadData 產生新物件），確保重整後一定重新執行
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStrategy, simonsMeta]);

  function getLatestQuantMeta(metas: StockQuantMeta[]): StockQuantMeta | null {
    if (metas.length === 0) return null;
    return metas.sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime())[0];
  }

  function formatMetaDateTime(value?: string): string {
    if (!value) return '尚未同步';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatDataDate(value?: string): string {
    if (!value) return '尚未同步';
    return value.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  }

  function formatTodayDate(): string {
    return getTodayString().replace(/-/g, '/');
  }

  function getDataUpdateLabel(): string {
    if (activeStrategy === 'ai') {
      return quantMeta ? formatMetaDateTime(quantMeta.fetchedAt) : '同步中';
    }

    const latestOfficialDate = Object.values(twsePriceMap)
      .map(item => item.date)
      .filter(Boolean)
      .sort()
      .at(-1);
    return latestOfficialDate ? formatDataDate(latestOfficialDate).replace(/-/g, '/') : '尚未同步';
  }

  function getDataDateLabel(): string {
    if (activeStrategy === 'ai') {
      return quantMeta?.dataDate ? quantMeta.dataDate.replace(/-/g, '/') : '同步中';
    }

    const latestOfficialDate = Object.values(twsePriceMap)
      .map(item => item.date)
      .filter(Boolean)
      .sort()
      .at(-1);
    return latestOfficialDate ? formatDataDate(latestOfficialDate).replace(/-/g, '/') : '同步中';
  }

  function getDataFreshness() {
    if (loading || quantLoading || searchQuantLoading || searchPriceLoading) {
        return { className: 'explore-data-freshness-updating', label: '正在讀取每日快取與更新價格' };
    }

    if (activeStrategy === 'ai') {
      if (!quantMeta) {
        return { className: 'explore-data-freshness-waiting', label: '等待 Simons 最新交易日資料' };
      }

      if (quantMeta.cacheStatus === 'fresh') {
        return { className: 'explore-data-freshness-fresh', label: '已重新讀取每日快取' };
      }
    }

    if (Object.keys(twsePriceMap).length === 0 && recommendations.length === 0) {
      return { className: 'explore-data-freshness-waiting', label: '尚未完成同步，請先重新抓取確認' };
    }

    return { className: 'explore-data-freshness-fresh', label: '已使用每日 AI 訊號快取' };
  }

  function getFixedUpdateLabel(): string {
    return activeStrategy === 'ai'
      ? '08:00 自動檢查；可手動重新抓取'
      : '08:00 自動檢查；可手動重新抓取';
  }

  async function handleRefreshData() {
    setSearchQuantLoading(false);
    forceFreshQuantRef.current = true;
    invalidateDailyMarketDataCaches();
    clearQuantSignalTTLCache();
    clearSimonsDataTTLCache();
    const stockCodes = [
      ...watchlist.map(item => item.stockCode),
      ...holdings.map(item => item.stockCode),
    ];
    await refreshDailyAiCache(stockCodes);
    const latest = await fetchDailyAiCacheVersion();
    if (latest?.version) {
      rememberDailyAiCacheVersion(latest.version, 'explore');
      setDailyDataVersion(latest.version);
      invalidateDailyMarketDataCaches();
    }
    loadData(true);
  }

  // Simons 每日推薦的收盤價 Map（用於與 TWSE/TPEx 日期比較，使用較新的）
  const simonsPriceMap = useMemo(() => {
    const map: Record<string, { close: string; date: string }> = {};
    for (const r of recommendations) {
      if (r.coid && r.close) {
        map[r.coid] = {
          close: r.close,
          date: (r.mdate || '').replace(/-/g, ''),
        };
      }
    }
    return map;
  }, [recommendations]);

  // 取最新收盤價：比較 TWSE/TPEx 日期與 Simons 日期，用較新的那筆
  function getBestClose(coid: string, fallback: string): string {
    const official = twsePriceMap[coid];
    const simons = simonsPriceMap[coid];
    if (official && simons) {
      const od = official.date.replace(/-/g, '');
      const sd = simons.date;
      if (sd.length === 8 && od.length === 8 && sd > od) return simons.close;
    }
    return official?.close || simons?.close || fallback;
  }

  function buildSearchSimonsItem(rec: StockRecommendation, qd: StockQuantData) {
    const close = getBestClose(rec.coid, rec.close);
    const gvi = qd.stockInfo?.gvi ?? rec.gvi ?? 0;
    const mediangvi = qd.stockInfo?.mediangvi ?? rec.mediangvi ?? '0';
    return {
      ...rec,
      close,
      gvi,
      mediangvi: String(mediangvi),
      category: rec.category || twsePriceMap[rec.coid]?.market || '搜尋結果',
      subindustry: rec.subindustry || rec.category || null,
      status: rec.status || null,
      psr: rec.psr || 6,
      strength: rec.strength || '0',
      ret_w: rec.ret_w || 'flat',
      ret_m: rec.ret_m || 'flat',
      wtcost: rec.wtcost || '0',
      fcost: rec.fcost || '0',
      tcost: rec.tcost || null,
      dcost: rec.dcost || '0',
      yflow: rec.yflow || '0',
      tcr_today: rec.tcr_today || '0',
      fcr_today: rec.fcr_today || '0',
      unusual: rec.unusual || '',
      value: rec.value || '',
      mdate: rec.mdate || getTodayString().replace(/-/g, ''),
    };
  }

  function getDisplayRecommendation(rec: StockRecommendation): StockRecommendation {
    if (!search.trim()) return rec;
    const qd = quantDataMap[rec.coid];
    if (!qd?.aiQuanBackDataComment) return rec;
    return toRecommendation(buildSearchSimonsItem(rec, qd), qd);
  }

  const STRATEGY_CARDS = [
    { id: 'A', title: '穩穩大公司', icon: '🏢', desc: '成交量 > 1,000張\nPSR 評分 ≥ 6', className: 'strategy-card-a' },
    { id: 'B', title: '最近變強公司', icon: '🚀', desc: '週漲 + 月漲雙確認\n籌碼動能強勁', className: 'strategy-card-b' },
    { id: 'C', title: '市場有注意公司', icon: '👀', desc: '法人籌碼強度 > 2.0\n外資 / 投信積極布局', className: 'strategy-card-c' },
    { id: 'D', title: '價值潛力公司', icon: '👴', desc: 'PSR 高品質 ≥ 7\n股價低於外資持股成本', className: 'strategy-card-d' },
    { id: 'E', title: '配息安心公司', icon: '💰', desc: '金融・電信・公用事業\n月趨勢穩定不下跌', className: 'strategy-card-e' },
    { id: 'F', title: '便宜好公司', icon: '🏷️', desc: '低於外資 + 投信持股成本\n雙重折價潛在補漲', className: 'strategy-card-f' },
    { id: 'ai', title: 'AI 聰明選股', icon: '🤖', desc: '每日最新大數據\n電腦推薦標的', className: 'strategy-card-ai' }
  ];

  const watchedStockCodes = useMemo(() => {
    const codes = new Set<string>();
    watchlist.forEach(item => codes.add(item.stockCode));
    return codes;
  }, [watchlist]);

  const heldStockCodes = useMemo(() => {
    const codes = new Set<string>();
    holdings
      .filter(item => item.totalShares > 0)
      .forEach(item => codes.add(item.stockCode));
    return codes;
  }, [holdings]);

  const existingStockCodes = useMemo(() => {
    return new Set([...watchedStockCodes, ...heldStockCodes]);
  }, [watchedStockCodes, heldStockCodes]);

  const filtered = useMemo(() => {
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const globalMatches = Object.entries(twsePriceMap)
        .filter(([code, data]) => code.includes(q) || data.name.toLowerCase().includes(q))
        .slice(0, 30);
      return globalMatches.map(([code, twse]) => ({
        coid: code,
        stkname: twse.name,
        close: twse.close,
        advice: 'hold',
        score: 60,
        category: heldStockCodes.has(code) ? '已在庫存' : watchedStockCodes.has(code) ? '已在觀察' : '搜尋結果',
        ret_w: 'flat',
        kidAdvice: heldStockCodes.has(code)
          ? '這檔股票已經在庫存中，可以點進去查看細節。'
          : watchedStockCodes.has(code)
            ? '這檔股票已經在觀察名單中，可以點進去查看細節。'
            : '這是您搜尋的股票，可以看看要不要加入庫存喔！',
      } as StockRecommendation));
    }

    if (activeStrategy === 'ai') {
      // AI 策略：按 Simons 評分由高到低排序
      // 若有勾選篩選，只顯示「中度以上推薦 + 正報酬」的股票
      const sorted = [...recommendations].sort((a, b) => b.score - a.score);
      if (aiFilterQualified) {
        return sorted.filter(r => aiQualified.has(r.coid) && !existingStockCodes.has(r.coid));
      }
      return sorted.filter(r => !existingStockCodes.has(r.coid));
    }

    // 每日動態策略篩選（從 Simons + TWSE 數據過濾，每天隨數據更新）
    let list: StockRecommendation[] = [];

    switch (activeStrategy) {
      case 'A': // 穩穩大公司：成交量 > 1,000 張 + PSR ≥ 6
        list = recommendations.filter(r => {
          const vol = twsePriceMap[r.coid]?.volume ?? 0;
          return vol >= 1000 && r.psr >= 6;
        });
        // 不足時放寬成交量條件
        if (list.length < 10)
          list = recommendations.filter(r => (twsePriceMap[r.coid]?.volume ?? 0) >= 500 && r.psr >= 6);
        break;

      case 'B': // 最近變強公司：週漲 + 月漲雙確認
        list = recommendations.filter(r => r.ret_w === 'rise' && r.ret_m === 'rise');
        // 不足時加入強度高的
        if (list.length < 10)
          list = recommendations.filter(r => r.ret_w === 'rise' && parseFloat(r.strength || '0') >= 1.8);
        break;

      case 'C': // 市場有注意：法人籌碼強度 > 2.0
        list = recommendations.filter(r => parseFloat(r.strength || '0') > 2.0);
        if (list.length < 10)
          list = recommendations.filter(r => parseFloat(r.strength || '0') >= 1.8);
        break;

      case 'D': // 價值潛力：PSR ≥ 7 + 股價低於外資持股成本
        list = recommendations.filter(r => {
          const close = parseFloat(r.close || '0');
          const wtcost = parseFloat(r.wtcost || '0');
          return r.psr >= 7 && wtcost > 0 && close < wtcost;
        });
        if (list.length < 10)
          list = recommendations.filter(r => {
            const close = parseFloat(r.close || '0');
            const wtcost = parseFloat(r.wtcost || '0');
            return r.psr >= 6 && wtcost > 0 && close <= wtcost * 1.03;
          });
        break;

      case 'E': // 配息安心：金融・電信・公用事業 + 月趨勢不跌
        list = recommendations.filter(r =>
          (r.category?.includes('金融') ||
           r.category?.includes('電信') ||
           r.category?.includes('電力') ||
           r.category?.includes('公用') ||
           r.subindustry?.includes('金融')) &&
          r.ret_m !== 'drop'
        );
        // 不足時放寬：只要 PSR ≥ 8 且不跌
        if (list.length < 10)
          list = recommendations.filter(r => r.psr >= 8 && r.ret_m !== 'drop' && r.ret_w !== 'drop');
        break;

      case 'F': // 便宜好公司：低於外資 + 低於投信成本（雙重折價）
        list = recommendations.filter(r => {
          const close = parseFloat(r.close || '0');
          const wtcost = parseFloat(r.wtcost || '0');
          const fcost = parseFloat(r.fcost || '0');
          return wtcost > 0 && fcost > 0 && close < wtcost && close < fcost;
        });
        // 不足時放寬：任一低於即可
        if (list.length < 10)
          list = recommendations.filter(r => {
            const close = parseFloat(r.close || '0');
            const wtcost = parseFloat(r.wtcost || '0');
            const fcost = parseFloat(r.fcost || '0');
            return r.psr >= 5 && ((wtcost > 0 && close < wtcost) || (fcost > 0 && close < fcost));
          });
        break;
    }

    return list
      .filter(r => !existingStockCodes.has(r.coid))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }, [recommendations, activeStrategy, search, twsePriceMap, aiQualified, aiFilterQualified, existingStockCodes, watchedStockCodes, heldStockCodes]);

  useEffect(() => {
    const q = search.trim();
    if (!q || Object.keys(twsePriceMap).length > 0) {
      setSearchPriceLoading(false);
      return;
    }

    let cancelled = false;
    setSearchPriceLoading(true);
    fetchOfficialPriceMap()
      .then(map => {
        if (cancelled) return;
        if (Object.keys(map).length > 0) {
          setTwsePriceMap(map);
          setCache(CACHE_KEYS.TWSE_PRICE_MAP, map);
          if (canAutoRefreshPrices()) setPriceUpdatedLabel(formatPriceUpdateLabel());
        }
      })
      .finally(() => {
        if (!cancelled) setSearchPriceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [search, twsePriceMap]);

  useEffect(() => {
    const q = search.trim();
    if (!q || filtered.length === 0) {
      setSearchQuantLoading(false);
      return;
    }

    const targetCodes = filtered
      .map(rec => rec.coid)
      .filter(code => !quantDataMap[code])
      .slice(0, 30);
    if (targetCodes.length === 0) {
      setSearchQuantLoading(false);
      return;
    }

    let cancelled = false;
    const timerId = window.setTimeout(async () => {
      setSearchQuantLoading(true);
      const entries = await Promise.all(
        targetCodes.map(code =>
          fetchStockQuantData(code, undefined, { forceFresh: false })
            .then(data => [code, data] as const)
            .catch(() => null)
        )
      );

      if (!cancelled) {
        setQuantDataMap(prev => {
          const next = { ...prev };
          entries.forEach(entry => {
            if (!entry) return;
            const [code, data] = entry;
            next[code] = data;
          });
          return next;
        });
        setSearchQuantLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [search, filtered, quantDataMap]);

  useEffect(() => {
    if (filtered.length === 0) return;
    let cancelled = false;
    let running = false;

    async function refreshVisiblePrices() {
      if (running || cancelled || !canAutoRefreshPrices()) return;
      running = true;
      const targetCodes = [...new Set(filtered.map(rec => rec.coid))].slice(0, 60);
      const [officialMap, realtimeQuotes] = await Promise.all([
        fetchOfficialPriceMap().catch(() => ({} as Record<string, OfficialPriceMapEntry>)),
        Promise.all(targetCodes.map(code => fetchOfficialClosePrice(code).catch(() => null))),
      ]);
      const hasPriceUpdates = realtimeQuotes.some(quote => Boolean(quote?.price && quote.price > 0));
      if (!cancelled) {
        setTwsePriceMap(prev => {
          const next = { ...prev };
          targetCodes.forEach((code, index) => {
            const realtime = realtimeQuotes[index];
            const result = officialMap[code];
            const existing = next[code];
            if (!realtime && !result) return;
            next[code] = {
              close: realtime?.price ? String(realtime.price) : result?.close || existing?.close || '0',
              change: realtime?.previousClose
                ? String(realtime.price - realtime.previousClose)
                : result?.change ?? existing?.change ?? '0',
              name: realtime?.name || result?.name || existing?.name || '',
              volume: result?.volume ?? existing?.volume ?? 0,
              date: realtime?.date || result?.date || existing?.date || getTodayString().replace(/-/g, ''),
              market: existing?.market || result?.market,
            };
          });
          setCache(CACHE_KEYS.TWSE_PRICE_MAP, next);
          return next;
        });
        if (hasPriceUpdates) setPriceUpdatedLabel(formatPriceUpdateLabel());
      }
      running = false;
    }

    refreshVisiblePrices();
    const intervalId = window.setInterval(refreshVisiblePrices, PRICE_AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshVisiblePrices);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshVisiblePrices);
    };
  }, [filtered]);

  function getAdviceBadge(advice: string) {
    switch (advice) {
      case 'buy': return <span className="badge badge-buy">🔥 建議買進</span>;
      case 'sell': return <span className="badge badge-sell">🔴 建議賣出</span>;
      default: return <span className="badge badge-hold">🟡 觀望中</span>;
    }
  }

  function renderAiEntryBadge(coid: string) {
    if (quantDataMap[coid]?.currentSignal !== 'buy') return null;
    return (
      <span className="ai-entry-badge">
        <span className="ai-entry-badge-circle">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </svg>
        </span>
        AI進場
      </span>
    );
  }

  function getScoreStars(score: number): string {
    if (score >= 80) return '⭐⭐⭐⭐⭐';
    if (score >= 65) return '⭐⭐⭐⭐';
    if (score >= 50) return '⭐⭐⭐';
    if (score >= 35) return '⭐⭐';
    return '⭐';
  }

  // AI 量化三指標 helper
  function getRemarkStyle(remark: string): string {
    if (remark.includes('超高')) return 'quant-chip-remark-ultra';
    if (remark.includes('高度')) return 'quant-chip-remark-high';
    if (remark.includes('中度')) return 'quant-chip-remark-mid';
    return 'quant-chip-remark-low';
  }

  function getChipStyle(pts: number): string {
    if (pts >= 7) return 'quant-chip-pts-high';
    if (pts >= 4) return 'quant-chip-pts-mid';
    return 'quant-chip-pts-low';
  }

  function getCumRetStyle(cumRet: string): string {
    const val = parseFloat(cumRet);
    if (isNaN(val)) return '';
    return val >= 0 ? 'quant-chip-ret-pos' : 'quant-chip-ret-neg';
  }

  function renderAiQuantChips(coid: string, loadingQuant = quantLoading) {
    if (loadingQuant && !quantDataMap[coid]) {
      return (
        <div className="quant-chips">
          <span className="quant-chip quant-chip-loading">載入中…</span>
        </div>
      );
    }
    const qd = quantDataMap[coid];
    // 若無完整資料，返回 null（非頂級推薦股票會進個股頁才載）
    if (!qd || !qd.aiQuanBackDataComment) return null;
    const aiRemark = qd.aiQuanBackDataComment?.remark ?? '--';
    const cumRet = qd.aiQuanBackDataComment?.cum_ret ?? '--';
    const ptsRaw = qd.chipStability ? parseFloat(qd.chipStability.pts) : null;
    const chipLabel = ptsRaw === null ? '--' :
      ptsRaw >= 9 ? '最乾淨' :
      ptsRaw >= 7 ? '非常穩定' :
      ptsRaw >= 5 ? '穩定' :
      ptsRaw >= 3 ? '普通' : '凌亂';
    const cumDisplay = cumRet === '--' ? '--' : (cumRet.startsWith('-') ? cumRet : `+${cumRet}`);
    return (
      <div className="quant-chips">
        <span className={`quant-chip quant-chip-remark ${getRemarkStyle(aiRemark)}`}>
          🤖 {aiRemark}
        </span>
        <span className={`quant-chip quant-chip-ret ${getCumRetStyle(cumRet)}`}>
          📊 累積報酬 {cumDisplay}
        </span>
        <span className={`quant-chip quant-chip-pts ${ptsRaw !== null ? getChipStyle(ptsRaw) : ''}`}>
          🔒 籌碼 {ptsRaw !== null ? `${ptsRaw.toFixed(0)}分` : '--'} {chipLabel}
        </span>
      </div>
    );
  }

  return (
    <div className="explore">
      <div className="page-header">
        <h1 className="page-title">🔍 探索股票</h1>
      </div>

      {/* 搜尋 */}
      <div className="search-bar">
        <span className="search-icon">🔎</span>
        <input
          type="text"
          placeholder="搜尋股票名稱或代號..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* 策略選股卡片 */}
      {!hasAiFeature && !search && (
        <section>
          <div className="strategy-grid">
            {STRATEGY_CARDS.filter(card => card.id !== 'ai').map(card => (
              <div
                key={card.id}
                className={`strategy-card ${card.className} ${activeStrategy === card.id ? 'active' : ''}`}
                onClick={() => {
                setActiveStrategy(card.id);
                setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
              }}
              >
                <div className="strategy-icon">{card.icon}</div>
                <div className="strategy-title">{card.title}</div>
                <div className="strategy-desc">
                  {card.desc.split('\n').map((line, i) => <div key={i}>{line}</div>)}
                </div>
              </div>
            ))}
          </div>
          <AdBanner />
        </section>
      )}

      {/* 篩選結果列表 */}
      <section>
        <div ref={resultRef} className="filtered-result-header" style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{search.trim() ? `🔎 搜尋「${search.trim()}」結果` : activeStrategy === 'ai' ? '🤖 AI 每日推薦結果' : `🎯 「${STRATEGY_CARDS.find(c => c.id === activeStrategy)?.title}」策略篩選結果`}</span>
        </div>
        {/* AI 策略專屬篩選切換按鈕 */}
        {activeStrategy === 'ai' && !search.trim() && (
          <button
            onClick={() => setAiFilterQualified(v => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              fontSize: 13, fontWeight: 700,
              color: aiFilterQualified ? '#fff' : 'var(--text-secondary)',
              background: aiFilterQualified
                ? 'linear-gradient(135deg, var(--primary, #dca300) 0%, #f0a500 100%)'
                : '#f0f0f0',
              padding: '8px 16px', borderRadius: 24, marginBottom: 12,
              border: 'none',
              boxShadow: aiFilterQualified ? '0 2px 8px rgba(220,163,0,0.35)' : '0 1px 3px rgba(0,0,0,0.08)',
              transition: 'all 0.22s ease',
              userSelect: 'none',
            }}
          >
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 20, height: 20, borderRadius: 6,
              background: aiFilterQualified ? 'rgba(255,255,255,0.3)' : '#fff',
              border: aiFilterQualified ? 'none' : '1.5px solid #ccc',
              fontSize: 13, transition: 'all 0.18s',
            }}>
              {aiFilterQualified ? '✓' : ''}
            </span>
            篩選：AI 中度以上 + 累積報酬正值
            {aiQualified.size > 0 && (
              <span style={{
                fontWeight: 900,
                color: aiFilterQualified ? 'rgba(255,255,255,0.9)' : 'var(--primary)',
                background: aiFilterQualified ? 'rgba(255,255,255,0.2)' : 'rgba(220,163,0,0.12)',
                padding: '1px 8px', borderRadius: 12, fontSize: 12,
              }}>（{aiQualified.size} 檔）</span>
            )}
          </button>
        )}
        <div className="explore-data-meta">
          <div className="explore-data-meta-lines">
            <span className={`explore-data-freshness ${getDataFreshness().className}`}>{getDataFreshness().label}</span>
            <span className="explore-data-meta-today">今天日期：{formatTodayDate()}</span>
            <span className="explore-data-meta-updated">資料更新：{getDataUpdateLabel()}</span>
            <span className="explore-data-meta-updated">資料日期：{getDataDateLabel()}</span>
            <span className="explore-data-meta-schedule">固定更新：{getFixedUpdateLabel()}</span>
            <span className="explore-data-meta-schedule">價格：進頁與盤中背景自動檢查</span>
          </div>
          <button
            type="button"
            className="explore-refresh-btn"
            title="重新抓取最新資料"
            onClick={handleRefreshData}
            disabled={loading || quantLoading}
          >
            🔄 重新抓取
          </button>
        </div>

        {loading && (
          <div className="loading-spinner">
            <div className="spinner" />
            <div className="loading-text">
              資料載入中... 🐻
            </div>
          </div>
        )}

        {!loading && activeStrategy === 'ai' && quantLoading && (
          <div className="loading-spinner">
            <div className="loading-text">{quantProgress > 0 ? quantProgressText : 'Simons 量化資料背景同步中... 🐻'}</div>
            {quantProgress > 0 && (
              <div className="explore-progress-bar">
                <div
                  className="explore-progress-fill"
                  style={{ width: `${quantProgress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="empty-state">
            <div className="empty-state-icon">😅</div>
            <div className="empty-state-title">{error}</div>
            <button className="btn btn-primary btn-sm" onClick={() => loadData()}>重試</button>
          </div>
        )}

        {!loading && !error && (
          <div className="recommendation-list">
            {filtered.length === 0 && (
              search.trim() && searchPriceLoading ? (
                <div className="loading-spinner">
                  <div className="spinner" />
                  <div className="loading-text">正在搜尋全市場股票...</div>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state-icon">🔍</div>
                  <div className="empty-state-title">找不到結果</div>
                  <div className="empty-state-desc">試試其他關鍵字或分類吧！</div>
                </div>
              )
            )}
            {filtered.map((rec) => {
              const displayRec = getDisplayRecommendation(rec);
              const showQuantDetails = activeStrategy === 'ai' || !!search.trim();
              const hasQuantData = !!quantDataMap[rec.coid]?.aiQuanBackDataComment;
              const isHeld = heldStockCodes.has(displayRec.coid);
              const isWatched = isInWatchlist(displayRec.coid);
              return (
              <div
                key={rec.coid}
                className="stock-card recommendation-card"
                onClick={() => navigateToStock(rec.coid)}
              >
                <div className="rec-left">
                  <div className="rec-header">
                    <IndustryIcon stockCode={displayRec.coid} industry={displayRec.category || displayRec.subindustry} compact />
                    <MarketBadge market={twsePriceMap[rec.coid]?.market} compact />
                    <span className="stock-name">{displayRec.stkname}</span>
                    <span className="stock-code">{displayRec.coid}</span>
                  </div>
                  <div className="rec-meta">
                    <span className="rec-category">{displayRec.category}</span>
                    <span className="rec-stars">{getScoreStars(displayRec.score)}</span>
                  </div>
                  <div className="rec-badges">
                     {renderAiEntryBadge(displayRec.coid)}
                     {getAdviceBadge(displayRec.advice)}
                     {hasQuantData ? (
                       <span className="badge badge-premium">💎 Simons量化評分 {displayRec.score}分</span>
                     ) : (
                       <span className="badge badge-neutral">評分 {displayRec.score}分</span>
                     )}
                   </div>
                  {showQuantDetails && renderAiQuantChips(displayRec.coid, search.trim() ? searchQuantLoading : quantLoading)}
                </div>
                <button
                  className={`wl-quick-btn wl-spotlight-btn ${isWatched || isHeld ? 'wl-quick-active' : ''} ${wlBusy === displayRec.coid ? 'wl-quick-busy' : ''}`}
                  title={isHeld ? '已在庫存' : isWatched ? '已加入觀察名單' : '加入觀察名單'}
                  aria-label={isHeld ? '已在庫存' : isWatched ? '已加入觀察名單' : '加入觀察名單'}
                  disabled={wlBusy === displayRec.coid || isHeld}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (wlBusy || isHeld) return;
                    setWlBusy(displayRec.coid);
                    try {
                      if (isWatched) {
                        await removeFromWatchlist(displayRec.coid);
                      } else {
                        const result = await addToWatchlist(displayRec.coid, displayRec.stkname, parseFloat(getBestClose(displayRec.coid, displayRec.close)));
                        if (result.error) alert(result.error);
                      }
                    } finally {
                      setWlBusy(null);
                    }
                  }}
                >
                  <span className="wl-spotlight-icon">
                    {wlBusy === displayRec.coid ? '⏳' : isHeld ? '📦' : isWatched ? '✅' : '👁️'}
                  </span>
                  <span className="wl-spotlight-label">
                    {isHeld ? '庫存' : isWatched ? '已觀察' : '觀察'}
                  </span>
                </button>
                <div className="rec-right">
                  <div className="rec-price-block">
                    {priceUpdatedLabel && (
                      <div className="stock-price-updated">{priceUpdatedLabel}</div>
                    )}
                    <div className="stock-price">
                      NT${getBestClose(displayRec.coid, displayRec.close)}
                    </div>
                  </div>
                  <div className={`rec-trend ${displayRec.ret_w === 'rise' ? 'text-profit' : 'text-loss'}`}>
                    {displayRec.ret_w === 'rise' ? '📈 週漲' : '📉 週跌'}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}