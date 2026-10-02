-- Actor-owned, retry-safe Google Calendar writeback for canonical mobile appointments.
-- A command's creator is the only calendar owner; the assignee never chooses OAuth identity.
CREATE TABLE IF NOT EXISTS public.mobile_appointment_calendar_sync (
  appointment_id uuid PRIMARY KEY REFERENCES public.appointments(id) ON DELETE CASCADE,
  owner_email text NOT NULL CHECK (owner_email = lower(btrim(owner_email)) AND owner_email <> ''),
  event_id text NOT NULL UNIQUE,
  synced_version integer NOT NULL DEFAULT 0 CHECK (synced_version >= 0),
  claim_version integer,
  claim_token uuid,
  claim_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mobile_appointment_calendar_claim_check CHECK (
    (claim_version IS NULL AND claim_token IS NULL AND claim_expires_at IS NULL)
    OR (claim_version IS NOT NULL AND claim_token IS NOT NULL AND claim_expires_at IS NOT NULL)
  )
);

ALTER TABLE public.mobile_appointment_calendar_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mobile_appointment_calendar_sync FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mobile_appointment_calendar_sync TO service_role;

-- The canonical command event is inserted in the same transaction as the appointment.
-- Backfill only appointments whose creator is unambiguous in that immutable event log.
INSERT INTO public.mobile_appointment_calendar_sync (appointment_id, owner_email, event_id)
SELECT e.appointment_id, lower(btrim(e.actor_email)), 'skc' || replace(e.appointment_id::text, '-', '')
FROM public.appointment_command_events e
WHERE e.command = 'create'
  AND e.actor_email IS NOT NULL AND btrim(e.actor_email) <> ''
ON CONFLICT (appointment_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.mobile_appointment_calendar_owner_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.command = 'create' THEN
    INSERT INTO public.mobile_appointment_calendar_sync (appointment_id, owner_email, event_id)
    VALUES (NEW.appointment_id, lower(btrim(NEW.actor_email)), 'skc' || replace(NEW.appointment_id::text, '-', ''));
  END IF;
  IF NEW.command IN ('create', 'edit', 'reschedule')
     OR (NEW.command = 'outcome' AND NEW.next_state->>'status' = 'cancelled') THEN
    UPDATE public.appointments a SET
      provider_sync_status = 'pending', provider_sync_error = NULL
    FROM public.mobile_appointment_calendar_sync s
    WHERE a.id = NEW.appointment_id AND s.appointment_id = a.id
      AND (NEW.next_state->>'version')::integer > s.synced_version;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mobile_appointment_calendar_owner ON public.appointment_command_events;
CREATE TRIGGER mobile_appointment_calendar_owner
AFTER INSERT ON public.appointment_command_events
FOR EACH ROW EXECUTE FUNCTION public.mobile_appointment_calendar_owner_v1();

-- Provider bookkeeping and the legacy Google event id are not appointment edits.
-- All other columns, including sequence fields, retain prior business-version behavior.
CREATE OR REPLACE FUNCTION public.mobile_appointment_defaults_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_duration interval;
  provider_fields text[] := ARRAY[
    'provider_event_id', 'provider_sync_status', 'provider_synced_at',
    'provider_sync_error', 'google_event_id', 'updated_at', 'version'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.title := coalesce(nullif(btrim(NEW.title), ''), CASE NEW.type
      WHEN 'in_person' THEN 'Seller appointment'
      WHEN 'google_meet' THEN 'Seller video appointment'
      ELSE 'Seller phone appointment'
    END);
    NEW.ends_at := coalesce(NEW.ends_at, NEW.scheduled_at + interval '45 minutes');
    NEW.location := coalesce(NEW.location, NEW.address);
    NEW.time_zone := coalesce(nullif(btrim(NEW.time_zone), ''), 'America/Chicago');
    NEW.version := greatest(coalesce(NEW.version, 1), 1);
    RETURN NEW;
  END IF;

  old_duration := OLD.ends_at - OLD.scheduled_at;
  IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     AND NEW.ends_at IS NOT DISTINCT FROM OLD.ends_at THEN
    NEW.ends_at := NEW.scheduled_at + greatest(old_duration, interval '15 minutes');
  END IF;
  IF NEW.address IS DISTINCT FROM OLD.address
     AND NEW.location IS NOT DISTINCT FROM OLD.location THEN
    NEW.location := NEW.address;
  END IF;
  IF NEW.version = OLD.version
     AND (to_jsonb(NEW) - provider_fields) IS DISTINCT FROM (to_jsonb(OLD) - provider_fields) THEN
    NEW.version := OLD.version + 1;
  END IF;
  NEW.title := coalesce(nullif(btrim(NEW.title), ''), OLD.title);
  NEW.time_zone := coalesce(nullif(btrim(NEW.time_zone), ''), OLD.time_zone, 'America/Chicago');
  RETURN NEW;
END;
$$;

-- Claim the *current* appointment revision. Replaying an earlier command may recover
-- provider sync for a newer committed revision, but cannot rewrite CRM business state.
CREATE OR REPLACE FUNCTION public.claim_mobile_appointment_calendar_sync_v1(
  p_appointment_id uuid, p_actor_email text, p_claim_token uuid,
  p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  a public.appointments%ROWTYPE;
  s public.mobile_appointment_calendar_sync%ROWTYPE;
BEGIN
  IF p_claim_token IS NULL OR btrim(coalesce(p_actor_email, '')) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_calendar_invalid_claim';
  END IF;
  SELECT * INTO a FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  SELECT * INTO s FROM public.mobile_appointment_calendar_sync
  WHERE appointment_id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'no_owner'); END IF;
  IF s.owner_email IS DISTINCT FROM lower(btrim(p_actor_email)) THEN
    RETURN jsonb_build_object('status', 'not_owner');
  END IF;
  IF p_expected_version IS NOT NULL AND a.version IS DISTINCT FROM p_expected_version THEN
    RETURN jsonb_build_object('status', 'version_conflict');
  END IF;
  -- Never steal an expired claim: its process may still be paused in, or may
  -- have timed out after, a Google write. Reconciliation is a separate review.
  IF s.claim_token IS NOT NULL THEN
    RETURN jsonb_build_object('status', CASE
      WHEN s.claim_expires_at <= clock_timestamp() THEN 'review_required'
      ELSE 'busy' END);
  END IF;
  IF s.synced_version >= a.version THEN
    RETURN jsonb_build_object('status', 'synced');
  END IF;
  UPDATE public.mobile_appointment_calendar_sync SET
    claim_version = a.version,
    claim_token = p_claim_token,
    claim_expires_at = clock_timestamp() + interval '2 minutes',
    updated_at = clock_timestamp()
  WHERE appointment_id = p_appointment_id;
  UPDATE public.appointments SET
    provider_sync_status = 'pending', provider_sync_error = NULL
  WHERE id = p_appointment_id;
  RETURN jsonb_build_object(
    'status', 'claimed', 'ownerEmail', s.owner_email,
    'eventId', s.event_id, 'version', a.version,
    'appointment', to_jsonb(a)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_mobile_appointment_calendar_sync_v1(
  p_appointment_id uuid, p_claim_token uuid, p_status text, p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  a public.appointments%ROWTYPE;
  s public.mobile_appointment_calendar_sync%ROWTYPE;
  current_version boolean;
BEGIN
  IF p_claim_token IS NULL OR p_status NOT IN ('synced', 'failed', 'not_configured') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_calendar_invalid_finish';
  END IF;
  SELECT * INTO a FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  SELECT * INTO s FROM public.mobile_appointment_calendar_sync
  WHERE appointment_id = p_appointment_id FOR UPDATE;
  IF NOT FOUND OR s.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('status', 'stale_claim');
  END IF;
  current_version := a.version = s.claim_version;
  UPDATE public.mobile_appointment_calendar_sync SET
    synced_version = CASE WHEN p_status = 'synced' THEN greatest(s.synced_version, s.claim_version) ELSE s.synced_version END,
    claim_version = NULL, claim_token = NULL, claim_expires_at = NULL,
    last_error = CASE WHEN p_status = 'synced' THEN NULL ELSE left(coalesce(p_error, 'calendar_sync_failed'), 240) END,
    updated_at = clock_timestamp()
  WHERE appointment_id = p_appointment_id;
  IF current_version THEN
    UPDATE public.appointments SET
      provider_event_id = CASE WHEN p_status = 'synced' AND a.status = 'cancelled' THEN NULL
        WHEN p_status = 'synced' THEN s.event_id ELSE a.provider_event_id END,
      provider_sync_status = p_status,
      provider_synced_at = CASE WHEN p_status = 'synced' THEN clock_timestamp() ELSE a.provider_synced_at END,
      provider_sync_error = CASE WHEN p_status = 'synced' THEN NULL ELSE left(coalesce(p_error, 'calendar_sync_failed'), 240) END
    WHERE id = p_appointment_id;
  END IF;
  RETURN jsonb_build_object('status', CASE WHEN current_version THEN p_status ELSE 'superseded' END);
END;
$$;

REVOKE ALL ON FUNCTION public.mobile_appointment_calendar_owner_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_mobile_appointment_calendar_sync_v1(uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_mobile_appointment_calendar_sync_v1(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mobile_appointment_calendar_sync_v1(uuid, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_mobile_appointment_calendar_sync_v1(uuid, uuid, text, text) TO service_role;
