-- ==========================================================
-- PPBears Investment - 交易原子性 RPC 函數
-- v1.9.0 效能優化：將買入/賣出從 5+ 次網路往返壓縮為 1 次
-- 請在 Supabase SQL Editor 執行此腳本
-- ==========================================================

-- ==========================================================
-- 1. execute_buy_trade — 原子性買入（單一 transaction）
--    - 讀取使用者（及其父帳號，若為子帳號）的手續費設定
--    - 驗證餘額
--    - 更新 users.available_balance
--    - 寫入 trades
--    - upsert holdings
--    一個 round-trip 完成，server-side 原子性保證
-- ==========================================================
CREATE OR REPLACE FUNCTION public.execute_buy_trade(
  p_stock_code text,
  p_stock_name text,
  p_quantity   numeric,
  p_price      numeric,
  p_industry   text,
  p_reason     text
)
RETURNS TABLE(
  new_balance     numeric,
  trade_id        uuid,
  new_shares      numeric,
  new_avg_cost    numeric,
  total_cost      numeric,
  trade_timestamp bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            uuid := auth.uid();
  v_user_role          text;
  v_parent_id          uuid;
  v_fee_rate           numeric;
  v_min_fee            numeric;
  v_current_balance    numeric;
  v_base_cost          numeric;
  v_fee                numeric;
  v_total_cost         numeric;
  v_new_balance        numeric;
  v_existing_shares    numeric;
  v_existing_avg_cost  numeric;
  v_new_shares         numeric;
  v_new_avg_cost       numeric;
  v_trade_id           uuid;
  v_timestamp          bigint := (extract(epoch from now()) * 1000)::bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;
  IF p_price <= 0 THEN
    RAISE EXCEPTION 'invalid_price';
  END IF;

  -- Lock user row to prevent concurrent balance races
  SELECT role, parent_id, available_balance, broker_fee_rate, broker_min_fee
    INTO v_user_role, v_parent_id, v_current_balance, v_fee_rate, v_min_fee
    FROM public.users
    WHERE id = v_user_id
    FOR UPDATE;

  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  -- Child accounts inherit parent's broker settings
  IF v_user_role = 'child' AND v_parent_id IS NOT NULL THEN
    SELECT broker_fee_rate, broker_min_fee
      INTO v_fee_rate, v_min_fee
      FROM public.users
      WHERE id = v_parent_id;
  END IF;

  v_fee_rate := COALESCE(v_fee_rate, 0.001425);
  v_min_fee  := COALESCE(v_min_fee, 20);

  v_base_cost  := p_quantity * p_price;
  v_fee        := GREATEST(v_min_fee, ROUND(v_base_cost * v_fee_rate));
  v_total_cost := v_base_cost + v_fee;

  IF v_current_balance < v_total_cost THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  v_new_balance := v_current_balance - v_total_cost;

  UPDATE public.users
    SET available_balance = v_new_balance
    WHERE id = v_user_id;

  INSERT INTO public.trades(
    user_id, stock_code, stock_name, trade_type,
    quantity, price, total_amount, reason, timestamp
  ) VALUES (
    v_user_id, p_stock_code, p_stock_name, 'buy',
    p_quantity, p_price, v_total_cost, p_reason, v_timestamp
  )
  RETURNING id INTO v_trade_id;

  -- Lock holding row (if exists) to prevent concurrent buy races on same stock
  SELECT total_shares, avg_cost
    INTO v_existing_shares, v_existing_avg_cost
    FROM public.holdings
    WHERE user_id = v_user_id AND stock_code = p_stock_code
    FOR UPDATE;

  IF v_existing_shares IS NULL THEN
    v_new_shares   := p_quantity;
    v_new_avg_cost := p_price;
    INSERT INTO public.holdings(
      user_id, stock_code, stock_name,
      total_shares, avg_cost, current_price, industry
    ) VALUES (
      v_user_id, p_stock_code, p_stock_name,
      v_new_shares, v_new_avg_cost, p_price, COALESCE(p_industry, '')
    );
  ELSE
    v_new_shares   := v_existing_shares + p_quantity;
    -- Average cost = (既有成本總和 + 本次含手續費成本) / 新總股數
    v_new_avg_cost := ROUND(
      ((v_existing_avg_cost * v_existing_shares + v_total_cost) / v_new_shares)::numeric,
      2
    );
    UPDATE public.holdings SET
      total_shares  = v_new_shares,
      avg_cost      = v_new_avg_cost,
      current_price = p_price,
      updated_at    = now()
    WHERE user_id = v_user_id AND stock_code = p_stock_code;
  END IF;

  RETURN QUERY SELECT
    v_new_balance, v_trade_id, v_new_shares,
    v_new_avg_cost, v_total_cost, v_timestamp;
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_buy_trade(text, text, numeric, numeric, text, text) TO authenticated;

-- ==========================================================
-- 2. execute_sell_trade — 原子性賣出（單一 transaction）
-- ==========================================================
CREATE OR REPLACE FUNCTION public.execute_sell_trade(
  p_stock_code text,
  p_quantity   numeric,
  p_price      numeric,
  p_reason     text
)
RETURNS TABLE(
  new_balance      numeric,
  trade_id         uuid,
  remaining_shares numeric,
  profit           numeric,
  total_received   numeric,
  trade_timestamp  bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            uuid := auth.uid();
  v_user_role          text;
  v_parent_id          uuid;
  v_fee_rate           numeric;
  v_min_fee            numeric;
  v_tax_rate           numeric;
  v_current_balance    numeric;
  v_existing_shares    numeric;
  v_existing_avg_cost  numeric;
  v_existing_name      text;
  v_base_value         numeric;
  v_fee                numeric;
  v_tax                numeric;
  v_total_received     numeric;
  v_new_balance        numeric;
  v_remaining_shares   numeric;
  v_profit             numeric;
  v_trade_id           uuid;
  v_timestamp          bigint := (extract(epoch from now()) * 1000)::bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;
  IF p_price <= 0 THEN
    RAISE EXCEPTION 'invalid_price';
  END IF;

  SELECT role, parent_id, available_balance,
         broker_fee_rate, broker_min_fee, broker_tax_rate
    INTO v_user_role, v_parent_id, v_current_balance,
         v_fee_rate, v_min_fee, v_tax_rate
    FROM public.users
    WHERE id = v_user_id
    FOR UPDATE;

  IF v_user_role IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  IF v_user_role = 'child' AND v_parent_id IS NOT NULL THEN
    SELECT broker_fee_rate, broker_min_fee, broker_tax_rate
      INTO v_fee_rate, v_min_fee, v_tax_rate
      FROM public.users
      WHERE id = v_parent_id;
  END IF;

  v_fee_rate := COALESCE(v_fee_rate, 0.001425);
  v_min_fee  := COALESCE(v_min_fee, 20);
  v_tax_rate := COALESCE(v_tax_rate, 0.003);

  SELECT total_shares, avg_cost, stock_name
    INTO v_existing_shares, v_existing_avg_cost, v_existing_name
    FROM public.holdings
    WHERE user_id = v_user_id AND stock_code = p_stock_code
    FOR UPDATE;

  IF v_existing_shares IS NULL THEN
    RAISE EXCEPTION 'no_holding';
  END IF;
  IF p_quantity > v_existing_shares THEN
    RAISE EXCEPTION 'insufficient_shares';
  END IF;

  v_base_value     := p_quantity * p_price;
  v_fee            := GREATEST(v_min_fee, ROUND(v_base_value * v_fee_rate));
  v_tax            := ROUND(v_base_value * v_tax_rate);
  v_total_received := v_base_value - v_fee - v_tax;
  v_profit         := v_total_received - (v_existing_avg_cost * p_quantity);
  v_new_balance    := v_current_balance + v_total_received;

  UPDATE public.users
    SET available_balance = v_new_balance
    WHERE id = v_user_id;

  INSERT INTO public.trades(
    user_id, stock_code, stock_name, trade_type,
    quantity, price, total_amount, reason, profit, timestamp
  ) VALUES (
    v_user_id, p_stock_code, v_existing_name, 'sell',
    p_quantity, p_price, v_total_received, p_reason, v_profit, v_timestamp
  )
  RETURNING id INTO v_trade_id;

  v_remaining_shares := v_existing_shares - p_quantity;
  IF v_remaining_shares <= 0 THEN
    DELETE FROM public.holdings
      WHERE user_id = v_user_id AND stock_code = p_stock_code;
    v_remaining_shares := 0;
  ELSE
    UPDATE public.holdings SET
      total_shares  = v_remaining_shares,
      current_price = p_price,
      updated_at    = now()
    WHERE user_id = v_user_id AND stock_code = p_stock_code;
  END IF;

  RETURN QUERY SELECT
    v_new_balance, v_trade_id, v_remaining_shares,
    v_profit, v_total_received, v_timestamp;
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_sell_trade(text, numeric, numeric, text) TO authenticated;

-- ==========================================================
-- 部署說明：
-- 1. 複製整份檔案內容到 Supabase Dashboard → SQL Editor → 執行
-- 2. 部署完成後前端新版程式碼（v1.9.0+）即可使用
-- 3. 若要回滾，可執行：
--      DROP FUNCTION IF EXISTS public.execute_buy_trade(text, text, numeric, numeric, text, text);
--      DROP FUNCTION IF EXISTS public.execute_sell_trade(text, numeric, numeric, text);
-- ==========================================================
