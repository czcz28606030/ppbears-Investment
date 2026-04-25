import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSimonsData, toRecommendation, fetchTWSEAllStocks, fetchTPEXAllStocks, fetchStockQuantData } from '../api';
import type { StockRecommendation } from '../types';
import type { StockQuantData } from '../api';
import { useStore } from '../store';
import { getCache, setCache, CACHE_KEYS } from '../cache';
import AdBanner from '../components/AdBanner';
import './Explore.css';

export default function Explore() {
  const navigate = useNavigate();
  const { hasFeature, isInWatchlist, addToWatchlist, removeFromWatchlist } = useStore();
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

  const [search, setSearch] = useState(restored.current?.search || '');
  const [activeStrategy, setActiveStrategy] = useState(restored.current?.activeStrategy || (hasAiFeature ? 'ai' : 'A'));
  const [error, setError] = useState('');
  const [twsePriceMap, setTwsePriceMap] = useState<Record<string, { close: string; change: string; name: string; volume: number; date: string }>>({});
  const [quantDataMap, setQuantDataMap] = useState<Record<string, StockQuantData>>({});
  const [quantLoading, setQuantLoading] = useState(false);
  const [quantProgress, setQuantProgress] = useState(0); // 量化分析進度 (0~100)
  const [quantProgressText, setQuantProgressText] = useState('');
  const [aiQualified, setAiQualified] = useState<Set<string>>(new Set()); // 記錄符合「中度以上 + 正報酬」的股票
  const [aiFilterQualified, setAiFilterQualified] = useState(true); // 預設勾選篩選
  const [simonsMeta, setSimonsMeta] = useState<Record<string, any>>({}); // 保存原始 SimonsItem 供重新評分用
  const resultRef = useRef<HTMLDivElement>(null);
  const pendingScrollY = useRef(restored.current?.scrollY ?? 0);

  async function loadData() {
    setLoading(true);
    // 清空舊量化資料，避免重整後新 Phase-1 分數配上舊 quantDataMap 造成數據混滞
    setQuantDataMap({});
    setAiQualified(new Set());
    if (activeStrategy === 'ai') setQuantLoading(true);
    setError('');
    setRecommendations([]);
    try {
      // 檢查 TWSE 就最快取（10 分鐘）
      type TwsePriceMapType = Record<string, { close: string; change: string; name: string; volume: number; date: string }>;
      const cachedTwse = getCache<TwsePriceMapType>(CACHE_KEYS.TWSE_PRICE_MAP);
      if (cachedTwse) {
        setTwsePriceMap(cachedTwse);
      } else {
        // 同時抓 TWSE（上市）+ TPEX（上櫃）全市場資料
        const [twseAll, tpexAll] = await Promise.all([fetchTWSEAllStocks(), fetchTPEXAllStocks()]);

        const map: TwsePriceMapType = {};

        // TWSE 上市股票
        for (const s of twseAll) {
          if (s.ClosingPrice) {
            // 民國 7 碼 "1150413" → 西元 "20260413"
            const d = s.Date || '';
            const date = d.length === 7
              ? `${parseInt(d.slice(0, 3)) + 1911}${d.slice(3)}`
              : d.replace(/-/g, '');
            map[s.Code] = {
              close: s.ClosingPrice,
              change: s.Change,
              name: s.Name || '',
              volume: Math.floor(parseInt(s.TradeVolume || '0') / 1000),
              date,
            };
          }
        }
        // TPEX 上櫃股票（合併，不覆蓋已有的上市資料）
        for (const s of tpexAll) {
          if (s.Close && !map[s.SecuritiesCompanyCode]) {
            const d = s.Date || '';
            const date = d.length === 7
              ? `${parseInt(d.slice(0, 3)) + 1911}${d.slice(3)}`
              : d.replace(/-/g, '');
            map[s.SecuritiesCompanyCode] = {
              close: s.Close,
              change: s.Change || '0',
              name: s.CompanyName || '',
              volume: Math.floor(parseInt(s.TradingShares || '0') / 1000),
              date,
            };
          }
        }
        if (Object.keys(map).length > 0) {
          setTwsePriceMap(map);
          setCache(CACHE_KEYS.TWSE_PRICE_MAP, map);
        }
      }

      // 檢查 Simons 快取
      type SimonsCacheData = { recs: StockRecommendation[]; meta: Record<string, any> };
      const cachedSimons = getCache<SimonsCacheData>(CACHE_KEYS.SIMONS_DATA);
      if (cachedSimons) {
        setSimonsMeta(cachedSimons.meta);
        setRecommendations(cachedSimons.recs);
        setLoading(false);
        return;
      }

      // 沒有快取 → Try today first, then yesterday, then last few days
      const today = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        // Skip weekends
        if (date.getDay() === 0 || date.getDay() === 6) continue;
        
        // 使用本地時間格式，避免 toISOString() 轉 UTC 造成日期差一天
        const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        const items = await fetchSimonsData(dateStr);
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
          // 寫入 Simons 快取（10 分鐘）
          setCache<SimonsCacheData>(CACHE_KEYS.SIMONS_DATA, { recs, meta });
          setLoading(false);
          return;
        }
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
    sessionStorage.setItem('explore_stock_list', JSON.stringify(stockList));
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
    // 抓所有 recommendations 的量化資料（API 效能許可）
    let completed = 0;
    const total = recommendations.length;
    Promise.all(recommendations.map(r =>
      fetchStockQuantData(r.coid).then(result => {
        if (!cancelled) {
          completed++;
          setQuantProgress(Math.round((completed / total) * 100));
          setQuantProgressText(`已分析 ${completed} / ${total} 支`);
        }
        return result;
      })
    )).then(results => {
      if (cancelled) return;
      const map: Record<string, StockQuantData> = {};
      const qualified = new Set<string>();
      let updatedRecs: StockRecommendation[] = [];
      
      recommendations.forEach((r, i) => {
        const qd = results[i];
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
      
      // 【NEW】使用新的 Simons 評分重新排序（優先有資料的）
      const recsWithData = updatedRecs.filter(rec => map[rec.coid]?.aiQuanBackDataComment);
      const recsNoData = updatedRecs.filter(rec => !map[rec.coid]?.aiQuanBackDataComment);
      const sorted = [
        ...recsWithData.sort((a, b) => b.score - a.score),
        ...recsNoData.sort((a, b) => b.score - a.score),
      ];
      setRecommendations(sorted);
      setQuantLoading(false);
    }).catch(() => { if (!cancelled) setQuantLoading(false); });
    return () => { cancelled = true; };
  // 監聽 simonsMeta（每次 loadData 產生新物件），確保重整後一定重新執行
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStrategy, simonsMeta]);

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

  const STRATEGY_CARDS = [
    { id: 'A', title: '穩穩大公司', icon: '🏢', desc: '成交量 > 1,000張\nPSR 評分 ≥ 6', className: 'strategy-card-a' },
    { id: 'B', title: '最近變強公司', icon: '🚀', desc: '週漲 + 月漲雙確認\n籌碼動能強勁', className: 'strategy-card-b' },
    { id: 'C', title: '市場有注意公司', icon: '👀', desc: '法人籌碼強度 > 2.0\n外資 / 投信積極布局', className: 'strategy-card-c' },
    { id: 'D', title: '價值潛力公司', icon: '👴', desc: 'PSR 高品質 ≥ 7\n股價低於外資持股成本', className: 'strategy-card-d' },
    { id: 'E', title: '配息安心公司', icon: '💰', desc: '金融・電信・公用事業\n月趨勢穩定不下跌', className: 'strategy-card-e' },
    { id: 'F', title: '便宜好公司', icon: '🏷️', desc: '低於外資 + 投信持股成本\n雙重折價潛在補漲', className: 'strategy-card-f' },
    { id: 'ai', title: 'AI 聰明選股', icon: '🤖', desc: '每日最新大數據\n電腦推薦標的', className: 'strategy-card-ai' }
  ];

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
        category: '搜尋結果',
        ret_w: 'flat',
        kidAdvice: '這是您搜尋的股票，可以看看要不要加入庫存喔！',
      } as StockRecommendation));
    }

    if (activeStrategy === 'ai') {
      // AI 策略：按 Simons 評分由高到低排序
      // 若有勾選篩選，只顯示「中度以上推薦 + 正報酬」的股票
      const sorted = [...recommendations].sort((a, b) => b.score - a.score);
      if (aiFilterQualified) {
        return sorted.filter(r => aiQualified.has(r.coid));
      }
      return sorted;
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

    return list.sort((a, b) => b.score - a.score).slice(0, 20);
  }, [recommendations, activeStrategy, search, twsePriceMap, aiQualified, aiFilterQualified]);

  function getAdviceBadge(advice: string) {
    switch (advice) {
      case 'buy': return <span className="badge badge-buy">🔥 建議買進</span>;
      case 'sell': return <span className="badge badge-sell">🔴 建議賣出</span>;
      default: return <span className="badge badge-hold">🟡 觀望中</span>;
    }
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

  function renderAiQuantChips(coid: string) {
    if (quantLoading && !quantDataMap[coid]) {
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
      {!search && (
        <section>
          <div className="strategy-grid">
            {STRATEGY_CARDS.filter(card => card.id !== 'ai' || hasAiFeature).map(card => (
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
          <span>{activeStrategy === 'ai' ? '🤖 AI 每日推薦結果' : `🎯 「${STRATEGY_CARDS.find(c => c.id === activeStrategy)?.title}」策略篩選結果`}</span>
        </div>
        {/* AI 策略專屬篩選切換按鈕 */}
        {activeStrategy === 'ai' && (
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
        <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
          <span>ℹ️ 資料來源與時間：</span>
          {activeStrategy === 'ai' ? (
             <span style={{ color: 'var(--primary)' }}>Simons 量化模型（{recommendations[0]?.mdate ? recommendations[0].mdate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : '最新同步'}）</span>
          ) : (
             <span style={{ color: 'var(--primary)' }}>台灣證券交易所 TWSE（今日收盤即時資料）</span>
          )}
        </div>

        {(loading || (activeStrategy === 'ai' && quantLoading)) && (
          <div className="loading-spinner">
            <div className="spinner" />
            <div className="loading-text">
              {activeStrategy === 'ai'
                ? quantProgress > 0
                  ? quantProgressText
                  : 'Simons 量化模型計算中... 🐻'
                : '資料載入中... 🐻'
              }
            </div>
            {activeStrategy === 'ai' && quantProgress > 0 && (
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
            <button className="btn btn-primary btn-sm" onClick={loadData}>重試</button>
          </div>
        )}

        {!loading && !error && !(activeStrategy === 'ai' && quantLoading) && (
          <div className="recommendation-list">
            {filtered.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">🔍</div>
                <div className="empty-state-title">找不到結果</div>
                <div className="empty-state-desc">試試其他關鍵字或分類吧！</div>
              </div>
            )}
            {filtered.map((rec) => (
              <div
                key={rec.coid}
                className="stock-card recommendation-card"
                onClick={() => navigateToStock(rec.coid)}
              >
                <div className="rec-left">
                  <div className="rec-header">
                    <span className="stock-name">{rec.stkname}</span>
                    <span className="stock-code">{rec.coid}</span>
                  </div>
                  <div className="rec-meta">
                    <span className="rec-category">{rec.category}</span>
                    <span className="rec-stars">{getScoreStars(rec.score)}</span>
                  </div>
                  <div className="rec-badges">
                     {getAdviceBadge(rec.advice)}
                     {/* 【NEW】Premium Simons 評分標籤 */}
                     {activeStrategy === 'ai' && quantDataMap[rec.coid]?.aiQuanBackDataComment ? (
                       <span className="badge badge-premium">💎 Simons量化評分 {rec.score}分</span>
                     ) : (
                       <span className="badge badge-neutral">評分 {rec.score}分</span>
                     )}
                   </div>
                  {activeStrategy === 'ai' && renderAiQuantChips(rec.coid)}
                </div>
                <div className="rec-right">
                  <div className="stock-price">
                    NT${getBestClose(rec.coid, rec.close)}
                  </div>
                  <div className={`rec-trend ${rec.ret_w === 'rise' ? 'text-profit' : 'text-loss'}`}>
                    {rec.ret_w === 'rise' ? '📈 週漲' : '📉 週跌'}
                  </div>
                  <button
                    className={`wl-quick-btn ${isInWatchlist(rec.coid) ? 'wl-quick-active' : ''} ${wlBusy === rec.coid ? 'wl-quick-busy' : ''}`}
                    title={isInWatchlist(rec.coid) ? '已加入觀察名單' : '加入觀察名單'}
                    disabled={wlBusy === rec.coid}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (wlBusy) return;
                      setWlBusy(rec.coid);
                      try {
                        if (isInWatchlist(rec.coid)) {
                          await removeFromWatchlist(rec.coid);
                        } else {
                          const result = await addToWatchlist(rec.coid, rec.stkname, parseFloat(getBestClose(rec.coid, rec.close)));
                          if (result.error) alert(result.error);
                        }
                      } finally {
                        setWlBusy(null);
                      }
                    }}
                  >
                    {wlBusy === rec.coid ? '⏳' : isInWatchlist(rec.coid) ? '✅' : '👁️'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
