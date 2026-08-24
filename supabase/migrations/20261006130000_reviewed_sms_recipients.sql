-- Reviewed, single-recipient SMS execution for Lead and source-Prospect
-- campaign subjects. Selection is inert until the campaign is activated.
--
-- hygiene-approved-destructive: this migration replaces only function/index
-- definitions and cancels unsent queued work for draft or paused campaigns so
-- an unreviewed phone can never be contacted. It never deletes source records,
-- campaign history, activities, or delivered-message evidence.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

DROP INDEX IF EXISTS public.idx_prospecting_campaign_member_contacts_sms;
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospecting_campaign_member_contacts_sms
  ON public.prospecting_campaign_member_contacts (member_id)
  WHERE status = 'ready' AND selected_for_sms = true;

-- Existing draft/paused SMS audiences must pass through the reviewed-recipient
-- control. Production rollout preflight separately requires zero active SMS
-- campaigns so no in-flight campaign is silently altered.
UPDATE public.prospecting_campaign_members member
SET status = CASE WHEN EXISTS (
      SELECT 1 FROM public.prospecting_campaign_member_contacts contact
      WHERE contact.member_id = member.id AND contact.status = 'ready'
    ) THEN 'needs_review' ELSE 'suppressed' END,
    suppression_reason = CASE WHEN EXISTS (
      SELECT 1 FROM public.prospecting_campaign_member_contacts contact
      WHERE contact.member_id = member.id AND contact.status = 'ready'
    ) THEN NULL ELSE 'all_phone_targets_blocked' END,
    next_action_at = NULL,
    updated_at = now()
FROM public.prospecting_campaigns campaign
WHERE campaign.id = member.campaign_id
  AND campaign.kind = 'sms'
  AND campaign.status IN ('draft', 'paused')
  AND member.status NOT IN ('removed', 'replied', 'suppressed');

UPDATE public.prospecting_campaign_member_contacts contact
SET selected_for_sms = false, updated_at = now()
FROM public.prospecting_campaign_members member
JOIN public.prospecting_campaigns campaign ON campaign.id = member.campaign_id
WHERE contact.member_id = member.id
  AND campaign.kind = 'sms'
  AND campaign.status IN ('draft', 'paused');

UPDATE public.prospecting_campaign_actions action
SET status = 'cancelled', completed_at = now(), error_code = 'recipient_review_required',
    worker_token = NULL, lease_expires_at = NULL, updated_at = now()
FROM public.prospecting_campaigns campaign
WHERE campaign.id = action.campaign_id
  AND campaign.kind = 'sms'
  AND campaign.status IN ('draft', 'paused')
  AND action.status IN ('queued', 'processing');

UPDATE public.prospecting_sms_reservations reservation
SET status = 'released', updated_at = now()
FROM public.prospecting_campaign_actions action
WHERE action.id = reservation.action_id
  AND action.error_code = 'recipient_review_required'
  AND reservation.status = 'reserved';

CREATE OR REPLACE FUNCTION public.review_prospecting_campaign_sms_recipient_v1(
  p_actor_email text,
  p_actor_name text,
  p_campaign_id uuid,
  p_member_id uuid,
  p_contact_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  campaign_row public.prospecting_campaigns;
  member_row public.prospecting_campaign_members;
  contact_row public.prospecting_campaign_member_contacts;
BEGIN
  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id AND lower(owner_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.kind <> 'sms' THEN RAISE EXCEPTION 'recipient_review_not_sms'; END IF;
  IF campaign_row.status NOT IN ('draft', 'paused') THEN RAISE EXCEPTION 'campaign_members_locked'; END IF;

  SELECT * INTO member_row
  FROM public.prospecting_campaign_members
  WHERE id = p_member_id AND campaign_id = p_campaign_id
  FOR UPDATE;
  IF NOT FOUND OR member_row.status IN ('removed', 'replied') THEN RAISE EXCEPTION 'campaign_member_not_found'; END IF;

  SELECT * INTO contact_row
  FROM public.prospecting_campaign_member_contacts
  WHERE id = p_contact_id AND member_id = p_member_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_contact_not_found'; END IF;
  IF contact_row.status <> 'ready' OR nullif(contact_row.contact_key, '') IS NULL THEN
    RAISE EXCEPTION 'campaign_contact_not_eligible';
  END IF;

  UPDATE public.prospecting_campaign_member_contacts
  SET selected_for_sms = (id = p_contact_id), updated_at = now()
  WHERE member_id = p_member_id;

  UPDATE public.prospecting_campaign_members
  SET phone_snapshot = contact_row.phone_snapshot,
      status = 'active', suppression_reason = NULL, next_action_at = NULL,
      completed_at = NULL, updated_at = now()
  WHERE id = p_member_id;

  UPDATE public.prospecting_campaign_actions
  SET status = 'cancelled', completed_at = now(), error_code = 'recipient_changed',
      worker_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE member_id = p_member_id AND status IN ('queued', 'processing');

  UPDATE public.prospecting_sms_reservations reservation
  SET status = 'released', updated_at = now()
  FROM public.prospecting_campaign_actions action
  WHERE action.id = reservation.action_id
    AND action.member_id = p_member_id
    AND action.error_code = 'recipient_changed'
    AND reservation.status = 'reserved';

  INSERT INTO public.prospecting_campaign_events (campaign_id, member_id, event_type, actor, metadata)
  VALUES (
    p_campaign_id, p_member_id, 'campaign_sms_recipient_reviewed',
    coalesce(nullif(trim(p_actor_name), ''), trim(p_actor_email)),
    jsonb_build_object(
      'contact_id', contact_row.id,
      'prospect_id', contact_row.prospect_id,
      'prospect_phone_id', contact_row.prospect_phone_id,
      'phone_key', contact_row.contact_key,
      'source_kind', contact_row.source_kind
    )
  );

  RETURN jsonb_build_object(
    'memberId', p_member_id,
    'contactId', contact_row.id,
    'status', 'active',
    'phone', contact_row.phone_snapshot
  );
END
$$;

REVOKE ALL ON FUNCTION public.review_prospecting_campaign_sms_recipient_v1(text, text, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_prospecting_campaign_sms_recipient_v1(text, text, uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.activate_prospecting_campaign_v1(
  p_campaign_id uuid,
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
  active_members integer;
BEGIN
  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id AND lower(owner_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.status NOT IN ('draft', 'paused') THEN RAISE EXCEPTION 'invalid_campaign_transition'; END IF;

  SELECT count(*) INTO active_members
  FROM public.prospecting_campaign_members member
  WHERE member.campaign_id = p_campaign_id
    AND member.status = 'active'
    AND (
      campaign_row.kind = 'dialer'
      OR EXISTS (
        SELECT 1 FROM public.prospecting_campaign_member_contacts contact
        WHERE contact.member_id = member.id
          AND contact.status = 'ready'
          AND contact.selected_for_sms = true
          AND public.prospecting_phone_key_v1(contact.phone_snapshot) = public.prospecting_phone_key_v1(member.phone_snapshot)
      )
    );
  IF active_members < 1 THEN RAISE EXCEPTION 'campaign_has_no_eligible_members'; END IF;

  IF campaign_row.kind = 'sms' THEN
    IF NOT EXISTS (SELECT 1 FROM public.prospecting_campaign_steps WHERE campaign_id = p_campaign_id) THEN
      RAISE EXCEPTION 'campaign_has_no_steps';
    END IF;

    INSERT INTO public.prospecting_campaign_actions (
      campaign_id, member_id, step_id, lead_id, prospect_id, prospect_phone_id, scheduled_at
    )
    SELECT
      member.campaign_id, member.id, step.id, member.lead_id, member.prospect_id,
      contact.prospect_phone_id, now() + make_interval(mins => step.delay_minutes)
    FROM public.prospecting_campaign_members member
    JOIN public.prospecting_campaign_member_contacts contact
      ON contact.member_id = member.id AND contact.status = 'ready' AND contact.selected_for_sms = true
    JOIN LATERAL (
      SELECT candidate.*
      FROM public.prospecting_campaign_steps candidate
      WHERE candidate.campaign_id = member.campaign_id
        AND candidate.position > member.current_step_position
      ORDER BY candidate.position
      LIMIT 1
    ) step ON true
    WHERE member.campaign_id = p_campaign_id AND member.status = 'active'
    ON CONFLICT (member_id, step_id) DO UPDATE SET
      lead_id = EXCLUDED.lead_id,
      prospect_id = EXCLUDED.prospect_id,
      prospect_phone_id = EXCLUDED.prospect_phone_id,
      status = 'queued',
      scheduled_at = EXCLUDED.scheduled_at,
      worker_token = NULL,
      lease_expires_at = NULL,
      rendered_body = NULL,
      provider_sid = NULL,
      error_code = NULL,
      sent_at = NULL,
      completed_at = NULL,
      updated_at = now()
    WHERE prospecting_campaign_actions.status IN ('cancelled', 'blocked', 'failed')
      AND prospecting_campaign_actions.provider_sid IS NULL;

    UPDATE public.prospecting_campaign_members member
    SET next_action_at = action.scheduled_at, updated_at = now()
    FROM public.prospecting_campaign_actions action
    WHERE member.id = action.member_id
      AND member.campaign_id = p_campaign_id
      AND member.status = 'active'
      AND action.status = 'queued';
  END IF;

  UPDATE public.prospecting_campaigns
  SET status = 'active', activated_at = coalesce(activated_at, now()), paused_at = NULL
  WHERE id = p_campaign_id
  RETURNING * INTO campaign_row;

  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (
    p_campaign_id, 'campaign_activated',
    coalesce(nullif(trim(p_actor_name), ''), trim(p_actor_email)),
    jsonb_build_object('eligible_members', active_members)
  );

  RETURN jsonb_build_object('id', campaign_row.id, 'status', campaign_row.status, 'eligibleMembers', active_members);
END
$$;

REVOKE ALL ON FUNCTION public.activate_prospecting_campaign_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_prospecting_campaign_v1(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_prospecting_campaign_action_v1(
  p_worker_token uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  action_row public.prospecting_campaign_actions;
  result jsonb;
BEGIN
  IF p_worker_token IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 600 THEN
    RAISE EXCEPTION 'invalid_worker_claim';
  END IF;

  SELECT action.* INTO action_row
  FROM public.prospecting_campaign_actions action
  JOIN public.prospecting_campaigns campaign ON campaign.id = action.campaign_id
  JOIN public.prospecting_campaign_members member ON member.id = action.member_id
  WHERE campaign.status = 'active'
    AND campaign.kind = 'sms'
    AND member.status = 'active'
    AND action.scheduled_at <= now()
    AND (action.status = 'queued' OR (action.status = 'processing' AND action.lease_expires_at < now()))
    AND EXISTS (
      SELECT 1 FROM public.prospecting_campaign_member_contacts contact
      WHERE contact.member_id = member.id
        AND contact.status = 'ready'
        AND contact.selected_for_sms = true
        AND public.prospecting_phone_key_v1(contact.phone_snapshot) = public.prospecting_phone_key_v1(member.phone_snapshot)
    )
  ORDER BY action.scheduled_at, action.id
  LIMIT 1
  FOR UPDATE OF action SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.prospecting_campaign_actions
  SET status = 'processing', worker_token = p_worker_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1
  WHERE id = action_row.id
  RETURNING * INTO action_row;

  SELECT jsonb_build_object(
    'id', action_row.id,
    'campaignId', action_row.campaign_id,
    'memberId', action_row.member_id,
    'stepId', action_row.step_id,
    'subjectKind', member.subject_kind,
    'leadId', action_row.lead_id,
    'prospectId', action_row.prospect_id,
    'prospectPhoneId', action_row.prospect_phone_id,
    'attemptCount', action_row.attempt_count,
    'phone', member.phone_snapshot,
    'timezone', member.timezone,
    'bodyTemplate', step.body_template,
    'fromPhone', campaign.from_phone,
    'sendWindowStart', campaign.send_window_start,
    'sendWindowEnd', campaign.send_window_end,
    'sendDays', campaign.send_days,
    'perHour', campaign.per_hour,
    'perDay', campaign.per_day,
    'ownerName', campaign.owner_name
  ) INTO result
  FROM public.prospecting_campaign_members member
  JOIN public.prospecting_campaign_steps step ON step.id = action_row.step_id
  JOIN public.prospecting_campaigns campaign ON campaign.id = action_row.campaign_id
  WHERE member.id = action_row.member_id;

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.claim_prospecting_campaign_action_v1(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_prospecting_campaign_action_v1(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_prospecting_campaign_action_v1(
  p_action_id uuid,
  p_worker_token uuid,
  p_result text,
  p_rendered_body text DEFAULT NULL,
  p_provider_sid text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_retry_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  action_row public.prospecting_campaign_actions;
  step_row public.prospecting_campaign_steps;
  next_step public.prospecting_campaign_steps;
  final_status text;
BEGIN
  IF p_result NOT IN ('sent', 'blocked', 'failed', 'deferred') THEN RAISE EXCEPTION 'invalid_campaign_action_result'; END IF;

  SELECT * INTO action_row
  FROM public.prospecting_campaign_actions
  WHERE id = p_action_id AND status = 'processing' AND worker_token = p_worker_token
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_action_claim_lost'; END IF;
  SELECT * INTO step_row FROM public.prospecting_campaign_steps WHERE id = action_row.step_id;

  IF p_result = 'deferred' THEN
    UPDATE public.prospecting_campaign_actions
    SET status = 'queued', scheduled_at = coalesce(p_retry_at, now() + interval '15 minutes'),
        worker_token = NULL, lease_expires_at = NULL, error_code = p_error_code
    WHERE id = action_row.id;
    UPDATE public.prospecting_sms_reservations SET status = 'released'
    WHERE action_id = action_row.id AND status = 'reserved';
    RETURN jsonb_build_object('status', 'queued');
  END IF;

  IF p_result = 'failed' AND action_row.attempt_count < 3 THEN
    UPDATE public.prospecting_campaign_actions
    SET status = 'queued', scheduled_at = coalesce(p_retry_at, now() + make_interval(mins => 5 * action_row.attempt_count)),
        worker_token = NULL, lease_expires_at = NULL, error_code = p_error_code
    WHERE id = action_row.id;
    UPDATE public.prospecting_sms_reservations SET status = 'released'
    WHERE action_id = action_row.id AND status = 'reserved';
    RETURN jsonb_build_object('status', 'queued', 'retrying', true);
  END IF;

  final_status := CASE p_result WHEN 'sent' THEN 'sent' WHEN 'blocked' THEN 'blocked' ELSE 'failed' END;
  UPDATE public.prospecting_campaign_actions
  SET status = final_status, rendered_body = nullif(p_rendered_body, ''), provider_sid = nullif(p_provider_sid, ''),
      error_code = nullif(p_error_code, ''), sent_at = CASE WHEN p_result = 'sent' THEN now() ELSE sent_at END,
      completed_at = now(), worker_token = NULL, lease_expires_at = NULL
  WHERE id = action_row.id;
  UPDATE public.prospecting_sms_reservations
  SET status = CASE WHEN p_result = 'sent' THEN 'consumed' ELSE 'released' END
  WHERE action_id = action_row.id AND status = 'reserved';

  IF p_result = 'blocked' THEN
    UPDATE public.prospecting_campaign_members
    SET status = 'suppressed', suppression_reason = coalesce(nullif(p_error_code, ''), 'contact_policy'), next_action_at = NULL
    WHERE id = action_row.member_id;
    UPDATE public.prospecting_campaign_actions
    SET status = 'cancelled', completed_at = now(), error_code = 'member_suppressed'
    WHERE member_id = action_row.member_id AND status = 'queued';
  ELSIF p_result = 'sent' THEN
    SELECT * INTO next_step
    FROM public.prospecting_campaign_steps
    WHERE campaign_id = action_row.campaign_id AND position > step_row.position
    ORDER BY position
    LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.prospecting_campaign_actions (
        campaign_id, member_id, step_id, lead_id, prospect_id, prospect_phone_id, scheduled_at
      ) VALUES (
        action_row.campaign_id, action_row.member_id, next_step.id,
        action_row.lead_id, action_row.prospect_id, action_row.prospect_phone_id,
        now() + make_interval(mins => next_step.delay_minutes)
      )
      ON CONFLICT (member_id, step_id) DO NOTHING;
      UPDATE public.prospecting_campaign_members
      SET current_step_position = step_row.position,
          next_action_at = now() + make_interval(mins => next_step.delay_minutes)
      WHERE id = action_row.member_id AND status = 'active';
    ELSE
      UPDATE public.prospecting_campaign_members
      SET status = 'completed', current_step_position = step_row.position,
          next_action_at = NULL, completed_at = now()
      WHERE id = action_row.member_id AND status = 'active';
    END IF;
  END IF;

  INSERT INTO public.prospecting_campaign_events (campaign_id, member_id, action_id, event_type, actor, metadata)
  VALUES (
    action_row.campaign_id, action_row.member_id, action_row.id,
    'campaign_action_' || final_status, 'Prospecting worker',
    jsonb_build_object('error_code', p_error_code, 'provider_sid', p_provider_sid)
  );
  RETURN jsonb_build_object('status', final_status);
END
$$;

REVOKE ALL ON FUNCTION public.finish_prospecting_campaign_action_v1(uuid, uuid, text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_prospecting_campaign_action_v1(uuid, uuid, text, text, text, text, timestamptz)
  TO service_role;

COMMENT ON COLUMN public.prospecting_campaign_member_contacts.selected_for_sms IS
  'Exact human-reviewed recipient for an SMS campaign member. At most one ready contact may be selected.';
