-- Prospecting call reporting phase 2.
--
-- Extends the durable report with agent/caller filters, cross-page call
-- search, session drill-down metrics, and recording availability. The v1
-- function remains in place for rollback compatibility.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.prospecting_campaign_call_report_v2(
  p_campaign_id uuid,
  p_actor_email text,
  p_run_number integer DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to_exclusive timestamptz DEFAULT NULL,
  p_agent_email text DEFAULT NULL,
  p_caller_id text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_session_id uuid DEFAULT NULL,
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
  agent_filter text := lower(trim(coalesce(p_agent_email, '')));
  caller_filter text := public.prospecting_phone_key_v1(coalesce(p_caller_id, ''));
  search_filter text := lower(trim(coalesce(p_search, '')));
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
  IF length(agent_filter) > 320 OR length(caller_filter) > 32 OR length(search_filter) > 120 THEN
    RAISE EXCEPTION 'invalid_report_filter';
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
        session.skips,
        session.started_at,
        session.ended_at,
        session.updated_at,
        session.campaign_run_number
      FROM public.dialer_sessions session
      JOIN campaign_scope campaign ON campaign.id = session.prospecting_campaign_id
      WHERE p_run_number IS NULL OR session.campaign_run_number = p_run_number
    ),
    attempt_candidates AS MATERIALIZED (
      SELECT
        attempt.*,
        session.actor_email,
        session.agent_name,
        session.campaign_run_number,
        session.campaign_id,
        session.campaign_name,
        CASE WHEN attempt.lead_id IS NOT NULL THEN lead.full_name ELSE prospect.owner_1 END AS seller_name,
        CASE
          WHEN attempt.lead_id IS NOT NULL THEN lead.property_address
          ELSE nullif(concat_ws(
            ', ',
            nullif(trim(prospect.situs_street), ''),
            nullif(trim(concat_ws(' ', prospect.situs_city, prospect.situs_state, prospect.situs_zip)), '')
          ), '')
        END AS property_address
      FROM public.dialer_session_attempts attempt
      JOIN session_candidates session ON session.id = attempt.session_id
      LEFT JOIN public.leads lead ON lead.id = attempt.lead_id
      LEFT JOIN public.prospects prospect ON prospect.id = attempt.prospect_id
      WHERE (p_from IS NULL OR attempt.created_at >= p_from)
        AND (p_to_exclusive IS NULL OR attempt.created_at < p_to_exclusive)
    ),
    attempt_scope AS MATERIALIZED (
      SELECT attempt.*
      FROM attempt_candidates attempt
      WHERE (agent_filter = '' OR lower(attempt.actor_email) = agent_filter)
        AND (caller_filter = '' OR public.prospecting_phone_key_v1(attempt.caller_id) = caller_filter)
    ),
    searched_attempt_scope AS MATERIALIZED (
      SELECT attempt.*
      FROM attempt_scope attempt
      WHERE search_filter = ''
        OR strpos(lower(coalesce(attempt.seller_name, '')), search_filter) > 0
        OR strpos(lower(coalesce(attempt.property_address, '')), search_filter) > 0
        OR strpos(lower(coalesce(attempt.campaign_name, '')), search_filter) > 0
        OR strpos(lower(coalesce(attempt.agent_name, '')), search_filter) > 0
        OR strpos(lower(coalesce(attempt.disposition, attempt.status, '')), search_filter) > 0
        OR (
          public.prospecting_phone_key_v1(search_filter) <> ''
          AND strpos(public.prospecting_phone_key_v1(attempt.phone), public.prospecting_phone_key_v1(search_filter)) > 0
        )
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
        (SELECT coalesce(sum(session.skips), 0)::integer FROM session_scope session WHERE lower(session.actor_email) = lower(attempt.actor_email)) AS skips
      FROM attempt_scope attempt
      GROUP BY attempt.actor_email
    ),
    session_rows AS (
      SELECT
        session.*,
        (SELECT count(*)::integer FROM attempt_scope attempt WHERE attempt.session_id = session.id) AS calls,
        (SELECT count(*)::integer FROM attempt_scope attempt WHERE attempt.session_id = session.id AND attempt.connected_at IS NOT NULL) AS connected,
        (SELECT count(*)::integer FROM attempt_scope attempt WHERE attempt.session_id = session.id AND attempt.status = 'dispositioned') AS filtered_results_saved,
        (SELECT count(*)::integer FROM attempt_scope attempt WHERE attempt.session_id = session.id AND attempt.reached = true) AS filtered_reached,
        (SELECT count(DISTINCT public.prospecting_phone_key_v1(attempt.phone))::integer FROM attempt_scope attempt WHERE attempt.session_id = session.id AND public.prospecting_phone_key_v1(attempt.phone) <> '') AS unique_numbers,
        (SELECT coalesce(sum(attempt.duration_seconds), 0)::integer FROM attempt_scope attempt WHERE attempt.session_id = session.id) AS call_duration_seconds,
        greatest(0, extract(epoch FROM (coalesce(session.ended_at, session.updated_at) - session.started_at))::integer) AS session_duration_seconds,
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
      ORDER BY CASE WHEN session.id = p_session_id THEN 0 ELSE 1 END, session.started_at DESC, session.id DESC
      LIMIT 50
    ),
    attempt_rows AS (
      SELECT attempt.*
      FROM searched_attempt_scope attempt
      ORDER BY attempt.created_at DESC, attempt.id DESC
      LIMIT p_limit
      OFFSET p_offset
    ),
    selected_session_attempts AS (
      SELECT attempt.*
      FROM attempt_scope attempt
      WHERE p_session_id IS NOT NULL AND attempt.session_id = p_session_id
      ORDER BY attempt.created_at DESC, attempt.id DESC
      LIMIT 100
    ),
    recording_rows AS (
      SELECT attempt.*
      FROM attempt_scope attempt
      WHERE nullif(trim(attempt.recording_sid), '') IS NOT NULL
      ORDER BY attempt.created_at DESC, attempt.id DESC
      LIMIT 50
    )
    SELECT jsonb_build_object(
      'campaign', jsonb_build_object(
        'id', CASE WHEN p_campaign_id IS NULL THEN NULL ELSE campaign_row.id END,
        'name', CASE WHEN p_campaign_id IS NULL THEN 'All campaigns' ELSE campaign_row.name END,
        'status', CASE WHEN p_campaign_id IS NULL THEN 'all' ELSE campaign_row.status END,
        'currentRunNumber', CASE WHEN p_campaign_id IS NULL THEN NULL ELSE campaign_row.dialer_run_number END
      ),
      'runNumber', p_run_number,
      'filters', jsonb_build_object(
        'agentEmail', nullif(agent_filter, ''),
        'callerId', nullif(p_caller_id, ''),
        'search', nullif(search_filter, ''),
        'agents', coalesce((
          SELECT jsonb_agg(jsonb_build_object('email', option.actor_email, 'name', option.agent_name) ORDER BY option.agent_name, option.actor_email)
          FROM (
            SELECT attempt.actor_email, max(attempt.agent_name) AS agent_name
            FROM attempt_candidates attempt
            GROUP BY attempt.actor_email
          ) option
        ), '[]'::jsonb),
        'callerIds', coalesce((
          SELECT jsonb_agg(option.caller_id ORDER BY option.caller_id)
          FROM (SELECT DISTINCT attempt.caller_id FROM attempt_candidates attempt WHERE nullif(trim(attempt.caller_id), '') IS NOT NULL) option
        ), '[]'::jsonb)
      ),
      'metrics', jsonb_build_object(
        'sessions', (SELECT count(*) FROM session_scope),
        'agents', (SELECT count(DISTINCT actor_email) FROM session_scope),
        'attempts', (SELECT count(*) FROM attempt_scope),
        'providerConnected', (SELECT count(*) FROM attempt_scope WHERE connected_at IS NOT NULL),
        'reached', (SELECT count(*) FROM attempt_scope WHERE reached = true),
        'resultsSaved', (SELECT count(*) FROM attempt_scope WHERE status = 'dispositioned'),
        'failed', (SELECT count(*) FROM attempt_scope WHERE status IN ('failed', 'cancelled')),
        'uniqueNumbers', (SELECT count(DISTINCT public.prospecting_phone_key_v1(phone)) FROM attempt_scope WHERE public.prospecting_phone_key_v1(phone) <> ''),
        'durationSeconds', (SELECT coalesce(sum(duration_seconds), 0) FROM attempt_scope),
        'skips', (SELECT coalesce(sum(skips), 0) FROM session_scope)
      ),
      'outcomes', coalesce((SELECT jsonb_object_agg(outcome.disposition, outcome.total) FROM outcome_rows outcome), '{}'::jsonb),
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
          'calls', session.calls,
          'connected', session.connected,
          'uniqueNumbers', session.unique_numbers,
          'resultsSaved', session.filtered_results_saved,
          'reached', session.filtered_reached,
          'skips', session.skips,
          'durationSeconds', session.call_duration_seconds,
          'sessionDurationSeconds', session.session_duration_seconds,
          'outcomes', session.filtered_outcomes,
          'startedAt', session.started_at,
          'endedAt', session.ended_at,
          'updatedAt', session.updated_at
        ) ORDER BY CASE WHEN session.id = p_session_id THEN 0 ELSE 1 END, session.started_at DESC, session.id DESC)
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
            'recordingSid', attempt.recording_sid,
            'postCallStatus', attempt.post_call_status,
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
          'total', (SELECT count(*) FROM searched_attempt_scope),
          'hasMore', p_offset + p_limit < (SELECT count(*) FROM searched_attempt_scope)
        )
      ),
      'selectedSessionCalls', coalesce((
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
          'recordingSid', attempt.recording_sid,
          'postCallStatus', attempt.post_call_status,
          'createdAt', attempt.created_at,
          'startedAt', attempt.started_at,
          'connectedAt', attempt.connected_at,
          'endedAt', attempt.ended_at
        ) ORDER BY attempt.created_at DESC, attempt.id DESC)
        FROM selected_session_attempts attempt
      ), '[]'::jsonb),
      'recordings', jsonb_build_object(
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
            'recordingSid', attempt.recording_sid,
            'postCallStatus', attempt.post_call_status,
            'createdAt', attempt.created_at,
            'startedAt', attempt.started_at,
            'connectedAt', attempt.connected_at,
            'endedAt', attempt.ended_at
          ) ORDER BY attempt.created_at DESC, attempt.id DESC)
          FROM recording_rows attempt
        ), '[]'::jsonb),
        'total', (SELECT count(*) FROM attempt_scope WHERE nullif(trim(recording_sid), '') IS NOT NULL)
      )
    )
  );
END
$$;

REVOKE ALL ON FUNCTION public.prospecting_campaign_call_report_v2(uuid, text, integer, timestamptz, timestamptz, text, text, text, uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospecting_campaign_call_report_v2(uuid, text, integer, timestamptz, timestamptz, text, text, text, uuid, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.prospecting_campaign_call_report_v2(uuid, text, integer, timestamptz, timestamptz, text, text, text, uuid, integer, integer)
  IS 'Returns authorized Prospecting reporting with agent/caller filters, call search, session drill-down, and recording availability.';
