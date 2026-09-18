CREATE TABLE IF NOT EXISTS public.mobile_command_receipts (
  actor_email text NOT NULL,
  idempotency_key text NOT NULL,
  command text NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  payload_hash text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed')),
  http_status integer,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_email, idempotency_key),
  CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  CHECK (char_length(payload_hash) = 64)
);

ALTER TABLE public.mobile_command_receipts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.mobile_command_receipts IS
  'Service-role-only idempotency receipts for authenticated mobile CRM commands.';
