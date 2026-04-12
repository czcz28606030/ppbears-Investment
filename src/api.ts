// PPBears Investment - API 服務層
import type { StockData, SimonsItem, StockQuote, StockRecommendation, AIAdvice } from './types';

const IFALGO_BASE = 'https://api.ifalgo.com.tw/frontapi';

// CORS proxy (for development) - in production, use your own backend proxy
const PROXY = 'https://corsproxy.io/?url=';

// TWSE OpenAPI Base
const TWSE_BASE = 'https://openapi.twse.com.tw/v1';

function proxyUrl(url: string): string {
  return PROXY + encodeURIComponent(url);
}

// TWSE 即時行情資料 (毎交易日更新)
export interface TWSTEStockQuote {
  Code: string;
  Name: string;
  ClosingPrice: string;
  Change: string;
  OpeningPrice: string;
  HighestPrice: string;
  LowestPrice: string;
  TradeVolume: string;
  Transaction: string;
  Date: string;
}

// 快取 TWSE 全市場資料（避免重複請求）
let twseCache: TWSTEStockQuote[] | null = null;
let twseCacheDate: string | null = null;

export async function fetchTWSEAllStocks(): Promise<TWSTEStockQuote[]> {
  try {
    const today = new Date().toISOString().split('T')[0];
    // 使用快取（同一天同一個執行期間只抓一次）
    if (twseCache && twseCacheDate === today) {
      return twseCache;
    }
    const url = `${TWSE_BASE}/exchangeReport/STOCK_DAY_ALL`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`TWSE API error: ${res.status}`);
    const data: TWSTEStockQuote[] = await res.json();
    twseCache = data;
    twseCacheDate = today;
    return data;
  } catch (err) {
    console.error('fetchTWSEAllStocks error:', err);
    // 嘗試透過 proxy
    try {
      const url = `${TWSE_BASE}/exchangeReport/STOCK_DAY_ALL`;
      const res = await fetch(proxyUrl(url));
      const data: TWSTEStockQuote[] = await res.json();
      twseCache = data;
      return data;
    } catch {
      return [];
    }
  }
}

// 查詢單一股票的 TWSE 即時收盤價
export async function fetchTWSEStockPrice(code: string): Promise<TWSTEStockQuote | null> {
  const all = await fetchTWSEAllStocks();
  const stock = all.find(s => s.Code === code);
  return stock || null;
}

// 用小朋友聽得懂的方式描述公司
function makeKidFriendly(status: string, industry: string): string {
  const industryMap: Record<string, string> = {
    '半導體': '做電腦「大腦」的工廠 🧠',
    '電子組件': '做電子零件的工廠 🔩',
    '光電業': '做螢幕和LED燈的工廠 💡',
    '電機機械': '做大型機器的工廠 ⚙️',
    '電器電纜': '做電線電纜的工廠 🔌',
    '通信網路': '做網路設備的工廠 📡',
    '電腦週邊': '做電腦配件的工廠 🖥️',
  };

  for (const [key, desc] of Object.entries(industryMap)) {
    if (industry?.includes(key)) return desc;
  }
  
  if (status?.includes('全球第一') || status?.includes('全球最大')) {
    return `世界第一名的大公司！超厲害！🏆`;
  }
  if (status?.includes('台灣')) {
    return `台灣很有名的好公司 🇹🇼`;
  }
  return '一間認真做事的好公司 🏢';
}

// 取得個股資料
export async function fetchStockData(coid: string): Promise<StockData | null> {
  try {
    const url = `${IFALGO_BASE}/stock?coid=${coid}`;
    const res = await fetch(proxyUrl(url));
    const json = await res.json();
    if (json.data?.stock?.position) {
      return json.data.stock.position;
    }
    return null;
  } catch (err) {
    console.error('fetchStockData error:', err);
    return null;
  }
}

// 取得 Simons 每日推薦
export async function fetchSimonsData(date?: string): Promise<SimonsItem[]> {
  try {
    const d = date || new Date().toISOString().split('T')[0];
    const url = `${IFALGO_BASE}/common/getSimonsData?searchDate=${d}`;
    const res = await fetch(proxyUrl(url));
    const json = await res.json();
    return json.data?.dataItems || [];
  } catch (err) {
    console.error('fetchSimonsData error:', err);
    return [];
  }
}

// 計算 AI 投資建議
export function calculateAdvice(item: SimonsItem): { advice: AIAdvice; text: string; kidText: string; score: number } {
  const psr = item.psr || 0;
  const strength = parseFloat(item.strength) || 0;
  const close = parseFloat(item.close) || 0;
  const wtcost = parseFloat(item.wtcost) || 0;
  const fcost = parseFloat(item.fcost) || 0;
  const retW = item.ret_w;
  const retM = item.ret_m;
  const unusual = item.unusual;

  let score = 50; // 基礎分

  // PSR 評分 (10分制 → 30分佔比)
  score += (psr - 5) * 6;

  // 趨勢加分
  if (retW === 'rise') score += 8;
  if (retM === 'rise') score += 8;
  if (retW === 'drop') score -= 8;
  if (retM === 'drop') score -= 8;

  // 強度加分
  if (strength > 2) score += 10;
  else if (strength > 1.5) score += 5;
  else if (strength < 0.5) score -= 10;

  // 法人成本比較
  if (close < wtcost && close < fcost) {
    score += 10; // 收盤價低於法人成本 → 有空間
  } else if (close > wtcost * 1.1 && close > fcost * 1.1) {
    score -= 5; // 收盤價遠高於法人成本 → 注意
  }

  // 異常訊號
  if (unusual && unusual !== 'N') {
    if (unusual.includes('紅K') || unusual.includes('上影線')) {
      score += 3;
    }
  }

  // 邊界限制
  score = Math.max(0, Math.min(100, score));

  let advice: AIAdvice;
  let text: string;
  let kidText: string;

  if (score >= 70) {
    advice = 'buy';
    text = `綜合評分 ${score}分，趨勢向上，法人成本支撐，建議可以考慮買進。`;
    kidText = `PPBear 說：「這間公司最近表現很棒，就像考試考了 ${score} 分！很多投資大人都在買這檔股票喔，可以考慮買一些～」 🐻👍`;
  } else if (score >= 40) {
    advice = 'hold';
    text = `綜合評分 ${score}分，趨勢不明確，建議觀望等待更好的機會。`;
    kidText = `PPBear 說：「這間公司最近表現還可以，考了 ${score} 分，不算差但也不是最好。我們先看看，不急著買或賣唷！」 🐻🤔`;
  } else {
    advice = 'sell';
    text = `綜合評分 ${score}分，趨勢偏弱，建議保守或考慮出場。`;
    kidText = `PPBear 說：「這間公司最近比較辛苦，只有 ${score} 分...如果你有買的話，可以考慮先賣掉，把錢存起來等更好的機會喔！」 🐻💤`;
  }

  return { advice, text, kidText, score };
}

// 轉換為推薦格式
export function toRecommendation(item: SimonsItem): StockRecommendation {
  const { advice, text, kidText, score } = calculateAdvice(item);
  return {
    ...item,
    advice,
    adviceText: text,
    kidAdvice: kidText,
    score,
  };
}

// 轉換為股票報價格式
export function simonsToQuote(item: SimonsItem): StockQuote {
  const close = parseFloat(item.close) || 0;
  return {
    code: item.coid,
    name: item.stkname,
    price: close,
    change: 0,
    changePercent: 0,
    pe: 0,
    pb: 0,
    volume: 0,
    industry: item.category || '',
    status: item.status || '',
    kidFriendlyDesc: makeKidFriendly(item.status || '', item.category || ''),
  };
}

// 熱門股票列表（預設推薦）
export const POPULAR_STOCKS = [
  { code: '2330', name: '台積電', emoji: '🏭' },
  { code: '2317', name: '鴻海', emoji: '📱' },
  { code: '2454', name: '聯發科', emoji: '📡' },
  { code: '2412', name: '中華電', emoji: '📶' },
  { code: '2881', name: '富邦金', emoji: '🏦' },
  { code: '2882', name: '國泰金', emoji: '💳' },
  { code: '2303', name: '聯電', emoji: '⚡' },
  { code: '3711', name: '日月光', emoji: '🌙' },
  { code: '2308', name: '台達電', emoji: '🔋' },
  { code: '2383', name: '台光電', emoji: '💡' },
  { code: '1301', name: '台塑', emoji: '🧪' },
  { code: '2002', name: '中鋼', emoji: '🔩' },
];

// 產業分類
export const INDUSTRY_CATEGORIES = [
  { key: 'all', label: '全部', emoji: '🌟' },
  { key: '半導體', label: '半導體', emoji: '🧠' },
  { key: '電子組件', label: '電子', emoji: '🔩' },
  { key: '金融', label: '金融', emoji: '🏦' },
  { key: '電機機械', label: '機械', emoji: '⚙️' },
  { key: '光電', label: '光電', emoji: '💡' },
  { key: '傳產', label: '傳產', emoji: '🏗️' },
];
