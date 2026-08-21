-- Durable, actor-owned AI assistant threads, messages, generations, and
-- confirmation decisions. The model remains read-only in this release;
-- assistant_confirmations is the additive boundary for future mutations.

CREATE TABLE IF NOT EXISTS public.assistant_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email text NOT NULL,
  actor_name text NOT NULL,
  title text NOT NULL DEFAULT 'New conversation',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  surface text NOT NULL DEFAULT 'ai_page' CHECK (surface IN ('ai_page', 'giraffe', 'api')),
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.assistant_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 100000),
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array'),
  sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assistant_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.assistant_threads(id) ON DELETE CASCADE,
  request_message_id uuid NOT NULL REFERENCES public.assistant_messages(id) ON DELETE RESTRICT,
  response_message_id uuid REFERENCES public.assistant_messages(id) ON DELETE SET NULL,
  actor_email text NOT NULL,
  request_id text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'complete', 'error', 'cancelled')),
  provider text,
  model text,
  finish_reason text,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  total_tokens integer CHECK (total_tokens IS NULL OR total_tokens >= 0),
  cache_read_tokens integer CHECK (cache_read_tokens IS NULL OR cache_read_tokens >= 0),
  estimated_cost_micros bigint CHECK (estimated_cost_micros IS NULL OR estimated_cost_micros >= 0),
  pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pricing_snapshot) = 'object'),
  tool_trace jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tool_trace) = 'array'),
  source_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_snapshot) = 'array'),
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_email, request_id)
);

ALTER TABLE public.assistant_messages
  ADD COLUMN IF NOT EXISTS generation_id uuid REFERENCES public.assistant_generations(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.assistant_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES public.assistant_generations(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.assistant_threads(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  action_summary text NOT NULL,
  proposed_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(proposed_payload) = 'object'),
  payload_hash text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected', 'expired', 'executed', 'cancelled')),
  requested_by text NOT NULL,
  decided_by text,
  decision_note text,
  decided_at timestamptz,
  executed_at timestamptz,
  execution_reference text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.assistant_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_confirmations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.assistant_threads, public.assistant_messages,
  public.assistant_generations, public.assistant_confirmations
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.assistant_threads, public.assistant_messages,
  public.assistant_generations, public.assistant_confirmations
  TO service_role;

CREATE INDEX IF NOT EXISTS idx_assistant_threads_actor_recent
  ON public.assistant_threads (lower(actor_email), last_message_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_threads_one_active_per_actor
  ON public.assistant_threads (lower(actor_email)) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_assistant_messages_thread_recent
  ON public.assistant_messages (thread_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_assistant_generations_thread_recent
  ON public.assistant_generations (thread_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_generations_one_running_per_thread
  ON public.assistant_generations (thread_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_assistant_confirmations_thread_recent
  ON public.assistant_confirmations (thread_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_confirmations_pending
  ON public.assistant_confirmations (created_at ASC, id ASC) WHERE status = 'proposed';

CREATE OR REPLACE FUNCTION public.start_assistant_generation_v1(
  p_thread_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_surface text,
  p_user_content text,
  p_attachments jsonb,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  clean_actor text := lower(trim(coalesce(p_actor_email, '')));
  clean_name text := trim(coalesce(p_actor_name, ''));
  clean_content text := trim(coalesce(p_user_content, ''));
  clean_request text := trim(coalesce(p_request_id, ''));
  clean_surface text := lower(trim(coalesce(p_surface, 'ai_page')));
  target_thread public.assistant_threads;
  request_message public.assistant_messages;
  generation public.assistant_generations;
BEGIN
  IF clean_actor = '' OR clean_name = '' OR clean_request = '' THEN RAISE EXCEPTION 'invalid_assistant_identity'; END IF;
  IF char_length(clean_request) > 160 THEN RAISE EXCEPTION 'invalid_assistant_request_id'; END IF;
  IF char_length(clean_content) < 1 OR char_length(clean_content) > 50000 THEN RAISE EXCEPTION 'invalid_assistant_message'; END IF;
  IF clean_surface NOT IN ('ai_page', 'giraffe', 'api') THEN RAISE EXCEPTION 'invalid_assistant_surface'; END IF;
  IF jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'invalid_assistant_attachments'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('assistant-request:' || clean_actor || ':' || clean_request, 0)
  );
  SELECT * INTO generation FROM public.assistant_generations
  WHERE actor_email = clean_actor AND request_id = clean_request;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'created', false,
      'threadId', generation.thread_id,
      'generationId', generation.id,
      'requestMessageId', generation.request_message_id,
      'responseMessageId', generation.response_message_id,
      'status', generation.status
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('assistant-actor:' || clean_actor, 0)
  );

  IF p_thread_id IS NULL THEN
    SELECT * INTO target_thread FROM public.assistant_threads
    WHERE lower(actor_email) = clean_actor AND status = 'active'
    ORDER BY last_message_at DESC, id DESC
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.assistant_threads (actor_email, actor_name, title, surface)
      VALUES (clean_actor, clean_name, left(regexp_replace(clean_content, '[[:space:]]+', ' ', 'g'), 100), clean_surface)
      RETURNING * INTO target_thread;
    END IF;
  ELSE
    SELECT * INTO target_thread FROM public.assistant_threads
    WHERE id = p_thread_id AND lower(actor_email) = clean_actor AND status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'assistant_thread_not_found'; END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.assistant_generations
    WHERE thread_id = target_thread.id AND status = 'running'
  ) THEN RAISE EXCEPTION 'assistant_generation_in_progress'; END IF;

  INSERT INTO public.assistant_messages (thread_id, role, content, attachments)
  VALUES (target_thread.id, 'user', clean_content, coalesce(p_attachments, '[]'::jsonb))
  RETURNING * INTO request_message;

  INSERT INTO public.assistant_generations (
    thread_id, request_message_id, actor_email, request_id, status
  ) VALUES (
    target_thread.id, request_message.id, clean_actor, clean_request, 'running'
  ) RETURNING * INTO generation;

  UPDATE public.assistant_messages SET generation_id = generation.id WHERE id = request_message.id;
  UPDATE public.assistant_threads
  SET last_message_at = request_message.created_at, updated_at = now(), surface = clean_surface
  WHERE id = target_thread.id;

  RETURN jsonb_build_object(
    'created', true,
    'threadId', target_thread.id,
    'generationId', generation.id,
    'requestMessageId', request_message.id,
    'responseMessageId', NULL,
    'status', generation.status
  );
END
$$;
REVOKE ALL ON FUNCTION public.start_assistant_generation_v1(uuid,text,text,text,text,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_assistant_generation_v1(uuid,text,text,text,text,jsonb,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_assistant_generation_v1(
  p_generation_id uuid,
  p_actor_email text,
  p_response_content text,
  p_provider text,
  p_model text,
  p_finish_reason text,
  p_usage jsonb,
  p_estimated_cost_micros bigint,
  p_pricing_snapshot jsonb,
  p_tool_trace jsonb,
  p_sources jsonb,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  clean_actor text := lower(trim(coalesce(p_actor_email, '')));
  clean_content text := trim(coalesce(p_response_content, ''));
  generation public.assistant_generations;
  response_message public.assistant_messages;
BEGIN
  IF clean_content = '' OR char_length(clean_content) > 100000 THEN RAISE EXCEPTION 'invalid_assistant_response'; END IF;
  IF jsonb_typeof(coalesce(p_usage, '{}'::jsonb)) <> 'object'
    OR jsonb_typeof(coalesce(p_pricing_snapshot, '{}'::jsonb)) <> 'object'
    OR jsonb_typeof(coalesce(p_tool_trace, '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(coalesce(p_sources, '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
  THEN RAISE EXCEPTION 'invalid_assistant_generation_metadata'; END IF;

  SELECT * INTO generation FROM public.assistant_generations
  WHERE id = p_generation_id AND actor_email = clean_actor
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'assistant_generation_not_found'; END IF;
  IF generation.status = 'complete' THEN
    RETURN jsonb_build_object('generationId', generation.id, 'threadId', generation.thread_id,
      'responseMessageId', generation.response_message_id, 'status', generation.status);
  END IF;
  IF generation.status <> 'running' THEN RAISE EXCEPTION 'invalid_assistant_generation_transition'; END IF;

  INSERT INTO public.assistant_messages (
    thread_id, generation_id, role, content, sources, metadata
  ) VALUES (
    generation.thread_id, generation.id, 'assistant', clean_content,
    coalesce(p_sources, '[]'::jsonb), coalesce(p_metadata, '{}'::jsonb)
  ) RETURNING * INTO response_message;

  UPDATE public.assistant_generations SET
    response_message_id = response_message.id,
    status = 'complete',
    provider = nullif(trim(p_provider), ''),
    model = nullif(trim(p_model), ''),
    finish_reason = nullif(trim(p_finish_reason), ''),
    input_tokens = CASE WHEN (p_usage->>'inputTokens') ~ '^[0-9]+$' THEN (p_usage->>'inputTokens')::integer END,
    output_tokens = CASE WHEN (p_usage->>'outputTokens') ~ '^[0-9]+$' THEN (p_usage->>'outputTokens')::integer END,
    total_tokens = CASE WHEN (p_usage->>'totalTokens') ~ '^[0-9]+$' THEN (p_usage->>'totalTokens')::integer END,
    cache_read_tokens = CASE WHEN (p_usage->>'cacheReadTokens') ~ '^[0-9]+$' THEN (p_usage->>'cacheReadTokens')::integer END,
    estimated_cost_micros = p_estimated_cost_micros,
    pricing_snapshot = coalesce(p_pricing_snapshot, '{}'::jsonb),
    tool_trace = coalesce(p_tool_trace, '[]'::jsonb),
    source_snapshot = coalesce(p_sources, '[]'::jsonb),
    completed_at = now(), updated_at = now()
  WHERE id = generation.id
  RETURNING * INTO generation;

  UPDATE public.assistant_threads
  SET last_message_at = response_message.created_at, updated_at = now()
  WHERE id = generation.thread_id;

  RETURN jsonb_build_object('generationId', generation.id, 'threadId', generation.thread_id,
    'responseMessageId', response_message.id, 'status', generation.status);
END
$$;
REVOKE ALL ON FUNCTION public.complete_assistant_generation_v1(uuid,text,text,text,text,text,jsonb,bigint,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_assistant_generation_v1(uuid,text,text,text,text,text,jsonb,bigint,jsonb,jsonb,jsonb,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fail_assistant_generation_v1(
  p_generation_id uuid,
  p_actor_email text,
  p_error_code text,
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.assistant_generations SET
    status = 'error',
    error_code = left(nullif(trim(p_error_code), ''), 120),
    error_message = left(nullif(trim(p_error_message), ''), 1000),
    completed_at = now(), updated_at = now()
  WHERE id = p_generation_id
    AND actor_email = lower(trim(p_actor_email))
    AND status = 'running';
END
$$;
REVOKE ALL ON FUNCTION public.fail_assistant_generation_v1(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_assistant_generation_v1(uuid,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.archive_assistant_thread_v1(
  p_thread_id uuid,
  p_actor_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  clean_actor text := lower(trim(coalesce(p_actor_email, '')));
  target_thread public.assistant_threads;
BEGIN
  SELECT * INTO target_thread FROM public.assistant_threads
  WHERE id = p_thread_id AND lower(actor_email) = clean_actor
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'assistant_thread_not_found'; END IF;
  IF target_thread.status = 'archived' THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.assistant_generations
    WHERE thread_id = target_thread.id AND status = 'running'
  ) THEN RAISE EXCEPTION 'assistant_generation_in_progress'; END IF;
  UPDATE public.assistant_threads
  SET status = 'archived', updated_at = now()
  WHERE id = target_thread.id;
END
$$;
REVOKE ALL ON FUNCTION public.archive_assistant_thread_v1(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_assistant_thread_v1(uuid,text)
  TO service_role;

COMMENT ON TABLE public.assistant_threads IS 'Actor-owned, durable SavingKC assistant conversations shared by /ai and Giraffe.';
COMMENT ON TABLE public.assistant_messages IS 'Durable user and assistant messages with attachment metadata and source citations.';
COMMENT ON TABLE public.assistant_generations IS 'One ledger row per LLM call with provider, model, usage, estimated cost, tools, and outcome.';
COMMENT ON TABLE public.assistant_confirmations IS 'Explicit human decision ledger for future consequential assistant actions; no mutation tools are enabled by this migration.';
