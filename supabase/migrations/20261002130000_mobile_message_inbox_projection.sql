-- The mobile Inbox is message-first: a newer call must not hide an older SMS
-- or email. Keep a rebuildable, one-row-per-thread SMS/email projection.
CREATE TABLE IF NOT EXISTS public.mobile_message_thread_state (
  thread_key text PRIMARY KEY,
  lead_id uuid,
  phone text,
  attention_state text NOT NULL DEFAULT 'resolved',
  attention_rank smallint GENERATED ALWAYS AS (
    CASE attention_state WHEN 'needs_reply' THEN 0 WHEN 'waiting_on_contact' THEN 1 ELSE 2 END
  ) STORED,
  owner text,
  last_channel text NOT NULL,
  last_direction text NOT NULL,
  last_communication_id uuid NOT NULL,
  last_communication_type text NOT NULL,
  last_communication_description text,
  last_communication_agent text,
  last_communication_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_communication_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  primary_next_action_id uuid,
  primary_next_action_title text,
  primary_next_action_due_at timestamptz,
  primary_next_action_owner text,
  search_text text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mobile_message_thread_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mobile_message_thread_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mobile_message_thread_state TO service_role;
CREATE INDEX IF NOT EXISTS idx_mobile_message_thread_inbox
  ON public.mobile_message_thread_state(attention_rank, last_activity_at DESC, thread_key DESC);
CREATE INDEX IF NOT EXISTS idx_mobile_message_thread_channel
  ON public.mobile_message_thread_state(last_channel, attention_rank, last_activity_at DESC, thread_key DESC);

CREATE OR REPLACE FUNCTION public.refresh_mobile_message_thread_state(target_thread_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  message_row record;
  lead_row record;
  resolved_phone text;
  resolved_attention text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mobile_message_thread:' || target_thread_key, 0));
  SELECT a.* INTO message_row
  FROM public.lead_activities a
  WHERE public.conversation_activity_thread_key(a.lead_id, a.id, a.activity_type, a.metadata) = target_thread_key
    AND a.activity_type IN ('sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound', 'email', 'email_sent', 'email_received')
    AND public.conversation_is_customer_communication(a.activity_type, a.metadata)
    AND NOT public.conversation_is_legacy_team_alert(a.activity_type, a.description, a.metadata)
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT 1;

  IF message_row.id IS NULL THEN
    -- hygiene-approved-destructive: remove only an empty rebuildable message
    -- projection row; every canonical source lead_activity remains intact.
    DELETE FROM public.mobile_message_thread_state WHERE thread_key = target_thread_key;
    RETURN;
  END IF;

  SELECT l.* INTO lead_row FROM public.leads l WHERE l.id = message_row.lead_id;
  resolved_phone := COALESCE(
    public.normalize_conversation_phone(lead_row.phone),
    public.conversation_activity_phone(message_row.activity_type, message_row.metadata)
  );
  resolved_attention := CASE
    WHEN public.conversation_activity_direction(message_row.activity_type, message_row.metadata) = 'outbound' THEN 'waiting_on_contact'
    WHEN public.conversation_inbound_needs_reply(message_row.activity_type, message_row.description, message_row.metadata) THEN 'needs_reply'
    ELSE 'resolved'
  END;

  INSERT INTO public.mobile_message_thread_state (
    thread_key, lead_id, phone, attention_state, owner, last_channel, last_direction,
    last_communication_id, last_communication_type, last_communication_description,
    last_communication_agent, last_communication_metadata, last_communication_at,
    last_activity_at, search_text, updated_at
  ) VALUES (
    target_thread_key, message_row.lead_id, resolved_phone, resolved_attention,
    NULLIF(btrim(lead_row.assigned_agent), ''),
    CASE WHEN message_row.activity_type LIKE 'sms%' THEN 'sms' ELSE 'email' END,
    public.conversation_activity_direction(message_row.activity_type, message_row.metadata),
    message_row.id, message_row.activity_type, message_row.description, message_row.agent,
    COALESCE(message_row.metadata, '{}'::jsonb), message_row.created_at, message_row.created_at,
    lower(concat_ws(' ', target_thread_key, message_row.lead_id, lead_row.full_name, lead_row.phone,
      resolved_phone, lead_row.email, lead_row.property_address, lead_row.city, lead_row.county, message_row.description)), now()
  ) ON CONFLICT (thread_key) DO UPDATE SET
    lead_id = EXCLUDED.lead_id, phone = EXCLUDED.phone, attention_state = EXCLUDED.attention_state,
    owner = EXCLUDED.owner, last_channel = EXCLUDED.last_channel, last_direction = EXCLUDED.last_direction,
    last_communication_id = EXCLUDED.last_communication_id,
    last_communication_type = EXCLUDED.last_communication_type,
    last_communication_description = EXCLUDED.last_communication_description,
    last_communication_agent = EXCLUDED.last_communication_agent,
    last_communication_metadata = EXCLUDED.last_communication_metadata,
    last_communication_at = EXCLUDED.last_communication_at, last_activity_at = EXCLUDED.last_activity_at,
    search_text = EXCLUDED.search_text, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_mobile_message_thread_state_from_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE old_key text; new_key text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_key := public.conversation_activity_thread_key(OLD.lead_id, OLD.id, OLD.activity_type, OLD.metadata); END IF;
  IF TG_OP <> 'DELETE' THEN new_key := public.conversation_activity_thread_key(NEW.lead_id, NEW.id, NEW.activity_type, NEW.metadata); END IF;
  IF old_key IS NOT NULL THEN PERFORM public.refresh_mobile_message_thread_state(old_key); END IF;
  IF new_key IS NOT NULL AND new_key IS DISTINCT FROM old_key THEN PERFORM public.refresh_mobile_message_thread_state(new_key);
  ELSIF TG_OP = 'INSERT' AND new_key IS NOT NULL THEN PERFORM public.refresh_mobile_message_thread_state(new_key); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_sync_mobile_message_thread_state_activity ON public.lead_activities;
CREATE TRIGGER trigger_sync_mobile_message_thread_state_activity
AFTER INSERT OR DELETE OR UPDATE OF lead_id, activity_type, description, metadata, created_at
ON public.lead_activities FOR EACH ROW
EXECUTE FUNCTION public.sync_mobile_message_thread_state_from_activity();

CREATE OR REPLACE FUNCTION public.sync_mobile_message_thread_state_from_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.refresh_mobile_message_thread_state('lead:' || NEW.id::text);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_sync_mobile_message_thread_state_lead ON public.leads;
CREATE TRIGGER trigger_sync_mobile_message_thread_state_lead
AFTER UPDATE OF full_name, phone, email, property_address, city, county, assigned_agent
ON public.leads FOR EACH ROW EXECUTE FUNCTION public.sync_mobile_message_thread_state_from_lead();

-- One controlled initial projection backfill; subsequent writes stay current
-- through the trigger above. Source activities remain untouched.
DO $$
DECLARE candidate record;
BEGIN
  FOR candidate IN
    SELECT DISTINCT public.conversation_activity_thread_key(a.lead_id, a.id, a.activity_type, a.metadata) AS thread_key
    FROM public.lead_activities a
    WHERE a.activity_type IN ('sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound', 'email', 'email_sent', 'email_received')
      AND public.conversation_is_customer_communication(a.activity_type, a.metadata)
      AND NOT public.conversation_is_legacy_team_alert(a.activity_type, a.description, a.metadata)
    ORDER BY 1
  LOOP
    PERFORM public.refresh_mobile_message_thread_state(candidate.thread_key);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.conversation_message_thread_page_v1(
  page_limit integer DEFAULT 51, page_queue text DEFAULT 'all', page_actor text DEFAULT NULL,
  page_channel text DEFAULT NULL, page_query text DEFAULT NULL, page_kind text DEFAULT 'all',
  page_timeframe text DEFAULT 'all', after_attention_rank smallint DEFAULT NULL,
  after_activity_at timestamptz DEFAULT NULL, after_thread_key text DEFAULT NULL,
  page_actor_aliases text[] DEFAULT ARRAY[]::text[], page_company_wide boolean DEFAULT false
)
RETURNS SETOF public.mobile_message_thread_state
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT thread.* FROM public.mobile_message_thread_state thread
  WHERE (page_channel IS NULL OR thread.last_channel = page_channel)
    AND (page_kind = 'all' OR (page_kind = 'known' AND thread.lead_id IS NOT NULL) OR (page_kind = 'unmatched' AND thread.lead_id IS NULL))
    AND (NULLIF(btrim(page_query), '') IS NULL OR thread.search_text ILIKE '%' || btrim(page_query) || '%')
    AND (page_queue = 'all' OR (page_queue = 'needs_reply' AND thread.attention_state = 'needs_reply')
      OR (page_queue = 'mine' AND NULLIF(btrim(page_actor), '') IS NOT NULL AND lower(thread.owner) = lower(page_actor))
      OR (page_queue = 'unassigned' AND NULLIF(btrim(thread.owner), '') IS NULL))
    AND (page_timeframe = 'all' OR (page_timeframe = 'inbox' AND thread.last_activity_at >= now() - interval '24 hours')
      OR (page_timeframe = 'recent' AND thread.last_activity_at < now() - interval '24 hours'))
    AND (page_company_wide OR EXISTS (
      SELECT 1 FROM public.leads assigned_lead
      WHERE assigned_lead.id = thread.lead_id
        AND NULLIF(btrim(assigned_lead.assigned_agent), '') IS NOT NULL
        AND lower(btrim(assigned_lead.assigned_agent)) IN (
          SELECT lower(btrim(alias_name)) FROM unnest(COALESCE(page_actor_aliases, ARRAY[]::text[])) alias_name
        )
    ))
    AND (after_attention_rank IS NULL OR thread.attention_rank > after_attention_rank
      OR (thread.attention_rank = after_attention_rank AND thread.last_activity_at < after_activity_at)
      OR (thread.attention_rank = after_attention_rank AND thread.last_activity_at = after_activity_at AND thread.thread_key < after_thread_key))
  ORDER BY thread.attention_rank, thread.last_activity_at DESC, thread.thread_key DESC
  LIMIT least(greatest(coalesce(page_limit, 51), 1), 101);
$$;
REVOKE ALL ON FUNCTION public.conversation_message_thread_page_v1(integer, text, text, text, text, text, text, smallint, timestamptz, text, text[], boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conversation_message_thread_page_v1(integer, text, text, text, text, text, text, smallint, timestamptz, text, text[], boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.refresh_mobile_message_thread_state(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_mobile_message_thread_state_from_activity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_mobile_message_thread_state_from_lead() FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
