-- Draft-only Tuesday newsletter contacts and schedules.
-- Rows are inserted disabled. This migration does not enroll recipients or send mail.

CREATE TABLE IF NOT EXISTS public.em_newsletter_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_email text NOT NULL CHECK (position('@' in normalized_email) > 1),
  role text NOT NULL CHECK (role IN ('seller', 'buyer')),
  county text NOT NULL CHECK (county IN ('Jackson', 'Clay', 'Platte', 'Cass', 'Johnson KS', 'Wyandotte KS', 'Other')),
  tags jsonb NOT NULL CHECK (jsonb_typeof(tags) = 'array'),
  consent_text text NOT NULL CHECK (char_length(trim(consent_text)) BETWEEN 8 AND 500),
  consent_recorded_at timestamptz NOT NULL,
  consent_source text NOT NULL CHECK (consent_source ~ '^[a-z0-9-]{1,80}$'),
  status text NOT NULL DEFAULT 'subscribed' CHECK (status IN ('subscribed', 'suppressed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_email, role)
);

CREATE INDEX IF NOT EXISTS em_newsletter_contacts_email_idx
  ON public.em_newsletter_contacts (normalized_email);

CREATE TABLE IF NOT EXISTS public.em_newsletter_schedules (
  edition_key text PRIMARY KEY CHECK (edition_key IN ('tuesday_note', 'tuesday_deal_desk')),
  program text NOT NULL CHECK (program IN ('seller_nurture', 'buyer_marketing')),
  display_name text NOT NULL,
  from_mailbox text NOT NULL CHECK (from_mailbox = 'ernest@talktosavingkc.com'),
  weekday text NOT NULL CHECK (weekday = 'tuesday'),
  send_local text NOT NULL CHECK (send_local = '07:00'),
  timezone text NOT NULL CHECK (timezone = 'America/Chicago'),
  state text NOT NULL DEFAULT 'disabled' CHECK (state IN ('disabled', 'draft')),
  mode text NOT NULL DEFAULT 'draft_only' CHECK (mode = 'draft_only'),
  owner_approved boolean NOT NULL DEFAULT false,
  CHECK (
    (edition_key = 'tuesday_note' AND program = 'seller_nurture')
    OR (edition_key = 'tuesday_deal_desk' AND program = 'buyer_marketing')
  ),
  CHECK (state = 'disabled' OR owner_approved = true)
);

INSERT INTO public.em_newsletter_schedules (
  edition_key, program, display_name, from_mailbox, weekday, send_local, timezone, state, mode, owner_approved
) VALUES
  ('tuesday_note', 'seller_nurture', 'The Tuesday Note', 'ernest@talktosavingkc.com', 'tuesday', '07:00', 'America/Chicago', 'disabled', 'draft_only', false),
  ('tuesday_deal_desk', 'buyer_marketing', 'The Tuesday Deal Desk', 'ernest@talktosavingkc.com', 'tuesday', '07:00', 'America/Chicago', 'disabled', 'draft_only', false)
ON CONFLICT (edition_key) DO NOTHING;

ALTER TABLE public.em_newsletter_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_newsletter_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.em_newsletter_contacts, public.em_newsletter_schedules FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.em_newsletter_contacts, public.em_newsletter_schedules TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'email_workflow_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON public.em_newsletter_contacts, public.em_newsletter_schedules TO email_workflow_runtime;
  END IF;
END $$;
