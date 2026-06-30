-- User-level daily page cache for Watchlist and Portfolio preloading.
-- Written by Vercel cron using service_role; read by signed-in users through the app API.

CREATE TABLE IF NOT EXISTS public.user_market_daily_cache (
  cache_date date NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  surface text NOT NULL CHECK (surface IN ('watchlist', 'portfolio')),
  signature text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'partial', 'waiting-simons', 'empty')),
  data_date text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  stale_reason text,
  PRIMARY KEY (cache_date, user_id, surface)
);

CREATE INDEX IF NOT EXISTS idx_user_market_daily_cache_user_surface
  ON public.user_market_daily_cache(user_id, surface, cache_date DESC);

CREATE INDEX IF NOT EXISTS idx_user_market_daily_cache_generated_at
  ON public.user_market_daily_cache(generated_at DESC);

ALTER TABLE public.user_market_daily_cache ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.user_market_daily_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_market_daily_cache TO service_role;

DROP POLICY IF EXISTS "Users can read own user market daily cache" ON public.user_market_daily_cache;
CREATE POLICY "Users can read own user market daily cache"
  ON public.user_market_daily_cache
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Service role can manage user market daily cache" ON public.user_market_daily_cache;
CREATE POLICY "Service role can manage user market daily cache"
  ON public.user_market_daily_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
