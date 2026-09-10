#!/usr/bin/env bash
set -euo pipefail
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
REHEARSAL_DIR="$(mktemp -d /tmp/savingkc-prospect-work.XXXXXX)"
PG_DATA="$REHEARSAL_DIR/data"
PG_SOCKET="$REHEARSAL_DIR/socket"
PG_PORT="$((58900 + $$ % 200))"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast stop >/dev/null 2>&1 || true
  find "$REHEARSAL_DIR" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT
mkdir -p "$PG_SOCKET"
"$PG_BIN/initdb" -D "$PG_DATA" --no-locale -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-F -p $PG_PORT -k $PG_SOCKET" -w start >/dev/null
PSQL=("$PG_BIN/psql" -h "$PG_SOCKET" -p "$PG_PORT" -d postgres -v ON_ERROR_STOP=1 -X)
# Reuse the established work-item fixture and actual production functions.
python3 - "$REHEARSAL_DIR/baseline.sql" <<'PY'
from pathlib import Path
import re,sys
fixture=Path('scripts/rehearse-primary-next-action-human-resolution.sh').read_text()
fixture=fixture.split("<<'SQL'\n",1)[1].split('CREATE FUNCTION public.contact_workspace_normalize_stage',1)[0]
fixture+='''
ALTER TABLE public.leads ADD full_name text, ADD phone text, ADD email text, ADD property_address text, ADD city text, ADD state text, ADD zip text, ADD created_at timestamptz DEFAULT now();
CREATE TABLE public.prospects(id uuid PRIMARY KEY, lead_id uuid REFERENCES public.leads);
CREATE TABLE public.tc_tasks(id uuid PRIMARY KEY, status text, completed_at timestamptz, updated_at timestamptz, due_at timestamptz, assigned_to text, label text, notes text, task_type text);
'''
def function(file,name):
 text=Path('supabase/migrations/'+file).read_text()
 match=re.search(r'CREATE OR REPLACE FUNCTION public\.'+name+r'\([\s\S]*?\n\$\$;',text)
 if not match: raise RuntimeError(name)
 return match.group(0)+'\n'
for name in ['work_item_safe_timestamp_v1','work_item_status_v1','sync_activity_work_item_v1','transition_work_item_v1']:
 fixture+=function('20260821120000_work_items_projection.sql',name)
fixture+=function('20260907120000_task_provenance_census.sql','task_provenance_class_v1')
fixture+=function('20260906120000_operational_review_lanes.sql','task_worklist_page_v2')
fixture+=function('20260913120000_phase_zero_current_work_only.sql','set_work_item_operational_lane_v1')
fixture+=function('20260913120000_phase_zero_current_work_only.sql','sync_work_item_operational_lane_from_lead_v1')
fixture+='''
CREATE TRIGGER trigger_sync_activity_work_item_v1 AFTER INSERT OR UPDATE OR DELETE ON public.lead_activities FOR EACH ROW EXECUTE FUNCTION public.sync_activity_work_item_v1();
CREATE TRIGGER trigger_set_work_item_operational_lane_v1 BEFORE INSERT OR UPDATE ON public.work_items FOR EACH ROW EXECUTE FUNCTION public.set_work_item_operational_lane_v1();
CREATE TRIGGER trigger_sync_work_item_operational_lane_from_lead_v1 AFTER UPDATE OF station,classification ON public.leads FOR EACH ROW EXECUTE FUNCTION public.sync_work_item_operational_lane_from_lead_v1();
INSERT INTO public.leads(id,station,classification) VALUES ('10000000-0000-4000-8000-000000000001','new','lead'),('10000000-0000-4000-8000-000000000002','dead','dead');
INSERT INTO public.prospects VALUES ('20000000-0000-4000-8000-000000000001',NULL),('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
INSERT INTO public.lead_activities(activity_type,description,agent,metadata) VALUES ('call','Existing call','Casey','{"prospect_id":"20000000-0000-4000-8000-000000000001"}');
INSERT INTO public.lead_activities(activity_type,description,agent,metadata) VALUES ('note','Retained note','Casey','{"source":"prospecting_contact_note","prospect_id":"20000000-0000-4000-8000-000000000001"}'),('follow_up','Historical source follow-up','Casey','{"source":"canonical_work_item","prospect_id":"20000000-0000-4000-8000-000000000001"}');
'''
Path(sys.argv[1]).write_text(fixture)
PY
"${PSQL[@]}" -f "$REHEARSAL_DIR/baseline.sql" >/dev/null
"${PSQL[@]}" -f supabase/migrations/20261102130000_prospect_work_items.sql >/dev/null
"${PSQL[@]}" <<'SQL'
DO $$
DECLARE first_result jsonb; second_result jsonb; mail_key text; initial_count int;
BEGIN
 IF EXISTS (SELECT 1 FROM public.lead_activities WHERE activity_type='call' AND (prospect_id IS NOT NULL OR lead_id IS NOT NULL)) THEN RAISE EXCEPTION 'calling history changed'; END IF;
 IF (SELECT count(*) FROM public.lead_activities WHERE prospect_id='20000000-0000-4000-8000-000000000001') <> 2 THEN RAISE EXCEPTION 'lost history'; END IF;
 IF (SELECT operational_lane FROM public.work_items WHERE title='Historical source follow-up') <> 'current' THEN RAISE EXCEPTION 'backfill lane wrong'; END IF;
 first_result:=public.create_work_item_v3('Casey','prospect-work-create-001',NULL,'20000000-0000-4000-8000-000000000001','mail','Thank-you letter',NULL,'2026-09-11T14:00:00Z','Casey','acquisitions');
 mail_key:=first_result->'workItem'->>'work_item_key';
 IF first_result->'workItem'->>'operational_lane' <> 'current' OR first_result->'workItem'->>'prospect_id' <> '20000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'mail projection invalid'; END IF;
 second_result:=public.create_work_item_v3('Casey','prospect-work-create-001',NULL,'20000000-0000-4000-8000-000000000001','mail','Thank-you letter',NULL,'2026-09-11T14:00:00Z','Casey','acquisitions');
 IF second_result->>'created' <> 'false' OR second_result->'workItem'->>'work_item_key' <> mail_key THEN RAISE EXCEPTION 'duplicate create'; END IF;
 SELECT count(*) INTO initial_count FROM public.work_items;
 PERFORM public.transition_work_item_v1(mail_key,'Casey','complete','prospect-mail-sent-001',1,'{}');
 PERFORM public.transition_work_item_v1(mail_key,'Casey','complete','prospect-mail-sent-001',1,'{}');
 IF (SELECT count(*) FROM public.work_items) <> initial_count OR (SELECT status FROM public.work_items WHERE work_item_key=mail_key) <> 'completed' THEN RAISE EXCEPTION 'mail completion duplicated or failed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.task_worklist_page_v2()->'items') item WHERE item->>'prospectId'='20000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'task read model dropped Prospect'; END IF;
 UPDATE public.prospects SET lead_id='10000000-0000-4000-8000-000000000001' WHERE id='20000000-0000-4000-8000-000000000001';
 IF (SELECT lead_id FROM public.work_items WHERE work_item_key=mail_key) <> '10000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'promotion lost identity'; END IF;
 PERFORM public.create_work_item_v3('Casey','prospect-work-create-002',NULL,'20000000-0000-4000-8000-000000000002','follow_up','Follow up',NULL,'2026-09-11T14:00:00Z','Casey','acquisitions');
 IF (SELECT lead_id FROM public.work_items WHERE title='Follow up') <> '10000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'already-linked Prospect missing effective Lead'; END IF;
 UPDATE public.leads SET station='dead',classification='dead' WHERE id='10000000-0000-4000-8000-000000000001';
 IF EXISTS (SELECT 1 FROM public.work_items WHERE lead_id='10000000-0000-4000-8000-000000000001' AND operational_lane='current') THEN RAISE EXCEPTION 'dead lifecycle left active work'; END IF;
 BEGIN
  PERFORM public.create_work_item_v3('Casey','prospect-mismatch-001','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','mail','Wrong record',NULL,NULL,'Casey','acquisitions');
  RAISE EXCEPTION 'accepted mismatched subjects';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%work_item_subject_mismatch%' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.create_work_item_v3('Ernest','prospect-work-create-001',NULL,'20000000-0000-4000-8000-000000000001','mail','Other actor',NULL,NULL,'Ernest','acquisitions');
  RAISE EXCEPTION 'idempotency crossed actor';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%idempotency_conflict%' THEN RAISE; END IF; END;
 IF has_function_privilege('authenticated','public.create_work_item_v3(text,text,uuid,uuid,text,text,text,timestamptz,text,text,text,text,boolean,jsonb)','EXECUTE') OR NOT has_function_privilege('service_role','public.create_work_item_v3(text,text,uuid,uuid,text,text,text,timestamptz,text,text,text,text,boolean,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'unsafe grants'; END IF;
END $$;
INSERT INTO public.prospects VALUES ('20000000-0000-4000-8000-000000000003',NULL);
INSERT INTO public.lead_activities(prospect_id,activity_type,description,metadata) VALUES
 ('20000000-0000-4000-8000-000000000003','task','Unknown source','{}'),
 ('20000000-0000-4000-8000-000000000003','task','Automated source','{"source":"mojo"}'),
 ('20000000-0000-4000-8000-000000000003','task','Event source','{"call_sid":"CAfixture"}');
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.work_items WHERE title IN ('Unknown source','Automated source') AND operational_lane<>'quarantine') THEN RAISE EXCEPTION 'quarantine weakened'; END IF;
 IF (SELECT operational_lane FROM public.work_items WHERE title='Event source') <> 'review' THEN RAISE EXCEPTION 'event review weakened'; END IF;
END $$;
SQL
"${PSQL[@]}" -f supabase/migrations/20261102130000_prospect_work_items.sql >/dev/null
"${PSQL[@]}" -c "SELECT 'PASS: Prospect history, canonical task/mail creation, completion, idempotence, promotion, dead lifecycle, review lanes, permissions and replay' AS result;"
