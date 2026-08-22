-- Durable Mojo-style campaign batches for the single-line dialer.
-- A campaign can contain any audience size while each focused calling session
-- remains capped at 100 contacts. Campaign members are claimed atomically and
-- progress is projected from the durable dialer event stream.

ALTER TABLE public.prospecting_campaign_members
  ADD COLUMN IF NOT EXISTS dialer_session_id uuid REFERENCES public.dialer_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_members_next_dialer_batch
  ON public.prospecting_campaign_members (campaign_id, enrolled_at, id)
  WHERE status = 'active' AND dialer_session_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_members_dialer_session
  ON public.prospecting_campaign_members (dialer_session_id, lead_id)
  WHERE dialer_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_open_prospecting_dialer_member_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'removed'
    AND OLD.status IS DISTINCT FROM NEW.status
    AND OLD.dialer_session_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.dialer_sessions
      WHERE id = OLD.dialer_session_id AND status IN ('active', 'paused')
    ) THEN
    RAISE EXCEPTION 'campaign_member_in_active_dialer_batch';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.guard_open_prospecting_dialer_member_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_open_prospecting_dialer_member_v1() TO service_role;

DROP TRIGGER IF EXISTS prospecting_guard_open_dialer_member ON public.prospecting_campaign_members;
CREATE TRIGGER prospecting_guard_open_dialer_member
  BEFORE UPDATE OF status ON public.prospecting_campaign_members
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_open_prospecting_dialer_member_v1();

CREATE OR REPLACE FUNCTION public.start_prospecting_dialer_session_v1(
  p_campaign_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_caller_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_key text := lower(trim(coalesce(p_actor_email, '')));
  campaign_row public.prospecting_campaigns;
  open_session public.dialer_sessions;
  member_ids uuid[];
  lead_ids uuid[];
  session_result jsonb;
  session_id uuid;
  remaining integer;
BEGIN
  IF actor_key = '' OR coalesce(trim(p_actor_name), '') = '' THEN RAISE EXCEPTION 'invalid_actor'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dialer-actor:' || actor_key, 0));

  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id AND lower(owner_email) = actor_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.kind <> 'dialer' THEN RAISE EXCEPTION 'invalid_campaign_kind'; END IF;
  IF campaign_row.status <> 'active' THEN RAISE EXCEPTION 'invalid_campaign_transition'; END IF;
  IF nullif(trim(coalesce(p_caller_id, '')), '') IS NULL
    OR trim(p_caller_id) IS DISTINCT FROM trim(campaign_row.caller_id) THEN
    RAISE EXCEPTION 'invalid_caller_id';
  END IF;

  SELECT * INTO open_session
  FROM public.dialer_sessions
  WHERE lower(actor_email) = actor_key AND status IN ('active', 'paused')
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'created', false,
      'session', public.dialer_session_json_v1(open_session),
      'batchSize', open_session.queue_size,
      'remaining', (SELECT count(*) FROM public.prospecting_campaign_members WHERE campaign_id = p_campaign_id AND status = 'active' AND dialer_session_id IS NULL)
    );
  END IF;

  SELECT array_agg(candidate.id ORDER BY candidate.enrolled_at, candidate.id),
         array_agg(candidate.lead_id ORDER BY candidate.enrolled_at, candidate.id)
  INTO member_ids, lead_ids
  FROM (
    SELECT member.id, member.lead_id, member.enrolled_at
    FROM public.prospecting_campaign_members member
    WHERE member.campaign_id = p_campaign_id
      AND member.status = 'active'
      AND member.dialer_session_id IS NULL
    ORDER BY member.enrolled_at, member.id
    LIMIT 100
    FOR UPDATE
  ) candidate;

  IF coalesce(cardinality(lead_ids), 0) = 0 THEN RAISE EXCEPTION 'campaign_dialer_complete'; END IF;

  session_result := public.start_dialer_session_v1(
    actor_key,
    trim(p_actor_name),
    'campaign:' || p_campaign_id::text,
    lead_ids,
    trim(p_caller_id),
    NULL,
    jsonb_build_object('prospectingCampaignId', p_campaign_id, 'campaignName', campaign_row.name)
  );
  session_id := (session_result -> 'session' ->> 'id')::uuid;

  UPDATE public.dialer_sessions
  SET prospecting_campaign_id = p_campaign_id
  WHERE id = session_id AND lower(actor_email) = actor_key;

  UPDATE public.prospecting_campaign_members
  SET dialer_session_id = session_id, updated_at = now()
  WHERE id = ANY(member_ids) AND campaign_id = p_campaign_id AND status = 'active' AND dialer_session_id IS NULL;

  SELECT count(*) INTO remaining
  FROM public.prospecting_campaign_members
  WHERE campaign_id = p_campaign_id AND status = 'active' AND dialer_session_id IS NULL;

  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (p_campaign_id, 'dialer_batch_started', trim(p_actor_name), jsonb_build_object(
    'dialer_session_id', session_id,
    'batch_size', cardinality(lead_ids),
    'remaining', remaining
  ));

  RETURN session_result || jsonb_build_object('batchSize', cardinality(lead_ids), 'remaining', remaining);
END
$$;

REVOKE ALL ON FUNCTION public.start_prospecting_dialer_session_v1(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_prospecting_dialer_session_v1(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.project_prospecting_dialer_event_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_row public.dialer_sessions;
  member_row public.prospecting_campaign_members;
BEGIN
  IF NEW.event_type <> 'lead_completed' THEN RETURN NEW; END IF;

  SELECT * INTO session_row FROM public.dialer_sessions WHERE id = NEW.session_id;
  IF NOT FOUND OR session_row.prospecting_campaign_id IS NULL OR NEW.lead_id IS NULL THEN RETURN NEW; END IF;

  UPDATE public.prospecting_campaign_members
  SET status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
  WHERE campaign_id = session_row.prospecting_campaign_id
    AND lead_id = NEW.lead_id
    AND status = 'active'
  RETURNING * INTO member_row;

  IF FOUND THEN
    INSERT INTO public.prospecting_campaign_events (campaign_id, member_id, event_type, actor, metadata)
    VALUES (member_row.campaign_id, member_row.id, 'member_call_completed', session_row.agent_name, jsonb_build_object(
      'dialer_session_id', NEW.session_id,
      'disposition', NEW.disposition,
      'phone', NEW.phone
    ));

    IF NOT EXISTS (
      SELECT 1 FROM public.prospecting_campaign_members
      WHERE campaign_id = member_row.campaign_id AND status = 'active'
    ) THEN
      UPDATE public.prospecting_campaigns
      SET status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
      WHERE id = member_row.campaign_id AND status = 'active';
    ELSE
      UPDATE public.prospecting_campaigns SET updated_at = now() WHERE id = member_row.campaign_id;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.project_prospecting_dialer_event_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_prospecting_dialer_event_v1() TO service_role;

DROP TRIGGER IF EXISTS prospecting_project_dialer_event ON public.dialer_session_events;
CREATE TRIGGER prospecting_project_dialer_event
  AFTER INSERT ON public.dialer_session_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'lead_completed')
  EXECUTE FUNCTION public.project_prospecting_dialer_event_v1();

CREATE OR REPLACE FUNCTION public.release_prospecting_dialer_batch_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IN ('completed', 'stopped') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.prospecting_campaign_members
    SET dialer_session_id = NULL, updated_at = now()
    WHERE dialer_session_id = NEW.id AND status = 'active';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.release_prospecting_dialer_batch_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_prospecting_dialer_batch_v1() TO service_role;

DROP TRIGGER IF EXISTS prospecting_release_dialer_batch ON public.dialer_sessions;
CREATE TRIGGER prospecting_release_dialer_batch
  AFTER UPDATE OF status ON public.dialer_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.release_prospecting_dialer_batch_v1();
