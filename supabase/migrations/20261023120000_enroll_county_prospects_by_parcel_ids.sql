-- Enroll an exact reviewed Jackson parcel list into a draft or paused
-- campaign. This copies the saved-view snapshot, suppression, search-text,
-- and contact logic; it does not select by delinquency filters, create CRM
-- leads, or mutate any hardcoded campaign id.
-- hygiene-approved-destructive: only a new function definition is added.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.enroll_county_prospecting_campaign_members_by_ids_v1(
  p_campaign_id uuid,
  p_actor_email text,
  p_actor_name text,
  p_parcel_ids text[],
  p_reviewed_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  campaign_row public.prospecting_campaigns;
  requested_count integer;
  matched_count integer;
  subject_count integer;
  eligible_count integer;
  review_count integer;
  suppressed_count integer;
  missing_count integer;
BEGIN
  IF p_parcel_ids IS NULL
    OR p_reviewed_count < 1
    OR p_reviewed_count > 25000
    OR coalesce(array_length(p_parcel_ids, 1), 0) IS DISTINCT FROM p_reviewed_count
  THEN
    RAISE EXCEPTION 'invalid_county_audience';
  END IF;

  SELECT * INTO campaign_row
  FROM public.prospecting_campaigns
  WHERE id = p_campaign_id AND lower(owner_email) = lower(trim(p_actor_email))
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF campaign_row.status NOT IN ('draft', 'paused') THEN RAISE EXCEPTION 'campaign_members_locked'; END IF;

  DROP TABLE IF EXISTS pg_temp.county_parcel_id_request;
  CREATE TEMP TABLE county_parcel_id_request ON COMMIT DROP AS
  SELECT DISTINCT nullif(btrim(parcel_id), '') AS parcel_id
  FROM unnest(p_parcel_ids) AS parcel_id
  WHERE nullif(btrim(parcel_id), '') IS NOT NULL
    AND char_length(btrim(parcel_id)) <= 80;

  SELECT count(*) INTO requested_count FROM county_parcel_id_request;
  IF requested_count IS DISTINCT FROM p_reviewed_count THEN RAISE EXCEPTION 'county_audience_changed'; END IF;

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
  JOIN county_parcel_id_request requested
    ON requested.parcel_id = prospect.parcel_id
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
  WHERE lower(trim(coalesce(prospect.county, ''))) = 'jackson';

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
      'source', 'parcel_ids',
      'county', 'jackson',
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

REVOKE ALL ON FUNCTION public.enroll_county_prospecting_campaign_members_by_ids_v1(uuid, text, text, text[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_county_prospecting_campaign_members_by_ids_v1(uuid, text, text, text[], integer)
  TO service_role;

COMMENT ON FUNCTION public.enroll_county_prospecting_campaign_members_by_ids_v1(uuid, text, text, text[], integer) IS
  'Enroll reviewed Jackson parcel IDs into a draft or paused campaign. Snapshots every associated phone, keeps selected_for_sms false, and never inserts CRM leads.';
