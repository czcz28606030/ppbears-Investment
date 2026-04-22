/**
 * PPBears Investment — 回測系統：一次性歷史數據爬取腳本
 *
 * 功能：
 *  1. 爬取熱門/觀察清單股票的 aiQuanBackDataTradingList（AI 進出場歷史）
 *  2. 爬取個股 5.5 年 K 線歷史（prices[]）
 *  3. 爬取 Simons 推薦清單歷史（2025-09 起，補充量化指標）
 *  4. 將所有數據寫入 Supabase
 *
 * 使用方式：
 *  node api/backtest-init.mjs
 *  node api/backtest-init.mjs --signals-only
 *  node api/backtest-init.mjs --prices-only
 *  node api/backtest-init.mjs --simons-only
 *
 * 注意：首次執行約需 30~60 分鐘（需對每支股票呼叫 API）
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 手動讀取 .env.local（不需要 dotenv 套件）
try {
  const envPath = resolve(process.cwd(), '.env.local');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch (e) {
  console.warn('⚠️ 無法讀取 .env.local，請確認檔案存在:', e.message);
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ 請在 .env.local 設定 VITE_SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️  使用 ANON KEY （建議在 Vercel 環境用 SERVICE_ROLE_KEY）');
}

const supabase = createClient(supabaseUrl, supabaseKey);


const IFALGO_BASE = 'https://api.ifalgo.com.tw/frontapi';
const DELAY_MS = 600; // API 呼叫間隔，防 rate limit

// ── 爬取所有股票的股票清單（從 Simons 歷史數據取得）──────────────────────────

/** 取出所有我們需要爬取的股票代碼清單 */
async function getAllTargetStocks() {
  // 從 Simons 推薦清單取得所有曾上榜的股票
  const { data } = await supabase
    .from('simons_daily_snapshots')
    .select('coid, stkname')
    .order('coid');

  const map = new Map();
  (data || []).forEach(r => map.set(r.coid, r.stkname));

  // 補充熱門股票（確保這些一定被收集）
  const POPULAR = [
    { coid: '2330', stkname: '台積電' }, { coid: '2317', stkname: '鴻海' },
    { coid: '2454', stkname: '聯發科' }, { coid: '2412', stkname: '中華電' },
    { coid: '2881', stkname: '富邦金' }, { coid: '2882', stkname: '國泰金' },
    { coid: '2303', stkname: '聯電' },   { coid: '3711', stkname: '日月光' },
    { coid: '2308', stkname: '台達電' }, { coid: '2383', stkname: '台光電' },
    { coid: '1301', stkname: '台塑' },   { coid: '2002', stkname: '中鋼' },
    { coid: '2886', stkname: '兆豐金' }, { coid: '2891', stkname: '中信金' },
    { coid: '2884', stkname: '玉山金' }, { coid: '2885', stkname: '元大金' },
    { coid: '2890', stkname: '永豐金' }, { coid: '2892', stkname: '第一金' },
    { coid: '2880', stkname: '華南金' }, { coid: '5880', stkname: '合庫金' },
    { coid: '2887', stkname: '台新金' }, { coid: '2888', stkname: '新光金' },
    { coid: '3034', stkname: '聯詠' },   { coid: '2379', stkname: '瑞昱' },
    { coid: '2345', stkname: '智邦' },   { coid: '4938', stkname: '和碩' },
    { coid: '2327', stkname: '國巨' },   { coid: '2408', stkname: '南亞科' },
    { coid: '3008', stkname: '大立光' }, { coid: '2357', stkname: '華碩' },
  ];
  POPULAR.forEach(s => { if (!map.has(s.coid)) map.set(s.coid, s.stkname); });

  return Array.from(map.entries()).map(([coid, stkname]) => ({ coid, stkname }));
}

// ── 工具函式 ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function parseReturnPct(returnStr) {
  if (!returnStr || returnStr === 'NA') return null;
  const s = returnStr.replace('%', '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n / 100;
}

function parseNumericOrNull(val) {
  if (val === null || val === undefined || val === 'NA' || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/** 計算免費版評分（複製自 api.ts calculateAdvice） */
function calculateFreeScore(item) {
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
  if (item.unusual && item.unusual !== 'N') {
    if (item.unusual.includes('紅K') || item.unusual.includes('上影線')) score += 3;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Phase A：爬取 AI 進出場訊號 ─────────────────────────────────────────────

async function collectTradingSignals(stocks) {
  console.log(`\n🚀 開始爬取 AI 進出場訊號（共 ${stocks.length} 支股票）`);
  let success = 0, skip = 0, error = 0;

  for (let i = 0; i < stocks.length; i++) {
    const { coid, stkname } = stocks[i];
    process.stdout.write(`[${i + 1}/${stocks.length}] ${coid} ${stkname}... `);

    try {
      const res = await fetchWithTimeout(`${IFALGO_BASE}/stock?coid=${coid}`);
      if (!res.ok) { console.log('HTTP ' + res.status); error++; continue; }
      const json = await res.json();
      const tradingList = json?.data?.stock?.aiQuanBackDataTradingList || [];

      if (tradingList.length === 0) { console.log('無訊號'); skip++; continue; }

      // 轉換格式
      const rows = tradingList
        .filter(t => t.in_date && t.out_date)
        .map(t => ({
          coid,
          stkname: t.stkname || stkname,
          in_date: t.in_date,
          buy_close: parseNumericOrNull(t.buy_close),
          out_date: t.out_date,
          sell_close: parseNumericOrNull(t.sell_close),
          sell_sig: t.sell_sig || '中立',
          return_pct: parseReturnPct(t.return),
          gvi_in: parseNumericOrNull(t.gvi_df1),
          gvi_out: parseNumericOrNull(t.gvi),
          hold_days: t.in_date && t.out_date
            ? Math.round((new Date(t.out_date) - new Date(t.in_date)) / 86400000)
            : null,
        }));

      // 批次 upsert
      const { error: dbErr } = await supabase
        .from('ai_trading_signals')
        .upsert(rows, { onConflict: 'coid,in_date,out_date', ignoreDuplicates: true });

      if (dbErr) {
        console.log('DB Error: ' + dbErr.message);
        error++;
      } else {
        console.log(`✅ ${rows.length} 筆`);
        success++;
      }
    } catch (e) {
      console.log('ERR: ' + e.message);
      error++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n✅ 完成！成功: ${success}, 無資料: ${skip}, 錯誤: ${error}`);
}

// ── Phase B：爬取個股 K 線歷史 ───────────────────────────────────────────────

async function collectPriceHistory(stocks) {
  console.log(`\n📊 開始爬取個股 K 線歷史（共 ${stocks.length} 支股票）`);
  let success = 0, skip = 0, error = 0;

  for (let i = 0; i < stocks.length; i++) {
    const { coid, stkname } = stocks[i];
    process.stdout.write(`[${i + 1}/${stocks.length}] ${coid} ${stkname}... `);

    try {
      const res = await fetchWithTimeout(`${IFALGO_BASE}/stock?coid=${coid}`);
      if (!res.ok) { console.log('HTTP ' + res.status); error++; continue; }
      const json = await res.json();
      const prices = json?.data?.stock?.position?.prices || [];

      if (prices.length === 0) { console.log('無價格資料'); skip++; continue; }

      const rows = prices.map(p => ({
        coid,
        mdate: p.mdate,
        open_d: parseNumericOrNull(p.open_d),
        high_d: parseNumericOrNull(p.high_d),
        low_d: parseNumericOrNull(p.low_d),
        close_d: parseNumericOrNull(p.close_d),
        volume: p.volume ? parseInt(p.volume) : null,
        pe_ratio: parseNumericOrNull(p.pe_ratio),
        pb_ratio: parseNumericOrNull(p.pb_ratio),
        roia: parseNumericOrNull(p.roia),
      })).filter(r => r.close_d !== null);

      // 分批寫入（每批 200 筆，避免超過 Supabase 限制）
      const BATCH = 200;
      let hasErr = false;
      for (let b = 0; b < rows.length; b += BATCH) {
        const chunk = rows.slice(b, b + BATCH);
        const { error: dbErr } = await supabase
          .from('stock_price_history')
          .upsert(chunk, { onConflict: 'coid,mdate', ignoreDuplicates: true });
        if (dbErr) { console.log('DB Error: ' + dbErr.message); hasErr = true; break; }
      }

      if (hasErr) { error++; } else { console.log(`✅ ${rows.length} 天`); success++; }
    } catch (e) {
      console.log('ERR: ' + e.message);
      error++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n✅ 完成！成功: ${success}, 無資料: ${skip}, 錯誤: ${error}`);
}

// ── Phase C：爬取 Simons 每日推薦歷史 ────────────────────────────────────────

async function collectSimonsHistory() {
  console.log('\n📅 開始爬取 Simons 每日推薦歷史（2025-09-01 起）');

  // 建立日期清單（2025-09-01 ~ 今天）
  const dates = [];
  const start = new Date('2025-09-01');
  const end = new Date();
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) {
      const pad = n => String(n).padStart(2, '0');
      dates.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
    }
    cur.setDate(cur.getDate() + 1);
  }

  console.log(`共 ${dates.length} 個交易日需掃描`);
  let hasData = 0, noData = 0, error = 0;

  for (let i = 0; i < dates.length; i++) {
    const dateStr = dates[i];
    process.stdout.write(`[${i + 1}/${dates.length}] ${dateStr}... `);

    try {
      const res = await fetchWithTimeout(
        `${IFALGO_BASE}/common/getSimonsData?searchDate=${dateStr}`
      );
      if (!res.ok) { console.log('HTTP ' + res.status); error++; continue; }
      const json = await res.json();
      const items = json?.data?.dataItems || [];

      if (items.length === 0) { console.log('無資料'); noData++; continue; }

      const rows = items.map(item => ({
        snapshot_date: dateStr,
        coid: item.coid,
        stkname: item.stkname,
        close: parseNumericOrNull(item.close) || 0,
        strength: parseNumericOrNull(item.strength),
        psr: item.psr != null ? parseFloat(item.psr) : null,
        ret_w: item.ret_w || null,
        ret_m: item.ret_m || null,
        wtcost: parseNumericOrNull(item.wtcost),
        fcost: parseNumericOrNull(item.fcost),
        tcost: parseNumericOrNull(item.tcost),
        dcost: parseNumericOrNull(item.dcost),
        gvi: item.gvi != null ? parseFloat(item.gvi) : null,
        mediangvi: parseNumericOrNull(item.mediangvi),
        unusual: item.unusual || null,
        category: item.category || null,
        subindustry: item.subindustry || null,
        status: item.status || null,
        value: item.value || null,
        free_score: calculateFreeScore(item),
      }));

      const { error: dbErr } = await supabase
        .from('simons_daily_snapshots')
        .upsert(rows, { onConflict: 'snapshot_date,coid', ignoreDuplicates: true });

      if (dbErr) {
        console.log('DB Error: ' + dbErr.message);
        error++;
      } else {
        console.log(`✅ ${rows.length} 支`);
        hasData++;
      }
    } catch (e) {
      console.log('ERR: ' + e.message);
      error++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n✅ 完成！有資料: ${hasData} 天, 無資料: ${noData} 天, 錯誤: ${error}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const signalsOnly = args.includes('--signals-only');
  const pricesOnly = args.includes('--prices-only');
  const simonsOnly = args.includes('--simons-only');
  const runAll = !signalsOnly && !pricesOnly && !simonsOnly;

  console.log('═══════════════════════════════════════════');
  console.log('  PPBears 回測系統 — 歷史數據爬取初始化');
  console.log('═══════════════════════════════════════════');
  console.log(`Supabase URL: ${process.env.VITE_SUPABASE_URL}`);

  if (runAll || simonsOnly) {
    await collectSimonsHistory();
  }

  const stocks = await getAllTargetStocks();
  console.log(`\n目標股票清單共 ${stocks.length} 支`);

  if (runAll || signalsOnly) {
    await collectTradingSignals(stocks);
  }

  if (runAll || pricesOnly) {
    await collectPriceHistory(stocks);
  }

  console.log('\n🎉 所有初始化任務完成！');
}

main().catch(console.error);
