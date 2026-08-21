-- Incremental activity projection for the Contacts workspace.
--
-- The Contacts route previously downloaded the complete communication history
-- on every refresh. lead_activities remains the source of truth, while this
-- additive projection keeps one compact summary row per lead. Apply this
-- migration before deploying the matching route change.

CREATE TABLE IF NOT EXISTS public.contact_workspace_activity_state (
  lead_id UUID PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  first_outbound_at TIMESTAMPTZ,
  has_outbound_attempt BOOLEAN NOT NULL DEFAULT FALSE,
  has_connected_call BOOLEAN NOT NULL DEFAULT FALSE,
  has_inbound_message BOOLEAN NOT NULL DEFAULT FALSE,
  pipeline_intent_activity_type TEXT,
  pipeline_intent_metadata JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.contact_workspace_activity_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contact_workspace_activity_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.contact_workspace_activity_state TO service_role;

CREATE INDEX IF NOT EXISTS idx_conversation_thread_state_lead
  ON public.conversation_thread_state(lead_id)
  WHERE lead_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.contact_workspace_call_is_connected(
  activity_kind TEXT,
  activity_description TEXT,
  activity_metadata JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH activity_text AS (
    SELECT lower(concat_ws(' ',
      activity_kind,
      activity_description,
      activity_metadata->>'status',
      activity_metadata->>'outcome',
      activity_metadata->>'dialStatus',
      activity_metadata->>'disposition',
      activity_metadata->>'callStatus'
    )) AS value
  )
  SELECT activity_kind = 'call'
    AND value !~ '(no[-_ ]?answer|busy|failed|canceled|cancelled|missed|voicemail)'
    AND value ~ '(answered|completed|connected|spoke[_ -]?with[_ -]?owner|contact|live)'
  FROM activity_text;
$$;
REVOKE ALL ON FUNCTION public.contact_workspace_call_is_connected(TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.contact_workspace_activity_is_pipeline_intent(
  activity_kind TEXT,
  activity_metadata JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT (
      activity_kind = 'status_change'
      AND lower(regexp_replace(COALESCE(activity_metadata->>'action', ''), '[[:space:]-]+', '_', 'g')) = 'pipeline_intent'
      AND NULLIF(btrim(COALESCE(activity_metadata->>'intent_source', activity_metadata->>'source')), '') IS NOT NULL
    )
    OR (
      activity_kind = 'call'
      AND lower(regexp_replace(COALESCE(activity_metadata->>'source', ''), '[[:space:]-]+', '_', 'g'))
        IN ('ivr_press_1', 'cold_callback_press_1')
    );
$$;
REVOKE ALL ON FUNCTION public.contact_workspace_activity_is_pipeline_intent(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.contact_workspace_activity_is_relevant(
  activity_kind TEXT,
  activity_description TEXT,
  activity_metadata JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT (
      public.conversation_is_customer_communication(activity_kind, activity_metadata)
      AND NOT public.conversation_is_legacy_team_alert(activity_kind, activity_description, activity_metadata)
    )
    OR public.contact_workspace_activity_is_pipeline_intent(activity_kind, activity_metadata);
$$;
REVOKE ALL ON FUNCTION public.contact_workspace_activity_is_relevant(TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_contact_workspace_activity_state_core(
  target_lead_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  first_outbound TIMESTAMPTZ;
  outbound_attempt BOOLEAN := FALSE;
  connected_call BOOLEAN := FALSE;
  inbound_message BOOLEAN := FALSE;
  latest_intent RECORD;
BEGIN
  IF target_lead_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.leads WHERE id = target_lead_id) THEN
    RETURN;
  END IF;

  SELECT
    min(activity.created_at) FILTER (
      WHERE public.conversation_activity_direction(activity.activity_type, activity.metadata) = 'outbound'
    ),
    COALESCE(bool_or(
      public.conversation_activity_direction(activity.activity_type, activity.metadata) = 'outbound'
    ), FALSE),
    COALESCE(bool_or(public.contact_workspace_call_is_connected(
      activity.activity_type,
      activity.description,
      activity.metadata
    )), FALSE),
    COALESCE(bool_or(
      public.conversation_activity_direction(activity.activity_type, activity.metadata) = 'inbound'
      AND activity.activity_type IN (
        'sms', 'sms_received', 'sms_inbound', 'email', 'email_received'
      )
    ), FALSE)
  INTO first_outbound, outbound_attempt, connected_call, inbound_message
  FROM public.lead_activities AS activity
  WHERE public.conversation_activity_thread_key(
      activity.lead_id,
      activity.id,
      activity.activity_type,
      activity.metadata
    ) = 'lead:' || target_lead_id::TEXT
    AND public.conversation_is_timeline_activity(activity.activity_type, activity.metadata)
    AND NOT public.conversation_is_legacy_team_alert(
      activity.activity_type,
      activity.description,
      activity.metadata
    )
    AND public.conversation_is_customer_communication(activity.activity_type, activity.metadata);

  SELECT activity.activity_type, activity.metadata
  INTO latest_intent
  FROM public.lead_activities AS activity
  WHERE public.conversation_activity_thread_key(
      activity.lead_id,
      activity.id,
      activity.activity_type,
      activity.metadata
    ) = 'lead:' || target_lead_id::TEXT
    AND public.conversation_is_timeline_activity(activity.activity_type, activity.metadata)
    AND NOT public.conversation_is_legacy_team_alert(
      activity.activity_type,
      activity.description,
      activity.metadata
    )
    AND public.contact_workspace_activity_is_pipeline_intent(activity.activity_type, activity.metadata)
  ORDER BY activity.created_at DESC, activity.id DESC
  LIMIT 1;

  INSERT INTO public.contact_workspace_activity_state (
    lead_id,
    first_outbound_at,
    has_outbound_attempt,
    has_connected_call,
    has_inbound_message,
    pipeline_intent_activity_type,
    pipeline_intent_metadata,
    updated_at
  ) VALUES (
    target_lead_id,
    first_outbound,
    outbound_attempt,
    connected_call,
    inbound_message,
    latest_intent.activity_type,
    latest_intent.metadata,
    NOW()
  )
  ON CONFLICT (lead_id) DO UPDATE SET
    first_outbound_at = EXCLUDED.first_outbound_at,
    has_outbound_attempt = EXCLUDED.has_outbound_attempt,
    has_connected_call = EXCLUDED.has_connected_call,
    has_inbound_message = EXCLUDED.has_inbound_message,
    pipeline_intent_activity_type = EXCLUDED.pipeline_intent_activity_type,
    pipeline_intent_metadata = EXCLUDED.pipeline_intent_metadata,
    updated_at = NOW();
END
$$;
REVOKE ALL ON FUNCTION public.refresh_contact_workspace_activity_state_core(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_contact_workspace_activity_state(
  target_lead_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF target_lead_id IS NULL THEN RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('contact_workspace_activity_state:backfill', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('contact_workspace_activity_state:' || target_lead_id::TEXT, 0)
  );
  PERFORM public.refresh_contact_workspace_activity_state_core(target_lead_id);
END
$$;
REVOKE ALL ON FUNCTION public.refresh_contact_workspace_activity_state(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trigger_refresh_contact_workspace_activity_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected UUID[] := ARRAY[]::UUID[];
  target_lead_id UUID;
BEGIN
  IF TG_OP <> 'INSERT'
    AND OLD.lead_id IS NOT NULL
    AND public.contact_workspace_activity_is_relevant(OLD.activity_type, OLD.description, OLD.metadata) THEN
    affected := array_append(affected, OLD.lead_id);
  END IF;
  IF TG_OP <> 'DELETE'
    AND NEW.lead_id IS NOT NULL
    AND public.contact_workspace_activity_is_relevant(NEW.activity_type, NEW.description, NEW.metadata) THEN
    affected := array_append(affected, NEW.lead_id);
  END IF;

  SELECT array_agg(DISTINCT affected_id ORDER BY affected_id)
  INTO affected
  FROM unnest(affected) AS affected_id;

  FOREACH target_lead_id IN ARRAY COALESCE(affected, ARRAY[]::UUID[]) LOOP
    PERFORM public.refresh_contact_workspace_activity_state(target_lead_id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END
$$;
REVOKE ALL ON FUNCTION public.trigger_refresh_contact_workspace_activity_state()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trigger_refresh_contact_workspace_activity_state ON public.lead_activities;
CREATE TRIGGER trigger_refresh_contact_workspace_activity_state
AFTER INSERT OR DELETE OR UPDATE OF lead_id, activity_type, description, metadata, created_at
ON public.lead_activities
FOR EACH ROW EXECUTE FUNCTION public.trigger_refresh_contact_workspace_activity_state();

DO $$
DECLARE
  lead RECORD;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('contact_workspace_activity_state:backfill', 0)
  );
  FOR lead IN SELECT id FROM public.leads ORDER BY id LOOP
    PERFORM public.refresh_contact_workspace_activity_state_core(lead.id);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.contact_workspace_activity_summary_v1(
  target_lead_ids UUID[]
)
RETURNS TABLE (
  lead_id UUID,
  attention_state TEXT,
  owner TEXT,
  last_channel TEXT,
  last_direction TEXT,
  last_communication_id UUID,
  last_communication_type TEXT,
  last_communication_description TEXT,
  last_communication_agent TEXT,
  last_communication_metadata JSONB,
  last_communication_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  primary_next_action_id UUID,
  primary_next_action_title TEXT,
  primary_next_action_due_at TIMESTAMPTZ,
  primary_next_action_owner TEXT,
  first_outbound_at TIMESTAMPTZ,
  has_outbound_attempt BOOLEAN,
  has_connected_call BOOLEAN,
  has_inbound_message BOOLEAN,
  pipeline_intent_activity_type TEXT,
  pipeline_intent_metadata JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(cardinality(target_lead_ids), 0) > 1000 THEN
    RAISE EXCEPTION 'contact workspace summary accepts at most 1000 lead ids';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT DISTINCT requested_id AS lead_id
    FROM unnest(COALESCE(target_lead_ids, ARRAY[]::UUID[])) AS requested_id
    WHERE requested_id IS NOT NULL
  )
  SELECT
    requested.lead_id,
    thread.attention_state,
    thread.owner,
    thread.last_channel,
    thread.last_direction,
    thread.last_communication_id,
    thread.last_communication_type,
    thread.last_communication_description,
    thread.last_communication_agent,
    COALESCE(thread.last_communication_metadata, '{}'::JSONB),
    thread.last_communication_at,
    thread.last_activity_at,
    thread.primary_next_action_id,
    thread.primary_next_action_title,
    thread.primary_next_action_due_at,
    thread.primary_next_action_owner,
    activity_state.first_outbound_at,
    COALESCE(activity_state.has_outbound_attempt, FALSE),
    COALESCE(activity_state.has_connected_call, FALSE),
    COALESCE(activity_state.has_inbound_message, FALSE),
    activity_state.pipeline_intent_activity_type,
    activity_state.pipeline_intent_metadata
  FROM requested
  LEFT JOIN public.conversation_thread_state AS thread
    ON thread.lead_id = requested.lead_id
  LEFT JOIN public.contact_workspace_activity_state AS activity_state
    ON activity_state.lead_id = requested.lead_id;
END
$$;

REVOKE ALL ON FUNCTION public.contact_workspace_activity_summary_v1(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_workspace_activity_summary_v1(UUID[])
  TO service_role;

COMMENT ON TABLE public.contact_workspace_activity_state IS
  'Incremental one-row-per-lead outreach and pipeline-intent projection for the Contacts workspace.';
COMMENT ON FUNCTION public.contact_workspace_activity_summary_v1(UUID[]) IS
  'Returns one bounded Contacts summary per requested lead without scanning activity history at request time.';
