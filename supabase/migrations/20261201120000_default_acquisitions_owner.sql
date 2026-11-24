-- One configurable default acquisitions owner.
--
-- system_config key default_acquisitions_owner points at one CRM user.
-- The seeded user is Casey Davis (agent_profiles.email casey@savingkc.com).
-- displayName is the label written to leads.assigned_agent and shown in the
-- contacts OWNER column. Change that row to point new leads at a future rep.
-- This is not round-robin.
--
-- A BEFORE INSERT trigger fills assigned_agent only when the insert left it
-- null or blank, so every creation path is covered without replacing an
-- owner a path already chose. Current paths that omit an owner:
--   manual Add contact (POST /api/contacts)
--   CSV import (POST /api/contacts/import)
--   campaign import (import_prospecting_campaign_members_v1)
--   older campaign import (import function in 20260920120000)
--   website form (POST /api/leads)
--   PPC form (POST /api/leads/ppc)
--   booking contact (POST /api/book)
--   prospect promotion (createEnrichedLeadFromProspect / promoteProspectingProspect)
--   inbound SMS and YES reply (POST /api/twilio-sms-webhook)
--   missed-call claim (claim_inbound_caller_lead and its legacy insert)
--   Google Ads phone leads
--   IVR voicemail, press-1, no-input, and recording leads
--   historical contract stub (POST /api/admin/import-historical)
--   Mojo call lead insert
--   Jackson excess-proceeds lead insert
-- Paths that already set an owner keep it: mobile manual (signed-in agent),
-- carrier-fallback SMS (routing primary), connected IVR dial-result, and the
-- email-marketing bridge handoff.
--
-- backfill_default_acquisitions_owner_v1 is one-shot. It rewrites only the
-- owner label on open files (not dead, closed_won, or closed_lost), including
-- parked open files. It does not insert activities or edit any other column.

SET lock_timeout = '10s';
SET statement_timeout = '2min';

CREATE OR REPLACE FUNCTION public.lead_is_open_for_default_owner_v1(
  lead_station text,
  lead_classification text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT NOT (
    lower(COALESCE(lead_classification, '')) = 'dead'
    OR lower(COALESCE(lead_station, '')) IN ('dead', 'closed_lost', 'closed_won')
  );
$$;

REVOKE ALL ON FUNCTION public.lead_is_open_for_default_owner_v1(text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.default_acquisitions_owner_name()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  config jsonb;
  label text;
  profile_id uuid;
BEGIN
  SELECT value INTO config
  FROM public.system_config
  WHERE key = 'default_acquisitions_owner';

  IF config IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(config) = 'object' THEN
    label := NULLIF(left(btrim(config->>'displayName'), 80), '');
    IF label IS NOT NULL THEN
      RETURN label;
    END IF;

    BEGIN
      profile_id := NULLIF(btrim(config->>'agentProfileId'), '')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        profile_id := NULL;
    END;

    IF profile_id IS NOT NULL THEN
      SELECT NULLIF(left(btrim(split_part(profile.full_name, ' ', 1)), 80), '')
      INTO label
      FROM public.agent_profiles AS profile
      WHERE profile.id = profile_id;
      RETURN label;
    END IF;

    SELECT NULLIF(left(btrim(split_part(profile.full_name, ' ', 1)), 80), '')
    INTO label
    FROM public.agent_profiles AS profile
    WHERE lower(profile.email) = lower(NULLIF(btrim(config->>'email'), ''))
    ORDER BY profile.is_active DESC NULLS LAST, profile.id
    LIMIT 1;
    RETURN label;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.default_acquisitions_owner_name()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.default_acquisitions_owner_name() TO service_role;

COMMENT ON FUNCTION public.default_acquisitions_owner_name() IS
  'Owner label for new leads with no owner. Edit system_config.default_acquisitions_owner (displayName plus agentProfileId) to switch the next assignment.';

INSERT INTO public.system_config(key, value, updated_at)
VALUES (
  'default_acquisitions_owner',
  (
    SELECT jsonb_strip_nulls(jsonb_build_object(
      'agentProfileId', profile.id,
      'userId', profile.user_id,
      'email', COALESCE(profile.email, 'casey@savingkc.com'),
      'displayName', 'Casey'
    ))
    FROM (SELECT 1) AS seed
    LEFT JOIN public.agent_profiles AS profile
      ON lower(profile.email) = 'casey@savingkc.com'
    LIMIT 1
  ),
  now()
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.assign_default_acquisitions_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  owner_label text;
BEGIN
  IF NULLIF(btrim(NEW.assigned_agent), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  owner_label := public.default_acquisitions_owner_name();
  IF owner_label IS NOT NULL THEN
    NEW.assigned_agent := owner_label;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_default_acquisitions_owner()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trigger_assign_default_acquisitions_owner ON public.leads;
CREATE TRIGGER trigger_assign_default_acquisitions_owner
BEFORE INSERT ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.assign_default_acquisitions_owner();

CREATE OR REPLACE FUNCTION public.acquisitions_owner_counts_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH open_leads AS (
    SELECT
      lead.id,
      COALESCE(lead.is_parked, false) AS is_parked,
      COALESCE(
        NULLIF(btrim(COALESCE(opportunity.owner_name, thread.owner, lead.assigned_agent)), ''),
        '(unassigned)'
      ) AS displayed_owner,
      COALESCE(NULLIF(btrim(lead.assigned_agent), ''), '(unassigned)') AS assigned_agent
    FROM public.leads AS lead
    LEFT JOIN LATERAL (
      SELECT linked_opportunity.owner_name
      FROM public.crm_lead_entity_links AS link
      JOIN public.crm_opportunities AS linked_opportunity
        ON linked_opportunity.id = link.opportunity_id
      WHERE link.lead_id = lead.id
      ORDER BY link.projected_at DESC NULLS LAST, linked_opportunity.id DESC
      LIMIT 1
    ) AS opportunity ON TRUE
    LEFT JOIN LATERAL (
      SELECT thread_row.owner
      FROM public.conversation_thread_state AS thread_row
      WHERE thread_row.lead_id = lead.id
      ORDER BY thread_row.updated_at DESC NULLS LAST, thread_row.thread_key DESC
      LIMIT 1
    ) AS thread ON TRUE
    WHERE public.lead_is_open_for_default_owner_v1(lead.station, lead.classification)
  ),
  counted AS (
    SELECT 'displayedOpen' AS bucket, displayed_owner AS owner_label, COUNT(*) AS n
    FROM open_leads
    GROUP BY displayed_owner
    UNION ALL
    SELECT 'displayedContactsPage', displayed_owner, COUNT(*)
    FROM open_leads
    WHERE NOT is_parked
    GROUP BY displayed_owner
    UNION ALL
    SELECT 'assignedAgentOpen', assigned_agent, COUNT(*)
    FROM open_leads
    GROUP BY assigned_agent
  )
  SELECT jsonb_build_object(
    'displayedOpen', COALESCE((
      SELECT jsonb_object_agg(owner_label, n)
      FROM counted WHERE bucket = 'displayedOpen'
    ), '{}'::jsonb),
    'displayedContactsPage', COALESCE((
      SELECT jsonb_object_agg(owner_label, n)
      FROM counted WHERE bucket = 'displayedContactsPage'
    ), '{}'::jsonb),
    'assignedAgentOpen', COALESCE((
      SELECT jsonb_object_agg(owner_label, n)
      FROM counted WHERE bucket = 'assignedAgentOpen'
    ), '{}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.acquisitions_owner_counts_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquisitions_owner_counts_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.set_default_owner_backfill_triggers_v1(enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  item record;
  action text := CASE WHEN enabled THEN 'ENABLE' ELSE 'DISABLE' END;
BEGIN
  FOR item IN
    SELECT *
    FROM (VALUES
      ('public.leads', 'trigger_queue_briefing_from_lead'),
      ('public.leads', 'trigger_refresh_crm_entity_for_lead'),
      ('public.leads', 'trigger_sync_conversation_thread_state_lead'),
      ('public.leads', 'trigger_sync_mobile_message_thread_state_lead'),
      ('public.crm_opportunities', 'trigger_queue_briefing_from_opportunity')
    ) AS trigger_target(table_name, trigger_name)
  LOOP
    IF to_regclass(item.table_name) IS NOT NULL AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      JOIN pg_catalog.pg_class AS class_row ON class_row.oid = trigger_row.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = class_row.relnamespace
      WHERE NOT trigger_row.tgisinternal
        AND trigger_row.tgname = item.trigger_name
        AND namespace_row.nspname = split_part(item.table_name, '.', 1)
        AND class_row.relname = split_part(item.table_name, '.', 2)
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.%I %s TRIGGER %I',
        split_part(item.table_name, '.', 1),
        split_part(item.table_name, '.', 2),
        action,
        item.trigger_name
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_owner_backfill_triggers_v1(boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.backfill_default_acquisitions_owner_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  owner_label text;
  receipt jsonb;
  before_counts jsonb;
  after_counts jsonb;
  lead_updates integer := 0;
  opportunity_updates integer := 0;
  thread_updates integer := 0;
  mobile_updates integer := 0;
  result jsonb;
BEGIN
  PERFORM set_config('lock_timeout', '10s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('default_acquisitions_owner_backfill', 0));

  SELECT value INTO receipt
  FROM public.system_config
  WHERE key = 'default_acquisitions_owner_backfill_receipt';
  IF receipt IS NOT NULL THEN
    RETURN receipt || jsonb_build_object('replayed', true);
  END IF;

  owner_label := public.default_acquisitions_owner_name();
  IF owner_label IS NULL THEN
    RAISE EXCEPTION 'default_acquisitions_owner_unset';
  END IF;

  before_counts := public.acquisitions_owner_counts_v1();
  -- Hold the briefing and projection triggers for this transaction so the
  -- owner rewrite does not queue briefings or rebuild other columns.
  PERFORM public.set_default_owner_backfill_triggers_v1(false);

  UPDATE public.leads AS lead
  SET assigned_agent = owner_label
  WHERE public.lead_is_open_for_default_owner_v1(lead.station, lead.classification)
    AND lead.assigned_agent IS DISTINCT FROM owner_label;
  GET DIAGNOSTICS lead_updates = ROW_COUNT;

  UPDATE public.crm_opportunities AS opportunity
  SET owner_name = owner_label
  WHERE opportunity.owner_name IS DISTINCT FROM owner_label
    AND EXISTS (
      SELECT 1
      FROM public.leads AS lead
      WHERE public.lead_is_open_for_default_owner_v1(lead.station, lead.classification)
        AND (
          lead.id = opportunity.source_lead_id
          OR EXISTS (
            SELECT 1
            FROM public.crm_lead_entity_links AS link
            WHERE link.lead_id = lead.id
              AND link.opportunity_id = opportunity.id
          )
        )
    );
  GET DIAGNOSTICS opportunity_updates = ROW_COUNT;

  UPDATE public.conversation_thread_state AS thread
  SET owner = owner_label
  WHERE thread.owner IS DISTINCT FROM owner_label
    AND EXISTS (
      SELECT 1
      FROM public.leads AS lead
      WHERE lead.id = thread.lead_id
        AND public.lead_is_open_for_default_owner_v1(lead.station, lead.classification)
    );
  GET DIAGNOSTICS thread_updates = ROW_COUNT;

  UPDATE public.mobile_message_thread_state AS thread
  SET owner = owner_label
  WHERE thread.owner IS DISTINCT FROM owner_label
    AND EXISTS (
      SELECT 1
      FROM public.leads AS lead
      WHERE lead.id = thread.lead_id
        AND public.lead_is_open_for_default_owner_v1(lead.station, lead.classification)
    );
  GET DIAGNOSTICS mobile_updates = ROW_COUNT;

  PERFORM public.set_default_owner_backfill_triggers_v1(true);
  after_counts := public.acquisitions_owner_counts_v1();

  result := jsonb_build_object(
    'owner', owner_label,
    'replayed', false,
    'before', before_counts,
    'after', after_counts,
    'updated', jsonb_build_object(
      'leads', lead_updates,
      'opportunities', opportunity_updates,
      'conversationThreads', thread_updates,
      'mobileThreads', mobile_updates
    ),
    'ranAt', now()
  );

  INSERT INTO public.system_config(key, value, updated_at)
  VALUES ('default_acquisitions_owner_backfill_receipt', result, now())
  ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

  RETURN result;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM public.set_default_owner_backfill_triggers_v1(true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_default_acquisitions_owner_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_default_acquisitions_owner_v1() TO service_role;

COMMENT ON FUNCTION public.backfill_default_acquisitions_owner_v1() IS
  'One-shot owner backfill for open leads. Rewrites only owner labels. Leaves dead and closed files, activities, and every other column unchanged.';
