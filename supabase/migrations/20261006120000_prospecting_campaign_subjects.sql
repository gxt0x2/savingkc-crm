-- Native source-prospect campaign subjects.
--
-- Campaign enrollment must never manufacture a CRM lead. A member therefore
-- owns exactly one canonical subject (lead or source prospect), while contact
-- snapshots preserve every associated phone reviewed for execution.
-- hygiene-approved-destructive: only obsolete function definitions and RLS
-- policy definitions are replaced; no source, campaign, contact, or activity
-- rows are deleted by this migration.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

ALTER TABLE public.prospecting_campaign_members
  ADD COLUMN IF NOT EXISTS subject_kind text NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS prospect_id uuid REFERENCES public.prospects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS enrollment_source text NOT NULL DEFAULT 'crm_lead';

ALTER TABLE public.prospecting_campaign_members
  ALTER COLUMN lead_id DROP NOT NULL;

UPDATE public.prospecting_campaign_members
SET subject_kind = 'lead', prospect_id = NULL
WHERE lead_id IS NOT NULL;

ALTER TABLE public.prospecting_campaign_members
  DROP CONSTRAINT IF EXISTS prospecting_campaign_members_campaign_id_lead_id_key,
  DROP CONSTRAINT IF EXISTS prospecting_campaign_members_status_check,
  DROP CONSTRAINT IF EXISTS prospecting_campaign_members_subject_check,
  DROP CONSTRAINT IF EXISTS prospecting_campaign_members_enrollment_source_check,
  ADD CONSTRAINT prospecting_campaign_members_status_check
    CHECK (status IN ('active', 'needs_review', 'suppressed', 'replied', 'completed', 'removed')) NOT VALID,
  ADD CONSTRAINT prospecting_campaign_members_subject_check
    CHECK (
      (subject_kind = 'lead' AND lead_id IS NOT NULL AND prospect_id IS NULL)
      OR
      (subject_kind = 'prospect' AND prospect_id IS NOT NULL AND lead_id IS NULL)
    ) NOT VALID,
  ADD CONSTRAINT prospecting_campaign_members_enrollment_source_check
    CHECK (enrollment_source IN ('crm_lead', 'county_saved_view')) NOT VALID;

ALTER TABLE public.prospecting_campaign_members
  VALIDATE CONSTRAINT prospecting_campaign_members_status_check;
ALTER TABLE public.prospecting_campaign_members
  VALIDATE CONSTRAINT prospecting_campaign_members_subject_check;
ALTER TABLE public.prospecting_campaign_members
  VALIDATE CONSTRAINT prospecting_campaign_members_enrollment_source_check;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prospecting_campaign_members_lead_subject
  ON public.prospecting_campaign_members (campaign_id, lead_id)
  WHERE subject_kind = 'lead';
CREATE UNIQUE INDEX IF NOT EXISTS idx_prospecting_campaign_members_prospect_subject
  ON public.prospecting_campaign_members (campaign_id, prospect_id)
  WHERE subject_kind = 'prospect';
CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_members_prospect_active
  ON public.prospecting_campaign_members (prospect_id, campaign_id)
  WHERE subject_kind = 'prospect' AND status IN ('active', 'needs_review');

CREATE TABLE IF NOT EXISTS public.prospecting_campaign_member_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.prospecting_campaign_members(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('lead_primary', 'prospect_phone')),
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  prospect_phone_id uuid REFERENCES public.prospect_phones(id) ON DELETE SET NULL,
  contact_key text NOT NULL CHECK (contact_key <> ''),
  phone_snapshot text NOT NULL CHECK (nullif(trim(phone_snapshot), '') IS NOT NULL),
  contact_name text,
  relationship text,
  phone_type text,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'suppressed', 'removed')),
  suppression_reason text,
  selected_for_sms boolean NOT NULL DEFAULT false,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, contact_key)
);

ALTER TABLE public.prospecting_campaign_member_contacts
  ADD COLUMN IF NOT EXISTS prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL;

UPDATE public.prospecting_campaign_member_contacts contact
SET prospect_id = phone.prospect_id
FROM public.prospect_phones phone
WHERE contact.prospect_phone_id = phone.id
  AND contact.prospect_id IS NULL;

ALTER TABLE public.prospecting_campaign_member_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prospecting_campaign_member_contacts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.prospecting_campaign_member_contacts TO service_role;

DROP POLICY IF EXISTS "Service role full access on prospecting_campaign_member_contact"
  ON public.prospecting_campaign_member_contacts;
DROP POLICY IF EXISTS "Service role campaign member contacts"
  ON public.prospecting_campaign_member_contacts;
CREATE POLICY "Service role campaign member contacts"
  ON public.prospecting_campaign_member_contacts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_member_contacts_ready
  ON public.prospecting_campaign_member_contacts (member_id, enrolled_at, id)
  WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_member_contacts_phone
  ON public.prospecting_campaign_member_contacts (contact_key, member_id)
  WHERE status <> 'removed';
CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_member_contacts_sms
  ON public.prospecting_campaign_member_contacts (member_id, id)
  WHERE status = 'ready' AND selected_for_sms = true;

DROP TRIGGER IF EXISTS prospecting_touch_updated_at ON public.prospecting_campaign_member_contacts;
CREATE TRIGGER prospecting_touch_updated_at
  BEFORE UPDATE ON public.prospecting_campaign_member_contacts
  FOR EACH ROW EXECUTE FUNCTION public.prospecting_touch_updated_at_v1();

-- Existing Lead campaigns retain their reviewed primary recipient.
INSERT INTO public.prospecting_campaign_member_contacts (
  member_id, source_kind, contact_key, phone_snapshot, contact_name,
  relationship, status, suppression_reason, selected_for_sms, enrolled_at
)
SELECT
  member.id,
  'lead_primary',
  public.prospecting_phone_key_v1(member.phone_snapshot),
  member.phone_snapshot,
  lead.full_name,
  'owner',
  CASE WHEN member.status = 'suppressed' THEN 'suppressed' ELSE 'ready' END,
  member.suppression_reason,
  true,
  member.enrolled_at
FROM public.prospecting_campaign_members member
JOIN public.leads lead ON lead.id = member.lead_id
WHERE member.subject_kind = 'lead'
  AND member.enrollment_source = 'crm_lead'
  AND public.prospecting_phone_key_v1(member.phone_snapshot) <> ''
ON CONFLICT (member_id, contact_key) DO NOTHING;

ALTER TABLE public.prospecting_campaign_actions
  ALTER COLUMN lead_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prospect_phone_id uuid REFERENCES public.prospect_phones(id) ON DELETE SET NULL;

ALTER TABLE public.prospecting_campaign_actions
  DROP CONSTRAINT IF EXISTS prospecting_campaign_actions_subject_check,
  ADD CONSTRAINT prospecting_campaign_actions_subject_check
    CHECK (
      (lead_id IS NOT NULL AND prospect_id IS NULL)
      OR
      (lead_id IS NULL AND prospect_id IS NOT NULL)
    ) NOT VALID;

ALTER TABLE public.prospecting_campaign_actions
  VALIDATE CONSTRAINT prospecting_campaign_actions_subject_check;

CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_actions_prospect
  ON public.prospecting_campaign_actions (prospect_id, created_at DESC)
  WHERE prospect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospecting_campaign_actions_prospect_phone
  ON public.prospecting_campaign_actions (prospect_phone_id, created_at DESC)
  WHERE prospect_phone_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_prospecting_campaign_member_search_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  subject_name text;
  subject_address text;
  subject_phone text;
BEGIN
  IF NEW.subject_kind = 'lead' THEN
    SELECT full_name, property_address, phone
      INTO subject_name, subject_address, subject_phone
    FROM public.leads
    WHERE id = NEW.lead_id;
  ELSE
    SELECT
      owner_1,
      concat_ws(', ', nullif(trim(situs_street), ''), nullif(trim(situs_city), ''), nullif(trim(situs_state), ''), nullif(trim(situs_zip), '')),
      NULL
      INTO subject_name, subject_address, subject_phone
    FROM public.prospects
    WHERE id = NEW.prospect_id;
  END IF;

  NEW.search_text := trim(lower(regexp_replace(concat_ws(' ',
    NEW.phone_snapshot,
    NEW.suppression_reason,
    subject_name,
    subject_address,
    subject_phone
  ), '[[:space:]]+', ' ', 'g')));
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.set_prospecting_campaign_member_search_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS set_prospecting_campaign_member_search_v1
  ON public.prospecting_campaign_members;
CREATE TRIGGER set_prospecting_campaign_member_search_v1
  BEFORE INSERT OR UPDATE OF subject_kind, lead_id, prospect_id, phone_snapshot, suppression_reason
  ON public.prospecting_campaign_members
  FOR EACH ROW EXECUTE FUNCTION public.set_prospecting_campaign_member_search_v1();

CREATE OR REPLACE FUNCTION public.refresh_prospecting_campaign_member_search_from_prospect_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.prospecting_campaign_members member
  SET search_text = trim(lower(regexp_replace(concat_ws(' ',
    member.phone_snapshot,
    member.suppression_reason,
    NEW.owner_1,
    concat_ws(', ', nullif(trim(NEW.situs_street), ''), nullif(trim(NEW.situs_city), ''), nullif(trim(NEW.situs_state), ''), nullif(trim(NEW.situs_zip), ''))
  ), '[[:space:]]+', ' ', 'g')))
  WHERE member.subject_kind = 'prospect'
    AND member.prospect_id = NEW.id;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.refresh_prospecting_campaign_member_search_from_prospect_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS refresh_prospecting_campaign_member_search_from_prospect_v1
  ON public.prospects;
CREATE TRIGGER refresh_prospecting_campaign_member_search_from_prospect_v1
  AFTER UPDATE OF owner_1, situs_street, situs_city, situs_state, situs_zip
  ON public.prospects
  FOR EACH ROW
  WHEN (
    OLD.owner_1 IS DISTINCT FROM NEW.owner_1
    OR OLD.situs_street IS DISTINCT FROM NEW.situs_street
    OR OLD.situs_city IS DISTINCT FROM NEW.situs_city
    OR OLD.situs_state IS DISTINCT FROM NEW.situs_state
    OR OLD.situs_zip IS DISTINCT FROM NEW.situs_zip
  )
  EXECUTE FUNCTION public.refresh_prospecting_campaign_member_search_from_prospect_v1();

-- PostgreSQL cannot CREATE OR REPLACE a TABLE-returning function when its OUT
-- columns change. The migration is transactional, so drop/recreate is safe and
-- keeps reruns compatible with the earlier V3 rehearsal shape.
DROP FUNCTION IF EXISTS public.prospecting_campaign_member_page_v3(
  text, uuid, text, text, integer, timestamptz, uuid
);

CREATE OR REPLACE FUNCTION public.prospecting_campaign_member_page_v3(
  p_actor_email text,
  p_campaign_id uuid,
  p_status text DEFAULT 'all',
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_after_enrolled_at timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  subject_kind text,
  lead_id uuid,
  prospect_id uuid,
  enrollment_source text,
  phone_snapshot text,
  timezone text,
  status text,
  suppression_reason text,
  current_step_position integer,
  next_action_at timestamptz,
  enrolled_at timestamptz,
  subject_name text,
  subject_property_address text,
  subject_station text,
  subject_classification text,
  ready_contact_count bigint,
  suppressed_contact_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  clean_actor text := lower(trim(coalesce(p_actor_email, '')));
  clean_status text := lower(trim(coalesce(p_status, 'all')));
  clean_query text := nullif(lower(regexp_replace(trim(coalesce(p_query, '')), '[[:space:]]+', ' ', 'g')), '');
  search_pattern text;
  safe_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
BEGIN
  IF clean_actor = '' OR p_campaign_id IS NULL THEN RAISE EXCEPTION 'invalid_campaign_member_query'; END IF;
  IF clean_status NOT IN ('all', 'active', 'needs_review', 'suppressed', 'replied', 'completed', 'removed') THEN
    RAISE EXCEPTION 'invalid_campaign_member_status';
  END IF;
  IF clean_query IS NOT NULL AND length(clean_query) > 100 THEN RAISE EXCEPTION 'campaign_member_query_too_long'; END IF;
  IF (p_after_enrolled_at IS NULL) <> (p_after_id IS NULL) THEN RAISE EXCEPTION 'invalid_campaign_member_cursor'; END IF;
  search_pattern := replace(replace(replace(clean_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');

  PERFORM 1 FROM public.prospecting_campaigns campaign
  WHERE campaign.id = p_campaign_id AND lower(campaign.owner_email) = clean_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;

  RETURN QUERY
  SELECT
    member.id,
    member.subject_kind,
    member.lead_id,
    member.prospect_id,
    member.enrollment_source,
    member.phone_snapshot,
    member.timezone,
    member.status,
    member.suppression_reason,
    member.current_step_position::integer,
    member.next_action_at,
    member.enrolled_at,
    CASE WHEN member.subject_kind = 'lead' THEN lead.full_name ELSE prospect.owner_1 END,
    CASE WHEN member.subject_kind = 'lead' THEN lead.property_address ELSE
      concat_ws(', ', nullif(trim(prospect.situs_street), ''), nullif(trim(prospect.situs_city), ''), nullif(trim(prospect.situs_state), ''), nullif(trim(prospect.situs_zip), '')) END,
    CASE WHEN member.subject_kind = 'lead' THEN lead.station ELSE 'source_prospect' END,
    CASE WHEN member.subject_kind = 'lead' THEN lead.classification ELSE 'prospect' END,
    count(contact.id) FILTER (WHERE contact.status = 'ready'),
    count(contact.id) FILTER (WHERE contact.status = 'suppressed')
  FROM public.prospecting_campaign_members member
  LEFT JOIN public.leads lead ON lead.id = member.lead_id
  LEFT JOIN public.prospects prospect ON prospect.id = member.prospect_id
  LEFT JOIN public.prospecting_campaign_member_contacts contact ON contact.member_id = member.id
  WHERE member.campaign_id = p_campaign_id
    AND (
      (clean_status = 'all' AND member.status <> 'removed')
      OR (clean_status <> 'all' AND member.status = clean_status)
    )
    AND (clean_query IS NULL OR member.search_text LIKE '%' || search_pattern || '%' ESCAPE E'\\')
    AND (
      p_after_enrolled_at IS NULL
      OR member.enrolled_at < p_after_enrolled_at
      OR (member.enrolled_at = p_after_enrolled_at AND member.id < p_after_id)
    )
  GROUP BY member.id, lead.id, prospect.id
  ORDER BY member.enrolled_at DESC, member.id DESC
  LIMIT safe_limit + 1;
END
$$;

REVOKE ALL ON FUNCTION public.prospecting_campaign_member_page_v3(text, uuid, text, text, integer, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prospecting_campaign_member_page_v3(text, uuid, text, text, integer, timestamptz, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.enroll_county_prospecting_campaign_members_v1(
  p_campaign_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_saved_view text,
  p_deceased_filter text,
  p_property_filter text,
  p_reviewed_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  campaign_row public.prospecting_campaigns;
  delinquency_value text;
  matched_count integer;
  subject_count integer;
  eligible_count integer;
  review_count integer;
  suppressed_count integer;
  missing_count integer;
BEGIN
  IF p_saved_view NOT IN ('tax_2yr', 'tax_3yr_plus')
    OR p_deceased_filter NOT IN ('all', 'deceased', 'non_deceased')
    OR p_property_filter NOT IN ('all', 'residential', 'land', 'unknown')
    OR p_reviewed_count < 1 OR p_reviewed_count > 25000
  THEN
    RAISE EXCEPTION 'invalid_county_audience';
  END IF;
  delinquency_value := CASE p_saved_view WHEN 'tax_2yr' THEN '2yr' ELSE '3yr_plus' END;

  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id AND lower(owner_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.status NOT IN ('draft', 'paused') THEN RAISE EXCEPTION 'campaign_members_locked'; END IF;

  DROP TABLE IF EXISTS pg_temp.county_campaign_selection;
  CREATE TEMP TABLE county_campaign_selection ON COMMIT DROP AS
  SELECT
    prospect.id AS prospect_id,
    prospect.lead_id,
    CASE WHEN prospect.lead_id IS NULL THEN 'prospect' ELSE 'lead' END AS subject_kind,
    coalesce(prospect.lead_id, prospect.id) AS subject_id,
    best_phone.id AS best_phone_id,
    best_phone.phone AS best_phone,
    best_phone.block_reason AS best_block_reason
  FROM public.prospects prospect
  LEFT JOIN LATERAL (
    SELECT ranked.id, ranked.phone, ranked.block_reason
    FROM (
      SELECT
        phone.id,
        phone.phone,
        CASE
          WHEN public.prospecting_phone_key_v1(phone.phone) = '' THEN 'missing_phone'
          WHEN lower(coalesce(phone.phone_connected::text, '')) IN ('false', 'disconnected', 'bad_number', 'wrong_number') THEN 'disconnected'
          WHEN lower(coalesce(phone.last_disposition, '')) IN ('dnc', 'do_not_call') THEN 'do_not_contact'
          WHEN lower(coalesce(phone.last_disposition, '')) IN ('wrong_number', 'disconnected', 'bad_number') THEN lower(phone.last_disposition)
          WHEN EXISTS (
            SELECT 1 FROM public.sms_opt_outs opt_out
            WHERE opt_out.is_opted_out = true
              AND public.prospecting_phone_key_v1(opt_out.phone) = public.prospecting_phone_key_v1(phone.phone)
          ) THEN 'do_not_contact'
          ELSE NULL
        END AS block_reason,
        coalesce(phone.is_verified_contact, false) AS verified,
        coalesce(phone.attempted, false) AS attempted
      FROM public.prospect_phones phone
      WHERE phone.prospect_id = prospect.id
        AND public.prospecting_phone_key_v1(phone.phone) <> ''
    ) ranked
    ORDER BY (ranked.block_reason IS NULL) DESC, ranked.verified DESC, ranked.attempted ASC, ranked.id
    LIMIT 1
  ) best_phone ON true
  WHERE prospect.delinquent_years_category = delinquency_value
    AND (
      p_deceased_filter = 'all'
      OR (p_deceased_filter = 'deceased' AND coalesce(prospect.is_deceased, false) = true)
      OR (p_deceased_filter = 'non_deceased' AND coalesce(prospect.is_deceased, false) = false)
    )
    AND (p_property_filter = 'all' OR coalesce(prospect.property_class, 'unknown') = p_property_filter);

  SELECT count(*) INTO matched_count FROM county_campaign_selection;
  IF matched_count IS DISTINCT FROM p_reviewed_count THEN RAISE EXCEPTION 'county_audience_changed'; END IF;

  WITH canonical AS (
    SELECT DISTINCT ON (lead_id) *
    FROM county_campaign_selection
    WHERE lead_id IS NOT NULL AND best_phone IS NOT NULL
    ORDER BY lead_id, (best_block_reason IS NULL) DESC, prospect_id
  )
  INSERT INTO public.prospecting_campaign_members (
    campaign_id, subject_kind, lead_id, prospect_id, enrollment_source,
    phone_snapshot, timezone, status, suppression_reason, enrolled_by
  )
  SELECT
    p_campaign_id, 'lead', canonical.lead_id, NULL, 'county_saved_view',
    canonical.best_phone, campaign_row.default_timezone, 'needs_review', canonical.best_block_reason,
    coalesce(nullif(trim(p_actor_name), ''), trim(p_actor_email))
  FROM canonical
  ON CONFLICT (campaign_id, lead_id) WHERE subject_kind = 'lead' DO UPDATE SET
    phone_snapshot = EXCLUDED.phone_snapshot,
    timezone = EXCLUDED.timezone,
    enrollment_source = EXCLUDED.enrollment_source,
    status = EXCLUDED.status,
    suppression_reason = EXCLUDED.suppression_reason,
    enrolled_by = EXCLUDED.enrolled_by,
    enrolled_at = now(),
    completed_at = NULL;

  INSERT INTO public.prospecting_campaign_members (
    campaign_id, subject_kind, lead_id, prospect_id, enrollment_source,
    phone_snapshot, timezone, status, suppression_reason, enrolled_by
  )
  SELECT
    p_campaign_id, 'prospect', NULL, selected.prospect_id, 'county_saved_view',
    selected.best_phone, campaign_row.default_timezone, 'needs_review', selected.best_block_reason,
    coalesce(nullif(trim(p_actor_name), ''), trim(p_actor_email))
  FROM county_campaign_selection selected
  WHERE selected.lead_id IS NULL AND selected.best_phone IS NOT NULL
  ON CONFLICT (campaign_id, prospect_id) WHERE subject_kind = 'prospect' DO UPDATE SET
    phone_snapshot = EXCLUDED.phone_snapshot,
    timezone = EXCLUDED.timezone,
    enrollment_source = EXCLUDED.enrollment_source,
    status = EXCLUDED.status,
    suppression_reason = EXCLUDED.suppression_reason,
    enrolled_by = EXCLUDED.enrolled_by,
    enrolled_at = now(),
    completed_at = NULL;

  INSERT INTO public.prospecting_campaign_member_contacts (
    member_id, source_kind, prospect_id, prospect_phone_id, contact_key, phone_snapshot,
    contact_name, relationship, phone_type, status, suppression_reason,
    selected_for_sms
  )
  SELECT
    member.id,
    'prospect_phone',
    phone.prospect_id,
    phone.id,
    public.prospecting_phone_key_v1(phone.phone),
    phone.phone,
    phone.contact_name,
    phone.relationship,
    phone.phone_type,
    CASE WHEN policy.block_reason IS NULL THEN 'ready' ELSE 'suppressed' END,
    policy.block_reason,
    false
  FROM county_campaign_selection selected
  JOIN public.prospecting_campaign_members member
    ON member.campaign_id = p_campaign_id
    AND (
      (selected.lead_id IS NOT NULL AND member.subject_kind = 'lead' AND member.lead_id = selected.lead_id)
      OR
      (selected.lead_id IS NULL AND member.subject_kind = 'prospect' AND member.prospect_id = selected.prospect_id)
    )
  JOIN public.prospect_phones phone ON phone.prospect_id = selected.prospect_id
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN public.prospecting_phone_key_v1(phone.phone) = '' THEN 'missing_phone'
      WHEN lower(coalesce(phone.phone_connected::text, '')) IN ('false', 'disconnected', 'bad_number', 'wrong_number') THEN 'disconnected'
      WHEN lower(coalesce(phone.last_disposition, '')) IN ('dnc', 'do_not_call') THEN 'do_not_contact'
      WHEN lower(coalesce(phone.last_disposition, '')) IN ('wrong_number', 'disconnected', 'bad_number') THEN lower(phone.last_disposition)
      WHEN EXISTS (
        SELECT 1 FROM public.sms_opt_outs opt_out
        WHERE opt_out.is_opted_out = true
          AND public.prospecting_phone_key_v1(opt_out.phone) = public.prospecting_phone_key_v1(phone.phone)
      ) THEN 'do_not_contact'
      ELSE NULL
    END AS block_reason
  ) policy
  WHERE public.prospecting_phone_key_v1(phone.phone) <> ''
  ON CONFLICT (member_id, contact_key) DO UPDATE SET
    prospect_id = EXCLUDED.prospect_id,
    prospect_phone_id = EXCLUDED.prospect_phone_id,
    phone_snapshot = EXCLUDED.phone_snapshot,
    contact_name = EXCLUDED.contact_name,
    relationship = EXCLUDED.relationship,
    phone_type = EXCLUDED.phone_type,
    status = EXCLUDED.status,
    suppression_reason = EXCLUDED.suppression_reason,
    selected_for_sms = false,
    updated_at = now();

  -- A linked Lead may have a primary phone that is not present in the source
  -- prospect phone rows. Preserve it as a callable candidate without replacing
  -- richer source-contact provenance when the number already exists.
  INSERT INTO public.prospecting_campaign_member_contacts (
    member_id, source_kind, contact_key, phone_snapshot, contact_name,
    relationship, status, suppression_reason, selected_for_sms
  )
  SELECT DISTINCT
    member.id,
    'lead_primary',
    public.prospecting_phone_key_v1(lead.phone),
    lead.phone,
    lead.full_name,
    'owner',
    CASE WHEN EXISTS (
      SELECT 1 FROM public.sms_opt_outs opt_out
      WHERE opt_out.is_opted_out = true
        AND public.prospecting_phone_key_v1(opt_out.phone) = public.prospecting_phone_key_v1(lead.phone)
    ) THEN 'suppressed' ELSE 'ready' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM public.sms_opt_outs opt_out
      WHERE opt_out.is_opted_out = true
        AND public.prospecting_phone_key_v1(opt_out.phone) = public.prospecting_phone_key_v1(lead.phone)
    ) THEN 'do_not_contact' ELSE NULL END,
    false
  FROM county_campaign_selection selected
  JOIN public.prospecting_campaign_members member
    ON member.campaign_id = p_campaign_id
    AND member.subject_kind = 'lead'
    AND member.lead_id = selected.lead_id
  JOIN public.leads lead ON lead.id = selected.lead_id
  WHERE selected.lead_id IS NOT NULL
    AND public.prospecting_phone_key_v1(lead.phone) <> ''
  ON CONFLICT (member_id, contact_key) DO NOTHING;

  WITH selected_members AS (
    SELECT DISTINCT member.id
    FROM county_campaign_selection selected
    JOIN public.prospecting_campaign_members member
      ON member.campaign_id = p_campaign_id
      AND (
        (selected.lead_id IS NOT NULL AND member.subject_kind = 'lead' AND member.lead_id = selected.lead_id)
        OR
        (selected.lead_id IS NULL AND member.subject_kind = 'prospect' AND member.prospect_id = selected.prospect_id)
      )
  ), contact_health AS (
    SELECT member.id, count(contact.id) FILTER (WHERE contact.status = 'ready') AS ready_count
    FROM selected_members selected
    JOIN public.prospecting_campaign_members member ON member.id = selected.id
    LEFT JOIN public.prospecting_campaign_member_contacts contact ON contact.member_id = member.id
    GROUP BY member.id
  )
  UPDATE public.prospecting_campaign_members member
  SET status = CASE
        WHEN contact_health.ready_count = 0 THEN 'suppressed'
        WHEN campaign_row.kind = 'dialer' THEN 'active'
        ELSE 'needs_review'
      END,
      suppression_reason = CASE WHEN contact_health.ready_count = 0 THEN 'all_phone_targets_blocked' ELSE NULL END,
      next_action_at = NULL,
      completed_at = NULL,
      updated_at = now()
  FROM contact_health
  WHERE member.id = contact_health.id;

  UPDATE public.prospecting_campaign_members member
  SET search_text = trim(lower(regexp_replace(concat_ws(' ',
    member.search_text,
    contacts.contact_text
  ), '[[:space:]]+', ' ', 'g')))
  FROM (
    SELECT contact.member_id, string_agg(concat_ws(' ', contact.phone_snapshot, contact.contact_name, contact.relationship), ' ') AS contact_text
    FROM public.prospecting_campaign_member_contacts contact
    GROUP BY contact.member_id
  ) contacts
  WHERE member.id = contacts.member_id
    AND member.campaign_id = p_campaign_id;

  SELECT count(*) INTO subject_count
  FROM public.prospecting_campaign_members member
  WHERE member.campaign_id = p_campaign_id
    AND member.status <> 'removed'
    AND (
      (member.subject_kind = 'lead' AND member.lead_id IN (SELECT lead_id FROM county_campaign_selection WHERE lead_id IS NOT NULL))
      OR
      (member.subject_kind = 'prospect' AND member.prospect_id IN (SELECT prospect_id FROM county_campaign_selection WHERE lead_id IS NULL))
    );
  SELECT
    count(*) FILTER (WHERE member.status = 'active'),
    count(*) FILTER (WHERE member.status = 'needs_review'),
    count(*) FILTER (WHERE member.status = 'suppressed')
  INTO eligible_count, review_count, suppressed_count
  FROM public.prospecting_campaign_members member
  WHERE member.campaign_id = p_campaign_id
    AND member.status <> 'removed'
    AND (
      (member.subject_kind = 'lead' AND member.lead_id IN (SELECT lead_id FROM county_campaign_selection WHERE lead_id IS NOT NULL))
      OR
      (member.subject_kind = 'prospect' AND member.prospect_id IN (SELECT prospect_id FROM county_campaign_selection WHERE lead_id IS NULL))
    );
  SELECT count(*) INTO missing_count FROM county_campaign_selection WHERE best_phone IS NULL;

  INSERT INTO public.prospecting_campaign_events (campaign_id, event_type, actor, metadata)
  VALUES (
    p_campaign_id,
    'county_audience_enrolled',
    coalesce(nullif(trim(p_actor_name), ''), trim(p_actor_email)),
    jsonb_build_object(
      'saved_view', p_saved_view,
      'deceased_filter', p_deceased_filter,
      'property_filter', p_property_filter,
      'requested', matched_count,
      'subjects', subject_count,
      'eligible', eligible_count,
      'needs_review', review_count,
      'suppressed', suppressed_count,
      'missing', missing_count
    )
  );

  RETURN jsonb_build_object(
    'requested', matched_count,
    'subjects', subject_count,
    'eligible', eligible_count,
    'needsReview', review_count,
    'suppressed', suppressed_count,
    'missing', missing_count
  );
END
$$;

REVOKE ALL ON FUNCTION public.enroll_county_prospecting_campaign_members_v1(uuid, text, text, text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_county_prospecting_campaign_members_v1(uuid, text, text, text, text, text, integer)
  TO service_role;

-- A source Prospect reply has no lead_id. Canonical phone identity therefore
-- participates in the same stop rule as Lead identity.
CREATE OR REPLACE FUNCTION public.stop_prospecting_members_on_reply_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  direction_value text := lower(coalesce(NEW.metadata ->> 'direction', ''));
  inbound_phone_key text := public.prospecting_phone_key_v1(coalesce(NEW.metadata ->> 'from', NEW.metadata ->> 'phone', NEW.metadata ->> 'to'));
  stopped record;
BEGIN
  IF direction_value NOT IN ('inbound', 'incoming', 'received')
    OR lower(coalesce(NEW.metadata ->> 'is_team', 'false')) IN ('true', '1', 'yes')
    OR lower(coalesce(NEW.metadata ->> 'is_internal', 'false')) IN ('true', '1', 'yes')
  THEN RETURN NEW; END IF;

  FOR stopped IN
    UPDATE public.prospecting_campaign_members member
      SET status = 'replied', suppression_reason = NULL, next_action_at = NULL,
          completed_at = coalesce(member.completed_at, now()), updated_at = now()
    FROM public.prospecting_campaigns campaign
    WHERE member.campaign_id = campaign.id
      AND member.status IN ('active', 'needs_review', 'completed')
      AND campaign.kind = 'sms'
      AND campaign.status IN ('active', 'paused', 'completed')
      AND (
        (NEW.lead_id IS NOT NULL AND member.lead_id = NEW.lead_id)
        OR
        (inbound_phone_key <> '' AND EXISTS (
          SELECT 1 FROM public.prospecting_campaign_member_contacts contact
          WHERE contact.member_id = member.id AND contact.contact_key = inbound_phone_key
        ))
      )
    RETURNING member.id, member.campaign_id
  LOOP
    UPDATE public.prospecting_campaign_actions
      SET status = 'cancelled', completed_at = now(), error_code = 'contact_replied'
      WHERE member_id = stopped.id AND status IN ('queued', 'processing');
    INSERT INTO public.prospecting_campaign_events (campaign_id, member_id, event_type, actor, metadata)
    VALUES (
      stopped.campaign_id, stopped.id, 'campaign_member_replied', 'Seller reply',
      jsonb_strip_nulls(jsonb_build_object(
        'lead_activity_id', NEW.id,
        'message', nullif(left(coalesce(NEW.description, ''), 1400), ''),
        'from_phone', nullif(NEW.metadata ->> 'from', '')
      ))
    );
  END LOOP;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.stop_prospecting_members_on_reply_v1()
  FROM PUBLIC, anon, authenticated;
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
DECLARE
  stopped record;
  stop_reason text := coalesce(nullif(NEW.reason, ''), 'sms_opt_out');
  stop_phone_key text := public.prospecting_phone_key_v1(NEW.phone);
BEGIN
  IF NEW.is_opted_out IS DISTINCT FROM true THEN RETURN NEW; END IF;

  UPDATE public.prospecting_campaign_member_contacts contact
  SET status = 'suppressed', suppression_reason = stop_reason, selected_for_sms = false, updated_at = now()
  WHERE contact.contact_key = stop_phone_key AND contact.status <> 'removed';

  FOR stopped IN
    UPDATE public.prospecting_campaign_members member
      SET status = 'suppressed', suppression_reason = stop_reason, next_action_at = NULL,
          completed_at = coalesce(member.completed_at, now()), updated_at = now()
    FROM public.prospecting_campaigns campaign
    WHERE member.campaign_id = campaign.id
      AND campaign.kind = 'sms'
      AND campaign.status IN ('active', 'paused', 'completed')
      AND member.status IN ('active', 'needs_review', 'completed', 'replied')
      AND EXISTS (
        SELECT 1 FROM public.prospecting_campaign_member_contacts contact
        WHERE contact.member_id = member.id AND contact.contact_key = stop_phone_key
      )
    RETURNING member.id, member.campaign_id
  LOOP
    UPDATE public.prospecting_campaign_actions
      SET status = 'cancelled', completed_at = now(), error_code = 'sms_opt_out'
      WHERE member_id = stopped.id AND status IN ('queued', 'processing');
    INSERT INTO public.prospecting_campaign_events (campaign_id, member_id, event_type, actor, metadata)
    VALUES (
      stopped.campaign_id, stopped.id, 'campaign_member_suppressed', 'SMS consent',
      jsonb_build_object('reason', stop_reason, 'phone', NEW.phone)
    );
  END LOOP;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.suppress_prospecting_members_on_opt_out_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suppress_prospecting_members_on_opt_out_v1() TO service_role;

DROP TRIGGER IF EXISTS prospecting_suppress_on_sms_opt_out ON public.sms_opt_outs;
CREATE TRIGGER prospecting_suppress_on_sms_opt_out
  AFTER INSERT OR UPDATE OF is_opted_out, reason ON public.sms_opt_outs
  FOR EACH ROW
  WHEN (NEW.is_opted_out = true)
  EXECUTE FUNCTION public.suppress_prospecting_members_on_opt_out_v1();

COMMENT ON TABLE public.prospecting_campaign_member_contacts IS
  'Immutable reviewed phone snapshots for campaign subjects. Source prospects remain separate from CRM leads.';
COMMENT ON COLUMN public.prospecting_campaign_members.subject_kind IS
  'Canonical campaign subject: lead for a CRM lifecycle record, prospect for unpromoted source inventory.';
