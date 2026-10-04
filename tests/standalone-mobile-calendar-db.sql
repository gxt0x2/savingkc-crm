-- Run only against a disposable database with repository migrations loaded.
-- Never run against production. This transaction rolls back every fixture.
BEGIN;
DO $$
DECLARE
  result jsonb; event_id uuid; actor text := 'standalone-fixture@example.test';
  start_at timestamptz := clock_timestamp() + interval '1 day';
  payload jsonb;
BEGIN
  payload := jsonb_build_object('title','Standalone fixture','type','phone_call',
    'scheduledAt',start_at,'endsAt',start_at + interval '1 hour',
    'timeZone','America/Chicago','assignedTo','Ernest','sendReminder',false);
  result := public.apply_mobile_appointment_command_v1(actor,'Ernest','standalone-create-fixture',
    'create',NULL,NULL,NULL,repeat('a',64),payload);
  event_id := (result->'appointment'->>'id')::uuid;
  ASSERT result->'appointment'->>'lead_id' IS NULL, 'standalone must have no lead';
  ASSERT NOT EXISTS (SELECT 1 FROM public.lead_activities WHERE metadata->>'appointment_id'=event_id::text), 'no seller activity';
  ASSERT EXISTS (SELECT 1 FROM public.mobile_appointment_calendar_sync WHERE appointment_id=event_id AND owner_email=actor), 'actor owns provider sync';
  result := public.apply_mobile_appointment_command_v1(actor,'Ernest','standalone-create-fixture',
    'create',NULL,NULL,NULL,repeat('a',64),payload);
  ASSERT (result->>'replayed')::boolean, 'idempotent create';

  -- Existing historical records remain editable and cancellable.
  UPDATE public.appointments SET scheduled_at=clock_timestamp()-interval '2 days',
    ends_at=clock_timestamp()-interval '2 days'+interval '1 hour' WHERE id=event_id;
  SELECT public.apply_mobile_appointment_command_v1(actor,'Ernest','standalone-note-fixture',
    'edit',event_id,NULL,version,repeat('b',64),'{"notes":"Historical note"}') INTO result
    FROM public.appointments WHERE id=event_id;
  ASSERT result->'appointment'->>'notes'='Historical note', 'past note allowed';
  BEGIN
    SELECT public.apply_mobile_appointment_command_v1(actor,'Ernest','standalone-past-fixture',
      'reschedule',event_id,NULL,version,repeat('c',64),jsonb_build_object(
        'scheduledAt',clock_timestamp()-interval '1 day','endsAt',clock_timestamp()-interval '23 hours',
        'timeZone','America/Chicago')) INTO result FROM public.appointments WHERE id=event_id;
    RAISE EXCEPTION 'past reschedule unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'appointment_invalid_payload' THEN RAISE; END IF;
  END;
  SELECT public.apply_mobile_appointment_command_v1(actor,'Ernest','standalone-cancel-fixture',
    'outcome',event_id,NULL,version,repeat('d',64),'{"outcome":"cancelled"}') INTO result
    FROM public.appointments WHERE id=event_id;
  ASSERT result->'appointment'->>'status'='cancelled', 'past cancel allowed';
END $$;
ROLLBACK;
