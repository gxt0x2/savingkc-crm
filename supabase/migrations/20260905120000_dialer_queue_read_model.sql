-- Bounded read model for the Mojo-style dialer queue.
--
-- leads and lead_activities remain the source of truth. This additive table
-- stores only the compact, rebuildable context needed to rank a dialer batch.

CREATE TABLE IF NOT EXISTS public.dialer_queue_state (
  lead_id UUID PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  last_contact_at TIMESTAMPTZ,
  last_dialed_at TIMESTAMPTZ,
  call_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (call_attempt_count >= 0),
  pending_followup_dates DATE[] NOT NULL DEFAULT ARRAY[]::DATE[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.dialer_queue_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dialer_queue_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.dialer_queue_state TO service_role;

CREATE INDEX IF NOT EXISTS idx_dialer_queue_state_last_contact
  ON public.dialer_queue_state(last_contact_at, lead_id);
CREATE INDEX IF NOT EXISTS idx_dialer_queue_state_last_dialed
  ON public.dialer_queue_state(last_dialed_at, lead_id);
CREATE INDEX IF NOT EXISTS idx_dialer_queue_contact_activity
  ON public.lead_activities(lead_id, created_at DESC, id DESC)
  WHERE activity_type IN (
    'call', 'voicemail', 'sms', 'sms_sent', 'sms_received', 'sms_inbound'
  );
CREATE INDEX IF NOT EXISTS idx_dialer_queue_daily_calls
  ON public.lead_activities(created_at, lead_id)
  WHERE activity_type IN ('call', 'voicemail');
CREATE INDEX IF NOT EXISTS idx_dialer_queue_followups
  ON public.lead_activities(lead_id, created_at DESC, id DESC)
  WHERE activity_type IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer');
CREATE INDEX IF NOT EXISTS idx_dialer_queue_prospects_lead
  ON public.prospects(lead_id)
  WHERE lead_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.dialer_queue_followup_date(activity_metadata JSONB)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  raw_value TEXT := NULLIF(btrim(COALESCE(activity_metadata->>'due_date', '')), '');
BEGIN
  IF raw_value IS NULL THEN RETURN NULL; END IF;
  IF raw_value ~ '^\d{4}-\d{2}-\d{2}' THEN
    RETURN substring(raw_value FROM 1 FOR 10)::DATE;
  END IF;
  RETURN (raw_value::TIMESTAMPTZ AT TIME ZONE 'America/Chicago')::DATE;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.dialer_queue_followup_date(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_dialer_queue_state_core(target_lead_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  newest_contact TIMESTAMPTZ;
  newest_dial TIMESTAMPTZ;
  attempt_count INTEGER := 0;
  followup_dates DATE[] := ARRAY[]::DATE[];
BEGIN
  IF target_lead_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.leads WHERE id = target_lead_id
  ) THEN
    -- hygiene-approved-destructive: remove only a rebuildable projection row
    -- after its durable lead source has been deleted.
    DELETE FROM public.dialer_queue_state WHERE lead_id = target_lead_id;
    RETURN;
  END IF;

  SELECT
    max(activity.created_at) FILTER (
      WHERE activity.activity_type IN (
        'call', 'voicemail', 'sms', 'sms_sent', 'sms_received', 'sms_inbound'
      )
        AND public.conversation_is_customer_communication(activity.activity_type, activity.metadata)
        AND NOT public.conversation_is_legacy_team_alert(
          activity.activity_type, activity.description, activity.metadata
        )
    ),
    max(activity.created_at) FILTER (
      WHERE activity.activity_type IN ('call', 'voicemail')
        AND public.conversation_is_customer_communication(activity.activity_type, activity.metadata)
    ),
    count(*) FILTER (
      WHERE activity.activity_type IN ('call', 'voicemail')
        AND public.conversation_is_customer_communication(activity.activity_type, activity.metadata)
    )::INTEGER,
    COALESCE(array_agg(DISTINCT public.dialer_queue_followup_date(activity.metadata)
      ORDER BY public.dialer_queue_followup_date(activity.metadata)) FILTER (
        WHERE activity.activity_type IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer')
          AND lower(COALESCE(activity.metadata->>'status', 'pending'))
            NOT IN ('completed', 'cancelled', 'canceled')
          AND public.dialer_queue_followup_date(activity.metadata) IS NOT NULL
      ), ARRAY[]::DATE[])
  INTO newest_contact, newest_dial, attempt_count, followup_dates
  FROM public.lead_activities AS activity
  WHERE activity.lead_id = target_lead_id
    AND activity.activity_type IN (
      'call', 'voicemail', 'sms', 'sms_sent', 'sms_received', 'sms_inbound',
      'task', 'appointment', 'follow_up', 'callback', 'send_offer'
    );

  INSERT INTO public.dialer_queue_state (
    lead_id, last_contact_at, last_dialed_at, call_attempt_count,
    pending_followup_dates, updated_at
  ) VALUES (
    target_lead_id, newest_contact, newest_dial, COALESCE(attempt_count, 0),
    COALESCE(followup_dates, ARRAY[]::DATE[]), NOW()
  )
  ON CONFLICT (lead_id) DO UPDATE SET
    last_contact_at = EXCLUDED.last_contact_at,
    last_dialed_at = EXCLUDED.last_dialed_at,
    call_attempt_count = EXCLUDED.call_attempt_count,
    pending_followup_dates = EXCLUDED.pending_followup_dates,
    updated_at = NOW();
END
$$;
REVOKE ALL ON FUNCTION public.refresh_dialer_queue_state_core(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_dialer_queue_state(target_lead_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF target_lead_id IS NULL THEN RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('dialer_queue_state:backfill', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dialer_queue_state:' || target_lead_id::TEXT, 0)
  );
  PERFORM public.refresh_dialer_queue_state_core(target_lead_id);
END
$$;
REVOKE ALL ON FUNCTION public.refresh_dialer_queue_state(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trigger_refresh_dialer_queue_state()
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
    AND OLD.activity_type IN (
      'call', 'voicemail', 'sms', 'sms_sent', 'sms_received', 'sms_inbound',
      'task', 'appointment', 'follow_up', 'callback', 'send_offer'
    ) THEN
    affected := array_append(affected, OLD.lead_id);
  END IF;
  IF TG_OP <> 'DELETE'
    AND NEW.lead_id IS NOT NULL
    AND NEW.activity_type IN (
      'call', 'voicemail', 'sms', 'sms_sent', 'sms_received', 'sms_inbound',
      'task', 'appointment', 'follow_up', 'callback', 'send_offer'
    ) THEN
    affected := array_append(affected, NEW.lead_id);
  END IF;

  SELECT array_agg(DISTINCT affected_id ORDER BY affected_id)
  INTO affected
  FROM unnest(affected) AS affected_id;

  FOREACH target_lead_id IN ARRAY COALESCE(affected, ARRAY[]::UUID[]) LOOP
    PERFORM public.refresh_dialer_queue_state(target_lead_id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END
$$;
REVOKE ALL ON FUNCTION public.trigger_refresh_dialer_queue_state()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trigger_refresh_dialer_queue_state ON public.lead_activities;
CREATE TRIGGER trigger_refresh_dialer_queue_state
AFTER INSERT OR DELETE OR UPDATE OF lead_id, activity_type, description, metadata, created_at
ON public.lead_activities
FOR EACH ROW
EXECUTE FUNCTION public.trigger_refresh_dialer_queue_state();

DO $$
DECLARE
  lead RECORD;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dialer_queue_state:backfill', 0)
  );
  FOR lead IN SELECT id FROM public.leads ORDER BY id LOOP
    PERFORM public.refresh_dialer_queue_state_core(lead.id);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.dialer_queue_page_v1(
  target_limit INTEGER,
  target_lead_ids UUID[],
  reference_time TIMESTAMPTZ
)
RETURNS TABLE (
  leads JSONB,
  queue_context JSONB,
  prospects JSONB,
  queue_metrics JSONB,
  total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH settings AS (
    SELECT
      LEAST(GREATEST(COALESCE(target_limit, 1000), 1), 1000) AS capped_limit,
      (COALESCE(reference_time, NOW()) AT TIME ZONE 'America/Chicago')::DATE AS central_today,
      date_trunc('day', COALESCE(reference_time, NOW()) AT TIME ZONE 'America/Chicago')
        AT TIME ZONE 'America/Chicago' AS central_day_start
  ), eligible AS MATERIALIZED (
    SELECT
      lead.id, lead.full_name, lead.phone, lead.email, lead.property_address,
      lead.city, lead.state, lead.zip, lead.county, lead.is_favorite,
      lead.source, lead.station, lead.classification, lead.priority,
      lead.seller_situation, lead.motivation_score, lead.appointment_date,
      lead.created_at, lead.updated_at,
      state.last_contact_at, state.last_dialed_at,
      COALESCE(state.call_attempt_count, 0) AS call_attempt_count,
      COALESCE(state.pending_followup_dates, ARRAY[]::DATE[]) AS pending_followup_dates
    FROM public.leads AS lead
    LEFT JOIN public.dialer_queue_state AS state ON state.lead_id = lead.id
    WHERE lead.phone IS NOT NULL
      AND public.normalize_conversation_phone(lead.phone) IS NOT NULL
      AND lower(COALESCE(lead.station, '')) NOT IN ('dead', 'closed_lost')
      AND lower(COALESCE(lead.classification, '')) <> 'dead'
      AND (
        COALESCE(cardinality(target_lead_ids), 0) = 0
        OR lead.id = ANY(target_lead_ids)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.sms_opt_outs AS opt_out
        WHERE opt_out.is_opted_out = TRUE
          AND public.normalize_conversation_phone(opt_out.phone)
            = public.normalize_conversation_phone(lead.phone)
      )
  ), ranked AS MATERIALIZED (
    SELECT eligible.*
    FROM eligible, settings
    ORDER BY
      (settings.central_today = ANY(eligible.pending_followup_dates)) DESC,
      (EXISTS (
        SELECT 1 FROM unnest(eligible.pending_followup_dates) AS due_date
        WHERE due_date <= settings.central_today
      )) DESC,
      CASE lower(COALESCE(eligible.priority, ''))
        WHEN 'hot' THEN 0 WHEN 'high' THEN 1 ELSE 2 END ASC,
      COALESCE(eligible.motivation_score, 0) DESC,
      eligible.updated_at DESC NULLS LAST,
      eligible.id ASC
    LIMIT (SELECT capped_limit FROM settings)
  ), daily_calls AS MATERIALIZED (
    SELECT activity.lead_id, count(*)::INTEGER AS call_count
    FROM public.lead_activities AS activity, settings
    WHERE activity.lead_id IN (SELECT id FROM ranked)
      AND activity.activity_type IN ('call', 'voicemail')
      AND activity.created_at >= settings.central_day_start
      AND activity.created_at < settings.central_day_start + INTERVAL '1 day'
      AND public.conversation_is_customer_communication(activity.activity_type, activity.metadata)
    GROUP BY activity.lead_id
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', row.id, 'full_name', row.full_name, 'phone', row.phone,
      'email', row.email, 'property_address', row.property_address,
      'city', row.city, 'state', row.state, 'zip', row.zip, 'county', row.county,
      'is_favorite', row.is_favorite, 'source', row.source,
      'station', row.station, 'classification', row.classification,
      'priority', row.priority, 'seller_situation', row.seller_situation,
      'motivation_score', row.motivation_score, 'appointment_date', row.appointment_date,
      'created_at', row.created_at, 'updated_at', row.updated_at
    ) ORDER BY row.id) FROM ranked AS row), '[]'::JSONB),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'leadId', row.id,
      'lastContactAt', row.last_contact_at,
      'lastDialedAt', row.last_dialed_at,
      'callAttemptCount', row.call_attempt_count,
      'hasDueFollowup', EXISTS (
        SELECT 1 FROM settings, unnest(row.pending_followup_dates) AS due_date
        WHERE due_date <= settings.central_today
      ),
      'scheduledToday', (SELECT central_today FROM settings) = ANY(row.pending_followup_dates)
    ) ORDER BY row.id) FROM ranked AS row), '[]'::JSONB),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'lead_id', prospect.lead_id,
      'delinquent_years_category', prospect.delinquent_years_category,
      'is_deceased', prospect.is_deceased
    ) ORDER BY prospect.lead_id, prospect.id)
      FROM public.prospects AS prospect
      WHERE prospect.lead_id IN (SELECT id FROM ranked)), '[]'::JSONB),
    jsonb_build_object(
      'callsToday', COALESCE((SELECT sum(call_count) FROM daily_calls), 0),
      'uniqueLeadsToday', (SELECT count(*) FROM daily_calls)
    ),
    (SELECT count(*) FROM eligible);
$$;

REVOKE ALL ON FUNCTION public.dialer_queue_page_v1(INTEGER, UUID[], TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_queue_page_v1(INTEGER, UUID[], TIMESTAMPTZ)
  TO service_role;

COMMENT ON TABLE public.dialer_queue_state IS
  'Rebuildable one-row-per-lead context projection for bounded dialer queue reads.';
COMMENT ON FUNCTION public.dialer_queue_page_v1(INTEGER, UUID[], TIMESTAMPTZ) IS
  'Returns at most 1000 policy-eligible dialer leads without request-time history or global suppression scans.';
