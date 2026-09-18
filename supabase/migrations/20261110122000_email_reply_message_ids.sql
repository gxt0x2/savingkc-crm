-- Provider correlation arrives after immutable outbound message history is written.
ALTER TABLE public.em_send_intents ADD COLUMN rfc_message_id text
  CHECK (rfc_message_id IS NULL OR (length(rfc_message_id) <= 1000 AND rfc_message_id ~ '^<[^<>[:space:]]+@[^<>[:space:]]+>$'));
CREATE UNIQUE INDEX em_intents_rfc_identity
  ON public.em_send_intents(workspace_id,connection_id,rfc_message_id)
  WHERE rfc_message_id IS NOT NULL;
COMMENT ON COLUMN public.em_send_intents.rfc_message_id IS
  'Actual RFC Message-ID reported by authenticated provider events; never a synthesized ID.';
