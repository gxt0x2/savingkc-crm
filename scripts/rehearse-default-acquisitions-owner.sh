#!/usr/bin/env bash
set -euo pipefail

PG_BIN="${PG_BIN:-$(pg_config --bindir)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-default-owner.XXXXXX)"
PG_PORT="$((58000 + $$ % 300))"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$REHEARSAL_DIR/data" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$REHEARSAL_DIR"
}
trap cleanup EXIT

mkdir -p "$REHEARSAL_DIR/socket"
"$PG_BIN/initdb" -D "$REHEARSAL_DIR/data" --no-locale -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$REHEARSAL_DIR/data" -o "-F -p $PG_PORT -k $REHEARSAL_DIR/socket -h ''" -w start >/dev/null
PSQL=("$PG_BIN/psql" -h "$REHEARSAL_DIR/socket" -p "$PG_PORT" -d postgres -v ON_ERROR_STOP=1 -X)

"${PSQL[@]}" >/dev/null <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE TABLE public.agent_profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  user_id uuid,
  is_active boolean
);
CREATE TABLE public.system_config (
  key text PRIMARY KEY,
  value jsonb,
  updated_at timestamptz
);
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text,
  assigned_agent text,
  station text NOT NULL DEFAULT 'new',
  classification text,
  is_parked boolean NOT NULL DEFAULT false,
  notes text,
  updated_at timestamptz
);
CREATE TABLE public.crm_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_lead_id uuid,
  owner_name text,
  stage text,
  updated_at timestamptz
);
CREATE TABLE public.crm_lead_entity_links (
  lead_id uuid PRIMARY KEY,
  opportunity_id uuid,
  projected_at timestamptz
);
CREATE TABLE public.conversation_thread_state (
  thread_key text PRIMARY KEY,
  lead_id uuid,
  owner text,
  updated_at timestamptz
);
CREATE TABLE public.mobile_message_thread_state (
  thread_key text PRIMARY KEY,
  lead_id uuid,
  owner text,
  updated_at timestamptz
);
CREATE TABLE public.lead_activities (id integer PRIMARY KEY, lead_id uuid, description text);
CREATE TABLE public.mojo_call_queue (id integer PRIMARY KEY, status text);
CREATE TABLE public.trigger_log (id integer);

CREATE FUNCTION public.queue_briefing_from_lead_change_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.trigger_log(id) VALUES (1);
  RETURN NEW;
END $$;
CREATE TRIGGER trigger_queue_briefing_from_lead
AFTER INSERT OR UPDATE OF assigned_agent ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.queue_briefing_from_lead_change_v1();

CREATE FUNCTION public.trigger_refresh_crm_entity_for_lead()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.trigger_log(id) VALUES (2);
  RETURN NEW;
END $$;
CREATE TRIGGER trigger_refresh_crm_entity_for_lead
AFTER UPDATE OF assigned_agent ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.trigger_refresh_crm_entity_for_lead();

CREATE FUNCTION public.sync_conversation_thread_state_from_lead()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.trigger_log(id) VALUES (3);
  RETURN NEW;
END $$;
CREATE TRIGGER trigger_sync_conversation_thread_state_lead
AFTER UPDATE OF assigned_agent ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.sync_conversation_thread_state_from_lead();

CREATE FUNCTION public.sync_mobile_message_thread_state_from_lead()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.trigger_log(id) VALUES (4);
  RETURN NEW;
END $$;
CREATE TRIGGER trigger_sync_mobile_message_thread_state_lead
AFTER UPDATE OF assigned_agent ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.sync_mobile_message_thread_state_from_lead();

CREATE FUNCTION public.queue_briefing_from_opportunity_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.trigger_log(id) VALUES (5);
  RETURN NEW;
END $$;
CREATE TRIGGER trigger_queue_briefing_from_opportunity
AFTER UPDATE ON public.crm_opportunities
FOR EACH ROW EXECUTE FUNCTION public.queue_briefing_from_opportunity_v1();

INSERT INTO public.agent_profiles(id, email, full_name, user_id, is_active)
VALUES ('11111111-1111-4111-8111-111111111111', 'casey@savingkc.com', 'Casey Davis', '22222222-2222-4222-8222-222222222222', true);

INSERT INTO public.mojo_call_queue(id, status) VALUES (1, 'waiting');

INSERT INTO public.leads(id, full_name, assigned_agent, station, classification, is_parked, notes, updated_at) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Dead Ernest', 'Ernest', 'dead', 'dead', false, 'keep', '2020-01-01'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Open Ernest', 'Ernest', 'new', null, false, 'keep', '2020-01-01'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'Open blank', null, 'contacted', null, false, 'keep', '2020-01-01'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'Open full name', 'Casey Davis', 'qualified', null, false, 'keep', '2020-01-01'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'Open Casey', 'Casey', 'new', null, false, 'keep', '2020-01-01'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', 'Parked open', null, 'new', null, true, 'keep', '2020-01-01'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', 'Won', 'Ernest', 'closed_won', 'opportunity', false, 'keep', '2020-01-01'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8', 'Lost', null, 'closed_lost', null, false, 'keep', '2020-01-01'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9', 'Classified dead', 'Ernest', 'new', 'dead', false, 'keep', '2020-01-01');

INSERT INTO public.crm_opportunities(id, source_lead_id, owner_name, stage, updated_at)
SELECT id, id, assigned_agent, station, updated_at FROM public.leads;
INSERT INTO public.crm_lead_entity_links(lead_id, opportunity_id, projected_at)
SELECT id, id, updated_at FROM public.leads;
INSERT INTO public.conversation_thread_state(thread_key, lead_id, owner, updated_at)
SELECT 'lead:' || id::text, id, assigned_agent, updated_at FROM public.leads;
INSERT INTO public.mobile_message_thread_state(thread_key, lead_id, owner, updated_at)
SELECT 'lead:' || id::text, id, assigned_agent, updated_at FROM public.leads;
SQL

"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261201120000_default_acquisitions_owner.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/20261201120000_default_acquisitions_owner.sql" >/dev/null

"${PSQL[@]}" >/dev/null <<'SQL'
DO $$
DECLARE
  config jsonb;
  inserted uuid;
  result jsonb;
  replay jsonb;
  kept_notes integer;
  kept_times integer;
  activities integer;
  queue_status text;
  log_during integer;
  log_after integer;
BEGIN
  SELECT value INTO config FROM public.system_config WHERE key = 'default_acquisitions_owner';
  IF config->>'displayName' IS DISTINCT FROM 'Casey' THEN
    RAISE EXCEPTION 'setting_display_name %', config;
  END IF;
  IF config->>'email' IS DISTINCT FROM 'casey@savingkc.com' THEN
    RAISE EXCEPTION 'setting_email %', config;
  END IF;
  IF config->>'agentProfileId' IS DISTINCT FROM '11111111-1111-4111-8111-111111111111' THEN
    RAISE EXCEPTION 'setting_profile %', config;
  END IF;
  IF public.default_acquisitions_owner_name() IS DISTINCT FROM 'Casey' THEN
    RAISE EXCEPTION 'resolved_owner %', public.default_acquisitions_owner_name();
  END IF;

  INSERT INTO public.leads(full_name, station) VALUES ('Website', 'new') RETURNING id INTO inserted;
  IF (SELECT assigned_agent FROM public.leads WHERE id = inserted) IS DISTINCT FROM 'Casey' THEN
    RAISE EXCEPTION 'blank_insert_not_defaulted';
  END IF;

  INSERT INTO public.leads(full_name, station, assigned_agent) VALUES ('Blank string', 'new', '   ') RETURNING id INTO inserted;
  IF (SELECT assigned_agent FROM public.leads WHERE id = inserted) IS DISTINCT FROM 'Casey' THEN
    RAISE EXCEPTION 'whitespace_owner_not_defaulted';
  END IF;

  SELECT COUNT(*) INTO log_during FROM public.trigger_log;
  result := public.backfill_default_acquisitions_owner_v1();
  IF (SELECT COUNT(*) FROM public.trigger_log) IS DISTINCT FROM log_during THEN
    RAISE EXCEPTION 'backfill_fired_side_effect_triggers';
  END IF;
  IF result->>'owner' IS DISTINCT FROM 'Casey' OR (result->>'replayed')::boolean THEN
    RAISE EXCEPTION 'backfill_result %', result;
  END IF;
  IF (result->'updated'->>'leads')::integer IS DISTINCT FROM 4
    OR (result->'updated'->>'opportunities')::integer IS DISTINCT FROM 4
    OR (result->'updated'->>'conversationThreads')::integer IS DISTINCT FROM 4
    OR (result->'updated'->>'mobileThreads')::integer IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'update_counts %', result->'updated';
  END IF;
  IF result->'before'->'displayedContactsPage'->>'Ernest' IS DISTINCT FROM '1'
    OR result->'before'->'displayedContactsPage'->>'(unassigned)' IS DISTINCT FROM '1'
    OR result->'after'->'displayedContactsPage' ? 'Ernest'
    OR result->'after'->'displayedContactsPage'->>'Casey' IS DISTINCT FROM '6'
    OR result->'after'->'displayedOpen'->>'Casey' IS DISTINCT FROM '7' THEN
    RAISE EXCEPTION 'owner_counts %', result;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.leads
    WHERE id IN (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'
    ) AND assigned_agent IS DISTINCT FROM CASE id::text
      WHEN 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8' THEN NULL
      ELSE 'Ernest'
    END
  ) THEN
    RAISE EXCEPTION 'closed_or_dead_owner_changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.leads
    WHERE id IN (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'
    ) AND assigned_agent IS DISTINCT FROM 'Casey'
  ) THEN
    RAISE EXCEPTION 'open_owner_not_casey';
  END IF;

  SELECT COUNT(*) INTO kept_notes FROM public.leads
  WHERE id::text LIKE 'aaaaaaaa-aaaa-4aaa-8aaa-%' AND notes IS DISTINCT FROM 'keep';
  SELECT COUNT(*) INTO kept_times FROM public.leads
  WHERE id::text LIKE 'aaaaaaaa-aaaa-4aaa-8aaa-%' AND updated_at IS DISTINCT FROM '2020-01-01';
  IF kept_notes <> 0 OR kept_times <> 0 THEN
    RAISE EXCEPTION 'other_lead_fields_changed notes=% times=%', kept_notes, kept_times;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.crm_opportunities
    WHERE source_lead_id IN (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'
    ) AND owner_name IS DISTINCT FROM 'Ernest'
  ) OR EXISTS (
    SELECT 1 FROM public.crm_opportunities
    WHERE source_lead_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8'
      AND owner_name IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.crm_opportunities AS opportunity
    JOIN public.leads AS lead ON lead.id = opportunity.source_lead_id
    WHERE public.lead_is_open_for_default_owner_v1(lead.station, lead.classification)
      AND opportunity.owner_name IS DISTINCT FROM 'Casey'
  ) THEN
    RAISE EXCEPTION 'opportunity_owner_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.crm_opportunities WHERE stage IS DISTINCT FROM (
      SELECT station FROM public.leads WHERE leads.id = crm_opportunities.source_lead_id
    ) OR updated_at IS DISTINCT FROM '2020-01-01'
  ) THEN
    RAISE EXCEPTION 'opportunity_other_fields_changed';
  END IF;

  SELECT COUNT(*) INTO activities FROM public.lead_activities;
  SELECT status INTO queue_status FROM public.mojo_call_queue WHERE id = 1;
  IF activities <> 0 OR queue_status IS DISTINCT FROM 'waiting' THEN
    RAISE EXCEPTION 'history_or_queue_touched activities=% queue=%', activities, queue_status;
  END IF;

  INSERT INTO public.leads(full_name, station, assigned_agent) VALUES ('Chosen', 'new', 'Ernest') RETURNING id INTO inserted;
  IF (SELECT assigned_agent FROM public.leads WHERE id = inserted) IS DISTINCT FROM 'Ernest' THEN
    RAISE EXCEPTION 'explicit_owner_replaced';
  END IF;

  UPDATE public.system_config
  SET value = jsonb_build_object(
    'agentProfileId', '33333333-3333-4333-8333-333333333333',
    'email', 'alex@savingkc.com',
    'displayName', 'Alex'
  )
  WHERE key = 'default_acquisitions_owner';
  INSERT INTO public.leads(full_name, station) VALUES ('Future rep', 'new') RETURNING id INTO inserted;
  IF (SELECT assigned_agent FROM public.leads WHERE id = inserted) IS DISTINCT FROM 'Alex' THEN
    RAISE EXCEPTION 'setting_change_did_not_apply';
  END IF;
  IF (SELECT assigned_agent FROM public.leads WHERE full_name = 'Website') IS DISTINCT FROM 'Casey' THEN
    RAISE EXCEPTION 'setting_change_rewrote_existing';
  END IF;

  replay := public.backfill_default_acquisitions_owner_v1();
  IF NOT (replay->>'replayed')::boolean THEN
    RAISE EXCEPTION 'backfill_replayed_work %', replay;
  END IF;
  IF (SELECT assigned_agent FROM public.leads WHERE full_name = 'Future rep') IS DISTINCT FROM 'Alex' THEN
    RAISE EXCEPTION 'replay_overwrote_new_owner';
  END IF;
  IF (SELECT assigned_agent FROM public.leads WHERE full_name = 'Chosen') IS DISTINCT FROM 'Ernest' THEN
    RAISE EXCEPTION 'replay_overwrote_explicit_owner';
  END IF;

  SELECT COUNT(*) INTO log_after FROM public.trigger_log;
  INSERT INTO public.leads(full_name, station) VALUES ('After backfill', 'new');
  IF (SELECT COUNT(*) FROM public.trigger_log) <= log_after THEN
    RAISE EXCEPTION 'insert_triggers_left_disabled';
  END IF;
END
$$;
SQL

echo rehearsal_ok
