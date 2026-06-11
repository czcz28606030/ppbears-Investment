/**
 * PPBears Investment - 每日電子報 Cron Function
 * 部署於 Vercel Serverless，每天由 vercel.json crons 喚醒。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  supabase, fetchLatestSimonsData, filterByAI,
  sendNewsletterToUser, loadTodayCache, getNewsletterCacheDateTW,
  userHasNewsletterFeature,
  type FilteredStock,
  type SimonsItem,
} from '../src/server/newsletter-utils.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // ── 抓取 Simons 資料 ─────────────────────────────────────────────────────
    // 優先使用 08:00 準備 cron 寫入的快取；若快取不存在才即時計算
    const todayDate = getNewsletterCacheDateTW();
    let allStocks: SimonsItem[];
    let aiFiltered: FilteredStock[] | null;

    const cache = await loadTodayCache(todayDate);
    if (cache && cache.all_stocks.length > 0) {
      console.log(`[cron-newsletter] 使用快取資料（${todayDate}），跳過 AI 篩選`);
      allStocks = cache.all_stocks;
      aiFiltered = cache.ai_filtered;
    } else {
      console.log('[cron-newsletter] 無快取，即時計算（時間可能較長）');
      allStocks = await fetchLatestSimonsData();
      if (allStocks.length === 0) {
        return res.status(200).json({ error: '無法取得 Simons 資料' });
      }
      aiFiltered = await filterByAI(allStocks);
    }

    // ── 取得所有用戶，逐一套用「每日電子報」開關（預設 Premium 開、Free 關）──
    const { data: users } = await supabase
      .from('users')
      .select('id, email, display_name, tier, newsletter_strategy');

    if (!users || users.length === 0) {
      return res.status(200).json({ message: '目前沒有用戶，跳過發信' });
    }

    let sentCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // ── 逐一發信 ─────────────────────────────────────────────────────────────
    for (const u of users) {
      const enabled = await userHasNewsletterFeature(u.id, u.tier);
      if (!enabled) {
        skippedCount++;
        continue;
      }
      await new Promise(resolve => setTimeout(resolve, 600)); // rate limit
      const result = await sendNewsletterToUser(u, allStocks, aiFiltered, todayDate);
      if (result.success) {
        sentCount++;
      } else {
        errors.push(`${u.email}: ${result.error}`);
      }
    }

    return res.status(200).json({
      success: true,
      sentCount,
      skippedCount,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (err) {
    console.error('cron-newsletter error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
