-- Allow a fresh, durable SMS alert for each callback assignment notice.
-- The previous key permanently suppressed a later assignment to the same agent.
ALTER TABLE public.em_lead_sms_alerts
  DROP CONSTRAINT em_lead_sms_alerts_handoff_id_recipient_id_phase_key;

ALTER TABLE public.em_lead_sms_alerts
  ADD CONSTRAINT em_lead_sms_alerts_notification_id_recipient_id_phase_key
  UNIQUE(notification_id,recipient_id,phase);

CREATE OR REPLACE FUNCTION public.queue_email_lead_sms_alert()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.kind IN ('Callback task ready','Callback assigned — acceptance needed') THEN
  -- A notice is one assignment cycle. Retire any unsent alert from an older
  -- cycle before queuing the newly assigned owner.
  UPDATE public.em_lead_sms_alerts a
  SET state='cancelled',
      last_error='Superseded by a newer callback assignment',
      updated_at=NEW.created_at
  FROM public.em_handoffs h
  WHERE a.handoff_id=h.id
    AND h.workspace_id=NEW.workspace_id
    AND h.thread_id=NEW.thread_id
    AND a.notification_id<>NEW.id
    AND a.state='queued';

  INSERT INTO public.em_lead_sms_alerts(workspace_id,handoff_id,notification_id,recipient_id,phase,created_at)
  SELECT h.workspace_id,h.id,NEW.id,h.owner_id,'owner',NEW.created_at
  FROM public.em_handoffs h JOIN public.leads l ON l.id=h.lead_id
  WHERE h.workspace_id=NEW.workspace_id AND h.thread_id=NEW.thread_id
   AND h.owner_id=NEW.recipient_id AND h.crm_sync_state='synced'
   AND h.seller_interest_confirmed AND h.state='needs_contact'
   AND l.classification IN ('lead','opportunity')
  ON CONFLICT(notification_id,recipient_id,phase) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
