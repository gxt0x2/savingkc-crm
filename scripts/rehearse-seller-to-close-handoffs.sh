#!/usr/bin/env bash
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-seller-close.XXXXXX)"
PG_PORT="$((56900 + $$ % 300))"
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
  id uuid PRIMARY KEY,
  full_name text,
  source text,
  station text,
  classification text,
  priority text,
  assigned_agent text,
  opportunity_score integer,
  dead_reason text,
  dead_at timestamptz,
  dead_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.crm_opportunities (id uuid PRIMARY KEY);
CREATE TABLE public.crm_lead_entity_links (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id),
  opportunity_id uuid REFERENCES public.crm_opportunities(id)
);
CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id),
  activity_type text,
  description text,
  agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.dispo_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  stage text NOT NULL DEFAULT 'new',
  entered_at timestamptz DEFAULT now(),
  assignment_fee numeric,
  close_date date,
  accepted_offer_id uuid,
  accepted_buyer_id uuid,
  notes text,
  closeout_status text NOT NULL DEFAULT 'not_started',
  closeout jsonb NOT NULL DEFAULT '{}'::jsonb,
  closed_at timestamptz,
  debrief_due_at timestamptz,
  debrief_completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.tc_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id),
  dispo_deal_id uuid REFERENCES public.dispo_deals(id),
  buyer_offer_id uuid,
  status text,
  next_action text,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.leads(id, full_name, source, station, classification, priority, assigned_agent, opportunity_score)
VALUES ('10000000-0000-4000-8000-000000000001', 'Seller One', 'Google Ads', 'qualified', 'opportunity', 'hot', 'Casey', 80);
INSERT INTO public.crm_opportunities(id) VALUES ('20000000-0000-4000-8000-000000000001');
INSERT INTO public.crm_lead_entity_links(lead_id, opportunity_id)
VALUES ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260914120000_crm_lifecycle_commands.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260915120000_seller_to_close_handoffs.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20260915120000_seller_to_close_handoffs.sql" >/dev/null

"${PSQL[@]}" <<'SQL'
SELECT public.crm_apply_lifecycle_command_v1(
  '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  'transition', 'under_contract', 'opportunity', 'hot', NULL, NULL, NULL,
  'Seller contract signed', 'seller_contract_signed', 'submission-1',
  'casey@savingkc.com', 'Casey'
);
SELECT public.crm_apply_lifecycle_command_v1(
  '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  'transition', 'under_contract', 'opportunity', 'hot', NULL, NULL, NULL,
  'Seller contract signed', 'seller_contract_signed', 'submission-1',
  'casey@savingkc.com', 'Casey'
);

DO $$
DECLARE deal_id uuid;
BEGIN
  IF (SELECT count(*) FROM public.dispo_deals) <> 1 THEN RAISE EXCEPTION 'seller handoff did not create exactly one Dispositions deal'; END IF;
  IF (SELECT count(*) FROM public.crm_lifecycle_events) <> 1 THEN RAISE EXCEPTION 'lifecycle replay duplicated its event'; END IF;
  IF (SELECT count(*) FROM public.crm_department_handoffs WHERE to_department = 'dispositions') <> 1 THEN RAISE EXCEPTION 'seller handoff was not durable'; END IF;
  SELECT id INTO deal_id FROM public.dispo_deals;
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_department_handoffs
    WHERE to_department = 'dispositions' AND target_record_type = 'dispo_deal' AND target_record_id = deal_id
  ) THEN RAISE EXCEPTION 'seller handoff was not linked to its Dispositions deal'; END IF;

  INSERT INTO public.tc_files(id, lead_id, dispo_deal_id, buyer_offer_id, status, next_action)
  VALUES (
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', deal_id,
    '50000000-0000-4000-8000-000000000001', 'active', 'Verify assignment'
  );

  PERFORM public.crm_record_department_handoff_v1(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    'dispositions', 'transaction_coordination', 'buyer_offer', '50000000-0000-4000-8000-000000000001',
    'tc_file', '40000000-0000-4000-8000-000000000001', 'assignment_signed', 'submission-2',
    'docuseal@savingkc.system', 'DocuSeal', 'Assignment signed'
  );
  PERFORM public.crm_record_department_handoff_v1(
    '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
    'dispositions', 'transaction_coordination', 'buyer_offer', '50000000-0000-4000-8000-000000000001',
    'tc_file', '40000000-0000-4000-8000-000000000001', 'assignment_signed', 'submission-2',
    'docuseal@savingkc.system', 'DocuSeal', 'Assignment signed'
  );
  IF (SELECT count(*) FROM public.crm_department_handoffs WHERE to_department = 'transaction_coordination') <> 1 THEN
    RAISE EXCEPTION 'assignment retry duplicated the TC handoff';
  END IF;

  PERFORM public.crm_finalize_funded_close_v1(
    deal_id, '{"version":1}'::jsonb, '2026-08-23T17:00:00Z', 25000, '2026-08-23',
    '2026-08-24T17:00:00Z', 'casey@savingkc.com', 'Casey', 24000
  );
  PERFORM public.crm_finalize_funded_close_v1(
    deal_id, '{"version":1}'::jsonb, '2026-08-23T17:00:00Z', 25000, '2026-08-23',
    '2026-08-24T17:00:00Z', 'casey@savingkc.com', 'Casey', 24000
  );

  IF (SELECT station FROM public.leads WHERE id = '10000000-0000-4000-8000-000000000001') <> 'closed_won' THEN RAISE EXCEPTION 'lead was not closed won'; END IF;
  IF (SELECT stage FROM public.dispo_deals WHERE id = deal_id) <> 'closed' THEN RAISE EXCEPTION 'Dispositions deal was not closed'; END IF;
  IF (SELECT status FROM public.tc_files WHERE id = '40000000-0000-4000-8000-000000000001') <> 'closed' THEN RAISE EXCEPTION 'TC file was not closed'; END IF;
  IF (SELECT count(*) FROM public.crm_marketing_outcomes WHERE outcome_key = 'funded:' || deal_id::text) <> 1 THEN RAISE EXCEPTION 'funded retry duplicated Marketing revenue'; END IF;
  IF (SELECT revenue FROM public.crm_marketing_outcomes WHERE outcome_key = 'funded:' || deal_id::text) <> 24000 THEN RAISE EXCEPTION 'Marketing revenue was incorrect'; END IF;
END $$;
SQL

echo "Seller-to-close handoff rehearsal passed"
