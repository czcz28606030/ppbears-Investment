/**
 * PPBears Investment - 手動發送單一用戶電子報
 * 供管理後台「發電子報」按鈕呼叫
 * POST /api/send-newsletter-single?userId=xxx
 * Header: Authorization: Bearer <CRON_SECRET>
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  supabase, fetchLatestSimonsData, filterByAI,
  sendNewsletterToUser,
} from './_newsletter-utils';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 驗證：接受 CRON_SECRET 或 Supabase admin JWT
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '') || '';

  let isAuthorized = token === process.env.CRON_SECRET;

  if (!isAuthorized && token) {
    // 驗證 Supabase JWT，確認是管理員
    const { data: { user: jwtUser } } = await supabase.auth.getUser(token);
    if (jwtUser) {
      const { data: userRow } = await supabase
        .from('users')
        .select('is_admin')
        .eq('id', jwtUser.id)
        .single();
      isAuthorized = Boolean(userRow?.is_admin);
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
    // 取得用戶資料
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, display_name, tier, newsletter_strategy')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return res.status(404).json({ error: '找不到此用戶' });
    }

    // 取得 Simons 資料
    const allStocks = await fetchLatestSimonsData();
    if (allStocks.length === 0) {
      return res.status(200).json({ error: '無法取得 Simons 資料' });
    }

    // 預先跑 AI 篩選（若用戶有 AI 功能才需要）
    const aiFiltered = await filterByAI(allStocks);

    const nowTW = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const todayDate = nowTW.toISOString().slice(0, 10);

    const result = await sendNewsletterToUser(
      userData,
      allStocks,
      aiFiltered,
      todayDate
    );

    if (result.success) {
      return res.status(200).json({ success: true, message: `電子報已發送至 ${userData.email}` });
    } else {
      return res.status(200).json({ success: false, error: result.error });
    }

  } catch (err) {
    console.error('send-newsletter-single error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
