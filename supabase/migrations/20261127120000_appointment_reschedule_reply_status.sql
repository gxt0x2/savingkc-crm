-- A seller text asking to reschedule used to leave the appointment status as
-- scheduled or confirmed. Reminders only stop when the appointment is no longer
-- scheduled or confirmed, or when reschedule_requested_at is set. Set the
-- status itself to rescheduled and skip any queued reminder steps.
-- Does not send messages and does not write delivery records.

CREATE OR REPLACE FUNCTION public.appointment_sequence_reply_v1(p_lead_id uuid,p_response text,p_event_id uuid,p_message_sid text) RETURNS uuid
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
  IF p_response='review' AND a.confirmation_status='confirmed' THEN RETURN NULL; END IF;
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
  IF p_response='reschedule' THEN
    UPDATE public.appointment_sequence_steps
      SET status='skipped', reason='seller_reschedule_reply', finished_at=clock_timestamp()
      WHERE appointment_id=a.id AND status='queued';
  END IF;
  UPDATE public.appointments SET confirmation_status=CASE WHEN p_response='confirm' THEN 'confirmed' ELSE 'pending' END,
    status=CASE WHEN p_response='confirm' THEN 'confirmed' WHEN p_response='reschedule' THEN 'rescheduled' ELSE status END,
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
