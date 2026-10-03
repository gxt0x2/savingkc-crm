\set ON_ERROR_STOP on
-- Run only in an empty disposable local PostgreSQL database. No provider worker runs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.leads (
  id uuid PRIMARY KEY, full_name text, appointment_date timestamptz,
  appointment_notes text, updated_at timestamptz DEFAULT clock_timestamp()
);
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid REFERENCES public.leads(id),
  scheduled_at timestamptz NOT NULL, type text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','completed','no_show','cancelled','rescheduled')),
  assigned_to text, updated_at timestamptz DEFAULT clock_timestamp(),
  created_at timestamptz DEFAULT clock_timestamp(), address text, notes text,
  google_event_id text, source text DEFAULT 'manual'
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
\ir ../supabase/migrations/20261121123000_mobile_appointment_calendar_sync.sql

DO $$
DECLARE
  seller_id uuid := gen_random_uuid();
  target_id uuid := gen_random_uuid();
  appointment_time timestamptz := clock_timestamp() - interval '5 days';
  result jsonb;
  error_message text;
BEGIN
  INSERT INTO public.leads(id,full_name,appointment_date) VALUES(seller_id,'Calendar fixture',appointment_time);
  -- Same contract shape as the reported legacy appointment: no calendar owner/event,
  -- a past video appointment and a stored assignee outside the mobile picker choices.
  INSERT INTO public.appointments(id,lead_id,scheduled_at,type,assigned_to,notes)
    VALUES(target_id,seller_id,appointment_time,'google_meet','OAuth Review (throwaway)','Calendar fixture');
  IF EXISTS (SELECT 1 FROM public.mobile_appointment_calendar_sync WHERE appointment_id=target_id)
    THEN RAISE EXCEPTION 'legacy fixture unexpectedly acquired a calendar owner'; END IF;

  result := public.apply_mobile_appointment_command_v1(
    'calendar-fixture@example.invalid','Calendar fixture','fixture-first-cancel','outcome',
    target_id,seller_id,1,repeat('a',64),'{"outcome":"cancelled","notes":"Calendar fixture"}'::jsonb
  );
  IF result#>>'{appointment,status}' <> 'cancelled' OR result#>>'{appointment,version}' <> '2'
    OR result->>'changed' <> 'true' THEN RAISE EXCEPTION 'CRM cancellation failed without calendar owner'; END IF;
  IF (SELECT count(*) FROM public.appointment_command_events WHERE appointment_id=target_id) <> 1
    OR (SELECT count(*) FROM public.lead_activities WHERE lead_id=seller_id) <> 1
    THEN RAISE EXCEPTION 'cancellation audit was not recorded exactly once'; END IF;
  IF (SELECT appointment_date FROM public.leads WHERE id=seller_id) IS NOT NULL
    THEN RAISE EXCEPTION 'cancelled appointment stayed in lead snapshot'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.appointments WHERE id=target_id AND status='cancelled')
    THEN RAISE EXCEPTION 'cancellation removed the canonical audit record'; END IF;

  result := public.apply_mobile_appointment_command_v1(
    'calendar-fixture@example.invalid','Calendar fixture','fixture-first-cancel','outcome',
    target_id,seller_id,1,repeat('a',64),'{"outcome":"cancelled","notes":"Calendar fixture"}'::jsonb
  );
  IF result->>'replayed' <> 'true' OR result->>'changed' <> 'false'
    THEN RAISE EXCEPTION 'same-key response-loss retry was not idempotent'; END IF;

  BEGIN
    PERFORM public.apply_mobile_appointment_command_v1(
      'calendar-fixture@example.invalid','Calendar fixture','fixture-new-cancel','outcome',
      target_id,seller_id,2,repeat('b',64),'{"outcome":"cancelled","notes":"Calendar fixture"}'::jsonb
    );
    RAISE EXCEPTION 'terminal cancellation unexpectedly repeated';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
    IF error_message <> 'appointment_invalid_outcome' THEN RAISE EXCEPTION 'unexpected terminal error: %',error_message; END IF;
  END;

  BEGIN
    PERFORM public.apply_mobile_appointment_command_v1(
      'calendar-fixture@example.invalid','Calendar fixture','fixture-stale-cancel','outcome',
      target_id,seller_id,1,repeat('c',64),'{"outcome":"cancelled"}'::jsonb
    );
    RAISE EXCEPTION 'stale version unexpectedly changed appointment';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
    IF error_message <> 'appointment_version_conflict' THEN RAISE EXCEPTION 'unexpected version error: %',error_message; END IF;
  END;
  IF (SELECT count(*) FROM public.appointment_command_events WHERE appointment_id=target_id) <> 1
    OR (SELECT version FROM public.appointments WHERE id=target_id) <> 2
    THEN RAISE EXCEPTION 'failed/replayed commands changed audit or version'; END IF;
  IF has_function_privilege('anon','public.apply_mobile_appointment_command_v1(text,text,text,text,uuid,uuid,integer,text,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.apply_mobile_appointment_command_v1(text,text,text,text,uuid,uuid,integer,text,jsonb)','EXECUTE')
    THEN RAISE EXCEPTION 'client role gained direct command access'; END IF;
  RAISE NOTICE 'PASS: ownerless legacy cancellation, audit preservation, same-key replay, terminal rejection, stale version, RPC permissions';
END $$;
