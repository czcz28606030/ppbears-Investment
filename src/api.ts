import type { StockData, SimonsItem, StockQuote, StockRecommendation, AIAdvice } from './types';
import { supabase } from './supabase';

const IFALGO_BASE = '/api/ifalgo';

// TWSE OpenAPI Base
const TWSE_BASE = '/api/twse';

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
    return [];
  }
}

// TWSE 殖利率與本益比資料
export interface TWSEDividendYield {
  Code: string;
  Name: string;
  PEratio: string;
  DividendYield: string;
  PBratio: string;
}

let twseDividendCache: TWSEDividendYield[] | null = null;
let twseDividendCacheDate: string | null = null;

export async function fetchTWSEDividendYields(): Promise<TWSEDividendYield[]> {
  try {
    const today = new Date().toISOString().split('T')[0];
    if (twseDividendCache && twseDividendCacheDate === today) {
      return twseDividendCache;
    }
    const url = `${TWSE_BASE}/exchangeReport/BWIBBU_ALL`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`TWSE API error: ${res.status}`);
    const data: TWSEDividendYield[] = await res.json();
    twseDividendCache = data;
    twseDividendCacheDate = today;
    return data;
  } catch (err) {
    console.error('fetchTWSEDividendYields error:', err);
    return [];
  }
}

// 查詢單一股票的 TWSE 即時收盤價
export async function fetchTWSEStockPrice(code: string): Promise<TWSTEStockQuote | null> {
  const all = await fetchTWSEAllStocks();
  const stock = all.find(s => s.Code === code);
  return stock || null;
}

export function makeKidFriendly(_code: string, name: string, status: string, _industry: string): string {
  if (status?.includes('全球第一') || status?.includes('全球最大')) {
    return `這是一間世界第一名的大公司！他們把產品賣到全世界各地，真的超厲害！🏆🌍`;
  }
  if (status?.includes('台灣') || name) {
    return `這是一間在台灣努力打拼的好公司！他們認真製造很棒的產品給大家使用喔！🇹🇼🏢`;
  }
  return '一間認真做事、努力賺錢，也為社會貢獻的好公司 🏢✨';
}

// 動態取得或生成兒童版股票介紹
export async function getOrGenerateKidFriendlyDesc(
  code: string, 
  name: string, 
  status: string, 
  industry: string,
  onChunk?: (text: string) => void
): Promise<string> {
  const fallbackDesc = makeKidFriendly(code, name, status, industry);

  if (!supabase) return fallbackDesc;
  
  try {
    // 1. 嘗試從快取資料庫讀取
    if (supabase) {
      try {
        const { data: cached, error: cacheErr } = await supabase
          .from('stock_profiles')
          .select('kid_description')
          .eq('stock_code', code)
          .maybeSingle();

        if (!cacheErr && cached && cached.kid_description) {
          if (onChunk) onChunk(cached.kid_description);
          return cached.kid_description;
        }
      } catch (cacheError) {
        console.warn('Supabase cache read error (ignored):', cacheError);
      }
    }

    // 2. 如果沒有或快取失敗，嘗試呼叫 OpenAI gpt-4o-mini
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('No OpenAI API key found, using fallback.');
      return fallbackDesc; // 如果沒有 API Key，就回退原本的寫法
    }

    const payload = {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `你是一隻叫 PPBear 的可愛小熊解說員。你的唯一任務是「重點介紹這間公司生產的產品與服務」。

規則（非常重要）：
1. 絕對不能有任何客套話與廢話（禁止使用「嗨大家好」「小朋友們」「快來」「一起學習」「讓未來變得更美好」「PPBear 支持你」等開場或結尾）。
2. 直接破題，重點完全放在「公司的產品與服務介紹」，直接告訴大家這間公司在做什麼。
3. 必須使用白話文、用小朋友能輕鬆聽懂的方式說明。
4. 一定要舉出生活中看得到的實體商品或情境當作例子（例如：手機裡的晶片、超商的飲料、平常用的網路...）。
5. 全文字數必須嚴格控制在 50 到 200 字之間。
6. 保持活潑生動但直接切入重點，可以適度使用 Emoji 輔助。`
        },
        {
          role: 'user',
          content: `公司名稱：${name} (${code})。所屬產業：${industry}。公司概況：${status}。請重申規則：直接介紹產品服務、舉生活例子、50到200字以內、拒絕任何客套話。`
        }
      ],
      temperature: 0.75,
      max_tokens: 350,
      stream: true
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('OpenAI API Error:', await response.text());
      return fallbackDesc;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || ''; // 將最後一段不完整的留到下一次
        
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim();
          if (line === '[DONE]' || !line) continue;
          
          try {
            const parsed = JSON.parse(line);
            if (parsed.choices?.[0]?.delta?.content) {
              fullText += parsed.choices[0].delta.content;
              if (onChunk) onChunk(fullText);
            }
          } catch (e) {
            // 忽略無法解析的片段
          }
        }
      }
    }
    
    // 結束時如果還有東西可以收尾 (通常不會)
    if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
      try {
        const parsed = JSON.parse(buffer.replace(/^data: /, '').trim());
        if (parsed.choices?.[0]?.delta?.content) fullText += parsed.choices[0].delta.content;
      } catch(e) {}
    }

    // 防禦性檢查，如果生成失敗
    if (!fullText) return fallbackDesc;

    // 3. 把生成的結果存入 Supabase，以後就不必再花錢請求了
    if (supabase) {
      try {
        await supabase.from('stock_profiles').insert({
          stock_code: code,
          kid_description: fullText
        });
      } catch (insertErr) {
        console.warn('Supabase cache insert error (ignored):', insertErr);
      }
    }

    return fullText;
  } catch (error) {
    console.error('getOrGenerateKidFriendlyDesc error:', error);
    return fallbackDesc;
  }
}


// 取得個股資料
export async function fetchStockData(coid: string): Promise<StockData | null> {
  try {
    const url = `${IFALGO_BASE}/stock?coid=${coid}`;
    const res = await fetch(url);
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
    const res = await fetch(url);
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
    kidFriendlyDesc: makeKidFriendly(item.coid || '', item.stkname || '', item.status || '', item.category || ''),
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
