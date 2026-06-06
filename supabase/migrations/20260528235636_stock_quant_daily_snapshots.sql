-- Stock detail chip-stability trend snapshots.
-- Populated by api/app-cache.ts from IFAlgo/Simons stock quant data.

CREATE TABLE IF NOT EXISTS public.stock_quant_daily_snapshots (
  snapshot_date date NOT NULL,
  coid text NOT NULL,
  stkname text,
  chip_pts numeric,
  ai_remark text,
  ai_cum_ret text,
  ai_freq integer,
  gvi numeric,
  mediangvi numeric,
  current_signal text,
  source text DEFAULT 'ifalgo-stock',
  collected_at timestamptz DEFAULT now(),
  PRIMARY KEY (snapshot_date, coid)
);

CREATE INDEX IF NOT EXISTS idx_stock_quant_daily_coid
  ON public.stock_quant_daily_snapshots(coid);

CREATE INDEX IF NOT EXISTS idx_stock_quant_daily_date
  ON public.stock_quant_daily_snapshots(snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_stock_quant_daily_chip
  ON public.stock_quant_daily_snapshots(chip_pts DESC);

ALTER TABLE public.stock_quant_daily_snapshots ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.stock_quant_daily_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_quant_daily_snapshots TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stock_quant_daily_snapshots'
      AND policyname = 'Authenticated users can read stock_quant_daily_snapshots'
  ) THEN
    CREATE POLICY "Authenticated users can read stock_quant_daily_snapshots"
      ON public.stock_quant_daily_snapshots FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stock_quant_daily_snapshots'
      AND policyname = 'Service role can manage stock_quant_daily_snapshots'
  ) THEN
    CREATE POLICY "Service role can manage stock_quant_daily_snapshots"
      ON public.stock_quant_daily_snapshots FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
