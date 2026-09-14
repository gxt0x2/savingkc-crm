-- Canonical CRM bridge for a human-reviewed Email callback handoff.
--
-- This migration adds private persistence and canonical phone/source compatibility.
-- The application performs the Lead, history, and callback writes inside the
-- existing Email command transaction. It never qualifies an Opportunity.

DO $$
DECLARE
  required_table text;
  required_column text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'em_workspaces', 'em_threads', 'em_handoffs', 'em_messages',
    'leads', 'lead_activities', 'work_items', 'crm_people',
    'crm_contact_methods', 'crm_properties', 'crm_lead_entity_links'
  ] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'email CRM bridge requires public.%', required_table;
    END IF;
  END LOOP;

  FOREACH required_column IN ARRAY ARRAY[
    'full_name', 'phone', 'email', 'property_address', 'city', 'state',
    'zip', 'county', 'source', 'station', 'classification', 'priority',
    'assigned_agent', 'is_parked', 'parcel_id', 'property_type', 'bedrooms',
    'bathrooms', 'sqft', 'year_built'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'leads'
        AND column_name = required_column
    ) THEN
      RAISE EXCEPTION 'email CRM bridge requires public.leads.%', required_column;
    END IF;
  END LOOP;
END $$;

-- Email-only Leads are valid. A phone supplied in a reply remains callback
-- evidence and is not silently promoted into the canonical phone field.
ALTER TABLE public.leads ALTER COLUMN phone DROP NOT NULL;

-- Preserve the complete currently installed source constraint expression and
-- add one value. Do not replace an evolved production allowlist with a stale
-- copy from this checkout.
DO $$
DECLARE
  source_constraint_name text;
  source_constraint_expression text;
  source_type text;
  source_column smallint;
  source_constraint_count integer;
  source_constraint_validated boolean;
  source_constraint_noinherit boolean;
BEGIN
  SELECT typ.typname, col.attnum INTO source_type, source_column
  FROM pg_attribute col JOIN pg_type typ ON typ.oid=col.atttypid
  WHERE col.attrelid='public.leads'::regclass AND col.attname='source';
  IF source_type NOT IN ('text','varchar') THEN
    RAISE EXCEPTION 'email CRM bridge requires a text leads.source column';
  END IF;
  SELECT count(*) INTO source_constraint_count FROM pg_constraint
  WHERE conrelid='public.leads'::regclass AND contype='c'
    AND source_column=ANY(conkey);
  IF source_constraint_count>1 THEN
    RAISE EXCEPTION 'email CRM bridge source constraint is ambiguous';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.leads'::regclass
    AND contype='c' AND source_column=ANY(conkey) AND cardinality(conkey)<>1) THEN
    RAISE EXCEPTION 'email CRM bridge cannot widen a multi-column source constraint';
  END IF;
  SELECT constraint_row.conname,
    pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
    constraint_row.convalidated, constraint_row.connoinherit
  INTO source_constraint_name, source_constraint_expression,
    source_constraint_validated, source_constraint_noinherit
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.leads'::regclass
    AND constraint_row.contype = 'c'
    AND source_column=ANY(constraint_row.conkey);

  IF source_constraint_expression IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.leads DROP CONSTRAINT %I',
      source_constraint_name
    );
    EXECUTE format(
      'ALTER TABLE public.leads ADD CONSTRAINT %I CHECK ((%s) OR source::text = %L) %s NOT VALID',
      source_constraint_name,
      source_constraint_expression,
      'email_marketing',
      CASE WHEN source_constraint_noinherit THEN 'NO INHERIT' ELSE '' END
    );
    IF source_constraint_validated THEN
      EXECUTE format(
        'ALTER TABLE public.leads VALIDATE CONSTRAINT %I',
        source_constraint_name
      );
    END IF;
  END IF;
END $$;

ALTER TABLE public.em_threads
  ADD COLUMN lead_id uuid REFERENCES public.leads(id) ON DELETE RESTRICT;

ALTER TABLE public.em_handoffs
  ADD COLUMN seller_interest_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN lead_id uuid REFERENCES public.leads(id) ON DELETE RESTRICT,
  ADD COLUMN crm_task_id uuid REFERENCES public.lead_activities(id) ON DELETE RESTRICT,
  ADD COLUMN crm_task_key text,
  ADD COLUMN callback_due_at timestamptz,
  ADD COLUMN crm_sync_reason text,
  ADD COLUMN crm_synced_at timestamptz;

ALTER TABLE public.em_handoffs
  DROP CONSTRAINT em_handoffs_crm_sync_state_check;
ALTER TABLE public.em_handoffs
  ALTER COLUMN crm_sync_state SET DEFAULT 'not_connected',
  ADD CONSTRAINT em_handoffs_crm_sync_state_check CHECK (
    crm_sync_state IN (
      'not_connected', 'pending', 'synced', 'review_required',
      'dependency_unavailable'
    )
  ),
  ADD CONSTRAINT em_handoffs_crm_sync_reason_check CHECK (
    crm_sync_reason IS NULL OR crm_sync_reason IN (
      'seller_interest_unconfirmed', 'identity_unconfirmed',
      'contact_identity_conflict', 'property_unconfirmed',
      'property_ambiguous', 'existing_record_held', 'owner_conflict',
      'governed_transition_required', 'canonical_dependency_missing',
      'schema_incompatible', 'legacy_handoff_requires_review'
    )
  );

CREATE TABLE public.em_crm_handoff_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  handoff_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  evidence_message_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','synced','held')),
  lead_id uuid REFERENCES public.leads(id) ON DELETE RESTRICT,
  lead_activity_id uuid REFERENCES public.lead_activities(id) ON DELETE RESTRICT,
  work_item_id uuid REFERENCES public.lead_activities(id) ON DELETE RESTRICT,
  work_item_key text,
  owner_auth_user_id uuid NOT NULL,
  owner_name text NOT NULL CHECK (length(trim(owner_name))>0),
  hold_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (
    (state='pending' AND completed_at IS NULL AND lead_id IS NULL AND hold_reason IS NULL)
    OR (state='held' AND completed_at IS NOT NULL AND hold_reason IS NOT NULL AND lead_id IS NULL)
    OR (state='synced' AND completed_at IS NOT NULL AND hold_reason IS NULL
      AND lead_id IS NOT NULL AND lead_activity_id IS NOT NULL AND work_item_id IS NOT NULL
      AND work_item_key IS NOT NULL)
  ),
  UNIQUE (workspace_id, id),
  UNIQUE (handoff_id),
  FOREIGN KEY (workspace_id, handoff_id)
    REFERENCES public.em_handoffs(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, thread_id)
    REFERENCES public.em_threads(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, evidence_message_id)
    REFERENCES public.em_messages(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, owner_auth_user_id)
    REFERENCES public.em_memberships(workspace_id, auth_user_id) ON DELETE RESTRICT
);

CREATE TABLE public.em_crm_message_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  handoff_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  message_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  lead_activity_id uuid NOT NULL REFERENCES public.lead_activities(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (message_id),
  UNIQUE (lead_activity_id),
  FOREIGN KEY (workspace_id, handoff_id)
    REFERENCES public.em_handoffs(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, thread_id)
    REFERENCES public.em_threads(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, message_id)
    REFERENCES public.em_messages(workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.em_attribution_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  handoff_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  message_id uuid NOT NULL,
  party_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL,
  campaign_version_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type = 'seller_interest'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (message_id, event_type),
  FOREIGN KEY (workspace_id, handoff_id)
    REFERENCES public.em_handoffs(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, thread_id)
    REFERENCES public.em_threads(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, message_id)
    REFERENCES public.em_messages(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, party_id)
    REFERENCES public.em_parties(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES public.em_campaigns(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, campaign_version_id)
    REFERENCES public.em_campaign_versions(workspace_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX em_lead_activities_message_unique
  ON public.lead_activities ((metadata ->> 'em_message_id'))
  WHERE metadata ->> 'source' = 'email_marketing'
    AND metadata ? 'em_message_id';
CREATE INDEX em_crm_handoff_projection_state_idx
  ON public.em_crm_handoff_projections (workspace_id, state, created_at, id);

ALTER TABLE public.em_crm_handoff_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_crm_message_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.em_attribution_touches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.em_crm_handoff_projections,
  public.em_crm_message_projections, public.em_attribution_touches
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.em_crm_handoff_projections,
  public.em_crm_message_projections, public.em_attribution_touches
  TO service_role;

CREATE TRIGGER em_crm_message_projections_immutable
  BEFORE UPDATE OR DELETE ON public.em_crm_message_projections
  FOR EACH ROW EXECUTE FUNCTION public.em_reject_frozen_mutation_v1();
CREATE TRIGGER em_attribution_touches_immutable
  BEFORE UPDATE OR DELETE ON public.em_attribution_touches
  FOR EACH ROW EXECUTE FUNCTION public.em_reject_frozen_mutation_v1();

COMMENT ON TABLE public.em_crm_handoff_projections IS
  'Private replay and review ledger for canonical CRM writes from an evidenced Email handoff.';
COMMENT ON TABLE public.em_crm_message_projections IS
  'Exactly-once bridge from immutable Email messages to canonical Lead history.';
COMMENT ON TABLE public.em_attribution_touches IS
  'Immutable seller-interest attribution evidence; it does not qualify an Opportunity.';
