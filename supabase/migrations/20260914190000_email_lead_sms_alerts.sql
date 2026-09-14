-- Durable, one-submission-per-recipient alerts for confirmed email Lead handoffs.
CREATE TABLE public.em_lead_sms_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  handoff_id uuid NOT NULL REFERENCES public.em_handoffs(id),
  notification_id uuid NOT NULL REFERENCES public.em_notifications(id),
  recipient_id uuid NOT NULL,
  phase text NOT NULL CHECK (phase IN ('owner','backup')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','submitting','accepted','delivered','failed','unknown','cancelled')),
  recipient_phone text,
  provider_sid text UNIQUE,
  provider_status text,
  last_error text,
  response_due_at timestamptz,
  submitted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(handoff_id,recipient_id,phase)
);
ALTER TABLE public.em_lead_sms_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.em_lead_sms_alerts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.em_lead_sms_alerts TO service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='email_workflow_runtime') THEN
  GRANT SELECT,INSERT,UPDATE ON public.em_lead_sms_alerts TO email_workflow_runtime;
 END IF;
END $$;
CREATE INDEX em_lead_sms_pending ON public.em_lead_sms_alerts(state,created_at);
CREATE OR REPLACE FUNCTION public.queue_email_lead_sms_alert()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.kind IN ('Callback task ready','Callback assigned — acceptance needed') THEN
  INSERT INTO public.em_lead_sms_alerts(workspace_id,handoff_id,notification_id,recipient_id,phase,created_at)
  SELECT h.workspace_id,h.id,NEW.id,h.owner_id,'owner',NEW.created_at
  FROM public.em_handoffs h JOIN public.leads l ON l.id=h.lead_id
  WHERE h.workspace_id=NEW.workspace_id AND h.thread_id=NEW.thread_id
   AND h.owner_id=NEW.recipient_id AND h.crm_sync_state='synced'
   AND h.seller_interest_confirmed AND h.state='needs_contact'
   AND l.classification IN ('lead','opportunity')
  ON CONFLICT(handoff_id,recipient_id,phase) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.queue_email_lead_sms_alert() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER queue_email_lead_sms AFTER INSERT ON public.em_notifications
FOR EACH ROW EXECUTE FUNCTION public.queue_email_lead_sms_alert();
