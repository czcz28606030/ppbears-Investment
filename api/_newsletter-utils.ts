/**
 * PPBears Investment - 電子報共用工具
 * 供 cron-newsletter.ts 與 send-newsletter-single.ts 共用
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// ─── 初始化 Clients ───────────────────────────────────────────────────────────
export const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const resend = new Resend(process.env.RESEND_API_KEY);

// ─── 資料型別 ─────────────────────────────────────────────────────────────────
export interface SimonsItem {
  mdate: string;
  coid: string;
  stkname: string;
  close: string;
  strength: string;
  psr: number;
  ret_w: string;
  ret_m: string;
  wtcost: string;
  fcost: string;
  unusual: string;
  category: string;
  subindustry?: string;
}

export interface FilteredStock extends SimonsItem {
  score: number;
  cum_ret: string;
  remark: string;
  latestNews?: string[];
  aiAnalysis?: {
    technical: string;
    chips: string;
    news: string;
    advice: string;
  };
}

export interface HoldingRow {
  stock_code: string;
  stock_name: string;
  total_shares: number;
  avg_cost: number;
  current_price: number;
  signal?: '加碼' | '出場' | '中立';
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  newsletter_strategy?: string;
}

// ─── 策略名稱對照 ─────────────────────────────────────────────────────────────
export const STRATEGY_LABELS: Record<string, string> = {
  A: '🏢 穩穩大公司',
  B: '🚀 最近變強公司',
  C: '👀 市場有注意公司',
  D: '👴 價值潛力公司',
  E: '💰 配息安心公司',
  F: '🏷️ 便宜好公司',
};

// ─── 計算分數 ─────────────────────────────────────────────────────────────────
export function calculateScore(item: SimonsItem): number {
  const psr = item.psr || 0;
  const strength = parseFloat(item.strength) || 0;
  const close = parseFloat(item.close) || 0;
  const wtcost = parseFloat(item.wtcost) || 0;
  const fcost = parseFloat(item.fcost) || 0;

  let score = 50;
  score += (psr - 5) * 6;

  if (item.ret_w === 'rise') score += 8;
  if (item.ret_m === 'rise') score += 8;
  if (item.ret_w === 'drop') score -= 8;
  if (item.ret_m === 'drop') score -= 8;

  if (strength > 2) score += 10;
  else if (strength > 1.5) score += 5;
  else if (strength < 0.5) score -= 10;

  if (close < wtcost && close < fcost) score += 10;
  else if (close > wtcost * 1.1 && close > fcost * 1.1) score -= 5;

  if (item.unusual && item.unusual !== 'N') {
    if (item.unusual.includes('紅K') || item.unusual.includes('上影線')) score += 3;
  }

  return Math.max(0, Math.min(100, score));
}

// ─── 抓取 Simons 資料 ─────────────────────────────────────────────────────────
export async function fetchLatestSimonsData(): Promise<SimonsItem[]> {
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const dateStr = date.toISOString().split('T')[0];
    try {
      const res = await fetch(
        `https://api.ifalgo.com.tw/frontapi/common/getSimonsData?searchDate=${dateStr}`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (!res.ok) continue;
      const json = await res.json() as { data?: { dataItems?: SimonsItem[] } };
      const items = json.data?.dataItems || [];
      if (items.length > 0) return items;
    } catch {
      continue;
    }
  }
  return [];
}

// ─── 策略篩選（非 AI 用戶）────────────────────────────────────────────────────
export function filterByStrategy(allStocks: SimonsItem[], strategy: string): FilteredStock[] {
  const scored = allStocks.map(s => ({ ...s, score: calculateScore(s) }));
  let list: typeof scored = [];

  switch (strategy) {
    case 'A':
      list = scored.filter(r => r.psr >= 6);
      break;
    case 'B':
      list = scored.filter(r => r.ret_w === 'rise' && r.ret_m === 'rise');
      if (list.length < 5)
        list = scored.filter(r => r.ret_w === 'rise' && parseFloat(r.strength || '0') >= 1.8);
      break;
    case 'C':
      list = scored.filter(r => parseFloat(r.strength || '0') > 2.0);
      if (list.length < 5)
        list = scored.filter(r => parseFloat(r.strength || '0') >= 1.8);
      break;
    case 'D':
      list = scored.filter(r => {
        const close = parseFloat(r.close || '0');
        const wtcost = parseFloat(r.wtcost || '0');
        return r.psr >= 7 && wtcost > 0 && close < wtcost;
      });
      if (list.length < 5)
        list = scored.filter(r => {
          const close = parseFloat(r.close || '0');
          const wtcost = parseFloat(r.wtcost || '0');
          return r.psr >= 6 && wtcost > 0 && close <= wtcost * 1.03;
        });
      break;
    case 'E':
      list = scored.filter(r =>
        (r.category?.includes('金融') || r.category?.includes('電信') ||
         r.category?.includes('電力') || r.category?.includes('公用') ||
         r.subindustry?.includes('金融')) && r.ret_m !== 'drop'
      );
      if (list.length < 5)
        list = scored.filter(r => r.psr >= 8 && r.ret_m !== 'drop' && r.ret_w !== 'drop');
      break;
    case 'F':
      list = scored.filter(r => {
        const close = parseFloat(r.close || '0');
        const wtcost = parseFloat(r.wtcost || '0');
        const fcost = parseFloat(r.fcost || '0');
        return wtcost > 0 && fcost > 0 && close < wtcost && close < fcost;
      });
      if (list.length < 5)
        list = scored.filter(r => {
          const close = parseFloat(r.close || '0');
          const wtcost = parseFloat(r.wtcost || '0');
          const fcost = parseFloat(r.fcost || '0');
          return r.psr >= 5 && ((wtcost > 0 && close < wtcost) || (fcost > 0 && close < fcost));
        });
      break;
    default:
      list = scored;
  }

  const strategyLabel = STRATEGY_LABELS[strategy] || strategy;
  return list
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => ({
      ...s,
      cum_ret: s.ret_w === 'rise' ? '週漲' : s.ret_m === 'rise' ? '月漲' : '持平',
      remark: strategyLabel,
    }));
}

// ─── AI 篩選（有 ai_stock_picking 功能的用戶）────────────────────────────────
export async function filterByAI(allStocks: SimonsItem[]): Promise<FilteredStock[]> {
  const sortedStocks = allStocks
    .map(s => ({ ...s, score: calculateScore(s) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);

  const fetchPromises = sortedStocks.map(async (s) => {
    try {
      const res = await fetch(`https://api.ifalgo.com.tw/frontapi/stock?coid=${s.coid}`);
      const json = await res.json();
      const comment = json.data?.stock?.aiQuanBackDataComment;
      if (comment) {
        const cumRetStr = comment.cum_ret || '';
        const cumRet = parseFloat(cumRetStr.replace('%', ''));
        const remark = comment.remark || '';
        const isPositive = !isNaN(cumRet) && cumRet > 0;
        const isHighRec = remark.includes('中') || remark.includes('高') || remark.includes('強');

        if (isPositive && isHighRec) {
          let latestNews: string[] = [];
          try {
            const yRes = await fetch(`https://tw.stock.yahoo.com/quote/${s.coid}/news`);
            if (yRes.ok) {
              const yText = await yRes.text();
              const matches = [...yText.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)];
              latestNews = matches.map(m => m[1].replace(/<[^>]+>/g, '')).filter(t => t !== '個股相關新聞與公告').slice(0, 3);
            }
          } catch {
            // ignore news fetch failure
          }
          return { ...s, cum_ret: cumRetStr, remark, latestNews } as FilteredStock;
        }
      }
    } catch {
      return null;
    }
    return null;
  });

  const results = await Promise.all(fetchPromises);
  return (results.filter(Boolean) as FilteredStock[])
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// ─── AI 多面向分析（gpt-4o-mini）─────────────────────────────────────────────
export async function generateStocksAnalysis(stocks: FilteredStock[]): Promise<void> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey || stocks.length === 0) return;

  const stocksData = stocks.map(s => ({
    coid: s.coid, stkname: s.stkname, close: s.close,
    latestNews: s.latestNews, remark: s.remark, cum_ret: s.cum_ret,
    psr: s.psr, strength: s.strength, wtcost: s.wtcost, fcost: s.fcost, ret_w: s.ret_w,
  }));

  const prompt = `你是一位專業的台股分析師。請針對以下 ${stocks.length} 檔精選股票，綜合提供的真實數據與「奇摩股市新聞」撰寫出專業且客觀的財經解析。
請務必嚴格依照以下 JSON 格式回傳（只需要回傳 JSON，不要加 markdown block 等任何多餘文字），針對每一檔股票填入對應分析：

{
  "results": [
    {
      "coid": "股票代號",
      "technical": "技術面：(請依據提供的收盤價趨勢，給出技術指標動能短評)",
      "chips": "籌碼面：(請依據提供的外資與加權成本等，給出籌碼穩定度分析)",
      "news": "消息面：(請務必依據「latestNews」捕捉到的奇摩股市最新相關新聞，或 AI推薦度，給出具體且非憑空對齊市場的消息面解析)",
      "advice": "最佳建議：(綜合技術/籌碼/消息，給出具體的對應持股或停損等進出場建議)"
    }
  ]
}

給定的個股數據：
${JSON.stringify(stocksData, null, 2)}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
    });
    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    if (parsed.results && Array.isArray(parsed.results)) {
      parsed.results.forEach((r: any) => {
        const target = stocks.find(s => s.coid === r.coid);
        if (target) {
          target.aiAnalysis = {
            technical: r.technical || '暫無資料',
            chips: r.chips || '暫無資料',
            news: r.news || '暫無資料',
            advice: r.advice || '暫定觀望',
          };
        }
      });
    }
  } catch (e) {
    console.error('OpenAI Analysis Failed:', e);
  }
}

// ─── 建立庫存訊號列表 ────────────────────────────────────────────────────────
export async function buildHoldingsWithSignals(
  userId: string,
  allStockCoids: Set<string>
): Promise<HoldingRow[]> {
  const { data: holdingsData } = await supabase
    .from('holdings')
    .select('stock_code, stock_name, total_shares, avg_cost, current_price')
    .eq('user_id', userId);

  if (!holdingsData || holdingsData.length === 0) return [];

  // 快取 sell_sig 查詢
  const stockCache: Record<string, { sell_sig: string }> = {};
  const getStockDetail = async (coid: string) => {
    if (stockCache[coid] !== undefined) return stockCache[coid];
    try {
      const res = await fetch(`https://api.ifalgo.com.tw/frontapi/stock?coid=${coid}`);
      const json = await res.json();
      const list = json.data?.stock?.aiQuanBackDataTradingList || [];
      const last = list.length > 0 ? list[list.length - 1].sell_sig : '';
      stockCache[coid] = { sell_sig: last };
    } catch {
      stockCache[coid] = { sell_sig: '' };
    }
    return stockCache[coid];
  };

  const holdingsPromises = holdingsData.map(async (h: any) => {
    let signal: '加碼' | '出場' | '中立' = '中立';
    if (allStockCoids.has(h.stock_code)) {
      signal = '加碼';
    } else {
      const detail = await getStockDetail(h.stock_code);
      if (detail.sell_sig === '出場' || detail.sell_sig === '賣出') {
        signal = '出場';
      }
    }
    return {
      stock_code: h.stock_code,
      stock_name: h.stock_name,
      total_shares: Number(h.total_shares),
      avg_cost: Number(h.avg_cost),
      current_price: Number(h.current_price),
      signal,
    } as HoldingRow;
  });

  return Promise.all(holdingsPromises);
}

// ─── 產生 HTML 電子報 ─────────────────────────────────────────────────────────
export function buildEmailHtml(
  recipientName: string,
  stocks: FilteredStock[],
  holdings: HoldingRow[],
  todayDate: string,
  strategyLabel?: string
): string {

  const stocksHtml = stocks.map((s) => {
    const badgeColor = s.remark.includes('超高') ? '#e11d48'
      : s.remark.includes('高') ? '#ef4444'
      : s.remark.includes('強') ? '#ef4444'
      : '#f59e0b';
    return `
    <div style="background:#fff;border-radius:12px;border:1px solid #eaeaea;margin-bottom:24px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.04);">
      <div style="padding:16px 20px;border-bottom:1px solid #f0f0f0;">
        <div style="font-size:20px;font-weight:900;color:#222;display:flex;align-items:center;gap:12px;">
          <span style="color:#555;">${s.coid}</span> ${s.stkname}
          <span style="font-size:12px;color:#fff;background:${badgeColor};padding:4px 8px;border-radius:4px;font-weight:700;">${s.remark}</span>
        </div>
      </div>
      <div style="padding:20px;background:#fafafa;text-align:center;">
        <div style="font-size:13px;color:#888;margin-bottom:8px;font-weight:600;">收盤價</div>
        <div style="font-size:36px;font-weight:900;color:#111;line-height:1;">${s.close}</div>
        <div style="color:#dc2626;font-weight:800;font-size:15px;margin-top:12px;">報酬趨勢 ${s.cum_ret}</div>
      </div>
      ${s.aiAnalysis ? `
      <div style="padding:20px 24px;line-height:1.7;font-size:14px;color:#444;">
        <p style="margin-top:0;">📈 <strong>技術面：</strong> ${s.aiAnalysis.technical}</p>
        <p>💰 <strong>籌碼面：</strong> ${s.aiAnalysis.chips}</p>
        <p>📰 <strong>消息面：</strong> ${s.aiAnalysis.news}</p>
      </div>
      <div style="padding:20px 24px;background:#fef9c3;border-top:1px solid #fde047;border-bottom-left-radius:12px;border-bottom-right-radius:12px;">
        <p style="margin:0;color:#854d0e;font-size:14.5px;line-height:1.6;">💡 <strong>最佳建議：</strong> ${s.aiAnalysis.advice}</p>
      </div>
      ` : `
      <div style="padding:24px;text-align:center;color:#888;font-size:14px;">目前暫無詳細解析數據</div>
      `}
    </div>
  `;
  }).join('');

  const getSignalStyle = (sig?: string) => {
    if (sig === '加碼') return { bg: '#fef2f2', border: '#ef4444', text: '#ef4444', icon: '🚀' };
    if (sig === '出場') return { bg: '#ecfdf5', border: '#10b981', text: '#10b981', icon: '⚠️' };
    return { bg: '#f4f9ff', border: '#3b82f6', text: '#3b82f6', icon: '⚖️' };
  };

  const holdingsHtml = holdings.length > 0
    ? holdings.map(h => {
        const ui = getSignalStyle(h.signal);
        return `
        <div style="background:${ui.bg};border-radius:6px;border-left:5px solid ${ui.border};padding:14px 16px;margin-bottom:12px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="text-align:left;">
                <div style="font-size:16px;color:#222;font-weight:700;">${h.stock_code} ${h.stock_name}</div>
                <div style="font-size:12px;color:#888;margin-top:6px;">訊號日期: ${todayDate}</div>
              </td>
              <td style="text-align:right;vertical-align:middle;">
                <div style="font-size:18px;font-weight:800;color:${ui.text};">${ui.icon} ${h.signal ?? '中立'}</div>
              </td>
            </tr>
          </table>
        </div>
        `;
      }).join('')
    : '';

  const sectionTitle = strategyLabel
    ? `📊 ${strategyLabel} 策略精選`
    : '🤖 今日 AI 精選股票';

  const sectionDesc = strategyLabel
    ? `篩選條件：${strategyLabel}`
    : '篩選條件：✅ 累積報酬為正 + ✅ AI推薦中度以上';

  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PPBears 每日投資電子報 ${todayDate}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#fff;">
    <div style="background:linear-gradient(135deg,#FF924C,#FF595E);padding:36px 24px;text-align:center;">
      <div style="font-size:44px;margin-bottom:10px;">🐻📈</div>
      <h1 style="margin:0;color:#fff;font-size:24px;font-weight:900;">PPBears 每日投資電子報</h1>
      <div style="color:rgba(255,255,255,0.85);font-size:14px;margin-top:6px;font-weight:600;">${todayDate} · Premium 版</div>
    </div>
    <div style="padding:32px 24px;">
      <p style="color:#555;font-size:16px;margin:0 0 32px;line-height:1.6;">嗨 ${recipientName}！早安 ☕ 今天 PPBear 幫你找了 ${stocks.length} 檔值得關注的好股票，並搭配 AI 財經深度解析，一起來看看吧～</p>

      <h2 style="margin:0 0 16px;font-size:20px;font-weight:900;color:#FF595E;border-left:5px solid #FF595E;padding-left:14px;">${sectionTitle}</h2>
      <div style="font-size:13px;color:#888;margin-bottom:16px;background:#fef2f2;padding:6px 12px;border-radius:6px;display:inline-block;font-weight:600;">${sectionDesc}</div>
      <div>${stocksHtml}</div>

      ${holdings.length > 0 ? `
      <hr style="border:none;border-top:1px dashed #e5e5e5;margin:36px 0;">
      <h2 style="margin:0 0 20px;font-size:20px;font-weight:900;color:#3b82f6;border-left:5px solid #3b82f6;padding-left:14px;">💼 庫存加碼 / 出場訊號</h2>
      <div style="font-size:13px;color:#888;margin-bottom:16px;">📈 加碼：站上推薦清單｜⚠️ 出場：賣出訊號觸發｜⚖️ 中立：持續觀察</div>
      <div>${holdingsHtml}</div>
      ` : ''}

      <div style="text-align:center;margin-top:40px;">
        <a href="https://ppbears-investment.vercel.app"
           style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#FF924C,#FF595E);color:#fff;font-weight:900;font-size:16px;text-decoration:none;border-radius:50px;box-shadow:0 6px 16px rgba(255,89,94,0.3);">
          📱 進入平台查看詳情
        </a>
      </div>
    </div>
    <div style="background:#f9f9f9;padding:24px;text-align:center;color:#aaa;font-size:13px;border-top:1px solid #eee;">
      <p style="margin:0 0 6px;font-weight:600;">📧 PPBears Investment Premium 電子報</p>
      <p style="margin:0;line-height:1.5;">此郵件由系統自動寄送，AI 分析數據與建議僅供學習參考，不構成投資建議。</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// ─── 判斷用戶是否擁有 ai_stock_picking 功能 ──────────────────────────────────
export async function userHasAiFeature(userId: string, userTier: string): Promise<boolean> {
  const { data } = await supabase
    .from('feature_overrides')
    .select('enabled')
    .eq('user_id', userId)
    .eq('feature_key', 'ai_stock_picking')
    .maybeSingle();

  if (data) return Boolean(data.enabled);
  return userTier === 'premium'; // 預設：premium 有 AI
}

// ─── 發送單一用戶電子報 ───────────────────────────────────────────────────────
export async function sendNewsletterToUser(
  user: UserRow & { tier: string },
  allStocks: SimonsItem[],
  aiFilteredCache: FilteredStock[] | null,
  todayDate: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const hasAi = await userHasAiFeature(user.id, user.tier);
    const strategy = user.newsletter_strategy;

    let stocks: FilteredStock[];
    let strategyLabel: string | undefined;

    if (hasAi || !strategy) {
      // AI 模式：使用快取的 AI 篩選結果
      if (!aiFilteredCache || aiFilteredCache.length === 0) return { success: false, error: '無 AI 精選股票' };
      stocks = aiFilteredCache;
    } else {
      // 策略模式
      stocks = filterByStrategy(allStocks, strategy);
      strategyLabel = STRATEGY_LABELS[strategy];
      if (stocks.length === 0) return { success: false, error: `策略 ${strategy} 無符合股票` };
      await generateStocksAnalysis(stocks);
    }

    const allCoids = new Set(allStocks.map(s => s.coid));
    const holdings = await buildHoldingsWithSignals(user.id, allCoids);
    const html = buildEmailHtml(user.display_name, stocks, holdings, todayDate, strategyLabel);

    const subjectStrategy = strategyLabel ? `${strategyLabel} 策略` : 'AI 精選';
    const { error: sendError } = await resend.emails.send({
      from: 'PPBears Investment <newsletter@investment.ppbears.com>',
      to: user.email,
      subject: `🐻 PPBears 電子報 ${todayDate} ｜${subjectStrategy} ${stocks.length} 檔`,
      html,
    });

    if (sendError) return { success: false, error: sendError.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
