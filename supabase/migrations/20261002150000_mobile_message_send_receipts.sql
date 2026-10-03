-- Durable actor-scoped command receipts for mobile outbound communications.
-- Provider requests are never repeated for ambiguous Twilio outcomes. Resend
-- retries use its documented 24-hour idempotency window and stable provider key.
CREATE TABLE IF NOT EXISTS public.mobile_message_send_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  idempotency_key_hash text NOT NULL CHECK (length(idempotency_key_hash) = 64),
  -- Keep the receipt identity after a CRM lead is deleted; a retry must not
  -- silently create a second provider send just because the contact was removed.
  lead_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms','email')),
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  state text NOT NULL CHECK (state IN ('reserved','sending','provider_accepted','completed','failed','uncertain')),
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_attempt_at timestamptz,
  provider_id text,
  provider_idempotency_key text,
  http_status integer,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_user_id,idempotency_key_hash)
);

ALTER TABLE public.mobile_message_send_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mobile_message_send_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mobile_message_send_receipts TO service_role;

-- An expired worker and its recovery may both reach history persistence. The
-- receipt ID identifies one canonical communication even across that overlap.
CREATE UNIQUE INDEX IF NOT EXISTS lead_activities_mobile_message_command_id
  ON public.lead_activities ((metadata->>'mobile_message_command_id'))
  WHERE activity_type IN ('sms','email') AND metadata->>'mobile_message_command_id' IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_mobile_message_send_v1(
  p_actor_user_id uuid, p_key_hash text, p_lead_id uuid, p_channel text,
  p_payload_hash text, p_lease_token uuid, p_provider_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.mobile_message_send_receipts%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR p_lease_token IS NULL OR p_lead_id IS NULL
    OR p_key_hash IS NULL OR length(p_key_hash) <> 64
    OR p_payload_hash IS NULL OR length(p_payload_hash) <> 64
    OR p_channel IS NULL OR p_channel NOT IN ('sms','email')
    OR nullif(p_provider_key,'') IS NULL THEN
    RAISE EXCEPTION 'mobile_message_send_invalid_claim';
  END IF;
  INSERT INTO public.mobile_message_send_receipts(
    actor_user_id,idempotency_key_hash,lead_id,channel,payload_hash,state,
    lease_token,lease_expires_at,provider_idempotency_key
  ) VALUES (
    p_actor_user_id,p_key_hash,p_lead_id,p_channel,p_payload_hash,'reserved',
    p_lease_token,clock_timestamp()+interval '2 minutes',p_provider_key
  ) ON CONFLICT (actor_user_id,idempotency_key_hash) DO NOTHING;
  SELECT * INTO r FROM public.mobile_message_send_receipts
    WHERE actor_user_id=p_actor_user_id AND idempotency_key_hash=p_key_hash FOR UPDATE;
  IF r.lead_id IS DISTINCT FROM p_lead_id OR r.channel IS DISTINCT FROM p_channel
    OR r.payload_hash IS DISTINCT FROM p_payload_hash THEN
    RETURN jsonb_build_object('kind','conflict');
  END IF;
  IF r.state IN ('completed','failed','uncertain') THEN
    RETURN jsonb_build_object('kind','replay','status',coalesce(r.http_status,409),'result',coalesce(r.result,'{}'::jsonb));
  END IF;
  IF r.state='sending' AND r.lease_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('kind','pending');
  END IF;
  IF r.state='sending' AND r.channel='email' AND (r.provider_attempt_at IS NULL
      OR r.provider_attempt_at < clock_timestamp()-interval '23 hours') THEN
    UPDATE public.mobile_message_send_receipts SET state='uncertain',http_status=409,
      result=jsonb_build_object('error','Delivery outcome is unknown. Do not resend this command.'),
      lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
      WHERE id=r.id;
    RETURN jsonb_build_object('kind','replay','status',409,
      'result',jsonb_build_object('error','Delivery outcome is unknown. Do not resend this command.'));
  END IF;
  IF r.state='reserved' AND r.lease_expires_at > clock_timestamp() AND r.lease_token<>p_lease_token THEN
    RETURN jsonb_build_object('kind','pending');
  END IF;
  IF r.state='provider_accepted' AND r.lease_expires_at > clock_timestamp() AND r.lease_token<>p_lease_token THEN
    RETURN jsonb_build_object('kind','pending');
  END IF;
  UPDATE public.mobile_message_send_receipts SET lease_token=p_lease_token,
    lease_expires_at=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp()
    WHERE id=r.id;
  RETURN jsonb_build_object('kind',CASE WHEN r.state='reserved' THEN 'reserved' ELSE 'recovered' END,
    'token',p_lease_token,'receipt_id',r.id,'state',r.state,'provider_id',r.provider_id,
    'result',r.result,'provider_key',r.provider_idempotency_key);
END $$;

CREATE OR REPLACE FUNCTION public.transition_mobile_message_send_v1(
  p_actor_user_id uuid,p_key_hash text,p_lease_token uuid,p_from_state text,
  p_to_state text,p_provider_id text,p_http_status integer,p_result jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT ((p_from_state='reserved' AND p_to_state IN ('sending','failed','uncertain'))
    OR (p_from_state='sending' AND p_to_state IN ('provider_accepted','failed','uncertain'))
    OR (p_from_state='provider_accepted' AND p_to_state='completed')) THEN
    RAISE EXCEPTION 'mobile_message_send_invalid_transition';
  END IF;
  UPDATE public.mobile_message_send_receipts SET state=p_to_state,
    provider_attempt_at=CASE WHEN p_to_state='sending' THEN clock_timestamp() ELSE provider_attempt_at END,
    provider_id=coalesce(p_provider_id,provider_id),http_status=p_http_status,result=p_result,
    lease_token=CASE WHEN p_to_state='completed' THEN NULL ELSE lease_token END,
    lease_expires_at=CASE WHEN p_to_state='completed' THEN NULL ELSE lease_expires_at END,
    updated_at=clock_timestamp()
    WHERE actor_user_id=p_actor_user_id AND idempotency_key_hash=p_key_hash
      AND lease_token=p_lease_token AND state=p_from_state;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.claim_mobile_message_send_v1(uuid,text,uuid,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.transition_mobile_message_send_v1(uuid,text,uuid,text,text,text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mobile_message_send_v1(uuid,text,uuid,text,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_mobile_message_send_v1(uuid,text,uuid,text,text,text,integer,jsonb) TO service_role;
