/**
 * PPBears Investment - 每日電子報 Cron Function
 * 部署於 Vercel Serverless，每小時整點由 vercel.json crons 喚醒。
 * 根據 system_settings.newsletter_send_hour（台灣時間）判斷是否這個小時需要發信。
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

interface FilteredStock {
  coid: string;
  stkname: string;
  close: string;
  score: number;
  psr: number;
  strength: string;
  category: string;
  ret_m: string;
  ret_w: string;
}

interface HoldingRow {
  stock_code: string;
  stock_name: string;
  total_shares: number;
  avg_cost: number;
  current_price: number;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
}

// ─── 計算 AI 評分（與前端 calculateAdvice 邏輯一致） ──────────────────────────
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

// ─── 抓取 Simons 資料（往前找最近 7 個交易日） ────────────────────────────────
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

// ─── AI 摘要生成（gpt-4o-mini） ───────────────────────────────────────────────
async function generateAISummary(stocks: FilteredStock[]): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey || stocks.length === 0) return '';

  const stockList = stocks.map((s, i) =>
    `${i + 1}. ${s.stkname}（${s.coid}）｜評分 ${s.score}分｜強度 ${s.strength}｜PSR ${s.psr}｜產業：${s.category}｜收盤 NT$${s.close}`
  ).join('\n');

  const prompt = `你是一位台股投資顧問，請用繁體中文、輕鬆易懂的語氣，針對以下 ${stocks.length} 檔今日精選股票，寫一段不超過 150 字的整體市場觀察與投資方向建議。不要逐一介紹每檔股票，而是找出共同主題或趨勢。結尾用一句鼓勵小朋友學習投資的話。\n\n今日精選股票：\n${stockList}`;

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
        max_tokens: 300,
        temperature: 0.7,
      }),
    });
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || '';
  } catch {
    return '';
  }
}

// ─── 產生 HTML 電子報 ─────────────────────────────────────────────────────────
function buildEmailHtml(
  recipientName: string,
  stocks: FilteredStock[],
  aiSummary: string,
  holdings: HoldingRow[],
  todayDate: string
): string {
  const scoreColor = (s: number) => s >= 70 ? '#e05050' : s >= 50 ? '#f59e0b' : '#888';
  const trendBadge = (ret: string) =>
    ret === 'rise'
      ? '<span style="color:#e05050;font-weight:700;">📈 上漲</span>'
      : ret === 'drop'
        ? '<span style="color:#3cc464;font-weight:700;">📉 下跌</span>'
        : '<span style="color:#888;">➡ 持平</span>';

  // 精選股票 HTML
  const stocksHtml = stocks.map((s, i) => `
    <tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:12px 8px;font-weight:800;color:#333;">${i + 1}. ${s.stkname}<br><span style="font-size:11px;color:#888;font-weight:400;">${s.coid} | ${s.category}</span></td>
      <td style="padding:12px 8px;text-align:center;font-weight:700;color:${scoreColor(s.score)};">${s.score}分</td>
      <td style="padding:12px 8px;text-align:right;font-weight:700;color:#333;">NT$${s.close}</td>
      <td style="padding:12px 8px;text-align:center;">${trendBadge(s.ret_m)}</td>
    </tr>
  `).join('');

  // 我的庫存 HTML
  const holdingsHtml = holdings.length > 0
    ? holdings.map(h => {
        const pnl = (h.current_price - h.avg_cost) * h.total_shares;
        const pnlPct = ((h.current_price - h.avg_cost) / h.avg_cost * 100).toFixed(1);
        const pnlColor = pnl >= 0 ? '#e05050' : '#3cc464';
        return `
          <tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:10px 8px;font-weight:700;color:#333;">${h.stock_name}<br><span style="font-size:11px;color:#888;font-weight:400;">${h.stock_code}</span></td>
            <td style="padding:10px 8px;text-align:center;color:#555;">${h.total_shares} 股</td>
            <td style="padding:10px 8px;text-align:right;font-weight:700;color:${pnlColor};">${pnl >= 0 ? '+' : ''}NT$${Math.abs(pnl).toFixed(0)}<br><span style="font-size:11px;">${pnlPct}%</span></td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="3" style="padding:16px;text-align:center;color:#888;">目前尚無持股</td></tr>';

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
    <div style="background:linear-gradient(135deg,#FF924C,#FF595E);padding:32px 24px;text-align:center;">
      <div style="font-size:40px;margin-bottom:8px;">🐻📈</div>
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:900;">PPBears 每日投資電子報</h1>
      <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:6px;">${todayDate} · Premium 版</div>
    </div>

    <div style="padding:24px;">
      <!-- 問候語 -->
      <p style="color:#555;font-size:15px;margin:0 0 24px;">嗨 ${recipientName}！早安 ☕ 今天 PPBear 幫你找了 ${stocks.length} 檔值得關注的好股票，一起來看看吧～</p>

      <!-- AI 精選股票 -->
      <h2 style="margin:0 0 16px;font-size:17px;font-weight:900;color:#FF595E;border-left:4px solid #FF595E;padding-left:12px;">🤖 今日 AI 精選股票</h2>
      <div style="font-size:11px;color:#888;margin-bottom:12px;">篩選條件：月趨勢上漲 ✅ + AI 評分 ≥ 50 分</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#fef3f3;border-bottom:2px solid #ffcccc;">
            <th style="padding:10px 8px;text-align:left;color:#888;font-weight:600;">股票</th>
            <th style="padding:10px 8px;text-align:center;color:#888;font-weight:600;">評分</th>
            <th style="padding:10px 8px;text-align:right;color:#888;font-weight:600;">收盤</th>
            <th style="padding:10px 8px;text-align:center;color:#888;font-weight:600;">月趨勢</th>
          </tr>
        </thead>
        <tbody>${stocksHtml}</tbody>
      </table>

      ${aiSummary ? `
      <!-- AI 市場觀察 -->
      <div style="margin-top:20px;padding:16px;background:#fef9ec;border-radius:12px;border:1px solid #f59e0b;">
        <div style="font-size:13px;font-weight:800;color:#f59e0b;margin-bottom:8px;">💡 PPBear 市場觀察</div>
        <p style="margin:0;color:#6b5800;font-size:14px;line-height:1.6;">${aiSummary}</p>
      </div>
      ` : ''}

      <hr style="border:none;border-top:1px solid #f0f0f0;margin:28px 0;">

      <!-- 我的庫存 -->
      <h2 style="margin:0 0 16px;font-size:17px;font-weight:900;color:#3b82f6;border-left:4px solid #3b82f6;padding-left:12px;">💼 我的庫存概況</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#eff6ff;border-bottom:2px solid #bfdbfe;">
            <th style="padding:10px 8px;text-align:left;color:#888;font-weight:600;">股票</th>
            <th style="padding:10px 8px;text-align:center;color:#888;font-weight:600;">持股</th>
            <th style="padding:10px 8px;text-align:right;color:#888;font-weight:600;">損益</th>
          </tr>
        </thead>
        <tbody>${holdingsHtml}</tbody>
      </table>

      <!-- CTA Button -->
      <div style="text-align:center;margin-top:28px;">
        <a href="https://ppbears-investment.vercel.app"
           style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#FF924C,#FF595E);color:#fff;font-weight:900;font-size:15px;text-decoration:none;border-radius:50px;">
          📱 進入 PPBears 查看更多
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f9f9f9;padding:20px 24px;text-align:center;color:#aaa;font-size:12px;border-top:1px solid #eee;">
      <p style="margin:0 0 4px;">📧 PPBears Investment Premium 電子報</p>
      <p style="margin:0;">此郵件由系統自動寄送，資料僅供參考，非投資建議。</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// ─── 主要 Handler ─────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 安全驗證：確認是 Vercel Cron 發起的請求，或手動帶 secret 測試
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // ── Step 1: 讀取 newsletter_send_hour 設定 ──────────────────────────────
    const { data: settings } = await supabase
      .from('system_settings')
      .select('setting_key, setting_value');

    const settingsMap: Record<string, number> = {};
    (settings || []).forEach((row: { setting_key: string; setting_value: number }) => {
      settingsMap[row.setting_key] = Number(row.setting_value);
    });

    const newsletterHour = settingsMap['newsletter_send_hour'] ?? 7; // 預設早上 7 點

    // ── Step 2: 檢查現在是否為台灣時間的發送時段（UTC+8） ─────────────────────
    const nowUTC = new Date();
    const nowTW = new Date(nowUTC.getTime() + 8 * 60 * 60 * 1000);
    const twHour = nowTW.getUTCHours();
    
    // 取得是否有強制執行的 query parameter (?force=true)
    const isForce = req.query.force === 'true';

    if (twHour !== newsletterHour && !isForce) {
      return res.status(200).json({
        skipped: true,
        reason: `目前台灣時間 ${twHour}:xx，尚未到設定的 ${newsletterHour}:00 發送時段`,
      });
    }

    // ── Step 3: 抓取 Simons 量化選股資料 ─────────────────────────────────────
    const allStocks = await fetchLatestSimonsData();

    if (allStocks.length === 0) {
      return res.status(200).json({ error: '無法取得今日 Simons 資料' });
    }

    // ── Step 4: 篩選 — 月趨勢正（ret_m = rise）AND score >= 50 ───────────────
    const filtered: FilteredStock[] = allStocks
      .filter(s => s.ret_m === 'rise')
      .map(s => ({ ...s, score: calculateScore(s) }))
      .filter(s => s.score >= 50)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3); // 取前 3 名

    if (filtered.length === 0) {
      return res.status(200).json({ message: '今日無符合條件的精選股票，跳過發信' });
    }

    // ── Step 5: 生成 AI 摘要 ────────────────────────────────────────────────
    const aiSummary = await generateAISummary(filtered);

    // ── Step 6: 取得所有 Premium 用戶 ────────────────────────────────────────
    const { data: premiumUsers } = await supabase
      .from('users')
      .select('id, email, display_name')
      .eq('tier', 'premium');

    if (!premiumUsers || premiumUsers.length === 0) {
      return res.status(200).json({ message: '目前沒有 Premium 用戶，跳過發信' });
    }

    // ── Step 7: 逐一取得持股 + 發信 ─────────────────────────────────────────
    const todayDate = nowTW.toISOString().slice(0, 10);
    let sentCount = 0;
    const errors: string[] = [];

    for (const u of premiumUsers as UserRow[]) {
      try {
        // 取得該用戶持股
        const { data: holdingsData } = await supabase
          .from('holdings')
          .select('stock_code, stock_name, total_shares, avg_cost, current_price')
          .eq('user_id', u.id);

        const holdings: HoldingRow[] = (holdingsData || []).map((h: HoldingRow) => ({
          stock_code: h.stock_code,
          stock_name: h.stock_name,
          total_shares: Number(h.total_shares),
          avg_cost: Number(h.avg_cost),
          current_price: Number(h.current_price),
        }));

        const html = buildEmailHtml(u.display_name, filtered, aiSummary, holdings, todayDate);

        // 發送電子報
        const { error: sendError } = await resend.emails.send({
          from: 'PPBears Investment <newsletter@ppbears.com>',
          to: u.email,
          subject: `🐻 PPBears 每日電子報 ${todayDate} ｜${filtered.length} 檔精選股票`,
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
      filteredStocks: filtered.map(s => `${s.stkname}(${s.coid}) ${s.score}分`),
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (err) {
    console.error('cron-newsletter error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
