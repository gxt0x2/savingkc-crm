-- Gmail users.watch state on the existing Google OAuth row, plus a receipt
-- of Pub/Sub message ids so a redelivered push cannot import twice.
-- Receipts store the staff mailbox and history cursor only.

DO $$
BEGIN
  IF to_regclass('public.user_oauth_tokens') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.user_oauth_tokens
    ADD COLUMN IF NOT EXISTS gmail_history_id TEXT,
    ADD COLUMN IF NOT EXISTS gmail_watch_expiration TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS gmail_watch_topic TEXT;

  COMMENT ON COLUMN public.user_oauth_tokens.gmail_history_id IS
    'Gmail history cursor for users.history.list. Not message content.';
  COMMENT ON COLUMN public.user_oauth_tokens.gmail_watch_expiration IS
    'users.watch expiration. Renew before this timestamp.';
  COMMENT ON COLUMN public.user_oauth_tokens.gmail_watch_topic IS
    'Pub/Sub topic resource name passed to users.watch.';
END $$;

CREATE TABLE IF NOT EXISTS public.gmail_push_receipts (
  message_id TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL,
  history_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gmail_push_receipts_processed
  ON public.gmail_push_receipts (status, received_at);

COMMENT ON TABLE public.gmail_push_receipts IS
  'Pub/Sub message ids for Gmail push. Mailbox and history id only — never message bodies or seller addresses.';

ALTER TABLE public.gmail_push_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access gmail push receipts" ON public.gmail_push_receipts;
CREATE POLICY "Service role full access gmail push receipts"
  ON public.gmail_push_receipts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.gmail_push_receipts FROM anon, authenticated;
GRANT ALL ON public.gmail_push_receipts TO service_role;

-- hygiene-approved-destructive: delete only exact duplicate lead_emails rows
-- that share lead_id + gmail_message_id, keeping the newest sent_at, so the
-- unique index can enforce idempotent Gmail push ingest. No other rows are removed.
DO $$
BEGIN
  IF to_regclass('public.lead_emails') IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.lead_emails
  WHERE ctid IN (
    SELECT ctid
    FROM (
      SELECT ctid,
             row_number() OVER (
               PARTITION BY lead_id, gmail_message_id
               ORDER BY sent_at DESC NULLS LAST, ctid DESC
             ) AS rn
      FROM public.lead_emails
      WHERE gmail_message_id IS NOT NULL
    ) ranked
    WHERE rn > 1
  );

  CREATE UNIQUE INDEX IF NOT EXISTS lead_emails_lead_id_gmail_message_id_key
    ON public.lead_emails (lead_id, gmail_message_id);
END $$;
