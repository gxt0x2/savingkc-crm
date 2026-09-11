-- Keep the working inbox focused on the last 24 hours while retaining older
-- threads in a server-owned Recent view. Direct thread lookup may request all.

CREATE OR REPLACE FUNCTION public.conversation_thread_page_v3(
  page_limit integer DEFAULT 51,
  page_queue text DEFAULT 'needs_reply',
  page_actor text DEFAULT NULL,
  page_channel text DEFAULT NULL,
  page_query text DEFAULT NULL,
  page_kind text DEFAULT 'all',
  page_timeframe text DEFAULT 'inbox',
  after_attention_rank smallint DEFAULT NULL,
  after_activity_at timestamptz DEFAULT NULL,
  after_thread_key text DEFAULT NULL
)
RETURNS SETOF public.conversation_thread_state
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  clean_kind text := lower(trim(coalesce(page_kind, 'all')));
  clean_timeframe text := lower(trim(coalesce(page_timeframe, 'inbox')));
  inbox_cutoff timestamptz := now() - interval '24 hours';
BEGIN
  IF clean_kind NOT IN ('all', 'known', 'unmatched') THEN
    RAISE EXCEPTION 'invalid_conversation_kind';
  END IF;
  IF clean_timeframe NOT IN ('inbox', 'recent', 'all') THEN
    RAISE EXCEPTION 'invalid_conversation_timeframe';
  END IF;

  RETURN QUERY
  SELECT thread.*
  FROM public.conversation_thread_state AS thread
  WHERE (
      page_queue = 'all'
      OR (page_queue = 'needs_reply' AND thread.attention_state = 'needs_reply')
      OR (page_queue = 'mine' AND NULLIF(btrim(page_actor), '') IS NOT NULL AND lower(thread.owner) = lower(page_actor))
      OR (page_queue = 'unassigned' AND NULLIF(btrim(thread.owner), '') IS NULL)
    )
    AND (clean_kind = 'all'
      OR (clean_kind = 'known' AND thread.lead_id IS NOT NULL)
      OR (clean_kind = 'unmatched' AND thread.lead_id IS NULL))
    AND (clean_timeframe = 'all'
      OR (clean_timeframe = 'inbox' AND thread.last_activity_at >= inbox_cutoff)
      OR (clean_timeframe = 'recent' AND thread.last_activity_at < inbox_cutoff))
    AND (page_channel IS NULL OR thread.last_channel = page_channel)
    AND (NULLIF(btrim(page_query), '') IS NULL OR thread.search_text ILIKE '%' || btrim(page_query) || '%')
    AND (
      after_attention_rank IS NULL
      OR thread.attention_rank > after_attention_rank
      OR (thread.attention_rank = after_attention_rank AND thread.last_activity_at < after_activity_at)
      OR (thread.attention_rank = after_attention_rank AND thread.last_activity_at = after_activity_at AND thread.thread_key < after_thread_key)
    )
  ORDER BY thread.attention_rank ASC, thread.last_activity_at DESC, thread.thread_key DESC
  LIMIT least(greatest(coalesce(page_limit, 51), 1), 101);
END
$$;

REVOKE ALL ON FUNCTION public.conversation_thread_page_v3(integer, text, text, text, text, text, text, smallint, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_thread_page_v3(integer, text, text, text, text, text, text, smallint, timestamptz, text)
  TO service_role;

COMMENT ON FUNCTION public.conversation_thread_page_v3(integer, text, text, text, text, text, text, smallint, timestamptz, text) IS
  'Returns a cursor-paginated conversation page split into a rolling 24-hour inbox, older recent threads, or all threads for direct lookup.';
