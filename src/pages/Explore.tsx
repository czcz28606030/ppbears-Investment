import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSimonsData, toRecommendation, POPULAR_STOCKS, INDUSTRY_CATEGORIES } from '../api';
import type { StockRecommendation } from '../types';
import './Explore.css';

export default function Explore() {
  const navigate = useNavigate();
  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
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

  const filtered = useMemo(() => {
    let list = recommendations;
    
    if (activeCategory !== 'all') {
      list = list.filter(r => r.category?.includes(activeCategory));
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
  }, [recommendations, activeCategory, search]);

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

      {/* 分類標籤 */}
      <div className="category-scroll">
        {INDUSTRY_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            className={`category-chip ${activeCategory === cat.key ? 'active' : ''}`}
            onClick={() => setActiveCategory(cat.key)}
          >
            {cat.emoji} {cat.label}
          </button>
        ))}
      </div>

      {/* 熱門股票快捷 */}
      {!search && activeCategory === 'all' && (
        <section className="popular-section">
          <div className="section-header">
            <h2 className="section-title">🌟 熱門股票</h2>
          </div>
          <div className="popular-scroll">
            {POPULAR_STOCKS.map((s) => (
              <button
                key={s.code}
                className="popular-chip"
                onClick={() => navigate(`/stock/${s.code}`)}
              >
                <span>{s.emoji}</span>
                <span className="popular-chip-name">{s.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* AI 推薦列表 */}
      <section>
        <div className="section-header">
          <h2 className="section-title">🤖 AI 每日推薦</h2>
          <span className="section-action" onClick={loadData}>重新整理</span>
        </div>

        {loading && (
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
                  <div className="stock-price">NT${rec.close}</div>
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
