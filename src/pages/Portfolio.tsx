import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney, formatPrice } from '../store';
import type { Holding } from '../types';
import { fetchStockQuantData } from '../api';
import { getCache, setCache, clearCache, getCacheTTL, CACHE_KEYS } from '../cache';
import './Portfolio.css';

export default function Portfolio() {
  const navigate = useNavigate();
  const { holdings, getPortfolioSummary, hasFeature, refreshHoldingPrices } = useStore();
  const hasAiFeature = hasFeature('ai_portfolio_advice');
  const summary = getPortfolioSummary();

  // 進入庫存頁時，自動從 TWSE 刷新所有持股現價
  useEffect(() => {
    refreshHoldingPrices();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  const pl = summary.totalProfitLoss;
  const isProfit = pl >= 0;

  const [aiSignals, setAiSignals] = useState<Record<string, {
    primaryLabel: string;
    primaryType: 'buy' | 'sell' | 'neutral';
    primaryIcon: string;
  }>>({});
  const [signalDataDate, setSignalDataDate] = useState<string>('');;
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('正在載入資料...');
  const [enableCustomSignal, setEnableCustomSignal] = useState(() => {
    return localStorage.getItem('ppbears_custom_signal') === 'true';
  });

  const toggleCustomSignal = (val: boolean) => {
    setEnableCustomSignal(val);
    localStorage.setItem('ppbears_custom_signal', String(val));
  };

  useEffect(() => {
    let mounted = true;
    async function loadSignals() {
      if (holdings.length === 0) return;
      if (!hasAiFeature && !enableCustomSignal) {
        if (mounted && Object.keys(aiSignals).length > 0) setAiSignals({});
        return;
      }

      // 檢查快取（5 分鐘）
      type SignalCacheData = typeof aiSignals & { _date: string; _holdingKeys: string };
      const holdingKeys = holdings.map(h => h.stockCode).sort().join(',');
      const cacheKey = CACHE_KEYS.PORTFOLIO_SIGNALS;
      const cached = getCache<SignalCacheData>(cacheKey);
      if (cached && cached._holdingKeys === holdingKeys) {
        if (mounted) {
          const { _date, _holdingKeys: _k, ...cachedSignals } = cached;
          setAiSignals(cachedSignals);
          setSignalDataDate(_date);
        }
        return;
      }

      if (mounted) {
        setSignalsLoading(true);
        setLoadingMsg('正在連線 AI 量化分析...');
      }
      
      const signals: Record<string, {
        primaryLabel: string;
        primaryType: 'buy' | 'sell' | 'neutral';
        primaryIcon: string;
      }> = {};

      if (hasAiFeature) {
        // 記錄 Simons 量化模型爬取時間
        if (mounted) {
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          setSignalDataDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`);
        }
        try {
          // 並行取得 AI 量化訊號
          if (mounted) setLoadingMsg(`正在分析 ${holdings.length} 支持股 AI 訊號...`);

          await Promise.all(holdings.map(async (h) => {
            const quantData = await fetchStockQuantData(h.stockCode).catch(() => null);

            // ── 主訊號：使用 fetchStockQuantData 裡已解析的 currentSignal ──
            let primaryLabel: string;
            let primaryType: 'buy' | 'sell' | 'neutral';
            let primaryIcon: string;

            const sig = quantData?.currentSignal ?? 'neutral';
            if (sig === 'buy') {
              primaryLabel = 'AI 加碼'; primaryType = 'buy'; primaryIcon = '🚀';
            } else if (sig === 'sell') {
              primaryLabel = 'AI 出場'; primaryType = 'sell'; primaryIcon = '⚠️';
            } else {
              primaryLabel = 'AI 中立'; primaryType = 'neutral'; primaryIcon = '⚖️';
            }

            signals[h.stockCode] = { primaryLabel, primaryType, primaryIcon };
          }));

        } catch (err) {
          console.error('Failed to load AI signals', err);
        }
      } else if (enableCustomSignal) {
        await Promise.all(holdings.map(async (h) => {
          try {
             const start = new Date();
             start.setDate(start.getDate() - 150);
             const _pad2 = (n: number) => String(n).padStart(2, '0');
             const dateStr = `${start.getFullYear()}-${_pad2(start.getMonth() + 1)}-${_pad2(start.getDate())}`;
             const res = await fetch(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${h.stockCode}&start_date=${dateStr}`);
             const json = await res.json();
             const data = json.data;
             if (data && data.length >= 60) {
               const closes = data.map((d: any) => d.close);
               const getSMA = (arr: number[], period: number, offset: number = 0) => {
                 const slice = arr.slice(arr.length - period - offset, arr.length - offset);
                 return slice.reduce((a, b) => a + b, 0) / period;
               };
               const lastClose = closes[closes.length - 1];
               const sma60 = getSMA(closes, 60, 0);
               const sma60Prev = getSMA(closes, 60, 1);
               const prevClose = closes[closes.length - 2];
               const max20 = Math.max(...closes.slice(-20));
               if (lastClose > sma60 && lastClose >= max20) {
                 signals[h.stockCode] = { primaryLabel: '技術加碼', primaryType: 'buy', primaryIcon: '🚀' };
               } else if (lastClose < sma60 && prevClose < sma60Prev) {
                 signals[h.stockCode] = { primaryLabel: '技術出場', primaryType: 'sell', primaryIcon: '🚪' };
               } else {
                 signals[h.stockCode] = { primaryLabel: '技術中立', primaryType: 'neutral', primaryIcon: '⚖️' };
               }
             }
          } catch (e) {
             console.error('Fetch technical fail:', e);
          }
        }));
      }

      if (mounted) {
        setAiSignals(signals);
        setSignalsLoading(false);
        // 寫入快取（5 分鐘）
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        setCache(cacheKey, { ...signals, _date: dateStr, _holdingKeys: holdingKeys }, 5 * 60 * 1000);
      }
    }
    loadSignals();
    return () => { mounted = false; };
  }, [holdings, hasAiFeature, enableCustomSignal]);

  return (
    <div className="portfolio">
      {/* AI 訊號抓取 Loading Overlay */}
      {signalsLoading && holdings.length > 0 && (
        <div className="pf-loading-overlay">
          <div className="pf-loading-card">
            <div className="pf-loading-icon">📊</div>
            <div className="pf-loading-rings">
              <div className="pf-loading-ring pf-ring-1" />
              <div className="pf-loading-ring pf-ring-2" />
              <div className="pf-loading-ring pf-ring-3" />
            </div>
            <div className="pf-loading-title">AI 訊號分析中</div>
            <div className="pf-loading-step">{loadingMsg}</div>
            <div className="pf-loading-dots">
              <span /><span /><span />
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <h1 className="page-title">💼 我的庫存</h1>
      </div>

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
      </div>

      <div className="section-header" style={{ marginTop: '24px', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="section-title" style={{ margin: 0 }}>📊 持股清單 ({holdings.length})</h2>
        {!hasAiFeature && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13.5px', color: '#555', cursor: 'pointer', fontWeight: 600, background: '#f5f5f5', padding: '6px 12px', borderRadius: '8px' }}>
              <input 
                type="checkbox" 
                checked={enableCustomSignal} 
                onChange={e => toggleCustomSignal(e.target.checked)} 
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              顯示加碼與出場訊號
            </label>
            {enableCustomSignal && (
              <div style={{ fontSize: '11px', color: '#888', background: '#f5f5f5', padding: '6px 10px', borderRadius: '6px', lineHeight: '1.4' }}>
                <span style={{ color: '#FF2424', fontWeight: 600 }}>加碼：</span>站上季線 + 收盤創 20 日新高<br/>
                <span style={{ color: 'var(--loss-color)', fontWeight: 600 }}>出場：</span>跌破季線連續 2 天
              </div>
            )}
          </div>
        )}
      </div>

      {/* 資料來源小字 */}
      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, flexWrap: 'wrap' }}>
        <span>ℹ️ 資料來源與時間：</span>
        {hasAiFeature ? (
          <>
            <span style={{ color: 'var(--primary)' }}>AI 量化分析（{signalDataDate || '載入中...'}）</span>
            {getCacheTTL(CACHE_KEYS.PORTFOLIO_SIGNALS) > 0 && (
              <span className="pf-cache-badge">⚡ 快取中</span>
            )}
            {signalDataDate && (
              <button
                className="pf-refresh-btn"
                title="重新抓取最新 AI 訊號"
                onClick={() => {
                  clearCache(CACHE_KEYS.PORTFOLIO_SIGNALS);
                  setAiSignals({});
                  setSignalDataDate('');
                }}
              >
                🔄 重新抓取
              </button>
            )}
          </>
        ) : enableCustomSignal ? (
          <span style={{ color: 'var(--primary)' }}>FinMind 技術指標（近 150 日）</span>
        ) : (
          <span style={{ color: 'var(--text-tertiary)' }}>台灣證券交易所 TWSE（持倉成本為入場均價）</span>
        )}
      </div>


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
          ) : (
            holdings.map((h: Holding) => {
              const itemPL = (h.currentPrice - h.avgCost) * h.totalShares;
              const itemPLPct = ((h.currentPrice - h.avgCost) / h.avgCost * 100);
              const itemIsProfit = itemPL >= 0;
              const signal = aiSignals[h.stockCode];
              return (
                <div
                  key={h.stockCode}
                  className={`holding-item${signal ? ` signal-${signal.primaryType}` : ''}`}
                  onClick={() => navigate(`/stock/${h.stockCode}`)}
                >
                  <div className="holding-main-row">
                    <div className="holding-left">
                      {signal ? (
                        <div className={`signal-badge signal-badge-${signal.primaryType}`}>
                          <span className="signal-badge-icon">{signal.primaryIcon}</span>
                          <span className="signal-badge-text">{signal.primaryLabel}</span>
                        </div>
                      ) : (
                        <div className="holding-emoji">{itemIsProfit ? '😊' : '😢'}</div>
                      )}
                      <div>
                        <div className="holding-name">{h.stockName}</div>
                        <div className="holding-code">{h.stockCode}</div>
                      </div>
                    </div>
                    <div className="holding-center">
                      <div className="holding-shares">{h.totalShares} 股</div>
                      <div className="holding-avg">成本 {formatPrice(h.avgCost)}</div>
                    </div>
                    <div className="holding-right">
                      <div className="holding-current">NT$ {formatPrice(h.currentPrice)}</div>
                      <div className={`holding-pl ${itemIsProfit ? 'text-profit' : 'text-loss'}`}>
                        {itemIsProfit ? '+' : ''}{formatMoney(itemPL)}
                      </div>
                      <div className={`holding-pl-pct ${itemIsProfit ? 'text-profit' : 'text-loss'}`}>
                        ({itemIsProfit ? '+' : ''}{itemPLPct.toFixed(1)}%)
                      </div>
                    </div>
                  </div>

                </div>
              );
            })
          )}
        </div>
    </div>
  );
}
