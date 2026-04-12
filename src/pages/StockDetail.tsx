import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchStockData, fetchSimonsData, toRecommendation, POPULAR_STOCKS, fetchTWSEStockPrice, getOrGenerateKidFriendlyDesc } from '../api';
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
  const [descLoading, setDescLoading] = useState(true);
  const [kidDesc, setKidDesc] = useState('');
  const [tradeMode, setTradeMode] = useState<'buy' | 'sell' | null>(null);
  const [quantity, setQuantity] = useState('');
  const [tradeReason, setTradeReason] = useState('');
  const [tradeResult, setTradeResult] = useState<{ success: boolean; message: string } | null>(null);
  
  const { user, holdings, executeBuy, executeSell, getPortfolioSummary } = useStore();
  const holding = holdings.find(h => h.stockCode === code);
  const summary = getPortfolioSummary();

  // ─── Risk Warning State ───────────────────────────────
  type RiskWarning = { title: string; message: string; tip: string; icon: string };
  const [pendingWarnings, setPendingWarnings] = useState<RiskWarning[]>([]);
  const [showWarningModal, setShowWarningModal] = useState(false);

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

  // 非同步載入公司介紹
  useEffect(() => {
    async function loadDesc() {
      if (!code) return;
      setDescLoading(true);
      const rawName = stockData?.stkname || twseQuote?.Name || POPULAR_STOCKS.find(s => s.code === code)?.name || code || '';
      const status = stockData?.status || '';
      const industry = stockData?.subindustry || '';
      const desc = await getOrGenerateKidFriendlyDesc(code, rawName, status, industry);
      setKidDesc(desc);
      setDescLoading(false);
    }
    if (!loading) {
      loadDesc();
    }
  }, [code, loading, stockData, twseQuote]);

  // 價格優先展示：TWSE 即時收盤價 > ifalgo 歷史 K 線
  const price = twseQuote?.ClosingPrice
    ? parseFloat(twseQuote.ClosingPrice)
    : (latestPrice ? parseFloat(latestPrice.close_d) : 0);

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
    if (!code || !tradeMode || price <= 0) return;
    setShowWarningModal(false);
    const qty = parseInt(quantity);

    let result;
    if (tradeMode === 'buy') {
      const name = stockData?.stkname || twseQuote?.Name || code;
      result = await executeBuy(code, name, qty, price, stockData?.subindustry || '', tradeReason.trim());
    } else {
      result = await executeSell(code, qty, price, tradeReason.trim());
    }

    setTradeResult(result);
    if (result.success) {
      setQuantity('');
      setTradeReason('');
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
      <div className="page-header" style={{ justifyContent: 'space-between', borderBottom: 'none', paddingBottom: 0 }}>
        <button className="page-header-back" onClick={() => navigate(-1)}>←</button>
        <span className="detail-code" style={{ opacity: 0.5 }}>{code}</span>
      </div>

      {/* 價格區 */}
      <div className="price-hero" style={{ textAlign: 'center', paddingTop: '12px' }}>
        <div style={{ fontSize: '36px', fontWeight: 900, marginBottom: '16px', color: 'var(--text-primary)' }}>
          {stockEmoji} {stockData?.stkname || twseQuote?.Name || code}
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
        <div className="price-date">
          收盤價 · {priceDate}
        </div>
        <div style={{ marginTop: 16 }}>
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
            PPBear 正在認識這間公司中...
          </p>
        ) : (
          <p className="kid-desc-text">{kidDesc}</p>
        )}
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
                  onClick={handleTrade}
                  disabled={!quantity || parseInt(quantity) <= 0 || !tradeReason.trim()}
                >
                  確認{tradeMode === 'buy' ? '買入' : '賣出'}
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
                onClick={() => setShowWarningModal(false)}
              >
                再想想🤔
              </button>
              <button
                className="btn btn-buy"
                style={{ flex: 1, background: '#cc4444' }}
                onClick={doExecuteTrade}
              >
                我瞭解風险，還是要買
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
