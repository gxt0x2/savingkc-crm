-- Heir Dialer: add call-attempt tracking to prospect_phones.
--
-- Relative names + phones are already stored in prospect_phones (contact_name,
-- relationship, phone_type). What was missing: a way to mark a phone as
-- attempted, persist the last disposition, and show ✓ in the UI. These three
-- columns close that gap without introducing a new table.
--
-- Attempt HISTORY (every call, immutable) lives in lead_activities as before
-- with metadata.prospect_phone_id set. These columns are the denormalized
-- "most recent" view for fast UI rendering.

ALTER TABLE public.prospect_phones
  ADD COLUMN IF NOT EXISTS attempted        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_disposition text,
  ADD COLUMN IF NOT EXISTS last_attempt_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_by  text;

-- Partial index to speed up the common "unattempted phones for this lead" query
-- driven by HeirsSection and the dialer queue builder.
CREATE INDEX IF NOT EXISTS idx_prospect_phones_unattempted
  ON public.prospect_phones (prospect_id)
  WHERE attempted = false;
