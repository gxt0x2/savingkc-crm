-- Canonical, atomic public booking creation.
--
-- `appointments` is the operational source of truth. `bookings` records the
-- public scheduling intake and points at the appointment it created. Manifest
-- JSON is intentionally absent from this contract.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS appointment_id uuid
  REFERENCES public.appointments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_confirmed_slot_unique
  ON public.bookings (slot_datetime)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_bookings_lead_created
  ON public.bookings (lead_id, created_at DESC);

-- These records include seller identity, phone, address, and appointment
-- details. Every repository consumer is server-side, so browser roles have no
-- direct table privileges.
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated full access" ON public.bookings;
DROP POLICY IF EXISTS "Authenticated full access" ON public.appointments;

REVOKE ALL ON TABLE public.bookings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.appointments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bookings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.appointments TO service_role;

CREATE OR REPLACE FUNCTION public.create_canonical_booking_v1(
  p_lead_id uuid,
  p_first_name text,
  p_phone text,
  p_property_address text,
  p_slot_date date,
  p_slot_time time without time zone,
  p_slot_datetime timestamptz,
  p_booking_source text DEFAULT 'website_form',
  p_landing_page text DEFAULT '/call',
  p_assigned_to text DEFAULT 'casey'
)
RETURNS TABLE (booking_id uuid, appointment_id uuid, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.bookings%ROWTYPE;
  v_booking_id uuid;
  v_appointment_id uuid;
  v_phone_digits text;
  v_existing_phone_digits text;
BEGIN
  IF p_lead_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.leads WHERE id = p_lead_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'booking_lead_not_found';
  END IF;

  IF btrim(coalesce(p_first_name, '')) = '' OR length(btrim(p_first_name)) > 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'booking_invalid_name';
  END IF;

  v_phone_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  IF length(v_phone_digits) = 11 AND left(v_phone_digits, 1) = '1' THEN
    v_phone_digits := right(v_phone_digits, 10);
  END IF;
  IF length(v_phone_digits) <> 10 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'booking_invalid_phone';
  END IF;

  IF p_slot_datetime IS NULL
     OR p_slot_datetime <= clock_timestamp()
     OR p_slot_datetime > clock_timestamp() + interval '2 years' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'booking_invalid_slot';
  END IF;

  IF (p_slot_datetime AT TIME ZONE 'America/Chicago')::date <> p_slot_date
     OR to_char(p_slot_datetime AT TIME ZONE 'America/Chicago', 'HH24:MI')
        <> to_char(p_slot_time, 'HH24:MI') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'booking_slot_mismatch';
  END IF;

  IF length(coalesce(p_property_address, '')) > 500
     OR length(coalesce(p_booking_source, '')) > 100
     OR length(coalesce(p_landing_page, '')) > 250
     OR length(coalesce(p_assigned_to, '')) > 160 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'booking_invalid_input';
  END IF;

  -- Serialize claims for one exact appointment slot. The unique partial index
  -- remains the final invariant if another writer bypasses this function.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('canonical-booking:' || p_slot_datetime::text, 0)
  );

  SELECT *
  INTO v_existing
  FROM public.bookings
  WHERE slot_datetime = p_slot_datetime
    AND status = 'confirmed'
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_existing_phone_digits := regexp_replace(coalesce(v_existing.phone, ''), '[^0-9]', '', 'g');
    IF length(v_existing_phone_digits) = 11 AND left(v_existing_phone_digits, 1) = '1' THEN
      v_existing_phone_digits := right(v_existing_phone_digits, 10);
    END IF;

    IF v_existing.lead_id IS DISTINCT FROM p_lead_id
       OR v_existing_phone_digits IS DISTINCT FROM v_phone_digits THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'booking_slot_taken';
    END IF;

    v_booking_id := v_existing.id;
    v_appointment_id := v_existing.appointment_id;

    IF v_appointment_id IS NULL THEN
      INSERT INTO public.appointments (
        lead_id, scheduled_at, type, status, address, notes, source,
        source_call_id, assigned_to
      ) VALUES (
        p_lead_id, p_slot_datetime, 'phone_call', 'scheduled',
        nullif(btrim(coalesce(p_property_address, '')), ''),
        'Public booking ' || v_booking_id::text,
        'calendar_sync', v_booking_id::text,
        nullif(btrim(coalesce(p_assigned_to, '')), '')
      )
      RETURNING id INTO v_appointment_id;

      UPDATE public.bookings
      SET appointment_id = v_appointment_id
      WHERE id = v_booking_id;
    END IF;

    RETURN QUERY SELECT v_booking_id, v_appointment_id, true;
    RETURN;
  END IF;

  INSERT INTO public.bookings (
    first_name, phone, property_address, slot_date, slot_time, slot_datetime,
    status, source, landing_page, lead_id
  ) VALUES (
    btrim(p_first_name), '+1' || v_phone_digits,
    btrim(coalesce(p_property_address, '')), p_slot_date, p_slot_time,
    p_slot_datetime, 'confirmed', coalesce(nullif(btrim(p_booking_source), ''), 'website_form'),
    coalesce(nullif(btrim(p_landing_page), ''), '/call'), p_lead_id
  )
  RETURNING id INTO v_booking_id;

  INSERT INTO public.appointments (
    lead_id, scheduled_at, type, status, address, notes, source,
    source_call_id, assigned_to
  ) VALUES (
    p_lead_id, p_slot_datetime, 'phone_call', 'scheduled',
    nullif(btrim(coalesce(p_property_address, '')), ''),
    'Public booking ' || v_booking_id::text,
    'calendar_sync', v_booking_id::text,
    nullif(btrim(coalesce(p_assigned_to, '')), '')
  )
  RETURNING id INTO v_appointment_id;

  UPDATE public.bookings
  SET appointment_id = v_appointment_id
  WHERE id = v_booking_id;

  RETURN QUERY SELECT v_booking_id, v_appointment_id, false;
END;
$$;

REVOKE ALL ON FUNCTION public.create_canonical_booking_v1(
  uuid, text, text, text, date, time without time zone, timestamptz, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_canonical_booking_v1(
  uuid, text, text, text, date, time without time zone, timestamptz, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.create_canonical_booking_v1(
  uuid, text, text, text, date, time without time zone, timestamptz, text, text, text
) IS 'Atomically claims a public booking slot and creates its canonical appointment; service role only.';
