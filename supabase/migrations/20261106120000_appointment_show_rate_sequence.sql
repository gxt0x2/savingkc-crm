-- Ghost Protocol v3. Uses the existing workflow worker; no historical enrollments.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS confirmation_status text NOT NULL DEFAULT 'pending' CHECK (confirmation_status IN ('pending','confirmed','silent')),
  ADD COLUMN IF NOT EXISTS no_show_risk boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_show_risk_at timestamptz,
  ADD COLUMN IF NOT EXISTS reschedule_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS sequence_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sequence_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sequence_booked_at timestamptz;

CREATE TABLE public.appointment_sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  version integer NOT NULL,
  touch text NOT NULL CHECK (touch IN ('booking_sms','booking_email','confirm_sms','morning_sms','arrival_sms','silence','escalate')),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','dispatching','sent','skipped','failed','uncertain')),
  reason text,
  provider_id text,
  claimed_at timestamptz,
  finished_at timestamptz,
  UNIQUE(appointment_id,version,touch)
);
ALTER TABLE public.appointment_sequence_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appointment_sequence_steps FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.appointment_sequence_steps TO service_role;
CREATE INDEX appointment_sequence_due ON public.appointment_sequence_steps(due_at) WHERE status='queued';

CREATE FUNCTION public.appointment_sequence_revision_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.sequence_enabled THEN NEW.sequence_version:=1; NEW.sequence_booked_at:=clock_timestamp(); END IF;
  ELSIF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at OR NEW.type IS DISTINCT FROM OLD.type
    OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR (NEW.sequence_enabled AND NOT OLD.sequence_enabled)
    OR (OLD.status='rescheduled' AND NEW.status='scheduled') THEN
    NEW.sequence_version:=OLD.sequence_version+1;
    NEW.sequence_booked_at:=clock_timestamp();
    NEW.confirmation_status:='pending'; NEW.reschedule_requested_at:=NULL;
    IF NEW.status='confirmed' THEN NEW.status:='scheduled'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointment_sequence_revision BEFORE INSERT OR UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.appointment_sequence_revision_v1();

CREATE FUNCTION public.appointment_sequence_schedule_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE morning timestamptz; confirmation timestamptz; arrival timestamptz; now_at timestamptz:=clock_timestamp();
BEGIN
  UPDATE public.appointment_sequence_steps SET status='skipped',reason='appointment_changed',finished_at=now_at
  WHERE appointment_id=NEW.id AND status='queued' AND
    (version<>NEW.sequence_version OR NOT NEW.sequence_enabled OR NEW.status NOT IN ('scheduled','confirmed') OR NEW.reschedule_requested_at IS NOT NULL);
  UPDATE public.lead_activities SET metadata=metadata||jsonb_build_object('status','cancelled','resolution','appointment_changed')
    WHERE lead_id=NEW.lead_id AND metadata->>'workflow_id'='appointment-ghost-protocol'
      AND metadata->>'appointment_id'=NEW.id::text AND activity_type='callback'
      AND coalesce(metadata->>'status','pending') NOT IN ('completed','cancelled')
      AND (coalesce((metadata->>'sequence_version')::int,-1)<>NEW.sequence_version OR NOT NEW.sequence_enabled OR NEW.status NOT IN ('scheduled','confirmed'));
  IF NOT NEW.sequence_enabled OR NEW.status NOT IN ('scheduled','confirmed') OR NEW.reschedule_requested_at IS NOT NULL OR NEW.scheduled_at<=now_at THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.sequence_version=OLD.sequence_version THEN RETURN NEW; END IF;
  morning:=((NEW.scheduled_at AT TIME ZONE 'America/Chicago')::date+time '08:00') AT TIME ZONE 'America/Chicago';
  confirmation:=NEW.scheduled_at-interval '24 hours';
  -- Overnight confirmation requests wait until 8 AM. Never compress into booking.
  IF (confirmation AT TIME ZONE 'America/Chicago')::time < time '08:00' THEN
    confirmation:=((confirmation AT TIME ZONE 'America/Chicago')::date+time '08:00') AT TIME ZONE 'America/Chicago';
  ELSIF (confirmation AT TIME ZONE 'America/Chicago')::time >= time '20:00' THEN
    confirmation:=(((confirmation AT TIME ZONE 'America/Chicago')::date+1)+time '08:00') AT TIME ZONE 'America/Chicago';
  END IF;
  arrival:=NEW.scheduled_at-interval '52 minutes';
  INSERT INTO public.appointment_sequence_steps(appointment_id,version,touch,due_at,status,reason)
  SELECT NEW.id,NEW.sequence_version,touch,due_at,
    CASE WHEN skip THEN 'skipped' ELSE 'queued' END,CASE WHEN skip THEN 'short_notice_or_not_applicable' END
  FROM (VALUES
    ('booking_sms',now_at,false),('booking_email',now_at,false),
    ('confirm_sms',confirmation,confirmation<now_at+interval '2 hours' OR confirmation>=morning),
    ('morning_sms',morning,morning<now_at+interval '2 hours' OR morning>=NEW.scheduled_at OR morning>arrival-interval '30 minutes'),
    ('arrival_sms',arrival,NEW.type NOT IN ('in_person','onsite') OR arrival<now_at+interval '30 minutes' OR (arrival AT TIME ZONE 'America/Chicago')::time<time '08:00'),
    ('escalate',greatest(morning,now_at),morning>=NEW.scheduled_at)
  ) AS steps(touch,due_at,skip) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER appointment_sequence_schedule AFTER INSERT OR UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.appointment_sequence_schedule_v1();

CREATE FUNCTION public.appointment_sequence_audit_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE a public.appointments; timer_at timestamptz;
BEGIN
  SELECT * INTO a FROM public.appointments WHERE id=NEW.appointment_id;
  INSERT INTO public.lead_activities(lead_id,activity_type,description,agent,metadata)
  VALUES(a.lead_id,'appointment_sequence',NEW.touch||': '||NEW.status,'System',jsonb_build_object(
    'workflow_id','appointment-ghost-protocol','appointment_id',a.id,'sequence_version',NEW.version,
    'step_id',NEW.id,'touch',NEW.touch,'status',NEW.status,'reason',NEW.reason,'provider_id',NEW.provider_id,'due_at',NEW.due_at));
  IF NEW.status IN ('failed','uncertain') THEN
    INSERT INTO public.notifications(type,title,body,url,metadata) VALUES('appointment','Appointment message needs review',
      coalesce(a.assigned_to,'Rep')||': '||NEW.touch||' is '||NEW.status||'. Check delivery before sending again.',
      '/leads/'||a.lead_id,jsonb_build_object('appointment_id',a.id,'assigned_to',a.assigned_to,'step_id',NEW.id));
  END IF;
  IF NEW.status='sent' AND NEW.touch IN ('confirm_sms','booking_sms') AND
    (NEW.touch='confirm_sms' OR a.scheduled_at-a.sequence_booked_at<interval '26 hours') THEN
    timer_at:=coalesce(NEW.finished_at,clock_timestamp())+interval '4 hours';
    IF (timer_at AT TIME ZONE 'America/Chicago')::time>=time '20:00' THEN
      timer_at:=(((timer_at AT TIME ZONE 'America/Chicago')::date+1)+time '08:30') AT TIME ZONE 'America/Chicago';
    ELSIF (timer_at AT TIME ZONE 'America/Chicago')::time<time '08:30' THEN
      timer_at:=((timer_at AT TIME ZONE 'America/Chicago')::date+time '08:30') AT TIME ZONE 'America/Chicago';
    END IF;
    IF timer_at<a.scheduled_at THEN
      INSERT INTO public.appointment_sequence_steps(appointment_id,version,touch,due_at) VALUES(a.id,NEW.version,'silence',timer_at) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointment_sequence_audit AFTER INSERT OR UPDATE OF status ON public.appointment_sequence_steps
FOR EACH ROW EXECUTE FUNCTION public.appointment_sequence_audit_v1();

CREATE FUNCTION public.claim_appointment_sequence_step_v1() RETURNS SETOF public.appointment_sequence_steps
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE chosen uuid;
BEGIN
  -- A crashed provider submission has an uncertain outcome; never blindly replay it.
  UPDATE public.appointment_sequence_steps SET status='uncertain',reason='worker_interrupted',finished_at=clock_timestamp()
    WHERE status='dispatching' AND claimed_at<clock_timestamp()-interval '5 minutes';
  UPDATE public.appointment_sequence_steps s SET status='skipped',reason='appointment_inactive_or_expired',finished_at=clock_timestamp()
    FROM public.appointments a WHERE a.id=s.appointment_id AND s.status='queued' AND
    (a.sequence_version<>s.version OR NOT a.sequence_enabled OR a.status NOT IN ('scheduled','confirmed') OR a.reschedule_requested_at IS NOT NULL OR a.scheduled_at<=clock_timestamp());
  SELECT id INTO chosen FROM public.appointment_sequence_steps WHERE status='queued' AND due_at<=clock_timestamp()
    ORDER BY due_at,CASE WHEN touch='silence' THEN 0 WHEN touch='escalate' THEN 1 ELSE 2 END,id FOR UPDATE SKIP LOCKED LIMIT 1;
  RETURN QUERY UPDATE public.appointment_sequence_steps SET status='dispatching',claimed_at=clock_timestamp() WHERE id=chosen RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.claim_appointment_sequence_step_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_appointment_sequence_step_v1() TO service_role;

CREATE FUNCTION public.appointment_sequence_escalate_v1(p_step_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.appointment_sequence_steps; a public.appointments; task jsonb; task_id uuid; task_status text; seller text;
BEGIN
  SELECT * INTO s FROM public.appointment_sequence_steps WHERE id=p_step_id;
  SELECT * INTO a FROM public.appointments WHERE id=s.appointment_id FOR UPDATE;
  IF a.sequence_version<>s.version OR a.status NOT IN ('scheduled','confirmed') OR a.reschedule_requested_at IS NOT NULL
    OR a.confirmation_status='confirmed' OR NOT a.sequence_enabled THEN RETURN 'no_action_needed'; END IF;
  IF EXISTS(SELECT 1 FROM public.lead_activities WHERE lead_id=a.lead_id AND activity_type='appointment_reply_review'
    AND metadata->>'appointment_id'=a.id::text AND metadata->>'sequence_version'=a.sequence_version::text) THEN RETURN 'reply_needs_review'; END IF;
  SELECT split_part(full_name,' ',1) INTO seller FROM public.leads WHERE id=a.lead_id;
  SELECT id,metadata->>'status' INTO task_id,task_status FROM public.lead_activities
    WHERE lead_id=a.lead_id AND metadata->>'idempotency_key'='appointment:'||a.id||':'||s.version||':confirm-call' LIMIT 1 FOR UPDATE;
  IF s.touch='silence' THEN
    UPDATE public.appointments SET confirmation_status='silent',no_show_risk=true,no_show_risk_at=coalesce(no_show_risk_at,clock_timestamp()) WHERE id=a.id;
    task:=public.create_work_item_v2('System','appointment:'||a.id||':'||s.version||':confirm-call',a.lead_id,'callback',
      'Call '||coalesce(seller,'seller')||'. No appointment confirmation.',
      'No reply within four hours. Add a line in notes beginning with Call outcome followed by a colon and the result (confirmed, voicemail, or reschedule requested).',
      greatest(clock_timestamp(),((clock_timestamp() AT TIME ZONE 'America/Chicago')::date+time '08:30') AT TIME ZONE 'America/Chicago'),
      a.assigned_to,'acquisitions','setter','normal',false,
      jsonb_build_object('workflow_id','appointment-ghost-protocol','appointment_id',a.id,'sequence_version',s.version,'no_show_risk',true,'requires_call_outcome',true));
    -- If the morning check already ran before the four-hour deadline, recheck now.
    UPDATE public.appointment_sequence_steps SET status='queued',due_at=clock_timestamp(),reason=NULL
      WHERE appointment_id=a.id AND version=s.version AND touch='escalate' AND status='sent';
    RETURN 'confirmation_call_created';
  END IF;
  IF task_id IS NULL OR task_status IN ('completed','cancelled') THEN RETURN 'no_open_call'; END IF;
  UPDATE public.lead_activities SET metadata=metadata||jsonb_build_object('priority','urgent') WHERE id=task_id;
  INSERT INTO public.notifications(type,title,body,url,metadata)
    VALUES('appointment','Appointment confirmation needs attention',a.assigned_to||': call '||coalesce(seller,'seller')||'. Confirmation call is still open.',
      '/leads/'||a.lead_id,jsonb_build_object('appointment_id',a.id,'assigned_to',a.assigned_to,'no_show_risk',true,'step_id',s.id));
  RETURN 'confirmation_call_escalated';
END $$;
REVOKE ALL ON FUNCTION public.appointment_sequence_escalate_v1(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.appointment_sequence_escalate_v1(uuid) TO service_role;

CREATE FUNCTION public.appointment_sequence_reply_v1(p_lead_id uuid,p_response text,p_event_id uuid,p_message_sid text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.appointments;
BEGIN
  IF p_response NOT IN ('confirm','reschedule','review') THEN RAISE EXCEPTION 'invalid_appointment_reply'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('appointment-reply:'||p_event_id,0));
  IF EXISTS(SELECT 1 FROM public.lead_activities WHERE id=p_event_id) THEN
    RETURN (SELECT (metadata->>'appointment_id')::uuid FROM public.lead_activities WHERE id=p_event_id);
  END IF;
  IF (SELECT count(*) FROM public.appointments WHERE lead_id=p_lead_id AND status IN ('scheduled','confirmed') AND scheduled_at>clock_timestamp())>1 THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.appointments WHERE lead_id=p_lead_id AND status IN ('scheduled','confirmed')
    AND scheduled_at>clock_timestamp() ORDER BY scheduled_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF a.reschedule_requested_at IS NOT NULL THEN RETURN NULL; END IF;
  IF p_response='review' AND NOT a.sequence_enabled THEN RETURN NULL; END IF;
  IF a.sequence_enabled AND NOT EXISTS(SELECT 1 FROM public.appointment_sequence_steps WHERE appointment_id=a.id AND version=a.sequence_version AND touch IN ('booking_sms','confirm_sms') AND status='sent') THEN RETURN NULL; END IF;
  IF p_response='review' THEN
    INSERT INTO public.lead_activities(id,lead_id,activity_type,description,agent,metadata) VALUES(p_event_id,p_lead_id,'appointment_reply_review',
      'Seller replied; rep review required','Seller',jsonb_build_object('appointment_id',a.id,'sequence_version',a.sequence_version,'message_sid',p_message_sid));
    PERFORM public.create_work_item_v2('System','appointment:'||a.id||':'||a.sequence_version||':reply-review',a.lead_id,'callback',
      'Review seller appointment reply','Read the seller reply in Conversations and confirm or arrange a new time.',
      greatest(clock_timestamp(),((clock_timestamp() AT TIME ZONE 'America/Chicago')::date+time '08:30') AT TIME ZONE 'America/Chicago'),a.assigned_to,
      'acquisitions','setter','normal',false,jsonb_build_object('workflow_id','appointment-ghost-protocol','appointment_id',a.id,'sequence_version',a.sequence_version));
    RETURN a.id;
  END IF;
  UPDATE public.appointments SET confirmation_status=CASE WHEN p_response='confirm' THEN 'confirmed' ELSE 'pending' END,
    status=CASE WHEN p_response='confirm' THEN 'confirmed' ELSE status END,
    reschedule_requested_at=CASE WHEN p_response='reschedule' THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp() WHERE id=a.id;
  INSERT INTO public.lead_activities(id,lead_id,activity_type,description,agent,metadata)
    VALUES(p_event_id,p_lead_id,CASE WHEN p_response='confirm' THEN 'appointment_confirmed' ELSE 'appointment_reschedule_requested' END,
      CASE WHEN p_response='confirm' THEN 'Seller confirmed appointment via SMS' ELSE 'Seller requested a different appointment time via SMS' END,
      'Seller',jsonb_build_object('appointment_id',a.id,'response',p_response,'message_sid',p_message_sid,'source','sms_reply')) ON CONFLICT DO NOTHING;
  UPDATE public.lead_activities SET metadata=metadata||jsonb_build_object('status','cancelled','resolution','seller_replied')
    WHERE lead_id=a.lead_id AND metadata->>'idempotency_key'='appointment:'||a.id||':'||a.sequence_version||':confirm-call'
      AND coalesce(metadata->>'status','pending') NOT IN ('completed','cancelled');
  IF p_response='reschedule' THEN
    PERFORM public.create_work_item_v2('System','appointment:'||a.id||':'||a.sequence_version||':reschedule',a.lead_id,'callback',
      'Arrange a new appointment time','Seller requested a change. Save the new appointment time to restart reminders.',greatest(clock_timestamp(),((clock_timestamp() AT TIME ZONE 'America/Chicago')::date+time '08:30') AT TIME ZONE 'America/Chicago'),a.assigned_to,
      'acquisitions','setter','urgent',false,jsonb_build_object('workflow_id','appointment-ghost-protocol','appointment_id',a.id,'sequence_version',a.sequence_version));
    INSERT INTO public.notifications(type,title,body,url,metadata) VALUES('appointment','Seller requested rescheduling',
      coalesce(a.assigned_to,'Rep')||': arrange a new appointment time. Reminders are stopped.','/leads/'||a.lead_id,
      jsonb_build_object('appointment_id',a.id,'assigned_to',a.assigned_to));
  END IF;
  RETURN a.id;
END $$;
REVOKE ALL ON FUNCTION public.appointment_sequence_reply_v1(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.appointment_sequence_reply_v1(uuid,text,uuid,text) TO service_role;

-- A checked box alone cannot complete a confirmation call.
CREATE FUNCTION public.appointment_confirmation_call_outcome_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.metadata->>'requires_call_outcome'='true' AND NEW.metadata->>'status'='completed'
    AND OLD.metadata->>'status' IS DISTINCT FROM 'completed'
    AND coalesce(NEW.metadata->>'notes','') !~* '(^|\n)Call outcome: (confirmed|voicemail|reschedule requested)([.\r\n]|$)' THEN
    RAISE EXCEPTION 'Add a line in notes: Call outcome: confirmed, Call outcome: voicemail, or Call outcome: reschedule requested';
  END IF;
  IF OLD.metadata->>'requires_call_outcome'='true' AND NEW.metadata->>'status'='completed' AND OLD.metadata->>'status' IS DISTINCT FROM 'completed' THEN
    IF NEW.metadata->>'notes' ~* '(^|\n)Call outcome: confirmed([.\r\n]|$)' THEN
      UPDATE public.appointments SET confirmation_status='confirmed',status='confirmed' WHERE id=(NEW.metadata->>'appointment_id')::uuid AND status IN ('scheduled','confirmed') AND sequence_version=(NEW.metadata->>'sequence_version')::int AND reschedule_requested_at IS NULL;
    ELSIF NEW.metadata->>'notes' ~* '(^|\n)Call outcome: reschedule requested([.\r\n]|$)' THEN
      UPDATE public.appointments SET reschedule_requested_at=clock_timestamp() WHERE id=(NEW.metadata->>'appointment_id')::uuid AND status IN ('scheduled','confirmed') AND sequence_version=(NEW.metadata->>'sequence_version')::int;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointment_confirmation_call_outcome BEFORE UPDATE ON public.lead_activities
FOR EACH ROW EXECUTE FUNCTION public.appointment_confirmation_call_outcome_v1();

-- Canonical appointment risk is projected on the contact without losing appointment history.
CREATE VIEW public.appointment_show_rate_facts WITH (security_invoker=true) AS
SELECT id AS appointment_id,lead_id,scheduled_at,type,status,confirmation_status,no_show_risk,no_show_risk_at,reschedule_requested_at
FROM public.appointments;
GRANT SELECT ON public.appointment_show_rate_facts TO service_role;

CREATE FUNCTION public.upsert_sequence_appointment_v1(p_appointment_id uuid,p_lead_id uuid,p_scheduled_at timestamptz,p_type text,p_address text,p_notes text,p_assigned_to text,p_enabled boolean)
RETURNS SETOF public.appointments LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing_id uuid;
BEGIN
  IF p_scheduled_at<=clock_timestamp() OR p_scheduled_at>clock_timestamp()+interval '2 years' OR p_type NOT IN ('in_person','phone_call','google_meet') THEN RAISE EXCEPTION 'invalid_appointment'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('appointment-booking:'||p_lead_id,0));
  SELECT id INTO existing_id FROM public.appointments WHERE lead_id=p_lead_id AND status IN ('scheduled','confirmed','rescheduled')
    AND CASE WHEN p_appointment_id IS NOT NULL THEN id=p_appointment_id ELSE scheduled_at BETWEEN p_scheduled_at-interval '60 minutes' AND p_scheduled_at+interval '60 minutes' END
    ORDER BY scheduled_at LIMIT 1 FOR UPDATE;
  IF p_appointment_id IS NOT NULL AND existing_id IS NULL THEN RAISE EXCEPTION 'appointment_not_found'; END IF;
  IF existing_id IS NOT NULL THEN
    RETURN QUERY UPDATE public.appointments SET scheduled_at=p_scheduled_at,type=p_type,address=p_address,notes=p_notes,assigned_to=p_assigned_to,
      sequence_enabled=p_enabled,status=CASE WHEN status='rescheduled' THEN 'scheduled' ELSE status END,updated_at=clock_timestamp()
      WHERE id=existing_id RETURNING *;
  ELSE
    RETURN QUERY INSERT INTO public.appointments(lead_id,scheduled_at,type,status,address,notes,assigned_to,source,sequence_enabled)
      VALUES(p_lead_id,p_scheduled_at,p_type,'scheduled',p_address,p_notes,p_assigned_to,'manual',p_enabled) RETURNING *;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.upsert_sequence_appointment_v1(uuid,uuid,timestamptz,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_sequence_appointment_v1(uuid,uuid,timestamptz,text,text,text,text,boolean) TO service_role;
