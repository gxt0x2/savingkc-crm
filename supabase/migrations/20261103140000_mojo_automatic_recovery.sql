BEGIN;

-- Service-owned receipts. No seller/business facts are changed by this ledger.
CREATE TABLE public.mojo_recovery_runs (
  id uuid PRIMARY KEY,
  runtime_digest text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','recovered','exhausted')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  attempts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attempts) = 'array'),
  failure_key text,
  failure_message text,
  last_sync_at timestamptz,
  verification jsonb
);
CREATE INDEX mojo_recovery_runs_started ON public.mojo_recovery_runs(started_at DESC);

CREATE TABLE public.mojo_recovery_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  failure_key text NOT NULL,
  failure_message text NOT NULL,
  recovery_run_id uuid REFERENCES public.mojo_recovery_runs(id),
  alert_claimed_at timestamptz,
  sms_status text CHECK (sms_status IN ('claimed','sent','failed','unknown'))
);
-- Concurrent KPI, intake and watchdog failures belong to one continuous outage.
CREATE UNIQUE INDEX mojo_recovery_one_open_incident ON public.mojo_recovery_incidents(status) WHERE status = 'open';

ALTER TABLE public.mojo_recovery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mojo_recovery_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mojo_recovery_runs, public.mojo_recovery_incidents FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mojo_recovery_runs, public.mojo_recovery_incidents TO service_role;
COMMIT;
