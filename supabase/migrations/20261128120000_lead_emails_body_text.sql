-- Additive nullable plain-text body for lead-matched Gmail messages.
-- Existing rows stay null until sync fills them. No backfill in SQL.

DO $$
BEGIN
  IF to_regclass('public.lead_emails') IS NULL THEN
    RAISE NOTICE 'lead_emails is absent; skipping body_text';
    RETURN;
  END IF;
  ALTER TABLE public.lead_emails ADD COLUMN IF NOT EXISTS body_text text;
END $$;
