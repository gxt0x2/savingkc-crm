-- Safely restart a partially worked dialer campaign, then reset the two Tax 3+
-- lists requested by operations. Prior sessions, attempts, outcomes, DNCs, and
-- suppressions remain intact; only members with a currently callable contact
-- are placed back in enrollment order.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.rerun_prospecting_dialer_campaign_v2(
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
  actor_key text := lower(trim(coalesce(p_actor_email, '')));
  campaign_row public.prospecting_campaigns;
  ready_members integer := 0;
  reopened_members integer := 0;
  next_run_number integer;
BEGIN
  IF actor_key = '' OR coalesce(trim(p_actor_name), '') = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('prospecting-campaign:' || p_campaign_id::text, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dialer-actor:' || actor_key, 0)
  );

  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id AND lower(owner_email) = actor_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.kind <> 'dialer' THEN RAISE EXCEPTION 'invalid_campaign_kind'; END IF;
  IF campaign_row.status NOT IN ('active', 'completed') THEN RAISE EXCEPTION 'campaign_not_restartable'; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dialer_sessions session
    WHERE session.status IN ('active', 'paused')
      AND (
        lower(session.actor_email) = actor_key
        OR session.prospecting_campaign_id = p_campaign_id
      )
  ) THEN RAISE EXCEPTION 'another_dialer_session_open'; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dialer_session_attempts attempt
    JOIN public.dialer_sessions session ON session.id = attempt.session_id
    WHERE session.prospecting_campaign_id = p_campaign_id
      AND attempt.status IN ('authorized', 'dialing', 'connected', 'awaiting_disposition')
  ) THEN RAISE EXCEPTION 'call_in_progress'; END IF;

  WITH eligible_members AS MATERIALIZED (
    SELECT member.id, member.status
    FROM public.prospecting_campaign_members member
    WHERE member.campaign_id = p_campaign_id
      AND member.status IN ('active', 'completed')
      AND EXISTS (
        SELECT 1
        FROM public.prospecting_campaign_member_contacts contact
        WHERE contact.member_id = member.id
          AND contact.status = 'ready'
          AND NOT (contact.source_kind = 'prospect_phone' AND contact.prospect_phone_id IS NULL)
          AND NOT EXISTS (
            SELECT 1
            FROM public.sms_opt_outs opt_out
            WHERE opt_out.is_opted_out = true
              AND public.prospecting_phone_key_v1(opt_out.phone) = contact.contact_key
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.prospect_phones phone
            WHERE phone.id = contact.prospect_phone_id
              AND (
                lower(coalesce(phone.phone_connected::text, '')) IN ('false', 'disconnected', 'bad_number', 'wrong_number')
                OR lower(coalesce(phone.last_disposition, '')) IN ('dnc', 'do_not_call', 'wrong_number', 'disconnected', 'bad_number')
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.dialer_session_attempts prior_attempt
            WHERE public.prospecting_phone_key_v1(prior_attempt.phone) = contact.contact_key
              AND lower(coalesce(prior_attempt.disposition, '')) IN ('dnc', 'do_not_call', 'wrong_number', 'disconnected', 'bad_number')
          )
      )
    FOR UPDATE
  ), reset_members AS (
    UPDATE public.prospecting_campaign_members member
    SET status = 'active', dialer_session_id = NULL, completed_at = NULL, updated_at = now()
    FROM eligible_members eligible
    WHERE member.id = eligible.id
    RETURNING eligible.status AS previous_status
  )
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE previous_status = 'completed')::integer
  INTO ready_members, reopened_members
  FROM reset_members;

  IF ready_members < 1 THEN RAISE EXCEPTION 'campaign_has_no_callable_members'; END IF;

  next_run_number := campaign_row.dialer_run_number + 1;
  UPDATE public.prospecting_campaigns
  SET status = 'active', completed_at = NULL, paused_at = NULL,
      dialer_run_number = next_run_number, updated_at = now()
  WHERE id = p_campaign_id;

  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (
    p_campaign_id,
    'campaign_rerun_started',
    trim(p_actor_name),
    jsonb_build_object(
      'previous_status', campaign_row.status,
      'previous_run_number', campaign_row.dialer_run_number,
      'run_number', next_run_number,
      'ready_members', ready_members,
      'reopened_members', reopened_members
    )
  );

  RETURN jsonb_build_object(
    'id', p_campaign_id,
    'status', 'active',
    'runNumber', next_run_number,
    'resetMembers', ready_members,
    'reopenedMembers', reopened_members
  );
END
$$;

REVOKE ALL ON FUNCTION public.rerun_prospecting_dialer_campaign_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rerun_prospecting_dialer_campaign_v2(uuid, text, text)
  TO service_role;

-- One-time operations reset requested 2026-10-07. The transaction fails
-- closed if either campaign has an open session or an unfinished call.
DO $$
DECLARE
  campaign_id uuid;
BEGIN
  FOREACH campaign_id IN ARRAY ARRAY[
    'eac5fbe3-47f5-4ef9-a91a-ef6e222923d6'::uuid,
    '74609ed4-7e26-4111-b626-b2e3f68efa0b'::uuid
  ]
  LOOP
    PERFORM public.rerun_prospecting_dialer_campaign_v2(
      campaign_id,
      'ernest@savingkc.com',
      'Ernest A. Dodson III'
    );
  END LOOP;
END
$$;
