-- Outbound caller-ID health for Twilio-owned local numbers used as Mojo caller IDs.
--
-- Resting is a quality pause. It is not a rotation to evade spam labels.
-- A rested number stays rested until a person checks the cause (spam label,
-- Voice Integrity, CNAM) or rest_until has passed and a manual or health
-- check clears it. This migration does not release, delete, or dial any number,
-- and it does not read or write the dialer import queue.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.caller_ids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL UNIQUE,
  area_code text NOT NULL,
  status text NOT NULL,
  rest_until timestamptz,
  rest_reason text,
  metrics_snapshot jsonb,
  held_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caller_ids_phone_check CHECK (phone_e164 ~ '^\+1[0-9]{10}$'),
  CONSTRAINT caller_ids_area_check CHECK (area_code ~ '^[0-9]{3}$' AND substring(phone_e164 from 3 for 3) = area_code),
  CONSTRAINT caller_ids_status_check CHECK (status IN ('active', 'spare', 'resting', 'held')),
  CONSTRAINT caller_ids_rest_check CHECK (
    status <> 'resting'
    OR (
      rest_until IS NOT NULL
      AND rest_reason IS NOT NULL
      AND char_length(rest_reason) BETWEEN 1 AND 500
    )
  ),
  CONSTRAINT caller_ids_held_check CHECK (
    (status = 'held' AND held_reason IS NOT NULL AND char_length(held_reason) BETWEEN 1 AND 200)
    OR (status <> 'held' AND held_reason IS NULL)
  ),
  CONSTRAINT caller_ids_rest_reason_check CHECK (rest_reason IS NULL OR char_length(rest_reason) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_caller_ids_status_area
  ON public.caller_ids (status, area_code, phone_e164);

ALTER TABLE public.caller_ids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.caller_ids FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.caller_ids TO service_role;

COMMENT ON TABLE public.caller_ids IS
  'Twilio-owned local numbers used as Mojo caller IDs. status resting is a quality pause, not a rotation to evade spam labels. Held rows are spam or high-risk parks and are not released. The health job never deletes a row.';

CREATE TABLE IF NOT EXISTS public.caller_id_health_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id_id uuid REFERENCES public.caller_ids(id),
  phone_e164 text,
  event_type text NOT NULL,
  reason text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caller_id_health_events_phone_check CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+1[0-9]{10}$'),
  CONSTRAINT caller_id_health_events_phone_required_check CHECK (event_type = 'run' OR phone_e164 IS NOT NULL),
  CONSTRAINT caller_id_health_events_type_check CHECK (
    event_type IN ('rest', 'cap_note', 'promote', 'rest_elapsed_needs_clearance', 'rest_confirmed', 'run')
  ),
  CONSTRAINT caller_id_health_events_reason_check CHECK (char_length(reason) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_caller_id_health_events_day
  ON public.caller_id_health_events (event_type, phone_e164, created_at DESC);

ALTER TABLE public.caller_id_health_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.caller_id_health_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.caller_id_health_events TO service_role;

COMMENT ON TABLE public.caller_id_health_events IS
  'Why a caller ID was rested, capped, or promoted. Rest events are quality pauses. Nothing in this table releases or deletes a number.';

-- Starting inventory. Three allowlisted cold lines stay active, the fourth is
-- the spare, and the 2026-09-23 spam/high-risk parks stay held. Re-applying
-- this insert does not change a number the health job has already rested.
INSERT INTO public.caller_ids (phone_e164, area_code, status, held_reason)
VALUES
  ('+18166404701', '816', 'active', NULL),
  ('+18165788107', '816', 'active', NULL),
  ('+18166536616', '816', 'active', NULL),
  ('+18164761344', '816', 'spare', NULL),
  ('+18162538313', '816', 'held', 'hard spam/scam flag; do not release'),
  ('+18166408032', '816', 'held', 'hard spam/scam flag; do not release'),
  ('+18163100845', '816', 'held', 'elevated / high risk; do not release'),
  ('+18164761589', '816', 'held', 'elevated / high risk; do not release')
ON CONFLICT (phone_e164) DO NOTHING;

ALTER TABLE public.crm_mojo_calls
  ADD COLUMN IF NOT EXISTS caller_id text;

ALTER TABLE public.crm_mojo_calls
  DROP CONSTRAINT IF EXISTS crm_mojo_calls_caller_id_check;
ALTER TABLE public.crm_mojo_calls
  ADD CONSTRAINT crm_mojo_calls_caller_id_check
  CHECK (caller_id IS NULL OR caller_id ~ '^\+1[0-9]{10}$');

CREATE INDEX IF NOT EXISTS idx_crm_mojo_calls_caller_time
  ON public.crm_mojo_calls (caller_id, call_at DESC, id DESC)
  WHERE caller_id IS NOT NULL;

COMMENT ON COLUMN public.crm_mojo_calls.caller_id IS
  'Our outbound caller ID in E.164 when Mojo provided one. Prospect numbers stay last-four only. A masked caller ID stays null.';

-- Teach the existing upsert to keep caller_id without restating the function.
-- A missing or masked caller ID does not wipe one already stored. The helper
-- is removed after the patch so it is not a lasting entry point.
CREATE OR REPLACE FUNCTION public.caller_id_health_replace_once(body text, marker text, replacement text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  found integer;
BEGIN
  IF marker IS NULL OR marker = '' OR position(marker IN body) = 0 THEN
    RAISE EXCEPTION 'caller_id_patch_marker_missing';
  END IF;
  found := (length(body) - length(replace(body, marker, ''))) / length(marker);
  IF found <> 1 THEN
    RAISE EXCEPTION 'caller_id_patch_marker_count_%', found;
  END IF;
  RETURN replace(body, marker, replacement);
END
$$;

DO $patch$
DECLARE
  definition text := pg_get_functiondef('public.upsert_crm_mojo_call_v1(jsonb)'::regprocedure);
BEGIN
  IF position('caller_id_value' IN definition) > 0 THEN
    RETURN;
  END IF;

  definition := public.caller_id_health_replace_once(definition, 'source_value text;', E'source_value text;\n  caller_id_value text;');
  definition := public.caller_id_health_replace_once(definition, '''lead_exists'', ''source''', '''lead_exists'', ''source'', ''caller_id''');
  definition := public.caller_id_health_replace_once(
    definition,
    'RAISE EXCEPTION ''invalid_mojo_call_source'';',
    E'RAISE EXCEPTION ''invalid_mojo_call_source'';\n  END IF;\n\n  caller_id_value := nullif(btrim(coalesce(p_call->>''caller_id'', '''')), '''');\n  IF caller_id_value IS NOT NULL AND caller_id_value !~ ''^\\+1[0-9]{10}$'' THEN\n    RAISE EXCEPTION ''invalid_mojo_caller_id'';'
  );
  definition := public.caller_id_health_replace_once(
    definition,
    'AND existing.source = source_value THEN',
    E'AND existing.source = source_value\n     AND (caller_id_value IS NULL OR existing.caller_id IS NOT DISTINCT FROM caller_id_value) THEN'
  );
  definition := public.caller_id_health_replace_once(definition, 'lead_exists, source', 'lead_exists, source, caller_id');
  definition := public.caller_id_health_replace_once(definition, 'lead_exists_value, source_value', 'lead_exists_value, source_value, caller_id_value');
  definition := public.caller_id_health_replace_once(
    definition,
    'source = EXCLUDED.source,',
    E'source = EXCLUDED.source,\n    caller_id = COALESCE(EXCLUDED.caller_id, public.crm_mojo_calls.caller_id),'
  );

  EXECUTE definition;
END
$patch$;

DROP FUNCTION public.caller_id_health_replace_once(text, text, text);
