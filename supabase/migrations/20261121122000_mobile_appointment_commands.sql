-- Canonical mobile appointment editor contract.
--
-- Adds the fields the mobile editor already exposes, a monotonic concurrency
-- version, and one transactional/idempotent command function. The function is
-- service-role only; authenticated browser/mobile users never receive table or
-- RPC privileges directly.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS time_zone text,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS sequence_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_event_id text,
  ADD COLUMN IF NOT EXISTS provider_sync_status text NOT NULL DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS provider_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_sync_error text;

UPDATE public.appointments
SET
  title = coalesce(nullif(btrim(title), ''), CASE type
    WHEN 'in_person' THEN 'Seller appointment'
    WHEN 'google_meet' THEN 'Seller video appointment'
    ELSE 'Seller phone appointment'
  END),
  ends_at = coalesce(ends_at, scheduled_at + interval '45 minutes'),
  location = coalesce(location, address),
  time_zone = coalesce(nullif(btrim(time_zone), ''), 'America/Chicago'),
  version = greatest(coalesce(version, 1), 1),
  provider_sync_status = coalesce(nullif(btrim(provider_sync_status), ''), 'not_configured');

ALTER TABLE public.appointments
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN ends_at SET NOT NULL,
  ALTER COLUMN time_zone SET NOT NULL,
  ADD CONSTRAINT appointments_mobile_duration_check
    CHECK (ends_at >= scheduled_at + interval '15 minutes'
      AND ends_at <= scheduled_at + interval '24 hours'),
  ADD CONSTRAINT appointments_mobile_version_check CHECK (version > 0),
  ADD CONSTRAINT appointments_provider_sync_status_check
    CHECK (provider_sync_status IN ('not_configured', 'pending', 'synced', 'failed'));

CREATE TABLE IF NOT EXISTS public.appointment_command_events (
  actor_email text NOT NULL,
  idempotency_key text NOT NULL,
  command text NOT NULL CHECK (command IN ('create', 'edit', 'reschedule', 'outcome')),
  request_appointment_id uuid,
  request_lead_id uuid,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  expected_version integer,
  payload_hash text NOT NULL,
  actor_name text NOT NULL,
  activity_id uuid REFERENCES public.lead_activities(id) ON DELETE SET NULL,
  previous_state jsonb,
  next_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_email, idempotency_key),
  CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  CHECK (char_length(payload_hash) = 64)
);

ALTER TABLE public.appointment_command_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.appointment_command_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.appointment_command_events TO service_role;

CREATE INDEX IF NOT EXISTS appointment_command_events_appointment_created
  ON public.appointment_command_events (appointment_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.mobile_appointment_defaults_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_duration interval;
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
  IF NEW.version = OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;
  NEW.title := coalesce(nullif(btrim(NEW.title), ''), OLD.title);
  NEW.time_zone := coalesce(nullif(btrim(NEW.time_zone), ''), OLD.time_zone, 'America/Chicago');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointment_mobile_defaults ON public.appointments;
CREATE TRIGGER appointment_mobile_defaults
BEFORE INSERT OR UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.mobile_appointment_defaults_v1();

CREATE OR REPLACE FUNCTION public.apply_mobile_appointment_command_v1(
  p_actor_email text,
  p_actor_name text,
  p_idempotency_key text,
  p_command text,
  p_appointment_id uuid,
  p_lead_id uuid,
  p_expected_version integer,
  p_payload_hash text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing_event public.appointment_command_events%ROWTYPE;
  current_appointment public.appointments%ROWTYPE;
  next_appointment public.appointments%ROWTYPE;
  next_snapshot public.appointments%ROWTYPE;
  activity_id uuid;
  title_value text;
  type_value text;
  scheduled_value timestamptz;
  ends_value timestamptz;
  location_value text;
  time_zone_value text;
  assigned_value text;
  notes_value text;
  reminder_value boolean;
  outcome_value text;
  activity_type text;
  activity_description text;
  changed boolean := true;
  has_next_snapshot boolean := false;
BEGIN
  IF btrim(coalesce(p_actor_email, '')) = ''
     OR btrim(coalesce(p_actor_name, '')) = ''
     OR length(coalesce(p_idempotency_key, '')) NOT BETWEEN 8 AND 200
     OR length(coalesce(p_payload_hash, '')) <> 64
     OR p_command NOT IN ('create', 'edit', 'reschedule', 'outcome')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_invalid_command';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mobile-appointment:' || lower(p_actor_email) || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO existing_event
  FROM public.appointment_command_events
  WHERE actor_email = lower(p_actor_email)
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF existing_event.command IS DISTINCT FROM p_command
       OR existing_event.request_appointment_id IS DISTINCT FROM p_appointment_id
       OR existing_event.request_lead_id IS DISTINCT FROM p_lead_id
       OR existing_event.expected_version IS DISTINCT FROM p_expected_version
       OR existing_event.payload_hash IS DISTINCT FROM p_payload_hash THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_idempotency_conflict';
    END IF;
    RETURN jsonb_build_object(
      'created', false,
      'changed', false,
      'replayed', true,
      'appointment', existing_event.next_state,
      'activityId', existing_event.activity_id
    );
  END IF;

  IF p_command = 'create' THEN
    IF p_appointment_id IS NOT NULL OR p_lead_id IS NULL OR p_expected_version IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_invalid_target';
    END IF;

    title_value := nullif(btrim(p_payload->>'title'), '');
    type_value := p_payload->>'type';
    scheduled_value := (p_payload->>'scheduledAt')::timestamptz;
    ends_value := (p_payload->>'endsAt')::timestamptz;
    location_value := nullif(btrim(p_payload->>'location'), '');
    time_zone_value := p_payload->>'timeZone';
    assigned_value := nullif(btrim(p_payload->>'assignedTo'), '');
    notes_value := nullif(btrim(p_payload->>'notes'), '');
    reminder_value := coalesce((p_payload->>'sendReminder')::boolean, false);

    IF title_value IS NULL OR length(title_value) > 200
       OR type_value NOT IN ('phone_call', 'in_person', 'google_meet')
       OR scheduled_value <= clock_timestamp()
       OR scheduled_value > clock_timestamp() + interval '2 years'
       OR ends_value < scheduled_value + interval '15 minutes'
       OR ends_value > scheduled_value + interval '24 hours'
       OR time_zone_value IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = time_zone_value)
       OR assigned_value IS NULL OR length(assigned_value) > 160
       OR length(coalesce(location_value, '')) > 500
       OR length(coalesce(notes_value, '')) > 5000
       OR (type_value = 'in_person' AND location_value IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_invalid_payload';
    END IF;

    INSERT INTO public.appointments (
      lead_id, title, type, scheduled_at, ends_at, status, address, location,
      time_zone, notes, source, assigned_to, sequence_enabled,
      provider_sync_status, version
    ) VALUES (
      p_lead_id, title_value, type_value, scheduled_value, ends_value,
      'scheduled', location_value, location_value, time_zone_value, notes_value,
      'manual', assigned_value, reminder_value, 'not_configured', 1
    ) RETURNING * INTO next_appointment;

    activity_type := 'appointment';
    activity_description := 'Appointment scheduled: ' || title_value || ' at ' || scheduled_value::text;
  ELSE
    IF p_appointment_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_invalid_target';
    END IF;

    SELECT * INTO current_appointment
    FROM public.appointments
    WHERE id = p_appointment_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_not_found';
    END IF;
    IF p_lead_id IS NOT NULL AND current_appointment.lead_id IS DISTINCT FROM p_lead_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_lead_mismatch';
    END IF;
    IF current_appointment.version IS DISTINCT FROM p_expected_version THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_version_conflict';
    END IF;

    IF p_command IN ('edit', 'reschedule') THEN
      IF current_appointment.status NOT IN ('scheduled', 'confirmed', 'rescheduled') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_terminal';
      END IF;

      title_value := CASE WHEN p_payload ? 'title' THEN nullif(btrim(p_payload->>'title'), '') ELSE current_appointment.title END;
      type_value := CASE WHEN p_payload ? 'type' THEN p_payload->>'type' ELSE current_appointment.type END;
      scheduled_value := CASE WHEN p_payload ? 'scheduledAt' THEN (p_payload->>'scheduledAt')::timestamptz ELSE current_appointment.scheduled_at END;
      ends_value := CASE WHEN p_payload ? 'endsAt' THEN (p_payload->>'endsAt')::timestamptz ELSE current_appointment.ends_at END;
      location_value := CASE WHEN p_payload ? 'location' THEN nullif(btrim(p_payload->>'location'), '') ELSE current_appointment.location END;
      time_zone_value := CASE WHEN p_payload ? 'timeZone' THEN p_payload->>'timeZone' ELSE current_appointment.time_zone END;
      notes_value := CASE WHEN p_payload ? 'notes' THEN nullif(btrim(p_payload->>'notes'), '') ELSE current_appointment.notes END;

      IF p_command = 'reschedule' AND NOT (p_payload ? 'scheduledAt' AND p_payload ? 'endsAt' AND p_payload ? 'timeZone') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_invalid_payload';
      END IF;
      IF title_value IS NULL OR length(title_value) > 200
         OR type_value NOT IN ('phone_call', 'in_person', 'google_meet')
         OR scheduled_value <= clock_timestamp()
         OR scheduled_value > clock_timestamp() + interval '2 years'
         OR ends_value < scheduled_value + interval '15 minutes'
         OR ends_value > scheduled_value + interval '24 hours'
         OR time_zone_value IS NULL
         OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = time_zone_value)
         OR length(coalesce(location_value, '')) > 500
         OR length(coalesce(notes_value, '')) > 5000
         OR (type_value = 'in_person' AND location_value IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_invalid_payload';
      END IF;

      changed := title_value IS DISTINCT FROM current_appointment.title
        OR type_value IS DISTINCT FROM current_appointment.type
        OR scheduled_value IS DISTINCT FROM current_appointment.scheduled_at
        OR ends_value IS DISTINCT FROM current_appointment.ends_at
        OR location_value IS DISTINCT FROM current_appointment.location
        OR time_zone_value IS DISTINCT FROM current_appointment.time_zone
        OR notes_value IS DISTINCT FROM current_appointment.notes;

      IF changed THEN
        UPDATE public.appointments SET
          title = title_value,
          type = type_value,
          scheduled_at = scheduled_value,
          ends_at = ends_value,
          address = location_value,
          location = location_value,
          time_zone = time_zone_value,
          notes = notes_value,
          status = CASE
            WHEN scheduled_value IS DISTINCT FROM current_appointment.scheduled_at THEN 'scheduled'
            ELSE current_appointment.status
          END,
          provider_sync_status = CASE
            WHEN current_appointment.provider_event_id IS NULL THEN 'not_configured'
            ELSE 'pending'
          END,
          provider_sync_error = NULL,
          version = current_appointment.version + 1,
          updated_at = clock_timestamp()
        WHERE id = current_appointment.id
        RETURNING * INTO next_appointment;
      ELSE
        next_appointment := current_appointment;
      END IF;

      activity_type := CASE WHEN p_command = 'reschedule'
        OR scheduled_value IS DISTINCT FROM current_appointment.scheduled_at
        THEN 'appointment_rescheduled' ELSE 'appointment_edit' END;
      activity_description := CASE WHEN activity_type = 'appointment_rescheduled'
        THEN 'Appointment rescheduled: ' || next_appointment.title || ' at ' || next_appointment.scheduled_at::text
        ELSE 'Appointment updated: ' || next_appointment.title END;
    ELSE
      outcome_value := p_payload->>'outcome';
      notes_value := CASE WHEN p_payload ? 'notes' THEN nullif(btrim(p_payload->>'notes'), '') ELSE current_appointment.notes END;
      IF outcome_value NOT IN ('completed', 'no_show', 'cancelled')
         OR current_appointment.status NOT IN ('scheduled', 'confirmed', 'rescheduled')
         OR length(coalesce(notes_value, '')) > 5000 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_invalid_outcome';
      END IF;

      UPDATE public.appointments SET
        status = outcome_value,
        notes = notes_value,
        provider_sync_status = CASE
          WHEN current_appointment.provider_event_id IS NULL THEN 'not_configured'
          ELSE 'pending'
        END,
        provider_sync_error = NULL,
        version = current_appointment.version + 1,
        updated_at = clock_timestamp()
      WHERE id = current_appointment.id
      RETURNING * INTO next_appointment;

      activity_type := 'appointment_outcome';
      activity_description := CASE outcome_value
        WHEN 'completed' THEN 'Appointment completed'
        WHEN 'no_show' THEN 'Appointment no-show'
        ELSE 'Appointment cancelled'
      END || CASE WHEN notes_value IS NULL THEN '' ELSE ': ' || notes_value END;
    END IF;
  END IF;

  IF changed THEN
    INSERT INTO public.lead_activities (
      lead_id, activity_type, description, agent, metadata
    ) VALUES (
      next_appointment.lead_id,
      activity_type,
      activity_description,
      p_actor_name,
      jsonb_build_object(
        'appointment_id', next_appointment.id,
        'appointment_version', next_appointment.version,
        'appointment_command', p_command,
        'appointment_command_actor', lower(p_actor_email),
        'appointment_command_key', p_idempotency_key,
        'scheduled_at', next_appointment.scheduled_at,
        'ends_at', next_appointment.ends_at,
        'time_zone', next_appointment.time_zone,
        'type', next_appointment.type,
        'status', next_appointment.status,
        'assigned_to', next_appointment.assigned_to,
        'source', 'mobile_app'
      )
    ) RETURNING id INTO activity_id;
  END IF;

  SELECT * INTO next_snapshot
  FROM public.appointments
  WHERE lead_id = next_appointment.lead_id
    AND status IN ('scheduled', 'confirmed', 'rescheduled')
    AND scheduled_at > clock_timestamp()
  ORDER BY scheduled_at, id
  LIMIT 1;
  has_next_snapshot := FOUND;

  UPDATE public.leads SET
    appointment_date = CASE WHEN has_next_snapshot THEN next_snapshot.scheduled_at ELSE NULL END,
    appointment_notes = CASE WHEN has_next_snapshot THEN next_snapshot.notes ELSE NULL END,
    updated_at = clock_timestamp()
  WHERE id = next_appointment.lead_id;

  INSERT INTO public.appointment_command_events (
    actor_email, idempotency_key, command, request_appointment_id,
    request_lead_id, appointment_id, lead_id, expected_version,
    payload_hash, actor_name, activity_id, previous_state, next_state
  ) VALUES (
    lower(p_actor_email), p_idempotency_key, p_command, p_appointment_id,
    p_lead_id, next_appointment.id, next_appointment.lead_id,
    p_expected_version, p_payload_hash, p_actor_name, activity_id,
    CASE WHEN p_command = 'create' THEN NULL ELSE to_jsonb(current_appointment) END,
    to_jsonb(next_appointment)
  );

  RETURN jsonb_build_object(
    'created', p_command = 'create',
    'changed', changed,
    'replayed', false,
    'appointment', to_jsonb(next_appointment),
    'activityId', activity_id
  );
EXCEPTION
  WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'appointment_invalid_payload';
END;
$$;

REVOKE ALL ON FUNCTION public.mobile_appointment_defaults_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_mobile_appointment_command_v1(
  text, text, text, text, uuid, uuid, integer, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_mobile_appointment_command_v1(
  text, text, text, text, uuid, uuid, integer, text, jsonb
) TO service_role;

COMMENT ON TABLE public.appointment_command_events IS
  'Actor-scoped idempotency and audit ledger for canonical mobile appointment commands.';
COMMENT ON FUNCTION public.apply_mobile_appointment_command_v1(
  text, text, text, text, uuid, uuid, integer, text, jsonb
) IS 'Atomically creates or version-updates one canonical appointment and its CRM evidence; service role only.';
