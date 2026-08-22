-- Carrier delivery receipts for internal LaunchControl-style SMS campaigns.
-- Additive, service-only, and idempotent. Twilio webhook signatures are
-- validated by the route before this function is called.

CREATE UNIQUE INDEX IF NOT EXISTS idx_prospecting_campaign_actions_provider_sid
  ON public.prospecting_campaign_actions (provider_sid)
  WHERE provider_sid IS NOT NULL;

CREATE OR REPLACE FUNCTION public.apply_prospecting_sms_delivery_v1(
  p_action_id uuid,
  p_message_sid text,
  p_message_status text,
  p_error_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  action_row public.prospecting_campaign_actions;
  clean_status text := lower(trim(coalesce(p_message_status, '')));
  clean_sid text := trim(coalesce(p_message_sid, ''));
  final_error text := nullif(trim(coalesce(p_error_code, '')), '');
  changed boolean := false;
BEGIN
  IF clean_status NOT IN ('accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'undelivered') THEN
    RAISE EXCEPTION 'invalid_prospecting_delivery_status';
  END IF;
  IF clean_sid !~ '^SM[0-9A-Za-z]{32}$' THEN RAISE EXCEPTION 'invalid_prospecting_message_sid'; END IF;

  SELECT * INTO action_row
  FROM public.prospecting_campaign_actions
  WHERE id = p_action_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_action_not_found'; END IF;
  IF action_row.provider_sid IS NULL OR action_row.status = 'processing' THEN
    RAISE EXCEPTION 'campaign_delivery_not_ready';
  END IF;
  IF action_row.provider_sid <> clean_sid THEN RAISE EXCEPTION 'campaign_delivery_sid_mismatch'; END IF;

  UPDATE public.sms_delivery_log
    SET twilio_status = clean_status,
        twilio_error_code = CASE WHEN final_error ~ '^[0-9]+$' THEN final_error::integer ELSE twilio_error_code END
    WHERE twilio_sid = clean_sid;

  IF clean_status IN ('delivered', 'read') AND action_row.status = 'sent' THEN
    UPDATE public.prospecting_campaign_actions
      SET status = 'delivered', error_code = NULL, completed_at = now()
      WHERE id = action_row.id;
    changed := true;
    INSERT INTO public.prospecting_campaign_events (campaign_id, member_id, action_id, event_type, actor, metadata)
    VALUES (action_row.campaign_id, action_row.member_id, action_row.id, 'campaign_action_delivered', 'Twilio carrier receipt',
      jsonb_build_object('provider_sid', clean_sid, 'message_status', clean_status));
  ELSIF clean_status IN ('failed', 'undelivered') AND action_row.status = 'sent' THEN
    final_error := 'carrier_' || coalesce(final_error, clean_status);
    UPDATE public.prospecting_campaign_actions
      SET status = 'failed', error_code = final_error, completed_at = now()
      WHERE id = action_row.id;
    UPDATE public.prospecting_campaign_members
      SET status = 'suppressed', suppression_reason = final_error,
          next_action_at = NULL, completed_at = coalesce(completed_at, now())
      WHERE id = action_row.member_id AND status IN ('active', 'completed');
    UPDATE public.prospecting_campaign_actions
      SET status = 'cancelled', error_code = 'carrier_delivery_failed', completed_at = now()
      WHERE member_id = action_row.member_id AND status = 'queued';
    changed := true;
    INSERT INTO public.prospecting_campaign_events (campaign_id, member_id, action_id, event_type, actor, metadata)
    VALUES (action_row.campaign_id, action_row.member_id, action_row.id, 'campaign_action_failed', 'Twilio carrier receipt',
      jsonb_build_object('provider_sid', clean_sid, 'message_status', clean_status, 'error_code', final_error));
  END IF;

  RETURN jsonb_build_object(
    'actionId', action_row.id,
    'status', CASE
      WHEN changed AND clean_status IN ('delivered', 'read') THEN 'delivered'
      WHEN changed THEN 'failed'
      ELSE action_row.status
    END,
    'changed', changed
  );
END
$$;

REVOKE ALL ON FUNCTION public.apply_prospecting_sms_delivery_v1(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_prospecting_sms_delivery_v1(uuid, text, text, text)
  TO service_role;
