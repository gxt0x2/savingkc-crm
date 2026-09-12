-- Connected pilot ledger. Deliberately simulation-only until provider readiness.
-- Apply only after the four explicitly named Email foundation migrations.
ALTER TABLE public.em_workspaces ADD COLUMN execution_mode text NOT NULL DEFAULT 'disabled'
  CHECK (execution_mode IN ('disabled', 'simulation'));

CREATE TABLE public.em_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  campaign_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  address_id uuid NOT NULL,
  party_id uuid NOT NULL,
  subject text NOT NULL,
  controller text NOT NULL DEFAULT 'none' CHECK (controller IN ('none','human')),
  controller_user_id uuid,
  responsible_user_id uuid NOT NULL,
  controller_revision integer NOT NULL DEFAULT 0,
  content_revision integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','needs_review','human','stopped')),
  outcome text NOT NULL DEFAULT 'unclassified' CHECK (outcome IN ('unclassified','call_requested','unsubscribed')),
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id), UNIQUE(enrollment_id),
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES public.em_campaigns(workspace_id,id),
  FOREIGN KEY(workspace_id,enrollment_id) REFERENCES public.em_enrollments(workspace_id,id),
  FOREIGN KEY(workspace_id,address_id) REFERENCES public.em_addresses(workspace_id,id),
  FOREIGN KEY(workspace_id,party_id) REFERENCES public.em_parties(workspace_id,id),
  FOREIGN KEY(workspace_id,responsible_user_id) REFERENCES public.em_memberships(workspace_id,auth_user_id),
  FOREIGN KEY(workspace_id,controller_user_id) REFERENCES public.em_memberships(workspace_id,auth_user_id),
  CHECK ((controller = 'human') = (controller_user_id IS NOT NULL))
);
CREATE TABLE public.em_send_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  thread_id uuid NOT NULL, logical_key text NOT NULL,
  origin text NOT NULL CHECK(origin IN ('sequence','human')),
  step integer NOT NULL CHECK(step BETWEEN 0 AND 1),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','accepted_simulated','cancelled','held')),
  frozen_payload jsonb NOT NULL, payload_hash text NOT NULL,
  expected_content_revision integer NOT NULL, expected_controller_revision integer NOT NULL,
  not_before timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  accepted_at timestamptz, cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,logical_key),
  FOREIGN KEY(workspace_id,thread_id) REFERENCES public.em_threads(workspace_id,id),
  CHECK (expires_at > not_before)
);
CREATE INDEX em_intents_local_due_idx ON public.em_send_intents(workspace_id,not_before,id) WHERE state='queued';
CREATE TABLE public.em_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  thread_id uuid NOT NULL, intent_id uuid,
  direction text NOT NULL CHECK(direction IN ('inbound','outbound')),
  text_body text NOT NULL, subject text NOT NULL, sequence integer NOT NULL CHECK(sequence>0),
  transport text NOT NULL CHECK(transport='simulation'),
  event_key text NOT NULL, content_hash text NOT NULL, occurred_at timestamptz NOT NULL,
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,event_key), UNIQUE(intent_id), UNIQUE(thread_id,sequence),
  FOREIGN KEY(workspace_id,thread_id) REFERENCES public.em_threads(workspace_id,id),
  FOREIGN KEY(workspace_id,intent_id) REFERENCES public.em_send_intents(workspace_id,id)
);
CREATE TABLE public.em_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  thread_id uuid NOT NULL, author_id uuid NOT NULL, body text NOT NULL, body_hash text NOT NULL,
  content_revision integer NOT NULL, controller_revision integer NOT NULL,
  state text NOT NULL DEFAULT 'current' CHECK(state IN ('current','stale','sent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,thread_id) REFERENCES public.em_threads(workspace_id,id),
  FOREIGN KEY(workspace_id,author_id) REFERENCES public.em_memberships(workspace_id,auth_user_id)
);
CREATE TABLE public.em_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  address_id uuid NOT NULL, reason text NOT NULL, evidence_message_id uuid,
  created_by uuid NOT NULL, effective_at timestamptz NOT NULL DEFAULT now(),
  scope text NOT NULL DEFAULT 'all_marketing' CHECK(scope='all_marketing'),
  UNIQUE(workspace_id,address_id),
  FOREIGN KEY(workspace_id,address_id) REFERENCES public.em_addresses(workspace_id,id),
  FOREIGN KEY(workspace_id,evidence_message_id) REFERENCES public.em_messages(workspace_id,id)
);
CREATE TABLE public.em_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  thread_id uuid NOT NULL, owner_id uuid NOT NULL, backup_id uuid NOT NULL,
  reason text NOT NULL, requested_contact jsonb NOT NULL, fact_evidence jsonb NOT NULL,
  state text NOT NULL DEFAULT 'needs_contact' CHECK(state IN ('needs_contact','acknowledged','held')),
  crm_sync_state text NOT NULL DEFAULT 'not_connected' CHECK(crm_sync_state='not_connected'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,id), UNIQUE(thread_id),
  FOREIGN KEY(workspace_id,thread_id) REFERENCES public.em_threads(workspace_id,id),
  FOREIGN KEY(workspace_id,owner_id) REFERENCES public.em_memberships(workspace_id,auth_user_id),
  FOREIGN KEY(workspace_id,backup_id) REFERENCES public.em_memberships(workspace_id,auth_user_id)
);
CREATE TABLE public.em_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  thread_id uuid NOT NULL, recipient_id uuid NOT NULL, kind text NOT NULL,
  logical_key text NOT NULL, acknowledged_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,recipient_id,logical_key),
  FOREIGN KEY(workspace_id,thread_id) REFERENCES public.em_threads(workspace_id,id),
  FOREIGN KEY(workspace_id,recipient_id) REFERENCES public.em_memberships(workspace_id,auth_user_id)
);
-- Protect actual publication artifacts, rather than just hashing mutable rows.
CREATE FUNCTION public.em_reject_frozen_mutation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'EMAIL_IMMUTABLE_RECORD'; END $$;
REVOKE ALL ON FUNCTION public.em_reject_frozen_mutation_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER em_versions_immutable BEFORE UPDATE OR DELETE ON public.em_campaign_versions
  FOR EACH ROW EXECUTE FUNCTION public.em_reject_frozen_mutation_v1();
CREATE TRIGGER em_snapshots_immutable BEFORE UPDATE OR DELETE ON public.em_audience_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.em_reject_frozen_mutation_v1();
CREATE TRIGGER em_snapshot_rows_immutable BEFORE UPDATE OR DELETE ON public.em_snapshot_rows
  FOR EACH ROW EXECUTE FUNCTION public.em_reject_frozen_mutation_v1();
CREATE TRIGGER em_messages_immutable BEFORE UPDATE OR DELETE ON public.em_messages
  FOR EACH ROW EXECUTE FUNCTION public.em_reject_frozen_mutation_v1();

-- Existing address guard also needs a race-safe person guard across aliases.
CREATE UNIQUE INDEX em_one_active_party_program ON public.em_enrollments(workspace_id,party_id)
  WHERE party_id IS NOT NULL AND state IN ('queued','waiting_reply','held','replied');

DO $$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY['em_threads','em_send_intents','em_messages','em_drafts','em_suppressions','em_handoffs','em_notifications'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', n);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated', n);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', n);
  END LOOP;
END $$;
