\set ON_ERROR_STOP on
-- Run only against an empty, disposable local PostgreSQL database. No providers run here.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE public.leads (
  id uuid PRIMARY KEY, full_name text, appointment_date timestamptz,
  appointment_notes text, updated_at timestamptz DEFAULT clock_timestamp()
);
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid REFERENCES public.leads(id),
  scheduled_at timestamptz NOT NULL, type text NOT NULL, status text DEFAULT 'scheduled',
  assigned_to text, updated_at timestamptz DEFAULT clock_timestamp(),
  created_at timestamptz DEFAULT clock_timestamp(), address text, notes text, source text DEFAULT 'manual'
);
CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, activity_type text,
  description text, agent text, metadata jsonb DEFAULT '{}'
);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text, title text, body text, url text, metadata jsonb
);
CREATE FUNCTION public.create_work_item_v2(text,text,uuid,text,text,text,timestamptz,text,text,text,text,boolean,jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RETURN '{}'; END $$;

\ir ../supabase/migrations/20261106120000_appointment_show_rate_sequence.sql
\ir ../supabase/migrations/20261121122000_mobile_appointment_commands.sql

DO $$
DECLARE
  seller_id uuid := gen_random_uuid();
  mobile_id uuid;
  sequence_id uuid;
  initial_time timestamptz := clock_timestamp() + interval '4 days';
  next_time timestamptz := clock_timestamp() + interval '5 days';
  payload jsonb;
  result jsonb;
  before_steps integer;
  before_queued integer;
BEGIN
  INSERT INTO public.leads(id, full_name) VALUES (seller_id, 'Sequence Test Seller');

  payload := jsonb_build_object(
    'leadId', seller_id, 'type', 'phone_call', 'scheduledAt', initial_time,
    'endsAt', initial_time + interval '1 hour', 'title', 'Mobile seller call',
    'location', NULL, 'timeZone', 'America/Chicago', 'assignedTo', 'Casey',
    'notes', NULL, 'sendReminder', false
  );
  result := public.apply_mobile_appointment_command_v1(
    'casey@savingkc.com', 'Casey', 'mobile-sequence-create-1', 'create', NULL,
    seller_id, NULL, repeat('a',64), payload
  );
  mobile_id := (result#>>'{appointment,id}')::uuid;
  IF result->>'created' <> 'true' OR mobile_id IS NULL THEN RAISE EXCEPTION 'mobile create failed'; END IF;
  IF EXISTS (SELECT 1 FROM public.appointment_sequence_steps WHERE appointment_id = mobile_id) THEN
    RAISE EXCEPTION 'disabled mobile reminder enrolled seller messages';
  END IF;

  INSERT INTO public.appointments (lead_id, scheduled_at, type, assigned_to, address, sequence_enabled)
  VALUES (seller_id, initial_time, 'in_person', 'Casey', '123 Main St', true)
  RETURNING id INTO sequence_id;
  SELECT count(*) INTO before_steps FROM public.appointment_sequence_steps
  WHERE appointment_id = sequence_id AND version = 1;
  IF before_steps <> 6 THEN RAISE EXCEPTION 'existing sequence did not enroll six steps: %', before_steps; END IF;
  SELECT count(*) INTO before_queued FROM public.appointment_sequence_steps
  WHERE appointment_id = sequence_id AND version = 1 AND status = 'queued';
  IF before_queued < 2 THEN RAISE EXCEPTION 'existing sequence has too few queued steps: %', before_queued; END IF;

  result := public.apply_mobile_appointment_command_v1(
    'casey@savingkc.com', 'Casey', 'mobile-sequence-edit-1', 'edit', sequence_id,
    seller_id, 1, repeat('b',64), '{"title":"Updated seller visit"}'::jsonb
  );
  IF result#>>'{appointment,version}' <> '2' THEN RAISE EXCEPTION 'mobile edit version failed'; END IF;
  IF (SELECT sequence_version FROM public.appointments WHERE id=sequence_id) <> 1
    OR (SELECT count(*) FROM public.appointment_sequence_steps WHERE appointment_id=sequence_id AND status='queued')
      <> before_queued
  THEN RAISE EXCEPTION 'title-only mobile edit disturbed existing sequence'; END IF;

  result := public.apply_mobile_appointment_command_v1(
    'casey@savingkc.com', 'Casey', 'mobile-sequence-reschedule-1', 'reschedule', sequence_id,
    seller_id, 2, repeat('c',64), jsonb_build_object(
      'scheduledAt', next_time, 'endsAt', next_time + interval '1 hour',
      'timeZone', 'America/Chicago', 'notes', 'Seller requested later'
    )
  );
  IF result#>>'{appointment,version}' <> '3'
    OR (SELECT sequence_version FROM public.appointments WHERE id=sequence_id) <> 2
    OR EXISTS (SELECT 1 FROM public.appointment_sequence_steps WHERE appointment_id=sequence_id AND version=1 AND status='queued')
    OR (SELECT count(*) FROM public.appointment_sequence_steps WHERE appointment_id=sequence_id AND version=2) <> 6
  THEN RAISE EXCEPTION 'mobile reschedule did not rotate sequence safely'; END IF;

  result := public.apply_mobile_appointment_command_v1(
    'casey@savingkc.com', 'Casey', 'mobile-sequence-outcome-1', 'outcome', sequence_id,
    seller_id, 3, repeat('d',64), '{"outcome":"cancelled","notes":"Seller cancelled"}'::jsonb
  );
  IF result#>>'{appointment,status}' <> 'cancelled'
    OR EXISTS (SELECT 1 FROM public.appointment_sequence_steps WHERE appointment_id=sequence_id AND status='queued')
  THEN RAISE EXCEPTION 'mobile cancellation left sequence messages queued'; END IF;
END $$;

SELECT 'PASS: disabled mobile reminders do not enroll; enabled edit retains sequence; reschedule rotates; cancellation skips queued steps' AS result;
