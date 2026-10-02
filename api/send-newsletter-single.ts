/**
 * PPBears Investment - 手動發送單一用戶電子報
 * 供管理後台「發電子報」按鈕呼叫
 * GET /api/send-newsletter-single?userId=xxx
 * Header: Authorization: Bearer <Supabase JWT>
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {supabase, fetchWeeklyNewsletterCandidates, userHasNewsletterFeature,
  sendNewsletterToUser, loadTodayCache, getNewsletterCacheDateTW} from '../src/server/newsletter-utils.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── 驗證：Supabase admin JWT 或 CRON_SECRET ──────────────────────────────
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '') || '';

  let isAuthorized = Boolean(process.env.CRON_SECRET) && token === process.env.CRON_SECRET;

  if (!isAuthorized && token) {
    try {
      const { data: { user: jwtUser } } = await supabase.auth.getUser(token);
      if (jwtUser) {
        const { data: userRow } = await supabase
          .from('users').select('is_admin').eq('id', jwtUser.id).single();
        isAuthorized = Boolean(userRow?.is_admin);
      }
    } catch {
      // auth check failed — stay unauthorized
    }
  }

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userId = req.query.userId as string;
  if (!userId) {
    return res.status(400).json({ error: '缺少 userId 參數' });
  }

  try {
    // ── 取得用戶資料 ─────────────────────────────────────────────────────────
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, display_name, tier, newsletter_strategy')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return res.status(404).json({ error: '找不到此用戶' });
    }

    const newsletterEnabled = await userHasNewsletterFeature(userId, userData.tier);
    if (!newsletterEnabled) {
      return res.status(200).json({ success: false, error: '此帳號的每日電子報已關閉' });
    }

    // ── 優先使用台灣時間 08:00 快取資料；無快取則即時抓取 ─────────────────────
    const todayDate = getNewsletterCacheDateTW();
    const cache = await loadTodayCache(todayDate);

    const allStocks = cache?.all_stocks?.length ? cache.all_stocks : await fetchWeeklyNewsletterCandidates();
    if (!allStocks.length) return res.status(200).json({success:false,error:'週榜候選資料尚未備妥'});
    const result = await sendNewsletterToUser(userData, allStocks, null, todayDate);
    if (!result.success) return res.status(200).json(result);
    return res.status(200).json({ success: true, message: `電子報已發送至 ${userData.email}` });

  } catch (err) {
    console.error('send-newsletter-single error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
