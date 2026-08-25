-- Repair a production schema drift where the legacy 20260602 migration was
-- recorded but its prospect-phone verification columns were absent. These
-- fields are required by the reviewed county campaign enrollment function and
-- by the heir-contact verification workflow.

SET lock_timeout = '10s';
SET statement_timeout = '2min';

ALTER TABLE public.prospect_phones
  ADD COLUMN IF NOT EXISTS is_verified_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by text,
  ADD COLUMN IF NOT EXISTS verified_source text;

CREATE INDEX IF NOT EXISTS idx_prospect_phones_verified
  ON public.prospect_phones (prospect_id)
  WHERE is_verified_contact = true;

COMMENT ON COLUMN public.prospect_phones.is_verified_contact IS
  'True when an operator or a reached disposition verifies this number belongs to the associated contact.';
COMMENT ON COLUMN public.prospect_phones.verified_source IS
  'Verification provenance: manual, auto, or null when unverified.';

