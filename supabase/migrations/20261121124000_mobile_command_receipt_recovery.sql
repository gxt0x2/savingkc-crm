-- A claim is a short execution lease, not proof that the side effect did not run.
-- Reclaimed callers must reconcile the command's durable effect before retrying it.
-- hygiene-approved-destructive: Applying this migration deletes no data. It defines
-- the existing explicit attachment-removal command as a service-role-only RPC;
-- deletion requires the fenced receipt and exact document ID, lead, type, and
-- planned storage path. No lead, activity, or historical CRM record is removed.
ALTER TABLE public.mobile_command_receipts
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS effect_plan jsonb;

CREATE OR REPLACE FUNCTION public.claim_mobile_command_v2(
  p_actor_email text, p_idempotency_key text, p_command text,
  p_lead_id uuid, p_payload_hash text, p_lease_token uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.mobile_command_receipts%ROWTYPE;
BEGIN
  IF p_lease_token IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 200
    OR length(p_payload_hash) <> 64 OR nullif(btrim(p_actor_email), '') IS NULL
    OR nullif(btrim(p_command), '') IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'mobile_command_invalid_claim';
  END IF;
  INSERT INTO public.mobile_command_receipts (
    actor_email,idempotency_key,command,lead_id,payload_hash,state,lease_token,lease_expires_at
  ) VALUES (
    lower(btrim(p_actor_email)),p_idempotency_key,p_command,p_lead_id,p_payload_hash,
    'pending',p_lease_token,clock_timestamp() + interval '2 minutes'
  ) ON CONFLICT (actor_email,idempotency_key) DO NOTHING;
  SELECT * INTO r FROM public.mobile_command_receipts
    WHERE actor_email = lower(btrim(p_actor_email)) AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF r.command IS DISTINCT FROM p_command OR r.lead_id IS DISTINCT FROM p_lead_id
    OR r.payload_hash IS DISTINCT FROM p_payload_hash THEN
    RETURN jsonb_build_object('kind','conflict');
  END IF;
  IF r.state = 'completed' THEN
    RETURN jsonb_build_object('kind','replay','status',r.http_status,'result',r.result);
  END IF;
  IF r.lease_token = p_lease_token THEN
    RETURN jsonb_build_object('kind','reserved','token',p_lease_token,'plan',r.effect_plan);
  END IF;
  IF r.lease_expires_at IS NOT NULL AND r.lease_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('kind','pending');
  END IF;
  UPDATE public.mobile_command_receipts SET lease_token = p_lease_token,
    lease_expires_at = clock_timestamp() + interval '2 minutes', updated_at = clock_timestamp()
    WHERE actor_email = r.actor_email AND idempotency_key = r.idempotency_key;
  RETURN jsonb_build_object('kind','recovered','token',p_lease_token,'plan',r.effect_plan);
END $$;

CREATE OR REPLACE FUNCTION public.finish_mobile_command_v2(
  p_actor_email text, p_idempotency_key text, p_lease_token uuid,
  p_http_status integer, p_result jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.mobile_command_receipts SET state = 'completed', http_status = p_http_status,
    result = p_result, lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
    WHERE actor_email = lower(btrim(p_actor_email)) AND idempotency_key = p_idempotency_key
      AND state = 'pending' AND lease_token = p_lease_token;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.plan_mobile_command_effect_v1(
  p_actor_email text, p_idempotency_key text, p_lease_token uuid, p_plan jsonb
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.mobile_command_receipts%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.mobile_command_receipts WHERE actor_email = lower(btrim(p_actor_email))
    AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF NOT FOUND OR r.state <> 'pending' OR r.lease_token IS DISTINCT FROM p_lease_token THEN RETURN false; END IF;
  IF r.effect_plan IS NOT NULL AND r.effect_plan IS DISTINCT FROM p_plan THEN RETURN false; END IF;
  UPDATE public.mobile_command_receipts SET effect_plan = p_plan, updated_at = clock_timestamp()
    WHERE actor_email = r.actor_email AND idempotency_key = r.idempotency_key;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.claim_mobile_command_v2(text,text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_mobile_command_v2(text,text,uuid,integer,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plan_mobile_command_effect_v1(text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mobile_command_v2(text,text,text,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_mobile_command_v2(text,text,uuid,integer,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_mobile_command_effect_v1(text,text,uuid,jsonb) TO service_role;

-- Property CAS, audit, and receipt are one transaction. A crash cannot leave
-- changed facts behind an ambiguous pending receipt.
CREATE OR REPLACE FUNCTION public.apply_mobile_property_command_v1(
  p_actor_email text, p_actor_name text, p_idempotency_key text, p_lease_token uuid,
  p_property_id uuid, p_expected_updated_at timestamptz, p_patch jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.mobile_command_receipts%ROWTYPE;
  property_row public.crm_properties%ROWTYPE;
  result_value jsonb;
BEGIN
  SELECT * INTO r FROM public.mobile_command_receipts WHERE actor_email = lower(btrim(p_actor_email))
    AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF NOT FOUND OR r.command <> 'update_property_details' OR r.state <> 'pending'
    OR r.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'mobile_property_lease_conflict';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_lead_entity_links
    WHERE lead_id = r.lead_id AND property_id = p_property_id) THEN
    RAISE EXCEPTION 'mobile_property_link_conflict';
  END IF;
  UPDATE public.crm_properties SET
    bedrooms = (p_patch->>'bedrooms')::numeric,
    bathrooms = (p_patch->>'bathrooms')::numeric,
    sqft = (p_patch->>'sqft')::integer,
    year_built = (p_patch->>'yearBuilt')::integer,
    occupancy_status = p_patch->>'occupancyStatus',
    updated_at = clock_timestamp()
  WHERE id = p_property_id AND updated_at = p_expected_updated_at
  RETURNING * INTO property_row;
  IF NOT FOUND THEN
    result_value := jsonb_build_object('error','Property facts changed on another device. Refresh before saving again.');
    UPDATE public.mobile_command_receipts SET state = 'completed', http_status = 409,
      result = result_value, lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
    WHERE actor_email = r.actor_email AND idempotency_key = r.idempotency_key;
    RETURN jsonb_build_object('status',409,'result',result_value);
  END IF;
  INSERT INTO public.lead_activities (lead_id,activity_type,description,agent,metadata)
  VALUES (r.lead_id,'property_update','Updated property facts',p_actor_name,
    jsonb_build_object('source','mobile_app','actor_email',r.actor_email,
      'property_id',property_row.id,'idempotency_key',r.idempotency_key,
      'fields',jsonb_build_array('bedrooms','bathrooms','sqft','year_built','occupancy_status')));
  result_value := jsonb_build_object('success',true,'property',jsonb_build_object(
    'id',property_row.id,'bedrooms',property_row.bedrooms,'bathrooms',property_row.bathrooms,
    'sqft',property_row.sqft,'yearBuilt',property_row.year_built,
    'occupancyStatus',property_row.occupancy_status,'updatedAt',property_row.updated_at));
  UPDATE public.mobile_command_receipts SET state = 'completed', http_status = 200,
    result = result_value, lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
  WHERE actor_email = r.actor_email AND idempotency_key = r.idempotency_key;
  RETURN jsonb_build_object('status',200,'result',result_value);
END $$;

-- Queue revision and receipt are atomic, preserving the existing canonical
-- queue's increment and scheduling behavior.
CREATE OR REPLACE FUNCTION public.apply_mobile_briefing_refresh_v1(
  p_actor_email text, p_idempotency_key text, p_lease_token uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.mobile_command_receipts%ROWTYPE;
  revision_value bigint; result_value jsonb;
BEGIN
  SELECT * INTO r FROM public.mobile_command_receipts WHERE actor_email = lower(btrim(p_actor_email))
    AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF NOT FOUND OR r.command <> 'refresh_lead_briefing' OR r.state <> 'pending'
    OR r.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'mobile_briefing_lease_conflict';
  END IF;
  revision_value := public.queue_crm_briefing_v1(r.lead_id,'mobile_manual_refresh',r.actor_email,0);
  result_value := jsonb_build_object('queued',true,'leadId',r.lead_id,
    'revision',revision_value,'status','pending');
  UPDATE public.mobile_command_receipts SET state = 'completed', http_status = 202,
    result = result_value, lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
  WHERE actor_email = r.actor_email AND idempotency_key = r.idempotency_key;
  RETURN result_value;
END $$;

REVOKE ALL ON FUNCTION public.apply_mobile_property_command_v1(text,text,text,uuid,uuid,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_mobile_briefing_refresh_v1(text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_mobile_property_command_v1(text,text,text,uuid,uuid,timestamptz,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_mobile_briefing_refresh_v1(text,text,uuid) TO service_role;

-- Storage is removed before this transaction. The planned exact path permits
-- a reclaimed caller to finish cleanup without guessing which file to touch.
CREATE OR REPLACE FUNCTION public.finish_mobile_attachment_removal_v1(
  p_actor_email text, p_idempotency_key text, p_lease_token uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.mobile_command_receipts%ROWTYPE;
  attachment_id uuid; planned_path text; did_remove boolean := false; result_value jsonb;
BEGIN
  SELECT * INTO r FROM public.mobile_command_receipts WHERE actor_email = lower(btrim(p_actor_email))
    AND idempotency_key = p_idempotency_key FOR UPDATE;
  IF NOT FOUND OR r.command <> 'remove_message_attachment' OR r.state <> 'pending'
    OR r.lease_token IS DISTINCT FROM p_lease_token OR r.effect_plan IS NULL THEN
    RAISE EXCEPTION 'mobile_attachment_removal_lease_conflict';
  END IF;
  attachment_id := (r.effect_plan->>'attachmentId')::uuid;
  planned_path := r.effect_plan->>'storagePath';
  IF planned_path IS NOT NULL THEN
    DELETE FROM public.documents WHERE id = attachment_id AND entity_type = 'lead'
      AND entity_id = r.lead_id AND doc_type = 'message_attachment'
      AND storage_path = planned_path;
    did_remove := FOUND;
  END IF;
  result_value := jsonb_build_object('success',true,'attachmentId',attachment_id,'removed',did_remove);
  UPDATE public.mobile_command_receipts SET state = 'completed', http_status = 200,
    result = result_value, lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
  WHERE actor_email = r.actor_email AND idempotency_key = r.idempotency_key;
  RETURN result_value;
END $$;

REVOKE ALL ON FUNCTION public.finish_mobile_attachment_removal_v1(text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_mobile_attachment_removal_v1(text,text,uuid) TO service_role;
