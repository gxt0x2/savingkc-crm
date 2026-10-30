-- Segment presets for the draft Tuesday newsletters.
-- Adds em_newsletter_contacts.segment (default general) and replaces the two
-- schedule rows with one disabled draft row per segment.
-- Does not enroll recipients, delete rows, or send mail.

ALTER TABLE public.em_newsletter_contacts
  ADD COLUMN IF NOT EXISTS segment text NOT NULL DEFAULT 'general';

UPDATE public.em_newsletter_contacts
SET segment = 'investor'
WHERE role = 'buyer'
  AND segment = 'general';

ALTER TABLE public.em_newsletter_contacts
  DROP CONSTRAINT IF EXISTS em_newsletter_contacts_segment_check;

ALTER TABLE public.em_newsletter_contacts
  ADD CONSTRAINT em_newsletter_contacts_segment_check
  CHECK (segment IN ('general', 'tax', 'inherited', 'investor'));

ALTER TABLE public.em_newsletter_contacts
  DROP CONSTRAINT IF EXISTS em_newsletter_contacts_segment_role_check;

ALTER TABLE public.em_newsletter_contacts
  ADD CONSTRAINT em_newsletter_contacts_segment_role_check
  CHECK (
    (segment IN ('general', 'tax', 'inherited') AND role = 'seller')
    OR (segment = 'investor' AND role = 'buyer')
  );

-- Drop only edition pairing checks so the four segment keys can replace the original two.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'em_newsletter_schedules'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%edition_key%'
  LOOP
    EXECUTE format('ALTER TABLE public.em_newsletter_schedules DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.em_newsletter_schedules
  ADD COLUMN IF NOT EXISTS segment text;

UPDATE public.em_newsletter_schedules
SET edition_key = 'tuesday_note_general'
WHERE edition_key = 'tuesday_note'
  AND NOT EXISTS (
    SELECT 1
    FROM public.em_newsletter_schedules existing
    WHERE existing.edition_key = 'tuesday_note_general'
  );

INSERT INTO public.em_newsletter_schedules (
  edition_key, program, display_name, from_mailbox, weekday, send_local, timezone, state, mode, owner_approved, segment
) VALUES
  ('tuesday_note_general', 'seller_nurture', 'The Tuesday Note', 'ernest@talktosavingkc.com', 'tuesday', '07:00', 'America/Chicago', 'disabled', 'draft_only', false, 'general'),
  ('tuesday_note_tax', 'seller_nurture', 'The Tuesday Note for taxes', 'ernest@talktosavingkc.com', 'tuesday', '07:00', 'America/Chicago', 'disabled', 'draft_only', false, 'tax'),
  ('tuesday_note_inherited', 'seller_nurture', 'The Tuesday Note for inherited houses', 'ernest@talktosavingkc.com', 'tuesday', '07:00', 'America/Chicago', 'disabled', 'draft_only', false, 'inherited'),
  ('tuesday_deal_desk', 'buyer_marketing', 'The Tuesday Deal Desk', 'ernest@talktosavingkc.com', 'tuesday', '07:00', 'America/Chicago', 'disabled', 'draft_only', false, 'investor')
ON CONFLICT (edition_key) DO UPDATE SET
  program = EXCLUDED.program,
  display_name = EXCLUDED.display_name,
  from_mailbox = EXCLUDED.from_mailbox,
  weekday = EXCLUDED.weekday,
  send_local = EXCLUDED.send_local,
  timezone = EXCLUDED.timezone,
  state = 'disabled',
  mode = 'draft_only',
  owner_approved = false,
  segment = EXCLUDED.segment;

ALTER TABLE public.em_newsletter_schedules
  ALTER COLUMN segment SET NOT NULL;

ALTER TABLE public.em_newsletter_schedules
  DROP CONSTRAINT IF EXISTS em_newsletter_schedules_segment_check;

ALTER TABLE public.em_newsletter_schedules
  ADD CONSTRAINT em_newsletter_schedules_segment_check
  CHECK (segment IN ('general', 'tax', 'inherited', 'investor'));

ALTER TABLE public.em_newsletter_schedules
  DROP CONSTRAINT IF EXISTS em_newsletter_schedules_segment_key;

ALTER TABLE public.em_newsletter_schedules
  ADD CONSTRAINT em_newsletter_schedules_segment_key UNIQUE (segment);

ALTER TABLE public.em_newsletter_schedules
  DROP CONSTRAINT IF EXISTS em_newsletter_schedules_edition_segment_check;

ALTER TABLE public.em_newsletter_schedules
  ADD CONSTRAINT em_newsletter_schedules_edition_segment_check
  CHECK (
    (edition_key = 'tuesday_note_general' AND segment = 'general' AND program = 'seller_nurture')
    OR (edition_key = 'tuesday_note_tax' AND segment = 'tax' AND program = 'seller_nurture')
    OR (edition_key = 'tuesday_note_inherited' AND segment = 'inherited' AND program = 'seller_nurture')
    OR (edition_key = 'tuesday_deal_desk' AND segment = 'investor' AND program = 'buyer_marketing')
  );
