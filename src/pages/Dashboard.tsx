import { useState, useEffect } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, formatMoney } from '../store';
import { fetchHomeMarketSummary, type HomeMarketSummary } from '../api';
import AdBanner from '../components/AdBanner';
import './Dashboard.css';

const MOOD_ICON: Record<HomeMarketSummary['marketMood']['primary'], string> = {
  貪婪: '🔥',
  樂觀: '☀️',
  放鬆: '🍃',
  冷靜: '🧊',
};

const MOOD_CLASS: Record<HomeMarketSummary['marketMood']['primary'], string> = {
  貪婪: 'greedy',
  樂觀: 'upbeat',
  放鬆: 'relaxed',
  冷靜: 'calm',
};

function mapValue(value: number, min: number, max: number, top: number, bottom: number): number {
  return bottom - ((value - min) / (max - min)) * (bottom - top);
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pointsToPath(points: Array<{ x: number; y: number }>): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}

function monthLabelToDate(label: string): string {
  const [year, month] = label.split('/');
  if (!year || !month) return label;
  return `${year}-${month.padStart(2, '0')}-01`;
}

function formatChartNumber(value: number, digits: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function polarPoint(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const angle = (angleDeg * Math.PI) / 180;
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  };
}

function getMonthlyGaugeScore(label: string, score: number, directionScore?: number): number {
  if (typeof directionScore === 'number' && Number.isFinite(directionScore)) return clampValue(directionScore, 0, 100);
  const normalized = String(label || '');
  if (normalized.includes('偏多') || normalized.includes('多')) return 82;
  if (normalized.includes('偏空') || normalized.includes('偏弱') || normalized.includes('空')) return 18;
  if (normalized.includes('穩健')) return 62;
  return clampValue(score, 0, 100);
}

function MarketMomentumChart({ summary }: { summary: HomeMarketSummary }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const width = 640;
  const height = 360;
  const chart = { left: 54, right: 50, top: 44, bottom: 44 };
  const chartWidth = width - chart.left - chart.right;
  const chartHeight = height - chart.top - chart.bottom;
  const [momentumMin, momentumMax] = summary.marketFundMomentum.momentumRange;
  const [taiexMin, taiexMax] = summary.marketFundMomentum.taiexRange;
  const points = summary.marketFundMomentum.points;
  const zeroY = mapValue(0, momentumMin, momentumMax, chart.top, chart.top + chartHeight);
  const barGap = 5;
  const barWidth = Math.max(5, chartWidth / points.length - barGap);
  const linePoints = points.map((point, index) => ({
    x: chart.left + (index / Math.max(points.length - 1, 1)) * chartWidth,
    y: mapValue(point.taiex, taiexMin, taiexMax, chart.top, chart.top + chartHeight),
  }));
  const momentumTicks = [0, -0.3, -0.6, -0.9, -1.2, -1.5];
  const taiexTicks = [48000, 46000, 44000, 42000, 40000, 38000, 36000, 34000, 32000, 30000, 28000, 26000, 24000, 22000, 20000, 18000, 16000, 14000, 12000, 10000, 8000, 6000, 4000, 2000];
  const hoveredPoint = hoverIndex === null ? null : points[hoverIndex];
  const hoveredLinePoint = hoverIndex === null ? null : linePoints[hoverIndex];
  const tooltipX = hoveredLinePoint ? Math.min(Math.max(hoveredLinePoint.x - 96, chart.left + 8), width - chart.right - 210) : 0;
  const tooltipY = hoveredLinePoint ? Math.min(Math.max(hoveredLinePoint.y - 66, chart.top + 8), chart.top + chartHeight - 88) : 0;

  function handleChartPointerMove(event: MouseEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = clampValue((svgX - chart.left) / chartWidth, 0, 1);
    const nextIndex = Math.round(ratio * (points.length - 1));
    setHoverIndex(nextIndex);
  }

  return (
    <div className="macro-chart-with-guide">
      <button
        type="button"
        className="macro-chart-help-button"
        aria-expanded={showGuide}
        aria-label="查看市場資金動能圖說明"
        onClick={() => setShowGuide(current => !current)}
      >
        ?
      </button>
      <svg className="macro-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="市場資金動能圖">
        <text x={width / 2} y="24" textAnchor="middle" className="macro-chart-title-svg">市場資金動能圖</text>
        {momentumTicks.map(tick => {
          const y = mapValue(tick, momentumMin, momentumMax, chart.top, chart.top + chartHeight);
          return (
            <g key={tick}>
              <line x1={chart.left} x2={width - chart.right} y1={y} y2={y} className="macro-grid-line" />
              <text x={chart.left - 10} y={y + 4} textAnchor="end" className="macro-axis-text">{tick === 0 ? '0' : tick.toFixed(1)}</text>
            </g>
          );
        })}
        {taiexTicks.map(tick => {
          const y = mapValue(tick, taiexMin, taiexMax, chart.top, chart.top + chartHeight);
          return <text key={tick} x={width - chart.right + 8} y={y + 4} className="macro-axis-text">{tick.toLocaleString('en-US')}</text>;
        })}
        <text x="15" y={height / 2} transform={`rotate(-90 15 ${height / 2})`} textAnchor="middle" className="macro-axis-label">市場資金動能</text>
        {points.map((point, index) => {
          const x = chart.left + index * (chartWidth / points.length) + barGap / 2;
          const y = mapValue(point.moneyMomentum, momentumMin, momentumMax, chart.top, chart.top + chartHeight);
          return (
            <rect
              key={`${point.label}-${index}`}
              x={x}
              y={Math.min(y, zeroY)}
              width={barWidth}
              height={Math.max(2, Math.abs(zeroY - y))}
              className={`macro-money-bar ${point.moneyMomentum >= 0 ? 'positive' : 'negative'}`}
            />
          );
        })}
        <path d={pointsToPath(linePoints)} className="macro-taiex-line" />
        {hoveredPoint && hoveredLinePoint && (
          <g className="macro-hover-layer">
            <line x1={hoveredLinePoint.x} x2={hoveredLinePoint.x} y1={chart.top} y2={chart.top + chartHeight} className="macro-hover-line" />
            <circle cx={hoveredLinePoint.x} cy={hoveredLinePoint.y} r="4.2" className="macro-hover-dot" />
            <rect x={chart.left - 48} y={mapValue(hoveredPoint.moneyMomentum, momentumMin, momentumMax, chart.top, chart.top + chartHeight) - 12} width="48" height="22" rx="3" className="macro-hover-axis-tag" />
            <text x={chart.left - 24} y={mapValue(hoveredPoint.moneyMomentum, momentumMin, momentumMax, chart.top, chart.top + chartHeight) + 4} textAnchor="middle" className="macro-hover-axis-text">{hoveredPoint.moneyMomentum.toFixed(3)}</text>
            <rect x={width - chart.right + 4} y={hoveredLinePoint.y - 12} width="58" height="22" rx="3" className="macro-hover-axis-tag" />
            <text x={width - chart.right + 33} y={hoveredLinePoint.y + 4} textAnchor="middle" className="macro-hover-axis-text">{formatChartNumber(hoveredPoint.taiex, 2)}</text>
            <rect x={hoveredLinePoint.x - 39} y={height - chart.bottom + 8} width="78" height="24" rx="3" className="macro-hover-axis-tag" />
            <text x={hoveredLinePoint.x} y={height - chart.bottom + 24} textAnchor="middle" className="macro-hover-axis-text">{monthLabelToDate(hoveredPoint.label)}</text>
            <g transform={`translate(${tooltipX} ${tooltipY})`}>
              <rect width="202" height="76" rx="4" className="macro-tooltip-box" />
              <text x="12" y="23" className="macro-tooltip-date">{monthLabelToDate(hoveredPoint.label)}</text>
              <circle cx="16" cy="43" r="5" className="macro-tooltip-money-dot" />
              <text x="28" y="47" className="macro-tooltip-label">市場資金動能</text>
              <text x="186" y="47" textAnchor="end" className="macro-tooltip-value">{hoveredPoint.moneyMomentum.toFixed(4)}</text>
              <circle cx="16" cy="63" r="5" className="macro-tooltip-taiex-dot" />
              <text x="28" y="67" className="macro-tooltip-label">大盤月K</text>
              <text x="186" y="67" textAnchor="end" className="macro-tooltip-value">{formatChartNumber(hoveredPoint.taiex, 1)}</text>
            </g>
          </g>
        )}
        <text x={chart.left} y={height - 10} className="macro-axis-text">Jul</text>
        <text x={chart.left + chartWidth * 0.15} y={height - 10} className="macro-axis-text bold">2023</text>
        <text x={chart.left + chartWidth * 0.29} y={height - 10} className="macro-axis-text">Jul</text>
        <text x={chart.left + chartWidth * 0.42} y={height - 10} className="macro-axis-text bold">2024</text>
        <text x={chart.left + chartWidth * 0.56} y={height - 10} className="macro-axis-text">Jul</text>
        <text x={chart.left + chartWidth * 0.72} y={height - 10} className="macro-axis-text bold">2025</text>
        <text x={chart.left + chartWidth * 0.85} y={height - 10} className="macro-axis-text">Jul</text>
        <text x={chart.left + chartWidth * 0.93} y={height - 10} className="macro-axis-text bold">2026</text>
        <rect
          x={chart.left}
          y={chart.top}
          width={chartWidth}
          height={chartHeight}
          className="macro-chart-hit-area"
          onMouseMove={handleChartPointerMove}
          onMouseLeave={() => setHoverIndex(null)}
        />
      </svg>
      {showGuide && (
        <div className="macro-chart-guide" role="note">
          <h3>這張圖可以看什麼</h3>
          <p>柱體是 IFalgo 模型的市場資金動能；紅色代表動能轉正，綠色代表仍在 0 以下，藍線是大盤月 K。</p>
          <ul>
            <li>柱體往 0 靠近，代表模型中的資金壓力減輕。</li>
            <li>柱體往下擴大，代表模型中的資金動能轉弱。</li>
            <li>藍線上升且柱體同步改善，表示行情上漲較有資金動能配合。</li>
            <li>藍線創高但柱體沒有改善，可能代表行情較集中或資金動能沒有同步跟上。</li>
          </ul>
          <p>這不是外資匯入金額，也不是成交量；不能直接用來判斷外資有沒有進場。</p>
        </div>
      )}
    </div>
  );
}

function MarginMaintenanceChart({ summary }: { summary: HomeMarketSummary }) {
  const width = 640;
  const height = 180;
  const chart = { left: 50, right: 42, top: 38, bottom: 34 };
  const chartWidth = width - chart.left - chart.right;
  const chartHeight = height - chart.top - chart.bottom;
  const min = 145;
  const max = 168;
  const points = summary.marginMaintenance.points.map((point, index) => ({
    x: chart.left + (index / Math.max(summary.marginMaintenance.points.length - 1, 1)) * chartWidth,
    y: mapValue(point.rate, min, max, chart.top, chart.top + chartHeight),
  }));
  const ticks = [168, 165, 160, 155, 150, 145];

  return (
    <svg className="macro-chart-svg margin" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="大盤融資維持率">
      <text x={width / 2} y="22" textAnchor="middle" className="macro-chart-title-svg">大盤融資維持率</text>
      <text x={width - chart.right + 4} y="22" className="macro-axis-text">單位%</text>
      {ticks.map(tick => {
        const y = mapValue(tick, min, max, chart.top, chart.top + chartHeight);
        return (
          <g key={tick}>
            <line x1={chart.left} x2={width - chart.right} y1={y} y2={y} className="macro-grid-line" />
            <text x={width - chart.right + 8} y={y + 4} className="macro-axis-text">{tick}</text>
          </g>
        );
      })}
      <path d={pointsToPath(points)} className="macro-taiex-line" />
      <text x={chart.left - 24} y={height - 4} className="macro-axis-text">2025/12/01</text>
      <text x={chart.left + chartWidth * 0.22} y={height - 4} className="macro-axis-text">2026/01/01</text>
      <text x={chart.left + chartWidth * 0.42} y={height - 4} className="macro-axis-text">2026/02/01</text>
      <text x={chart.left + chartWidth * 0.62} y={height - 4} className="macro-axis-text">2026/03/01</text>
      <text x={chart.left + chartWidth * 0.81} y={height - 4} className="macro-axis-text">2026/04/01</text>
      <text x={width - chart.right - 28} y={height - 4} className="macro-axis-text">2026/05/01</text>
    </svg>
  );
}

function MonthlyGauge({
  score,
  label,
  monthLabel,
  directionScore,
}: {
  score: number;
  label: string;
  monthLabel: string;
  directionScore?: number;
}) {
  const gaugeScore = getMonthlyGaugeScore(label, score, directionScore);
  const rotation = -90 + (gaugeScore / 100) * 180;
  const needle = polarPoint(85, 92, 47, rotation - 90);
  const title = `AI ${monthLabel}預測多空`;
  const centerText = label || `${score}分`;
  return (
    <div className="macro-gauge-block">
      <div className="macro-gauge-title"><span>☀️</span> {title}</div>
      <svg viewBox="0 0 170 122" className="macro-gauge-svg cute" role="img" aria-label={`${title} ${centerText}`}>
        <path d="M24 92 A61 61 0 0 1 146 92" className="cute-gauge-track" />
        <path d="M24 92 A61 61 0 0 1 85 31" className="cute-gauge-arc calm" />
        <path d="M85 31 A61 61 0 0 1 146 92" className="cute-gauge-arc bright" />
        <circle cx="43" cy="66" r="5" className="cute-dot calm" />
        <circle cx="85" cy="31" r="6" className="cute-dot middle" />
        <circle cx="128" cy="66" r="5" className="cute-dot bright" />
        <line x1="85" y1="92" x2={needle.x} y2={needle.y} className="cute-gauge-needle-line" />
        <circle cx={needle.x} cy={needle.y} r="4.5" className="cute-gauge-needle-tip" />
        <circle cx="85" cy="92" r="8" className="cute-gauge-center" />
        <text x="85" y="112" textAnchor="middle" className="cute-gauge-score">{centerText}</text>
      </svg>
    </div>
  );
}

function DailyGauge({ score, maxScore }: { score: number; maxScore: number }) {
  const clampedScore = Math.max(0, Math.min(maxScore, score));
  const needleAngle = 180 + (clampedScore / maxScore) * 180;
  const needle = polarPoint(85, 84, 45, needleAngle);
  const tickValues = Array.from({ length: maxScore + 1 }, (_, value) => value);
  return (
    <div className="macro-gauge-block daily">
      <div className="macro-gauge-title"><span>⚡</span> AI今日預測多空</div>
      <svg viewBox="0 0 170 122" className="macro-gauge-svg daily cute" role="img" aria-label={`AI今日預測多空 ${score}分`}>
        <path d="M23 84 A62 62 0 0 1 147 84" className="cute-daily-track" />
        <path d="M23 84 A62 62 0 0 1 69 28" className="cute-daily-segment cool" />
        <path d="M69 28 A62 62 0 0 1 118 38" className="cute-daily-segment soft" />
        <path d="M118 38 A62 62 0 0 1 147 84" className="cute-daily-segment hot" />
        {tickValues.map(value => {
          const angle = 180 + (value / maxScore) * 180;
          const label = polarPoint(85, 84, 43, angle);
          const tickOuter = polarPoint(85, 84, 61, angle);
          const tickInner = polarPoint(85, 84, 53, angle);
          return (
            <g key={value}>
              <line x1={tickInner.x} y1={tickInner.y} x2={tickOuter.x} y2={tickOuter.y} className="cute-daily-tick" />
              <text x={label.x} y={label.y + 4} textAnchor="middle" className="macro-daily-number">{value}</text>
            </g>
          );
        })}
        <line x1="85" y1="84" x2={needle.x} y2={needle.y} className="cute-daily-needle-line" />
        <circle cx={needle.x} cy={needle.y} r="4.5" className="cute-gauge-needle-tip" />
        <circle cx="85" cy="84" r="7" className="cute-gauge-center" />
        <text x="85" y="112" textAnchor="middle" className="cute-gauge-score">{score}/{maxScore}</text>
      </svg>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, trades: allTrades, getPortfolioSummary, requestWithdrawal, isPremiumUser } = useStore();
  const trades = allTrades.slice(0, 5);
  const summary = getPortfolioSummary();
  const canViewSimonsModel = isPremiumUser();
  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [wAmount, setWAmount] = useState('');
  const [wReason, setWReason] = useState('');
  const [wError, setWError] = useState('');
  const [wLoading, setWLoading] = useState(false);
  const [marketSummary, setMarketSummary] = useState<HomeMarketSummary | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState('');
  const [showMoodGuide, setShowMoodGuide] = useState(false);

  useEffect(() => {
    if (!canViewSimonsModel) {
      setMarketSummary(null);
      setMarketError('');
      setMarketLoading(false);
      return;
    }

    let cancelled = false;
    async function loadMarketSummary() {
      setMarketLoading(true);
      setMarketError('');
      const summaryData = await fetchHomeMarketSummary();
      if (cancelled) return;
      if (summaryData) {
        setMarketSummary(summaryData);
      } else {
        setMarketError('目前沒有可用的 Simons 市場資料');
      }
      setMarketLoading(false);
    }
    loadMarketSummary();
    return () => { cancelled = true; };
  }, [canViewSimonsModel]);

  const profitClass = summary.totalProfitLoss >= 0 ? 'profit' : 'loss';
  const greetingEmoji = summary.totalProfitLoss >= 0 ? '😊' : '💪';

  // 根據時間問候
  const hour = new Date().getHours();
  let greeting = '早安';
  if (hour >= 12 && hour < 18) greeting = '午安';
  else if (hour >= 18) greeting = '晚安';

  return (
    <div className="dashboard">
      {/* 問候區 */}
      <div className="greeting-section">
        <div className="greeting-left">
          <button
            className="greeting-avatar-btn"
            onClick={() => navigate('/settings')}
            title="帳號設定"
          >
            {user!.avatar.startsWith('data:') || user!.avatar.startsWith('http') ? (
              <img src={user!.avatar} alt="頭像" className="greeting-avatar-img" />
            ) : (
              <span className="greeting-avatar">{user!.avatar}</span>
            )}
          </button>
          <div>
            <div className="greeting-text">{greeting}！{user!.displayName} {greetingEmoji}</div>
            <div className="greeting-sub">今天也要好好投資唷！</div>
          </div>
        </div>
      </div>

      {/* 總資產卡片 */}
      <div className={`card asset-card ${summary.totalCost > 0 ? (profitClass === 'profit' ? 'card-profit' : 'card-loss') : 'card-primary'}`}>
        <div className="asset-label">我的總資產 💰</div>
        <div className="asset-value">
          <span className="asset-currency">NT$</span>
          <span className="asset-number">{formatMoney(summary.totalAssets)}</span>
        </div>
        
        <div className="asset-details asset-details-three">
          <div className="asset-detail">
            <span className="asset-detail-label">💵 可用現金</span>
            <span className="asset-detail-value">
              <span className="asset-currency">NT$</span>
              <span className="asset-number">{formatMoney(summary.cashBalance)}</span>
            </span>
          </div>
          <div className="asset-detail">
            <span className="asset-detail-label">📈 股票市值</span>
            <span className="asset-detail-value">
              <span className="asset-currency">NT$</span>
              <span className="asset-number">{formatMoney(summary.totalMarketValue)}</span>
            </span>
          </div>
          <div className="asset-detail">
            <span className="asset-detail-label">📊 未平倉損益</span>
            <span className={`asset-detail-value ${summary.totalProfitLoss > 0 ? 'asset-pnl-profit' : summary.totalProfitLoss < 0 ? 'asset-pnl-loss' : ''}`}>
              <span className="asset-number-row">
                <span>{summary.totalProfitLoss > 0 ? '+' : ''}</span>
                <span className="asset-currency">NT$</span>
                <span className="asset-number">{formatMoney(summary.totalProfitLoss)}</span>
              </span>
              <span className="asset-pct">({summary.profitLossPct > 0 ? '+' : ''}{summary.profitLossPct.toFixed(1)}%)</span>
            </span>
          </div>
        </div>
      </div>

      {/* 快速操作 */}
      <div className="quick-actions">
        <button className="quick-action-btn" onClick={() => navigate('/explore')}>
          <span className="qa-icon">🔍</span>
          <span className="qa-label">找股票</span>
        </button>
        <button className="quick-action-btn" onClick={() => navigate('/portfolio')}>
          <span className="qa-icon">💼</span>
          <span className="qa-label">看庫存</span>
        </button>
        {user?.role === 'parent' ? (
          <button className="quick-action-btn" onClick={() => navigate('/manage-children')}>
            <span className="qa-icon">👨‍👩‍👧</span>
            <span className="qa-label">管理帳號</span>
          </button>
        ) : (
          <button className="quick-action-btn" onClick={() => setShowWithdrawal(true)}>
            <span className="qa-icon">💸</span>
            <span className="qa-label">申請出金</span>
          </button>
        )}
        <button className="quick-action-btn" onClick={() => navigate('/history')}>
          <span className="qa-icon">🕒</span>
          <span className="qa-label">交易紀錄</span>
        </button>
        <button className="quick-action-btn" onClick={() => navigate('/dividends')}>
          <span className="qa-icon">💰</span>
          <span className="qa-label">股利紀錄</span>
        </button>
        {user?.isAdmin && (
          <button className="quick-action-btn" onClick={() => navigate('/backtest')}>
            <span className="qa-icon">📊</span>
            <span className="qa-label">回測</span>
          </button>
        )}
        {user?.isAdmin && (
          <button className="quick-action-btn" onClick={() => navigate('/admin')}>
            <span className="qa-icon">🔧</span>
            <span className="qa-label">管理後台</span>
          </button>
        )}
      </div>

      {/* 廣告橫幅（僅 Free 用戶可見） */}
      <AdBanner />

      {/* 副帳號出金申請彈窗 */}
      {showWithdrawal && (
        <div className="modal-overlay" onClick={() => setShowWithdrawal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-handle"></div>
            <h3 className="trade-modal-title">💸 申請出金</h3>
            <div className="trade-modal-price">可用餘額：NT$ {formatMoney(user?.availableBalance || 0)}</div>
            <div className="input-group" style={{ marginTop: 16 }}>
              <label className="input-label">申請金額（元）</label>
              <input className="input-field" type="number" min="1"
                placeholder="輸入想領出的金額"
                value={wAmount} onChange={e => setWAmount(e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">申請原因（選填）</label>
              <input className="input-field" type="text"
                placeholder="例如：買玩具、存零用錢"
                value={wReason} onChange={e => setWReason(e.target.value)} />
            </div>
            {wError && <div style={{ color: 'var(--loss-color)', fontSize: 13, marginTop: 8 }}>{wError}</div>}
            <button
              className="btn btn-buy btn-lg btn-block"
              style={{ marginTop: 16 }}
              disabled={!wAmount || wLoading}
              onClick={async () => {
                setWError('');
                setWLoading(true);
                const result = await requestWithdrawal(Number(wAmount), wReason);
                setWLoading(false);
                if (result.error) { setWError(result.error); }
                else {
                  setShowWithdrawal(false);
                  setWAmount(''); setWReason('');
                  alert('✅ 申請已送出，請等待主帳號審核！');
                }
              }}
            >
              {wLoading ? '送出中...' : '送出申請 🚀'}
            </button>
          </div>
        </div>
      )}

      {canViewSimonsModel && (
        <section className="market-panel">
          <div className="section-header">
            <h2 className="section-title">📊 Simons 量化模型</h2>
            <span className="market-source">{marketSummary ? `更新時間：${marketSummary.updateDate}` : '同步中'}</span>
          </div>

          {marketLoading && (
            <div className="market-loading-card">
              <div className="market-loading-title">正在整理市場量化資料...</div>
              <div className="market-loading-line"></div>
              <div className="market-loading-line short"></div>
            </div>
          )}

          {!marketLoading && marketError && (
            <div className="market-error-card">
              <div className="market-error-title">暫時抓不到市場資料</div>
              <div className="market-error-desc">{marketError}</div>
            </div>
          )}

          {!marketLoading && marketSummary && (
            <div className="macro-dashboard-card">
              <div className="macro-dashboard-top">
                <span><span className="macro-cute-token">🧸</span> 更新時間: {marketSummary.updateDate}</span>
                <span className="macro-score-badge">
                  <b>{marketSummary.monthLabel}</b> 月預測：<strong>{marketSummary.monthlyPrediction.label || '觀察中'}</strong>
                </span>
              </div>

              <div className="macro-dashboard-grid">
                <div className="macro-mood-panel">
                  <button
                    type="button"
                    className="macro-chart-help-button macro-mood-help-button"
                    aria-expanded={showMoodGuide}
                    aria-label="查看今日市場氛圍說明"
                    onClick={() => setShowMoodGuide(current => !current)}
                  >
                    ?
                  </button>
                  <div className={`macro-mood-selected ${MOOD_CLASS[marketSummary.marketMood.primary]}`}>
                    <div className="macro-mood-selected-icon">{MOOD_ICON[marketSummary.marketMood.primary]}</div>
                    <div>
                      <div className="macro-mood-selected-kicker">今日市場氛圍</div>
                      <h3>{marketSummary.marketMood.primary}</h3>
                      <p>{marketSummary.marketMood.reason}</p>
                    </div>
                  </div>
                  {showMoodGuide && (
                    <div className="macro-chart-guide macro-mood-guide" role="note">
                      <h3>今日市場氛圍怎麼判斷</h3>
                      <p>這裡每天讀 IFalgo 公開數據，並依照目前整理到的作者樣本規則推估今天的市場氛圍。</p>
                      <ul>
                        <li>貪婪：AI日預測偏熱，但月線或總體訊號沒有完全同步，短線追價感較強。</li>
                        <li>樂觀：市場方向偏正面，但還不到過熱追價或壓力完全放鬆。</li>
                        <li>放鬆：AI月預測偏多，且融資維持率明顯高於安全線，槓桿壓力較低。</li>
                        <li>冷靜：AI日預測偏低、月線偏空或融資安全距離不足，需要保守觀察。</li>
                      </ul>
                      <p>目前顯示「{marketSummary.marketMood.primary}」是因為：{marketSummary.marketMood.reason}</p>
                    </div>
                  )}
                </div>

                <div className="macro-momentum-large">
                  <MarketMomentumChart summary={marketSummary} />
                </div>

                <div className="macro-prediction-row">
                  <MonthlyGauge
                    score={marketSummary.monthlyPrediction.score}
                    label={marketSummary.monthlyPrediction.label}
                    monthLabel={marketSummary.monthLabel}
                    directionScore={marketSummary.monthlyPrediction.directionScore}
                  />
                  <DailyGauge score={marketSummary.dailyPrediction.score} maxScore={marketSummary.dailyPrediction.maxScore} />
                </div>

                <div className="macro-margin-row">
                  <MarginMaintenanceChart summary={marketSummary} />
                  <div className="macro-margin-stats">
                    <div>今日 {marketSummary.marginMaintenance.todayRate.toFixed(2)}%</div>
                    <div>安全邊際 {marketSummary.marginMaintenance.safeLine.toFixed(2)}%</div>
                    <div>最小值 {marketSummary.marginMaintenance.minLine.toFixed(2)}%</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}



      {/* 空狀態 */}
      {trades.length === 0 && summary.totalMarketValue === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🐻</div>
          <div className="empty-state-title">歡迎來到小熊投資家！</div>
          <div className="empty-state-desc">
            你有 NT$ {formatMoney(user!.availableBalance)} 的零用錢可以投資，快去探索股票吧！
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/explore')}>
            🔍 開始探索
          </button>
        </div>
      )}

      {/* 頁尾版本號 */}
      <div style={{ textAlign: 'center', margin: '32px 0 16px', color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 500 }}>
        PPBears Investment v{import.meta.env.VITE_APP_VERSION}
      </div>
    </div>
  );
}
