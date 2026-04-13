import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSimonsData, toRecommendation, fetchTWSEAllStocks } from '../api';
import type { StockRecommendation } from '../types';
import { useStore } from '../store';
import AdBanner from '../components/AdBanner';
import './Explore.css';

export default function Explore() {
  const navigate = useNavigate();
  const { hasFeature } = useStore();
  const hasAiFeature = hasFeature('ai_stock_picking');
  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeStrategy, setActiveStrategy] = useState(hasAiFeature ? 'ai' : 'A');
  const [error, setError] = useState('');
  const [twsePriceMap, setTwsePriceMap] = useState<Record<string, { close: string; change: string; name: string; volume: number }>>({});

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      // 同時抓 TWSE 全市場資料和 Simons 推薦
      const [twseAll] = await Promise.all([fetchTWSEAllStocks()]);
      
      // 建立 TWSE 快速查詢 map
      if (twseAll.length > 0) {
        const map: Record<string, { close: string; change: string; name: string; volume: number }> = {};
        for (const s of twseAll) {
          if (s.ClosingPrice) map[s.Code] = {
            close: s.ClosingPrice,
            change: s.Change,
            name: s.Name || '',
            volume: Math.floor(parseInt(s.TradeVolume || '0') / 1000), // 轉換為「張」
          };
        }
        setTwsePriceMap(map);
      }

      // Try today first, then yesterday, then last few days
      const today = new Date();
      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        // Skip weekends
        if (date.getDay() === 0 || date.getDay() === 6) continue;
        
        const dateStr = date.toISOString().split('T')[0];
        const items = await fetchSimonsData(dateStr);
        if (items.length > 0) {
          const recs = items.map(toRecommendation);
          recs.sort((a, b) => b.score - a.score);
          setRecommendations(recs);
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

    if (activeStrategy === 'ai') return recommendations;

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
  }, [recommendations, activeStrategy, search, twsePriceMap]);

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
                onClick={() => setActiveStrategy(card.id)}
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
        <div className="filtered-result-header" style={{ marginBottom: 4 }}>
          {activeStrategy === 'ai' ? '🤖 AI 每日推薦結果' : `🎯 「${STRATEGY_CARDS.find(c => c.id === activeStrategy)?.title}」策略篩選結果`}
          {activeStrategy === 'ai' && <span className="section-action" onClick={loadData} style={{ marginLeft: 'auto', fontWeight: 600 }}>重新整理</span>}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
          <span>ℹ️ 資料來源與時間：</span>
          {activeStrategy === 'ai' ? (
             <span style={{ color: 'var(--primary)' }}>Simons 量化模型（{recommendations[0]?.mdate ? recommendations[0].mdate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : '最新同步'}）</span>
          ) : (
             <span style={{ color: 'var(--primary)' }}>台灣證券交易所 TWSE（今日收盤即時資料）</span>
          )}
        </div>

        {loading && activeStrategy === 'ai' && (
          <div className="loading-spinner">
            <div className="spinner"></div>
            <div className="loading-text">PPBear 正在分析股票... 🐻</div>
          </div>
        )}

        {error && (
          <div className="empty-state">
            <div className="empty-state-icon">😅</div>
            <div className="empty-state-title">{error}</div>
            <button className="btn btn-primary btn-sm" onClick={loadData}>重試</button>
          </div>
        )}

        {!loading && !error && (
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
                onClick={() => navigate(`/stock/${rec.coid}`)}
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
                     <span className="badge badge-neutral">評分 {rec.score}分</span>
                   </div>
                </div>
                <div className="rec-right">
                  <div className="stock-price">
                    NT${twsePriceMap[rec.coid]?.close || rec.close}
                    {twsePriceMap[rec.coid] && (
                      <span style={{ fontSize: '0.65em', marginLeft: 4, color: '#aaa' }}>TWSE</span>
                    )}
                  </div>
                  <div className={`rec-trend ${rec.ret_w === 'rise' ? 'text-profit' : 'text-loss'}`}>
                    {rec.ret_w === 'rise' ? '📈 週漲' : '📉 週跌'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
