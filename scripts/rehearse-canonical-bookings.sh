#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-canonical-booking.XXXXXX)"
PG_PORT="$((57100 + $$ % 300))"
PG_DATA="$REHEARSAL_DIR/data"
PG_SOCKET="$REHEARSAL_DIR/socket"
ROOT="$(pwd)"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast stop >/dev/null 2>&1 || true
  find "$REHEARSAL_DIR" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$PG_SOCKET"
"$PG_BIN/initdb" -D "$PG_DATA" --no-locale -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-F -p $PG_PORT -k $PG_SOCKET" -w start >/dev/null
PSQL=("$PG_BIN/psql" -h "$PG_SOCKET" -p "$PG_PORT" -d postgres -v ON_ERROR_STOP=1 -X)

"${PSQL[@]}" <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.leads (id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  type text NOT NULL DEFAULT 'phone_call',
  status text NOT NULL DEFAULT 'scheduled',
  address text,
  notes text,
  source text NOT NULL DEFAULT 'manual',
  source_call_id text,
  assigned_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.bookings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name text NOT NULL,
  phone text NOT NULL,
  property_address text NOT NULL,
  slot_date date NOT NULL,
  slot_time time NOT NULL,
  slot_datetime timestamptz NOT NULL,
  status text DEFAULT 'confirmed',
  source text DEFAULT 'YouTube',
  landing_page text DEFAULT '/call',
  lead_id uuid REFERENCES public.leads(id),
  created_at timestamptz DEFAULT now()
);
CREATE POLICY "Authenticated full access" ON public.bookings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated full access" ON public.appointments FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
INSERT INTO public.leads(id, full_name) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Seller One'),
  ('10000000-0000-4000-8000-000000000002', 'Seller Two');
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260930110000_canonical_bookings_and_appointments.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260930110000_canonical_bookings_and_appointments.sql" >/dev/null

"${PSQL[@]}" <<'SQL'
DO $$
DECLARE
  target timestamptz := date_trunc('minute', now() + interval '1 day');
  first_booking uuid;
  first_appointment uuid;
  replay_booking uuid;
  replay_appointment uuid;
BEGIN
  SELECT booking_id, appointment_id INTO first_booking, first_appointment
  FROM public.create_canonical_booking_v1(
    '10000000-0000-4000-8000-000000000001', 'Seller One', '+18165550123', '123 Main St',
    (target AT TIME ZONE 'America/Chicago')::date,
    (target AT TIME ZONE 'America/Chicago')::time,
    target, 'website_form', '/call', 'casey'
  );

  SELECT booking_id, appointment_id INTO replay_booking, replay_appointment
  FROM public.create_canonical_booking_v1(
    '10000000-0000-4000-8000-000000000001', 'Seller One', '(816) 555-0123', '123 Main St',
    (target AT TIME ZONE 'America/Chicago')::date,
    (target AT TIME ZONE 'America/Chicago')::time,
    target, 'website_form', '/call', 'casey'
  );

  IF first_booking IS DISTINCT FROM replay_booking OR first_appointment IS DISTINCT FROM replay_appointment THEN
    RAISE EXCEPTION 'exact replay did not return canonical IDs';
  END IF;
  IF (SELECT count(*) FROM public.bookings) <> 1 OR (SELECT count(*) FROM public.appointments) <> 1 THEN
    RAISE EXCEPTION 'replay duplicated booking state';
  END IF;
  IF (SELECT appointment_id FROM public.bookings WHERE id = first_booking) IS DISTINCT FROM first_appointment THEN
    RAISE EXCEPTION 'booking was not linked to canonical appointment';
  END IF;

  BEGIN
    PERFORM public.create_canonical_booking_v1(
      '10000000-0000-4000-8000-000000000002', 'Seller Two', '+18165550999', '',
      (target AT TIME ZONE 'America/Chicago')::date,
      (target AT TIME ZONE 'America/Chicago')::time,
      target, 'website_form', '/call', 'casey'
    );
    RAISE EXCEPTION 'competing seller claimed an occupied slot';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'booking_slot_taken' THEN RAISE; END IF;
  END;

  IF has_table_privilege('authenticated', 'public.bookings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.appointments', 'UPDATE') THEN
    RAISE EXCEPTION 'browser roles retained direct appointment access';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.bookings', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'service role lost booking access';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.create_canonical_booking_v1(uuid,text,text,text,date,time without time zone,timestamptz,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'browser role can execute booking RPC';
  END IF;
END $$;
SQL

echo "Canonical booking rehearsal passed"
