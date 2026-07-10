-- Trade attachment retention setting and admin cleanup policies.
-- Apply after 20260711010000_trade_attachments.sql.

INSERT INTO public.system_settings (setting_key, setting_value, updated_at)
VALUES ('trade_attachment_retention_months', 24, now())
ON CONFLICT (setting_key) DO NOTHING;

DROP POLICY IF EXISTS "Admins can delete expired trade attachments" ON public.trade_attachments;
CREATE POLICY "Admins can delete expired trade attachments"
  ON public.trade_attachments FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
    AND COALESCE((
      SELECT NULLIF(setting_value::text, '')::int
      FROM public.system_settings
      WHERE setting_key = 'trade_attachment_retention_months'
    ), 24) > 0
    AND created_at < now() - make_interval(months => COALESCE((
      SELECT NULLIF(setting_value::text, '')::int
      FROM public.system_settings
      WHERE setting_key = 'trade_attachment_retention_months'
    ), 24))
  );

DROP POLICY IF EXISTS "Admins can delete expired trade attachment objects" ON storage.objects;
CREATE POLICY "Admins can delete expired trade attachment objects"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'trade-attachments'
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = true)
    AND COALESCE((
      SELECT NULLIF(setting_value::text, '')::int
      FROM public.system_settings
      WHERE setting_key = 'trade_attachment_retention_months'
    ), 24) > 0
    AND EXISTS (
      SELECT 1
      FROM public.trade_attachments ta
      WHERE ta.storage_path = storage.objects.name
        AND ta.created_at < now() - make_interval(months => COALESCE((
          SELECT NULLIF(setting_value::text, '')::int
          FROM public.system_settings
          WHERE setting_key = 'trade_attachment_retention_months'
        ), 24))
    )
  );