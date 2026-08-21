-- Shared Prospecting V1 campaign spine for the single-line dialer and SMS
-- sequences. lead_activities remains communication source-of-truth; these
-- tables own campaign intent, enrollment, scheduling, and execution audit.

CREATE TABLE IF NOT EXISTS public.prospecting_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('dialer', 'sms')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  owner_email text NOT NULL,
  owner_name text NOT NULL,
  caller_id text,
  from_phone text,
  default_timezone text NOT NULL DEFAULT 'America/Chicago',
  send_window_start time NOT NULL DEFAULT time '09:00',
  send_window_end time NOT NULL DEFAULT time '19:00',
  send_days smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6]::smallint[],
  per_hour integer NOT NULL DEFAULT 150 CHECK (per_hour BETWEEN 1 AND 5000),
  per_day integer NOT NULL DEFAULT 1000 CHECK (per_day BETWEEN 1 AND 50000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT prospecting_campaign_channel_config CHECK (
    (kind = 'dialer' AND nullif(trim(coalesce(caller_id, '')), '') IS NOT NULL)
    OR
    (kind = 'sms' AND nullif(trim(coalesce(from_phone, '')), '') IS NOT NULL)
  ),
  CONSTRAINT prospecting_campaign_send_window CHECK (send_window_start < send_window_end),
  CONSTRAINT prospecting_campaign_send_days CHECK (
    cardinality(send_days) BETWEEN 1 AND 7
    AND send_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
  )
);

CREATE TABLE IF NOT EXISTS public.prospecting_campaign_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.prospecting_campaigns(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 12),
  delay_minutes integer NOT NULL DEFAULT 0 CHECK (delay_minutes BETWEEN 0 AND 43200),
  body_template text NOT NULL CHECK (char_length(trim(body_template)) BETWEEN 1 AND 1400),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, position)
);

CREATE TABLE IF NOT EXISTS public.prospecting_campaign_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.prospecting_campaigns(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  phone_snapshot text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suppressed', 'replied', 'completed', 'removed')),
  suppression_reason text,
  current_step_position smallint NOT NULL DEFAULT 0 CHECK (current_step_position BETWEEN 0 AND 12),
  next_action_at timestamptz,
  enrolled_by text NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (campaign_id, lead_id)
);

CREATE TABLE IF NOT EXISTS public.prospecting_campaign_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.prospecting_campaigns(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.prospecting_campaign_members(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.prospecting_campaign_steps(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'sent', 'delivered', 'replied', 'blocked', 'failed', 'cancelled')),
  scheduled_at timestamptz NOT NULL,
  worker_token uuid,
  lease_expires_at timestamptz,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  rendered_body text,
  provider_sid text,
  error_code text,
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, step_id)
);

CREATE TABLE IF NOT EXISTS public.prospecting_sms_reservations (
  action_id uuid PRIMARY KEY REFERENCES public.prospecting_campaign_actions(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.prospecting_campaigns(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'consumed', 'released')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.prospecting_campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.prospecting_campaigns(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.prospecting_campaign_members(id) ON DELETE SET NULL,
  action_id uuid REFERENCES public.prospecting_campaign_actions(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospecting_campaigns_owner_history
  ON public.prospecting_campaigns (lower(owner_email), updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_members_campaign_status
  ON public.prospecting_campaign_members (campaign_id, status, enrolled_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_members_lead_active
  ON public.prospecting_campaign_members (lead_id, campaign_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_actions_due
  ON public.prospecting_campaign_actions (scheduled_at, id)
  WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_actions_campaign_history
  ON public.prospecting_campaign_actions (campaign_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_events_history
  ON public.prospecting_campaign_events (campaign_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_prospecting_sms_reservations_recent
  ON public.prospecting_sms_reservations (reserved_at DESC)
  WHERE status = 'reserved';

ALTER TABLE public.prospecting_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospecting_campaign_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospecting_campaign_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospecting_campaign_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospecting_sms_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospecting_campaign_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.prospecting_campaigns,
  public.prospecting_campaign_steps,
  public.prospecting_campaign_members,
  public.prospecting_campaign_actions,
  public.prospecting_sms_reservations,
  public.prospecting_campaign_events
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE
  public.prospecting_campaigns,
  public.prospecting_campaign_steps,
  public.prospecting_campaign_members,
  public.prospecting_campaign_actions,
  public.prospecting_sms_reservations,
  public.prospecting_campaign_events
TO service_role;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'prospecting_campaigns',
    'prospecting_campaign_steps',
    'prospecting_campaign_members',
    'prospecting_campaign_actions',
    'prospecting_sms_reservations',
    'prospecting_campaign_events'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Service role full access on ' || table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      'Service role full access on ' || table_name,
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.prospecting_touch_updated_at_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.prospecting_touch_updated_at_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospecting_touch_updated_at_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.prospecting_phone_key_v1(phone_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN length(regexp_replace(coalesce(phone_value, ''), '[^0-9]', '', 'g')) >= 10
      THEN right(regexp_replace(phone_value, '[^0-9]', '', 'g'), 10)
    ELSE regexp_replace(coalesce(phone_value, ''), '[^0-9]', '', 'g')
  END
$$;

REVOKE ALL ON FUNCTION public.prospecting_phone_key_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospecting_phone_key_v1(text) TO service_role;

CREATE INDEX IF NOT EXISTS idx_sms_opt_outs_prospecting_phone_active
  ON public.sms_opt_outs (public.prospecting_phone_key_v1(phone))
  WHERE is_opted_out = true;
CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_members_phone_active
  ON public.prospecting_campaign_members (public.prospecting_phone_key_v1(phone_snapshot), campaign_id)
  WHERE status = 'active';

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'prospecting_campaigns',
    'prospecting_campaign_steps',
    'prospecting_campaign_members',
    'prospecting_campaign_actions',
    'prospecting_sms_reservations'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS prospecting_touch_updated_at ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER prospecting_touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prospecting_touch_updated_at_v1()',
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.create_prospecting_campaign_v1(
  p_owner_email text,
  p_owner_name text,
  p_name text,
  p_kind text,
  p_caller_id text,
  p_from_phone text,
  p_default_timezone text,
  p_per_hour integer,
  p_per_day integer,
  p_steps jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  campaign_id uuid;
  step_value jsonb;
  step_position integer := 0;
BEGIN
  IF coalesce(trim(p_owner_email), '') = '' OR coalesce(trim(p_owner_name), '') = '' THEN RAISE EXCEPTION 'invalid_campaign_actor'; END IF;
  IF jsonb_typeof(coalesce(p_steps, '[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_steps, '[]'::jsonb)) > 12 THEN
    RAISE EXCEPTION 'invalid_campaign_steps';
  END IF;
  IF p_kind = 'dialer' AND jsonb_array_length(coalesce(p_steps, '[]'::jsonb)) > 0 THEN RAISE EXCEPTION 'dialer_campaign_steps_not_supported'; END IF;
  IF p_kind = 'sms' AND jsonb_array_length(coalesce(p_steps, '[]'::jsonb)) < 1 THEN RAISE EXCEPTION 'campaign_has_no_steps'; END IF;

  INSERT INTO public.prospecting_campaigns (
    name, kind, owner_email, owner_name, caller_id, from_phone,
    default_timezone, per_hour, per_day
  ) VALUES (
    trim(p_name), p_kind, lower(trim(p_owner_email)), trim(p_owner_name),
    nullif(trim(p_caller_id), ''), nullif(trim(p_from_phone), ''),
    coalesce(nullif(trim(p_default_timezone), ''), 'America/Chicago'), p_per_hour, p_per_day
  ) RETURNING id INTO campaign_id;

  FOR step_value IN SELECT value FROM jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
  LOOP
    step_position := step_position + 1;
    INSERT INTO public.prospecting_campaign_steps (campaign_id, position, delay_minutes, body_template)
    VALUES (
      campaign_id,
      step_position,
      greatest(0, least(43200, coalesce((step_value ->> 'delayMinutes')::integer, 0))),
      trim(coalesce(step_value ->> 'bodyTemplate', ''))
    );
  END LOOP;

  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (campaign_id, 'campaign_created', trim(p_owner_name), jsonb_build_object('kind', p_kind, 'steps', step_position));
  RETURN campaign_id;
END
$$;

REVOKE ALL ON FUNCTION public.create_prospecting_campaign_v1(text, text, text, text, text, text, text, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_prospecting_campaign_v1(text, text, text, text, text, text, text, integer, integer, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.enroll_prospecting_campaign_members_v1(
  p_campaign_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_lead_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  campaign_row public.prospecting_campaigns;
  requested_count integer := coalesce(array_length(p_lead_ids, 1), 0);
  eligible_count integer := 0;
  suppressed_count integer := 0;
  missing_count integer := 0;
BEGIN
  IF requested_count < 1 OR requested_count > 1000 THEN RAISE EXCEPTION 'invalid_campaign_member_count'; END IF;

  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id AND lower(owner_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.status NOT IN ('draft', 'paused') THEN RAISE EXCEPTION 'campaign_members_locked'; END IF;

  WITH requested AS (
    SELECT DISTINCT value AS lead_id FROM unnest(p_lead_ids) value
  ), evaluated AS (
    SELECT
      requested.lead_id,
      lead.phone,
      CASE
        WHEN lead.id IS NULL THEN 'missing_lead'
        WHEN coalesce(public.prospecting_phone_key_v1(lead.phone), '') = '' THEN 'missing_phone'
        WHEN lower(coalesce(lead.classification, '')) = 'dead' OR lower(coalesce(lead.station, '')) IN ('dead', 'closed_lost') THEN 'dead_lead'
        WHEN EXISTS (
          SELECT 1 FROM public.sms_opt_outs opt_out
          WHERE opt_out.is_opted_out = true
            AND public.prospecting_phone_key_v1(opt_out.phone) = public.prospecting_phone_key_v1(lead.phone)
        ) THEN 'do_not_contact'
        ELSE NULL
      END AS blocked_reason
    FROM requested
    LEFT JOIN public.leads lead ON lead.id = requested.lead_id
  ), upserted AS (
    INSERT INTO public.prospecting_campaign_members (
      campaign_id, lead_id, phone_snapshot, timezone, status,
      suppression_reason, enrolled_by
    )
    SELECT
      p_campaign_id,
      evaluated.lead_id,
      evaluated.phone,
      campaign_row.default_timezone,
      CASE WHEN evaluated.blocked_reason IS NULL THEN 'active' ELSE 'suppressed' END,
      evaluated.blocked_reason,
      coalesce(nullif(trim(p_actor_name), ''), trim(p_actor_email))
    FROM evaluated
    WHERE evaluated.blocked_reason IS DISTINCT FROM 'missing_lead'
      AND evaluated.blocked_reason IS DISTINCT FROM 'missing_phone'
    ON CONFLICT (campaign_id, lead_id) DO UPDATE SET
      phone_snapshot = EXCLUDED.phone_snapshot,
      timezone = EXCLUDED.timezone,
      status = EXCLUDED.status,
      suppression_reason = EXCLUDED.suppression_reason,
      enrolled_by = EXCLUDED.enrolled_by,
      enrolled_at = now(),
      completed_at = NULL
    RETURNING status
  )
  SELECT
    count(*) FILTER (WHERE status = 'active'),
    count(*) FILTER (WHERE status = 'suppressed')
  INTO eligible_count, suppressed_count
  FROM upserted;

  SELECT count(*) INTO missing_count
  FROM unnest(p_lead_ids) requested(lead_id)
  LEFT JOIN public.leads lead ON lead.id = requested.lead_id
  WHERE lead.id IS NULL OR coalesce(public.prospecting_phone_key_v1(lead.phone), '') = '';

  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (
    p_campaign_id,
    'members_enrolled',
    coalesce(nullif(trim(p_actor_name), ''), trim(p_actor_email)),
    jsonb_build_object('requested', requested_count, 'eligible', eligible_count, 'suppressed', suppressed_count, 'missing', missing_count)
  );

  RETURN jsonb_build_object(
    'requested', requested_count,
    'eligible', eligible_count,
    'suppressed', suppressed_count,
    'missing', missing_count
  );
END
$$;

REVOKE ALL ON FUNCTION public.enroll_prospecting_campaign_members_v1(uuid, text, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_prospecting_campaign_members_v1(uuid, text, text, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.activate_prospecting_campaign_v1(
  p_campaign_id uuid,
  p_actor_email text,
  p_actor_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  campaign_row public.prospecting_campaigns;
  active_members integer;
  first_step public.prospecting_campaign_steps;
BEGIN
  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id AND lower(owner_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.status NOT IN ('draft', 'paused') THEN RAISE EXCEPTION 'invalid_campaign_transition'; END IF;

  SELECT count(*) INTO active_members
  FROM public.prospecting_campaign_members
  WHERE campaign_id = p_campaign_id AND status = 'active';
  IF active_members < 1 THEN RAISE EXCEPTION 'campaign_has_no_eligible_members'; END IF;

  IF campaign_row.kind = 'sms' THEN
    SELECT * INTO first_step
    FROM public.prospecting_campaign_steps
    WHERE campaign_id = p_campaign_id
    ORDER BY position
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'campaign_has_no_steps'; END IF;

    INSERT INTO public.prospecting_campaign_actions (
      campaign_id, member_id, step_id, lead_id, scheduled_at
    )
    SELECT
      member.campaign_id,
      member.id,
      first_step.id,
      member.lead_id,
      now() + make_interval(mins => first_step.delay_minutes)
    FROM public.prospecting_campaign_members member
    WHERE member.campaign_id = p_campaign_id AND member.status = 'active'
    ON CONFLICT (member_id, step_id) DO NOTHING;

    UPDATE public.prospecting_campaign_members
      SET next_action_at = now() + make_interval(mins => first_step.delay_minutes)
      WHERE campaign_id = p_campaign_id AND status = 'active';
  END IF;

  UPDATE public.prospecting_campaigns
    SET status = 'active', activated_at = coalesce(activated_at, now()), paused_at = NULL
    WHERE id = p_campaign_id
    RETURNING * INTO campaign_row;

  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (p_campaign_id, 'campaign_activated', coalesce(nullif(trim(p_actor_name), ''), trim(p_actor_email)), jsonb_build_object('eligible_members', active_members));

  RETURN jsonb_build_object('id', campaign_row.id, 'status', campaign_row.status, 'eligibleMembers', active_members);
END
$$;

REVOKE ALL ON FUNCTION public.activate_prospecting_campaign_v1(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_prospecting_campaign_v1(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_prospecting_campaign_action_v1(
  p_worker_token uuid,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  action_row public.prospecting_campaign_actions;
  result jsonb;
BEGIN
  IF p_worker_token IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 600 THEN
    RAISE EXCEPTION 'invalid_worker_claim';
  END IF;

  SELECT action.* INTO action_row
  FROM public.prospecting_campaign_actions action
  JOIN public.prospecting_campaigns campaign ON campaign.id = action.campaign_id
  JOIN public.prospecting_campaign_members member ON member.id = action.member_id
  WHERE campaign.status = 'active'
    AND campaign.kind = 'sms'
    AND member.status = 'active'
    AND action.scheduled_at <= now()
    AND (
      action.status = 'queued'
      OR (action.status = 'processing' AND action.lease_expires_at < now())
    )
  ORDER BY action.scheduled_at, action.id
  LIMIT 1
  FOR UPDATE OF action SKIP LOCKED;

  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.prospecting_campaign_actions
    SET status = 'processing', worker_token = p_worker_token,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1
    WHERE id = action_row.id
    RETURNING * INTO action_row;

  SELECT jsonb_build_object(
    'id', action_row.id,
    'campaignId', action_row.campaign_id,
    'memberId', action_row.member_id,
    'stepId', action_row.step_id,
    'leadId', action_row.lead_id,
    'attemptCount', action_row.attempt_count,
    'phone', member.phone_snapshot,
    'timezone', member.timezone,
    'bodyTemplate', step.body_template,
    'fromPhone', campaign.from_phone,
    'sendWindowStart', campaign.send_window_start,
    'sendWindowEnd', campaign.send_window_end,
    'sendDays', campaign.send_days,
    'perHour', campaign.per_hour,
    'perDay', campaign.per_day,
    'ownerName', campaign.owner_name
  ) INTO result
  FROM public.prospecting_campaign_members member
  JOIN public.prospecting_campaign_steps step ON step.id = action_row.step_id
  JOIN public.prospecting_campaigns campaign ON campaign.id = action_row.campaign_id
  WHERE member.id = action_row.member_id;

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.claim_prospecting_campaign_action_v1(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_prospecting_campaign_action_v1(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_prospecting_sms_send_v1(
  p_action_id uuid,
  p_worker_token uuid,
  p_per_hour integer,
  p_per_day integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  action_row public.prospecting_campaign_actions;
  used_hour integer;
  used_day integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('prospecting-sms-budget', 0));

  IF p_per_hour < 1 OR p_per_day < 1 OR p_per_day < p_per_hour THEN
    RAISE EXCEPTION 'invalid_campaign_pacing';
  END IF;

  SELECT action.* INTO action_row
  FROM public.prospecting_campaign_actions action
  JOIN public.prospecting_campaigns campaign ON campaign.id = action.campaign_id
  JOIN public.prospecting_campaign_members member ON member.id = action.member_id
  WHERE action.id = p_action_id
    AND action.status = 'processing'
    AND action.worker_token = p_worker_token
    AND campaign.status = 'active'
    AND member.status = 'active'
  FOR UPDATE OF action;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_action_claim_lost'; END IF;

  IF EXISTS (SELECT 1 FROM public.prospecting_sms_reservations WHERE action_id = p_action_id AND status IN ('reserved', 'consumed')) THEN
    RETURN jsonb_build_object('reserved', true, 'alreadyReserved', true);
  END IF;

  SELECT
    (
      SELECT count(*)
      FROM public.sms_delivery_log log
      WHERE log.success = true
        AND log.created_at >= now() - interval '1 hour'
        AND NOT EXISTS (
          SELECT 1
          FROM public.prospecting_sms_reservations reservation
          JOIN public.prospecting_campaign_actions campaign_action ON campaign_action.id = reservation.action_id
          WHERE reservation.status = 'consumed' AND campaign_action.provider_sid = log.twilio_sid
        )
    ) + (
      SELECT count(*) FROM public.prospecting_sms_reservations
      WHERE status IN ('reserved', 'consumed') AND reserved_at >= now() - interval '1 hour'
    ),
    (
      SELECT count(*)
      FROM public.sms_delivery_log log
      WHERE log.success = true
        AND log.created_at >= date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago'
        AND NOT EXISTS (
          SELECT 1
          FROM public.prospecting_sms_reservations reservation
          JOIN public.prospecting_campaign_actions campaign_action ON campaign_action.id = reservation.action_id
          WHERE reservation.status = 'consumed' AND campaign_action.provider_sid = log.twilio_sid
        )
    ) + (
      SELECT count(*) FROM public.prospecting_sms_reservations
      WHERE status IN ('reserved', 'consumed')
        AND reserved_at >= date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago'
    )
  INTO used_hour, used_day;

  IF used_hour >= p_per_hour OR used_day >= p_per_day THEN
    RETURN jsonb_build_object('reserved', false, 'usedHour', used_hour, 'usedDay', used_day);
  END IF;

  INSERT INTO public.prospecting_sms_reservations (action_id, campaign_id)
  VALUES (p_action_id, action_row.campaign_id);

  RETURN jsonb_build_object('reserved', true, 'usedHour', used_hour + 1, 'usedDay', used_day + 1);
END
$$;

REVOKE ALL ON FUNCTION public.reserve_prospecting_sms_send_v1(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_prospecting_sms_send_v1(uuid, uuid, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_prospecting_campaign_action_v1(
  p_action_id uuid,
  p_worker_token uuid,
  p_result text,
  p_rendered_body text DEFAULT NULL,
  p_provider_sid text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_retry_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  action_row public.prospecting_campaign_actions;
  step_row public.prospecting_campaign_steps;
  next_step public.prospecting_campaign_steps;
  final_status text;
BEGIN
  IF p_result NOT IN ('sent', 'blocked', 'failed', 'deferred') THEN RAISE EXCEPTION 'invalid_campaign_action_result'; END IF;

  SELECT * INTO action_row
  FROM public.prospecting_campaign_actions
  WHERE id = p_action_id AND status = 'processing' AND worker_token = p_worker_token
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_action_claim_lost'; END IF;

  SELECT * INTO step_row FROM public.prospecting_campaign_steps WHERE id = action_row.step_id;

  IF p_result = 'deferred' THEN
    UPDATE public.prospecting_campaign_actions
      SET status = 'queued', scheduled_at = coalesce(p_retry_at, now() + interval '15 minutes'),
          worker_token = NULL, lease_expires_at = NULL, error_code = p_error_code
      WHERE id = action_row.id;
    UPDATE public.prospecting_sms_reservations SET status = 'released' WHERE action_id = action_row.id AND status = 'reserved';
    RETURN jsonb_build_object('status', 'queued');
  END IF;

  IF p_result = 'failed' AND action_row.attempt_count < 3 THEN
    UPDATE public.prospecting_campaign_actions
      SET status = 'queued', scheduled_at = coalesce(p_retry_at, now() + make_interval(mins => 5 * action_row.attempt_count)),
          worker_token = NULL, lease_expires_at = NULL, error_code = p_error_code
      WHERE id = action_row.id;
    UPDATE public.prospecting_sms_reservations SET status = 'released' WHERE action_id = action_row.id AND status = 'reserved';
    RETURN jsonb_build_object('status', 'queued', 'retrying', true);
  END IF;

  final_status := CASE p_result WHEN 'sent' THEN 'sent' WHEN 'blocked' THEN 'blocked' ELSE 'failed' END;
  UPDATE public.prospecting_campaign_actions
    SET status = final_status, rendered_body = nullif(p_rendered_body, ''), provider_sid = nullif(p_provider_sid, ''),
        error_code = nullif(p_error_code, ''), sent_at = CASE WHEN p_result = 'sent' THEN now() ELSE sent_at END,
        completed_at = now(), worker_token = NULL, lease_expires_at = NULL
    WHERE id = action_row.id;
  UPDATE public.prospecting_sms_reservations
    SET status = CASE WHEN p_result = 'sent' THEN 'consumed' ELSE 'released' END
    WHERE action_id = action_row.id AND status = 'reserved';

  IF p_result = 'blocked' THEN
    UPDATE public.prospecting_campaign_members
      SET status = 'suppressed', suppression_reason = coalesce(nullif(p_error_code, ''), 'contact_policy'), next_action_at = NULL
      WHERE id = action_row.member_id;
    UPDATE public.prospecting_campaign_actions SET status = 'cancelled', completed_at = now(), error_code = 'member_suppressed'
      WHERE member_id = action_row.member_id AND status = 'queued';
  ELSIF p_result = 'sent' THEN
    SELECT * INTO next_step
    FROM public.prospecting_campaign_steps
    WHERE campaign_id = action_row.campaign_id AND position > step_row.position
    ORDER BY position
    LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.prospecting_campaign_actions (campaign_id, member_id, step_id, lead_id, scheduled_at)
      VALUES (action_row.campaign_id, action_row.member_id, next_step.id, action_row.lead_id, now() + make_interval(mins => next_step.delay_minutes))
      ON CONFLICT (member_id, step_id) DO NOTHING;
      UPDATE public.prospecting_campaign_members
        SET current_step_position = step_row.position,
            next_action_at = now() + make_interval(mins => next_step.delay_minutes)
        WHERE id = action_row.member_id AND status = 'active';
    ELSE
      UPDATE public.prospecting_campaign_members
        SET status = 'completed', current_step_position = step_row.position,
            next_action_at = NULL, completed_at = now()
        WHERE id = action_row.member_id AND status = 'active';
    END IF;
  END IF;

  INSERT INTO public.prospecting_campaign_events (campaign_id, member_id, action_id, event_type, actor, metadata)
  VALUES (
    action_row.campaign_id,
    action_row.member_id,
    action_row.id,
    'campaign_action_' || final_status,
    'Prospecting worker',
    jsonb_build_object('error_code', p_error_code, 'provider_sid', p_provider_sid)
  );

  RETURN jsonb_build_object('status', final_status);
END
$$;

REVOKE ALL ON FUNCTION public.finish_prospecting_campaign_action_v1(uuid, uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_prospecting_campaign_action_v1(uuid, uuid, text, text, text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.stop_prospecting_members_on_reply_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  direction_value text := lower(coalesce(NEW.metadata ->> 'direction', ''));
BEGIN
  IF NEW.lead_id IS NULL OR direction_value NOT IN ('inbound', 'incoming', 'received') THEN RETURN NEW; END IF;

  WITH stopped AS (
    UPDATE public.prospecting_campaign_members member
      SET status = 'replied', next_action_at = NULL, completed_at = now()
    FROM public.prospecting_campaigns campaign
    WHERE member.campaign_id = campaign.id
      AND member.lead_id = NEW.lead_id
      AND member.status = 'active'
      AND campaign.kind = 'sms'
      AND campaign.status = 'active'
    RETURNING member.id, member.campaign_id
  )
  UPDATE public.prospecting_campaign_actions action
    SET status = 'cancelled', completed_at = now(), error_code = 'contact_replied'
  FROM stopped
  WHERE action.member_id = stopped.id AND action.status IN ('queued', 'processing');

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.stop_prospecting_members_on_reply_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stop_prospecting_members_on_reply_v1() TO service_role;

DROP TRIGGER IF EXISTS prospecting_stop_on_sms_reply ON public.lead_activities;
CREATE TRIGGER prospecting_stop_on_sms_reply
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW
  WHEN (NEW.activity_type IN ('sms', 'sms_received', 'sms_inbound'))
  EXECUTE FUNCTION public.stop_prospecting_members_on_reply_v1();

CREATE OR REPLACE FUNCTION public.suppress_prospecting_members_on_opt_out_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.is_opted_out IS DISTINCT FROM true THEN RETURN NEW; END IF;

  WITH stopped AS (
    UPDATE public.prospecting_campaign_members member
      SET status = 'suppressed', suppression_reason = coalesce(nullif(NEW.reason, ''), 'sms_opt_out'), next_action_at = NULL
    FROM public.prospecting_campaigns campaign
    WHERE member.campaign_id = campaign.id
      AND campaign.kind = 'sms'
      AND campaign.status IN ('active', 'paused')
      AND member.status = 'active'
      AND public.prospecting_phone_key_v1(member.phone_snapshot) = public.prospecting_phone_key_v1(NEW.phone)
    RETURNING member.id
  )
  UPDATE public.prospecting_campaign_actions action
    SET status = 'cancelled', completed_at = now(), error_code = 'sms_opt_out'
  FROM stopped
  WHERE action.member_id = stopped.id AND action.status IN ('queued', 'processing');

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.suppress_prospecting_members_on_opt_out_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suppress_prospecting_members_on_opt_out_v1() TO service_role;

DROP TRIGGER IF EXISTS prospecting_suppress_on_sms_opt_out ON public.sms_opt_outs;
CREATE TRIGGER prospecting_suppress_on_sms_opt_out
  AFTER INSERT OR UPDATE OF is_opted_out, reason ON public.sms_opt_outs
  FOR EACH ROW
  WHEN (NEW.is_opted_out = true)
  EXECUTE FUNCTION public.suppress_prospecting_members_on_opt_out_v1();

-- Keep the existing durable dialer session as the execution source-of-truth,
-- but link a session to the campaign audience that produced it.
ALTER TABLE public.dialer_sessions
  ADD COLUMN IF NOT EXISTS prospecting_campaign_id uuid REFERENCES public.prospecting_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dialer_sessions_prospecting_campaign
  ON public.dialer_sessions (prospecting_campaign_id, updated_at DESC)
  WHERE prospecting_campaign_id IS NOT NULL;
