/**
 * PPBears Investment - 每日電子報 Cron Function
 * 部署於 Vercel Serverless，每小時整點由 vercel.json crons 喚醒。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// ─── 初始化 Clients ───────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Service Role Key — 可讀取所有用戶
);

const resend = new Resend(process.env.RESEND_API_KEY);

// ─── 資料型別 ─────────────────────────────────────────────────────────────────
interface SimonsItem {
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
}

interface FilteredStock extends SimonsItem {
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

interface HoldingRow {
  stock_code: string;
  stock_name: string;
  total_shares: number;
  avg_cost: number;
  current_price: number;
  ai_advice?: '加碼' | '出場' | '中立';
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
}

// ─── 計算分數 ─────────────────────────────────────────────────────────
function calculateScore(item: SimonsItem): number {
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

// ─── 抓取 Simons 資料 ────────────────────────────────────────────────────────
async function fetchLatestSimonsData(): Promise<SimonsItem[]> {
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

// ─── AI 多面向分析（gpt-4o-mini）────────────────────────────────────────────────
async function generateStocksAnalysis(stocks: FilteredStock[]): Promise<void> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey || stocks.length === 0) return;

  const stocksData = stocks.map(s => ({
    coid: s.coid,
    stkname: s.stkname,
    close: s.close,
    latestNews: s.latestNews,
    remark: s.remark,
    cum_ret: s.cum_ret,
    psr: s.psr,
    strength: s.strength,
    wtcost: s.wtcost,
    fcost: s.fcost,
    ret_w: s.ret_w,
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: "json_object" },
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

// ─── 產生 HTML 電子報 ─────────────────────────────────────────────────────────
function buildEmailHtml(
  recipientName: string,
  stocks: FilteredStock[],
  holdings: HoldingRow[],
  todayDate: string
): string {

  // 圖文並茂的股票卡片 HTML
  const stocksHtml = stocks.map((s, i) => {
    const badgeColor = s.remark.includes('超高') ? '#e11d48' : s.remark.includes('高') ? '#ef4444' : '#f59e0b';
    return `
    <div style="background:#fff;border-radius:12px;border:1px solid #eaeaea;margin-bottom:24px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.04);">
      <div style="padding:16px 20px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;">
        <div style="font-size:20px;font-weight:900;color:#222;display:flex;align-items:center;gap:12px;">
          <span style="color:#555;">${s.coid}</span> ${s.stkname}
          <span style="font-size:12px;color:#fff;background:${badgeColor};padding:4px 8px;border-radius:4px;font-weight:700;">${s.remark}</span>
        </div>
      </div>
      <div style="padding:20px;background:#fafafa;text-align:center;">
        <div style="font-size:13px;color:#888;margin-bottom:8px;font-weight:600;">收盤價</div>
        <div style="font-size:36px;font-weight:900;color:#111;line-height:1;">${s.close}</div>
        <div style="color:#dc2626;font-weight:800;font-size:15px;margin-top:12px;">累積報酬 ${s.cum_ret}</div>
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
  `}).join('');

  // 庫存與 AI 建議 HTML
  const getHoldingBlockStyle = (adv?: string) => {
    if (adv === '加碼') return { bg: '#fef2f2', border: '#ef4444', text: '#ef4444' };
    if (adv === '出場') return { bg: '#ecfdf5', border: '#10b981', text: '#10b981' };
    return { bg: '#f4f9ff', border: '#3b82f6', text: '#3b82f6' };
  };

  const holdingsHtml = holdings.length > 0
    ? holdings.map(h => {
        const ui = getHoldingBlockStyle(h.ai_advice);
        return `
        <div style="background:${ui.bg};border-radius:6px;border-left:5px solid ${ui.border};padding:14px 16px;margin-bottom:12px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="text-align:left;">
                <div style="font-size:16px;color:#222;font-weight:700;">
                  ${h.stock_code} ${h.stock_name} <span style="font-size:14px;color:#aaa;margin-left:4px;">🔗</span>
                </div>
                <div style="font-size:12px;color:#888;margin-top:6px;">訊號日期: ${todayDate}</div>
              </td>
              <td style="text-align:right;vertical-align:middle;">
                <div style="font-size:18px;font-weight:800;color:${ui.text};">${h.ai_advice}</div>
              </td>
            </tr>
          </table>
        </div>
        `;
      }).join('')
    : '<div style="padding:24px;text-align:center;color:#888;">目前尚無持股</div>';

  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PPBears 每日投資週報 ${todayDate}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#fff;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#FF924C,#FF595E);padding:36px 24px;text-align:center;">
      <div style="font-size:44px;margin-bottom:10px;">🐻📈</div>
      <h1 style="margin:0;color:#fff;font-size:24px;font-weight:900;">PPBears 每日投資電子報</h1>
      <div style="color:rgba(255,255,255,0.85);font-size:14px;margin-top:6px;font-weight:600;">${todayDate} · Premium 版</div>
    </div>

    <div style="padding:32px 24px;">
      <!-- 問候語 -->
      <p style="color:#555;font-size:16px;margin:0 0 32px;line-height:1.6;">嗨 ${recipientName}！早安 ☕ 今天 PPBear 幫你找了 ${stocks.length} 檔值得關注的強勢好股票，並且搭配了 AI 財經深度解析，一起來看看吧～</p>

      <!-- AI 精選股票 -->
      <h2 style="margin:0 0 16px;font-size:20px;font-weight:900;color:#FF595E;border-left:5px solid #FF595E;padding-left:14px;">🤖 今日 AI 精選股票</h2>
      <div style="font-size:13px;color:#888;margin-bottom:16px;background:#fef2f2;padding:6px 12px;border-radius:6px;display:inline-block;font-weight:600;">篩選條件：✅ 累積報酬為正 + ✅ AI推薦中度以上</div>
      
      <div>${stocksHtml}</div>

      <hr style="border:none;border-top:1px dashed #e5e5e5;margin:36px 0;">

      <!-- 我的庫存 -->
      <h2 style="margin:0 0 20px;font-size:20px;font-weight:900;color:#3b82f6;border-left:5px solid #3b82f6;padding-left:14px;">💼 PPBear Inventory Guard</h2>
      <div>
        ${holdingsHtml}
      </div>

      <!-- CTA Button -->
      <div style="text-align:center;margin-top:40px;">
        <a href="https://ppbears-investment.vercel.app"
           style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#FF924C,#FF595E);color:#fff;font-weight:900;font-size:16px;text-decoration:none;border-radius:50px;box-shadow:0 6px 16px rgba(255,89,94,0.3);">
          📱 進入平台查看詳情
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f9f9f9;padding:24px;text-align:center;color:#aaa;font-size:13px;border-top:1px solid #eee;">
      <p style="margin:0 0 6px;font-weight:600;">📧 PPBears Investment Premium 電子報</p>
      <p style="margin:0;line-height:1.5;">此郵件由系統自動寄送，AI 分析數據與建議僅供學習參考，不構成投資建議。</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// ─── 主要 Handler ─────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: settings } = await supabase.from('system_settings').select('setting_key, setting_value');
    const settingsMap: Record<string, number> = {};
    (settings || []).forEach((row: { setting_key: string; setting_value: number }) => {
      settingsMap[row.setting_key] = Number(row.setting_value);
    });

    const newsletterHour = settingsMap['newsletter_send_hour'] ?? 7; 
    const nowUTC = new Date();
    const nowTW = new Date(nowUTC.getTime() + 8 * 60 * 60 * 1000);
    const twHour = nowTW.getUTCHours();
    const isForce = req.query.force === 'true';

    if (twHour !== newsletterHour && !isForce) {
      return res.status(200).json({ skipped: true, reason: `目前台灣時間 ${twHour}:xx，未達發送時段` });
    }

    const allStocks = await fetchLatestSimonsData();
    if (allStocks.length === 0) {
      return res.status(200).json({ error: '無法取得 Simons 資料' });
    }

    // 將股票先用 score 排序取出前 30 檔，避免請求過多導致 Timeout
    const sortedStocks = allStocks
      .map(s => ({ ...s, score: calculateScore(s) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    // ── Step 4: 呼叫 API 篩選 累計報酬正 + AI推薦中度以上 ────────────────
    const fetchPromises = sortedStocks.map(async (s) => {
      try {
        const res = await fetch(\`https://api.ifalgo.com.tw/frontapi/stock?coid=\${s.coid}\`);
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
             } catch (ye) {
               console.error('Yahoo news fetch failed for', s.coid);
             }

             return { ...s, cum_ret: cumRetStr, remark, latestNews } as FilteredStock;
           }
        }
      } catch (e) {
        return null;
      }
      return null;
    });

    const results = await Promise.all(fetchPromises);
    let filtered = results.filter(Boolean) as FilteredStock[];
    filtered = filtered.sort((a, b) => b.score - a.score).slice(0, 3);

    if (filtered.length === 0) {
      return res.status(200).json({ message: '無符合條件的精選股票' });
    }

    // ── Step 5: 產生多面向 AI 解析 ──────────────────────────────────────────
    await generateStocksAnalysis(filtered);

    // ── Step 6: 取得所有 Premium 用戶與快取所有持股狀況 ──────────────────────────
    const { data: premiumUsers } = await supabase.from('users').select('id, email, display_name').eq('tier', 'premium');
    if (!premiumUsers || premiumUsers.length === 0) {
      return res.status(200).json({ message: '目前沒有 Premium 用戶，跳過發信' });
    }

    // 快取全域 stock_detail 狀態以減少每個用戶迴圈內的延遲
    const stockCache: Record<string, { sell_sig: string }> = {};
    const getStockDetailCached = async (coid: string) => {
      if (stockCache[coid] !== undefined) return stockCache[coid];
      try {
        const res = await fetch(`https://api.ifalgo.com.tw/frontapi/stock?coid=${coid}`);
        const json = await res.json();
        const list = json.data?.stock?.aiQuanBackDataTradingList || [];
        const last = list.length > 0 ? list[list.length - 1].sell_sig : '';
        stockCache[coid] = { sell_sig: last };
        return stockCache[coid];
      } catch {
        stockCache[coid] = { sell_sig: '' };
        return stockCache[coid];
      }
    };
    const buySet = new Set(allStocks.map(s => s.coid));

    // ── Step 7: 逐一發信 ──────────────────────────────────────────────────
    const todayDate = nowTW.toISOString().slice(0, 10);
    let sentCount = 0;
    const errors: string[] = [];

    for (const u of premiumUsers as UserRow[]) {
      try {
        const { data: holdingsData } = await supabase.from('holdings').select('stock_code, stock_name, total_shares, avg_cost, current_price').eq('user_id', u.id);

        const holdingsPromises = (holdingsData || []).map(async (h: any) => {
           let advice: '加碼' | '出場' | '中立' = '中立';
           if (buySet.has(h.stock_code)) {
             advice = '加碼';
           } else {
             const detail = await getStockDetailCached(h.stock_code);
             if (detail.sell_sig === '出場' || detail.sell_sig === '賣出') {
               advice = '出場';
             }
           }
           return {
             stock_code: h.stock_code,
             stock_name: h.stock_name,
             total_shares: Number(h.total_shares),
             avg_cost: Number(h.avg_cost),
             current_price: Number(h.current_price),
             ai_advice: advice
           } as HoldingRow;
        });
        const holdings = await Promise.all(holdingsPromises);

        const html = buildEmailHtml(u.display_name, filtered, holdings, todayDate);

        await new Promise(resolve => setTimeout(resolve, 600));

        const { error: sendError } = await resend.emails.send({
          from: 'PPBears Investment <newsletter@investment.ppbears.com>',
          to: u.email,
          subject: `🐻 PPBears 每日電子報 ${todayDate} ｜${filtered.length} 檔精選股票與 AI 解析`,
          html,
        });

        if (sendError) {
          errors.push(`${u.email}: ${sendError.message}`);
        } else {
          sentCount++;
        }
      } catch (e) {
        errors.push(`${u.email}: ${String(e)}`);
      }
    }

    return res.status(200).json({
      success: true,
      sentCount,
      filteredStocks: filtered.map(s => `${s.stkname}(${s.coid}) - ${s.remark}`),
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (err) {
    console.error('cron-newsletter error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
