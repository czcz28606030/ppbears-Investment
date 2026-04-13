-- ==========================================================
-- PPBears Investment — Rewards Module Schema (Slice 3)
-- 於 Supabase SQL Editor 手動執行
-- 前置：需已執行 supabase-learning-schema.sql（Slice 1）
-- ==========================================================

-- ==========================================================
-- 1. reward_rules — 主帳號設定的發幣規則
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.reward_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  child_id uuid REFERENCES public.users(id) ON DELETE CASCADE, -- NULL = 適用此主帳號所有副帳號
  trigger_type varchar NOT NULL CHECK (trigger_type IN (
    'daily_complete', 'streak_7', 'streak_30',
    'level_up', 'stage_up', 'badge', 'pet_evolution',
    'perfect_score', 'custom'
  )),
  trigger_label varchar,   -- custom 類型時的自訂名稱
  amount int NOT NULL CHECK (amount > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_rules_parent_idx
  ON public.reward_rules (parent_id, is_active);

-- ==========================================================
-- 2. reward_shop_items — 主帳號設定的可兌換商品
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.reward_shop_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name varchar NOT NULL,
  description text,
  icon varchar,          -- emoji 或圖片 URL
  item_type varchar NOT NULL CHECK (item_type IN ('cash', 'product', 'experience', 'invest_bonus')),
  cost_coins int NOT NULL CHECK (cost_coins > 0),
  cash_value int,        -- cash / invest_bonus 時填對應台幣金額
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_shop_parent_idx
  ON public.reward_shop_items (parent_id, is_active, sort_order);

-- ==========================================================
-- 3. redemption_requests — 副帳號的兌換申請
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.redemption_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  parent_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  shop_item_id uuid NOT NULL REFERENCES public.reward_shop_items(id),
  item_name varchar NOT NULL,   -- 申請時快照商品名稱
  cost_coins int NOT NULL,      -- 申請時快照幣價
  status varchar NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  parent_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS redemption_child_idx
  ON public.redemption_requests (child_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS redemption_parent_idx
  ON public.redemption_requests (parent_id, status, requested_at DESC);

-- ==========================================================
-- Enable RLS
-- ==========================================================
ALTER TABLE public.reward_rules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_shop_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.redemption_requests ENABLE ROW LEVEL SECURITY;

-- ==========================================================
-- RLS Policies
-- ==========================================================

-- ---- reward_rules ----
DROP POLICY IF EXISTS rr_parent_all ON public.reward_rules;
CREATE POLICY rr_parent_all ON public.reward_rules
  FOR ALL USING (parent_id = auth.uid());

-- 副帳號可 SELECT 自己父母的 rules（用於 completeLesson 查詢觸發哪些規則）
DROP POLICY IF EXISTS rr_child_select ON public.reward_rules;
CREATE POLICY rr_child_select ON public.reward_rules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.parent_id = reward_rules.parent_id
        AND (reward_rules.child_id IS NULL OR reward_rules.child_id = auth.uid())
    )
  );

-- ---- reward_shop_items ----
DROP POLICY IF EXISTS rsi_parent_all ON public.reward_shop_items;
CREATE POLICY rsi_parent_all ON public.reward_shop_items
  FOR ALL USING (parent_id = auth.uid());

-- 副帳號可 SELECT 自己父母的商城商品
DROP POLICY IF EXISTS rsi_child_select ON public.reward_shop_items;
CREATE POLICY rsi_child_select ON public.reward_shop_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.parent_id = reward_shop_items.parent_id
    )
  );

-- ---- redemption_requests ----
DROP POLICY IF EXISTS redm_child ON public.redemption_requests;
CREATE POLICY redm_child ON public.redemption_requests
  FOR ALL USING (child_id = auth.uid());

DROP POLICY IF EXISTS redm_parent_select ON public.redemption_requests;
CREATE POLICY redm_parent_select ON public.redemption_requests
  FOR SELECT USING (parent_id = auth.uid());

DROP POLICY IF EXISTS redm_parent_update ON public.redemption_requests;
CREATE POLICY redm_parent_update ON public.redemption_requests
  FOR UPDATE USING (parent_id = auth.uid());

-- ==========================================================
-- 移除 Slice 1 的直接 wallet UPDATE 權限
-- 改由 SECURITY DEFINER function 執行，提高安全性
-- ==========================================================
DROP POLICY IF EXISTS lw_self_update ON public.learning_wallet;

-- ==========================================================
-- DB Functions（SECURITY DEFINER）
-- ==========================================================

-- 1. grant_learning_coins
--    呼叫者必須是 p_user_id 本人，或是其父母帳號
CREATE OR REPLACE FUNCTION public.grant_learning_coins(
  p_user_id uuid,
  p_amount int,
  p_tx_type varchar,
  p_source varchar,
  p_description text,
  p_parent_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 安全驗證：呼叫者必須是本人或其父母
  IF NOT (
    auth.uid() = p_user_id
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = p_user_id AND parent_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  -- Upsert 錢包（第一次自動建立）
  INSERT INTO public.learning_wallet (user_id, balance, total_earned)
  VALUES (p_user_id, p_amount, p_amount)
  ON CONFLICT (user_id) DO UPDATE
    SET balance      = learning_wallet.balance + p_amount,
        total_earned = learning_wallet.total_earned + p_amount,
        updated_at   = now();

  -- 記錄異動
  INSERT INTO public.wallet_transactions
    (user_id, amount, tx_type, source, description, parent_message)
  VALUES
    (p_user_id, p_amount, p_tx_type, p_source, p_description, p_parent_message);
END;
$$;

-- 2. freeze_coins — 副帳號提出兌換申請時凍結幣數
CREATE OR REPLACE FUNCTION public.freeze_coins(
  p_user_id uuid,
  p_amount int,
  p_source varchar,
  p_description text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 只能凍結自己的幣
  IF auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  -- 確認餘額足夠
  IF (SELECT balance FROM public.learning_wallet WHERE user_id = p_user_id) < p_amount THEN
    RAISE EXCEPTION 'insufficient balance';
  END IF;

  UPDATE public.learning_wallet
  SET balance    = balance - p_amount,
      frozen     = frozen  + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.wallet_transactions
    (user_id, amount, tx_type, source, description)
  VALUES
    (p_user_id, -p_amount, 'freeze', p_source, p_description);
END;
$$;

-- 3. approve_redemption — 主帳號核可兌換（扣除凍結幣）
CREATE OR REPLACE FUNCTION public.approve_redemption(
  p_request_id uuid,
  p_parent_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.redemption_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req
  FROM public.redemption_requests
  WHERE id = p_request_id;

  -- 只有父母能核可
  IF auth.uid() <> v_req.parent_id THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'request is not pending';
  END IF;

  -- 扣除凍結幣
  UPDATE public.learning_wallet
  SET frozen     = frozen - v_req.cost_coins,
      total_spent = total_spent + v_req.cost_coins,
      updated_at = now()
  WHERE user_id = v_req.child_id;

  -- 更新申請狀態
  UPDATE public.redemption_requests
  SET status      = 'approved',
      parent_note = p_parent_note,
      resolved_at = now()
  WHERE id = p_request_id;

  -- 記錄異動
  INSERT INTO public.wallet_transactions
    (user_id, amount, tx_type, source, description, parent_message)
  VALUES
    (v_req.child_id, -v_req.cost_coins, 'redeem',
     p_request_id::text, '兌換：' || v_req.item_name, p_parent_note);
END;
$$;

-- 4. reject_redemption — 主帳號駁回兌換（退還凍結幣）
CREATE OR REPLACE FUNCTION public.reject_redemption(
  p_request_id uuid,
  p_parent_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req public.redemption_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req
  FROM public.redemption_requests
  WHERE id = p_request_id;

  IF auth.uid() <> v_req.parent_id THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'request is not pending';
  END IF;

  -- 退還凍結幣
  UPDATE public.learning_wallet
  SET balance    = balance + v_req.cost_coins,
      frozen     = frozen  - v_req.cost_coins,
      updated_at = now()
  WHERE user_id = v_req.child_id;

  UPDATE public.redemption_requests
  SET status      = 'rejected',
      parent_note = p_parent_note,
      resolved_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.wallet_transactions
    (user_id, amount, tx_type, source, description, parent_message)
  VALUES
    (v_req.child_id, v_req.cost_coins, 'refund',
     p_request_id::text, '退款：' || v_req.item_name, p_parent_note);
END;
$$;

-- ==========================================================
-- 完成！
-- 驗證：
--   SELECT * FROM public.reward_rules;
--   SELECT * FROM public.reward_shop_items;
--   SELECT * FROM public.redemption_requests;
-- ==========================================================
