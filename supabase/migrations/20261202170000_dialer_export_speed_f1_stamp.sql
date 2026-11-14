-- Set-based export scrub, unmapped stamp rank, and the F1 release.
-- Does not clear voice_hold, does not read or write mojo_call_queue, and does
-- not create mojo_encode_queue. A missing encode queue stays a no-op.

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS dialer_property_key text;

CREATE OR REPLACE FUNCTION public.prospects_set_property_key_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  NEW.dialer_property_key := public.dialer_property_key_v1(
    NEW.parcel_id,
    NEW.county,
    coalesce(NEW.situs_street, NEW.situs_address),
    NEW.situs_zip
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prospects_set_property_key ON public.prospects;
CREATE TRIGGER prospects_set_property_key
  BEFORE INSERT OR UPDATE OF parcel_id, county, situs_street, situs_address, situs_zip
  ON public.prospects
  FOR EACH ROW
  EXECUTE FUNCTION public.prospects_set_property_key_v1();

UPDATE public.prospects
SET dialer_property_key = public.dialer_property_key_v1(
  parcel_id, county, coalesce(situs_street, situs_address), situs_zip
)
WHERE dialer_property_key IS DISTINCT FROM public.dialer_property_key_v1(
  parcel_id, county, coalesce(situs_street, situs_address), situs_zip
);

CREATE INDEX IF NOT EXISTS idx_prospects_dialer_property_key
  ON public.prospects (dialer_property_key)
  WHERE dialer_property_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.dialer_set_phone_key_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  raw text := coalesce(
    to_jsonb(NEW)->>'phone',
    to_jsonb(NEW)->>'normalized_phone',
    to_jsonb(NEW)->>'normalized_value'
  );
BEGIN
  NEW.dialer_phone_key := public.prospecting_phone_key_v1(raw);
  RETURN NEW;
END;
$function$;

ALTER TABLE public.prospect_phones ADD COLUMN IF NOT EXISTS dialer_phone_key text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS dialer_phone_key text;
ALTER TABLE public.sms_opt_outs ADD COLUMN IF NOT EXISTS dialer_phone_key text;
ALTER TABLE public.crm_mojo_call_events ADD COLUMN IF NOT EXISTS dialer_phone_key text;

DROP TRIGGER IF EXISTS prospect_phones_set_phone_key ON public.prospect_phones;
CREATE TRIGGER prospect_phones_set_phone_key
  BEFORE INSERT OR UPDATE OF phone ON public.prospect_phones
  FOR EACH ROW EXECUTE FUNCTION public.dialer_set_phone_key_v1();
DROP TRIGGER IF EXISTS leads_set_phone_key ON public.leads;
CREATE TRIGGER leads_set_phone_key
  BEFORE INSERT OR UPDATE OF phone ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.dialer_set_phone_key_v1();
DROP TRIGGER IF EXISTS sms_opt_outs_set_phone_key ON public.sms_opt_outs;
CREATE TRIGGER sms_opt_outs_set_phone_key
  BEFORE INSERT OR UPDATE OF phone ON public.sms_opt_outs
  FOR EACH ROW EXECUTE FUNCTION public.dialer_set_phone_key_v1();
DROP TRIGGER IF EXISTS crm_mojo_call_events_set_phone_key ON public.crm_mojo_call_events;
CREATE TRIGGER crm_mojo_call_events_set_phone_key
  BEFORE INSERT OR UPDATE OF normalized_phone ON public.crm_mojo_call_events
  FOR EACH ROW EXECUTE FUNCTION public.dialer_set_phone_key_v1();

UPDATE public.prospect_phones
SET dialer_phone_key = public.prospecting_phone_key_v1(phone)
WHERE dialer_phone_key IS DISTINCT FROM public.prospecting_phone_key_v1(phone);
UPDATE public.leads
SET dialer_phone_key = public.prospecting_phone_key_v1(phone)
WHERE dialer_phone_key IS DISTINCT FROM public.prospecting_phone_key_v1(phone);
UPDATE public.sms_opt_outs
SET dialer_phone_key = public.prospecting_phone_key_v1(phone)
WHERE dialer_phone_key IS DISTINCT FROM public.prospecting_phone_key_v1(phone);
UPDATE public.crm_mojo_call_events
SET dialer_phone_key = public.prospecting_phone_key_v1(normalized_phone)
WHERE dialer_phone_key IS DISTINCT FROM public.prospecting_phone_key_v1(normalized_phone);

CREATE INDEX IF NOT EXISTS idx_prospect_phones_dialer_phone_key_stored
  ON public.prospect_phones (dialer_phone_key);
CREATE INDEX IF NOT EXISTS idx_leads_dialer_phone_key_stored
  ON public.leads (dialer_phone_key);
CREATE INDEX IF NOT EXISTS idx_sms_opt_outs_dialer_phone_key_stored
  ON public.sms_opt_outs (dialer_phone_key);
CREATE INDEX IF NOT EXISTS idx_crm_mojo_call_events_dialer_phone_key_stored
  ON public.crm_mojo_call_events (dialer_phone_key);

CREATE INDEX IF NOT EXISTS idx_leads_prospecting_phone
  ON public.leads (public.prospecting_phone_key_v1(phone));

CREATE INDEX IF NOT EXISTS idx_crm_mojo_calls_record_id
  ON public.crm_mojo_calls (record_id)
  WHERE record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_mojo_call_events_record_id
  ON public.crm_mojo_call_events (record_id)
  WHERE record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_mojo_calls_suppression_last4
  ON public.crm_mojo_calls (phone_last4)
  WHERE phone_last4 IS NOT NULL
    AND public.dialer_label_key_v1(result_label) IN (
      'dnc', 'do_not_call', 'dnc_number', 'dnc_contact', 'take_me_off',
      'fax', 'dead', 'bad_number', 'not_in_service', 'disconnected'
    );

CREATE OR REPLACE FUNCTION public.dialer_stamp_rank_v1(p_label text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $function$
  WITH keyed AS (
    SELECT public.dialer_label_key_v1(p_label) AS label
  )
  SELECT CASE
    WHEN label IS NULL THEN 0
    WHEN label IN ('take_me_off', 'dnc_contact') THEN 50
    WHEN label = 'dnc_number' THEN 40
    WHEN label IN ('dnc', 'do_not_call', 'dead') THEN 30
    WHEN label IN ('fax', 'bad_number', 'not_in_service', 'disconnected', 'wrong_number') THEN 20
    WHEN public.dialer_suppression_class_v1('prospect_disposition', label) = 'unmapped' THEN 25
    WHEN label IN (
      'spoke_with_owner', 'callback_requested', 'appointment_set',
      'deal_potential', 'offer_made', 'not_interested'
    ) THEN 10
    ELSE 0
  END
  FROM keyed;
$function$;

COMMENT ON FUNCTION public.dialer_stamp_rank_v1(text) IS
  'Unmapped labels outrank no_answer and the other allow stamps. A known DNC label still outranks an unmapped label.';

CREATE OR REPLACE FUNCTION public.dialer_unknown_tie_release_v1(
  p_relationship text,
  p_contact_name text,
  p_owner_name text,
  p_owner_last text,
  p_skip_traced boolean,
  p_verified_source text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $function$
  WITH tokens AS (
    SELECT
      public.dialer_label_key_v1(p_relationship) AS rel,
      public.dialer_label_key_v1(p_contact_name) AS contact,
      public.dialer_label_key_v1(p_owner_name) AS owner_name,
      public.dialer_label_key_v1(p_owner_last) AS owner_last,
      public.dialer_label_key_v1(p_verified_source) AS source
  )
  SELECT CASE
    WHEN rel = 'registered_agent'
      OR contact = 'registered_agent'
      OR coalesce(contact, '') LIKE '%registered_agent%' THEN false
    WHEN rel IN ('member', 'officer')
      OR contact IN ('member', 'officer')
      OR coalesce(rel, '') ~ '(^|_)(member|officer)($|_)'
      OR coalesce(contact, '') ~ '(^|_)(member|officer)($|_)' THEN true
    WHEN coalesce(p_skip_traced, false) OR coalesce(source, '') LIKE '%skip%' THEN
      contact IS NOT NULL AND (
        contact = owner_name
        OR contact = owner_last
        OR (owner_last IS NOT NULL AND contact LIKE ('%\_' || owner_last))
        OR (owner_last IS NOT NULL AND contact LIKE (owner_last || '\_%'))
      )
    ELSE false
  END
  FROM tokens;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_encode_block_keys_v1(p_keys text[])
RETURNS TABLE(phone_key text, block_reason text)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF to_regclass('public.mojo_encode_queue') IS NULL OR coalesce(cardinality(p_keys), 0) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE $encode$
    SELECT DISTINCT public.prospecting_phone_key_v1(k.phone),
      CASE
        WHEN length(public.prospecting_phone_key_v1(pending.phone)) = 10 THEN 'mojo_encode_pending'
        ELSE 'hold_last4'
      END
    FROM unnest($1) AS k(phone)
    JOIN public.mojo_encode_queue AS pending
      ON pending.encoded_at IS NULL
     AND (
       public.prospecting_phone_key_v1(pending.phone) = public.prospecting_phone_key_v1(k.phone)
       OR (
         length(public.prospecting_phone_key_v1(pending.phone)) BETWEEN 4 AND 9
         AND right(public.prospecting_phone_key_v1(pending.phone), 4) = right(public.prospecting_phone_key_v1(k.phone), 4)
       )
     )
  $encode$
  USING p_keys;
EXCEPTION
  WHEN undefined_column OR undefined_table OR undefined_function THEN
    RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.source_list_phone_block_reasons_v1(p_phones text[], p_prospects uuid[])
RETURNS TABLE(ordinal bigint, block_reason text)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  WITH input AS MATERIALIZED (
    SELECT
      item.ordinal,
      item.phone,
      item.prospect_id,
      public.normalize_conversation_phone(item.phone) AS e164,
      public.prospecting_phone_key_v1(item.phone) AS key10
    FROM unnest(coalesce(p_phones, ARRAY[]::text[]), coalesce(p_prospects, ARRAY[]::uuid[]))
      WITH ORDINALITY AS item(phone, prospect_id, ordinal)
  ),
  classified_phones AS MATERIALIZED (
    SELECT
      phone.prospect_id,
      phone.dialer_phone_key AS key10,
      phone.voice_hold,
      phone.voice_hold_reason,
      phone.relationship,
      phone.contact_name,
      phone.verified_source,
      prospect.owner_1,
      prospect.owner_1_last,
      prospect.is_skip_traced,
      prospect.dialer_household_key,
      prospect.dialer_property_key,
      public.dialer_label_key_v1(phone.last_disposition) AS disposition_key,
      public.dialer_label_key_v1(phone.phone_connected) AS connected_key,
      public.dialer_relationship_bucket_v1(phone.relationship, prospect.owner_1_type) AS bucket
    FROM public.prospect_phones AS phone
    JOIN public.prospects AS prospect ON prospect.id = phone.prospect_id
  ),
  fanout_keys AS MATERIALIZED (
    SELECT sibling.key10, anchor.dialer_property_key AS property_key, anchor.prospect_id
    FROM classified_phones AS anchor
    JOIN classified_phones AS sibling ON sibling.prospect_id = anchor.prospect_id
    WHERE anchor.voice_hold IS TRUE
      AND public.dialer_label_key_v1(anchor.voice_hold_reason) LIKE '%mojo_dnc_contact_fanout%'
      AND length(anchor.key10) = 10
      AND length(sibling.key10) = 10
  ),
  dnc_properties AS MATERIALIZED (
    SELECT DISTINCT owner.dialer_property_key AS property_key
    FROM classified_phones AS owner
    WHERE owner.bucket = 'owner'
      AND length(owner.key10) = 10
      AND owner.dialer_property_key IS NOT NULL
      AND (
        owner.disposition_key IN ('dnc', 'do_not_call', 'dnc_number', 'dnc_contact', 'take_me_off', 'dead', 'fax')
        OR EXISTS (
          SELECT 1 FROM public.sms_opt_outs AS opt_out
          WHERE opt_out.is_opted_out IS TRUE AND opt_out.dialer_phone_key = owner.key10
        )
        OR EXISTS (
          SELECT 1 FROM public.crm_mojo_call_events AS event
          WHERE event.dialer_phone_key = owner.key10
            AND public.dialer_label_key_v1(event.outcome) = 'dnc'
        )
      )
  ),
  hits AS (
    SELECT input.ordinal, 'invalid_phone'::text AS block_reason, 10 AS priority
    FROM input WHERE input.e164 IS NULL
    UNION ALL
    SELECT input.ordinal, 'sms_opt_out', 20
    FROM input
    JOIN public.sms_opt_outs AS opt_out
      ON opt_out.is_opted_out IS TRUE AND opt_out.dialer_phone_key = input.key10
    WHERE length(input.key10) = 10
    UNION ALL
    SELECT input.ordinal, 'voice_hold', 30
    FROM input
    JOIN classified_phones AS phone
      ON phone.key10 = input.key10
     AND phone.voice_hold IS TRUE
     AND coalesce(public.dialer_label_key_v1(phone.voice_hold_reason), '') NOT LIKE '%mojo_dnc_contact_fanout%'
    WHERE length(input.key10) = 10
    UNION ALL
    SELECT input.ordinal,
      CASE
        WHEN phone.disposition_key IN ('dnc', 'do_not_call', 'dnc_number', 'dnc_contact', 'take_me_off') THEN 'prospect_dnc'
        WHEN phone.disposition_key = 'wrong_number' THEN 'wrong_number'
        WHEN phone.disposition_key IN ('dead', 'fax', 'disconnected', 'bad_number', 'not_in_service') THEN 'disconnected'
        ELSE 'unmapped_label'
      END,
      CASE
        WHEN phone.disposition_key IN ('dnc', 'do_not_call', 'dnc_number', 'dnc_contact', 'take_me_off') THEN 40
        WHEN phone.disposition_key = 'wrong_number' THEN 41
        WHEN phone.disposition_key IN ('dead', 'fax', 'disconnected', 'bad_number', 'not_in_service') THEN 42
        ELSE 43
      END
    FROM input
    JOIN classified_phones AS phone ON phone.key10 = input.key10
    WHERE length(input.key10) = 10
      AND phone.disposition_key IS NOT NULL
      AND phone.disposition_key NOT IN (
        'no_answer', 'left_voicemail', 'left_vm', 'not_interested', 'spoke_with_owner',
        'callback_requested', 'busy', 'appointment_set', 'deal_potential', 'offer_made',
        'answered', 'contact', 'interested'
      )
    UNION ALL
    SELECT input.ordinal,
      CASE
        WHEN phone.connected_key = 'wrong_number' THEN 'wrong_number'
        WHEN phone.connected_key IN ('disconnected', 'false', 'no', 'bad_number') THEN 'disconnected'
        ELSE 'unmapped_label'
      END,
      CASE
        WHEN phone.connected_key = 'wrong_number' THEN 51
        WHEN phone.connected_key IN ('disconnected', 'false', 'no', 'bad_number') THEN 52
        ELSE 53
      END
    FROM input
    JOIN classified_phones AS phone ON phone.key10 = input.key10
    WHERE length(input.key10) = 10
      AND phone.connected_key IS NOT NULL
      AND phone.connected_key NOT IN ('connected', 'dataskip_dnc')
    UNION ALL
    SELECT input.ordinal, 'contact_opt_out', 60
    FROM input
    JOIN public.crm_contact_methods AS method
      ON method.method_type = 'phone'
     AND method.sms_consent_status = 'opted_out'
     AND public.prospecting_phone_key_v1(method.normalized_value) = input.key10
    WHERE length(input.key10) = 10
    UNION ALL
    SELECT input.ordinal, 'contact_blocked', 61
    FROM input
    JOIN public.crm_contact_methods AS method
      ON method.method_type = 'phone'
     AND method.deliverability_status = 'blocked'
     AND public.prospecting_phone_key_v1(method.normalized_value) = input.key10
    WHERE length(input.key10) = 10
    UNION ALL
    SELECT input.ordinal,
      CASE class.class
        WHEN 'person_dnc' THEN 'lead_dnc'
        WHEN 'lead_dnc' THEN 'lead_dnc'
        WHEN 'dead_number' THEN 'dead_number'
        WHEN 'disconnected' THEN 'disconnected'
        ELSE 'unmapped_label'
      END,
      CASE class.class WHEN 'person_dnc' THEN 70 WHEN 'lead_dnc' THEN 70 WHEN 'dead_number' THEN 71 WHEN 'disconnected' THEN 72 ELSE 73 END
    FROM input
    JOIN public.leads AS lead ON lead.dialer_phone_key = input.key10
    CROSS JOIN LATERAL (
      SELECT reason.class
      FROM (
        SELECT public.dialer_suppression_class_v1('lead_call_result', lead.call_result) AS class
        UNION ALL
        SELECT public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason)
      ) AS reason
      WHERE reason.class IS NOT NULL AND reason.class <> 'allow'
      ORDER BY CASE reason.class WHEN 'person_dnc' THEN 1 WHEN 'lead_dnc' THEN 1 WHEN 'dead_number' THEN 2 WHEN 'disconnected' THEN 3 ELSE 4 END
      LIMIT 1
    ) AS class
    WHERE length(input.key10) = 10
    UNION ALL
    SELECT input.ordinal,
      CASE class.class
        WHEN 'mojo_dnc' THEN 'mojo_dnc'
        WHEN 'person_dnc' THEN 'mojo_dnc'
        WHEN 'wrong_number' THEN 'wrong_number'
        WHEN 'disconnected' THEN 'disconnected'
        ELSE 'unmapped_label'
      END,
      CASE class.class WHEN 'mojo_dnc' THEN 80 WHEN 'person_dnc' THEN 80 WHEN 'wrong_number' THEN 81 WHEN 'disconnected' THEN 82 ELSE 83 END
    FROM input
    JOIN public.crm_mojo_call_events AS event ON event.dialer_phone_key = input.key10
    CROSS JOIN LATERAL (
      SELECT raw.class
      FROM (
        SELECT public.dialer_suppression_class_v1('mojo_disposition_raw', event.disposition_raw) AS class
        WHERE public.dialer_suppression_class_v1('mojo_disposition_raw', event.disposition_raw) IS NOT NULL
          AND public.dialer_suppression_class_v1('mojo_disposition_raw', event.disposition_raw) <> 'allow'
        UNION ALL
        SELECT public.dialer_suppression_class_v1('mojo_outcome', event.outcome)
      ) AS raw
      WHERE raw.class IS NOT NULL AND raw.class <> 'allow'
      ORDER BY CASE raw.class WHEN 'mojo_dnc' THEN 1 WHEN 'person_dnc' THEN 1 WHEN 'wrong_number' THEN 2 WHEN 'disconnected' THEN 3 ELSE 4 END
      LIMIT 1
    ) AS class
    WHERE length(input.key10) = 10
    UNION ALL
    SELECT input.ordinal,
      CASE phone.bucket WHEN 'associate_non_family' THEN 'associate_non_family' ELSE 'relationship_unknown' END,
      CASE phone.bucket WHEN 'associate_non_family' THEN 90 ELSE 91 END
    FROM input
    JOIN classified_phones AS phone
      ON phone.key10 = input.key10
     AND (input.prospect_id IS NULL OR phone.prospect_id = input.prospect_id)
    WHERE length(input.key10) = 10
      AND phone.bucket IN ('associate_non_family', 'relationship_unknown')
      AND NOT (
        phone.bucket = 'relationship_unknown'
        AND public.dialer_unknown_tie_release_v1(
          phone.relationship, phone.contact_name, phone.owner_1, phone.owner_1_last,
          phone.is_skip_traced, phone.verified_source
        )
      )
    UNION ALL
    SELECT input.ordinal, 'property_owner_dnc_fanout', 100
    FROM input
    JOIN classified_phones AS candidate
      ON candidate.dialer_property_key IS NOT NULL
     AND (candidate.prospect_id = input.prospect_id OR candidate.key10 = input.key10)
    JOIN dnc_properties AS dnc ON dnc.property_key = candidate.dialer_property_key
    WHERE length(input.key10) = 10
    UNION ALL
    SELECT input.ordinal, 'person_fanout', 110
    FROM input
    JOIN fanout_keys AS person ON person.prospect_id = input.prospect_id AND person.key10 = input.key10
    WHERE input.prospect_id IS NOT NULL
    UNION ALL
    SELECT input.ordinal, 'person_fanout', 111
    FROM input
    JOIN classified_phones AS candidate ON candidate.prospect_id = input.prospect_id
    JOIN fanout_keys AS person
      ON person.key10 = input.key10
     AND person.property_key IS NOT NULL
     AND person.property_key = candidate.dialer_property_key
    WHERE input.prospect_id IS NOT NULL
    UNION ALL
    SELECT input.ordinal, 'needs_counsel_review', 112
    FROM input
    JOIN fanout_keys AS person ON person.key10 = input.key10
    UNION ALL
    SELECT input.ordinal, 'person_fanout', 120
    FROM input
    JOIN classified_phones AS mine ON mine.key10 = input.key10
    JOIN classified_phones AS flagged
      ON flagged.prospect_id = mine.prospect_id
     AND flagged.key10 IS DISTINCT FROM input.key10
     AND flagged.disposition_key IN ('dnc_contact', 'take_me_off')
    WHERE length(input.key10) = 10
    UNION ALL
    SELECT input.ordinal, 'person_fanout', 121
    FROM input
    JOIN classified_phones AS flagged
      ON flagged.prospect_id = input.prospect_id
     AND flagged.key10 IS DISTINCT FROM input.key10
     AND flagged.disposition_key IN ('dnc_contact', 'take_me_off')
    WHERE input.prospect_id IS NOT NULL AND length(input.key10) = 10
    UNION ALL
    SELECT input.ordinal, 'person_fanout', 123
    FROM input
    JOIN classified_phones AS mine ON mine.key10 = input.key10
    JOIN classified_phones AS other ON other.prospect_id = mine.prospect_id AND other.key10 IS DISTINCT FROM input.key10
    JOIN public.crm_mojo_call_events AS event ON event.dialer_phone_key = other.key10
    WHERE public.dialer_suppression_class_v1('mojo_disposition_raw', event.disposition_raw) = 'person_dnc'
    UNION ALL
    SELECT input.ordinal, 'person_fanout', 124
    FROM input
    JOIN public.crm_mojo_call_events AS mine_event ON mine_event.dialer_phone_key = input.key10
    JOIN public.crm_mojo_call_events AS other_event
      ON other_event.provider_contact_id = mine_event.provider_contact_id
     AND nullif(btrim(mine_event.provider_contact_id), '') IS NOT NULL
     AND other_event.dialer_phone_key IS DISTINCT FROM input.key10
    WHERE public.dialer_suppression_class_v1('mojo_disposition_raw', other_event.disposition_raw) = 'person_dnc'
    UNION ALL
    SELECT input.ordinal, 'person_fanout', 125
    FROM input
    JOIN public.leads AS lead
      ON length(lead.dialer_phone_key) = 10
     AND lead.dialer_phone_key IS DISTINCT FROM input.key10
     AND (
       public.dialer_label_key_v1(lead.dead_reason) = 'dnc_refused'
       OR (
         public.dialer_label_key_v1(lead.dead_reason) IN ('dnc', 'do_not_call')
         AND public.dialer_label_key_v1(lead.call_result) IS DISTINCT FROM 'dnc_number'
       )
       OR public.dialer_suppression_class_v1('lead_call_result', lead.call_result) = 'person_dnc'
     )
    JOIN classified_phones AS shared ON shared.key10 = lead.dialer_phone_key
    JOIN classified_phones AS sibling
      ON sibling.prospect_id = shared.prospect_id AND sibling.key10 = input.key10
    UNION ALL
    SELECT input.ordinal, 'household_fanout', 130
    FROM input
    JOIN classified_phones AS mine
      ON mine.dialer_household_key IS NOT NULL
     AND (mine.prospect_id = input.prospect_id OR mine.key10 = input.key10)
    JOIN classified_phones AS anchor
      ON anchor.dialer_household_key = mine.dialer_household_key
     AND anchor.prospect_id IS DISTINCT FROM mine.prospect_id
     AND anchor.disposition_key IN ('dnc_contact', 'take_me_off')
    UNION ALL
    SELECT input.ordinal, 'household_fanout', 131
    FROM input
    JOIN classified_phones AS mine
      ON mine.dialer_household_key IS NOT NULL
     AND (mine.prospect_id = input.prospect_id OR mine.key10 = input.key10)
    JOIN public.prospects AS anchor
      ON anchor.dialer_household_key = mine.dialer_household_key
     AND anchor.id IS DISTINCT FROM mine.prospect_id
    JOIN public.leads AS lead ON lead.id = anchor.lead_id
    WHERE public.dialer_label_key_v1(lead.dead_reason) = 'dnc_refused'
       OR (
         public.dialer_label_key_v1(lead.dead_reason) IN ('dnc', 'do_not_call')
         AND public.dialer_label_key_v1(lead.call_result) IS DISTINCT FROM 'dnc_number'
       )
       OR public.dialer_suppression_class_v1('lead_call_result', lead.call_result) = 'person_dnc'
    UNION ALL
    SELECT input.ordinal, encode.block_reason, CASE encode.block_reason WHEN 'mojo_encode_pending' THEN 140 ELSE 150 END
    FROM input
    JOIN public.dialer_encode_block_keys_v1(coalesce(p_phones, ARRAY[]::text[])) AS encode
      ON encode.phone_key = input.key10
    UNION ALL
    SELECT input.ordinal, 'hold_last4', 160
    FROM input
    WHERE length(input.key10) = 10
      AND (
        EXISTS (
          SELECT 1 FROM classified_phones AS phone
          WHERE length(phone.key10) BETWEEN 4 AND 9
            AND right(phone.key10, 4) = right(input.key10, 4)
            AND (
              phone.voice_hold IS TRUE
              OR (
                phone.disposition_key IS NOT NULL
                AND phone.disposition_key NOT IN (
                  'no_answer', 'left_voicemail', 'left_vm', 'not_interested', 'spoke_with_owner',
                  'callback_requested', 'busy', 'appointment_set', 'deal_potential', 'offer_made',
                  'answered', 'contact', 'interested'
                )
              )
              OR (phone.connected_key IS NOT NULL AND phone.connected_key NOT IN ('connected', 'dataskip_dnc'))
            )
        )
        OR EXISTS (
          SELECT 1 FROM public.leads AS lead
          WHERE length(lead.dialer_phone_key) BETWEEN 4 AND 9
            AND right(lead.dialer_phone_key, 4) = right(input.key10, 4)
            AND (
              coalesce(public.dialer_suppression_class_v1('lead_call_result', lead.call_result), 'allow') <> 'allow'
              OR coalesce(public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason), 'allow') <> 'allow'
            )
        )
        OR EXISTS (
          SELECT 1 FROM public.crm_mojo_call_events AS event
          WHERE length(event.dialer_phone_key) BETWEEN 4 AND 9
            AND right(event.dialer_phone_key, 4) = right(input.key10, 4)
            AND coalesce(public.dialer_suppression_class_v1('mojo_outcome', event.outcome), 'allow') <> 'allow'
        )
        OR EXISTS (
          SELECT 1 FROM public.sms_opt_outs AS opt_out
          WHERE opt_out.is_opted_out IS TRUE
            AND length(opt_out.dialer_phone_key) BETWEEN 4 AND 9
            AND right(opt_out.dialer_phone_key, 4) = right(input.key10, 4)
        )
        OR EXISTS (
          SELECT 1 FROM public.crm_mojo_calls AS call
          WHERE call.phone_last4 = right(input.key10, 4)
            AND public.dialer_label_key_v1(call.result_label) IN (
              'dnc', 'do_not_call', 'dnc_number', 'dnc_contact', 'take_me_off',
              'fax', 'dead', 'bad_number', 'not_in_service', 'disconnected'
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.crm_mojo_call_events AS event
              WHERE event.record_id = call.record_id AND length(event.dialer_phone_key) = 10
            )
        )
      )
  )
  SELECT DISTINCT ON (hit.ordinal) hit.ordinal, hit.block_reason
  FROM hits AS hit
  ORDER BY hit.ordinal, hit.priority;
$function$;

CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1(p_phone text, p_prospect_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT found.block_reason
  FROM public.source_list_phone_block_reasons_v1(ARRAY[p_phone], ARRAY[p_prospect_id]) AS found
  LIMIT 1;
$function$;

CREATE OR REPLACE VIEW public.source_list_dialer_phone_review
WITH (security_invoker = true) AS
WITH dialed AS (
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
    list.source_file_name
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
),
ordered AS (
  SELECT row_number() OVER (ORDER BY source_list_row_id, phone_value) AS ordinal, dialed.*
  FROM dialed
),
reasons AS (
  SELECT *
  FROM public.source_list_phone_block_reasons_v1(
    ARRAY(SELECT ordered.phone_value FROM ordered ORDER BY ordered.ordinal),
    ARRAY(SELECT ordered.prospect_id FROM ordered ORDER BY ordered.ordinal)
  )
)
SELECT
  ordered.source_list_row_id,
  ordered.source_list_id,
  ordered.list_type,
  ordered.county,
  ordered.state,
  ordered.violation_kind,
  ordered.parcel_id,
  ordered.case_id,
  ordered.address,
  ordered.owner_names,
  ordered.amount_owed,
  ordered.property_id,
  ordered.prospect_id,
  ordered.row_status,
  ordered.phone_value,
  ordered.phone_e164,
  ordered.phone_origin,
  ordered.pull_date,
  ordered.source_file_name,
  reasons.block_reason
FROM ordered
LEFT JOIN reasons ON reasons.ordinal = ordered.ordinal;

COMMENT ON VIEW public.source_list_dialer_phone_review IS
  'One set-based scrub for the export batch. Household and property matches are joins, not a loop per phone.';

REVOKE ALL ON FUNCTION public.dialer_unknown_tie_release_v1(text, text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_encode_block_keys_v1(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.source_list_phone_block_reasons_v1(text[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_stamp_rank_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_unknown_tie_release_v1(text, text, text, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_encode_block_keys_v1(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.source_list_phone_block_reasons_v1(text[], uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.source_list_phone_block_reason_v1(text, uuid) TO service_role;
