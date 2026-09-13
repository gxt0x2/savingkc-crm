-- Local setup, AI evaluation, calendar/phone/push and saved-view scaffolding.
-- Does not enable live send, book Google events, provision a phone number,
-- deliver push, or mark provider readiness current.

CREATE TABLE public.em_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 200),
  program text NOT NULL CHECK (program IN (
    'seller_outreach','seller_nurture','buyer_marketing'
  )),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);

CREATE TABLE public.em_playbook_drafts (
  playbook_id uuid PRIMARY KEY REFERENCES public.em_playbooks(id),
  workspace_id uuid NOT NULL,
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  prompt text NOT NULL CHECK (char_length(trim(prompt)) BETWEEN 1 AND 10000),
  content_hash text NOT NULL CHECK (char_length(trim(content_hash)) >= 8),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, playbook_id),
  FOREIGN KEY (workspace_id, playbook_id)
    REFERENCES public.em_playbooks(workspace_id, id)
);

CREATE TABLE public.em_playbook_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  playbook_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  prompt text NOT NULL,
  content_hash text NOT NULL CHECK (char_length(trim(content_hash)) >= 8),
  eval_run_id uuid NOT NULL,
  published_by uuid NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (playbook_id, version_number),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, playbook_id)
    REFERENCES public.em_playbooks(workspace_id, id)
);
COMMENT ON TABLE public.em_playbook_versions IS
  'Immutable published draft-only policies. Automatic mode is never implied.';

CREATE TABLE public.em_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  playbook_id uuid NOT NULL,
  draft_hash text NOT NULL CHECK (char_length(trim(draft_hash)) >= 8),
  fixture_set_id uuid NOT NULL,
  fixture_set_hash text NOT NULL CHECK (char_length(trim(fixture_set_hash)) >= 8),
  model_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('deterministic','model')),
  cases jsonb NOT NULL CHECK (jsonb_typeof(cases) = 'array'),
  critical_failed integer NOT NULL DEFAULT 0 CHECK (critical_failed >= 0),
  passed boolean NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, playbook_id)
    REFERENCES public.em_playbooks(workspace_id, id)
);
COMMENT ON TABLE public.em_evaluation_runs IS
  'Deterministic fixture runs are labeled separately from model-backed evaluation. A deterministic pass cannot authorize bounded automatic replies.';

CREATE TABLE public.em_inbox_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  owner_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 100),
  query_version integer NOT NULL CHECK (query_version = 1),
  query jsonb NOT NULL CHECK (jsonb_typeof(query) = 'object'),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, owner_id, name),
  FOREIGN KEY (workspace_id, owner_id)
    REFERENCES public.em_memberships(workspace_id, auth_user_id)
);
COMMENT ON TABLE public.em_inbox_views IS
  'Personal allowlisted filters only. Saving or opening a view never changes controller, campaign or Lead stage.';

CREATE TABLE public.em_scheduling_policies (
  workspace_id uuid PRIMARY KEY REFERENCES public.em_workspaces(id),
  enabled boolean NOT NULL DEFAULT false,
  agent_calendars uuid[] NOT NULL DEFAULT '{}'::uuid[],
  hours jsonb NOT NULL CHECK (jsonb_typeof(hours) = 'object'),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 480),
  buffer_minutes integer NOT NULL CHECK (buffer_minutes BETWEEN 0 AND 240),
  max_daily_bookings integer NOT NULL CHECK (max_daily_bookings BETWEEN 1 AND 100),
  alert_check_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.em_scheduling_policies.enabled IS
  'Automatic Google booking. Local saves keep this false until a live calendar connection is verified.';

CREATE TABLE public.em_response_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  existing_provider_number_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose = 'email_response'),
  routing_policy text NOT NULL CHECK (routing_policy IN (
    'primary_then_backup','voicemail_after_hours'
  )),
  hours jsonb NOT NULL CHECK (jsonb_typeof(hours) = 'object'),
  voicemail text NOT NULL CHECK (voicemail IN ('enabled','disabled')),
  caller_id_policy text NOT NULL CHECK (caller_id_policy IN (
    'stable_number','no_outbound_calls'
  )),
  state text NOT NULL DEFAULT 'intended' CHECK (state IN (
    'intended','unverified','blocked'
  )),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id)
);
COMMENT ON TABLE public.em_response_lines IS
  'Intended existing-number purpose only. Save never purchases or provisions a Twilio number.';

CREATE TABLE public.em_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  event_key text NOT NULL,
  recipient_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel = 'push'),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  state text NOT NULL CHECK (state IN (
    'queued','provider_accepted','failed','blocked'
  )),
  subscription_ref uuid,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, event_key, recipient_id, channel, attempt)
);
COMMENT ON TABLE public.em_notification_deliveries IS
  'Push delivery ledger. Missing device or VAPID configuration is a visible blocked attempt, not a silent fallback.';

CREATE TABLE public.em_readiness_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  kind text NOT NULL CHECK (kind IN ('simulation','provider')),
  config_hash text NOT NULL CHECK (char_length(trim(config_hash)) >= 8),
  state text NOT NULL CHECK (state IN ('blocked','failed')),
  blockers jsonb NOT NULL CHECK (jsonb_typeof(blockers) = 'array'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.em_readiness_runs IS
  'Local checklists only. A simulation run cannot become current provider readiness or enable sending.';

DO $$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY[
    'em_playbooks','em_playbook_drafts','em_playbook_versions','em_evaluation_runs',
    'em_inbox_views','em_scheduling_policies','em_response_lines',
    'em_notification_deliveries','em_readiness_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', n);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated', n);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', n);
  END LOOP;
END $$;
