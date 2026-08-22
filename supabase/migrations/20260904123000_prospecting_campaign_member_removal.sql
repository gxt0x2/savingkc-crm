-- Remove an incorrectly enrolled seller without deleting campaign history.
-- Membership changes stay owner-scoped and are locked while a campaign is live.

CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_members_current_audience
  ON public.prospecting_campaign_members (campaign_id, enrolled_at DESC, id DESC)
  WHERE status <> 'removed';

CREATE OR REPLACE FUNCTION public.remove_prospecting_campaign_member_v1(
  p_campaign_id uuid,
  p_member_id uuid,
  p_actor_email text,
  p_actor_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  campaign_row public.prospecting_campaigns;
  member_row public.prospecting_campaign_members;
  cancelled_actions integer := 0;
BEGIN
  IF p_campaign_id IS NULL OR p_member_id IS NULL OR coalesce(trim(p_actor_email), '') = '' THEN
    RAISE EXCEPTION 'invalid_campaign_member_removal';
  END IF;

  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id
    AND lower(owner_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.status NOT IN ('draft', 'paused') THEN RAISE EXCEPTION 'campaign_members_locked'; END IF;

  SELECT * INTO member_row
  FROM public.prospecting_campaign_members
  WHERE id = p_member_id AND campaign_id = p_campaign_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_member_not_found'; END IF;

  IF member_row.status = 'removed' THEN
    RETURN jsonb_build_object('id', member_row.id, 'status', 'removed', 'removed', false, 'cancelledActions', 0);
  END IF;

  UPDATE public.prospecting_sms_reservations reservation
    SET status = 'released', updated_at = now()
  FROM public.prospecting_campaign_actions action
  WHERE reservation.action_id = action.id
    AND reservation.status = 'reserved'
    AND action.campaign_id = p_campaign_id
    AND action.member_id = p_member_id
    AND action.status IN ('queued', 'processing');

  WITH cancelled AS (
    UPDATE public.prospecting_campaign_actions
      SET status = 'cancelled', completed_at = now(), error_code = 'member_removed',
          worker_token = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE campaign_id = p_campaign_id
        AND member_id = p_member_id
        AND status IN ('queued', 'processing')
      RETURNING id
  )
  SELECT count(*) INTO cancelled_actions FROM cancelled;

  UPDATE public.prospecting_campaign_members
    SET status = 'removed', suppression_reason = NULL, next_action_at = NULL,
        completed_at = coalesce(completed_at, now()), updated_at = now()
    WHERE id = p_member_id;

  UPDATE public.prospecting_campaigns
    SET updated_at = now()
    WHERE id = p_campaign_id;

  INSERT INTO public.prospecting_campaign_events (campaign_id, member_id, event_type, actor, metadata)
  VALUES (
    p_campaign_id,
    p_member_id,
    'member_removed',
    coalesce(nullif(trim(p_actor_name), ''), trim(p_actor_email)),
    jsonb_build_object(
      'lead_id', member_row.lead_id,
      'previous_status', member_row.status,
      'cancelled_actions', cancelled_actions
    )
  );

  RETURN jsonb_build_object(
    'id', p_member_id,
    'status', 'removed',
    'removed', true,
    'cancelledActions', cancelled_actions
  );
END
$$;

REVOKE ALL ON FUNCTION public.remove_prospecting_campaign_member_v1(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_prospecting_campaign_member_v1(uuid, uuid, text, text) TO service_role;
