-- Prospecting call reporting sortable call detail.
--
-- Keeps the v2 report contract available for rollback while replacing only its
-- paginated attempt slice with an authorized, server-sorted result set.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.prospecting_campaign_call_report_v3(
  p_campaign_id uuid,
  p_actor_email text,
  p_run_number integer DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to_exclusive timestamptz DEFAULT NULL,
  p_agent_email text DEFAULT NULL,
  p_caller_id text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_session_id uuid DEFAULT NULL,
  p_sort text DEFAULT 'called',
  p_direction text DEFAULT 'desc',
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
  sort_key text := lower(trim(coalesce(p_sort, 'called')));
  direction_key text := lower(trim(coalesce(p_direction, 'desc')));
  base_report jsonb;
  sorted_attempts jsonb;
BEGIN
  IF sort_key NOT IN ('called', 'campaign', 'seller', 'number', 'result', 'agent', 'run', 'duration', 'caller')
    OR direction_key NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'invalid_report_sort';
  END IF;

  base_report := public.prospecting_campaign_call_report_v2(
    p_campaign_id,
    p_actor_email,
    p_run_number,
    p_from,
    p_to_exclusive,
    p_agent_email,
    p_caller_id,
    p_search,
    p_session_id,
    p_limit,
    p_offset
  );

  WITH campaign_scope AS MATERIALIZED (
    SELECT campaign.id, campaign.name
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
  session_scope AS MATERIALIZED (
    SELECT
      session.id,
      session.actor_email,
      session.agent_name,
      session.campaign_run_number,
      campaign.id AS campaign_id,
      campaign.name AS campaign_name
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
    JOIN session_scope session ON session.id = attempt.session_id
    LEFT JOIN public.leads lead ON lead.id = attempt.lead_id
    LEFT JOIN public.prospects prospect ON prospect.id = attempt.prospect_id
    WHERE (p_from IS NULL OR attempt.created_at >= p_from)
      AND (p_to_exclusive IS NULL OR attempt.created_at < p_to_exclusive)
      AND (agent_filter = '' OR lower(session.actor_email) = agent_filter)
      AND (caller_filter = '' OR public.prospecting_phone_key_v1(attempt.caller_id) = caller_filter)
  ),
  searched_attempts AS MATERIALIZED (
    SELECT attempt.*
    FROM attempt_candidates attempt
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
  ranked_attempts AS MATERIALIZED (
    SELECT
      attempt.*,
      row_number() OVER (ORDER BY
        CASE WHEN sort_key = 'called' AND direction_key = 'asc' THEN coalesce(attempt.started_at, attempt.created_at) END ASC,
        CASE WHEN sort_key = 'called' AND direction_key = 'desc' THEN coalesce(attempt.started_at, attempt.created_at) END DESC,
        CASE WHEN sort_key = 'campaign' AND direction_key = 'asc' THEN lower(attempt.campaign_name) END ASC,
        CASE WHEN sort_key = 'campaign' AND direction_key = 'desc' THEN lower(attempt.campaign_name) END DESC,
        CASE WHEN sort_key = 'seller' AND direction_key = 'asc' THEN lower(coalesce(attempt.seller_name, attempt.property_address, '')) END ASC,
        CASE WHEN sort_key = 'seller' AND direction_key = 'desc' THEN lower(coalesce(attempt.seller_name, attempt.property_address, '')) END DESC,
        CASE WHEN sort_key = 'number' AND direction_key = 'asc' THEN public.prospecting_phone_key_v1(attempt.phone) END ASC,
        CASE WHEN sort_key = 'number' AND direction_key = 'desc' THEN public.prospecting_phone_key_v1(attempt.phone) END DESC,
        CASE WHEN sort_key = 'result' AND direction_key = 'asc' THEN lower(coalesce(attempt.disposition, attempt.status, '')) END ASC,
        CASE WHEN sort_key = 'result' AND direction_key = 'desc' THEN lower(coalesce(attempt.disposition, attempt.status, '')) END DESC,
        CASE WHEN sort_key = 'agent' AND direction_key = 'asc' THEN lower(attempt.agent_name) END ASC,
        CASE WHEN sort_key = 'agent' AND direction_key = 'desc' THEN lower(attempt.agent_name) END DESC,
        CASE WHEN sort_key = 'run' AND direction_key = 'asc' THEN attempt.campaign_run_number END ASC,
        CASE WHEN sort_key = 'run' AND direction_key = 'desc' THEN attempt.campaign_run_number END DESC,
        CASE WHEN sort_key = 'duration' AND direction_key = 'asc' THEN coalesce(attempt.duration_seconds, 0) END ASC,
        CASE WHEN sort_key = 'duration' AND direction_key = 'desc' THEN coalesce(attempt.duration_seconds, 0) END DESC,
        CASE WHEN sort_key = 'caller' AND direction_key = 'asc' THEN public.prospecting_phone_key_v1(attempt.caller_id) END ASC,
        CASE WHEN sort_key = 'caller' AND direction_key = 'desc' THEN public.prospecting_phone_key_v1(attempt.caller_id) END DESC,
        coalesce(attempt.started_at, attempt.created_at) DESC,
        attempt.id DESC
      ) AS report_order
    FROM searched_attempts attempt
  ),
  attempt_rows AS (
    SELECT attempt.*
    FROM ranked_attempts attempt
    ORDER BY attempt.report_order
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT jsonb_build_object(
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
      ) ORDER BY attempt.report_order)
      FROM attempt_rows attempt
    ), '[]'::jsonb),
    'pageInfo', jsonb_build_object(
      'limit', p_limit,
      'offset', p_offset,
      'total', (SELECT count(*) FROM searched_attempts),
      'hasMore', p_offset + p_limit < (SELECT count(*) FROM searched_attempts)
    )
  ) INTO sorted_attempts;

  RETURN jsonb_set(base_report, '{attempts}', sorted_attempts, true);
END
$$;

REVOKE ALL ON FUNCTION public.prospecting_campaign_call_report_v3(uuid, text, integer, timestamptz, timestamptz, text, text, text, uuid, text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospecting_campaign_call_report_v3(uuid, text, integer, timestamptz, timestamptz, text, text, text, uuid, text, text, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.prospecting_campaign_call_report_v3(uuid, text, integer, timestamptz, timestamptz, text, text, text, uuid, text, text, integer, integer)
  IS 'Returns the authorized v2 Prospecting report with server-sorted, paginated call detail.';
