import fs from 'fs';

const openaiKey = process.env.VITE_OPENAI_API_KEY;

function calculateScore(item) {
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
  return Math.max(0, Math.min(100, score));
}

async function run() {
  console.log('Fetching getSimonsData...');
  let dateStr;
  let items = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    dateStr = d.toISOString().split('T')[0];
    const res = await fetch(`https://api.ifalgo.com.tw/frontapi/common/getSimonsData?searchDate=${dateStr}`);
    if (res.ok) {
        const json = await res.json();
        if (json.data?.dataItems?.length > 0) {
            items = json.data.dataItems;
            break;
        }
    }
  }

  const sortedStocks = items.map(s => ({ ...s, score: calculateScore(s) })).sort((a,b) => b.score - a.score).slice(0, 20);
  
  console.log('Fetching details for top stocks...');
  const promises = sortedStocks.map(async (s) => {
    try {
        const res = await fetch(`https://api.ifalgo.com.tw/frontapi/stock?coid=${s.coid}`);
        const json = await res.json();
        const comment = json.data?.stock?.aiQuanBackDataComment;
        if (comment) {
            const cumRetStr = comment.cum_ret || '';
            const cumRet = parseFloat(cumRetStr.replace('%', ''));
            const remark = comment.remark || '';
            if (cumRet > 0 && (remark.includes('中') || remark.includes('高') || remark.includes('強'))) {
                return { ...s, cum_ret: cumRetStr, remark };
            }
        }
    } catch(e) {}
    return null;
  });

  let filtered = (await Promise.all(promises)).filter(Boolean);
  filtered = filtered.sort((a, b) => b.score - a.score).slice(0, 3);

  console.log('Filtered stocks for AI:', filtered.map(s => s.stkname));

  const stocksData = filtered.map(s => ({
    coid: s.coid,
    stkname: s.stkname,
    close: s.close,
    remark: s.remark,
    cum_ret: s.cum_ret
  }));

  const prompt = `你是一位專業的台股分析師。請針對以下 ${filtered.length} 檔精選股票，綜合發揮撰寫解析。
嚴格依照 JSON 格式回傳，針對每一檔股票填寫：
{
  "results": [
    {
      "coid": "股票代號",
      "technical": "技術面：根據收盤價趨勢",
      "chips": "籌碼面：根據外資加權成本",
      "news": "消息面：根據 AI 推薦度與累積報酬",
      "advice": "最佳建議：具體行動"
    }
  ]
}

數據：
${JSON.stringify(stocksData)}`;

  console.log('Requesting OpenAI Analysis...');
  const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.7
    })
  });
  
  const gptJson = await gptRes.json();
  const content = gptJson.choices[0].message.content;
  const parsed = JSON.parse(content);

  parsed.results.forEach(r => {
      const target = filtered.find(x => x.coid === r.coid);
      if (target) {
          target.aiAnalysis = {
              technical: r.technical, chips: r.chips, news: r.news, advice: r.advice
          };
      }
  });

  const html = buildEmailHtml(filtered);
  fs.writeFileSync('email_preview.html', html);
  console.log('Saved to email_preview.html');
}

function buildEmailHtml(stocks) {
  const stocksHtml = stocks.map((s) => {
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
      <div style="padding:20px 24px;line-height:1.7;font-size:14px;color:#444;">
        <p style="margin-top:0;">📈 <strong>技術面：</strong> ${s.aiAnalysis?.technical || '-'}</p>
        <p>💰 <strong>籌碼面：</strong> ${s.aiAnalysis?.chips || '-'}</p>
        <p>📰 <strong>消息面：</strong> ${s.aiAnalysis?.news || '-'}</p>
      </div>
      <div style="padding:20px 24px;background:#fef9c3;border-top:1px solid #fde047;border-bottom-left-radius:12px;border-bottom-right-radius:12px;">
        <p style="margin:0;color:#854d0e;font-size:14.5px;line-height:1.6;">💡 <strong>最佳建議：</strong> ${s.aiAnalysis?.advice || '-'}</p>
      </div>
    </div>
  `}).join('');

  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#fff;padding:24px;">
    <h2 style="color:#FF595E;">🤖 今日 AI 精選股票 (預覽)</h2>
    <div>${stocksHtml}</div>
  </div>
</body>
</html>
  `;
}

run();
