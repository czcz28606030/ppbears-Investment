-- ==========================================================
-- PPBears Investment - Dividend Payments
-- v1.22.0
-- Purpose:
--   1. Record cash dividend entitlements by user and stock.
--   2. Credit users.available_balance once on the real cash pay date.
--   3. Prevent duplicate dividend credits with a unique key and RPC.
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.dividend_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stock_code text NOT NULL,
  stock_name text NOT NULL,
  ex_date date NOT NULL,
  last_buy_date date NOT NULL,
  pay_date date NOT NULL,
  cash_dividend numeric NOT NULL CHECK (cash_dividend > 0),
  eligible_shares numeric NOT NULL CHECK (eligible_shares > 0),
  amount numeric NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'paid', 'skipped')),
  paid_at timestamptz,
  source text NOT NULL DEFAULT 'yahoo',
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, stock_code, ex_date, pay_date)
);

CREATE INDEX IF NOT EXISTS dividend_payments_user_pay_date_idx
  ON public.dividend_payments(user_id, pay_date DESC);

CREATE INDEX IF NOT EXISTS dividend_payments_status_pay_date_idx
  ON public.dividend_payments(status, pay_date);

ALTER TABLE public.dividend_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own dividends" ON public.dividend_payments;
CREATE POLICY "Users can view own dividends"
  ON public.dividend_payments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Parents can view children dividends" ON public.dividend_payments;
CREATE POLICY "Parents can view children dividends"
  ON public.dividend_payments FOR SELECT
  USING (
    user_id IN (SELECT id FROM public.users WHERE parent_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admin can view all dividends" ON public.dividend_payments;
CREATE POLICY "Admin can view all dividends"
  ON public.dividend_payments FOR SELECT
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.upsert_and_credit_dividend(
  p_user_id uuid,
  p_stock_code text,
  p_stock_name text,
  p_ex_date date,
  p_pay_date date,
  p_cash_dividend numeric,
  p_source text DEFAULT 'yahoo',
  p_source_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  payment_id uuid,
  status text,
  eligible_shares numeric,
  amount numeric,
  credited boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shares numeric;
  v_amount numeric;
  v_payment public.dividend_payments%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Taipei')::date;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'missing_user_id';
  END IF;
  IF p_cash_dividend <= 0 THEN
    RAISE EXCEPTION 'invalid_cash_dividend';
  END IF;
  IF p_pay_date IS NULL OR p_ex_date IS NULL THEN
    RAISE EXCEPTION 'missing_dividend_date';
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN trade_type = 'buy' THEN quantity
      WHEN trade_type = 'sell' THEN -quantity
      ELSE 0
    END
  ), 0)
    INTO v_shares
    FROM public.trades
    WHERE user_id = p_user_id
      AND stock_code = p_stock_code
      AND ((to_timestamp(timestamp / 1000.0) AT TIME ZONE 'Asia/Taipei')::date < p_ex_date);

  IF v_shares <= 0 THEN
    RETURN QUERY SELECT NULL::uuid, 'skipped'::text, 0::numeric, 0::numeric, false;
    RETURN;
  END IF;

  v_amount := ROUND(v_shares * p_cash_dividend, 0);
  IF v_amount <= 0 THEN
    RETURN QUERY SELECT NULL::uuid, 'skipped'::text, v_shares, 0::numeric, false;
    RETURN;
  END IF;

  INSERT INTO public.dividend_payments (
    user_id, stock_code, stock_name, ex_date, last_buy_date, pay_date,
    cash_dividend, eligible_shares, amount, status, source, source_payload
  ) VALUES (
    p_user_id, p_stock_code, p_stock_name, p_ex_date, p_ex_date - 1, p_pay_date,
    p_cash_dividend, v_shares, v_amount, 'scheduled', COALESCE(p_source, 'yahoo'), COALESCE(p_source_payload, '{}'::jsonb)
  )
  ON CONFLICT (user_id, stock_code, ex_date, pay_date)
  DO UPDATE SET
    stock_name = EXCLUDED.stock_name,
    cash_dividend = EXCLUDED.cash_dividend,
    eligible_shares = EXCLUDED.eligible_shares,
    amount = EXCLUDED.amount,
    source = EXCLUDED.source,
    source_payload = EXCLUDED.source_payload,
    updated_at = now()
  RETURNING * INTO v_payment;

  IF v_payment.status <> 'paid' AND p_pay_date <= v_today THEN
    UPDATE public.users
      SET available_balance = available_balance + v_payment.amount
      WHERE id = p_user_id;

    UPDATE public.dividend_payments
      SET status = 'paid',
          paid_at = now(),
          updated_at = now()
      WHERE id = v_payment.id
        AND status <> 'paid'
      RETURNING * INTO v_payment;

    RETURN QUERY SELECT v_payment.id, v_payment.status, v_payment.eligible_shares, v_payment.amount, true;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_payment.id, v_payment.status, v_payment.eligible_shares, v_payment.amount, false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_and_credit_dividend(uuid, text, text, date, date, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_and_credit_dividend(uuid, text, text, date, date, numeric, text, jsonb) TO service_role;
