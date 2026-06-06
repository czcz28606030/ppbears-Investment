import './LessonVisual.css';

interface LessonVisualProps {
  imageKey?: string;
  title: string;
}

function getLessonNumber(imageKey?: string): number {
  const match = imageKey?.match(/lesson_(\d+)/);
  return match ? Number(match[1]) : 0;
}

function getVisualKind(lessonNo: number): 'candle' | 'etf' | 'allocation' | 'trade' | 'financials' | 'valuation' | 'risk' | 'safety' | 'default' {
  if (lessonNo >= 56 && lessonNo <= 60) return 'candle';
  if (lessonNo >= 61 && lessonNo <= 66) return 'etf';
  if (lessonNo >= 67 && lessonNo <= 72) return 'allocation';
  if (lessonNo >= 73 && lessonNo <= 78) return 'trade';
  if (lessonNo >= 79 && lessonNo <= 86) return 'financials';
  if (lessonNo >= 87 && lessonNo <= 92) return 'valuation';
  if (lessonNo >= 93 && lessonNo <= 96) return 'risk';
  if (lessonNo >= 97 && lessonNo <= 100) return 'safety';
  return 'default';
}

function CandleVisual() {
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label="K線與均線示意圖">
      <path className="lesson-visual-grid" d="M20 30H300M20 70H300M20 110H300" />
      <path className="lesson-visual-ma lesson-visual-ma-fast" d="M26 110 C70 92, 86 116, 126 80 S196 46, 292 34" />
      <path className="lesson-visual-ma lesson-visual-ma-slow" d="M26 124 C76 112, 116 98, 158 82 S236 62, 292 54" />
      {[48, 86, 124, 162, 200, 238, 276].map((x, i) => {
        const up = i !== 1 && i !== 4;
        const y = up ? 50 + i * 3 : 72 + i * 2;
        const h = up ? 38 : 30;
        return (
          <g key={x}>
            <line className="lesson-visual-wick" x1={x} y1={y - 18} x2={x} y2={y + h + 18} />
            <rect className={up ? 'lesson-visual-candle-up' : 'lesson-visual-candle-down'} x={x - 8} y={y} width="16" height={h} rx="3" />
          </g>
        );
      })}
    </svg>
  );
}

function EtfVisual() {
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label="ETF追蹤一籃股票示意圖">
      <path className="lesson-visual-grid" d="M22 35H298M22 75H298M22 115H298" />
      <path className="lesson-visual-area" d="M28 118 L70 100 L112 105 L154 80 L196 72 L238 50 L292 42 L292 128 L28 128 Z" />
      <path className="lesson-visual-line" d="M28 118 L70 100 L112 105 L154 80 L196 72 L238 50 L292 42" />
      <circle className="lesson-visual-dot" cx="238" cy="50" r="5" />
      <g className="lesson-visual-mini-bars">
        <rect x="44" y="40" width="18" height="28" rx="3" />
        <rect x="72" y="52" width="18" height="16" rx="3" />
        <rect x="100" y="30" width="18" height="38" rx="3" />
      </g>
    </svg>
  );
}

function AllocationVisual() {
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label="資產配置圓餅圖">
      <circle cx="96" cy="76" r="48" fill="#8ac926" />
      <path d="M96 76 L96 28 A48 48 0 0 1 141 92 Z" fill="#ffca3a" />
      <path d="M96 76 L141 92 A48 48 0 0 1 78 121 Z" fill="#1982c4" />
      <circle cx="96" cy="76" r="24" fill="#fffaf0" />
      <g className="lesson-visual-legend">
        <rect x="174" y="42" width="16" height="16" rx="3" fill="#8ac926" />
        <text x="198" y="55">核心資產</text>
        <rect x="174" y="70" width="16" height="16" rx="3" fill="#ffca3a" />
        <text x="198" y="83">現金緩衝</text>
        <rect x="174" y="98" width="16" height="16" rx="3" fill="#1982c4" />
        <text x="198" y="111">成長部位</text>
      </g>
    </svg>
  );
}

function TradeVisual() {
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label="委託單與買賣價示意圖">
      <rect className="lesson-visual-panel" x="28" y="24" width="118" height="102" rx="12" />
      <rect className="lesson-visual-panel" x="174" y="24" width="118" height="102" rx="12" />
      <text className="lesson-visual-label" x="87" y="48" textAnchor="middle">買方</text>
      <text className="lesson-visual-label" x="233" y="48" textAnchor="middle">賣方</text>
      <path className="lesson-visual-arrow" d="M120 78H200" />
      <text className="lesson-visual-price" x="87" y="86" textAnchor="middle">99.5</text>
      <text className="lesson-visual-price" x="233" y="86" textAnchor="middle">100</text>
      <text className="lesson-visual-caption" x="160" y="130" textAnchor="middle">價格相遇才會成交</text>
    </svg>
  );
}

function FinancialsVisual() {
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label="財報數字長條圖">
      <path className="lesson-visual-grid" d="M35 35H292M35 75H292M35 115H292" />
      <g className="lesson-visual-bars">
        <rect x="58" y="62" width="30" height="54" rx="5" />
        <rect x="116" y="44" width="30" height="72" rx="5" />
        <rect x="174" y="76" width="30" height="40" rx="5" />
        <rect x="232" y="34" width="30" height="82" rx="5" />
      </g>
      <path className="lesson-visual-line" d="M54 112 C98 100, 118 82, 150 88 S222 58, 270 42" />
    </svg>
  );
}

function ValuationVisual() {
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label="估值天平示意圖">
      <line className="lesson-visual-wick" x1="160" y1="34" x2="160" y2="118" />
      <line className="lesson-visual-wick" x1="82" y1="58" x2="238" y2="58" />
      <path className="lesson-visual-arrow" d="M82 58 L58 104 H106 Z" />
      <path className="lesson-visual-arrow" d="M238 58 L214 88 H262 Z" />
      <text className="lesson-visual-label" x="82" y="126" textAnchor="middle">價格</text>
      <text className="lesson-visual-label" x="238" y="126" textAnchor="middle">價值</text>
    </svg>
  );
}

function RiskVisual() {
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label="風險控管與投資紀律示意圖">
      <path className="lesson-visual-grid" d="M24 38H296M24 78H296M24 118H296" />
      <path className="lesson-visual-line" d="M30 110 C66 70, 102 94, 134 66 S194 38, 232 76 S270 112, 292 52" />
      <path className="lesson-visual-stop" d="M34 118H288" />
      <text className="lesson-visual-caption" x="160" y="138" textAnchor="middle">先想風險，再想報酬</text>
    </svg>
  );
}

function SafetyVisual() {
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label="投資資訊安全示意圖">
      <rect className="lesson-visual-panel" x="48" y="28" width="224" height="92" rx="16" />
      <path className="lesson-visual-shield" d="M160 48 L206 64 V86 C206 105 188 116 160 124 C132 116 114 105 114 86 V64 Z" />
      <path className="lesson-visual-check" d="M140 84 L154 98 L184 68" />
      <text className="lesson-visual-caption" x="160" y="140" textAnchor="middle">不相信保證獲利</text>
    </svg>
  );
}

function DefaultVisual() {
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label="學習卡片示意圖">
      <path className="lesson-visual-area" d="M44 112 C76 76, 112 98, 150 62 S234 50, 278 32 L278 126 L44 126 Z" />
      <path className="lesson-visual-line" d="M44 112 C76 76, 112 98, 150 62 S234 50, 278 32" />
      <circle className="lesson-visual-dot" cx="150" cy="62" r="6" />
    </svg>
  );
}

export default function LessonVisual({ imageKey, title }: LessonVisualProps) {
  const kind = getVisualKind(getLessonNumber(imageKey));
  return (
    <div className={`lesson-visual lesson-visual-${kind}`} aria-label={title}>
      {kind === 'candle' && <CandleVisual />}
      {kind === 'etf' && <EtfVisual />}
      {kind === 'allocation' && <AllocationVisual />}
      {kind === 'trade' && <TradeVisual />}
      {kind === 'financials' && <FinancialsVisual />}
      {kind === 'valuation' && <ValuationVisual />}
      {kind === 'risk' && <RiskVisual />}
      {kind === 'safety' && <SafetyVisual />}
      {kind === 'default' && <DefaultVisual />}
    </div>
  );
}
