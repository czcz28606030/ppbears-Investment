/**
 * PPBears Investment - 電子報資料預備 Cron（每天 06:00 台灣時間）
 * UTC schedule: 0 22 * * *（前一天 22:00 UTC = 當天 06:00 台灣）
 *
 * 負責耗時的部分：
 *   1. 抓取 Simons 當日選股資料
 *   2. AI 篩選（呼叫 ifalgo 逐支評分）
 *   3. OpenAI 多面向分析
 * 完成後寫入 newsletter_daily_cache，供 07:00 的發信 cron 直接讀取。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  fetchLatestSimonsData,
  filterByAI,
  generateStocksAnalysis,
  saveTodayCache,
  getTodayTW,
} from './_newsletter-utils.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── 授權驗證 ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const todayDate = getTodayTW();

  try {
    // ── 1. 取得 Simons 資料 ───────────────────────────────────────────────
    const allStocks = await fetchLatestSimonsData();
    if (allStocks.length === 0) {
      return res.status(200).json({ success: false, error: '無法取得 Simons 資料' });
    }

    // ── 2. AI 篩選（ifalgo 逐支查詢 + Yahoo News）────────────────────────
    const aiFiltered = await filterByAI(allStocks);

    // ── 3. OpenAI 多面向分析（補上 aiAnalysis 欄位）──────────────────────
    if (aiFiltered.length > 0) {
      await generateStocksAnalysis(aiFiltered);
    }

    // ── 4. 寫入快取 ───────────────────────────────────────────────────────
    await saveTodayCache({
      cache_date: todayDate,
      all_stocks: allStocks,
      ai_filtered: aiFiltered,
    });

    return res.status(200).json({
      success: true,
      message: `電子報資料已備妥（${todayDate}）`,
      stockCount: allStocks.length,
      aiFilteredCount: aiFiltered.length,
    });

  } catch (err) {
    console.error('cron-newsletter-prepare error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
