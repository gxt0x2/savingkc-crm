-- Heir Dialer: add contact_address to prospect_phones so the dialer UI can
-- show the relative's last-known address alongside their phone. Existing
-- rows stay null until the lead is re-synced through /api/heirs/sync.

ALTER TABLE public.prospect_phones
  ADD COLUMN IF NOT EXISTS contact_address text;
