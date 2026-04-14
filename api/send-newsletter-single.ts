/**
 * PPBears Investment - 手動發送單一用戶電子報
 * 供管理後台「發電子報」按鈕呼叫
 * GET /api/send-newsletter-single?userId=xxx
 * Header: Authorization: Bearer <Supabase JWT>
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  supabase,
  fetchLatestSimonsData,
  filterByAI,
  filterByStrategy,
  generateStocksAnalysis,
  buildHoldingsWithSignals,
  buildEmailHtml,
  userHasAiFeature,
  STRATEGY_LABELS,
  resend,
} from './_newsletter-utils';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ── 驗證：Supabase admin JWT 或 CRON_SECRET ──────────────────────────────
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '') || '';

  let isAuthorized = token === process.env.CRON_SECRET;

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

    // ── 取得 Simons 資料 ──────────────────────────────────────────────────────
    const allStocks = await fetchLatestSimonsData();
    if (allStocks.length === 0) {
      return res.status(200).json({ success: false, error: '無法取得 Simons 資料' });
    }

    const nowTW = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const todayDate = nowTW.toISOString().slice(0, 10);

    // ── 依用戶功能決定篩選方式 ────────────────────────────────────────────────
    const hasAi = await userHasAiFeature(userId, userData.tier);
    const strategy = userData.newsletter_strategy as string | undefined;

    let stocks;
    let strategyLabel: string | undefined;

    if (hasAi || !strategy) {
      // AI 模式（呼叫 ifalgo 逐支篩選）
      stocks = await filterByAI(allStocks);
      if (stocks.length === 0) {
        return res.status(200).json({ success: false, error: '無符合 AI 條件的精選股票' });
      }
    } else {
      // 策略模式（直接從 Simons 資料篩選，不需外部 API）
      stocks = filterByStrategy(allStocks, strategy);
      strategyLabel = STRATEGY_LABELS[strategy];
      if (stocks.length === 0) {
        return res.status(200).json({ success: false, error: `策略 ${strategy} 無符合股票` });
      }
      // 為策略選股補上 AI 分析
      await generateStocksAnalysis(stocks);
    }

    // ── 取得庫存訊號 ──────────────────────────────────────────────────────────
    const allCoids = new Set(allStocks.map(s => s.coid));
    const holdings = await buildHoldingsWithSignals(userId, allCoids);

    // ── 發送電子報 ────────────────────────────────────────────────────────────
    const html = buildEmailHtml(userData.display_name, stocks, holdings, todayDate, strategyLabel);
    const subjectStrategy = strategyLabel ? `${strategyLabel} 策略` : 'AI 精選';

    const { error: sendError } = await resend.emails.send({
      from: 'PPBears Investment <newsletter@investment.ppbears.com>',
      to: userData.email,
      subject: `🐻 PPBears 電子報 ${todayDate} ｜${subjectStrategy} ${stocks.length} 檔`,
      html,
    });

    if (sendError) {
      return res.status(200).json({ success: false, error: sendError.message });
    }

    return res.status(200).json({ success: true, message: `電子報已發送至 ${userData.email}` });

  } catch (err) {
    console.error('send-newsletter-single error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
