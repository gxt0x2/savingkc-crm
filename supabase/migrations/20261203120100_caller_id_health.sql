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
    event_type IN ('rest', 'cap_note', 'promote', 'rest_elapsed_needs_clearance', 'rest_confirmed', 'run', 'load')
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

-- The pool starts empty. +18166404701, +18165788107, +18166536616, and
-- +18164761344 were released from Twilio on 2026-10-30 and must not be loaded.
-- New numbers are inserted only by upsert_caller_id_v1 after the owner verifies
-- each one as a Mojo caller ID. The health job does not insert numbers.

CREATE OR REPLACE FUNCTION public.upsert_caller_id_v1(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  phone_value text;
  status_value text;
  rest_until_value timestamptz;
  rest_reason_value text;
  held_reason_value text;
  area_value text;
  stored public.caller_ids;
BEGIN
  IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_caller_id';
  END IF;
  IF coalesce(p_row->>'mojo_verified', '') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'mojo_caller_id_not_verified';
  END IF;

  phone_value := nullif(btrim(coalesce(p_row->>'phone', '')), '');
  IF phone_value IS NULL OR phone_value !~ '^\+1[0-9]{10}$' THEN
    RAISE EXCEPTION 'invalid_caller_id_phone';
  END IF;
  IF phone_value IN ('+18166404701', '+18165788107', '+18166536616', '+18164761344') THEN
    RAISE EXCEPTION 'released_caller_id';
  END IF;

  status_value := nullif(btrim(coalesce(p_row->>'status', '')), '');
  IF status_value IS NULL OR status_value NOT IN ('active', 'spare', 'resting', 'held') THEN
    RAISE EXCEPTION 'invalid_caller_id_status';
  END IF;
  area_value := substring(phone_value from 3 for 3);

  rest_reason_value := nullif(btrim(coalesce(p_row->>'rest_reason', '')), '');
  held_reason_value := nullif(btrim(coalesce(p_row->>'held_reason', '')), '');
  IF status_value = 'resting' THEN
    IF coalesce(p_row->>'rest_until', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN
      RAISE EXCEPTION 'invalid_caller_id_rest_until';
    END IF;
    rest_until_value := (p_row->>'rest_until')::timestamptz;
    IF rest_until_value IS NULL OR rest_reason_value IS NULL OR char_length(rest_reason_value) > 500 THEN
      RAISE EXCEPTION 'invalid_caller_id_rest';
    END IF;
    held_reason_value := NULL;
  ELSIF status_value = 'held' THEN
    IF held_reason_value IS NULL OR char_length(held_reason_value) > 200 THEN
      RAISE EXCEPTION 'invalid_caller_id_hold';
    END IF;
    rest_until_value := NULL;
    rest_reason_value := NULL;
  ELSE
    rest_until_value := NULL;
    rest_reason_value := NULL;
    held_reason_value := NULL;
  END IF;

  INSERT INTO public.caller_ids (
    phone_e164, area_code, status, rest_until, rest_reason, held_reason, updated_at
  ) VALUES (
    phone_value, area_value, status_value, rest_until_value, rest_reason_value, held_reason_value, now()
  )
  ON CONFLICT (phone_e164) DO UPDATE SET
    status = EXCLUDED.status,
    rest_until = EXCLUDED.rest_until,
    rest_reason = EXCLUDED.rest_reason,
    held_reason = EXCLUDED.held_reason,
    updated_at = now()
  RETURNING * INTO stored;

  INSERT INTO public.caller_id_health_events (caller_id_id, phone_e164, event_type, reason, metrics)
  VALUES (
    stored.id,
    stored.phone_e164,
    'load',
    'Loaded after the owner attested Mojo caller-ID verification. This does not release or delete a number.',
    jsonb_build_object('status', stored.status, 'areaCode', stored.area_code, 'mojoVerified', true)
  );

  RETURN jsonb_build_object(
    'phone', stored.phone_e164,
    'areaCode', stored.area_code,
    'status', stored.status,
    'restUntil', stored.rest_until,
    'restReason', stored.rest_reason,
    'heldReason', stored.held_reason
  );
END
$$;

REVOKE ALL ON FUNCTION public.upsert_caller_id_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_caller_id_v1(jsonb) TO service_role;

COMMENT ON FUNCTION public.upsert_caller_id_v1(jsonb) IS
  'Load or update one caller ID after the owner sets mojo_verified true. Rejects the four numbers released from Twilio on 2026-10-30. Does not delete a number and does not call Mojo.';

-- Default active count is 3. The owner may set 1 through 10 (for example 10
-- active and 10 spare/resting across 816 and 913). Values outside that range
-- are rejected here; the morning job also clamps a bad stored value.
INSERT INTO public.system_config(key, value, updated_at)
VALUES ('caller_id_active_target', to_jsonb(3), now())
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_caller_id_active_target_v1(p_target integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_target IS NULL OR p_target < 1 OR p_target > 10 THEN
    RAISE EXCEPTION 'invalid_caller_id_active_target';
  END IF;
  INSERT INTO public.system_config(key, value, updated_at)
  VALUES ('caller_id_active_target', to_jsonb(p_target), now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
  RETURN p_target;
END
$$;

REVOKE ALL ON FUNCTION public.set_caller_id_active_target_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_caller_id_active_target_v1(integer) TO service_role;

COMMENT ON FUNCTION public.set_caller_id_active_target_v1(integer) IS
  'Sets how many caller IDs the morning health job keeps active. Allowed range is 1 through 10. Default is 3.';

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
