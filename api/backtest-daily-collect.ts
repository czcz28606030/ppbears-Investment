import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * PPBears Investment — 回測系統：每日自動收集 Cron
 *
 * 功能：
 *  1. 收集當日 Simons 推薦清單快照（含 PSR、strength、GVI 等）
 *  2. 針對當日推薦股票，補充抓取量化指標（AI 推薦等級、累積報酬、籌碼穩定度）
 *  3. 更新各股票最新的 AI 進出場訊號
 *  4. 收集當日個股收盤 K 線
 *
 * Cron 時間：UTC 15:00（台灣時間 23:00），每個交易日
 * vercel.json 設定：
 *   { "path": "/api/backtest-daily-collect", "schedule": "0 15 * * 1-5" }
 */

const IFALGO_BASE = 'https://api.ifalgo.com.tw/frontapi';
const DELAY_MS = 500;

export const config = {
  maxDuration: 300,
};

// ── 工具函式 ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, ms = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 台灣今日日期字串 */
function getTodayTW(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseNumericOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === 'NA' || val === '') return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}

function parseReturnPct(returnStr: unknown): number | null {
  if (!returnStr || returnStr === 'NA') return null;
  const s = String(returnStr).replace('%', '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n / 100;
}

function calculateFreeScore(item: Record<string, unknown>): number {
  const psr = Number(item.psr) || 0;
  const strength = parseFloat(String(item.strength)) || 0;
  const close = parseFloat(String(item.close)) || 0;
  const wtcost = parseFloat(String(item.wtcost)) || 0;
  const fcost = parseFloat(String(item.fcost)) || 0;
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
  const unusual = String(item.unusual || '');
  if (unusual && unusual !== 'N' &&
      (unusual.includes('紅K') || unusual.includes('上影線'))) score += 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateSimonsScore(
  item: Record<string, unknown>,
  remark: string | null,
  chipPts: number | null
): number | null {
  if (!remark) return null;
  let score = 50;
  if (remark.includes('超高')) score += 30;
  else if (remark.includes('高度')) score += 22;
  else if (remark.includes('中度')) score += 12;
  else if (remark.includes('低度')) score += 2;
  const psr = Number(item.psr) || 0;
  score += Math.max(-15, Math.min(20, (psr - 5) * 2));
  const strength = parseFloat(String(item.strength)) || 0;
  if (strength > 2.5) score += 15;
  else if (strength > 2.0) score += 12;
  else if (strength > 1.5) score += 8;
  else if (strength > 1.0) score += 3;
  else if (strength < 0.5) score -= 12;
  const gvi = Number(item.gvi) || 0;
  const mediangvi = parseNumericOrNull(item.mediangvi) || 0;
  if (gvi > mediangvi * 1.2) score += 12;
  else if (gvi > mediangvi) score += 6;
  else if (mediangvi > 0 && gvi < mediangvi * 0.8) score -= 10;
  if (chipPts !== null) {
    if (chipPts >= 8) score += 10;
    else if (chipPts >= 6) score += 6;
    else if (chipPts >= 4) score += 2;
    else if (chipPts < 2) score -= 8;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Step 1：收集當日 Simons 推薦清單 ─────────────────────────────────────────

async function collectTodaySimons(
  supabase: ReturnType<typeof createClient>,
  todayStr: string
): Promise<{ coids: string[]; count: number }> {
  const log: string[] = [];

  // 嘗試今天，若無資料嘗試昨天（盤後可能延遲）
  for (let delta = 0; delta <= 2; delta++) {
    const d = new Date(todayStr);
    d.setDate(d.getDate() - delta);
    const day = d.getDay();
    if (day === 0 || day === 6) continue;
    const dateStr = d.toISOString().split('T')[0];

    try {
      const res = await fetchWithTimeout(
        `${IFALGO_BASE}/common/getSimonsData?searchDate=${dateStr}`
      );
      if (!res.ok) continue;
      const json = await res.json() as { data?: { dataItems?: Record<string, unknown>[] } };
      const items = json?.data?.dataItems || [];
      if (items.length === 0) continue;

      const rows = items.map(item => ({
        snapshot_date: dateStr,
        coid: item.coid as string,
        stkname: item.stkname as string,
        close: parseNumericOrNull(item.close) || 0,
        strength: parseNumericOrNull(item.strength),
        psr: item.psr != null ? parseFloat(String(item.psr)) : null,
        ret_w: item.ret_w as string || null,
        ret_m: item.ret_m as string || null,
        wtcost: parseNumericOrNull(item.wtcost),
        fcost: parseNumericOrNull(item.fcost),
        tcost: parseNumericOrNull(item.tcost),
        dcost: parseNumericOrNull(item.dcost),
        gvi: item.gvi != null ? parseFloat(String(item.gvi)) : null,
        mediangvi: parseNumericOrNull(item.mediangvi),
        unusual: item.unusual as string || null,
        category: item.category as string || null,
        subindustry: item.subindustry as string || null,
        status: item.status as string || null,
        value: item.value as string || null,
        free_score: calculateFreeScore(item),
      }));

      await supabase
        .from('simons_daily_snapshots')
        .upsert(rows, { onConflict: 'snapshot_date,coid', ignoreDuplicates: true });

      log.push(`Simons ${dateStr}: ${rows.length} 支`);
      return { coids: rows.map(r => r.coid), count: rows.length };
    } catch (e) {
      log.push(`Simons ${dateStr} error: ${String(e)}`);
    }
  }

  return { coids: [], count: 0 };
}

// ── Step 2：補充量化指標（AI 推薦等級/累積報酬/籌碼穩定度）─────────────────

async function enrichQuantData(
  supabase: ReturnType<typeof createClient>,
  coids: string[],
  dateStr: string
): Promise<void> {
  for (const coid of coids) {
    try {
      const res = await fetchWithTimeout(`${IFALGO_BASE}/stock?coid=${coid}`);
      if (!res.ok) continue;
      const json = await res.json() as {
        data?: {
          stock?: {
            aiQuanBackDataComment?: { remark?: string; cum_ret?: string; freq?: number };
            position?: { chipStability?: { pts?: string } };
          };
        };
      };

      const stock = json?.data?.stock;
      const comment = stock?.aiQuanBackDataComment;
      const chip = stock?.position?.chipStability;

      if (!comment && !chip) { await sleep(DELAY_MS); continue; }

      const aiRemark = comment?.remark || null;
      const aiCumRet = comment?.cum_ret || null;
      const chipPts = chip?.pts ? parseNumericOrNull(chip.pts) : null;

      // 讀取已存的 simons_daily_snapshots 行（需要計算 simons_score）
      const { data: existing } = await supabase
        .from('simons_daily_snapshots')
        .select('*')
        .eq('snapshot_date', dateStr)
        .eq('coid', coid)
        .maybeSingle();

      const simonsScore = existing
        ? calculateSimonsScore(existing as Record<string, unknown>, aiRemark, chipPts)
        : null;

      await supabase
        .from('simons_daily_snapshots')
        .update({
          ai_remark: aiRemark,
          ai_cum_ret: aiCumRet,
          ai_freq: comment?.freq ?? null,
          chip_pts: chipPts,
          simons_score: simonsScore,
        })
        .eq('snapshot_date', dateStr)
        .eq('coid', coid);

    } catch (_) { /* 忽略單一股票的錯誤 */ }

    await sleep(DELAY_MS);
  }
}

// ── Step 3：更新各股票最新 AI 進出場訊號 ────────────────────────────────────

async function updateTradingSignals(
  supabase: ReturnType<typeof createClient>,
  coids: string[]
): Promise<void> {
  for (const coid of coids) {
    try {
      const res = await fetchWithTimeout(`${IFALGO_BASE}/stock?coid=${coid}`);
      if (!res.ok) continue;
      const json = await res.json() as {
        data?: {
          stock?: {
            aiQuanBackDataTradingList?: Record<string, unknown>[];
            position?: { stkname?: string };
          };
        };
      };

      const stock = json?.data?.stock;
      const tradingList = stock?.aiQuanBackDataTradingList || [];
      const stkname = stock?.position?.stkname || coid;

      if (tradingList.length === 0) { await sleep(DELAY_MS); continue; }

      const rows = tradingList
        .filter((t): t is Record<string, unknown> => !!t['in_date'] && !!t['out_date'])
        .map(t => ({
          coid,
          stkname: String(t['stkname'] || stkname),
          in_date: t['in_date'] as string,
          buy_close: parseNumericOrNull(t['buy_close']),
          out_date: t['out_date'] as string,
          sell_close: parseNumericOrNull(t['sell_close']),
          sell_sig: String(t['sell_sig'] || '中立'),
          return_pct: parseReturnPct(t['return']),
          gvi_in: parseNumericOrNull(t['gvi_df1']),
          gvi_out: parseNumericOrNull(t['gvi']),
          hold_days: t['in_date'] && t['out_date']
            ? Math.round(
                (new Date(t['out_date'] as string).getTime() -
                 new Date(t['in_date'] as string).getTime()) / 86400000
              )
            : null,
        }));

      await supabase
        .from('ai_trading_signals')
        .upsert(rows, { onConflict: 'coid,in_date,out_date', ignoreDuplicates: false });

    } catch (_) { /* 忽略單一股票的錯誤 */ }

    await sleep(DELAY_MS);
  }
}

// ── Step 4：收集當日個股 K 線 ────────────────────────────────────────────────

async function collectTodayPrices(
  supabase: ReturnType<typeof createClient>,
  coids: string[]
): Promise<void> {
  for (const coid of coids) {
    try {
      const res = await fetchWithTimeout(`${IFALGO_BASE}/stock?coid=${coid}`);
      if (!res.ok) continue;
      const json = await res.json() as {
        data?: { stock?: { position?: { prices?: Record<string, unknown>[] } } };
      };
      const prices = json?.data?.stock?.position?.prices || [];
      // 只取最後 5 筆（當日附近，避免重複寫入大量歷史）
      const recent = prices.slice(-5).map(p => ({
        coid,
        mdate: p['mdate'] as string,
        open_d: parseNumericOrNull(p['open_d']),
        high_d: parseNumericOrNull(p['high_d']),
        low_d: parseNumericOrNull(p['low_d']),
        close_d: parseNumericOrNull(p['close_d']),
        volume: p['volume'] ? parseInt(String(p['volume'])) : null,
        pe_ratio: parseNumericOrNull(p['pe_ratio']),
        pb_ratio: parseNumericOrNull(p['pb_ratio']),
        roia: parseNumericOrNull(p['roia']),
      })).filter(r => r.close_d !== null);

      if (recent.length > 0) {
        await supabase
          .from('stock_price_history')
          .upsert(recent, { onConflict: 'coid,mdate', ignoreDuplicates: true });
      }
    } catch (_) { /* 忽略 */ }

    await sleep(DELAY_MS);
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 安全驗證：只允許 Cron 或帶正確 Secret 的請求
  const authHeader = req.headers['authorization'] || '';
  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret && !authHeader.includes(cronSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const todayStr = getTodayTW();
  const log: string[] = [`[${todayStr}] 開始每日回測數據收集`];

  try {
    // Step 1：當日 Simons 推薦清單
    const { coids, count } = await collectTodaySimons(supabase, todayStr);
    log.push(`Step1 Simons: ${count} 支`);

    if (coids.length > 0) {
      // Step 2：量化指標補充
      await enrichQuantData(supabase, coids, todayStr);
      log.push(`Step2 量化指標: ${coids.length} 支`);

      // Step 3：更新 AI 進出場訊號
      await updateTradingSignals(supabase, coids);
      log.push(`Step3 AI 訊號: ${coids.length} 支`);

      // Step 4：當日 K 線
      await collectTodayPrices(supabase, coids);
      log.push(`Step4 K 線: ${coids.length} 支`);
    }

    log.push('✅ 所有步驟完成');
    console.log(log.join('\n'));
    return res.status(200).json({ success: true, date: todayStr, log });
  } catch (e) {
    const errMsg = String(e);
    log.push(`❌ 錯誤: ${errMsg}`);
    console.error(log.join('\n'));
    return res.status(500).json({ success: false, error: errMsg, log });
  }
}
