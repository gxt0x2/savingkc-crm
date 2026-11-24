-- Per-phone voice hold (handoff Item 10, 2026-11-06).
--
-- An agent can pause outbound VOICE to one number without writing an SMS
-- STOP. Dialer eligibility blocks voice_hold=true numbers on every surface
-- with reason 'voice_hold' / reasonSource 'prospect_phones.voice_hold'.
-- SMS gating is unchanged: SMS STOP still lives only in sms_opt_outs and
-- still does not block CRM voice unless the reason is an internal voice DNC.

ALTER TABLE public.prospect_phones
  ADD COLUMN IF NOT EXISTS voice_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_hold_reason text,
  ADD COLUMN IF NOT EXISTS voice_hold_at timestamptz,
  ADD COLUMN IF NOT EXISTS voice_hold_by text;

CREATE INDEX IF NOT EXISTS prospect_phones_voice_hold_phone_idx
  ON public.prospect_phones (phone)
  WHERE voice_hold;

COMMENT ON COLUMN public.prospect_phones.voice_hold IS
  'Agent-set hold on outbound voice for this number. Distinct from SMS opt-out (sms_opt_outs).';
