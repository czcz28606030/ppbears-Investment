/**
 * 產生電子報 HTML 預覽檔
 * 執行方式：node generate-preview.mjs
 * 輸出：email_preview.html（直接用瀏覽器開啟即可）
 */

import { writeFileSync } from 'fs';

// ── 模擬資料 ──────────────────────────────────────────────────────────────────

const todayDate = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

const mockStocks = [
  {
    coid: '2330',
    stkname: '台積電',
    close: '950.00',
    cum_ret: '週漲',
    remark: '高度推薦',
    score: 88,
    aiAnalysis: {
      technical: '收盤價 950 元，站上所有均線，MACD 黃金交叉，短線動能強勁。',
      chips: '外資連續 5 日買超，主力成本約 920 元，籌碼集中度高。',
      news: '法說會釋出正面展望，AI 晶片需求強勁，CoWoS 產能持續擴充。',
      advice: '建議逢低布局，短線目標 980 元，跌破 920 元可考慮停損。',
    },
  },
  {
    coid: '2454',
    stkname: '聯發科',
    close: '1180.00',
    cum_ret: '月漲',
    remark: '中度推薦',
    score: 72,
    aiAnalysis: {
      technical: '月線持續向上，RSI 約 58，尚未超買，仍有上攻空間。',
      chips: '投信近期持續加碼，外資偏中立，散戶持股降低為正面訊號。',
      news: 'Dimensity 9400 銷售表現超預期，AI 手機滲透率提升帶動需求。',
      advice: '可在 1150 元附近分批進場，目標 1250 元，停損設於 1100 元。',
    },
  },
  {
    coid: '1815',
    stkname: '富喬',
    close: '113.00',
    cum_ret: '週漲',
    remark: '超高推薦',
    score: 95,
    aiAnalysis: {
      technical: '突破前高壓力區，成交量放大，強勢排列確立。',
      chips: '主力成本約 95 元，目前獲利豐富，持續持有意願高。',
      news: 'AI 伺服器散熱需求帶動銅箔基板訂單，Q2 營收看增。',
      advice: '強勢股可持續持有，建議追蹤 120 元是否能有效突破。',
    },
  },
  {
    coid: '2382',
    stkname: '廣達',
    close: '285.00',
    cum_ret: '週漲',
    remark: '高度推薦',
    score: 85,
    aiAnalysis: {
      technical: '週線連續 3 根紅 K，突破季線壓力，量能配合良好。',
      chips: '外資近兩週大幅買超，持股比例來到歷史高點。',
      news: 'AI 伺服器出貨量創新高，與 NVIDIA 合作深化，市場預期 Q2 營收大增。',
      advice: '可積極布局，目標 310 元，若跌破 270 元需重新評估。',
    },
  },
  {
    coid: '3711',
    stkname: '日月光投控',
    close: '168.00',
    cum_ret: '月漲',
    remark: '中度推薦',
    score: 68,
    aiAnalysis: {
      technical: 'KD 指標低檔黃金交叉，底部型態確立，有反彈機會。',
      chips: '近期融資減少、融券增加，空方回補可能帶動反彈。',
      news: 'AI 封裝需求強勁，CoWoS 與 SoIC 訂單能見度高達 2026 年。',
      advice: '165 元附近可試單，目標 180 元，停損 158 元。',
    },
  },
];

const mockHoldings = [
  {
    stock_code: '2330',
    stock_name: '台積電',
    total_shares: 2000,
    avg_cost: 880,
    current_price: 950,
    signal: '加碼',
  },
  {
    stock_code: '3008',
    stock_name: '大立光',
    total_shares: 500,
    avg_cost: 2400,
    current_price: 2250,
    signal: '中立',
  },
  {
    stock_code: '2317',
    stock_name: '鴻海',
    total_shares: 10000,
    avg_cost: 110,
    current_price: 105,
    signal: '出場',
  },
];

// ── 複製自 _newsletter-utils.ts 的 buildEmailHtml（獨立版本）────────────────

function buildEmailHtml(recipientName, stocks, holdings, todayDate, strategyLabel) {
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

  const getSignalStyle = (sig) => {
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

// ── 產生並寫入檔案 ─────────────────────────────────────────────────────────────

const html = buildEmailHtml('熊爸爸', mockStocks, mockHoldings, todayDate);
writeFileSync('email_preview.html', html, 'utf-8');
console.log(`✅ email_preview.html 已更新（${todayDate}）`);
console.log('📂 直接用瀏覽器開啟 email_preview.html 即可預覽');
