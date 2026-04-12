-- ==========================================================
-- PPBears Investment - Supabase Schema v2.1
-- 主帳號 / 副帳號系統（無總額度上限設計）
-- 請在 Supabase SQL Editor 執行此完整腳本
-- ==========================================================

-- 先清除舊版本
DROP TABLE IF EXISTS public.snapshots CASCADE;
DROP TABLE IF EXISTS public.holdings CASCADE;
DROP TABLE IF EXISTS public.trades CASCADE;
DROP TABLE IF EXISTS public.withdrawal_requests CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- ==========================================================
-- 1. users 表格（對應 Supabase Auth）
-- ==========================================================
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL,
  avatar text NOT NULL DEFAULT '🐻',
  role text NOT NULL CHECK (role IN ('parent', 'child')),
  tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'premium')),
  is_admin boolean NOT NULL DEFAULT false,
  subscription_expires_at timestamptz,
  parent_id uuid REFERENCES public.users(id) ON DELETE CASCADE,  -- null = 主帳號
  available_balance numeric NOT NULL DEFAULT 0,   -- 目前可用現金（無上限）
  initial_balance numeric NOT NULL DEFAULT 0,     -- 主帳號初始給予的金額（僅參考用）
  created_at timestamptz DEFAULT now() NOT NULL
);

-- ==========================================================
-- 1b. 功能開關表（管理員可逐一控制用戶的進階功能）
-- ==========================================================
CREATE TABLE public.feature_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, feature_key)
);

-- ==========================================================
-- 2. trades 交易紀錄
-- ==========================================================
CREATE TABLE public.trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stock_code text NOT NULL,
  stock_name text NOT NULL,
  trade_type text NOT NULL CHECK (trade_type IN ('buy', 'sell')),
  quantity numeric NOT NULL,
  price numeric NOT NULL,
  total_amount numeric NOT NULL,
  reason text,
  profit numeric,
  timestamp bigint NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- ==========================================================
-- 3. holdings 持股
-- ==========================================================
CREATE TABLE public.holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stock_code text NOT NULL,
  stock_name text NOT NULL,
  total_shares numeric NOT NULL,
  avg_cost numeric NOT NULL,
  current_price numeric NOT NULL,
  industry text,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, stock_code)
);

-- ==========================================================
-- 4. withdrawal_requests 出金申請
-- ==========================================================
CREATE TABLE public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  parent_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- ==========================================================
-- 5. Row Level Security (RLS)
-- ==========================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own and family profiles"
  ON public.users FOR SELECT
  USING (
    auth.uid() = id OR
    auth.uid() = parent_id OR
    parent_id = auth.uid()
  );

CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Allow insert on signup"
  ON public.users FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users manage own trades"
  ON public.trades FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Parents can view children trades"
  ON public.trades FOR SELECT
  USING (user_id IN (SELECT id FROM public.users WHERE parent_id = auth.uid()));

CREATE POLICY "Users manage own holdings"
  ON public.holdings FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Parents can view children holdings"
  ON public.holdings FOR SELECT
  USING (user_id IN (SELECT id FROM public.users WHERE parent_id = auth.uid()));

CREATE POLICY "Withdrawal visible to involved parties"
  ON public.withdrawal_requests FOR SELECT
  USING (auth.uid() = child_id OR auth.uid() = parent_id);

CREATE POLICY "Child can create withdrawal request"
  ON public.withdrawal_requests FOR INSERT
  WITH CHECK (auth.uid() = child_id);

CREATE POLICY "Parent can update withdrawal status"
  ON public.withdrawal_requests FOR UPDATE
  USING (auth.uid() = parent_id);

-- 允許主帳號更新子帳號的 available_balance（出金、設定金額）
CREATE POLICY "Parent can update child balance"
  ON public.users FOR UPDATE
  USING (
    auth.uid() = id OR
    parent_id = auth.uid()
  );
