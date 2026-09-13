-- Local provider-lifecycle scaffolding. Does not enable live send or create
-- remote Resend/DNS resources. Apply only after the named Email migrations.

ALTER TABLE public.em_service_connections
  ADD COLUMN key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  ADD COLUMN superseded_by uuid,
  ADD COLUMN replacement_reviewed_at timestamptz,
  ADD COLUMN replacement_review_reason text;
ALTER TABLE public.em_service_connections
  ADD CONSTRAINT em_service_connections_superseded_fk
  FOREIGN KEY (workspace_id, superseded_by)
  REFERENCES public.em_service_connections(workspace_id, id);
COMMENT ON COLUMN public.em_service_connections.superseded_by IS
  'Replacement review pointer only. Historical connection_id values on events and domains are never rewritten.';

ALTER TABLE public.em_webhook_endpoints
  ADD COLUMN key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  ADD COLUMN created_by uuid,
  ADD COLUMN request_id uuid,
  ADD COLUMN request_fingerprint text,
  ADD COLUMN rotated_at timestamptz,
  ADD COLUMN masked_secret text;
CREATE UNIQUE INDEX em_webhook_endpoints_request
  ON public.em_webhook_endpoints(workspace_id, created_by, request_id)
  WHERE request_id IS NOT NULL;

DO $$
DECLARE constraint_name name;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  WHERE con.conrelid = 'public.em_send_intents'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%accepted_simulated%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.em_send_intents DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;
ALTER TABLE public.em_send_intents
  ADD CONSTRAINT em_send_intents_state_check
  CHECK (state IN (
    'queued','accepted_simulated','cancelled','held',
    'accepted','uncertain','rejected','dispatching'
  ));
ALTER TABLE public.em_send_intents
  ADD COLUMN provider_message_id text,
  ADD COLUMN remote_outcome text,
  ADD COLUMN reconciled_at timestamptz;
CREATE INDEX em_intents_uncertain_idx
  ON public.em_send_intents(workspace_id, id)
  WHERE state IN ('uncertain','dispatching');

CREATE TABLE public.em_delivery_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.em_workspaces(id),
  connection_id uuid NOT NULL,
  provider_event_id text NOT NULL,
  provider_email_id uuid,
  intent_id uuid,
  type text NOT NULL CHECK (type IN (
    'email.sent','email.delivered','email.bounced','email.complained','email.delivery_delayed'
  )),
  occurred_at timestamptz NOT NULL,
  UNIQUE (workspace_id, connection_id, provider_event_id),
  FOREIGN KEY (workspace_id, connection_id)
    REFERENCES public.em_service_connections(workspace_id, id),
  FOREIGN KEY (workspace_id, intent_id)
    REFERENCES public.em_send_intents(workspace_id, id)
);

CREATE TABLE public.em_preference_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  address_id uuid NOT NULL,
  token_id uuid NOT NULL REFERENCES public.em_preference_tokens(id),
  program text NOT NULL CHECK (program IN (
    'seller_outreach','seller_nurture','buyer_marketing'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, address_id, program),
  FOREIGN KEY (workspace_id, address_id)
    REFERENCES public.em_addresses(workspace_id, id)
);
COMMENT ON TABLE public.em_preference_choices IS
  'Program note after an all-marketing stop. Cannot release suppression or resume sending.';

DO $$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY['em_delivery_facts','em_preference_choices'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', n);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated', n);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', n);
  END LOOP;
END $$;
