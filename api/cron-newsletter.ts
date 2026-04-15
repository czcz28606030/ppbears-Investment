/**
 * PPBears Investment - 每日電子報 Cron Function
 * 部署於 Vercel Serverless，每天由 vercel.json crons 喚醒。
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  supabase, fetchLatestSimonsData, filterByAI,
  sendNewsletterToUser, loadTodayCache, getTodayTW,
} from './_newsletter-utils.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // ── 時段檢查 ────────────────────────────────────────────────────────────
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

    // ── 抓取 Simons 資料 ─────────────────────────────────────────────────────
    // 優先使用 6AM 準備 cron 寫入的快取；若快取不存在才即時計算
    const todayDate = getTodayTW();
    let allStocks;
    let aiFiltered;

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

    // ── 取得所有 Premium 用戶（含 newsletter_strategy）──────────────────────
    const { data: premiumUsers } = await supabase
      .from('users')
      .select('id, email, display_name, tier, newsletter_strategy')
      .eq('tier', 'premium');

    if (!premiumUsers || premiumUsers.length === 0) {
      return res.status(200).json({ message: '目前沒有 Premium 用戶，跳過發信' });
    }

    let sentCount = 0;
    const errors: string[] = [];

    // ── 逐一發信 ─────────────────────────────────────────────────────────────
    for (const u of premiumUsers) {
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
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (err) {
    console.error('cron-newsletter error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
