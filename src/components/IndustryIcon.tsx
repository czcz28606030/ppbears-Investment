import { useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { getStockIndustryFromSource } from '../data/stockIndustryClassifications';
import './IndustryIcon.css';

type IndustryKind =
  | 'semiconductor'
  | 'electronics'
  | 'components'
  | 'computer'
  | 'opto'
  | 'information'
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
  | 'chemical'
  | 'plastics'
  | 'textile'
  | 'rubber'
  | 'glass'
  | 'electric'
  | 'telecom'
  | 'auto'
  | 'management'
  | 'other'
  | 'default';

type IndustryConfig = {
  kind: IndustryKind;
  label: string;
  title: string;
  name: string;
  description: string;
  examples: string;
};

type IndustryIconProps = {
  industry?: string | null;
  stockCode?: string | number | null;
  compact?: boolean;
  className?: string;
};

type IndustryMeta = {
  kind: IndustryKind;
  label: string;
  name?: string;
};

const SOURCE_INDUSTRY_META: Record<string, IndustryMeta> = {
  半導體業: { kind: 'semiconductor', label: '半導體' },
  電子零組件業: { kind: 'components', label: '電子零件' },
  電腦及週邊設備業: { kind: 'computer', label: '電腦週邊' },
  光電業: { kind: 'opto', label: '光電' },
  通信網路業: { kind: 'telecom', label: '通信網路' },
  其他電子業: { kind: 'electronics', label: '其他電子' },
  電子通路業: { kind: 'electronics', label: '電子通路' },
  資訊服務業: { kind: 'information', label: '資訊服務' },
  金融業: { kind: 'finance', label: '金融' },
  航運業: { kind: 'shipping', label: '航運' },
  電機機械: { kind: 'machinery', label: '電機機械' },
  鋼鐵工業: { kind: 'steel', label: '鋼鐵' },
  建材營造: { kind: 'construction', label: '建材營造' },
  食品工業: { kind: 'food', label: '食品' },
  生技醫療: { kind: 'biotech', label: '生技醫療' },
  生技醫療業: { kind: 'biotech', label: '生技醫療' },
  觀光事業: { kind: 'tourism', label: '觀光' },
  貿易百貨: { kind: 'retail', label: '貿易百貨' },
  貿易百貨業: { kind: 'retail', label: '貿易百貨' },
  油電燃氣業: { kind: 'energy', label: '油電燃氣' },
  化學工業: { kind: 'chemical', label: '化學' },
  塑膠工業: { kind: 'plastics', label: '塑膠' },
  紡織纖維: { kind: 'textile', label: '紡織' },
  橡膠工業: { kind: 'rubber', label: '橡膠' },
  玻璃陶瓷: { kind: 'glass', label: '玻陶' },
  電器電纜: { kind: 'electric', label: '電器電纜' },
  汽車: { kind: 'auto', label: '汽車' },
  管理股票: { kind: 'management', label: '管理股', name: '管理股票' },
  其他: { kind: 'other', label: '其他' },
};

const INDUSTRY_KIND_COPY: Record<IndustryKind, Pick<IndustryConfig, 'description' | 'examples'>> = {
  semiconductor: {
    description: '半導體公司通常和晶片設計、晶圓製造、封裝測試或設備材料有關。',
    examples: '常見觀察點：AI、HPC、先進製程、庫存循環與資本支出。',
  },
  electronics: {
    description: '電子類股包含科技供應鏈中的通路、其他電子產品與系統整合相關業務。',
    examples: '常見觀察點：接單動能、庫存水位、匯率、終端需求與新品週期。',
  },
  components: {
    description: '電子零組件公司多供應連接器、PCB、被動元件、機構件與各式關鍵零件。',
    examples: '常見觀察點：客戶拉貨、庫存水位、產品組合、毛利率與產能利用率。',
  },
  computer: {
    description: '電腦及週邊設備業涵蓋 PC、伺服器、主機板、工業電腦與周邊硬體。',
    examples: '常見觀察點：AI 伺服器、企業換機、ODM 訂單、零組件成本與出貨節奏。',
  },
  opto: {
    description: '光電業和面板、LED、鏡頭、光學元件、顯示與影像相關產品連動較高。',
    examples: '常見觀察點：報價週期、稼動率、庫存、終端需求與新應用滲透率。',
  },
  information: {
    description: '資訊服務業以軟體、雲端、資安、系統整合與數位服務收入為主。',
    examples: '常見觀察點：專案認列、訂閱收入、續約率、政府/企業 IT 預算與資安需求。',
  },
  finance: {
    description: '金融類股包含銀行、保險、證券與金控，獲利常受利率、放款、投資收益影響。',
    examples: '常見觀察點：利差、呆帳、股債市行情、配息穩定度。',
  },
  shipping: {
    description: '航運與運輸類股和貨運、海運、空運、物流需求相關，景氣循環感較強。',
    examples: '常見觀察點：運價、油價、塞港、全球貿易量與旺季需求。',
  },
  machinery: {
    description: '電機機械類股多和設備、工具機、自動化與工業投資有關。',
    examples: '常見觀察點：訂單能見度、資本支出、出口需求與景氣循環。',
  },
  steel: {
    description: '鋼鐵金屬類股和原物料價格、基礎建設、製造需求連動較高。',
    examples: '常見觀察點：鋼價、原料成本、庫存、房市與公共工程。',
  },
  construction: {
    description: '建材營造類股包含建設、水泥、玻璃與建築材料，常受房市與工程需求影響。',
    examples: '常見觀察點：推案量、交屋入帳、土地成本、利率與政策。',
  },
  food: {
    description: '食品類股偏民生消費，需求通常較穩，但原料成本與通路很重要。',
    examples: '常見觀察點：毛利率、原物料價格、品牌力與通路動能。',
  },
  medical: {
    description: '醫療類股和藥品、醫材、醫療服務與健康照護需求有關。',
    examples: '常見觀察點：新品核准、通路拓展、研發進度與法規變化。',
  },
  biotech: {
    description: '生技醫療類股常和研發、醫材、藥品、授權或特殊題材相關，波動可能較大。',
    examples: '常見觀察點：臨床結果、產品上市、授權金、通路放量與現金流。',
  },
  tourism: {
    description: '觀光事業類股和旅遊、飯店、餐飲與娛樂消費有關。',
    examples: '常見觀察點：旅客人次、住房率、票價、展店與假期旺季。',
  },
  retail: {
    description: '貿易百貨與零售類股靠通路、品牌、消費力與商品週轉來創造獲利。',
    examples: '常見觀察點：同店銷售、促銷檔期、庫存週轉與電商成長。',
  },
  energy: {
    description: '油電燃氣與能源類股和油價、電力、燃氣報價及政策高度相關。',
    examples: '常見觀察點：能源價格、政策補貼、產能利用率、利差與需求循環。',
  },
  chemical: {
    description: '化學工業和化學品、材料、農化、特用化學與原料成本循環相關。',
    examples: '常見觀察點：產品報價、原料成本、利差、庫存與景氣循環。',
  },
  plastics: {
    description: '塑膠工業和塑化材料、加工品、包材與消費/工業需求連動。',
    examples: '常見觀察點：塑化報價、油價、利差、下游客戶拉貨與庫存。',
  },
  textile: {
    description: '紡織纖維類股和成衣、布料、機能紡織、品牌客戶與出口需求相關。',
    examples: '常見觀察點：接單、原料成本、匯率、庫存與品牌客戶拉貨。',
  },
  rubber: {
    description: '橡膠工業常和輪胎、橡膠製品、車市與原物料價格有關。',
    examples: '常見觀察點：天然橡膠價格、車市需求、產品組合與匯率。',
  },
  glass: {
    description: '玻璃陶瓷類股受建材、容器、面板玻璃與工業需求影響。',
    examples: '常見觀察點：出貨量、能源成本、建築需求與產品報價。',
  },
  electric: {
    description: '電器電纜類股和電線電纜、電力設備、電網建設與銅價相關。',
    examples: '常見觀察點：公共工程、電網投資、銅價、訂單能見度與毛利率。',
  },
  telecom: {
    description: '通信網路類股包含電信、網通設備、網路服務與通訊供應鏈。',
    examples: '常見觀察點：用戶數、ARPU、雲端需求、5G/網通升級與系統整合案量。',
  },
  auto: {
    description: '汽車類股包含整車、零組件、電動車與車用電子供應鏈。',
    examples: '常見觀察點：出貨量、車市景氣、匯率、電動車滲透率與客戶訂單。',
  },
  management: {
    description: '管理股票屬於交易制度中的特殊分類，通常需要額外留意流動性與交易風險。',
    examples: '常見觀察點：交易限制、基本面變化、資訊揭露與流動性。',
  },
  other: {
    description: '其他類股代表交易所分類中未歸入主要產業的公司，需要看公司本業再判斷。',
    examples: '常見觀察點：主要營收來源、產業循環、財務品質與題材持續性。',
  },
  default: {
    description: '這是股票所屬的產業分類，用來快速理解公司大概在哪一種生意環境中競爭。',
    examples: '不同產業的估值、景氣循環和風險來源不同，建議搭配價格、AI 訊號與財務資料一起看。',
  },
};

const INDUSTRY_TEXT_RULES: Array<{ pattern: RegExp; sourceIndustry: string }> = [
  { pattern: /半導體|積體電路|晶圓|IC|封測/i, sourceIndustry: '半導體業' },
  { pattern: /電子零組件|零組件|PCB|印刷電路|被動元件|連接器/i, sourceIndustry: '電子零組件業' },
  { pattern: /電腦|週邊|主機板|伺服器|筆電|桌機|工業電腦/i, sourceIndustry: '電腦及週邊設備業' },
  { pattern: /光電|面板|LED|鏡頭|光學/i, sourceIndustry: '光電業' },
  { pattern: /通信|網路|網通|電信/i, sourceIndustry: '通信網路業' },
  { pattern: /資訊服務|軟體|雲端|資安|系統整合|數位/i, sourceIndustry: '資訊服務業' },
  { pattern: /電子通路/i, sourceIndustry: '電子通路業' },
  { pattern: /其他電子|電子/i, sourceIndustry: '其他電子業' },
  { pattern: /金融|銀行|保險|證券|金控/i, sourceIndustry: '金融業' },
  { pattern: /航運|海運|空運|運輸|物流/i, sourceIndustry: '航運業' },
  { pattern: /電機|機械|機電|工具機/i, sourceIndustry: '電機機械' },
  { pattern: /鋼鐵|金屬|銅|鋁/i, sourceIndustry: '鋼鐵工業' },
  { pattern: /建材|營建|水泥|建設/i, sourceIndustry: '建材營造' },
  { pattern: /食品|農業|飲料|餐飲/i, sourceIndustry: '食品工業' },
  { pattern: /生技|醫療|醫材|藥|健康|照護|基因|疫苗/i, sourceIndustry: '生技醫療' },
  { pattern: /觀光|旅遊|飯店|休閒/i, sourceIndustry: '觀光事業' },
  { pattern: /貿易|百貨|零售|電商|商業/i, sourceIndustry: '貿易百貨' },
  { pattern: /油電|燃氣|能源|電力|石油|太陽能|再生能源|綠能|風電|儲能/i, sourceIndustry: '油電燃氣業' },
  { pattern: /化學|化工|特化/i, sourceIndustry: '化學工業' },
  { pattern: /塑膠|塑化/i, sourceIndustry: '塑膠工業' },
  { pattern: /紡織|纖維|成衣/i, sourceIndustry: '紡織纖維' },
  { pattern: /橡膠|輪胎/i, sourceIndustry: '橡膠工業' },
  { pattern: /玻璃|陶瓷/i, sourceIndustry: '玻璃陶瓷' },
  { pattern: /電器|電纜|電線/i, sourceIndustry: '電器電纜' },
  { pattern: /汽車|車/i, sourceIndustry: '汽車' },
];

function configFromSourceIndustry(sourceIndustry: string, title?: string): IndustryConfig | null {
  const meta = SOURCE_INDUSTRY_META[sourceIndustry];
  if (!meta) return null;
  const copy = INDUSTRY_KIND_COPY[meta.kind] || INDUSTRY_KIND_COPY.default;
  return {
    kind: meta.kind,
    label: meta.label,
    title: title || sourceIndustry,
    name: meta.name || sourceIndustry,
    description: copy.description,
    examples: copy.examples,
  };
}

function getIndustryConfig(industry?: string | null, stockCode?: string | number | null): IndustryConfig {
  const sourceIndustry = getStockIndustryFromSource(stockCode);
  const raw = String(sourceIndustry || industry || '').trim();
  const text = raw.replace(/\s+/g, '');

  if (!text || text === '—' || text === '-') {
    return {
      kind: 'default',
      label: '產業',
      title: '產業尚未同步',
      name: '產業尚未同步',
      description: '目前還沒有取得這檔股票的產業分類，資料同步後會自動顯示對應圖示。',
      examples: '可先用股票本質、AI 訊號、價格與籌碼資訊一起判斷。',
    };
  }

  const exactConfig = configFromSourceIndustry(text, raw);
  if (exactConfig) return exactConfig;

  const matchedRule = INDUSTRY_TEXT_RULES.find((rule) => rule.pattern.test(text));
  if (matchedRule) {
    return configFromSourceIndustry(matchedRule.sourceIndustry, sourceIndustry || raw) || {
      kind: 'default',
      label: '其他',
      title: raw,
      name: raw,
      description: INDUSTRY_KIND_COPY.default.description,
      examples: INDUSTRY_KIND_COPY.default.examples,
    };
  }

  return {
    kind: 'default',
    label: '其他',
    title: raw,
    name: raw || '其他',
    description: INDUSTRY_KIND_COPY.default.description,
    examples: INDUSTRY_KIND_COPY.default.examples,
  };
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
    case 'components':
    case 'computer':
    case 'opto':
    case 'electric':
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
    case 'chemical':
    case 'plastics':
    case 'rubber':
    case 'glass':
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M13 2 5 14h6l-1 8 9-13h-6l1-7Z" />
        </svg>
      );
    case 'telecom':
    case 'information':
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
    case 'management':
    case 'other':
    default:
      return (
        <svg className="industry-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19h16M7 19V9h4v10M13 19V5h4v14" />
        </svg>
      );
  }
}

export default function IndustryIcon({ industry, stockCode, compact = false, className = '' }: IndustryIconProps) {
  const [isOpen, setIsOpen] = useState(false);
  const config = getIndustryConfig(industry, stockCode);
  const classes = [
    'industry-icon',
    `industry-icon-${config.kind}`,
    compact ? 'industry-icon-compact' : '',
    className,
  ].filter(Boolean).join(' ');
  const dialogIconClasses = ['industry-icon', `industry-icon-${config.kind}`, 'industry-dialog-icon'].join(' ');

  function openDialog(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(true);
  }

  function closeDialog(e?: MouseEvent<HTMLElement>) {
    e?.preventDefault();
    e?.stopPropagation();
    setIsOpen(false);
  }

  const dialog = isOpen && typeof document !== 'undefined'
    ? createPortal(
      <div className="industry-dialog-overlay" onClick={closeDialog}>
        <div
          className={`industry-dialog industry-icon-${config.kind}`}
          role="dialog"
          aria-modal="true"
          aria-label={`${config.title} 產業說明`}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="industry-dialog-close" type="button" onClick={closeDialog} aria-label="關閉產業說明">
            ×
          </button>
          <div className="industry-dialog-header">
            <span className={dialogIconClasses} aria-hidden="true">
              <span className="industry-icon-mark">
                <IndustryGlyph kind={config.kind} />
              </span>
            </span>
            <div>
              <div className="industry-dialog-kicker">產業類別</div>
              <h3 className="industry-dialog-title">{config.title}</h3>
            </div>
          </div>
          <div className="industry-dialog-badge">{config.name}</div>
          <p className="industry-dialog-text">{config.description}</p>
          <p className="industry-dialog-note">{config.examples}</p>
        </div>
      </div>,
      document.body
    )
    : null;

  return (
    <>
      <button
        type="button"
        className={classes}
        title={`產業：${config.title}`}
        aria-label={`查看產業說明：${config.title}`}
        onClick={openDialog}
      >
        <span className="industry-icon-mark">
          <IndustryGlyph kind={config.kind} />
        </span>
        <span className="industry-icon-label">{config.label}</span>
      </button>

      {dialog}
    </>
  );
}
