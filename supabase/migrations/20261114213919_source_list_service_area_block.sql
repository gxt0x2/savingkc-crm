-- Block dialer export rows whose county or situs county is outside the
-- Saving KC service area: Jackson, Clay, and Platte (MO), Wyandotte and
-- Johnson (KS). A null or blank county is not a block. Zip is not an input.
-- 64063 (Lee's Summit) and 64080 cross county lines, so a zip match would
-- drop in-area rows. Existing opt-out and do-not-call checks are unchanged
-- and still win when they match.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1(
  p_phone text,
  p_county text DEFAULT NULL,
  p_situs_county text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN public.normalize_conversation_phone(p_phone) IS NULL THEN 'invalid_phone'
    WHEN EXISTS (
      SELECT 1
      FROM public.sms_opt_outs AS opt_out
      WHERE opt_out.is_opted_out IS TRUE
        AND public.prospecting_phone_key_v1(opt_out.phone) = public.prospecting_phone_key_v1(p_phone)
    ) THEN 'sms_opt_out'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE phone.voice_hold IS TRUE
        AND public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
    ) THEN 'voice_hold'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE lower(regexp_replace(coalesce(phone.last_disposition, ''), '[[:space:]-]+', '_', 'g')) IN ('dnc', 'do_not_call')
        AND public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
    ) THEN 'prospect_dnc'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND (
          lower(regexp_replace(coalesce(phone.last_disposition, ''), '[[:space:]-]+', '_', 'g')) = 'wrong_number'
          OR lower(btrim(coalesce(phone.phone_connected::text, ''))) = 'wrong_number'
        )
    ) THEN 'wrong_number'
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
        AND (
          lower(regexp_replace(coalesce(phone.last_disposition, ''), '[[:space:]-]+', '_', 'g')) IN ('disconnected', 'bad_number', 'not_in_service')
          OR lower(btrim(coalesce(phone.phone_connected::text, ''))) IN ('false', 'no', 'disconnected', 'bad_number')
        )
    ) THEN 'disconnected'
    WHEN EXISTS (
      SELECT 1
      FROM public.crm_contact_methods AS method
      WHERE method.method_type = 'phone'
        AND method.sms_consent_status = 'opted_out'
        AND public.prospecting_phone_key_v1(method.normalized_value) = public.prospecting_phone_key_v1(p_phone)
    ) THEN 'contact_opt_out'
    WHEN EXISTS (
      SELECT 1
      FROM public.crm_contact_methods AS method
      WHERE method.method_type = 'phone'
        AND method.deliverability_status = 'blocked'
        AND public.prospecting_phone_key_v1(method.normalized_value) = public.prospecting_phone_key_v1(p_phone)
    ) THEN 'contact_blocked'
    WHEN EXISTS (
      SELECT 1
      FROM public.leads AS lead
      WHERE public.prospecting_phone_key_v1(lead.phone) = public.prospecting_phone_key_v1(p_phone)
        AND (
          lower(coalesce(lead.dead_reason, '')) IN ('dnc_refused', 'dnc', 'do_not_call')
          OR lower(regexp_replace(coalesce(lead.call_result, ''), '[[:space:]-]+', '_', 'g')) IN ('dnc', 'do_not_call')
        )
    ) THEN 'lead_dnc'
    WHEN EXISTS (
      SELECT 1
      FROM (VALUES (p_county), (p_situs_county)) AS candidate(county_value)
      CROSS JOIN LATERAL (
        SELECT NULLIF(
          regexp_replace(
            btrim(regexp_replace(
              regexp_replace(
                lower(btrim(coalesce(candidate.county_value, ''))),
                '[^a-z]+',
                ' ',
                'g'
              ),
              '\y(county|missouri|kansas|mo|ks)\y',
              '',
              'g'
            )),
            '\s+',
            ' ',
            'g'
          ),
          ''
        ) AS slug
      ) AS normalized
      WHERE normalized.slug IS NOT NULL
        AND normalized.slug NOT IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte')
    ) THEN 'out_of_service_area'
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.source_list_phone_block_reason_v1(text, text, text) IS
  'Live scrub. Returns why a phone is excluded, including prospect_phones wrong-number and disconnected stamps or dispositions, or out_of_service_area when county or situs county is outside Jackson, Clay, Platte, Wyandotte, and Johnson. A null county is not a block. Zip is not used, because 64063 and 64080 cross county lines. Null when the number may be exported.';

CREATE OR REPLACE VIEW public.source_list_dialer_phone_review
WITH (security_invoker = true) AS
SELECT
  dialed.source_list_row_id,
  dialed.source_list_id,
  dialed.list_type,
  dialed.county,
  dialed.state,
  dialed.violation_kind,
  dialed.parcel_id,
  dialed.case_id,
  dialed.address,
  dialed.owner_names,
  dialed.amount_owed,
  dialed.property_id,
  dialed.prospect_id,
  dialed.row_status,
  dialed.phone_value,
  dialed.phone_e164,
  dialed.phone_origin,
  dialed.pull_date,
  dialed.source_file_name,
  public.source_list_phone_block_reason_v1(
    dialed.phone_value,
    dialed.county,
    dialed.situs_county
  ) AS block_reason
FROM (
  SELECT DISTINCT ON (
    row.id,
    coalesce(public.normalize_conversation_phone(phone.phone_value), btrim(phone.phone_value))
  )
    row.id AS source_list_row_id,
    row.source_list_id,
    row.list_type,
    row.county,
    row.state,
    row.violation_kind,
    row.parcel_id,
    row.case_id,
    row.address,
    row.owner_names,
    row.amount_owed,
    row.property_id,
    row.prospect_id,
    row.status AS row_status,
    phone.phone_value,
    public.normalize_conversation_phone(phone.phone_value) AS phone_e164,
    phone.phone_origin,
    list.pull_date,
    list.source_file_name,
    coalesce(
      NULLIF(btrim(row.raw->>'situs_county'), ''),
      NULLIF(btrim(row.raw->>'county'), ''),
      (
        SELECT NULLIF(btrim(prospect.county), '')
        FROM public.prospects AS prospect
        WHERE prospect.id = row.prospect_id
      ),
      (
        SELECT NULLIF(btrim(property.county), '')
        FROM public.crm_properties AS property
        WHERE property.id = row.property_id
      )
    ) AS situs_county
  FROM public.source_list_rows AS row
  JOIN public.source_lists AS list ON list.id = row.source_list_id
  CROSS JOIN LATERAL (
    SELECT phone_value, 'source_row'::text AS phone_origin
    FROM unnest(row.phones) AS phone_value
    WHERE nullif(btrim(phone_value), '') IS NOT NULL
    UNION ALL
    SELECT prospect_phone.phone, 'prospect_phone'::text
    FROM public.prospect_phones AS prospect_phone
    WHERE row.prospect_id IS NOT NULL
      AND prospect_phone.prospect_id = row.prospect_id
      AND nullif(btrim(prospect_phone.phone), '') IS NOT NULL
  ) AS phone
  WHERE row.status IN ('ready', 'loaded_to_dialer')
  ORDER BY
    row.id,
    coalesce(public.normalize_conversation_phone(phone.phone_value), btrim(phone.phone_value)),
    (phone.phone_origin = 'prospect_phone') DESC
) AS dialed;

COMMENT ON VIEW public.source_list_dialer_phone_review IS
  'Review rows include suppressed numbers and block_reason, including out_of_service_area. Do not load the dialer from this view.';

COMMENT ON VIEW public.source_list_dialer_export IS
  'Dialer load file. Drops opt-out, do-not-call, voice-hold, blocked, wrong-number, disconnected, and out-of-service-area phones at read time.';

COMMENT ON VIEW public.source_list_dialer_suppressed IS
  'Phones removed from the dialer export, with block_reason such as wrong_number, disconnected, or out_of_service_area.';

-- The only one-argument call was source_list_dialer_phone_review in
-- 20261202120000_source_lists.sql. This migration replaces that view
-- above, so nothing still calls source_list_phone_block_reason_v1(text).
DROP FUNCTION IF EXISTS public.source_list_phone_block_reason_v1(text);

REVOKE ALL ON FUNCTION public.source_list_phone_block_reason_v1(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.source_list_phone_block_reason_v1(text, text, text)
  TO service_role;
