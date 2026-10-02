-- Dedicated paper ledger. Never grants clients write access or executes broker orders.
BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS paper_trading_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS public.paper_trading_accounts (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0,
  state jsonb NOT NULL,
  last_run_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.paper_trading_days (
  user_id uuid NOT NULL REFERENCES public.paper_trading_accounts(user_id) ON DELETE CASCADE,
  record_date date NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,record_date)
);
ALTER TABLE public.paper_trading_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_trading_days ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.paper_trading_prices (
  user_id uuid NOT NULL REFERENCES public.paper_trading_accounts(user_id) ON DELETE CASCADE,
  code text NOT NULL,
  price_date date NOT NULL,
  bar jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,code,price_date)
);
ALTER TABLE public.paper_trading_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_trading_accounts,public.paper_trading_days FROM anon,authenticated;
GRANT SELECT ON public.paper_trading_accounts,public.paper_trading_days TO authenticated;
GRANT ALL ON public.paper_trading_accounts,public.paper_trading_days TO service_role;
REVOKE ALL ON public.paper_trading_prices FROM anon,authenticated;
GRANT SELECT ON public.paper_trading_prices TO authenticated;
GRANT ALL ON public.paper_trading_prices TO service_role;
CREATE POLICY paper_prices_read ON public.paper_trading_prices FOR SELECT TO authenticated
  USING (user_id=auth.uid() OR public.is_admin() OR EXISTS(SELECT 1 FROM public.users WHERE id=user_id AND parent_id=auth.uid()));
CREATE POLICY paper_accounts_read ON public.paper_trading_accounts FOR SELECT TO authenticated
  USING (user_id=auth.uid() OR public.is_admin() OR EXISTS(SELECT 1 FROM public.users WHERE id=user_id AND parent_id=auth.uid()));
CREATE POLICY paper_days_read ON public.paper_trading_days FOR SELECT TO authenticated
  USING (user_id=auth.uid() OR public.is_admin() OR EXISTS(SELECT 1 FROM public.users WHERE id=user_id AND parent_id=auth.uid()));

CREATE OR REPLACE FUNCTION public.commit_paper_trading(p_user_id uuid,p_revision bigint,p_state jsonb,p_records jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_revision bigint; v_record jsonb; v_state jsonb;
BEGIN
  SELECT revision,state INTO v_revision,v_state FROM paper_trading_accounts WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'paper_account_not_found'; END IF;
  IF v_revision<>p_revision THEN RAISE EXCEPTION 'paper_revision_conflict'; END IF;
  IF p_state->>'source'<>v_state->>'source' OR p_state->>'startDate'<>v_state->>'startDate'
    OR p_state->>'endDate'<>v_state->>'endDate' OR p_state->'config'<>v_state->'config'
    OR p_state->>'initialCash'<>v_state->>'initialCash' THEN RAISE EXCEPTION 'paper_config_immutable'; END IF;
  IF (p_state->>'cash')::numeric<0 THEN RAISE EXCEPTION 'paper_negative_cash'; END IF;
  FOR v_record IN SELECT value FROM jsonb_array_elements(p_records) LOOP
    INSERT INTO paper_trading_days(user_id,record_date,payload) VALUES(p_user_id,(v_record->>'date')::date,v_record);
  END LOOP;
  UPDATE paper_trading_accounts SET state=p_state,revision=revision+1,last_run_at=now(),last_error=NULL,updated_at=now() WHERE user_id=p_user_id;
  RETURN v_revision+1;
END $$;
REVOKE ALL ON FUNCTION public.commit_paper_trading(uuid,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_paper_trading(uuid,bigint,jsonb,jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
