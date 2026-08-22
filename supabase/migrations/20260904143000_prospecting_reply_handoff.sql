-- Make seller replies and opt-outs authoritative campaign outcomes even after
-- the last scheduled touch, and preserve a bounded operator-facing audit.

CREATE OR REPLACE FUNCTION public.stop_prospecting_members_on_reply_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  direction_value text := lower(coalesce(NEW.metadata ->> 'direction', ''));
  stopped record;
BEGIN
  IF NEW.lead_id IS NULL
    OR direction_value NOT IN ('inbound', 'incoming', 'received')
    OR lower(coalesce(NEW.metadata ->> 'is_team', 'false')) IN ('true', '1', 'yes')
    OR lower(coalesce(NEW.metadata ->> 'is_internal', 'false')) IN ('true', '1', 'yes')
  THEN
    RETURN NEW;
  END IF;

  FOR stopped IN
    UPDATE public.prospecting_campaign_members member
      SET status = 'replied',
          suppression_reason = NULL,
          next_action_at = NULL,
          completed_at = coalesce(member.completed_at, now()),
          updated_at = now()
    FROM public.prospecting_campaigns campaign
    WHERE member.campaign_id = campaign.id
      AND member.lead_id = NEW.lead_id
      AND member.status IN ('active', 'completed')
      AND campaign.kind = 'sms'
      AND campaign.status IN ('active', 'paused', 'completed')
    RETURNING member.id, member.campaign_id
  LOOP
    UPDATE public.prospecting_campaign_actions
      SET status = 'cancelled', completed_at = now(), error_code = 'contact_replied'
      WHERE member_id = stopped.id AND status IN ('queued', 'processing');

    INSERT INTO public.prospecting_campaign_events (
      campaign_id, member_id, event_type, actor, metadata
    ) VALUES (
      stopped.campaign_id,
      stopped.id,
      'campaign_member_replied',
      'Seller reply',
      jsonb_strip_nulls(jsonb_build_object(
        'lead_activity_id', NEW.id,
        'message', nullif(left(coalesce(NEW.description, ''), 1400), ''),
        'from_phone', nullif(NEW.metadata ->> 'from', '')
      ))
    );
  END LOOP;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.stop_prospecting_members_on_reply_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stop_prospecting_members_on_reply_v1()
  TO service_role;

CREATE OR REPLACE FUNCTION public.suppress_prospecting_members_on_opt_out_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  stopped record;
  stop_reason text := coalesce(nullif(NEW.reason, ''), 'sms_opt_out');
BEGIN
  IF NEW.is_opted_out IS DISTINCT FROM true THEN RETURN NEW; END IF;

  FOR stopped IN
    UPDATE public.prospecting_campaign_members member
      SET status = 'suppressed',
          suppression_reason = stop_reason,
          next_action_at = NULL,
          completed_at = coalesce(member.completed_at, now()),
          updated_at = now()
    FROM public.prospecting_campaigns campaign
    WHERE member.campaign_id = campaign.id
      AND campaign.kind = 'sms'
      AND campaign.status IN ('active', 'paused', 'completed')
      AND member.status IN ('active', 'completed', 'replied')
      AND public.prospecting_phone_key_v1(member.phone_snapshot) = public.prospecting_phone_key_v1(NEW.phone)
    RETURNING member.id, member.campaign_id
  LOOP
    UPDATE public.prospecting_campaign_actions
      SET status = 'cancelled', completed_at = now(), error_code = 'sms_opt_out'
      WHERE member_id = stopped.id AND status IN ('queued', 'processing');

    INSERT INTO public.prospecting_campaign_events (
      campaign_id, member_id, event_type, actor, metadata
    ) VALUES (
      stopped.campaign_id,
      stopped.id,
      'campaign_member_suppressed',
      'SMS consent',
      jsonb_build_object('reason', stop_reason, 'phone', NEW.phone)
    );
  END LOOP;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.suppress_prospecting_members_on_opt_out_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suppress_prospecting_members_on_opt_out_v1()
  TO service_role;
