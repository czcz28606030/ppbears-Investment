-- PPBears Investment - Watchlist Schema
-- Execute in Supabase SQL Editor

-- 1. Create watchlist table
CREATE TABLE IF NOT EXISTS public.watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stock_code varchar NOT NULL,
  stock_name varchar NOT NULL,
  added_price numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, stock_code)
);

CREATE INDEX IF NOT EXISTS watchlist_user_idx
  ON public.watchlist (user_id, created_at DESC);

-- 2. Enable RLS
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
DROP POLICY IF EXISTS wl_self_all ON public.watchlist;
CREATE POLICY wl_self_all ON public.watchlist
  FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS wl_admin_select ON public.watchlist;
CREATE POLICY wl_admin_select ON public.watchlist
  FOR SELECT USING (public.is_admin());
