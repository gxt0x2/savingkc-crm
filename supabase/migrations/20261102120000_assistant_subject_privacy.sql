-- Bind interactive assistant history to the immutable authenticated subject.
-- Email remains display/audit metadata and is no longer the authorization key.

ALTER TABLE public.assistant_threads
  ADD COLUMN IF NOT EXISTS actor_subject text;

ALTER TABLE public.assistant_generations
  ADD COLUMN IF NOT EXISTS actor_subject text;

UPDATE public.assistant_threads AS thread
SET actor_subject = auth_user.id::text
FROM auth.users AS auth_user
WHERE thread.actor_subject IS NULL
  AND lower(thread.actor_email) = lower(auth_user.email);

UPDATE public.assistant_generations AS generation
SET actor_subject = thread.actor_subject
FROM public.assistant_threads AS thread
WHERE generation.thread_id = thread.id
  AND generation.actor_subject IS NULL
  AND thread.actor_subject IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assistant_threads_subject_recent
  ON public.assistant_threads (actor_subject, last_message_at DESC, id DESC)
  WHERE actor_subject IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_threads_one_active_per_subject
  ON public.assistant_threads (actor_subject)
  WHERE status = 'active' AND actor_subject IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_generations_subject_request
  ON public.assistant_generations (actor_subject, request_id)
  WHERE actor_subject IS NOT NULL;

CREATE OR REPLACE FUNCTION public.start_assistant_generation_v2(
  p_thread_id uuid,
  p_actor_subject text,
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
  clean_subject text := trim(coalesce(p_actor_subject, ''));
  clean_actor text := lower(trim(coalesce(p_actor_email, '')));
  clean_name text := trim(coalesce(p_actor_name, ''));
  clean_content text := trim(coalesce(p_user_content, ''));
  clean_request text := trim(coalesce(p_request_id, ''));
  clean_surface text := lower(trim(coalesce(p_surface, 'ai_page')));
  target_thread public.assistant_threads;
  request_message public.assistant_messages;
  generation public.assistant_generations;
BEGIN
  IF clean_subject = '' OR char_length(clean_subject) > 200
    OR clean_actor = '' OR clean_name = '' OR clean_request = ''
  THEN RAISE EXCEPTION 'invalid_assistant_identity'; END IF;
  IF char_length(clean_request) > 160 THEN RAISE EXCEPTION 'invalid_assistant_request_id'; END IF;
  IF char_length(clean_content) < 1 OR char_length(clean_content) > 50000 THEN RAISE EXCEPTION 'invalid_assistant_message'; END IF;
  IF clean_surface NOT IN ('ai_page', 'giraffe', 'api') THEN RAISE EXCEPTION 'invalid_assistant_surface'; END IF;
  IF jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'invalid_assistant_attachments'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('assistant-request-subject:' || clean_subject || ':' || clean_request, 0)
  );
  SELECT * INTO generation FROM public.assistant_generations
  WHERE actor_subject = clean_subject AND request_id = clean_request;
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
    pg_catalog.hashtextextended('assistant-subject:' || clean_subject, 0)
  );

  IF p_thread_id IS NULL THEN
    SELECT * INTO target_thread FROM public.assistant_threads
    WHERE actor_subject = clean_subject AND status = 'active'
    ORDER BY last_message_at DESC, id DESC
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.assistant_threads (
        actor_subject, actor_email, actor_name, title, surface
      ) VALUES (
        clean_subject, clean_actor, clean_name,
        left(regexp_replace(clean_content, '[[:space:]]+', ' ', 'g'), 100), clean_surface
      ) RETURNING * INTO target_thread;
    ELSE
      UPDATE public.assistant_threads SET
        actor_email = clean_actor,
        actor_name = clean_name,
        updated_at = now()
      WHERE id = target_thread.id
      RETURNING * INTO target_thread;
    END IF;
  ELSE
    SELECT * INTO target_thread FROM public.assistant_threads
    WHERE id = p_thread_id AND actor_subject = clean_subject AND status = 'active'
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
    thread_id, request_message_id, actor_subject, actor_email, request_id, status
  ) VALUES (
    target_thread.id, request_message.id, clean_subject, clean_actor, clean_request, 'running'
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

REVOKE ALL ON FUNCTION public.start_assistant_generation_v2(uuid,text,text,text,text,text,jsonb,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_assistant_generation_v2(uuid,text,text,text,text,text,jsonb,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_assistant_generation_v2(
  p_generation_id uuid,
  p_actor_subject text,
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
  clean_subject text := trim(coalesce(p_actor_subject, ''));
  clean_content text := trim(coalesce(p_response_content, ''));
  generation public.assistant_generations;
  response_message public.assistant_messages;
BEGIN
  IF clean_subject = '' OR char_length(clean_subject) > 200 THEN RAISE EXCEPTION 'invalid_assistant_identity'; END IF;
  IF clean_content = '' OR char_length(clean_content) > 100000 THEN RAISE EXCEPTION 'invalid_assistant_response'; END IF;
  IF jsonb_typeof(coalesce(p_usage, '{}'::jsonb)) <> 'object'
    OR jsonb_typeof(coalesce(p_pricing_snapshot, '{}'::jsonb)) <> 'object'
    OR jsonb_typeof(coalesce(p_tool_trace, '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(coalesce(p_sources, '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
  THEN RAISE EXCEPTION 'invalid_assistant_generation_metadata'; END IF;

  SELECT * INTO generation FROM public.assistant_generations
  WHERE id = p_generation_id AND actor_subject = clean_subject
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
  WHERE id = generation.thread_id AND actor_subject = clean_subject;

  RETURN jsonb_build_object('generationId', generation.id, 'threadId', generation.thread_id,
    'responseMessageId', response_message.id, 'status', generation.status);
END
$$;

REVOKE ALL ON FUNCTION public.complete_assistant_generation_v2(uuid,text,text,text,text,text,jsonb,bigint,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_assistant_generation_v2(uuid,text,text,text,text,text,jsonb,bigint,jsonb,jsonb,jsonb,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fail_assistant_generation_v2(
  p_generation_id uuid,
  p_actor_subject text,
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
    AND actor_subject = trim(p_actor_subject)
    AND status = 'running';
END
$$;

REVOKE ALL ON FUNCTION public.fail_assistant_generation_v2(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_assistant_generation_v2(uuid,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.archive_assistant_thread_v2(
  p_thread_id uuid,
  p_actor_subject text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  clean_subject text := trim(coalesce(p_actor_subject, ''));
  target_thread public.assistant_threads;
BEGIN
  IF clean_subject = '' OR char_length(clean_subject) > 200 THEN RAISE EXCEPTION 'invalid_assistant_identity'; END IF;
  SELECT * INTO target_thread FROM public.assistant_threads
  WHERE id = p_thread_id AND actor_subject = clean_subject
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'assistant_thread_not_found'; END IF;
  IF target_thread.status = 'archived' THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.assistant_generations
    WHERE thread_id = target_thread.id AND status = 'running'
  ) THEN RAISE EXCEPTION 'assistant_generation_in_progress'; END IF;
  UPDATE public.assistant_threads
  SET status = 'archived', updated_at = now()
  WHERE id = target_thread.id AND actor_subject = clean_subject;
END
$$;

REVOKE ALL ON FUNCTION public.archive_assistant_thread_v2(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_assistant_thread_v2(uuid,text)
  TO service_role;

COMMENT ON COLUMN public.assistant_threads.actor_subject IS
  'Immutable authenticated subject that owns an interactive assistant conversation.';
COMMENT ON COLUMN public.assistant_generations.actor_subject IS
  'Immutable authenticated subject authorized to replay or complete this generation.';
