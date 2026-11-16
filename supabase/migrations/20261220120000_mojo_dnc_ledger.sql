-- hygiene-approved-destructive: triggers refuse DELETE and TRUNCATE. This migration deletes no rows and drops no tables.
-- Append-only Mojo DNC encode ledger (Pat, R-1114 Add.§5).
-- mojo_encode_queue is a view with columns (phone, encoded_at), the shape
-- source_list_phone_block_reasons_v1 already reads. A row leaves
-- mojo_dnc_pending when encoded_at is set. Nothing is deleted.
-- Does not read or write mojo_call_queue, and does not change Mojo, Twilio,
-- or Mercury settings.

CREATE TABLE IF NOT EXISTS public.mojo_dnc_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  e164 text NOT NULL,
  scope text NOT NULL,
  mojo_contact_id text,
  prospect_id uuid,
  source text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  honored_at timestamptz,
  encoded_at timestamptz,
  encoder text,
  mojo_confirmation text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mojo_dnc_ledger_e164_check CHECK (e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT mojo_dnc_ledger_scope_check CHECK (scope IN ('number', 'contact', 'person', 'household', 'property')),
  CONSTRAINT mojo_dnc_ledger_source_check CHECK (char_length(source) BETWEEN 1 AND 200),
  CONSTRAINT mojo_dnc_ledger_note_check CHECK (note IS NULL OR char_length(note) <= 2000)
);

COMMENT ON TABLE public.mojo_dnc_ledger IS
  'Append-only DNC encode ledger. No deletes. Retain each row for 5 years (47 CFR 64.1200(d)(6), 16 CFR 310.5).';

COMMENT ON COLUMN public.mojo_dnc_ledger.scope IS
  'number, contact, person, household, or property.';

COMMENT ON COLUMN public.mojo_dnc_ledger.encoded_at IS
  'When the number was encoded into Mojo. Null rows are mojo_dnc_pending and block export as mojo_encode_pending.';

ALTER TABLE public.mojo_dnc_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mojo_dnc_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mojo_dnc_ledger TO service_role;

CREATE INDEX IF NOT EXISTS idx_mojo_dnc_ledger_pending_phone
  ON public.mojo_dnc_ledger (public.prospecting_phone_key_v1(e164))
  WHERE encoded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mojo_dnc_ledger_prospect
  ON public.mojo_dnc_ledger (prospect_id)
  WHERE prospect_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mojo_dnc_ledger_forbid_delete_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'mojo_dnc_ledger_append_only';
END;
$function$;

CREATE OR REPLACE FUNCTION public.mojo_dnc_ledger_stamp_only_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.e164 IS DISTINCT FROM OLD.e164
    OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW.mojo_contact_id IS DISTINCT FROM OLD.mojo_contact_id
    OR NEW.prospect_id IS DISTINCT FROM OLD.prospect_id
    OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.received_at IS DISTINCT FROM OLD.received_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'mojo_dnc_ledger_append_only';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS mojo_dnc_ledger_no_delete ON public.mojo_dnc_ledger;
CREATE TRIGGER mojo_dnc_ledger_no_delete
  BEFORE DELETE ON public.mojo_dnc_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.mojo_dnc_ledger_forbid_delete_v1();

DROP TRIGGER IF EXISTS mojo_dnc_ledger_no_truncate ON public.mojo_dnc_ledger;
CREATE TRIGGER mojo_dnc_ledger_no_truncate
  BEFORE TRUNCATE ON public.mojo_dnc_ledger
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.mojo_dnc_ledger_forbid_delete_v1();

DROP TRIGGER IF EXISTS mojo_dnc_ledger_stamp_only ON public.mojo_dnc_ledger;
CREATE TRIGGER mojo_dnc_ledger_stamp_only
  BEFORE UPDATE ON public.mojo_dnc_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.mojo_dnc_ledger_stamp_only_v1();

REVOKE ALL ON FUNCTION public.mojo_dnc_ledger_forbid_delete_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mojo_dnc_ledger_stamp_only_v1() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.mojo_dnc_pending
WITH (security_invoker = true) AS
SELECT
  id,
  e164,
  scope,
  mojo_contact_id,
  prospect_id,
  source,
  received_at,
  honored_at,
  encoded_at,
  encoder,
  mojo_confirmation,
  note,
  created_at
FROM public.mojo_dnc_ledger
WHERE encoded_at IS NULL;

COMMENT ON VIEW public.mojo_dnc_pending IS
  'Ledger rows still waiting to be encoded. encoded_at is null. Export scrub reads these through mojo_encode_queue.';

CREATE OR REPLACE VIEW public.mojo_encode_queue
WITH (security_invoker = true) AS
SELECT
  e164 AS phone,
  encoded_at
FROM public.mojo_dnc_ledger;

COMMENT ON VIEW public.mojo_encode_queue IS
  'Encode-queue shape the dialer scrub already hooks: phone and encoded_at. Pending rows have encoded_at null and block as mojo_encode_pending.';

REVOKE ALL ON TABLE public.mojo_dnc_pending FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mojo_encode_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mojo_dnc_pending, public.mojo_encode_queue TO service_role;

ALTER TABLE public.crm_mojo_call_events
  ADD COLUMN IF NOT EXISTS sender_line text,
  ADD COLUMN IF NOT EXISTS consent_basis text,
  ADD COLUMN IF NOT EXISTS optout_verbatim text;

COMMENT ON COLUMN public.crm_mojo_call_events.sender_line IS
  'Calling number or line for this touch. Retain for 5 years (47 CFR 64.1200(d)(6), 16 CFR 310.5).';
COMMENT ON COLUMN public.crm_mojo_call_events.consent_basis IS
  'Consent basis for this touch. Retain for 5 years (47 CFR 64.1200(d)(6), 16 CFR 310.5).';
COMMENT ON COLUMN public.crm_mojo_call_events.optout_verbatim IS
  'Verbatim opt-out text for this touch. Retain for 5 years (47 CFR 64.1200(d)(6), 16 CFR 310.5).';

COMMENT ON TABLE public.crm_mojo_call_events IS
  'Immutable provider-call evidence. Mojo facts are canonical here; AI interpretation requires a separate reviewed proposal. sender_line, consent_basis, and optout_verbatim are the touch log and are retained for 5 years (47 CFR 64.1200(d)(6), 16 CFR 310.5).';
