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
 * Cron 時間：台灣時間 08:00 檢查 Simons 是否完成上一個交易日資料；使用者可在頁面手動重新抓取。
 * vercel.json 設定：
 *   { "path": "/api/backtest-daily-collect", "schedule": "0 21,22,23,0,1 * * *" }
 */

const IFALGO_BASE = 'https://api.ifalgo.com.tw/frontapi';
const DELAY_MS = 500;

export const config = {
  maxDuration: 300,
};

type TargetStock = {
  coid: string;
  stkname?: string | null;
};

type TradingSignal = {
  out_date?: unknown;
  in_date?: unknown;
  sell_sig?: unknown;
};

const BUY_SIGNAL_TEXTS = new Set(['進場', '加碼', '買進', 'buy', 'Buy', 'BUY']);
const SELL_SIGNAL_TEXTS = new Set(['出場', '賣出', '減碼', 'sell', 'Sell', 'SELL']);

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

function getLatestCompletedTradingDateTW(now = Date.now()): string {
  const tw = new Date(now + 8 * 60 * 60 * 1000);
  tw.setUTCHours(0, 0, 0, 0);
  tw.setUTCDate(tw.getUTCDate() - 1);
  while (tw.getUTCDay() === 0 || tw.getUTCDay() === 6) {
    tw.setUTCDate(tw.getUTCDate() - 1);
  }
  return tw.toISOString().slice(0, 10);
}

function normalizeSimonsDate(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw.slice(0, 10).replace(/\//g, '-');
}

function normalizeSignalText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeSignalDate(value: unknown): string {
  const raw = normalizeSignalText(value).replace(/\//g, '-');
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return raw;
}

function daysAgoTW(days: number): string {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
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
  supabase: any,
  todayStr: string
): Promise<{ coids: string[]; count: number }> {
  const dateStr = todayStr;

  try {
    const res = await fetchWithTimeout(
      `${IFALGO_BASE}/common/getSimonsData?searchDate=${dateStr}`
    );
    if (!res.ok) return { coids: [], count: 0 };
    const json = await res.json() as { data?: { dataItems?: Record<string, unknown>[] } };
    const items = json?.data?.dataItems || [];
    if (items.length === 0) return { coids: [], count: 0 };
    const dataDate = normalizeSimonsDate(items[0]?.mdate);
    if (dataDate !== dateStr) return { coids: [], count: 0 };

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

    return { coids: rows.map(r => r.coid), count: rows.length };
  } catch {
    return { coids: [], count: 0 };
  }
}

// ── Step 2：補充量化指標（AI 推薦等級/累積報酬/籌碼穩定度）─────────────────

async function enrichQuantData(
  supabase: any,
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
  supabase: any,
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
  supabase: any,
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

// ── Step 5：收集觀察/庫存股票每日籌碼穩定度快照 ─────────────────────────────

function addSnapshotTarget(map: Map<string, TargetStock>, coid: unknown, stkname?: unknown) {
  const code = String(coid || '').trim();
  if (!/^\d{4,6}$/.test(code)) return;
  const existing = map.get(code);
  if (existing?.stkname) return;
  map.set(code, { coid: code, stkname: stkname ? String(stkname) : existing?.stkname ?? null });
}

async function fetchLatestSimonsSnapshotTargets(): Promise<TargetStock[]> {
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000);
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const dateStr = d.toISOString().slice(0, 10);
    try {
      const response = await fetchWithTimeout(`${IFALGO_BASE}/common/getSimonsData?searchDate=${dateStr}`);
      if (!response.ok) continue;
      const json = await response.json() as { data?: { dataItems?: Record<string, unknown>[] } };
      const items = json?.data?.dataItems || [];
      if (items.length > 0) {
        return items.map(item => ({
          coid: String(item.coid),
          stkname: item.stkname ? String(item.stkname) : null,
        }));
      }
    } catch {
      // Try the previous trading day.
    }
  }
  return [];
}

async function collectStockQuantTargets(supabase: any, preferredCoids: string[]): Promise<TargetStock[]> {
  const targets = new Map<string, TargetStock>();
  for (const coid of preferredCoids) addSnapshotTarget(targets, coid);

  const [holdingsResult, watchlistResult, recentResult, simonsTargets] = await Promise.all([
    supabase.from('holdings').select('stock_code,stock_name').limit(500),
    supabase.from('watchlist').select('stock_code,stock_name').limit(500),
    supabase
      .from('stock_quant_daily_snapshots')
      .select('coid,stkname')
      .gte('snapshot_date', daysAgoTW(70))
      .limit(500),
    fetchLatestSimonsSnapshotTargets(),
  ]);

  for (const row of holdingsResult.data || []) addSnapshotTarget(targets, row.stock_code, row.stock_name);
  for (const row of watchlistResult.data || []) addSnapshotTarget(targets, row.stock_code, row.stock_name);
  if (!recentResult.error) {
    for (const row of recentResult.data || []) addSnapshotTarget(targets, row.coid, row.stkname);
  }
  for (const stock of simonsTargets) addSnapshotTarget(targets, stock.coid, stock.stkname);

  return [...targets.values()].slice(0, 180);
}

function getCurrentQuantSignal(tradingList: TradingSignal[], dataDate: string): 'buy' | 'sell' | 'neutral' {
  if (!Array.isArray(tradingList) || tradingList.length === 0) return 'neutral';
  const targetDate = normalizeSignalDate(dataDate);
  if (!targetDate) return 'neutral';

  let hasBuyEvent = false;
  let hasSellEvent = false;

  for (const item of tradingList) {
    const inDate = normalizeSignalDate(item?.in_date);
    const outDate = normalizeSignalDate(item?.out_date);
    const sig = normalizeSignalText(item?.sell_sig);

    if (BUY_SIGNAL_TEXTS.has(sig) && inDate === targetDate) hasBuyEvent = true;
    if (SELL_SIGNAL_TEXTS.has(sig) && (outDate || inDate) === targetDate) hasSellEvent = true;
  }

  if (hasSellEvent) return 'sell';
  if (hasBuyEvent) return 'buy';
  return 'neutral';
}

async function fetchStockQuantSnapshotRow(target: TargetStock) {
  const response = await fetchWithTimeout(`${IFALGO_BASE}/stock?coid=${encodeURIComponent(target.coid)}`);
  if (!response.ok) return null;
  const json = await response.json() as {
    data?: {
      stock?: {
        stkname?: unknown;
        aiQuanBackDataComment?: { remark?: unknown; cum_ret?: unknown; freq?: unknown };
        aiQuanBackDataTradingList?: TradingSignal[];
        position?: {
          stkname?: unknown;
          chipStability?: { mdate?: unknown; pts?: unknown };
          stockInfo?: { gvi?: unknown; mediangvi?: unknown };
        };
      };
    };
  };
  const stock = json?.data?.stock;
  const position = stock?.position;
  const chipPts = parseNumericOrNull(position?.chipStability?.pts);
  if (chipPts === null) return null;

  const snapshotDate = String(position?.chipStability?.mdate || getTodayTW());

  return {
    snapshot_date: snapshotDate,
    coid: target.coid,
    stkname: String(position?.stkname || target.stkname || stock?.stkname || target.coid),
    chip_pts: chipPts,
    ai_remark: stock?.aiQuanBackDataComment?.remark ? String(stock.aiQuanBackDataComment.remark) : null,
    ai_cum_ret: stock?.aiQuanBackDataComment?.cum_ret ? String(stock.aiQuanBackDataComment.cum_ret) : null,
    ai_freq: parseNumericOrNull(stock?.aiQuanBackDataComment?.freq),
    gvi: parseNumericOrNull(position?.stockInfo?.gvi),
    mediangvi: parseNumericOrNull(position?.stockInfo?.mediangvi),
    current_signal: getCurrentQuantSignal(stock?.aiQuanBackDataTradingList || [], snapshotDate),
    source: 'ifalgo-stock',
    collected_at: new Date().toISOString(),
  };
}

async function collectStockQuantSnapshots(
  supabase: any,
  preferredCoids: string[],
): Promise<{ targetCount: number; collected: number; failures: string[]; error?: string }> {
  const targets = await collectStockQuantTargets(supabase, preferredCoids);
  const rows = [];
  const failures: string[] = [];

  for (const target of targets) {
    try {
      const row = await fetchStockQuantSnapshotRow(target);
      if (row) rows.push(row);
    } catch (error) {
      failures.push(`${target.coid}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(DELAY_MS);
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('stock_quant_daily_snapshots')
      .upsert(rows, { onConflict: 'snapshot_date,coid', ignoreDuplicates: false });
    if (error) return { targetCount: targets.length, collected: rows.length, failures, error: error.message };
  }

  return { targetCount: targets.length, collected: rows.length, failures };
}

async function hasCompletedQuantSnapshots(supabase: any, dateStr: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('stock_quant_daily_snapshots')
    .select('coid', { count: 'exact', head: true })
    .eq('snapshot_date', dateStr);
  return !error && Number(count || 0) >= 20;
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
  const targetDate = getLatestCompletedTradingDateTW();
  const log: string[] = [`[${todayStr}] 檢查 Simons 最新完整交易日 ${targetDate}`];

  try {
    if (await hasCompletedQuantSnapshots(supabase, targetDate)) {
      log.push('今日 AI 訊號快取已完成，略過重複抓取');
      return res.status(200).json({ success: true, date: todayStr, targetDate, skipped: true, log });
    }

    // Step 1：當日 Simons 推薦清單
    const { coids, count } = await collectTodaySimons(supabase, targetDate);
    log.push(`Step1 Simons: ${count} 支`);

    if (coids.length === 0) {
      log.push('Simons 尚未整理完成，保留既有快取');
      return res.status(200).json({ success: true, date: todayStr, targetDate, status: 'waiting-simons', log });
    }

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

    const quantSnapshots = await collectStockQuantSnapshots(supabase, coids);
    log.push(`Step5 籌碼穩定度快照: ${quantSnapshots.collected}/${quantSnapshots.targetCount} 支`);
    if (quantSnapshots.error) log.push(`Step5 寫入提醒: ${quantSnapshots.error}`);
    if (quantSnapshots.failures.length > 0) log.push(`Step5 抓取失敗: ${quantSnapshots.failures.slice(0, 5).join('；')}`);

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
