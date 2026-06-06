export type IndustryTailwindLevel = 'core' | 'strong' | 'watch';

export interface IndustryTailwind {
  code: string;
  label: string;
  theme: string;
  score: number;
  level: IndustryTailwindLevel;
  reason: string;
  risk: string;
  source: string;
  sourceDate: string;
}

const TSMC_Q1_2026_SOURCE = '台積電 2026 Q1 法說會與 2025 年報';
const TSMC_Q1_2026_DATE = '2026-04-16';

const INDUSTRY_TAILWINDS: Record<string, IndustryTailwind> = {
  '2330': {
    code: '2330',
    label: '科技核心',
    theme: '先進製程 / 2nm / 3nm / AI HPC',
    score: 10,
    level: 'core',
    reason: '台積電法說會把 2026 年營收成長上修至美元計價超過 30%，主因是 AI/HPC 與先進製程需求。',
    risk: '評價、地緣政治、海外設廠成本與 AI 資本支出降溫。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '2308': {
    code: '2308',
    label: 'AI 基建',
    theme: '資料中心電源 / 散熱 / 能源管理',
    score: 9,
    level: 'strong',
    reason: 'AI 伺服器與資料中心擴張會同步拉高電源、散熱與能源管理需求。',
    risk: '資料中心建置遞延、毛利率變化與匯率。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '2382': {
    code: '2382',
    label: 'AI 伺服器',
    theme: 'AI server / rack system',
    score: 8,
    level: 'strong',
    reason: 'AI 訓練與推論需求帶動伺服器出貨與高階整機組裝。',
    risk: '客戶拉貨節奏、毛利率與供應鏈瓶頸。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '6669': {
    code: '6669',
    label: 'AI 伺服器',
    theme: 'AI server / CSP',
    score: 8,
    level: 'strong',
    reason: 'AI 伺服器占比提高時，直接受惠雲端客戶擴建與機櫃出貨。',
    risk: '單一客戶、基期高與估值波動。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '2317': {
    code: '2317',
    label: 'AI 伺服器',
    theme: 'AI server / 全球製造',
    score: 7,
    level: 'strong',
    reason: 'AI 伺服器與供應鏈區域化可支撐大型 EMS 與整機製造需求。',
    risk: '產品組合、毛利率與地緣政策。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '3231': {
    code: '3231',
    label: 'AI 伺服器',
    theme: 'AI server / 系統組裝',
    score: 7,
    level: 'strong',
    reason: 'AI server 出貨成長會拉動系統組裝與相關供應鏈需求。',
    risk: '出貨時程、毛利率與庫存調整。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '3711': {
    code: '3711',
    label: '封裝外溢',
    theme: '先進封裝 / OSAT',
    score: 8,
    level: 'strong',
    reason: '法說會指出先進封裝產能仍非常緊，台積電需與 OSAT 夥伴合作擴充產能。',
    risk: 'CoWoS 產能緩解後的價格壓力與資本支出回收。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '2449': {
    code: '2449',
    label: 'AI 測試',
    theme: '高階測試 / AI chip',
    score: 7,
    level: 'strong',
    reason: 'AI 晶片複雜度提高，帶動高階測試與長測時需求。',
    risk: '客戶集中與測試產能利用率波動。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '6515': {
    code: '6515',
    label: 'AI 測試',
    theme: '測試介面 / 探針卡',
    score: 7,
    level: 'strong',
    reason: 'AI/HPC 晶片測試規格提高，測試介面需求跟著上升。',
    risk: '客戶認證、產品周期與估值。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '3443': {
    code: '3443',
    label: 'ASIC',
    theme: 'CSP 自研 AI 晶片 / 設計服務',
    score: 7,
    level: 'strong',
    reason: '雲端大廠自研 AI 晶片進入量產期，設計服務公司可受惠。',
    risk: '專案認列、客戶集中與流片時程。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '3661': {
    code: '3661',
    label: 'ASIC',
    theme: 'CSP 自研 AI 晶片 / 設計服務',
    score: 7,
    level: 'strong',
    reason: 'AI ASIC 與高速運算晶片需求提高，帶動設計服務與 NRE 需求。',
    risk: '大客戶訂單變化、開案時程與估值波動。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '3037': {
    code: '3037',
    label: '高階載板',
    theme: 'ABF / substrate',
    score: 7,
    level: 'strong',
    reason: 'AI 晶片封裝資源消耗提高，載板成為供應鏈瓶頸之一。',
    risk: '擴產後供需、報價與良率。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '8046': {
    code: '8046',
    label: '高階載板',
    theme: 'ABF / substrate',
    score: 7,
    level: 'strong',
    reason: 'AI/HPC 封裝複雜度提升，支撐高階載板需求。',
    risk: '客戶拉貨節奏與產能利用率。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '3189': {
    code: '3189',
    label: '高階載板',
    theme: 'ABF / substrate',
    score: 6,
    level: 'watch',
    reason: '先進封裝與 AI 晶片成長有利載板需求，但個股仍需看產品組合。',
    risk: '景氣循環、價格與良率。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '2383': {
    code: '2383',
    label: '高階 PCB',
    theme: '高速材料 / AI server PCB',
    score: 7,
    level: 'strong',
    reason: 'AI server 對高速傳輸材料、PCB 與訊號完整性要求提高。',
    risk: '材料報價、客戶認證與伺服器出貨節奏。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '6274': {
    code: '6274',
    label: '高階 PCB',
    theme: '高速材料 / AI server PCB',
    score: 7,
    level: 'strong',
    reason: 'AI server 與高速網通升級使高階銅箔基板需求提高。',
    risk: '材料周期與競爭報價。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '3017': {
    code: '3017',
    label: '散熱',
    theme: '液冷 / AI server thermal',
    score: 6,
    level: 'watch',
    reason: 'AI 晶片功耗上升，伺服器散熱需求升級。',
    risk: '競爭、毛利率與客戶導入時程。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '3324': {
    code: '3324',
    label: '散熱',
    theme: '液冷 / AI server thermal',
    score: 6,
    level: 'watch',
    reason: 'AI server 高功耗趨勢提高散熱模組價值量。',
    risk: '訂單能見度、毛利率與估值。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '3653': {
    code: '3653',
    label: '散熱',
    theme: 'AI server thermal / 機構件',
    score: 6,
    level: 'watch',
    reason: 'AI/HPC 晶片功耗與封裝尺寸增加，散熱與機構件價值量上升。',
    risk: '客戶集中、產品導入與毛利率。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '2421': {
    code: '2421',
    label: '散熱觀察',
    theme: '風扇 / thermal',
    score: 5,
    level: 'watch',
    reason: 'AI server 散熱需求升級可帶動風扇與熱管理零組件。',
    risk: '產品單價、競爭與伺服器出貨節奏。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
  '2454': {
    code: '2454',
    label: '邊緣 AI',
    theme: '手機 / edge AI / ASIC',
    score: 5,
    level: 'watch',
    reason: '年報提到 AI 將從資料中心延伸到 PC、手機、車用與 IoT，支撐邊緣 AI 晶片需求。',
    risk: '手機景氣、競爭與產品週期。',
    source: TSMC_Q1_2026_SOURCE,
    sourceDate: TSMC_Q1_2026_DATE,
  },
};

export function getIndustryTailwind(stockCode: string): IndustryTailwind | null {
  return INDUSTRY_TAILWINDS[stockCode] ?? null;
}

export function getIndustryTailwindScore(stockCode: string): number | null {
  return getIndustryTailwind(stockCode)?.score ?? null;
}

export function getIndustryTailwindLabel(stockCode: string): string {
  const tailwind = getIndustryTailwind(stockCode);
  return tailwind ? `${tailwind.label} ${tailwind.score}/10` : '尚未列入科技受惠鏈';
}
