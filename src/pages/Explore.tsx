import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSimonsData, toRecommendation, POPULAR_STOCKS, fetchTWSEAllStocks } from '../api';
import type { StockRecommendation } from '../types';
import './Explore.css';

export default function Explore() {
  const navigate = useNavigate();
  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeStrategy, setActiveStrategy] = useState('ai');
  const [error, setError] = useState('');
  const [twsePriceMap, setTwsePriceMap] = useState<Record<string, { close: string; change: string }>>({});

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      // 同時抓 TWSE 全市場資料和 Simons 推薦
      const [twseAll] = await Promise.all([fetchTWSEAllStocks()]);
      
      // 建立 TWSE 快速查詢 map
      if (twseAll.length > 0) {
        const map: Record<string, { close: string; change: string }> = {};
        for (const s of twseAll) {
          if (s.ClosingPrice) map[s.Code] = { close: s.ClosingPrice, change: s.Change };
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


  const MOCK_STRATEGIES = useMemo(() => ({
    'A': ['2330', '2412', '2881', '2882'],
    'B': ['2317', '2454', '2303'],
    'C': ['3711', '8454', '8464', '8462'],
  }), []);

  const STRATEGY_CARDS = [
    { id: 'A', title: '穩穩大公司', icon: '🏢', desc: '股本 > 100億\n成交量 > 1,000張', className: 'strategy-card-a' },
    { id: 'B', title: '最近變強公司', icon: '🚀', desc: '月營收連3月成長\n近4季ROE > 10%', className: 'strategy-card-b' },
    { id: 'C', title: '市場有注意公司', icon: '👀', desc: '股價站上季線\n外資連3日買超', className: 'strategy-card-c' },
    { id: 'ai', title: 'AI 聰明選股', icon: '🤖', desc: '每日最新大數據\n電腦推薦標的', className: 'strategy-card-d' }
  ];

  const filtered = useMemo(() => {
    let list: StockRecommendation[] = [];
    
    if (activeStrategy === 'ai') {
      list = recommendations;
    } else {
      const strategyCodes = MOCK_STRATEGIES[activeStrategy as keyof typeof MOCK_STRATEGIES] || [];
      list = strategyCodes.map(code => {
        const found = POPULAR_STOCKS.find(s => s.code === code);
        const twse = twsePriceMap[code];
        return {
          coid: code,
          stkname: found ? found.name : `股票 ${code}`,
          close: twse ? twse.close : '0',
          advice: 'buy',
          score: 85,
          category: activeStrategy === 'A' ? '大型權值' : activeStrategy === 'B' ? '高成長' : '籌碼面優',
          ret_w: 'rise',
          kidAdvice: '符合我們的策略選股條件喔！'
        } as StockRecommendation;
      });
    }
    
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r => 
        r.coid.includes(q) || 
        r.stkname.toLowerCase().includes(q) ||
        (r.category && r.category.toLowerCase().includes(q))
      );
    }
    
    return list;
  }, [recommendations, activeStrategy, search, twsePriceMap, MOCK_STRATEGIES]);

  function getAdviceBadge(advice: string) {
    switch (advice) {
      case 'buy': return <span className="badge badge-buy">🟢 建議買進</span>;
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
            {STRATEGY_CARDS.map(card => (
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
        </section>
      )}

      {/* 篩選結果列表 */}
      <section>
        <div className="filtered-result-header">
          {activeStrategy === 'ai' ? '🤖 AI 每日推薦結果' : `🎯 「${STRATEGY_CARDS.find(c => c.id === activeStrategy)?.title}」策略篩選結果`}
          {activeStrategy === 'ai' && <span className="section-action" onClick={loadData} style={{ marginLeft: 'auto', fontWeight: 600 }}>重新整理</span>}
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
