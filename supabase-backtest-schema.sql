-- ==========================================================
-- PPBears Investment - 回測系統 Schema v1.0
-- Phase 1: 數據收集基礎
-- 請在 Supabase SQL Editor 執行此完整腳本
-- ==========================================================

-- ==========================================================
-- 1. ai_trading_signals — AI 進出場歷史交易訊號
--    來源：api.ifalgo.com.tw → stock.aiQuanBackDataTradingList
--    深度：約 11 個月（2025-05 起），每股 25~34 筆
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.ai_trading_signals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coid          text NOT NULL,
  stkname       text NOT NULL,
  in_date       date NOT NULL,
  buy_close     numeric,          -- 進場收盤價（NA 時為 null）
  out_date      date,             -- 出場日期
  sell_close    numeric,          -- 出場收盤價
  sell_sig      text,             -- '出場' | '中立' | '加碼'
  return_pct    numeric,          -- 報酬率（小數，如 -0.029 = -2.9%）
  gvi_in        numeric,          -- 進場時 GVI 氣動指數
  gvi_out       numeric,          -- 出場時 GVI 氣動指數
  hold_days     integer,          -- 持有天數（out_date - in_date）
  collected_at  timestamptz DEFAULT now(),
  UNIQUE(coid, in_date, out_date)
);

CREATE INDEX IF NOT EXISTS idx_signals_coid     ON public.ai_trading_signals(coid);
CREATE INDEX IF NOT EXISTS idx_signals_in_date  ON public.ai_trading_signals(in_date);
CREATE INDEX IF NOT EXISTS idx_signals_sell_sig ON public.ai_trading_signals(sell_sig);
CREATE INDEX IF NOT EXISTS idx_signals_return   ON public.ai_trading_signals(return_pct DESC);

-- RLS
ALTER TABLE public.ai_trading_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read ai_trading_signals"
  ON public.ai_trading_signals FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage ai_trading_signals"
  ON public.ai_trading_signals FOR ALL
  USING (auth.role() = 'service_role');

-- ==========================================================
-- 2. simons_daily_snapshots — Simons 每日推薦快照
--    來源：getSimonsData?searchDate=YYYY-MM-DD
--    深度：~6 個月（2025-09 起），涵蓋率 41%，每日自動補充
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.simons_daily_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  coid          text NOT NULL,
  stkname       text NOT NULL,
  close         numeric NOT NULL,
  strength      numeric,
  psr           numeric,
  ret_w         text,             -- 'rise' | 'drop' | 'flat'
  ret_m         text,
  wtcost        numeric,          -- 外資成本
  fcost         numeric,          -- 投信成本
  tcost         numeric,          -- 自營商成本
  dcost         numeric,
  gvi           numeric,          -- 氣動指數
  mediangvi     numeric,
  unusual       text,
  category      text,
  subindustry   text,
  status        text,
  value         text,
  -- 量化指標（每日補充抓取）
  ai_remark     text,             -- '超高度' | '高度' | '中度' | '低度'
  ai_cum_ret    text,             -- '27.4%'
  ai_freq       integer,
  chip_pts      numeric,          -- 籌碼穩定度 0-10
  -- 計算分數
  free_score    integer,          -- calculateAdvice() 的評分
  simons_score  integer,          -- calculateSimonsScore() 的評分（有量化資料時）
  created_at    timestamptz DEFAULT now(),
  UNIQUE(snapshot_date, coid)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_date     ON public.simons_daily_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_coid     ON public.simons_daily_snapshots(coid);
CREATE INDEX IF NOT EXISTS idx_snapshots_score    ON public.simons_daily_snapshots(free_score DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_remark   ON public.simons_daily_snapshots(ai_remark);

-- RLS
ALTER TABLE public.simons_daily_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read simons_daily_snapshots"
  ON public.simons_daily_snapshots FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage simons_daily_snapshots"
  ON public.simons_daily_snapshots FOR ALL
  USING (auth.role() = 'service_role');

-- ==========================================================
-- 3. stock_price_history — 個股歷史 K 線
--    來源：stock?coid= → position.prices[]
--    深度：5.5 年（2020-11-02 起），1,323 個交易日
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.stock_price_history (
  coid      text NOT NULL,
  mdate     date NOT NULL,
  open_d    numeric,
  high_d    numeric,
  low_d     numeric,
  close_d   numeric NOT NULL,
  volume    bigint,
  pe_ratio  numeric,
  pb_ratio  numeric,
  roia      numeric,             -- 日報酬率 %
  PRIMARY KEY(coid, mdate)
);

CREATE INDEX IF NOT EXISTS idx_price_hist_coid  ON public.stock_price_history(coid);
CREATE INDEX IF NOT EXISTS idx_price_hist_date  ON public.stock_price_history(mdate DESC);

-- RLS
ALTER TABLE public.stock_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read stock_price_history"
  ON public.stock_price_history FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage stock_price_history"
  ON public.stock_price_history FOR ALL
  USING (auth.role() = 'service_role');

-- ==========================================================
-- 4. backtest_cache — 回測結果快取（避免重複計算）
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.backtest_cache (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key      text NOT NULL UNIQUE,  -- hash of config params
  config         jsonb NOT NULL,        -- BacktestConfig
  result_summary jsonb NOT NULL,        -- BacktestSummary
  trade_count    integer,
  computed_at    timestamptz DEFAULT now()
);

ALTER TABLE public.backtest_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read backtest_cache"
  ON public.backtest_cache FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage backtest_cache"
  ON public.backtest_cache FOR ALL
  USING (auth.role() = 'service_role');

-- ==========================================================
-- 輔助 View：快速查看每支股票的 AI 訊號統計
-- ==========================================================
CREATE OR REPLACE VIEW public.ai_signal_stats AS
SELECT
  coid,
  stkname,
  COUNT(*) AS total_trades,
  ROUND(
    100.0 * SUM(CASE WHEN return_pct > 0 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
    1
  ) AS win_rate_pct,
  ROUND(AVG(return_pct) * 100, 2) AS avg_return_pct,
  ROUND(SUM(return_pct) * 100, 2) AS cum_return_pct,
  ROUND(MAX(return_pct) * 100, 2) AS max_win_pct,
  ROUND(MIN(return_pct) * 100, 2) AS max_loss_pct,
  ROUND(AVG(hold_days), 1) AS avg_hold_days,
  MIN(in_date) AS earliest_trade,
  MAX(in_date) AS latest_trade
FROM public.ai_trading_signals
WHERE return_pct IS NOT NULL
  AND sell_sig = '出場'
GROUP BY coid, stkname
ORDER BY cum_return_pct DESC;
