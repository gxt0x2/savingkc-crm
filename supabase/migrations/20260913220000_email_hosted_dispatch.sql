-- Hosted execution keeps provider outcomes separate from simulation.
ALTER TABLE public.em_workspaces DROP CONSTRAINT em_workspaces_execution_mode_check;
ALTER TABLE public.em_workspaces ADD CONSTRAINT em_workspaces_execution_mode_check
  CHECK (execution_mode IN ('disabled','simulation','hosted'));
ALTER TABLE public.em_send_intents DROP CONSTRAINT em_send_intents_state_check;
ALTER TABLE public.em_send_intents ADD CONSTRAINT em_send_intents_state_check
  CHECK (state IN ('queued','accepted_simulated','cancelled','held','dispatching','accepted','uncertain','rejected'));
ALTER TABLE public.em_send_intents
  ADD COLUMN provider_message_id uuid,
  ADD COLUMN connection_id uuid,
  ADD COLUMN provider_payload jsonb,
  ADD COLUMN provider_payload_hash text,
  ADD COLUMN provider_idempotency_key text,
  ADD COLUMN first_attempt_at timestamptz,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN remote_outcome text,
  ADD COLUMN is_test boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT em_intents_connection_fk FOREIGN KEY(workspace_id,connection_id)
    REFERENCES public.em_service_connections(workspace_id,id);
CREATE UNIQUE INDEX em_intents_provider_identity ON public.em_send_intents(connection_id,provider_message_id)
  WHERE provider_message_id IS NOT NULL;
ALTER TABLE public.em_campaigns ADD COLUMN is_test boolean NOT NULL DEFAULT false;
-- A committed attempt is never reclaimed automatically after a worker crash.
CREATE INDEX em_intents_remote_review ON public.em_send_intents(workspace_id,first_attempt_at)
  WHERE state IN ('dispatching','uncertain');
