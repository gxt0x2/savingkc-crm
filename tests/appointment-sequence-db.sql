\set ON_ERROR_STOP on
-- Run only against an empty disposable local database.
CREATE TABLE leads(id uuid PRIMARY KEY,full_name text);
CREATE TABLE appointments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid REFERENCES leads,scheduled_at timestamptz,type text,status text DEFAULT 'scheduled',assigned_to text,updated_at timestamptz,address text,notes text,source text);
CREATE TABLE lead_activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid,activity_type text,description text,agent text,metadata jsonb DEFAULT '{}');
CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),type text,title text,body text,url text,metadata jsonb);
CREATE FUNCTION create_work_item_v2(text,text,uuid,text,text,text,timestamptz,text,text,text,text,boolean,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO lead_activities(lead_id,activity_type,description,metadata) SELECT $3,$4,$5,$13||jsonb_build_object('idempotency_key',$2,'status','pending','notes',$6)
    WHERE NOT EXISTS(SELECT 1 FROM lead_activities WHERE metadata->>'idempotency_key'=$2);
  RETURN '{}';
END $$;
\ir ../supabase/migrations/20261106120000_appointment_show_rate_sequence.sql

DO $$
DECLARE lead uuid:=gen_random_uuid(); appt uuid; n int; sid uuid; reply uuid:=gen_random_uuid(); target timestamptz;
BEGIN
  INSERT INTO leads VALUES(lead,'Ernest Test');
  target:=(((clock_timestamp() AT TIME ZONE 'America/Chicago')::date+3)+time '17:00') AT TIME ZONE 'America/Chicago';
  PERFORM upsert_sequence_appointment_v1(NULL,lead,target,'in_person',NULL,NULL,'Ernest',true);
  PERFORM upsert_sequence_appointment_v1(NULL,lead,target,'in_person',NULL,NULL,'Ernest',true);
  ASSERT (SELECT count(*)=1 FROM appointments WHERE lead_id=lead),'booking retry creates one appointment';
  UPDATE appointments SET status='cancelled' WHERE lead_id=lead;
  INSERT INTO appointments(lead_id,scheduled_at,type,assigned_to,sequence_enabled) VALUES(lead,target,'in_person','Ernest',true) RETURNING id INTO appt;
  SELECT count(*) INTO n FROM appointment_sequence_steps WHERE appointment_id=appt AND status='queued';
  ASSERT n=6,'six initial steps';
  ASSERT (SELECT due_at=target-interval '52 minutes' FROM appointment_sequence_steps WHERE appointment_id=appt AND touch='arrival_sms'),'arrival exactly 52 minutes';
  ASSERT (SELECT (due_at AT TIME ZONE 'America/Chicago')::time=time '08:00' FROM appointment_sequence_steps WHERE appointment_id=appt AND touch='morning_sms'),'morning at 8 Chicago';
  UPDATE appointments SET updated_at=clock_timestamp() WHERE id=appt;
  ASSERT (SELECT count(*)=6 FROM appointment_sequence_steps WHERE appointment_id=appt),'no duplicate enrollment';
  UPDATE appointment_sequence_steps SET status='sent',finished_at=clock_timestamp() WHERE appointment_id=appt AND touch='confirm_sms';
  SELECT id INTO sid FROM appointment_sequence_steps WHERE appointment_id=appt AND touch='silence';
  ASSERT sid IS NOT NULL,'timer created only after confirmation sent';
  PERFORM appointment_sequence_escalate_v1(sid);
  ASSERT (SELECT confirmation_status='silent' AND no_show_risk FROM appointments WHERE id=appt),'silence risk tracked';
  PERFORM appointment_sequence_escalate_v1(sid);
  ASSERT (SELECT count(*)=1 FROM lead_activities WHERE metadata->>'requires_call_outcome'='true'),'one call task';
  BEGIN
    UPDATE lead_activities SET metadata=metadata||'{"status":"completed"}' WHERE metadata->>'requires_call_outcome'='true';
    RAISE EXCEPTION 'Bare completion should have been rejected';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE 'Add a line in notes:%','completion requires factual call outcome';
  END;
  PERFORM appointment_sequence_escalate_v1((SELECT id FROM appointment_sequence_steps WHERE appointment_id=appt AND touch='escalate'));
  ASSERT (SELECT count(*)=1 FROM notifications),'CRM escalation alert';
  PERFORM appointment_sequence_reply_v1(lead,'confirm',reply,'SMtest');
  PERFORM appointment_sequence_reply_v1(lead,'confirm',reply,'SMtest');
  ASSERT (SELECT confirmation_status='confirmed' FROM appointments WHERE id=appt),'reply confirmation';
  ASSERT (SELECT count(*)=1 FROM lead_activities WHERE id=reply),'idempotent reply';
  PERFORM appointment_sequence_reply_v1(lead,'reschedule',gen_random_uuid(),'SMchange');
  ASSERT (SELECT reschedule_requested_at IS NOT NULL AND status='confirmed' FROM appointments WHERE id=appt),'request separate from outcome';
  ASSERT NOT EXISTS(SELECT 1 FROM appointment_sequence_steps WHERE appointment_id=appt AND status='queued'),'old reminders removed';
  UPDATE appointments SET scheduled_at=target+interval '1 day',status='scheduled' WHERE id=appt;
  ASSERT (SELECT sequence_version=2 AND reschedule_requested_at IS NULL AND confirmation_status='pending' FROM appointments WHERE id=appt),'reschedule resets confirmation';
  ASSERT (SELECT count(*)=6 FROM appointment_sequence_steps WHERE appointment_id=appt AND version=2),'new version enrolled';
  UPDATE appointments SET status='cancelled' WHERE id=appt;
  ASSERT NOT EXISTS(SELECT 1 FROM appointment_sequence_steps WHERE appointment_id=appt AND status='queued'),'cancellation stops all sends';
  INSERT INTO appointments(lead_id,scheduled_at,type,assigned_to,sequence_enabled) VALUES(lead,target,'phone_call','Ernest',true) RETURNING id INTO appt;
  ASSERT (SELECT status='skipped' FROM appointment_sequence_steps WHERE appointment_id=appt AND touch='arrival_sms'),'phone skips arrival';
  INSERT INTO appointments(lead_id,scheduled_at,type,assigned_to,sequence_enabled) VALUES(lead,clock_timestamp()+interval '20 minutes','in_person','Ernest',true) RETURNING id INTO appt;
  ASSERT (SELECT status='skipped' FROM appointment_sequence_steps WHERE appointment_id=appt AND touch='confirm_sms'),'short notice skips expired confirmation';
  ASSERT (SELECT status='skipped' FROM appointment_sequence_steps WHERE appointment_id=appt AND touch='arrival_sms'),'short notice skips expired arrival';
  INSERT INTO appointments(lead_id,scheduled_at,type,assigned_to,sequence_enabled) VALUES(lead,'2030-03-11T22:00:00Z','in_person','Ernest',true) RETURNING id INTO appt;
  ASSERT (SELECT due_at='2030-03-11T13:00:00Z' FROM appointment_sequence_steps WHERE appointment_id=appt AND touch='morning_sms'),'daylight saving morning';
  INSERT INTO appointments(lead_id,scheduled_at,type,assigned_to,sequence_enabled) VALUES(lead,'2030-11-05T23:00:00Z','in_person','Ernest',true) RETURNING id INTO appt;
  ASSERT (SELECT due_at='2030-11-05T14:00:00Z' FROM appointment_sequence_steps WHERE appointment_id=appt AND touch='morning_sms'),'standard time morning';
END $$;
