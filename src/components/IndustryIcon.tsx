import './IndustryIcon.css';

type IndustryKind =
  | 'semiconductor'
  | 'electronics'
  | 'finance'
  | 'shipping'
  | 'machinery'
  | 'steel'
  | 'construction'
  | 'food'
  | 'medical'
  | 'biotech'
  | 'tourism'
  | 'retail'
  | 'energy'
  | 'telecom'
  | 'auto'
  | 'default';

type IndustryConfig = {
  kind: IndustryKind;
  label: string;
  title: string;
};

type IndustryIconProps = {
  industry?: string | null;
  compact?: boolean;
  className?: string;
};

function getIndustryConfig(industry?: string | null): IndustryConfig {
  const raw = String(industry || '').trim();
  const text = raw.replace(/\s+/g, '');

  if (!text || text === '—' || text === '-') {
    return { kind: 'default', label: '產', title: '產業尚未同步' };
  }
  if (/半導體|積體電路|晶圓|IC|封測|電子零組件|光電|電腦及週邊|其他電子|電子通路/i.test(text)) {
    if (/半導體|積體電路|晶圓|IC|封測/i.test(text)) {
      return { kind: 'semiconductor', label: '晶', title: raw };
    }
    return { kind: 'electronics', label: '電', title: raw };
  }
  if (/金融|銀行|保險|證券|金控/i.test(text)) return { kind: 'finance', label: '金', title: raw };
  if (/航運|海運|空運|運輸/i.test(text)) return { kind: 'shipping', label: '航', title: raw };
  if (/電機|機械|機電|工具機/i.test(text)) return { kind: 'machinery', label: '機', title: raw };
  if (/鋼鐵|金屬|銅|鋁/i.test(text)) return { kind: 'steel', label: '鋼', title: raw };
  if (/建材|營建|水泥|玻璃|陶瓷/i.test(text)) return { kind: 'construction', label: '建', title: raw };
  if (/食品|農業|飲料|餐飲/i.test(text)) return { kind: 'food', label: '食', title: raw };
  if (/醫療|藥|健康|照護/i.test(text)) return { kind: 'medical', label: '醫', title: raw };
  if (/生技|基因|疫苗/i.test(text)) return { kind: 'biotech', label: '生', title: raw };
  if (/觀光|旅遊|飯店|休閒/i.test(text)) return { kind: 'tourism', label: '旅', title: raw };
  if (/貿易|百貨|零售|電商|商業/i.test(text)) return { kind: 'retail', label: '商', title: raw };
  if (/油電|燃氣|能源|電力|石油|化工|塑膠/i.test(text)) return { kind: 'energy', label: '能', title: raw };
  if (/通信|網路|資訊服務|軟體|數位/i.test(text)) return { kind: 'telecom', label: '訊', title: raw };
  if (/汽車|車/i.test(text)) return { kind: 'auto', label: '車', title: raw };

  return { kind: 'default', label: text.slice(0, 1) || '產', title: raw };
}

function IndustryGlyph({ kind }: { kind: IndustryKind }) {
  switch (kind) {
    case 'semiconductor':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="7" y="7" width="10" height="10" rx="2" />
          <path d="M4 9h3M4 15h3M17 9h3M17 15h3M9 4v3M15 4v3M9 17v3M15 17v3" />
        </svg>
      );
    case 'electronics':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M13 2 5 14h6l-1 8 9-13h-6l1-7Z" />
        </svg>
      );
    case 'finance':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9h16M6 9V7l6-3 6 3v2M7 9v8M12 9v8M17 9v8M5 17h14M4 20h16" />
        </svg>
      );
    case 'shipping':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 13h16l-2 5H7l-3-5Z" />
          <path d="M8 13V8h7l2 5M6 20c2 1 4 1 6 0s4-1 6 0" />
        </svg>
      );
    case 'machinery':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 7 17 4l3 3-3 3" />
          <path d="M16 8 8 16l-4 1 1-4 8-8" />
        </svg>
      );
    case 'steel':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 18h14M7 18l4-12h2l4 12M9 13h6" />
        </svg>
      );
    case 'construction':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19h16M6 19V9l6-4 6 4v10M9 19v-6h6v6" />
        </svg>
      );
    case 'food':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 3v8M11 3v8M7 7h4M9 11v10M17 3v18M17 3c3 2 3 8 0 10" />
        </svg>
      );
    case 'medical':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'biotech':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 4c4 3 4 13 8 16M16 4c-4 3-4 13-8 16M9 8h6M9 16h6" />
        </svg>
      );
    case 'tourism':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 14c4-6 12-6 16 0M12 8v12M8 20h8" />
        </svg>
      );
    case 'retail':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 8h12l-1 12H7L6 8ZM8 8a4 4 0 0 1 8 0" />
        </svg>
      );
    case 'energy':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M13 2 5 14h6l-1 8 9-13h-6l1-7Z" />
        </svg>
      );
    case 'telecom':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 10a8 8 0 0 1 12 0M9 13a4 4 0 0 1 6 0M12 17h.01" />
        </svg>
      );
    case 'auto':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 14 7 8h10l2 6M6 14h12v5H6v-5ZM8 19h.01M16 19h.01" />
        </svg>
      );
    default:
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19h16M7 19V9h4v10M13 19V5h4v14" />
        </svg>
      );
  }
}

export default function IndustryIcon({ industry, compact = false, className = '' }: IndustryIconProps) {
  const config = getIndustryConfig(industry);
  const classes = [
    'industry-icon',
    `industry-icon-${config.kind}`,
    compact ? 'industry-icon-compact' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <span className={classes} title={`產業：${config.title}`} aria-label={`產業：${config.title}`}>
      <span className="industry-icon-mark">
        <IndustryGlyph kind={config.kind} />
      </span>
      <span className="industry-icon-label">{config.label}</span>
    </span>
  );
}
