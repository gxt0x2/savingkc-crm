-- Conversations V2 bounded read model.
--
-- lead_activities remains the immutable source of truth. This projection is a
-- non-destructive, rebuildable index for inbox pages, server-owned queues, and
-- deterministic keyset timelines. It intentionally does not replace or mutate
-- any activity writer.
-- Apply this as a controlled production migration: the ordinary expression
-- indexes can briefly lock lead_activities/leads while PostgreSQL builds them.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.normalize_conversation_phone(raw_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH normalized AS (
    SELECT regexp_replace(COALESCE(raw_phone, ''), '[^0-9]', '', 'g') AS digits
  )
  SELECT CASE
    WHEN length(digits) = 10 THEN '+1' || digits
    WHEN length(digits) = 11 AND digits LIKE '1%' THEN '+' || digits
    ELSE NULL
  END
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION public.conversation_activity_direction(
  activity_kind TEXT,
  activity_metadata JSONB
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN (
      activity_kind = 'call'
      AND lower(regexp_replace(COALESCE(activity_metadata->>'outcome', ''), '[[:space:]-]+', '_', 'g')) = 'agent_claimed'
    )
      OR lower(regexp_replace(COALESCE(activity_metadata->>'direction', ''), '[[:space:]-]+', '_', 'g'))
      IN ('outbound_alert', 'internal', 'team_alert')
      OR COALESCE(activity_metadata, '{}'::JSONB) ? 'to_agents'
      OR COALESCE(activity_metadata, '{}'::JSONB) ? 'to_agent_phones'
      OR COALESCE(activity_metadata, '{}'::JSONB) ? 'queue_contract'
      OR lower(COALESCE(activity_metadata->>'is_team', 'false')) = 'true'
      OR lower(COALESCE(activity_metadata->>'is_internal', 'false')) = 'true'
      OR lower(COALESCE(activity_metadata->>'internal', 'false')) = 'true'
      OR lower(COALESCE(activity_metadata->>'internal_alert', 'false')) = 'true'
      OR lower(COALESCE(activity_metadata->>'team_alert', 'false')) = 'true' THEN NULL
    WHEN activity_kind NOT IN (
      'call', 'missed_call', 'sms', 'sms_sent', 'sms_received', 'sms_inbound',
      'sms_outbound', 'email', 'email_sent', 'email_received', 'voicemail'
    ) THEN NULL
    WHEN lower(regexp_replace(COALESCE(activity_metadata->>'direction', ''), '[[:space:]-]+', '_', 'g'))
      IN ('inbound', 'received', 'in') THEN 'inbound'
    WHEN lower(regexp_replace(COALESCE(activity_metadata->>'direction', ''), '[[:space:]-]+', '_', 'g'))
      IN ('outbound', 'sent', 'out') THEN 'outbound'
    WHEN activity_kind IN ('missed_call', 'sms_received', 'sms_inbound', 'email_received', 'voicemail') THEN 'inbound'
    ELSE 'outbound'
  END;
$$;

CREATE OR REPLACE FUNCTION public.conversation_is_customer_communication(
  activity_kind TEXT,
  activity_metadata JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT activity_kind IN (
      'call', 'missed_call', 'sms', 'sms_sent', 'sms_received', 'sms_inbound',
      'sms_outbound', 'email', 'email_sent', 'email_received', 'voicemail'
    )
    AND public.conversation_activity_direction(activity_kind, activity_metadata) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.conversation_is_legacy_team_alert(
  activity_kind TEXT,
  activity_description TEXT,
  activity_metadata JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT activity_kind = 'sms'
    AND NULLIF(btrim(COALESCE(activity_metadata->>'direction', '')), '') IS NULL
    AND NOT (
      COALESCE(activity_metadata, '{}'::JSONB) ?| ARRAY[
        'to_agents', 'to_agent_phones', 'queue_contract', 'is_team',
        'is_internal', 'internal', 'internal_alert', 'team_alert'
      ]
    )
    AND COALESCE(activity_description, '') ~*
      'just texted:[[:space:]]*["“].+["”][[:space:]]*—[[:space:]]*(open[[:space:]]+crm|https?://[^[:space:]]+/leads/[^[:space:]]+)[[:space:]]*$';
$$;

CREATE OR REPLACE FUNCTION public.conversation_is_timeline_activity(
  activity_kind TEXT,
  activity_metadata JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT public.conversation_is_customer_communication(activity_kind, activity_metadata)
    OR activity_kind IN ('note', 'agent_note', 'letter_tracking', 'task', 'status_change');
$$;

CREATE OR REPLACE FUNCTION public.conversation_projects_thread(
  activity_kind TEXT,
  activity_metadata JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT public.conversation_is_customer_communication(activity_kind, activity_metadata)
    OR activity_kind IN ('task', 'status_change');
$$;

CREATE OR REPLACE FUNCTION public.conversation_activity_phone(
  activity_kind TEXT,
  activity_metadata JSONB
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT public.normalize_conversation_phone(
    CASE public.conversation_activity_direction(activity_kind, activity_metadata)
      WHEN 'inbound' THEN COALESCE(
        activity_metadata->>'from',
        activity_metadata->>'fromPhone',
        activity_metadata->>'caller',
        activity_metadata->>'phone'
      )
      WHEN 'outbound' THEN COALESCE(
        activity_metadata->>'to',
        activity_metadata->>'toPhone',
        activity_metadata->>'calledNumber',
        activity_metadata->>'phone'
      )
      ELSE COALESCE(
        activity_metadata->>'phone',
        activity_metadata->>'from',
        activity_metadata->>'to'
      )
    END
  );
$$;

CREATE OR REPLACE FUNCTION public.conversation_activity_thread_key(
  activity_lead_id UUID,
  activity_id UUID,
  activity_kind TEXT,
  activity_metadata JSONB
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN activity_lead_id IS NOT NULL THEN 'lead:' || activity_lead_id::TEXT
    WHEN public.conversation_activity_phone(activity_kind, activity_metadata) IS NOT NULL
      THEN 'phone:' || public.conversation_activity_phone(activity_kind, activity_metadata)
    ELSE 'activity:' || activity_id::TEXT
  END;
$$;

CREATE OR REPLACE FUNCTION public.conversation_inbound_needs_reply(
  activity_kind TEXT,
  activity_description TEXT,
  activity_metadata JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  normalized_message TEXT := lower(
    btrim(regexp_replace(COALESCE(activity_description, ''), '[^a-zA-Z[:space:]'']', ' ', 'g'))
  );
  normalized_description TEXT := lower(COALESCE(activity_description, ''));
  outcomes TEXT[] := ARRAY[
    lower(regexp_replace(COALESCE(activity_metadata->>'outcome', ''), '[[:space:]_]+', '-', 'g')),
    lower(regexp_replace(COALESCE(activity_metadata->>'dialStatus', ''), '[[:space:]_]+', '-', 'g')),
    lower(regexp_replace(COALESCE(activity_metadata->>'disposition', ''), '[[:space:]_]+', '-', 'g')),
    lower(regexp_replace(COALESCE(activity_metadata->>'status', ''), '[[:space:]_]+', '-', 'g')),
    lower(regexp_replace(COALESCE(activity_metadata->>'callStatus', ''), '[[:space:]_]+', '-', 'g'))
  ];
BEGIN
  normalized_message := regexp_replace(normalized_message, '[[:space:]]+', ' ', 'g');

  IF activity_kind IN ('voicemail', 'missed_call') THEN
    RETURN TRUE;
  END IF;

  IF activity_kind <> 'call' THEN
    IF activity_kind IN ('sms', 'sms_received', 'sms_inbound') AND (
      normalized_message ~ '^(stop|stopall|unsubscribe|quit|end)$'
      OR normalized_message ~ '(stop calling|stop texting|stop messaging|do not call|don''t call|remove me|take me off)'
    ) THEN
      RETURN FALSE;
    END IF;
    RETURN TRUE;
  END IF;

  IF outcomes && ARRAY['busy', 'canceled', 'cancelled', 'failed', 'missed', 'no-answer', 'not-answered', 'voicemail']
    OR normalized_description ~ '(missed|no[ -]?answer|busy|voicemail|failed|cancel)' THEN
    RETURN TRUE;
  END IF;

  IF NULLIF(btrim(COALESCE(activity_metadata->>'recordingSid', '')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(activity_metadata->>'recordingUrl', '')), '') IS NOT NULL
    OR NULLIF(btrim(COALESCE(activity_metadata->>'recording_url', '')), '') IS NOT NULL
    OR normalized_description ~ 'call recording available' THEN
    RETURN FALSE;
  END IF;

  IF outcomes && ARRAY['answered', 'completed', 'connected', 'spoke-with-owner', 'live']
    OR normalized_description ~ '(connected live|answered|completed call)' THEN
    RETURN FALSE;
  END IF;

  -- Unknown inbound call outcomes stay actionable until an operator resolves them.
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.conversation_safe_timestamptz(raw_value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  IF NULLIF(btrim(raw_value), '') IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN raw_value::TIMESTAMPTZ;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS public.conversation_thread_state (
  thread_key TEXT PRIMARY KEY,
  lead_id UUID,
  phone TEXT,
  attention_state TEXT NOT NULL DEFAULT 'resolved',
  attention_rank SMALLINT GENERATED ALWAYS AS (
    CASE attention_state
      WHEN 'needs_reply' THEN 0
      WHEN 'waiting_on_contact' THEN 1
      ELSE 2
    END
  ) STORED,
  owner TEXT,
  last_channel TEXT,
  last_direction TEXT,
  last_communication_id UUID,
  last_communication_type TEXT,
  last_communication_description TEXT,
  last_communication_agent TEXT,
  last_communication_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_communication_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  primary_next_action_id UUID,
  primary_next_action_title TEXT,
  primary_next_action_due_at TIMESTAMPTZ,
  primary_next_action_owner TEXT,
  search_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep the migration additive if an environment already created the registry's
-- canonical table name ahead of this release.
ALTER TABLE public.conversation_thread_state
  ADD COLUMN IF NOT EXISTS thread_key TEXT,
  ADD COLUMN IF NOT EXISTS lead_id UUID,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS attention_state TEXT NOT NULL DEFAULT 'resolved',
  ADD COLUMN IF NOT EXISTS owner TEXT,
  ADD COLUMN IF NOT EXISTS last_channel TEXT,
  ADD COLUMN IF NOT EXISTS last_direction TEXT,
  ADD COLUMN IF NOT EXISTS last_communication_id UUID,
  ADD COLUMN IF NOT EXISTS last_communication_type TEXT,
  ADD COLUMN IF NOT EXISTS last_communication_description TEXT,
  ADD COLUMN IF NOT EXISTS last_communication_agent TEXT,
  ADD COLUMN IF NOT EXISTS last_communication_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS last_communication_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS primary_next_action_id UUID,
  ADD COLUMN IF NOT EXISTS primary_next_action_title TEXT,
  ADD COLUMN IF NOT EXISTS primary_next_action_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS primary_next_action_owner TEXT,
  ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Fail closed before indexes/backfill make this table visible for a prolonged
-- migration window. Only service-role server reads may access the projection.
ALTER TABLE public.conversation_thread_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.conversation_thread_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversation_thread_state TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_thread_state_key
  ON public.conversation_thread_state(thread_key);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversation_thread_state'
      AND column_name = 'attention_rank'
  ) THEN
    ALTER TABLE public.conversation_thread_state
      ADD COLUMN attention_rank SMALLINT GENERATED ALWAYS AS (
        CASE attention_state
          WHEN 'needs_reply' THEN 0
          WHEN 'waiting_on_contact' THEN 1
          ELSE 2
        END
      ) STORED;
  END IF;
END
$$;

ALTER TABLE public.conversation_thread_state DROP CONSTRAINT IF EXISTS conversation_thread_state_attention_check;
ALTER TABLE public.conversation_thread_state
  ADD CONSTRAINT conversation_thread_state_attention_check
  CHECK (attention_state IN ('needs_reply', 'waiting_on_contact', 'resolved')) NOT VALID;

ALTER TABLE public.conversation_thread_state DROP CONSTRAINT IF EXISTS conversation_thread_state_channel_check;
ALTER TABLE public.conversation_thread_state
  ADD CONSTRAINT conversation_thread_state_channel_check
  CHECK (last_channel IS NULL OR last_channel IN ('call', 'sms', 'email', 'voicemail')) NOT VALID;

ALTER TABLE public.conversation_thread_state DROP CONSTRAINT IF EXISTS conversation_thread_state_direction_check;
ALTER TABLE public.conversation_thread_state
  ADD CONSTRAINT conversation_thread_state_direction_check
  CHECK (last_direction IS NULL OR last_direction IN ('inbound', 'outbound')) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_conversation_activity_thread_timeline
  ON public.lead_activities (
    public.conversation_activity_thread_key(lead_id, id, activity_type, metadata),
    created_at DESC,
    id DESC
  )
  WHERE public.conversation_is_timeline_activity(activity_type, metadata)
    AND NOT public.conversation_is_legacy_team_alert(activity_type, description, metadata);

CREATE INDEX IF NOT EXISTS idx_conversation_thread_state_inbox
  ON public.conversation_thread_state(attention_rank, last_activity_at DESC, thread_key DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_thread_state_needs_reply
  ON public.conversation_thread_state(attention_rank, last_activity_at DESC, thread_key DESC)
  WHERE attention_state = 'needs_reply';
CREATE INDEX IF NOT EXISTS idx_conversation_thread_state_channel
  ON public.conversation_thread_state(last_channel, attention_rank, last_activity_at DESC, thread_key DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_thread_state_owner
  ON public.conversation_thread_state(lower(owner), attention_rank, last_activity_at DESC, thread_key DESC)
  WHERE owner IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_thread_state_unassigned
  ON public.conversation_thread_state(attention_rank, last_activity_at DESC, thread_key DESC)
  WHERE owner IS NULL OR btrim(owner) = '';
CREATE INDEX IF NOT EXISTS idx_conversation_thread_state_overdue
  ON public.conversation_thread_state(primary_next_action_due_at)
  WHERE primary_next_action_due_at IS NOT NULL;
DO $$
DECLARE
  trgm_schema TEXT;
BEGIN
  SELECT namespace.nspname
  INTO trgm_schema
  FROM pg_extension AS extension
  JOIN pg_namespace AS namespace ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pg_trgm';
  IF trgm_schema IS NULL THEN
    RAISE EXCEPTION 'pg_trgm extension is required for conversation search';
  END IF;
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_conversation_thread_state_search ON public.conversation_thread_state USING gin (search_text %I.gin_trgm_ops)',
    trgm_schema
  );
END
$$;
CREATE INDEX IF NOT EXISTS idx_conversation_thread_state_phone
  ON public.conversation_thread_state(phone)
  WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_opt_outs_conversation_phone_active
  ON public.sms_opt_outs(public.normalize_conversation_phone(phone))
  WHERE is_opted_out = TRUE;
CREATE INDEX IF NOT EXISTS idx_leads_conversation_phone
  ON public.leads(public.normalize_conversation_phone(phone))
  WHERE public.normalize_conversation_phone(phone) IS NOT NULL;

CREATE OR REPLACE FUNCTION public.refresh_conversation_thread_state_core(target_thread_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  latest_communication RECORD;
  latest_activity RECORD;
  latest_hub_state RECORD;
  intake_state RECORD;
  primary_action RECORD;
  lead_full_name TEXT;
  lead_phone TEXT;
  lead_email TEXT;
  lead_property_address TEXT;
  lead_city TEXT;
  lead_county TEXT;
  lead_assigned_agent TEXT;
  resolved_attention TEXT := 'resolved';
  resolved_direction TEXT;
  resolved_channel TEXT;
  resolved_owner TEXT;
  resolved_phone TEXT;
  resolved_search TEXT;
  resolved_sms_opted_out BOOLEAN := FALSE;
BEGIN
  SELECT activity.*
  INTO latest_communication
  FROM public.lead_activities AS activity
  WHERE public.conversation_activity_thread_key(
      activity.lead_id,
      activity.id,
      activity.activity_type,
      activity.metadata
    ) = target_thread_key
    AND public.conversation_is_timeline_activity(activity.activity_type, activity.metadata)
    AND NOT public.conversation_is_legacy_team_alert(activity.activity_type, activity.description, activity.metadata)
    AND public.conversation_is_customer_communication(activity.activity_type, activity.metadata)
  ORDER BY activity.created_at DESC, activity.id DESC
  LIMIT 1;

  IF latest_communication.id IS NULL THEN
    -- hygiene-approved-destructive: remove only a rebuildable projection row
    -- after its source thread has no communication; lead_activities is untouched.
    DELETE FROM public.conversation_thread_state AS thread
    WHERE thread.thread_key = target_thread_key;
    RETURN;
  END IF;

  SELECT activity.*
  INTO latest_activity
  FROM public.lead_activities AS activity
  WHERE public.conversation_activity_thread_key(
      activity.lead_id,
      activity.id,
      activity.activity_type,
      activity.metadata
    ) = target_thread_key
    AND public.conversation_is_timeline_activity(activity.activity_type, activity.metadata)
    AND NOT public.conversation_is_legacy_team_alert(activity.activity_type, activity.description, activity.metadata)
    AND public.conversation_projects_thread(activity.activity_type, activity.metadata)
  ORDER BY activity.created_at DESC, activity.id DESC
  LIMIT 1;

  SELECT activity.*
  INTO latest_hub_state
  FROM public.lead_activities AS activity
  WHERE public.conversation_activity_thread_key(
      activity.lead_id,
      activity.id,
      activity.activity_type,
      activity.metadata
    ) = target_thread_key
    AND public.conversation_is_timeline_activity(activity.activity_type, activity.metadata)
    AND NOT public.conversation_is_legacy_team_alert(activity.activity_type, activity.description, activity.metadata)
    AND activity.activity_type = 'status_change'
    AND activity.metadata->>'hub_action' IN ('mark_read', 'mark_unread')
  ORDER BY activity.created_at DESC, activity.id DESC
  LIMIT 1;

  SELECT activity.*
  INTO intake_state
  FROM public.lead_activities AS activity
  WHERE public.conversation_activity_thread_key(
      activity.lead_id,
      activity.id,
      activity.activity_type,
      activity.metadata
    ) = target_thread_key
    AND public.conversation_is_timeline_activity(activity.activity_type, activity.metadata)
    AND NOT public.conversation_is_legacy_team_alert(activity.activity_type, activity.description, activity.metadata)
    AND activity.activity_type = 'status_change'
    AND activity.metadata->>'workflow_id' = 'seller-form-intake'
  ORDER BY activity.created_at DESC, activity.id DESC
  LIMIT 1;

  SELECT activity.*
  INTO primary_action
  FROM public.lead_activities AS activity
  WHERE public.conversation_activity_thread_key(
      activity.lead_id,
      activity.id,
      activity.activity_type,
      activity.metadata
    ) = target_thread_key
    AND public.conversation_is_timeline_activity(activity.activity_type, activity.metadata)
    AND NOT public.conversation_is_legacy_team_alert(activity.activity_type, activity.description, activity.metadata)
    AND activity.activity_type = 'task'
    AND activity.metadata->>'primary_next_action' = 'true'
    AND COALESCE(activity.metadata->>'status', 'pending') = 'pending'
  ORDER BY activity.created_at DESC, activity.id DESC
  LIMIT 1;

  IF latest_communication.lead_id IS NOT NULL THEN
    SELECT
      lead.full_name,
      lead.phone,
      lead.email,
      lead.property_address,
      lead.city,
      lead.county,
      lead.assigned_agent
    INTO
      lead_full_name,
      lead_phone,
      lead_email,
      lead_property_address,
      lead_city,
      lead_county,
      lead_assigned_agent
    FROM public.leads AS lead
    WHERE lead.id = latest_communication.lead_id
    LIMIT 1;
  END IF;

  resolved_direction := public.conversation_activity_direction(
    latest_communication.activity_type,
    latest_communication.metadata
  );
  resolved_phone := COALESCE(
    public.normalize_conversation_phone(lead_phone),
    public.conversation_activity_phone(latest_communication.activity_type, latest_communication.metadata)
  );
  IF resolved_phone IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.sms_opt_outs AS opt_out
      WHERE public.normalize_conversation_phone(opt_out.phone) = resolved_phone
        AND opt_out.is_opted_out = TRUE
    ) INTO resolved_sms_opted_out;
  END IF;

  resolved_attention := CASE
    WHEN intake_state.metadata->>'conversation_attention' = 'needs_reply' THEN 'needs_reply'
    ELSE 'resolved'
  END;

  IF resolved_direction = 'outbound' THEN
    resolved_attention := 'waiting_on_contact';
  ELSIF resolved_direction = 'inbound' THEN
    resolved_attention := CASE
      WHEN public.conversation_inbound_needs_reply(
        latest_communication.activity_type,
        latest_communication.description,
        latest_communication.metadata
      ) THEN 'needs_reply'
      ELSE 'resolved'
    END;
  END IF;

  IF latest_hub_state.id IS NOT NULL AND (
    latest_communication.created_at IS NULL
    OR (latest_hub_state.created_at, latest_hub_state.id) >
       (latest_communication.created_at, latest_communication.id)
  ) THEN
    resolved_attention := CASE
      WHEN latest_hub_state.metadata->>'hub_action' = 'mark_unread' THEN 'needs_reply'
      ELSE 'resolved'
    END;
  END IF;

  -- STOP/DNC is compliance-handled, not operator reply work. The opt-out table
  -- is authoritative even when the carrier keyword returned before an activity
  -- row was written.
  IF resolved_sms_opted_out THEN
    resolved_attention := 'resolved';
  END IF;

  resolved_channel := CASE
    WHEN latest_communication.activity_type LIKE 'sms%' THEN 'sms'
    WHEN latest_communication.activity_type LIKE 'email%' THEN 'email'
    WHEN latest_communication.activity_type = 'voicemail' THEN 'voicemail'
    ELSE 'call'
  END;

  resolved_owner := COALESCE(
    NULLIF(btrim(lead_assigned_agent), ''),
    NULLIF(btrim(primary_action.metadata->>'assigned_to'), ''),
    NULLIF(btrim(intake_state.metadata->>'owner_name'), '')
  );

  resolved_search := lower(concat_ws(' ',
    target_thread_key,
    latest_communication.lead_id,
    lead_full_name,
    lead_phone,
    resolved_phone,
    lead_email,
    lead_property_address,
    lead_city,
    lead_county,
    latest_communication.description
  ));

  INSERT INTO public.conversation_thread_state (
    thread_key,
    lead_id,
    phone,
    attention_state,
    owner,
    last_channel,
    last_direction,
    last_communication_id,
    last_communication_type,
    last_communication_description,
    last_communication_agent,
    last_communication_metadata,
    last_communication_at,
    last_activity_at,
    primary_next_action_id,
    primary_next_action_title,
    primary_next_action_due_at,
    primary_next_action_owner,
    search_text,
    updated_at
  ) VALUES (
    target_thread_key,
    latest_communication.lead_id,
    resolved_phone,
    resolved_attention,
    resolved_owner,
    resolved_channel,
    resolved_direction,
    latest_communication.id,
    latest_communication.activity_type,
    latest_communication.description,
    latest_communication.agent,
    COALESCE(latest_communication.metadata, '{}'::JSONB),
    latest_communication.created_at,
    COALESCE(latest_activity.created_at, latest_communication.created_at, NOW()),
    primary_action.id,
    primary_action.description,
    public.conversation_safe_timestamptz(primary_action.metadata->>'due_date'),
    NULLIF(btrim(primary_action.metadata->>'assigned_to'), ''),
    resolved_search,
    NOW()
  )
  ON CONFLICT (thread_key) DO UPDATE SET
    lead_id = EXCLUDED.lead_id,
    phone = EXCLUDED.phone,
    attention_state = EXCLUDED.attention_state,
    owner = EXCLUDED.owner,
    last_channel = EXCLUDED.last_channel,
    last_direction = EXCLUDED.last_direction,
    last_communication_id = EXCLUDED.last_communication_id,
    last_communication_type = EXCLUDED.last_communication_type,
    last_communication_description = EXCLUDED.last_communication_description,
    last_communication_agent = EXCLUDED.last_communication_agent,
    last_communication_metadata = EXCLUDED.last_communication_metadata,
    last_communication_at = EXCLUDED.last_communication_at,
    last_activity_at = EXCLUDED.last_activity_at,
    primary_next_action_id = EXCLUDED.primary_next_action_id,
    primary_next_action_title = EXCLUDED.primary_next_action_title,
    primary_next_action_due_at = EXCLUDED.primary_next_action_due_at,
    primary_next_action_owner = EXCLUDED.primary_next_action_owner,
    search_text = EXCLUDED.search_text,
    updated_at = NOW();
END;
$$;

-- The lock-free core is migration/wrapper internals only.
REVOKE ALL ON FUNCTION public.refresh_conversation_thread_state_core(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

-- Runtime writers take a shared deployment gate plus the logical thread lock.
-- The shared gate lets the one-time backfill pause every trigger refresh while
-- using the lock-free core, without accumulating one xact lock per thread.
CREATE OR REPLACE FUNCTION public.refresh_conversation_thread_state(target_thread_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('conversation_thread_state:backfill', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_thread_key, 0)
  );
  PERFORM public.refresh_conversation_thread_state_core(target_thread_key);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_conversation_thread_state(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_conversation_thread_state_from_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_thread_key TEXT;
  new_thread_key TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_thread_key := public.conversation_activity_thread_key(
      OLD.lead_id,
      OLD.id,
      OLD.activity_type,
      OLD.metadata
    );
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_thread_key := public.conversation_activity_thread_key(
      NEW.lead_id,
      NEW.id,
      NEW.activity_type,
      NEW.metadata
    );
  END IF;

  IF old_thread_key IS NOT NULL THEN
    PERFORM public.refresh_conversation_thread_state(old_thread_key);
  END IF;
  IF new_thread_key IS NOT NULL AND new_thread_key IS DISTINCT FROM old_thread_key THEN
    PERFORM public.refresh_conversation_thread_state(new_thread_key);
  ELSIF TG_OP = 'INSERT' AND new_thread_key IS NOT NULL THEN
    PERFORM public.refresh_conversation_thread_state(new_thread_key);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_conversation_thread_state_from_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.refresh_conversation_thread_state('lead:' || NEW.id::TEXT);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_conversation_thread_state_from_sms_opt_out()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  resolved_phone TEXT;
  target_thread_key TEXT;
BEGIN
  IF NEW.is_opted_out IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;
  resolved_phone := public.normalize_conversation_phone(NEW.phone);
  IF resolved_phone IS NULL THEN
    RETURN NEW;
  END IF;

  -- Reuse the serialized full refresh so an opt-out cannot race an activity
  -- trigger and later be overwritten by stale attention state. Include keys
  -- that do not have a projection yet so first-contact opt-outs also serialize.
  FOR target_thread_key IN
    SELECT DISTINCT candidate.thread_key
    FROM (
      SELECT 'phone:' || resolved_phone AS thread_key
      UNION ALL
      SELECT 'lead:' || lead.id::TEXT AS thread_key
      FROM public.leads AS lead
      WHERE public.normalize_conversation_phone(lead.phone) = resolved_phone
      UNION ALL
      SELECT thread.thread_key
      FROM public.conversation_thread_state AS thread
      WHERE thread.phone = resolved_phone
    ) AS candidate
    ORDER BY candidate.thread_key
  LOOP
    PERFORM public.refresh_conversation_thread_state(target_thread_key);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_conversation_thread_state_activity ON public.lead_activities;
DROP TRIGGER IF EXISTS trigger_sync_conversation_thread_state_activity_insert ON public.lead_activities;
DROP TRIGGER IF EXISTS trigger_sync_conversation_thread_state_activity_update ON public.lead_activities;
DROP TRIGGER IF EXISTS trigger_sync_conversation_thread_state_activity_delete ON public.lead_activities;
CREATE TRIGGER trigger_sync_conversation_thread_state_activity_insert
  AFTER INSERT
  ON public.lead_activities
  FOR EACH ROW
  WHEN (
    public.conversation_projects_thread(NEW.activity_type, NEW.metadata)
    AND NOT public.conversation_is_legacy_team_alert(NEW.activity_type, NEW.description, NEW.metadata)
  )
  EXECUTE FUNCTION public.sync_conversation_thread_state_from_activity();
CREATE TRIGGER trigger_sync_conversation_thread_state_activity_update
  AFTER UPDATE OF lead_id, activity_type, description, metadata, created_at
  ON public.lead_activities
  FOR EACH ROW
  WHEN (
    (
      public.conversation_projects_thread(OLD.activity_type, OLD.metadata)
      AND NOT public.conversation_is_legacy_team_alert(OLD.activity_type, OLD.description, OLD.metadata)
    )
    OR (
      public.conversation_projects_thread(NEW.activity_type, NEW.metadata)
      AND NOT public.conversation_is_legacy_team_alert(NEW.activity_type, NEW.description, NEW.metadata)
    )
  )
  EXECUTE FUNCTION public.sync_conversation_thread_state_from_activity();
CREATE TRIGGER trigger_sync_conversation_thread_state_activity_delete
  AFTER DELETE
  ON public.lead_activities
  FOR EACH ROW
  WHEN (
    public.conversation_projects_thread(OLD.activity_type, OLD.metadata)
    AND NOT public.conversation_is_legacy_team_alert(OLD.activity_type, OLD.description, OLD.metadata)
  )
  EXECUTE FUNCTION public.sync_conversation_thread_state_from_activity();

DROP TRIGGER IF EXISTS trigger_sync_conversation_thread_state_lead ON public.leads;
CREATE TRIGGER trigger_sync_conversation_thread_state_lead
  AFTER UPDATE OF full_name, phone, email, property_address, city, county, assigned_agent
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_conversation_thread_state_from_lead();

DROP TRIGGER IF EXISTS trigger_sync_conversation_thread_state_sms_opt_out ON public.sms_opt_outs;
CREATE TRIGGER trigger_sync_conversation_thread_state_sms_opt_out
  AFTER INSERT OR UPDATE
  ON public.sms_opt_outs
  FOR EACH ROW
  WHEN (NEW.is_opted_out = TRUE)
  EXECUTE FUNCTION public.sync_conversation_thread_state_from_sms_opt_out();

-- One-time projection backfill. Source rows are never changed or deleted.
-- This remains proportional to existing conversation threads (each discovered
-- thread is refreshed once), so rehearse and schedule it as a controlled apply.
DO $$
DECLARE
  thread RECORD;
BEGIN
  -- Exactly one exclusive gate is retained for this transaction. Runtime
  -- trigger refreshes take the shared form and reconcile after this commits.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('conversation_thread_state:backfill', 0)
  );

  FOR thread IN
    SELECT DISTINCT public.conversation_activity_thread_key(
      activity.lead_id,
      activity.id,
      activity.activity_type,
      activity.metadata
    ) AS thread_key
    FROM public.lead_activities AS activity
    WHERE public.conversation_is_timeline_activity(activity.activity_type, activity.metadata)
      AND NOT public.conversation_is_legacy_team_alert(activity.activity_type, activity.description, activity.metadata)
      AND public.conversation_is_customer_communication(activity.activity_type, activity.metadata)
  LOOP
    PERFORM public.refresh_conversation_thread_state_core(thread.thread_key);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.conversation_thread_page_v1(
  page_limit INTEGER DEFAULT 51,
  page_queue TEXT DEFAULT 'needs_reply',
  page_actor TEXT DEFAULT NULL,
  page_channel TEXT DEFAULT NULL,
  page_query TEXT DEFAULT NULL,
  after_attention_rank SMALLINT DEFAULT NULL,
  after_activity_at TIMESTAMPTZ DEFAULT NULL,
  after_thread_key TEXT DEFAULT NULL
)
RETURNS SETOF public.conversation_thread_state
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT thread.*
  FROM public.conversation_thread_state AS thread
  WHERE (
      page_queue = 'all'
      OR (page_queue = 'needs_reply' AND thread.attention_state = 'needs_reply')
      OR (page_queue = 'mine' AND NULLIF(btrim(page_actor), '') IS NOT NULL AND lower(thread.owner) = lower(page_actor))
      OR (page_queue = 'unassigned' AND NULLIF(btrim(thread.owner), '') IS NULL)
    )
    AND (page_channel IS NULL OR thread.last_channel = page_channel)
    AND (
      NULLIF(btrim(page_query), '') IS NULL
      OR thread.search_text ILIKE '%' || btrim(page_query) || '%'
    )
    AND (
      after_attention_rank IS NULL
      OR thread.attention_rank > after_attention_rank
      OR (
        thread.attention_rank = after_attention_rank
        AND thread.last_activity_at < after_activity_at
      )
      OR (
        thread.attention_rank = after_attention_rank
        AND thread.last_activity_at = after_activity_at
        AND thread.thread_key < after_thread_key
      )
    )
  ORDER BY thread.attention_rank ASC, thread.last_activity_at DESC, thread.thread_key DESC
  LIMIT LEAST(GREATEST(COALESCE(page_limit, 51), 1), 101);
$$;

CREATE OR REPLACE FUNCTION public.conversation_timeline_page_v1(
  target_thread_key TEXT,
  page_limit INTEGER DEFAULT 51,
  before_created_at TIMESTAMPTZ DEFAULT NULL,
  before_activity_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  lead_id UUID,
  activity_type TEXT,
  description TEXT,
  agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    activity.id,
    activity.lead_id,
    activity.activity_type,
    activity.description,
    activity.agent,
    activity.metadata,
    activity.created_at
  FROM public.lead_activities AS activity
  WHERE public.conversation_activity_thread_key(
      activity.lead_id,
      activity.id,
      activity.activity_type,
      activity.metadata
    ) = target_thread_key
    AND public.conversation_is_timeline_activity(activity.activity_type, activity.metadata)
    AND NOT public.conversation_is_legacy_team_alert(activity.activity_type, activity.description, activity.metadata)
    AND (
      before_created_at IS NULL
      OR activity.created_at < before_created_at
      OR (activity.created_at = before_created_at AND activity.id < before_activity_id)
    )
  ORDER BY activity.created_at DESC, activity.id DESC
  LIMIT LEAST(GREATEST(COALESCE(page_limit, 51), 1), 101);
$$;

CREATE OR REPLACE FUNCTION public.conversation_attention_summary_v1()
RETURNS TABLE (
  needs_reply BIGINT,
  calls BIGINT,
  emails BIGINT,
  texts BIGINT,
  overdue BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT count(*) FROM public.conversation_thread_state WHERE attention_state = 'needs_reply'),
    (SELECT count(*) FROM public.conversation_thread_state WHERE attention_state = 'needs_reply' AND last_channel IN ('call', 'voicemail')),
    (SELECT count(*) FROM public.conversation_thread_state WHERE attention_state = 'needs_reply' AND last_channel = 'email'),
    (SELECT count(*) FROM public.conversation_thread_state WHERE attention_state = 'needs_reply' AND last_channel = 'sms'),
    (SELECT count(*) FROM public.conversation_thread_state WHERE primary_next_action_due_at < NOW());
$$;

REVOKE ALL ON FUNCTION public.normalize_conversation_phone(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversation_activity_direction(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversation_is_customer_communication(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversation_is_legacy_team_alert(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversation_is_timeline_activity(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversation_projects_thread(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversation_activity_phone(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversation_activity_thread_key(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversation_inbound_needs_reply(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversation_safe_timestamptz(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_conversation_thread_state_from_activity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_conversation_thread_state_from_lead() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_conversation_thread_state_from_sms_opt_out() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversation_thread_page_v1(INTEGER, TEXT, TEXT, TEXT, TEXT, SMALLINT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversation_timeline_page_v1(TEXT, INTEGER, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversation_attention_summary_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.normalize_conversation_phone(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_activity_direction(TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_is_customer_communication(TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_is_legacy_team_alert(TEXT, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_is_timeline_activity(TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_projects_thread(TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_activity_phone(TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_activity_thread_key(UUID, UUID, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_inbound_needs_reply(TEXT, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_safe_timestamptz(TEXT) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.conversation_thread_page_v1(INTEGER, TEXT, TEXT, TEXT, TEXT, SMALLINT, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.conversation_timeline_page_v1(TEXT, INTEGER, TIMESTAMPTZ, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.conversation_attention_summary_v1() TO service_role;

COMMENT ON TABLE public.conversation_thread_state IS
  'Rebuildable Conversations V2 projection. lead_activities remains the source of truth.';
COMMENT ON FUNCTION public.conversation_thread_page_v1 IS
  'Indexed keyset page for server-owned conversation queues; maximum 101 rows.';
COMMENT ON FUNCTION public.conversation_timeline_page_v1 IS
  'Indexed deterministic (created_at,id) keyset page for one conversation timeline.';

NOTIFY pgrst, 'reload schema';
