-- Append-only caller ID reputation checks.
-- Creates this log and its latest-per-number view only.
-- Apply deliberately. This file does not run itself.

CREATE TABLE IF NOT EXISTS public.caller_id_reputation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  check_slot text,
  phone_e164 text NOT NULL,
  number_label text,
  mojo_verified boolean,
  reputation_guard_status text,
  voice_integrity_attached boolean,
  last_attestation text,
  dials_today integer,
  connect_rate numeric,
  connect_rate_5d numeric,
  short_call_share numeric,
  flag_reason text,
  action_taken text,
  action_result text,
  rotation_state text,
  consecutive_clean integer,
  fix_attempts integer,
  decision_needed boolean NOT NULL DEFAULT false,
  notes text,
  raw jsonb,
  CONSTRAINT caller_id_reputation_log_check_slot_check
    CHECK (check_slot IS NULL OR check_slot IN ('am', 'pm', 'adhoc')),
  CONSTRAINT caller_id_reputation_log_phone_e164_check
    CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT caller_id_reputation_log_last_attestation_check
    CHECK (last_attestation IS NULL OR last_attestation IN ('A', 'B', 'C', 'none')),
  CONSTRAINT caller_id_reputation_log_dials_today_check
    CHECK (dials_today IS NULL OR dials_today >= 0),
  CONSTRAINT caller_id_reputation_log_connect_rate_check
    CHECK (connect_rate IS NULL OR connect_rate >= 0),
  CONSTRAINT caller_id_reputation_log_connect_rate_5d_check
    CHECK (connect_rate_5d IS NULL OR connect_rate_5d >= 0),
  CONSTRAINT caller_id_reputation_log_short_call_share_check
    CHECK (short_call_share IS NULL OR short_call_share >= 0),
  CONSTRAINT caller_id_reputation_log_rotation_state_check
    CHECK (rotation_state IS NULL OR rotation_state IN ('active', 'resting')),
  CONSTRAINT caller_id_reputation_log_consecutive_clean_check
    CHECK (consecutive_clean IS NULL OR consecutive_clean >= 0),
  CONSTRAINT caller_id_reputation_log_fix_attempts_check
    CHECK (fix_attempts IS NULL OR fix_attempts >= 0),
  CONSTRAINT caller_id_reputation_log_raw_check
    CHECK (raw IS NULL OR jsonb_typeof(raw) = 'object')
);

COMMENT ON TABLE public.caller_id_reputation_log IS
  'Append-only caller ID reputation checks. Service role may insert and read. Signed-in admins and owners may read. No update or delete path.';

CREATE INDEX IF NOT EXISTS caller_id_reputation_log_phone_checked_at_idx
  ON public.caller_id_reputation_log (phone_e164, checked_at DESC);

DO $$
BEGIN
  IF to_regclass('public.agent_profiles') IS NULL
    OR (
      SELECT count(*)
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'agent_profiles'
        AND column_name IN ('email', 'user_id', 'role', 'is_admin', 'is_active')
    ) <> 5 THEN
    RAISE EXCEPTION 'caller id reputation log requires agent_profiles email, user_id, role, is_admin, and is_active';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.is_caller_id_reputation_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agent_profiles AS profile
    WHERE profile.is_active IS DISTINCT FROM false
      AND (
        profile.user_id = auth.uid()
        OR (
          profile.user_id IS NULL
          AND lower(profile.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
        )
      )
      AND (
        COALESCE(profile.is_admin, false)
        OR lower(COALESCE(profile.role, '')) = 'owner'
      )
  );
$$;

REVOKE ALL ON FUNCTION private.is_caller_id_reputation_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_caller_id_reputation_admin() TO authenticated;

ALTER TABLE public.caller_id_reputation_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.caller_id_reputation_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.caller_id_reputation_log TO service_role;
GRANT SELECT ON TABLE public.caller_id_reputation_log TO authenticated;

DROP POLICY IF EXISTS "Service role inserts caller id reputation log" ON public.caller_id_reputation_log;
CREATE POLICY "Service role inserts caller id reputation log"
  ON public.caller_id_reputation_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role reads caller id reputation log" ON public.caller_id_reputation_log;
CREATE POLICY "Service role reads caller id reputation log"
  ON public.caller_id_reputation_log
  FOR SELECT
  TO service_role
  USING (true);

DROP POLICY IF EXISTS "Admins read caller id reputation log" ON public.caller_id_reputation_log;
CREATE POLICY "Admins read caller id reputation log"
  ON public.caller_id_reputation_log
  FOR SELECT
  TO authenticated
  USING (private.is_caller_id_reputation_admin());

CREATE OR REPLACE VIEW public.caller_id_reputation_latest
WITH (security_invoker = true) AS
SELECT DISTINCT ON (phone_e164)
  id,
  checked_at,
  check_slot,
  phone_e164,
  number_label,
  mojo_verified,
  reputation_guard_status,
  voice_integrity_attached,
  last_attestation,
  dials_today,
  connect_rate,
  connect_rate_5d,
  short_call_share,
  flag_reason,
  action_taken,
  action_result,
  rotation_state,
  consecutive_clean,
  fix_attempts,
  decision_needed,
  notes,
  raw
FROM public.caller_id_reputation_log
ORDER BY phone_e164, checked_at DESC, id DESC;

COMMENT ON VIEW public.caller_id_reputation_latest IS
  'Latest caller ID reputation check per number. security_invoker so caller_id_reputation_log row security still applies.';

REVOKE ALL ON TABLE public.caller_id_reputation_latest FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.caller_id_reputation_latest TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'caller_id_reputation_log'
      AND cmd IN ('UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'caller_id_reputation_log must stay append-only';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = 'caller_id_reputation_log'
      AND grantee IN ('PUBLIC', 'anon')
  ) THEN
    RAISE EXCEPTION 'caller_id_reputation_log must not be exposed to anon';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = 'caller_id_reputation_log'
      AND grantee IN ('authenticated', 'service_role')
      AND privilege_type IN ('UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'caller_id_reputation_log rejects mutations';
  END IF;
END $$;
