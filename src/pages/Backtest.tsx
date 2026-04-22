import { useState } from 'react';
import { useStore } from '../store';
import { runAiSignalBacktest } from '../backtest/engine';
import type { BacktestConfig, BacktestResult } from '../backtest/engine';
import './Backtest.css';

const formatMoney = (n: number) =>
  new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(n);


const STRATEGIES = [
  { id: 'ai', label: '🤖 AI 訊號', desc: 'AI 進出場交易紀錄回測' },
  { id: 'A', label: '🏢 穩穩大公司', desc: '成交量 > 1,000張 + PSR ≥ 6' },
  { id: 'B', label: '🚀 最近變強', desc: '週漲 + 月漲雙確認' },
  { id: 'C', label: '👀 市場注意', desc: '法人籌碼強度 > 2.0' },
  { id: 'D', label: '👴 價值潛力', desc: 'PSR ≥ 7 + 股價低於外資成本' },
  { id: 'E', label: '💰 配息安心', desc: '金融/電信/公用事業 + 月趨勢穩定' },
  { id: 'F', label: '🏷️ 便宜好公司', desc: '低於外資 + 投信成本（雙重折價）' },
];

export default function Backtest() {
  const { user } = useStore();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string>('');

  const [config, setConfig] = useState<BacktestConfig>({
    strategy: 'ai',
    startDate: '2025-05-01',
    endDate: new Date().toISOString().split('T')[0],
    initialCapital: 1000000,
    maxPositions: 5,
    positionSize: 'equal',
    holdDays: 5,
    brokerFeeRate: 0.001425,
    brokerTaxRate: 0.003
  });

  const handleRunBacktest = async () => {
    setLoading(true);
    setError('');
    try {
      if (config.strategy === 'ai') {
        const res = await runAiSignalBacktest(config);
        setResult(res);
      } else {
        // TODO: Implement Strategy Filter Backtest (Phase 2)
        setError('此策略的回測引擎仍在開發中，目前僅開放 AI 進出場訊號回測 🐻');
      }
    } catch (err: any) {
      setError(err.message || '回測執行失敗');
    } finally {
      setLoading(false);
    }
  };

  if (!user?.isAdmin) {
    return (
      <div className="backtest-page">
        <div className="page-header">
          <h1 className="page-title">📊 量化回測系統</h1>
        </div>
        <div className="backtest-premium-lock">
          <div className="backtest-premium-lock-icon">🔒</div>
          <h2 style={{ fontSize: '20px', fontWeight: 900, marginBottom: '12px' }}>管理員專屬功能</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.6 }}>
            此功能僅限管理員使用。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="backtest-page">
      <div className="page-header backtest-header">
        <h1 className="page-title">📊 量化回測系統</h1>
      </div>

      <div className="backtest-config-panel">
        <div className="config-group">
          <div className="config-group-title">策略選擇</div>
          <div className="strategy-selectors">
            {STRATEGIES.map(s => (
              <button
                key={s.id}
                className={`strategy-btn ${config.strategy === s.id ? 'active' : ''}`}
                onClick={() => setConfig({ ...config, strategy: s.id as any })}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="config-grid">
          <div className="config-item">
            <label>開始日期</label>
            <input type="date" value={config.startDate} onChange={e => setConfig({...config, startDate: e.target.value})} />
          </div>
          <div className="config-item">
            <label>結束日期</label>
            <input type="date" value={config.endDate} onChange={e => setConfig({...config, endDate: e.target.value})} />
          </div>
          <div className="config-item">
            <label>初始資金</label>
            <input type="number" step="10000" value={config.initialCapital} onChange={e => setConfig({...config, initialCapital: Number(e.target.value)})} />
          </div>
          <div className="config-item">
            <label>最大持股檔數</label>
            <input type="number" min="1" max="20" value={config.maxPositions} onChange={e => setConfig({...config, maxPositions: Number(e.target.value)})} />
          </div>
        </div>

        <button 
          className="btn-run-backtest" 
          onClick={handleRunBacktest}
          disabled={loading}
        >
          {loading ? '⏳ 運算中...' : '▶ 開始回測'}
        </button>

        {error && (
          <div style={{ marginTop: 16, color: 'var(--color-loss)', fontSize: 13, textAlign: 'center', fontWeight: 700 }}>
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="backtest-results">
          <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 16 }}>回測結果總覽</h2>
          
          <div className="summary-grid">
            <div className="summary-card">
              <div className="summary-card-title">總報酬率</div>
              <div className={`summary-card-value ${result.summary.totalReturn >= 0 ? 'profit' : 'loss'}`}>
                {result.summary.totalReturn >= 0 ? '+' : ''}{(result.summary.totalReturn * 100).toFixed(2)}%
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-card-title">勝率</div>
              <div className={`summary-card-value ${result.summary.winRate >= 0.5 ? 'profit' : 'loss'}`}>
                {(result.summary.winRate * 100).toFixed(1)}%
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-card-title">交易筆數</div>
              <div className="summary-card-value" style={{ color: 'var(--text-primary)' }}>
                {result.summary.totalTrades}
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-card-title">盈虧比</div>
              <div className="summary-card-value" style={{ color: 'var(--text-primary)' }}>
                {result.summary.profitFactor.toFixed(2)}
              </div>
            </div>
          </div>

          <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>交易明細 (前 50 筆)</h3>
          <div className="trades-list">
            {result.trades.slice(0, 50).map(t => (
              <div key={t.id} className="trade-item">
                <div className="trade-item-left">
                  <div className="trade-item-name">{t.stkname} <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>{t.coid}</span></div>
                  <div className="trade-item-dates">進: {t.in_date} ({t.buy_price})</div>
                  <div className="trade-item-dates">出: {t.out_date} ({t.sell_price})</div>
                  {t.gvi_in !== undefined && <div className="trade-item-meta">GVI: {t.gvi_in} → {t.gvi_out}</div>}
                </div>
                <div className="trade-item-right">
                  <div className={`trade-item-profit ${t.profit >= 0 ? 'profit' : 'loss'}`}>
                    {t.profit >= 0 ? '+' : ''}{formatMoney(t.profit)}
                  </div>
                  <div className={`trade-item-meta ${t.return_pct >= 0 ? 'profit' : 'loss'}`} style={{ fontWeight: 800 }}>
                    {t.return_pct >= 0 ? '+' : ''}{(t.return_pct * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
