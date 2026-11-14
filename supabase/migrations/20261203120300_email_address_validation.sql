-- Additive email validation ledger. Existing rows in other tables are left unchanged.
-- Invalid, disposable, and hard-bounce addresses are excluded by application send paths.

CREATE TABLE IF NOT EXISTS public.email_address_validations (
  normalized_email text PRIMARY KEY,
  email_status text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  provider text,
  raw_result jsonb,
  is_role boolean NOT NULL DEFAULT false,
  local_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_address_validations_email_check CHECK (
    char_length(normalized_email) BETWEEN 3 AND 320
    AND normalized_email = lower(normalized_email)
    AND position('@' IN normalized_email) > 1
  ),
  CONSTRAINT email_address_validations_status_check CHECK (
    email_status IN ('valid', 'invalid', 'catch_all', 'unknown', 'unverified', 'disposable')
  ),
  CONSTRAINT email_address_validations_provider_check CHECK (
    provider IS NULL OR provider IN ('local', 'millionverifier', 'zerobounce', 'bounce')
  ),
  CONSTRAINT email_address_validations_raw_check CHECK (
    raw_result IS NULL OR jsonb_typeof(raw_result) = 'object'
  ),
  CONSTRAINT email_address_validations_local_check CHECK (
    jsonb_typeof(local_checks) = 'object'
  )
);

CREATE INDEX IF NOT EXISTS email_address_validations_provider_checked_idx
  ON public.email_address_validations (provider, checked_at DESC);

COMMENT ON TABLE public.email_address_validations IS
  'One deliverability decision per normalized email. Invalid, disposable, and hard-bounce rows are excluded from sending. This ledger does not delete addresses.';

CREATE TABLE IF NOT EXISTS public.email_validation_usage (
  usage_date date PRIMARY KEY,
  provider_checks integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_validation_usage_checks_check CHECK (provider_checks >= 0)
);

COMMENT ON TABLE public.email_validation_usage IS
  'UTC-day count of completed MillionVerifier checks. Enforces EMAIL_VALIDATION_DAILY_CAP.';

ALTER TABLE public.email_address_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_validation_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_address_validations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.email_validation_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.email_address_validations TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.email_validation_usage TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_email_validation_check_v1(p_cap integer)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  reserved integer;
BEGIN
  IF p_cap IS NULL OR p_cap < 1 THEN
    RETURN false;
  END IF;
  INSERT INTO public.email_validation_usage (usage_date, provider_checks)
  VALUES ((timezone('utc', now()))::date, 1)
  ON CONFLICT (usage_date) DO UPDATE
    SET provider_checks = public.email_validation_usage.provider_checks + 1,
        updated_at = now()
    WHERE public.email_validation_usage.provider_checks < p_cap
  RETURNING provider_checks INTO reserved;
  RETURN reserved IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_email_validation_check_v1()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.email_validation_usage
  SET provider_checks = GREATEST(provider_checks - 1, 0),
      updated_at = now()
  WHERE usage_date = (timezone('utc', now()))::date;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_email_validation_check_v1(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_email_validation_check_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_email_validation_check_v1(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_email_validation_check_v1() TO service_role;

DO $$
BEGIN
  IF to_regclass('public.em_provider_events') IS NULL THEN
    RAISE NOTICE 'em_provider_events is absent; skipping bounce_type';
    RETURN;
  END IF;
  ALTER TABLE public.em_provider_events
    ADD COLUMN IF NOT EXISTS bounce_type text;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'em_provider_events_bounce_type_check'
      AND conrelid = 'public.em_provider_events'::regclass
  ) THEN
    ALTER TABLE public.em_provider_events
      ADD CONSTRAINT em_provider_events_bounce_type_check
      CHECK (bounce_type IS NULL OR char_length(bounce_type) <= 80);
  END IF;
END $$;
