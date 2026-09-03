-- Durable Prospecting call reporting and explicit completed-list reruns.
--
-- Every call result remains in dialer_session_attempts. A rerun only reopens
-- completed campaign members that still have a callable contact; it never
-- deletes or rewrites a prior session, attempt, outcome, DNC, or suppression.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.prospecting_campaigns
  ADD COLUMN IF NOT EXISTS dialer_run_number integer NOT NULL DEFAULT 1;

ALTER TABLE public.prospecting_campaigns
  DROP CONSTRAINT IF EXISTS prospecting_campaigns_dialer_run_number_positive,
  ADD CONSTRAINT prospecting_campaigns_dialer_run_number_positive
    CHECK (dialer_run_number > 0) NOT VALID;

ALTER TABLE public.dialer_sessions
  ADD COLUMN IF NOT EXISTS campaign_run_number integer NOT NULL DEFAULT 1;

ALTER TABLE public.dialer_sessions
  DROP CONSTRAINT IF EXISTS dialer_sessions_campaign_run_number_positive,
  ADD CONSTRAINT dialer_sessions_campaign_run_number_positive
    CHECK (campaign_run_number > 0) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_dialer_sessions_campaign_run_history
  ON public.dialer_sessions (prospecting_campaign_id, campaign_run_number, started_at DESC, id DESC)
  WHERE prospecting_campaign_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_prospecting_dialer_run_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.prospecting_campaign_id IS NOT NULL THEN
    SELECT campaign.dialer_run_number
    INTO NEW.campaign_run_number
    FROM public.prospecting_campaigns campaign
    WHERE campaign.id = NEW.prospecting_campaign_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.assign_prospecting_dialer_run_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_prospecting_dialer_run_v1() TO service_role;

DROP TRIGGER IF EXISTS dialer_session_assign_prospecting_run ON public.dialer_sessions;
CREATE TRIGGER dialer_session_assign_prospecting_run
  BEFORE INSERT OR UPDATE OF prospecting_campaign_id ON public.dialer_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_prospecting_dialer_run_v1();

CREATE OR REPLACE FUNCTION public.rerun_prospecting_dialer_campaign_v1(
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
  reset_members integer := 0;
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
  IF campaign_row.status <> 'completed' THEN RAISE EXCEPTION 'campaign_not_complete'; END IF;

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

  UPDATE public.prospecting_campaign_members member
  SET status = 'active', dialer_session_id = NULL, completed_at = NULL, updated_at = now()
  WHERE member.campaign_id = p_campaign_id
    AND member.status = 'completed'
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
    );
  GET DIAGNOSTICS reset_members = ROW_COUNT;

  IF reset_members < 1 THEN RAISE EXCEPTION 'campaign_has_no_callable_completed_members'; END IF;

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
      'previous_run_number', campaign_row.dialer_run_number,
      'run_number', next_run_number,
      'reset_members', reset_members
    )
  );

  RETURN jsonb_build_object(
    'id', p_campaign_id,
    'status', 'active',
    'runNumber', next_run_number,
    'resetMembers', reset_members
  );
END
$$;

REVOKE ALL ON FUNCTION public.rerun_prospecting_dialer_campaign_v1(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rerun_prospecting_dialer_campaign_v1(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.prospecting_campaign_call_report_v1(
  p_campaign_id uuid,
  p_actor_email text,
  p_run_number integer DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to_exclusive timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_key text := lower(trim(coalesce(p_actor_email, '')));
  campaign_row public.prospecting_campaigns;
BEGIN
  IF actor_key = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF p_run_number IS NOT NULL AND p_run_number < 1 THEN RAISE EXCEPTION 'invalid_run_number'; END IF;
  IF p_campaign_id IS NULL AND p_run_number IS NOT NULL THEN RAISE EXCEPTION 'run_requires_campaign'; END IF;
  IF (p_from IS NULL) <> (p_to_exclusive IS NULL)
    OR (p_from IS NOT NULL AND (p_from >= p_to_exclusive OR p_to_exclusive - p_from > interval '90 days')) THEN
    RAISE EXCEPTION 'invalid_report_range';
  END IF;
  IF p_limit < 1 OR p_limit > 100 OR p_offset < 0 OR p_offset > 100000 THEN
    RAISE EXCEPTION 'invalid_report_page';
  END IF;

  IF p_campaign_id IS NOT NULL THEN
    SELECT * INTO campaign_row
    FROM public.prospecting_campaigns campaign
    WHERE campaign.id = p_campaign_id
      AND (
        lower(campaign.owner_email) = actor_key
        OR (campaign.kind = 'dialer' AND campaign.status = 'active')
        OR EXISTS (
          SELECT 1
          FROM public.dialer_sessions prior_session
          WHERE prior_session.prospecting_campaign_id = campaign.id
            AND lower(prior_session.actor_email) = actor_key
        )
      );
    IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
    IF campaign_row.kind <> 'dialer' THEN RAISE EXCEPTION 'invalid_campaign_kind'; END IF;
  END IF;

  RETURN (
    WITH campaign_scope AS MATERIALIZED (
      SELECT campaign.id, campaign.name, campaign.status, campaign.dialer_run_number
      FROM public.prospecting_campaigns campaign
      WHERE campaign.kind = 'dialer'
        AND (p_campaign_id IS NULL OR campaign.id = p_campaign_id)
        AND (
          lower(campaign.owner_email) = actor_key
          OR campaign.status = 'active'
          OR EXISTS (
            SELECT 1
            FROM public.dialer_sessions prior_session
            WHERE prior_session.prospecting_campaign_id = campaign.id
              AND lower(prior_session.actor_email) = actor_key
          )
        )
    ),
    session_candidates AS MATERIALIZED (
      SELECT
        session.id,
        campaign.id AS campaign_id,
        campaign.name AS campaign_name,
        session.actor_email,
        session.agent_name,
        session.status,
        session.queue_size,
        session.dials_completed,
        session.contacts,
        session.skips,
        session.outcomes,
        session.started_at,
        session.ended_at,
        session.updated_at,
        session.campaign_run_number
      FROM public.dialer_sessions session
      JOIN campaign_scope campaign ON campaign.id = session.prospecting_campaign_id
      WHERE p_run_number IS NULL OR session.campaign_run_number = p_run_number
    ),
    attempt_scope AS MATERIALIZED (
      SELECT
        attempt.*,
        session.actor_email,
        session.agent_name,
        session.campaign_run_number,
        session.campaign_id,
        session.campaign_name
      FROM public.dialer_session_attempts attempt
      JOIN session_candidates session ON session.id = attempt.session_id
      WHERE (p_from IS NULL OR attempt.created_at >= p_from)
        AND (p_to_exclusive IS NULL OR attempt.created_at < p_to_exclusive)
    ),
    session_scope AS MATERIALIZED (
      SELECT session.*
      FROM session_candidates session
      WHERE EXISTS (SELECT 1 FROM attempt_scope attempt WHERE attempt.session_id = session.id)
    ),
    outcome_rows AS (
      SELECT attempt.disposition, count(*)::integer AS total
      FROM attempt_scope attempt
      WHERE attempt.status = 'dispositioned'
        AND nullif(trim(attempt.disposition), '') IS NOT NULL
      GROUP BY attempt.disposition
    ),
    run_rows AS (
      SELECT
        attempt.campaign_run_number,
        count(DISTINCT attempt.session_id)::integer AS sessions,
        count(*) FILTER (WHERE attempt.status = 'dispositioned')::integer AS results_saved,
        count(*) FILTER (WHERE attempt.reached = true)::integer AS reached,
        (SELECT coalesce(sum(session.skips), 0)::integer FROM session_scope session WHERE session.campaign_run_number = attempt.campaign_run_number) AS skips,
        min(attempt.created_at) AS started_at,
        max(coalesce(attempt.ended_at, attempt.created_at)) AS last_activity_at
      FROM attempt_scope attempt
      GROUP BY attempt.campaign_run_number
    ),
    agent_rows AS (
      SELECT
        attempt.actor_email,
        max(attempt.agent_name) AS agent_name,
        count(DISTINCT attempt.session_id)::integer AS sessions,
        count(*) FILTER (WHERE attempt.status = 'dispositioned')::integer AS results_saved,
        count(*) FILTER (WHERE attempt.reached = true)::integer AS reached,
        (SELECT coalesce(sum(session.skips), 0)::integer FROM session_scope session WHERE session.actor_email = attempt.actor_email) AS skips
      FROM attempt_scope attempt
      GROUP BY attempt.actor_email
    ),
    session_rows AS (
      SELECT
        session.*,
        (SELECT count(*)::integer FROM attempt_scope attempt WHERE attempt.session_id = session.id AND attempt.status = 'dispositioned') AS filtered_results_saved,
        (SELECT count(*)::integer FROM attempt_scope attempt WHERE attempt.session_id = session.id AND attempt.reached = true) AS filtered_reached,
        coalesce((
          SELECT jsonb_object_agg(outcome.disposition, outcome.total)
          FROM (
            SELECT attempt.disposition, count(*)::integer AS total
            FROM attempt_scope attempt
            WHERE attempt.session_id = session.id
              AND attempt.status = 'dispositioned'
              AND nullif(trim(attempt.disposition), '') IS NOT NULL
            GROUP BY attempt.disposition
          ) outcome
        ), '{}'::jsonb) AS filtered_outcomes
      FROM session_scope session
      ORDER BY session.started_at DESC, session.id DESC
      LIMIT 50
    ),
    attempt_rows AS (
      SELECT
        attempt.id,
        attempt.session_id,
        attempt.campaign_id,
        attempt.campaign_name,
        attempt.campaign_run_number,
        attempt.agent_name,
        attempt.actor_email,
        attempt.phone,
        attempt.caller_id,
        attempt.status,
        attempt.disposition,
        attempt.reached,
        attempt.duration_seconds,
        attempt.created_at,
        attempt.started_at,
        attempt.connected_at,
        attempt.ended_at,
        CASE
          WHEN attempt.lead_id IS NOT NULL THEN lead.full_name
          ELSE prospect.owner_1
        END AS seller_name,
        CASE
          WHEN attempt.lead_id IS NOT NULL THEN lead.property_address
          ELSE nullif(concat_ws(
            ', ',
            nullif(trim(prospect.situs_street), ''),
            nullif(trim(concat_ws(' ', prospect.situs_city, prospect.situs_state, prospect.situs_zip)), '')
          ), '')
        END AS property_address
      FROM attempt_scope attempt
      LEFT JOIN public.leads lead ON lead.id = attempt.lead_id
      LEFT JOIN public.prospects prospect ON prospect.id = attempt.prospect_id
      ORDER BY attempt.created_at DESC, attempt.id DESC
      LIMIT p_limit
      OFFSET p_offset
    )
    SELECT jsonb_build_object(
      'campaign', jsonb_build_object(
        'id', CASE WHEN p_campaign_id IS NULL THEN NULL ELSE campaign_row.id END,
        'name', CASE WHEN p_campaign_id IS NULL THEN 'All campaigns' ELSE campaign_row.name END,
        'status', CASE WHEN p_campaign_id IS NULL THEN 'all' ELSE campaign_row.status END,
        'currentRunNumber', CASE WHEN p_campaign_id IS NULL THEN NULL ELSE campaign_row.dialer_run_number END
      ),
      'runNumber', p_run_number,
      'metrics', jsonb_build_object(
        'sessions', (SELECT count(*) FROM session_scope),
        'agents', (SELECT count(DISTINCT actor_email) FROM session_scope),
        'attempts', (SELECT count(*) FROM attempt_scope),
        'providerConnected', (SELECT count(*) FROM attempt_scope WHERE connected_at IS NOT NULL),
        'reached', (SELECT count(*) FROM attempt_scope WHERE reached = true),
        'resultsSaved', (SELECT count(*) FROM attempt_scope WHERE status = 'dispositioned'),
        'failed', (SELECT count(*) FROM attempt_scope WHERE status IN ('failed', 'cancelled')),
        'uniqueNumbers', (
          SELECT count(DISTINCT public.prospecting_phone_key_v1(phone))
          FROM attempt_scope
          WHERE public.prospecting_phone_key_v1(phone) <> ''
        ),
        'durationSeconds', (SELECT coalesce(sum(duration_seconds), 0) FROM attempt_scope),
        'skips', (SELECT coalesce(sum(skips), 0) FROM session_scope)
      ),
      'outcomes', coalesce((
        SELECT jsonb_object_agg(outcome.disposition, outcome.total)
        FROM outcome_rows outcome
      ), '{}'::jsonb),
      'runs', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'runNumber', run.campaign_run_number,
          'sessions', run.sessions,
          'resultsSaved', run.results_saved,
          'reached', run.reached,
          'skips', run.skips,
          'startedAt', run.started_at,
          'lastActivityAt', run.last_activity_at
        ) ORDER BY run.campaign_run_number DESC)
        FROM run_rows run
      ), '[]'::jsonb),
      'agents', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'email', agent.actor_email,
          'name', agent.agent_name,
          'sessions', agent.sessions,
          'resultsSaved', agent.results_saved,
          'reached', agent.reached,
          'skips', agent.skips
        ) ORDER BY agent.results_saved DESC, agent.agent_name)
        FROM agent_rows agent
      ), '[]'::jsonb),
      'sessions', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', session.id,
          'campaignId', session.campaign_id,
          'campaignName', session.campaign_name,
          'runNumber', session.campaign_run_number,
          'agentName', session.agent_name,
          'agentEmail', session.actor_email,
          'status', session.status,
          'queueSize', session.queue_size,
          'resultsSaved', session.filtered_results_saved,
          'reached', session.filtered_reached,
          'skips', session.skips,
          'outcomes', session.filtered_outcomes,
          'startedAt', session.started_at,
          'endedAt', session.ended_at,
          'updatedAt', session.updated_at
        ) ORDER BY session.started_at DESC, session.id DESC)
        FROM session_rows session
      ), '[]'::jsonb),
      'attempts', jsonb_build_object(
        'items', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', attempt.id,
            'sessionId', attempt.session_id,
            'campaignId', attempt.campaign_id,
            'campaignName', attempt.campaign_name,
            'runNumber', attempt.campaign_run_number,
            'agentName', attempt.agent_name,
            'agentEmail', attempt.actor_email,
            'sellerName', attempt.seller_name,
            'propertyAddress', attempt.property_address,
            'phone', attempt.phone,
            'callerId', attempt.caller_id,
            'status', attempt.status,
            'disposition', attempt.disposition,
            'reached', attempt.reached,
            'durationSeconds', attempt.duration_seconds,
            'createdAt', attempt.created_at,
            'startedAt', attempt.started_at,
            'connectedAt', attempt.connected_at,
            'endedAt', attempt.ended_at
          ) ORDER BY attempt.created_at DESC, attempt.id DESC)
          FROM attempt_rows attempt
        ), '[]'::jsonb),
        'pageInfo', jsonb_build_object(
          'limit', p_limit,
          'offset', p_offset,
          'total', (SELECT count(*) FROM attempt_scope),
          'hasMore', p_offset + p_limit < (SELECT count(*) FROM attempt_scope)
        )
      )
    )
  );
END
$$;

REVOKE ALL ON FUNCTION public.prospecting_campaign_call_report_v1(uuid, text, integer, timestamptz, timestamptz, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospecting_campaign_call_report_v1(uuid, text, integer, timestamptz, timestamptz, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.rerun_prospecting_dialer_campaign_v1(uuid, text, text)
  IS 'Reopens callable completed members for the next campaign run while preserving all prior sessions, attempts, outcomes, DNCs, and suppressions.';
COMMENT ON FUNCTION public.prospecting_campaign_call_report_v1(uuid, text, integer, timestamptz, timestamptz, integer, integer)
  IS 'Returns authorized all-campaign or single-campaign call reporting with optional run and date filters from the durable dialer attempt ledger.';
