-- Standalone AI artifacts use the existing assistant generation ledger without
-- polluting the actor's active chat thread. The archived thread keeps every
-- prompt/result addressable while preserving the one-active-chat invariant.

CREATE OR REPLACE FUNCTION public.start_assistant_artifact_generation_v1(
  p_actor_email text,
  p_actor_name text,
  p_title text,
  p_user_content text,
  p_request_id text,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  clean_actor text := lower(trim(coalesce(p_actor_email, '')));
  clean_name text := trim(coalesce(p_actor_name, ''));
  clean_title text := trim(coalesce(p_title, ''));
  clean_content text := trim(coalesce(p_user_content, ''));
  clean_request text := trim(coalesce(p_request_id, ''));
  target_thread public.assistant_threads;
  request_message public.assistant_messages;
  generation public.assistant_generations;
BEGIN
  IF clean_actor = '' OR clean_name = '' OR clean_title = '' OR clean_request = '' THEN
    RAISE EXCEPTION 'invalid_assistant_identity';
  END IF;
  IF char_length(clean_request) > 160 THEN RAISE EXCEPTION 'invalid_assistant_request_id'; END IF;
  IF char_length(clean_title) > 100 OR char_length(clean_content) < 1 OR char_length(clean_content) > 50000 THEN
    RAISE EXCEPTION 'invalid_assistant_message';
  END IF;
  IF jsonb_typeof(coalesce(p_context, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid_assistant_context';
  END IF;

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

  INSERT INTO public.assistant_threads (
    actor_email, actor_name, title, status, surface, context
  ) VALUES (
    clean_actor, clean_name, clean_title, 'archived', 'api', coalesce(p_context, '{}'::jsonb)
  ) RETURNING * INTO target_thread;

  INSERT INTO public.assistant_messages (thread_id, role, content, attachments)
  VALUES (target_thread.id, 'user', clean_content, '[]'::jsonb)
  RETURNING * INTO request_message;

  INSERT INTO public.assistant_generations (
    thread_id, request_message_id, actor_email, request_id, status
  ) VALUES (
    target_thread.id, request_message.id, clean_actor, clean_request, 'running'
  ) RETURNING * INTO generation;

  UPDATE public.assistant_messages SET generation_id = generation.id WHERE id = request_message.id;
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

REVOKE ALL ON FUNCTION public.start_assistant_artifact_generation_v1(text,text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_assistant_artifact_generation_v1(text,text,text,text,text,jsonb)
  TO service_role;

COMMENT ON FUNCTION public.start_assistant_artifact_generation_v1(text,text,text,text,text,jsonb) IS
  'Starts an idempotent, archived, feature-scoped AI artifact in the canonical generation ledger.';
