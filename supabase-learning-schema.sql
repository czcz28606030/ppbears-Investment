-- ==========================================================
-- PPBears Investment — Learning Module Schema (Slice 1)
-- 於 Supabase SQL Editor 手動執行
-- 前置：需已存在 public.users 表（見 supabase-schema.sql）
-- ==========================================================
-- 本腳本可重複執行（使用 IF NOT EXISTS / DROP POLICY IF EXISTS）
-- ==========================================================

-- ==========================================================
-- 1. learning_profiles — 學習進度主表
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.learning_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  current_level int NOT NULL DEFAULT 1 CHECK (current_level BETWEEN 1 AND 50),
  current_stage int NOT NULL DEFAULT 1 CHECK (current_stage BETWEEN 1 AND 10),
  total_xp int NOT NULL DEFAULT 0,
  streak_days int NOT NULL DEFAULT 0,
  longest_streak int NOT NULL DEFAULT 0,
  last_learn_date date,
  total_lessons_completed int NOT NULL DEFAULT 0,
  total_questions_correct int NOT NULL DEFAULT 0,
  total_questions_answered int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================
-- 2. lesson_progress — 課程完成紀錄
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  lesson_id varchar NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  score int,
  xp_earned int NOT NULL DEFAULT 0,
  time_spent_seconds int,
  questions_correct int NOT NULL DEFAULT 0,
  questions_total int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS lesson_progress_user_idx
  ON public.lesson_progress (user_id, completed_at DESC);

-- ==========================================================
-- 3. learning_wallet — 副帳號的學習幣錢包
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.learning_wallet (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  balance int NOT NULL DEFAULT 0 CHECK (balance >= 0),
  frozen int NOT NULL DEFAULT 0 CHECK (frozen >= 0),
  total_earned int NOT NULL DEFAULT 0,
  total_spent int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================
-- 4. wallet_transactions — 學習幣異動紀錄
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount int NOT NULL,                  -- 正=獲得, 負=兌換
  tx_type varchar NOT NULL CHECK (tx_type IN
    ('earn', 'redeem', 'parent_grant', 'refund', 'freeze', 'unfreeze')),
  source varchar,                       -- rule_id / redemption_id / lesson_id
  description text,
  parent_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_tx_user_idx
  ON public.wallet_transactions (user_id, created_at DESC);

-- ==========================================================
-- Enable RLS
-- ==========================================================
ALTER TABLE public.learning_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_progress     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_wallet     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- ==========================================================
-- RLS Policies
-- 原則：
--   - 副帳號可 SELECT/INSERT/UPDATE 自己的資料
--   - 主帳號可 SELECT 所屬副帳號的資料（透過 users.parent_id）
--   - wallet 相關的 UPDATE 建議走 SECURITY DEFINER function（未來 Slice）
--     此 Slice 先允許 user 自己 UPDATE，之後收緊
-- ==========================================================

-- ---- learning_profiles ----
DROP POLICY IF EXISTS lp_self_select ON public.learning_profiles;
CREATE POLICY lp_self_select ON public.learning_profiles
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS lp_self_insert ON public.learning_profiles;
CREATE POLICY lp_self_insert ON public.learning_profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS lp_self_update ON public.learning_profiles;
CREATE POLICY lp_self_update ON public.learning_profiles
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS lp_parent_select ON public.learning_profiles;
CREATE POLICY lp_parent_select ON public.learning_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = learning_profiles.user_id
        AND u.parent_id = auth.uid()
    )
  );

-- ---- lesson_progress ----
DROP POLICY IF EXISTS lprog_self_select ON public.lesson_progress;
CREATE POLICY lprog_self_select ON public.lesson_progress
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS lprog_self_insert ON public.lesson_progress;
CREATE POLICY lprog_self_insert ON public.lesson_progress
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS lprog_parent_select ON public.lesson_progress;
CREATE POLICY lprog_parent_select ON public.lesson_progress
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = lesson_progress.user_id
        AND u.parent_id = auth.uid()
    )
  );

-- ---- learning_wallet ----
DROP POLICY IF EXISTS lw_self_select ON public.learning_wallet;
CREATE POLICY lw_self_select ON public.learning_wallet
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS lw_self_insert ON public.learning_wallet;
CREATE POLICY lw_self_insert ON public.learning_wallet
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS lw_self_update ON public.learning_wallet;
CREATE POLICY lw_self_update ON public.learning_wallet
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS lw_parent_select ON public.learning_wallet;
CREATE POLICY lw_parent_select ON public.learning_wallet
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = learning_wallet.user_id
        AND u.parent_id = auth.uid()
    )
  );

-- ---- wallet_transactions ----
DROP POLICY IF EXISTS wt_self_select ON public.wallet_transactions;
CREATE POLICY wt_self_select ON public.wallet_transactions
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS wt_self_insert ON public.wallet_transactions;
CREATE POLICY wt_self_insert ON public.wallet_transactions
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS wt_parent_select ON public.wallet_transactions;
CREATE POLICY wt_parent_select ON public.wallet_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = wallet_transactions.user_id
        AND u.parent_id = auth.uid()
    )
  );

-- ==========================================================
-- 完成！
-- 驗證：
--   SELECT * FROM public.learning_profiles;
--   SELECT * FROM public.learning_wallet;
-- ==========================================================
