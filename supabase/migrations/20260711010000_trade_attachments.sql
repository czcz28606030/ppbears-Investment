-- Trade note attachments and automatic WEBP snapshots.
-- Apply in Supabase SQL Editor before deploying the matching frontend.

CREATE TABLE IF NOT EXISTS public.trade_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  stock_code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('auto_snapshot', 'manual')),
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0 CHECK (file_size >= 0),
  snapshot_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trade_attachments_auto_snapshot_mime_check
    CHECK (
      (kind = 'auto_snapshot' AND mime_type = 'image/webp')
      OR
      (kind = 'manual' AND mime_type IN ('image/jpeg', 'image/png', 'application/pdf'))
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS trade_attachments_one_auto_snapshot_per_trade
  ON public.trade_attachments(trade_id)
  WHERE kind = 'auto_snapshot';

CREATE INDEX IF NOT EXISTS trade_attachments_user_stock_kind_idx
  ON public.trade_attachments(user_id, stock_code, kind);

CREATE INDEX IF NOT EXISTS trade_attachments_trade_id_idx
  ON public.trade_attachments(trade_id);

ALTER TABLE public.trade_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own trade attachments" ON public.trade_attachments;
CREATE POLICY "Users manage own trade attachments"
  ON public.trade_attachments FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Parents can view children trade attachments" ON public.trade_attachments;
CREATE POLICY "Parents can view children trade attachments"
  ON public.trade_attachments FOR SELECT
  USING (user_id IN (SELECT id FROM public.users WHERE parent_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can view all trade attachments" ON public.trade_attachments;
CREATE POLICY "Admins can view all trade attachments"
  ON public.trade_attachments FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true));

-- Create the private bucket when it is not present yet.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'trade-attachments',
  'trade-attachments',
  false,
  10485760,
  ARRAY['image/webp', 'image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png', 'application/pdf'];

DROP POLICY IF EXISTS "Users read own trade attachment objects" ON storage.objects;
CREATE POLICY "Users read own trade attachment objects"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'trade-attachments'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1
        FROM public.users child
        WHERE child.id::text = (storage.foldername(name))[1]
          AND child.parent_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.users admin_user
        WHERE admin_user.id = auth.uid()
          AND admin_user.is_admin = true
      )
    )
  );

DROP POLICY IF EXISTS "Users insert own trade attachment objects" ON storage.objects;
CREATE POLICY "Users insert own trade attachment objects"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'trade-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users update own trade attachment objects" ON storage.objects;
CREATE POLICY "Users update own trade attachment objects"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'trade-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'trade-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users delete own trade attachment objects" ON storage.objects;
CREATE POLICY "Users delete own trade attachment objects"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'trade-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
