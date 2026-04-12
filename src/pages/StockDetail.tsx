import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchStockData, fetchSimonsData, toRecommendation, POPULAR_STOCKS, fetchTWSEStockPrice } from '../api';
import type { TWSTEStockQuote } from '../api';
import { useStore, formatPrice, formatMoney } from '../store';
import type { StockData, StockPrice, StockRecommendation } from '../types';
import './StockDetail.css';

export default function StockDetail() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [recommendation, setRecommendation] = useState<StockRecommendation | null>(null);
  const [latestPrice, setLatestPrice] = useState<StockPrice | null>(null);
  const [twseQuote, setTwseQuote] = useState<TWSTEStockQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [tradeMode, setTradeMode] = useState<'buy' | 'sell' | null>(null);
  const [quantity, setQuantity] = useState('');
  const [tradeResult, setTradeResult] = useState<{ success: boolean; message: string } | null>(null);
  
  const { user, holdings, executeBuy, executeSell } = useStore();
  const holding = holdings.find(h => h.stockCode === code);

  const stockEmoji = POPULAR_STOCKS.find(s => s.code === code)?.emoji || '📊';

  useEffect(() => {
    if (code) loadStock(code);
  }, [code]);

  async function loadStock(coid: string) {
    setLoading(true);
    try {
      // 同時載入 ifalgo 資料、TWSE 即時行情、推薦
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

      // TWSE 即時行情（收盤價最新）
      if (twseRes && twseRes.ClosingPrice) {
        setTwseQuote(twseRes);
      }

      // 嘗試載入推薦
      const today = new Date();
      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        if (date.getDay() === 0 || date.getDay() === 6) continue;
        const dateStr = date.toISOString().split('T')[0];
        const items = await fetchSimonsData(dateStr);
        const match = items.find(item => item.coid === coid);
        if (match) {
          setRecommendation(toRecommendation(match));
          break;
        }
      }

    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }



  }

  function getKidDescription(): string {
    if (!stockData) return '';
    const status = stockData.status || '';
    const industry = stockData.subindustry || '';
    
    if (status.includes('全球第一') || status.includes('全球最大')) {
      return `🏆 哇！這間公司是世界第一名耶！它${status}`;
    }
    if (status.includes('台灣第一') || status.includes('台灣最大')) {
      return `🇹🇼 這間公司是台灣最厲害的！它${status}`;
    }
    if (industry.includes('半導體') || industry.includes('晶圓')) {
      return `🧠 這間公司是做電腦和手機「大腦」（晶片）的工廠！${status}`;
    }
    if (industry.includes('電路板') || industry.includes('PCB')) {
      return `🔩 這間公司幫電子產品做「骨架」（電路板），就像蓋房子要先打地基一樣！${status}`;
    }
    return `🏢 ${status || '這是一間認真做生意的好公司！'}`;
  }

  // 價格優先展示：TWSE 即時收盤價 > ifalgo 歷史 K 線
  const price = twseQuote?.ClosingPrice
    ? parseFloat(twseQuote.ClosingPrice)
    : (latestPrice ? parseFloat(latestPrice.close_d) : 0);

  async function handleTrade() {
    if (!code || !tradeMode || price <= 0) return;
    const qty = parseInt(quantity);
    
    let result;
    if (tradeMode === 'buy') {
      const name = stockData?.stkname || twseQuote?.Name || code;
      result = await executeBuy(code, name, qty, price, stockData?.subindustry || '');
    } else {
      result = await executeSell(code, qty, price);
    }

    setTradeResult(result);
    if (result.success) {
      setQuantity('');
      setTimeout(() => {
        setTradeMode(null);
        setTradeResult(null);
      }, 1500);
    }
  }

  // 漲跌計算：TWSE Change 是絕對金額，轉為%
  const changeAbsolute = twseQuote?.Change ? parseFloat(twseQuote.Change) : null;
  const prevPrice = price - (changeAbsolute ?? 0);
  const change = twseQuote?.ClosingPrice && changeAbsolute !== null && prevPrice > 0
    ? (changeAbsolute / prevPrice) * 100
    : (latestPrice?.roia ? parseFloat(latestPrice.roia) : 0);
  const isUp = change >= 0;

  const pe = latestPrice?.pe_ratio ? parseFloat(latestPrice.pe_ratio) : 0;
  const pb = latestPrice?.pb_ratio ? parseFloat(latestPrice.pb_ratio) : 0;

  // 資料日期顯示
  const priceDate = twseQuote?.Date
    ? (() => {
        const d = twseQuote.Date; // 民國日期如 "1150410"
        if (d.length === 7) {
          return `民國 ${d.slice(0, 3)} 年 ${d.slice(3, 5)} 月 ${d.slice(5, 7)} 日 (TWSE)`;
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
      <div className="page-header">
        <button className="page-header-back" onClick={() => navigate(-1)}>←</button>
        <h1 className="page-title">{stockEmoji} {stockData?.stkname || code}</h1>
        <span className="detail-code">{code}</span>
      </div>

      {/* 價格區 */}
      <div className="price-hero">
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
        <div className="price-date">
          收盤價 · {priceDate}
        </div>
      </div>

      {/* 用小朋友聽得懂的話介紹 */}
      <div className="card kid-desc-card">
        <div className="kid-desc-header">
          <img src="/ppbear.png" alt="PPBear" className="kid-desc-bear" />
          <span className="kid-desc-title">PPBear 介紹</span>
        </div>
        <p className="kid-desc-text">{getKidDescription()}</p>
      </div>

      {/* AI 建議 */}
      {recommendation && (
        <div className={`ai-card ai-card-${recommendation.advice}`}>
          <div className="ai-card-title">
            {recommendation.advice === 'buy' && '🟢 建議考慮買進'}
            {recommendation.advice === 'hold' && '🟡 先觀望看看'}
            {recommendation.advice === 'sell' && '🔴 可以考慮賣出'}
            <span className="ai-score">({recommendation.score}分)</span>
          </div>
          <div className="ai-card-desc">{recommendation.kidAdvice}</div>
        </div>
      )}

      {/* 基本面分析 */}
      <section>
        <div className="section-header">
          <h2 className="section-title">📊 基本面分析</h2>
        </div>
        <div className="stat-grid">
          <div className="stat-item">
            <div className="stat-label">本益比 (P/E)</div>
            <div className="stat-value">{pe.toFixed(1)}</div>
            <div className="stat-bar">
              <div 
                className="stat-bar-fill" 
                style={{ width: `${Math.min(pe / 30 * 100, 100)}%` }}
                data-label={pe < 15 ? '便宜 🤑' : pe < 25 ? '合理 😊' : '偏貴 🤔'}
              ></div>
            </div>
            <div className="stat-hint">
              {pe < 15 ? '←便宜' : pe < 25 ? '合理→' : '偏貴→→'}
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-label">股價淨值比 (P/B)</div>
            <div className="stat-value">{pb > 0 ? pb.toFixed(2) : '--'}</div>
            <div className="stat-bar">
              <div 
                className="stat-bar-fill stat-bar-secondary" 
                style={{ width: `${pb > 0 ? Math.min(pb / 6 * 100, 100) : 0}%` }}
              ></div>
            </div>
            <div className="stat-hint">
              {pb <= 0 ? '資料更新中' : pb < 2 ? '←可能低估' : pb < 4 ? '合理範圍' : '可能高估→'}
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
        </div>
      </section>

      {/* 籌碼面分析 */}
      {recommendation && (
        <section>
          <div className="section-header">
            <h2 className="section-title">🧮 大人們買在哪裡？</h2>
          </div>
          <div className="chip-analysis">
            <div className="chip-item">
              <div className="chip-label">🌍 外資成本</div>
              <div className="chip-value">NT$ {recommendation.wtcost}</div>
              <div className={`chip-compare ${price < parseFloat(recommendation.wtcost) ? 'text-profit' : 'text-loss'}`}>
                {price < parseFloat(recommendation.wtcost) ? '目前比外資便宜 👍' : '目前比外資貴'}
              </div>
            </div>
            <div className="chip-item">
              <div className="chip-label">🏢 投信成本</div>
              <div className="chip-value">NT$ {recommendation.fcost}</div>
              <div className={`chip-compare ${price < parseFloat(recommendation.fcost) ? 'text-profit' : 'text-loss'}`}>
                {price < parseFloat(recommendation.fcost) ? '目前比投信便宜 👍' : '目前比投信貴'}
              </div>
            </div>
            {recommendation.tcost && (
              <div className="chip-item">
                <div className="chip-label">🏦 自營商成本</div>
                <div className="chip-value">NT$ {recommendation.tcost}</div>
              </div>
            )}
            <div className="chip-item">
              <div className="chip-label">📊 強度指標</div>
              <div className="chip-value">{recommendation.strength}</div>
              <div className="chip-compare">
                {parseFloat(recommendation.strength) > 1.5 ? '很有力道 💪' : '力道普通'}
              </div>
            </div>
          </div>
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

            {quantity && parseInt(quantity) > 0 && (
              <div className="trade-preview">
                <div className="trade-preview-row">
                  <span>預估金額</span>
                  <span className="fw-extra">NT$ {formatMoney(parseInt(quantity) * price)}</span>
                </div>
              </div>
            )}

            {tradeResult && (
              <div className={`trade-result ${tradeResult.success ? 'trade-success' : 'trade-error'}`}>
                {tradeResult.message}
              </div>
            )}

            <button
              className={`btn ${tradeMode === 'buy' ? 'btn-buy' : 'btn-sell'} btn-lg btn-block`}
              onClick={handleTrade}
              disabled={!quantity || parseInt(quantity) <= 0}
            >
              確認{tradeMode === 'buy' ? '買入' : '賣出'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
