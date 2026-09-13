-- Disposable PostgreSQL support for the Email/CRM bridge integration tests.
--
-- This file deliberately supplies only the production contracts the Email
-- bridge touches. The canonical CRM entity tables and refresh functions are
-- loaded from 20260823120000_crm_entity_foundation.sql by database.mjs; they
-- are not reimplemented here. The conversation projection below is explicitly
-- fixture-scoped because loading the full CRM read model would pull in unrelated
-- calling, SMS opt-out, transaction-coordination, and inbox dependencies.

CREATE OR REPLACE FUNCTION public.normalize_conversation_phone(raw_phone text)
RETURNS text
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

-- Phone begins NOT NULL so the bridge migration must perform its production
-- compatibility change before an email-only Lead can be inserted.
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text,
  phone text NOT NULL,
  email text,
  property_address text,
  city text,
  state text,
  zip text,
  county text,
  parcel_id text,
  property_type text,
  bedrooms integer,
  beds integer,
  bathrooms numeric,
  sqft integer,
  year_built integer,
  source text NOT NULL,
  station text NOT NULL DEFAULT 'new',
  classification text,
  priority text,
  assigned_agent text,
  is_parked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_source_check CHECK (source IN ('manual', 'legacy_partner'))
);

-- Minimal shape consumed by the production canonical entity projection. No
-- SMS behavior is under test in this disposable database.
CREATE TABLE public.sms_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  is_opted_out boolean NOT NULL DEFAULT true,
  reason text,
  opted_out_at timestamptz,
  opted_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  description text,
  agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The work-item tables match the columns used by the production projection.
-- tc_file_id has no fixture foreign key because Email creates activity-backed
-- work only and transaction-coordination tables are outside this test boundary.
CREATE TABLE public.work_items (
  work_item_key text PRIMARY KEY,
  source_kind text NOT NULL CHECK (source_kind IN ('activity', 'tc_task')),
  source_id uuid NOT NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  tc_file_id uuid,
  kind text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'blocked', 'cancelled')),
  priority text NOT NULL DEFAULT 'normal',
  due_at timestamptz,
  assigned_to text,
  department text NOT NULL DEFAULT 'acquisitions',
  role text,
  primary_next_action boolean NOT NULL DEFAULT false,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  source_created_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_id)
);

CREATE TABLE public.work_item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_key text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  action text NOT NULL,
  actor text NOT NULL,
  previous_state jsonb,
  next_state jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Exact production bodies extracted from
-- 20260821120000_work_items_projection.sql.
CREATE OR REPLACE FUNCTION public.work_item_safe_timestamp_v1(value text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF nullif(trim(value), '') IS NULL THEN RETURN NULL; END IF;
  RETURN value::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.work_item_status_v1(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE lower(trim(coalesce(value, 'pending')))
    WHEN 'completed' THEN 'completed'
    WHEN 'done' THEN 'completed'
    WHEN 'waived' THEN 'cancelled'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'canceled' THEN 'cancelled'
    WHEN 'blocked' THEN 'blocked'
    ELSE 'pending'
  END
$$;

CREATE OR REPLACE FUNCTION public.sync_activity_work_item_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  row_value public.lead_activities;
  metadata_value jsonb;
  item_status text;
  projected_department text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.work_items
    WHERE source_kind = 'activity' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  row_value := NEW;
  IF row_value.activity_type NOT IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer') THEN
    DELETE FROM public.work_items
    WHERE source_kind = 'activity' AND source_id = row_value.id;
    RETURN NEW;
  END IF;

  metadata_value := coalesce(row_value.metadata, '{}'::jsonb);
  item_status := public.work_item_status_v1(metadata_value ->> 'status');
  projected_department := nullif(lower(trim(metadata_value ->> 'department')), '');
  IF projected_department IS NULL THEN
    SELECT CASE WHEN station IN ('contract_signed', 'under_contract', 'disposition', 'closed')
      THEN 'dispositions' ELSE 'acquisitions' END
    INTO projected_department
    FROM public.leads WHERE id = row_value.lead_id;
  END IF;
  projected_department := coalesce(projected_department, 'acquisitions');

  INSERT INTO public.work_items (
    work_item_key, source_kind, source_id, lead_id, kind, title, description,
    status, priority, due_at, assigned_to, department, role,
    primary_next_action, source_metadata, source_created_at, completed_at
  ) VALUES (
    'activity:' || row_value.id::text,
    'activity', row_value.id, row_value.lead_id, row_value.activity_type,
    coalesce(nullif(trim(metadata_value ->> 'title'), ''), nullif(trim(row_value.description), ''), 'Untitled task'),
    nullif(trim(metadata_value ->> 'notes'), ''),
    item_status,
    coalesce(nullif(lower(trim(metadata_value ->> 'priority')), ''), 'normal'),
    public.work_item_safe_timestamp_v1(metadata_value ->> 'due_date'),
    coalesce(nullif(trim(metadata_value ->> 'assigned_to'), ''), nullif(trim(row_value.agent), '')),
    projected_department,
    nullif(trim(metadata_value ->> 'role'), ''),
    lower(coalesce(metadata_value ->> 'primary_next_action', 'false')) = 'true',
    metadata_value,
    row_value.created_at,
    CASE WHEN item_status = 'completed'
      THEN coalesce(public.work_item_safe_timestamp_v1(metadata_value ->> 'completed_at'), row_value.created_at)
      ELSE NULL END
  )
  ON CONFLICT (source_kind, source_id) DO UPDATE SET
    lead_id = EXCLUDED.lead_id,
    kind = EXCLUDED.kind,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    priority = EXCLUDED.priority,
    due_at = EXCLUDED.due_at,
    assigned_to = EXCLUDED.assigned_to,
    department = EXCLUDED.department,
    role = EXCLUDED.role,
    primary_next_action = EXCLUDED.primary_next_action,
    source_metadata = EXCLUDED.source_metadata,
    source_created_at = EXCLUDED.source_created_at,
    completed_at = EXCLUDED.completed_at,
    version = public.work_items.version + 1,
    updated_at = now();

  RETURN NEW;
END
$$;

CREATE TRIGGER trigger_sync_activity_work_item_v1
AFTER INSERT OR UPDATE OF activity_type, description, agent, metadata OR DELETE
ON public.lead_activities
FOR EACH ROW EXECUTE FUNCTION public.sync_activity_work_item_v1();

-- Exact production body extracted from
-- 20260831120000_workflow_task_executor.sql.
CREATE OR REPLACE FUNCTION public.create_work_item_v2(
  p_actor text,
  p_idempotency_key text,
  p_lead_id uuid,
  p_kind text,
  p_title text,
  p_notes text,
  p_due_at timestamptz,
  p_assigned_to text,
  p_department text,
  p_role text DEFAULT NULL,
  p_priority text DEFAULT 'normal',
  p_primary_next_action boolean DEFAULT false,
  p_provenance jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  existing_event public.work_item_events;
  activity_id uuid;
  item public.work_items;
  clean_actor text := trim(coalesce(p_actor, ''));
  clean_key text := trim(coalesce(p_idempotency_key, ''));
  clean_kind text := lower(trim(coalesce(p_kind, 'task')));
  provenance_value jsonb := coalesce(p_provenance, '{}'::jsonb);
BEGIN
  IF clean_actor = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;
  IF length(clean_key) < 8 OR length(clean_key) > 200 THEN RAISE EXCEPTION 'invalid_idempotency_key'; END IF;
  IF clean_kind NOT IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer') THEN RAISE EXCEPTION 'invalid_work_item_kind'; END IF;
  IF nullif(trim(p_title), '') IS NULL THEN RAISE EXCEPTION 'title_required'; END IF;
  IF p_lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.leads WHERE id = p_lead_id) THEN RAISE EXCEPTION 'invalid_lead_id'; END IF;
  IF jsonb_typeof(provenance_value) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_work_item_provenance'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('work-item-idempotency:' || clean_key, 0));
  SELECT * INTO existing_event FROM public.work_item_events WHERE idempotency_key = clean_key;
  IF FOUND THEN
    IF existing_event.action <> 'create' THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
    SELECT * INTO item FROM public.work_items WHERE work_item_key = existing_event.work_item_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'idempotent_work_item_missing'; END IF;
    RETURN jsonb_build_object('created', false, 'workItem', to_jsonb(item));
  END IF;

  INSERT INTO public.lead_activities (lead_id, activity_type, description, agent, metadata)
  VALUES (
    p_lead_id, clean_kind, trim(p_title), nullif(trim(p_assigned_to), ''),
    jsonb_strip_nulls(provenance_value || jsonb_build_object(
      'title', trim(p_title), 'notes', nullif(trim(p_notes), ''),
      'task_type', clean_kind, 'due_date', p_due_at,
      'assigned_to', nullif(trim(p_assigned_to), ''),
      'department', coalesce(nullif(lower(trim(p_department)), ''), 'acquisitions'),
      'role', nullif(trim(p_role), ''),
      'priority', coalesce(nullif(lower(trim(p_priority)), ''), 'normal'),
      'status', 'pending', 'primary_next_action', coalesce(p_primary_next_action, false),
      'source', 'governed_workflow', 'created_by', clean_actor,
      'idempotency_key', clean_key
    ))
  ) RETURNING id INTO activity_id;

  SELECT * INTO item FROM public.work_items WHERE source_kind = 'activity' AND source_id = activity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'work_item_projection_failed'; END IF;

  INSERT INTO public.work_item_events (work_item_key, idempotency_key, action, actor, next_state)
  VALUES (item.work_item_key, clean_key, 'create', clean_actor, to_jsonb(item));
  RETURN jsonb_build_object('created', true, 'workItem', to_jsonb(item));
END
$$;

-- These two classifiers are exact production bodies from
-- 20260819120000_conversation_read_model.sql. Keeping the generic `email`
-- activity plus metadata.direction matches the desktop and mobile readers.
CREATE OR REPLACE FUNCTION public.conversation_activity_direction(
  activity_kind text,
  activity_metadata jsonb
)
RETURNS text
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
      OR COALESCE(activity_metadata, '{}'::jsonb) ? 'to_agents'
      OR COALESCE(activity_metadata, '{}'::jsonb) ? 'to_agent_phones'
      OR COALESCE(activity_metadata, '{}'::jsonb) ? 'queue_contract'
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
  activity_kind text,
  activity_metadata jsonb
)
RETURNS boolean
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

CREATE TABLE public.conversation_thread_state (
  thread_key text PRIMARY KEY,
  lead_id uuid,
  phone text,
  attention_state text NOT NULL DEFAULT 'resolved',
  attention_rank smallint GENERATED ALWAYS AS (
    CASE attention_state
      WHEN 'needs_reply' THEN 0
      WHEN 'waiting_on_contact' THEN 1
      ELSE 2
    END
  ) STORED,
  owner text,
  last_channel text,
  -- Test-only compatibility alias for direct fixture assertions. Production
  -- stores this value as last_channel and aliases it to channel in read output.
  channel text GENERATED ALWAYS AS (last_channel) STORED,
  last_direction text,
  last_communication_id uuid,
  last_communication_type text,
  last_communication_description text,
  last_communication_agent text,
  last_communication_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_communication_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  primary_next_action_id uuid,
  primary_next_action_title text,
  primary_next_action_due_at timestamptz,
  primary_next_action_owner text,
  search_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Fixture-limited refresh: verifies Email is recognized as a customer
-- communication and that the callback remains the Lead's primary next action.
-- The production refresh also handles SMS opt-outs, calls, manual read state,
-- form intake, phone-only threads, deletion, and full search indexing.
CREATE OR REPLACE FUNCTION public.fixture_sync_email_conversation_state_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  resolved_direction text;
  resolved_owner text;
  target_key text;
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  target_key := 'lead:' || NEW.lead_id::text;

  IF public.conversation_is_customer_communication(NEW.activity_type, NEW.metadata) THEN
    resolved_direction := public.conversation_activity_direction(NEW.activity_type, NEW.metadata);
    SELECT assigned_agent INTO resolved_owner FROM public.leads WHERE id = NEW.lead_id;

    INSERT INTO public.conversation_thread_state (
      thread_key, lead_id, attention_state, owner, last_channel,
      last_direction, last_communication_id, last_communication_type,
      last_communication_description, last_communication_agent,
      last_communication_metadata, last_communication_at, last_activity_at,
      search_text, updated_at
    ) VALUES (
      target_key, NEW.lead_id,
      CASE WHEN resolved_direction = 'inbound' THEN 'needs_reply'
        ELSE 'waiting_on_contact' END,
      resolved_owner,
      CASE WHEN NEW.activity_type LIKE 'email%' THEN 'email'
        WHEN NEW.activity_type LIKE 'sms%' THEN 'sms'
        WHEN NEW.activity_type = 'voicemail' THEN 'voicemail'
        ELSE 'call' END,
      resolved_direction, NEW.id, NEW.activity_type, NEW.description, NEW.agent,
      COALESCE(NEW.metadata, '{}'::jsonb), NEW.created_at, NEW.created_at,
      lower(concat_ws(' ', target_key, NEW.lead_id, NEW.description)), now()
    )
    ON CONFLICT (thread_key) DO UPDATE SET
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
      search_text = EXCLUDED.search_text,
      updated_at = now()
    WHERE (EXCLUDED.last_communication_at, EXCLUDED.last_communication_id)
      >= (conversation_thread_state.last_communication_at,
          conversation_thread_state.last_communication_id);
  ELSIF NEW.activity_type IN ('task', 'appointment', 'follow_up', 'callback', 'send_offer')
    AND lower(COALESCE(NEW.metadata->>'primary_next_action', 'false')) = 'true'
    AND COALESCE(NEW.metadata->>'status', 'pending') = 'pending' THEN
    UPDATE public.conversation_thread_state SET
      primary_next_action_id = NEW.id,
      primary_next_action_title = NEW.description,
      primary_next_action_due_at = public.work_item_safe_timestamp_v1(NEW.metadata->>'due_date'),
      primary_next_action_owner = NULLIF(trim(NEW.metadata->>'assigned_to'), ''),
      last_activity_at = greatest(last_activity_at, NEW.created_at),
      updated_at = now()
    WHERE thread_key = target_key;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER fixture_sync_email_conversation_state_v1
AFTER INSERT ON public.lead_activities
FOR EACH ROW EXECUTE FUNCTION public.fixture_sync_email_conversation_state_v1();
