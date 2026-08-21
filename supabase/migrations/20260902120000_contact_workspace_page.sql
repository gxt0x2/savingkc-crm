-- Cursor-bounded Contacts/Pipeline read contract.
--
-- leads remains the compatibility write aggregate. This function joins only
-- one-row projections plus the latest indexed manifest, applies the Pipeline
-- semantics in Postgres, and returns at most 51 contacts to the server.

CREATE INDEX IF NOT EXISTS idx_manifests_lead_latest
  ON public.manifests(lead_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.contact_workspace_normalize_stage(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE lower(btrim(COALESCE(value, '')))
    WHEN '' THEN 'new'
    WHEN 'intake' THEN 'new'
    WHEN 'not_contacted' THEN 'new'
    WHEN 'attempting_contact' THEN 'contacted'
    WHEN 'qualifying' THEN 'qualified'
    WHEN 'discovery' THEN 'qualified'
    WHEN 'appt_set' THEN 'appointment_set'
    WHEN 'appointment' THEN 'appointment_set'
    WHEN 'offer' THEN 'offer_made'
    WHEN 'offer_prep' THEN 'offer_made'
    WHEN 'offer_presented' THEN 'offer_made'
    WHEN 'negotiating' THEN 'offer_made'
    WHEN 'negotiations' THEN 'offer_made'
    WHEN 'nurture' THEN 'contacted'
    WHEN 'contract' THEN 'under_contract'
    WHEN 'contract_signed' THEN 'under_contract'
    WHEN 'inspection' THEN 'under_contract'
    WHEN 'closing_prep' THEN 'under_contract'
    WHEN 'closing' THEN 'under_contract'
    WHEN 'closed' THEN 'closed_won'
    WHEN 'disposition' THEN 'closed_won'
    ELSE lower(btrim(COALESCE(value, '')))
  END;
$$;
REVOKE ALL ON FUNCTION public.contact_workspace_normalize_stage(TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_workspace_stage_rank(value TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE public.contact_workspace_normalize_stage(value)
    WHEN 'new' THEN 0
    WHEN 'contacted' THEN 1
    WHEN 'qualified' THEN 2
    WHEN 'appointment_set' THEN 3
    WHEN 'offer_made' THEN 4
    WHEN 'under_contract' THEN 5
    WHEN 'closed_won' THEN 6
    WHEN 'closed_lost' THEN 6
    WHEN 'dead' THEN 6
    ELSE -1
  END;
$$;
REVOKE ALL ON FUNCTION public.contact_workspace_stage_rank(TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_workspace_manifest_tags(payload JSONB)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH candidates AS (
    SELECT value
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(payload#>'{flags,opportunityFlags}') = 'array'
        THEN payload#>'{flags,opportunityFlags}' ELSE '[]'::JSONB END
    ) AS value
    UNION ALL
    SELECT value
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(payload#>'{situation,type}') = 'array'
        THEN payload#>'{situation,type}' ELSE '[]'::JSONB END
    ) AS value
    UNION ALL
    SELECT payload#>>'{situation,timeline,lifeEventType}'
  )
  SELECT COALESCE(array_agg(DISTINCT btrim(value) ORDER BY btrim(value)), ARRAY[]::TEXT[])
  FROM candidates
  WHERE NULLIF(btrim(COALESCE(value, '')), '') IS NOT NULL
    AND lower(btrim(value)) <> 'other';
$$;
REVOKE ALL ON FUNCTION public.contact_workspace_manifest_tags(JSONB)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_workspace_pipeline_intent_source(
  lead_source TEXT,
  activity_type TEXT,
  activity_metadata JSONB
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH normalized AS (
    SELECT
      lower(regexp_replace(btrim(COALESCE(lead_source, '')), '[[:space:]-]+', '_', 'g')) AS lead_value,
      lower(regexp_replace(btrim(COALESCE(activity_metadata->>'action', '')), '[[:space:]-]+', '_', 'g')) AS action_value,
      lower(regexp_replace(btrim(COALESCE(activity_metadata->>'intent_source', activity_metadata->>'source', '')), '[[:space:]-]+', '_', 'g')) AS activity_value
  )
  SELECT CASE
    WHEN action_value = 'pipeline_intent' AND activity_value <> '' THEN activity_value
    WHEN activity_type = 'call' AND activity_value IN ('ivr_press_1', 'cold_callback_press_1') THEN activity_value
    WHEN lead_value IN (
      'website_form', 'website_form_submit', 'web_form', 'seller_form',
      'ppc_landing', 'google_ads', 'google_ads_phone', 'google_ads_tax_phone',
      'google_ads_general_phone', 'google_ads_property_tax_phone', 'youtube',
      'inbound_ivr', 'cold_call_callback'
    ) THEN lead_value
    ELSE NULL
  END
  FROM normalized;
$$;
REVOKE ALL ON FUNCTION public.contact_workspace_pipeline_intent_source(TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_workspace_page_v1(
  target_smart_list TEXT,
  target_scope TEXT,
  target_limit INTEGER,
  page_cursor JSONB,
  target_sort TEXT,
  search_text TEXT,
  owner_filter TEXT,
  stage_filter TEXT,
  minimum_stage_filter TEXT,
  source_filter TEXT,
  tag_filter TEXT,
  activity_filter TEXT,
  attention_filter TEXT,
  outreach_filter TEXT,
  data_gap_filter TEXT,
  reference_time TIMESTAMPTZ
)
RETURNS TABLE (
  items JSONB,
  total_count BIGINT,
  has_more BOOLEAN,
  next_cursor JSONB,
  scope_counts JSONB,
  smart_list_counts JSONB,
  owners TEXT[],
  sources TEXT[],
  tags TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  capped_limit INTEGER := LEAST(GREATEST(COALESCE(target_limit, 25), 1), 50);
  requested_list TEXT := lower(COALESCE(target_smart_list, 'new'));
  requested_scope TEXT := lower(COALESCE(target_scope, 'active'));
  requested_sort TEXT := lower(COALESCE(target_sort, 'priority'));
  cursor_id UUID;
BEGIN
  IF page_cursor IS NOT NULL THEN
    cursor_id := NULLIF(page_cursor->>'id', '')::UUID;
  END IF;

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT
      lead.id,
      lead.full_name,
      lead.phone,
      lead.email,
      lead.source,
      lead.property_address AS address,
      lead.city,
      public.contact_workspace_normalize_stage(lead.station) AS station,
      CASE WHEN lower(COALESCE(lead.classification, '')) IN ('lead', 'opportunity', 'dead')
        THEN lower(lead.classification) ELSE NULL END AS classification,
      lead.dead_reason,
      COALESCE(thread.owner, lead.assigned_agent) AS owner,
      COALESCE(score.composite_score, 0)::INTEGER AS score,
      COALESCE(lead.is_favorite, FALSE) AS is_favorite,
      lead.created_at,
      lead.updated_at,
      public.contact_workspace_pipeline_intent_source(
        lead.source,
        activity.pipeline_intent_activity_type,
        activity.pipeline_intent_metadata
      ) AS pipeline_intent_source,
      CASE WHEN thread.attention_state IN ('needs_reply', 'waiting_on_contact')
        THEN thread.attention_state ELSE 'resolved' END AS attention_state,
      thread.last_communication_id,
      thread.last_communication_type,
      thread.last_communication_description,
      thread.last_communication_agent,
      COALESCE(thread.last_communication_metadata, '{}'::JSONB) AS last_communication_metadata,
      thread.last_communication_at,
      COALESCE(thread.last_activity_at, lead.created_at, lead.updated_at, 'epoch'::TIMESTAMPTZ) AS last_activity_at,
      thread.primary_next_action_id,
      thread.primary_next_action_title,
      thread.primary_next_action_due_at,
      thread.primary_next_action_owner,
      activity.first_outbound_at,
      COALESCE(activity.has_outbound_attempt, FALSE) AS has_outbound_attempt,
      COALESCE(activity.has_connected_call, FALSE) AS has_connected_call,
      COALESCE(activity.has_inbound_message, FALSE) AS has_inbound_message,
      COALESCE(latest_manifest.manifest, '{}'::JSONB) AS manifest,
      public.contact_workspace_manifest_tags(COALESCE(latest_manifest.manifest, '{}'::JSONB)) AS manifest_tags
    FROM public.leads AS lead
    LEFT JOIN public.conversation_thread_state AS thread ON thread.lead_id = lead.id
    LEFT JOIN public.contact_workspace_activity_state AS activity ON activity.lead_id = lead.id
    LEFT JOIN public.hot_opportunities_cache AS score ON score.lead_id = lead.id
    LEFT JOIN LATERAL (
      SELECT stored.manifest
      FROM public.manifests AS stored
      WHERE stored.lead_id = lead.id
      ORDER BY stored.created_at DESC, stored.id DESC
      LIMIT 1
    ) AS latest_manifest ON TRUE
    WHERE COALESCE(lead.is_parked, FALSE) = FALSE
  ), derived AS MATERIALIZED (
    SELECT
      base.*,
      COALESCE(classification = 'dead', FALSE) OR station IN ('dead', 'closed_lost') AS is_not_lead,
      classification IS NULL
        AND station IN ('new', 'contacted')
        AND pipeline_intent_source IS NULL
        AND NOT (COALESCE(classification = 'dead', FALSE) OR station IN ('dead', 'closed_lost')) AS is_prospect,
      NOT (COALESCE(classification = 'dead', FALSE) OR station IN ('dead', 'closed_lost'))
        AND station <> 'closed_won'
        AND (
          classification IN ('lead', 'opportunity')
          OR (station = 'new' AND classification IS NULL AND pipeline_intent_source IS NOT NULL)
          OR station IN ('qualified', 'appointment_set', 'offer_made', 'under_contract')
        ) AS is_active,
      CASE WHEN has_connected_call OR has_inbound_message THEN 'connected_unclassified'
        WHEN has_outbound_attempt THEN 'attempted_no_response' ELSE 'unattempted' END AS outreach_status,
      CASE WHEN attention_state = 'needs_reply' THEN 0
        WHEN primary_next_action_due_at IS NOT NULL AND primary_next_action_due_at < reference_time THEN 1
        ELSE 2 END AS attention_rank,
      lower(COALESCE(NULLIF(btrim(full_name), ''), NULLIF(btrim(phone), ''), '')) AS display_name
    FROM base
    WHERE station IN (
      'new', 'contacted', 'qualified', 'appointment_set', 'offer_made',
      'under_contract', 'closed_won', 'closed_lost', 'dead'
    )
  ), scoped AS MATERIALIZED (
    SELECT * FROM derived
    WHERE CASE requested_scope
      WHEN 'not_leads' THEN is_not_lead
      WHEN 'prospects' THEN is_prospect
      WHEN 'all' THEN TRUE
      ELSE is_active
    END
  ), listed AS MATERIALIZED (
    SELECT * FROM scoped
    WHERE CASE requested_list
      WHEN 'prospects' THEN is_prospect
      WHEN 'not_leads' THEN is_not_lead
      WHEN 'new' THEN is_active AND station = 'new' AND classification IS NULL AND pipeline_intent_source IS NOT NULL
      WHEN 'hot' THEN is_active AND station <> 'under_contract' AND (score >= 75 OR is_favorite)
      WHEN 'contacted' THEN is_active AND classification = 'lead' AND station IN ('new', 'contacted')
      WHEN 'qualified' THEN is_active AND (station = 'qualified' OR (classification = 'opportunity' AND station IN ('new', 'contacted')))
      WHEN 'appointment_set' THEN is_active AND station = 'appointment_set'
      WHEN 'offer_made' THEN is_active AND station = 'offer_made'
      WHEN 'in_closing' THEN is_active AND station = 'under_contract'
      WHEN 'needs_reply' THEN is_active AND attention_state = 'needs_reply'
      WHEN 'overdue' THEN is_active AND primary_next_action_due_at IS NOT NULL AND primary_next_action_due_at < reference_time
      WHEN 'unassigned' THEN is_active AND owner IS NULL
      ELSE is_active
    END
  ), filtered AS MATERIALIZED (
    SELECT * FROM listed
    WHERE (NULLIF(btrim(owner_filter), '') IS NULL
      OR (owner_filter = '__unassigned' AND owner IS NULL)
      OR owner = owner_filter)
      AND (NULLIF(btrim(stage_filter), '') IS NULL OR station = public.contact_workspace_normalize_stage(stage_filter))
      AND (NULLIF(btrim(minimum_stage_filter), '') IS NULL
        OR public.contact_workspace_stage_rank(station) >= public.contact_workspace_stage_rank(minimum_stage_filter))
      AND (NULLIF(btrim(source_filter), '') IS NULL OR source = source_filter)
      AND (NULLIF(btrim(tag_filter), '') IS NULL OR tag_filter = ANY(manifest_tags))
      AND (NULLIF(btrim(attention_filter), '') IS NULL OR attention_state = attention_filter)
      AND (NULLIF(btrim(outreach_filter), '') IS NULL OR outreach_status = outreach_filter)
      AND (NULLIF(btrim(data_gap_filter), '') IS NULL
        OR (data_gap_filter = 'missing_phone' AND NULLIF(btrim(phone), '') IS NULL)
        OR (data_gap_filter = 'missing_email' AND NULLIF(btrim(email), '') IS NULL)
        OR (data_gap_filter = 'missing_next_action' AND primary_next_action_id IS NULL))
      AND (NULLIF(btrim(activity_filter), '') IS NULL
        OR (activity_filter = 'day' AND last_activity_at >= reference_time - INTERVAL '1 day')
        OR (activity_filter = 'week' AND last_activity_at >= reference_time - INTERVAL '7 days')
        OR (activity_filter = 'stale' AND last_activity_at < reference_time - INTERVAL '7 days' AND last_activity_at > 'epoch'::TIMESTAMPTZ)
        OR (activity_filter = 'none' AND last_activity_at = 'epoch'::TIMESTAMPTZ))
      AND (NULLIF(btrim(search_text), '') IS NULL OR lower(concat_ws(' ',
        full_name, phone, email, address, city, owner, source, dead_reason
      )) LIKE '%' || lower(btrim(search_text)) || '%')
  ), after_cursor AS MATERIALIZED (
    SELECT * FROM filtered
    WHERE page_cursor IS NULL OR CASE
      WHEN requested_sort = 'name' THEN (display_name, id) > (COALESCE(page_cursor->>'name', ''), cursor_id)
      WHEN requested_sort = 'recent' THEN
        last_activity_at < (page_cursor->>'lastActivityAt')::TIMESTAMPTZ
        OR (last_activity_at = (page_cursor->>'lastActivityAt')::TIMESTAMPTZ AND id > cursor_id)
      WHEN requested_list = 'hot' THEN
        score < (page_cursor->>'score')::INTEGER
        OR (score = (page_cursor->>'score')::INTEGER AND attention_rank > (page_cursor->>'attentionRank')::INTEGER)
        OR (score = (page_cursor->>'score')::INTEGER AND attention_rank = (page_cursor->>'attentionRank')::INTEGER AND id > cursor_id)
      ELSE
        attention_rank > (page_cursor->>'attentionRank')::INTEGER
        OR (attention_rank = (page_cursor->>'attentionRank')::INTEGER AND score < (page_cursor->>'score')::INTEGER)
        OR (attention_rank = (page_cursor->>'attentionRank')::INTEGER AND score = (page_cursor->>'score')::INTEGER AND id > cursor_id)
    END
  ), page_window AS MATERIALIZED (
    SELECT * FROM after_cursor
    ORDER BY
      CASE WHEN requested_sort = 'name' THEN display_name END ASC,
      CASE WHEN requested_sort = 'recent' THEN last_activity_at END DESC,
      CASE WHEN requested_sort = 'priority' AND requested_list = 'hot' THEN score END DESC,
      CASE WHEN requested_sort = 'priority' AND requested_list = 'hot' THEN attention_rank END ASC,
      CASE WHEN requested_sort = 'priority' AND requested_list <> 'hot' THEN attention_rank END ASC,
      CASE WHEN requested_sort = 'priority' AND requested_list <> 'hot' THEN score END DESC,
      id ASC
    LIMIT capped_limit + 1
  ), visible AS MATERIALIZED (
    SELECT * FROM page_window
    ORDER BY
      CASE WHEN requested_sort = 'name' THEN display_name END ASC,
      CASE WHEN requested_sort = 'recent' THEN last_activity_at END DESC,
      CASE WHEN requested_sort = 'priority' AND requested_list = 'hot' THEN score END DESC,
      CASE WHEN requested_sort = 'priority' AND requested_list = 'hot' THEN attention_rank END ASC,
      CASE WHEN requested_sort = 'priority' AND requested_list <> 'hot' THEN attention_rank END ASC,
      CASE WHEN requested_sort = 'priority' AND requested_list <> 'hot' THEN score END DESC,
      id ASC
    LIMIT capped_limit
  ), tail AS (
    SELECT * FROM visible
    ORDER BY
      CASE WHEN requested_sort = 'name' THEN display_name END DESC,
      CASE WHEN requested_sort = 'recent' THEN last_activity_at END ASC,
      CASE WHEN requested_sort = 'priority' AND requested_list = 'hot' THEN score END ASC,
      CASE WHEN requested_sort = 'priority' AND requested_list = 'hot' THEN attention_rank END DESC,
      CASE WHEN requested_sort = 'priority' AND requested_list <> 'hot' THEN attention_rank END DESC,
      CASE WHEN requested_sort = 'priority' AND requested_list <> 'hot' THEN score END ASC,
      id DESC
    LIMIT 1
  )
  SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(row_data) ORDER BY
      CASE WHEN requested_sort = 'name' THEN row_data.display_name END ASC,
      CASE WHEN requested_sort = 'recent' THEN row_data.last_activity_at END DESC,
      CASE WHEN requested_sort = 'priority' AND requested_list = 'hot' THEN row_data.score END DESC,
      CASE WHEN requested_sort = 'priority' AND requested_list = 'hot' THEN row_data.attention_rank END ASC,
      CASE WHEN requested_sort = 'priority' AND requested_list <> 'hot' THEN row_data.attention_rank END ASC,
      CASE WHEN requested_sort = 'priority' AND requested_list <> 'hot' THEN row_data.score END DESC,
      row_data.id ASC) FROM visible AS row_data), '[]'::JSONB),
    (SELECT count(*) FROM filtered),
    (SELECT count(*) > capped_limit FROM page_window),
    CASE WHEN (SELECT count(*) > capped_limit FROM page_window) THEN (
      SELECT jsonb_build_object(
        'id', id,
        'name', display_name,
        'lastActivityAt', last_activity_at,
        'score', score,
        'attentionRank', attention_rank
      ) FROM tail
    ) ELSE NULL END,
    (SELECT jsonb_build_object(
      'active', count(*) FILTER (WHERE is_active),
      'prospects', count(*) FILTER (WHERE is_prospect),
      'not_leads', count(*) FILTER (WHERE is_not_lead)
    ) FROM derived),
    (SELECT jsonb_build_object(
      'new', count(*) FILTER (WHERE is_active AND station = 'new' AND classification IS NULL AND pipeline_intent_source IS NOT NULL),
      'hot', count(*) FILTER (WHERE is_active AND station <> 'under_contract' AND (score >= 75 OR is_favorite)),
      'contacted', count(*) FILTER (WHERE is_active AND classification = 'lead' AND station IN ('new', 'contacted')),
      'qualified', count(*) FILTER (WHERE is_active AND (station = 'qualified' OR (classification = 'opportunity' AND station IN ('new', 'contacted')))),
      'appointment_set', count(*) FILTER (WHERE is_active AND station = 'appointment_set'),
      'offer_made', count(*) FILTER (WHERE is_active AND station = 'offer_made'),
      'in_closing', count(*) FILTER (WHERE is_active AND station = 'under_contract'),
      'needs_reply', count(*) FILTER (WHERE is_active AND attention_state = 'needs_reply'),
      'overdue', count(*) FILTER (WHERE is_active AND primary_next_action_due_at IS NOT NULL AND primary_next_action_due_at < reference_time),
      'unassigned', count(*) FILTER (WHERE is_active AND owner IS NULL),
      'all', count(*) FILTER (WHERE is_active),
      'prospects', count(*) FILTER (WHERE is_prospect),
      'not_leads', count(*) FILTER (WHERE is_not_lead)
    ) FROM derived),
    COALESCE((SELECT array_agg(DISTINCT owner ORDER BY owner) FILTER (WHERE owner IS NOT NULL) FROM scoped), ARRAY[]::TEXT[]),
    COALESCE((SELECT array_agg(DISTINCT source ORDER BY source) FILTER (WHERE source IS NOT NULL) FROM scoped), ARRAY[]::TEXT[]),
    COALESCE((SELECT array_agg(DISTINCT tag ORDER BY tag) FROM scoped CROSS JOIN LATERAL unnest(manifest_tags) AS tag), ARRAY[]::TEXT[]);
END
$$;

REVOKE ALL ON FUNCTION public.contact_workspace_page_v1(
  TEXT, TEXT, INTEGER, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_workspace_page_v1(
  TEXT, TEXT, INTEGER, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

COMMENT ON FUNCTION public.contact_workspace_page_v1(
  TEXT, TEXT, INTEGER, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) IS 'Returns a keyset-paginated Pipeline page from compact CRM projections; response rows are capped at 50.';
