#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-ai-change-retirement.XXXXXX)"
PG_PORT="$((57700 + $$ % 200))"
PG_DATA="$REHEARSAL_DIR/data"
PG_SOCKET="$REHEARSAL_DIR/socket"
ROOT="$(pwd)"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast stop >/dev/null 2>&1 || true
  find "$REHEARSAL_DIR" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$PG_SOCKET"
"$PG_BIN/initdb" -D "$PG_DATA" --no-locale -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-F -p $PG_PORT -k $PG_SOCKET" -w start >/dev/null
PSQL=("$PG_BIN/psql" -h "$PG_SOCKET" -p "$PG_PORT" -d postgres -v ON_ERROR_STOP=1 -X)

"${PSQL[@]}" <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motivation_score integer,
  property_condition text,
  asking_price numeric,
  opportunity_score integer,
  classification text,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  description text,
  agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id),
  manifest jsonb NOT NULL
);
CREATE TABLE public.ai_change_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id text NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  summary text NOT NULL,
  proposed_changes jsonb NOT NULL,
  base_snapshot jsonb NOT NULL,
  payload_hash text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  requested_by text NOT NULL,
  decision_key text UNIQUE,
  decided_by text,
  decision_note text,
  decided_at timestamptz,
  applied_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261002120000_ai_change_proposal_manifest_retirement.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261002120000_ai_change_proposal_manifest_retirement.sql" >/dev/null

"${PSQL[@]}" <<'SQL'
INSERT INTO public.leads(id)
VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO public.manifests(lead_id, manifest)
VALUES ('10000000-0000-4000-8000-000000000001', '{"historical":"unchanged"}'::jsonb);
INSERT INTO public.ai_change_proposals(
  id, entity_type, entity_id, source_type, source_id, summary,
  proposed_changes, base_snapshot, payload_hash, provider, model, prompt_version, requested_by
) VALUES (
  '20000000-0000-4000-8000-000000000001', 'lead', '10000000-0000-4000-8000-000000000001',
  'call_analysis', 'recording-1', 'Review facts',
  '{"motivation_score":8,"property_condition":"fair","asking_price":120000,"opportunity_score":82,"classification":"opportunity"}',
  '{"motivation_score":null,"property_condition":null,"asking_price":null,"opportunity_score":null,"classification":null}',
  repeat('a', 64), 'groq', 'model', 'prompt-v1', 'system:recording_callback'
);

DO $$
DECLARE
  result public.ai_change_proposals;
BEGIN
  result := public.decide_ai_change_proposal_v1(
    '20000000-0000-4000-8000-000000000001', 'approved', 'decision-key-approved-1',
    'reviewer@savingkc.com', 'Reviewed against the call'
  );
  IF result.status <> 'applied' THEN RAISE EXCEPTION 'approved proposal was not applied'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.leads
    WHERE id = '10000000-0000-4000-8000-000000000001'
      AND motivation_score = 8 AND property_condition = 'fair'
      AND asking_price = 120000 AND opportunity_score = 82
      AND classification = 'opportunity'
  ) THEN RAISE EXCEPTION 'canonical lead fields were not updated'; END IF;
  IF (SELECT manifest FROM public.manifests WHERE lead_id = '10000000-0000-4000-8000-000000000001')
     <> '{"historical":"unchanged"}'::jsonb THEN
    RAISE EXCEPTION 'historical Manifest compatibility data changed';
  END IF;

  result := public.decide_ai_change_proposal_v1(
    '20000000-0000-4000-8000-000000000001', 'approved', 'decision-key-approved-1',
    'reviewer@savingkc.com', 'Reviewed against the call'
  );
  IF result.status <> 'applied'
     OR (SELECT count(*) FROM public.lead_activities WHERE metadata->>'proposal_id' = result.id::text) <> 1 THEN
    RAISE EXCEPTION 'approved decision replay was not idempotent';
  END IF;

  IF has_function_privilege('authenticated', 'public.decide_ai_change_proposal_v1(uuid,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'browser role can execute AI change decisions';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.decide_ai_change_proposal_v1(uuid,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service role cannot execute AI change decisions';
  END IF;
END $$;

INSERT INTO public.ai_change_proposals(
  id, entity_type, entity_id, source_type, source_id, summary,
  proposed_changes, base_snapshot, payload_hash, provider, model, prompt_version, requested_by
) VALUES (
  '20000000-0000-4000-8000-000000000002', 'lead', '10000000-0000-4000-8000-000000000001',
  'call_analysis', 'recording-2', 'Conflicting fact', '{"motivation_score":9}',
  '{"motivation_score":8}', repeat('b', 64), 'groq', 'model', 'prompt-v1', 'system:recording_callback'
);
UPDATE public.leads SET motivation_score = 7 WHERE id = '10000000-0000-4000-8000-000000000001';

DO $$
DECLARE
  result public.ai_change_proposals;
BEGIN
  result := public.decide_ai_change_proposal_v1(
    '20000000-0000-4000-8000-000000000002', 'approved', 'decision-key-conflict-1',
    'reviewer@savingkc.com', NULL
  );
  IF result.status <> 'conflict' OR (SELECT motivation_score FROM public.leads WHERE id = result.entity_id) <> 7 THEN
    RAISE EXCEPTION 'optimistic conflict boundary failed';
  END IF;
END $$;
SQL

echo "AI change proposal Manifest retirement rehearsal passed"
