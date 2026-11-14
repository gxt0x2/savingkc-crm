-- Mojo raw labels, monotonic stamps, person fan-out, and one export pass.
-- A missing mojo_encode_queue is a no-op. voice_hold is only set true.
-- Does not read or write mojo_call_queue.

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS dialer_household_key text;

CREATE OR REPLACE FUNCTION public.prospects_set_household_key_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  NEW.dialer_household_key := public.dialer_household_key_v1(
    NEW.county,
    coalesce(NEW.situs_street, NEW.situs_address),
    NEW.owner_1_last,
    NEW.owner_1
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prospects_set_household_key ON public.prospects;
CREATE TRIGGER prospects_set_household_key
  BEFORE INSERT OR UPDATE OF county, situs_street, situs_address, owner_1_last, owner_1
  ON public.prospects
  FOR EACH ROW
  EXECUTE FUNCTION public.prospects_set_household_key_v1();

UPDATE public.prospects
SET dialer_household_key = public.dialer_household_key_v1(
  county, coalesce(situs_street, situs_address), owner_1_last, owner_1
)
WHERE dialer_household_key IS DISTINCT FROM public.dialer_household_key_v1(
  county, coalesce(situs_street, situs_address), owner_1_last, owner_1
);

CREATE INDEX IF NOT EXISTS idx_prospects_dialer_household_key
  ON public.prospects (dialer_household_key)
  WHERE dialer_household_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospect_phones_dialer_last4
  ON public.prospect_phones (right(public.prospecting_phone_key_v1(phone), 4))
  WHERE length(public.prospecting_phone_key_v1(phone)) BETWEEN 4 AND 9;
CREATE INDEX IF NOT EXISTS idx_leads_dialer_last4
  ON public.leads (right(public.prospecting_phone_key_v1(phone), 4))
  WHERE length(public.prospecting_phone_key_v1(phone)) BETWEEN 4 AND 9;
CREATE INDEX IF NOT EXISTS idx_sms_opt_outs_dialer_last4
  ON public.sms_opt_outs (right(public.prospecting_phone_key_v1(phone), 4))
  WHERE length(public.prospecting_phone_key_v1(phone)) BETWEEN 4 AND 9;
CREATE INDEX IF NOT EXISTS idx_crm_mojo_calls_dnc_last4
  ON public.crm_mojo_calls (phone_last4)
  WHERE phone_last4 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_mojo_call_events_raw_phone
  ON public.crm_mojo_call_events (
    public.dialer_label_key_v1(disposition_raw),
    public.prospecting_phone_key_v1(normalized_phone)
  );

CREATE OR REPLACE FUNCTION public.dialer_stamp_rank_v1(p_label text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE public.dialer_label_key_v1(p_label)
    WHEN 'take_me_off' THEN 50
    WHEN 'dnc_contact' THEN 50
    WHEN 'dnc_number' THEN 40
    WHEN 'dnc' THEN 30
    WHEN 'do_not_call' THEN 30
    WHEN 'dead' THEN 30
    WHEN 'fax' THEN 20
    WHEN 'bad_number' THEN 20
    WHEN 'not_in_service' THEN 20
    WHEN 'disconnected' THEN 20
    WHEN 'wrong_number' THEN 20
    WHEN 'spoke_with_owner' THEN 10
    WHEN 'callback_requested' THEN 10
    WHEN 'appointment_set' THEN 10
    WHEN 'deal_potential' THEN 10
    WHEN 'offer_made' THEN 10
    WHEN 'not_interested' THEN 10
    ELSE 0
  END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_related_person_dnc_v1(p_key text, p_prospect_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.crm_mojo_call_events AS anchor
      JOIN public.crm_mojo_call_events AS mine
        ON mine.provider_contact_id = anchor.provider_contact_id
       AND nullif(btrim(anchor.provider_contact_id), '') IS NOT NULL
      WHERE public.prospecting_phone_key_v1(mine.normalized_phone) = p_key
        AND public.prospecting_phone_key_v1(anchor.normalized_phone) IS DISTINCT FROM p_key
        AND public.dialer_suppression_class_v1('mojo_disposition_raw', anchor.disposition_raw) = 'person_dnc'
    )
    OR EXISTS (
      SELECT 1
      FROM public.prospect_phones AS mine
      JOIN public.prospect_phones AS other ON other.prospect_id = mine.prospect_id
      JOIN public.crm_mojo_call_events AS event
        ON public.prospecting_phone_key_v1(event.normalized_phone) = public.prospecting_phone_key_v1(other.phone)
      WHERE public.prospecting_phone_key_v1(mine.phone) = p_key
        AND public.prospecting_phone_key_v1(other.phone) IS DISTINCT FROM p_key
        AND public.dialer_suppression_class_v1('mojo_disposition_raw', event.disposition_raw) = 'person_dnc'
    )
    OR EXISTS (
      SELECT 1
      FROM public.leads AS lead
      JOIN public.prospect_phones AS shared
        ON public.prospecting_phone_key_v1(shared.phone) = public.prospecting_phone_key_v1(lead.phone)
       AND length(public.prospecting_phone_key_v1(lead.phone)) = 10
      JOIN public.prospect_phones AS sibling
        ON sibling.prospect_id = shared.prospect_id
       AND public.prospecting_phone_key_v1(sibling.phone) = p_key
       AND public.prospecting_phone_key_v1(sibling.phone) IS DISTINCT FROM public.prospecting_phone_key_v1(lead.phone)
      WHERE public.dialer_label_key_v1(lead.dead_reason) = 'dnc_refused'
        OR (
          public.dialer_label_key_v1(lead.dead_reason) IN ('dnc', 'do_not_call')
          AND public.dialer_label_key_v1(lead.call_result) IS DISTINCT FROM 'dnc_number'
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.dialer_fanout_voice_hold_v1(p_key text, p_prospect_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  WITH anchors AS (
    SELECT
      phone.prospect_id,
      public.prospecting_phone_key_v1(phone.phone) AS key10,
      public.dialer_property_key_v1(
        prospect.parcel_id, prospect.county,
        coalesce(prospect.situs_street, prospect.situs_address), prospect.situs_zip
      ) AS property_key
    FROM public.prospect_phones AS phone
    JOIN public.prospects AS prospect ON prospect.id = phone.prospect_id
    WHERE phone.voice_hold IS TRUE
      AND public.dialer_label_key_v1(phone.voice_hold_reason) LIKE '%mojo_dnc_contact_fanout%'
      AND length(public.prospecting_phone_key_v1(phone.phone)) = 10
  ),
  person_keys AS (
    SELECT public.prospecting_phone_key_v1(sibling.phone) AS key10, anchor.property_key, anchor.prospect_id
    FROM anchors AS anchor
    JOIN public.prospect_phones AS sibling ON sibling.prospect_id = anchor.prospect_id
    WHERE length(public.prospecting_phone_key_v1(sibling.phone)) = 10
    UNION
    SELECT key10, property_key, prospect_id FROM anchors
  )
  SELECT CASE
    WHEN p_prospect_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM person_keys AS person
      WHERE person.prospect_id = p_prospect_id
        AND EXISTS (
          SELECT 1
          FROM public.prospect_phones AS mine
          WHERE mine.prospect_id = p_prospect_id
            AND public.prospecting_phone_key_v1(mine.phone) = p_key
        )
    ) THEN 'person_fanout'
    WHEN p_prospect_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM person_keys AS person
      JOIN public.prospects AS candidate ON candidate.id = p_prospect_id
      WHERE person.key10 = p_key
        AND person.property_key IS NOT NULL
        AND person.property_key = public.dialer_property_key_v1(
          candidate.parcel_id, candidate.county,
          coalesce(candidate.situs_street, candidate.situs_address), candidate.situs_zip
        )
    ) THEN 'person_fanout'
    WHEN EXISTS (
      SELECT 1 FROM person_keys AS person WHERE person.key10 = p_key
    ) THEN 'needs_counsel_review'
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_encode_queue_has_phone_v1(p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  found boolean;
BEGIN
  IF to_regclass('public.mojo_encode_queue') IS NULL THEN
    RETURN false;
  END IF;
  BEGIN
    EXECUTE $encode$
      SELECT EXISTS (
        SELECT 1
        FROM public.mojo_encode_queue AS pending
        WHERE pending.encoded_at IS NULL
          AND public.prospecting_phone_key_v1(pending.phone) = $1
      )
    $encode$
    INTO found
    USING p_key;
    RETURN coalesce(found, false);
  EXCEPTION
    WHEN undefined_column OR undefined_table OR undefined_function THEN
      RETURN false;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_suppression_class_v1(p_source text, p_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $function$
  WITH policy AS (
    SELECT
      -- BEGIN policy prospect_phone_dnc
      ARRAY['dnc', 'do_not_call', 'dnc_number']
      -- END policy prospect_phone_dnc
      AS prospect_phone_dnc,
      -- BEGIN policy prospect_person_dnc
      ARRAY['dnc_contact', 'take_me_off']
      -- END policy prospect_person_dnc
      AS prospect_person_dnc,
      -- BEGIN policy prospect_dead
      ARRAY['dead', 'fax', 'disconnected', 'bad_number', 'not_in_service']
      -- END policy prospect_dead
      AS prospect_dead,
      -- BEGIN policy prospect_wrong
      ARRAY['wrong_number']
      -- END policy prospect_wrong
      AS prospect_wrong,
      -- BEGIN policy prospect_allow
      ARRAY['no_answer', 'left_voicemail', 'left_vm', 'not_interested', 'spoke_with_owner', 'callback_requested', 'busy', 'appointment_set', 'deal_potential', 'offer_made', 'answered', 'contact', 'interested']
      -- END policy prospect_allow
      AS prospect_allow,
      -- BEGIN policy phone_connected_allow
      ARRAY['connected', 'dataskip_dnc']
      -- END policy phone_connected_allow
      AS phone_connected_allow,
      -- BEGIN policy phone_connected_disconnected
      ARRAY['disconnected', 'false', 'no', 'bad_number']
      -- END policy phone_connected_disconnected
      AS phone_connected_disconnected,
      -- BEGIN policy lead_call_dead
      ARRAY['dead', 'bad_number']
      -- END policy lead_call_dead
      AS lead_call_dead,
      -- BEGIN policy lead_call_allow
      ARRAY['no_answer', 'contact', 'interested', 'callback_requested', 'answered', 'spoke_with_owner', 'activity_deleted', 'not_interested', 'left_voicemail', 'left_vm', 'appointment_set']
      -- END policy lead_call_allow
      AS lead_call_allow,
      -- BEGIN policy lead_dead_phone_dnc
      ARRAY['dnc', 'do_not_call']
      -- END policy lead_dead_phone_dnc
      AS lead_dead_phone_dnc,
      -- BEGIN policy lead_dead_person
      ARRAY['dnc_refused']
      -- END policy lead_dead_person
      AS lead_dead_person,
      -- BEGIN policy lead_dead_disconnected
      ARRAY['wrong_or_disconnected', 'disconnected']
      -- END policy lead_dead_disconnected
      AS lead_dead_disconnected,
      -- BEGIN policy lead_dead_allow
      ARRAY['other', 'spam_vendor_duplicate', 'not_selling', 'spam', 'sold_or_competitor', 'listed_agent', 'outside_buy_box', 'no_legal_interest', 'low_offer_or_equity', 'went_with_someone_else', 'already_sold', 'internal_test', 'listed', 'fake_test_orphan_555_booking_probe', 'not_pursuing']
      -- END policy lead_dead_allow
      AS lead_dead_allow,
      -- BEGIN policy mojo_allow
      ARRAY['no_answer', 'other', 'voicemail_left', 'meaningful_conversation', 'callback_scheduled', 'appointment_set', 'busy']
      -- END policy mojo_allow
      AS mojo_allow,
      ARRAY['no_contact', 'no_answer', 'answering_machine', 'other', 'voicemail', 'contact', 'skipped', 'callback_requested', 'interested', 'incomplete', 'appointment_set', 'busy'] AS mojo_raw_allow,
      ARRAY['fax', 'dead'] AS mojo_raw_dead,
      ARRAY['bad_number', 'not_in_service', 'disconnected'] AS mojo_raw_disconnected
  ),
  keyed AS (
    SELECT public.dialer_label_key_v1(p_label) AS label
  )
  SELECT CASE p_source
    WHEN 'never_downgrade' THEN CASE
      WHEN label = ANY (policy.prospect_phone_dnc || policy.prospect_person_dnc || ARRAY['dead']) THEN 'protected'
      ELSE NULL
    END
    WHEN 'prospect_disposition' THEN CASE
      WHEN label IS NULL THEN NULL
      WHEN label = ANY (policy.prospect_phone_dnc) THEN 'prospect_dnc'
      WHEN label = ANY (policy.prospect_person_dnc) THEN 'person_dnc'
      WHEN label = ANY (policy.prospect_wrong) THEN 'wrong_number'
      WHEN label = ANY (policy.prospect_dead) THEN 'disconnected'
      WHEN label = ANY (policy.prospect_allow) THEN 'allow'
      ELSE 'unmapped'
    END
    WHEN 'phone_connected' THEN CASE
      WHEN label IS NULL THEN NULL
      WHEN label = ANY (policy.prospect_wrong) THEN 'wrong_number'
      WHEN label = ANY (policy.phone_connected_disconnected) THEN 'disconnected'
      WHEN label = ANY (policy.phone_connected_allow) THEN 'allow'
      ELSE 'unmapped'
    END
    WHEN 'lead_call_result' THEN CASE
      WHEN label IS NULL THEN NULL
      WHEN label = ANY (policy.prospect_person_dnc) THEN 'person_dnc'
      WHEN label = ANY (policy.prospect_phone_dnc) THEN 'lead_dnc'
      WHEN label = ANY (policy.lead_call_dead) THEN 'dead_number'
      WHEN label = ANY (policy.lead_call_allow) THEN 'allow'
      ELSE 'unmapped'
    END
    WHEN 'lead_dead_reason' THEN CASE
      WHEN label IS NULL THEN NULL
      WHEN label = ANY (policy.lead_dead_person) THEN 'person_dnc'
      WHEN label = ANY (policy.lead_dead_phone_dnc) THEN 'person_dnc'
      WHEN label = ANY (policy.lead_dead_disconnected) THEN 'disconnected'
      WHEN label = ANY (policy.lead_dead_allow) THEN 'allow'
      ELSE 'unmapped'
    END
    WHEN 'mojo_outcome' THEN CASE
      WHEN label IS NULL THEN NULL
      WHEN label = 'dnc' THEN 'mojo_dnc'
      WHEN label = 'disconnected' THEN 'disconnected'
      WHEN label = ANY (policy.mojo_allow) THEN 'allow'
      ELSE 'unmapped'
    END
    WHEN 'mojo_disposition_raw' THEN CASE
      WHEN label IS NULL THEN NULL
      WHEN label = ANY (policy.mojo_raw_dead || policy.mojo_raw_disconnected) THEN 'disconnected'
      WHEN label = ANY (policy.prospect_person_dnc) THEN 'person_dnc'
      WHEN label = ANY (policy.prospect_phone_dnc) THEN 'mojo_dnc'
      WHEN label = ANY (policy.prospect_wrong) THEN 'wrong_number'
      WHEN label = ANY (policy.mojo_raw_allow) THEN 'allow'
      ELSE 'unmapped'
    END
    WHEN 'property_owner_dnc' THEN CASE
      WHEN label IS NULL THEN NULL
      WHEN label = ANY (policy.prospect_phone_dnc || policy.prospect_person_dnc || ARRAY['dead', 'fax']) THEN 'property_owner_dnc'
      ELSE NULL
    END
    ELSE 'unmapped'
  END
  FROM policy, keyed;
$function$;


CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1(p_phone text, p_prospect_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_key text;
  v_class text;
  v_encode text;
  v_hold text;
  v_bucket text;
BEGIN
  IF public.normalize_conversation_phone(p_phone) IS NULL THEN
    RETURN 'invalid_phone';
  END IF;
  v_key := public.prospecting_phone_key_v1(p_phone);

  IF EXISTS (
    SELECT 1
    FROM public.sms_opt_outs AS opt_out
    WHERE opt_out.is_opted_out IS TRUE
      AND public.prospecting_phone_key_v1(opt_out.phone) = v_key
  ) THEN
    RETURN 'sms_opt_out';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.prospect_phones AS phone
    WHERE phone.voice_hold IS TRUE
      AND coalesce(public.dialer_label_key_v1(phone.voice_hold_reason), '') NOT LIKE '%mojo_dnc_contact_fanout%'
      AND public.prospecting_phone_key_v1(phone.phone) = v_key
  ) THEN
    RETURN 'voice_hold';
  END IF;

  SELECT matched.class
  INTO v_class
  FROM (
    SELECT public.dialer_suppression_class_v1('prospect_disposition', phone.last_disposition) AS class
    FROM public.prospect_phones AS phone
    WHERE public.prospecting_phone_key_v1(phone.phone) = v_key
  ) AS matched
  WHERE matched.class IS NOT NULL AND matched.class <> 'allow'
  ORDER BY CASE matched.class
    WHEN 'person_dnc' THEN 1
    WHEN 'prospect_dnc' THEN 1
    WHEN 'wrong_number' THEN 2
    WHEN 'disconnected' THEN 3
    WHEN 'unmapped' THEN 4
    ELSE 5
  END
  LIMIT 1;
  IF v_class IN ('person_dnc', 'prospect_dnc') THEN
    RETURN 'prospect_dnc';
  ELSIF v_class = 'wrong_number' THEN
    RETURN 'wrong_number';
  ELSIF v_class = 'disconnected' THEN
    RETURN 'disconnected';
  ELSIF v_class = 'unmapped' THEN
    RETURN 'unmapped_label';
  END IF;

  SELECT matched.class
  INTO v_class
  FROM (
    SELECT public.dialer_suppression_class_v1('phone_connected', phone.phone_connected) AS class
    FROM public.prospect_phones AS phone
    WHERE public.prospecting_phone_key_v1(phone.phone) = v_key
  ) AS matched
  WHERE matched.class IS NOT NULL AND matched.class <> 'allow'
  ORDER BY CASE matched.class
    WHEN 'wrong_number' THEN 1
    WHEN 'disconnected' THEN 2
    WHEN 'unmapped' THEN 3
    ELSE 4
  END
  LIMIT 1;
  IF v_class = 'wrong_number' THEN
    RETURN 'wrong_number';
  ELSIF v_class = 'disconnected' THEN
    RETURN 'disconnected';
  ELSIF v_class = 'unmapped' THEN
    RETURN 'unmapped_label';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.crm_contact_methods AS method
    WHERE method.method_type = 'phone'
      AND method.sms_consent_status = 'opted_out'
      AND public.prospecting_phone_key_v1(method.normalized_value) = v_key
  ) THEN
    RETURN 'contact_opt_out';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.crm_contact_methods AS method
    WHERE method.method_type = 'phone'
      AND method.deliverability_status = 'blocked'
      AND public.prospecting_phone_key_v1(method.normalized_value) = v_key
  ) THEN
    RETURN 'contact_blocked';
  END IF;

  SELECT matched.class
  INTO v_class
  FROM (
    SELECT public.dialer_suppression_class_v1('lead_call_result', lead.call_result) AS class
    FROM public.leads AS lead
    WHERE public.prospecting_phone_key_v1(lead.phone) = v_key
    UNION ALL
    SELECT public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason) AS class
    FROM public.leads AS lead
    WHERE public.prospecting_phone_key_v1(lead.phone) = v_key
  ) AS matched
  WHERE matched.class IS NOT NULL AND matched.class <> 'allow'
  ORDER BY CASE matched.class
    WHEN 'person_dnc' THEN 1
    WHEN 'lead_dnc' THEN 1
    WHEN 'dead_number' THEN 2
    WHEN 'disconnected' THEN 3
    WHEN 'unmapped' THEN 4
    ELSE 5
  END
  LIMIT 1;
  IF v_class IN ('person_dnc', 'lead_dnc') THEN
    RETURN 'lead_dnc';
  ELSIF v_class = 'dead_number' THEN
    RETURN 'dead_number';
  ELSIF v_class = 'disconnected' THEN
    RETURN 'disconnected';
  ELSIF v_class = 'unmapped' THEN
    RETURN 'unmapped_label';
  END IF;

  SELECT matched.class
  INTO v_class
  FROM (
    SELECT public.dialer_suppression_class_v1('mojo_disposition_raw', event.disposition_raw) AS class
    FROM public.crm_mojo_call_events AS event
    WHERE public.prospecting_phone_key_v1(event.normalized_phone) = v_key
      AND public.dialer_suppression_class_v1('mojo_disposition_raw', event.disposition_raw) NOT IN ('allow')
      AND public.dialer_suppression_class_v1('mojo_disposition_raw', event.disposition_raw) IS NOT NULL
    UNION ALL
    SELECT public.dialer_suppression_class_v1('mojo_outcome', event.outcome) AS class
    FROM public.crm_mojo_call_events AS event
    WHERE public.prospecting_phone_key_v1(event.normalized_phone) = v_key
  ) AS matched
  WHERE matched.class IS NOT NULL AND matched.class <> 'allow'
  ORDER BY CASE matched.class
    WHEN 'mojo_dnc' THEN 1
    WHEN 'person_dnc' THEN 1
    WHEN 'wrong_number' THEN 2
    WHEN 'disconnected' THEN 3
    WHEN 'unmapped' THEN 4
    ELSE 5
  END
  LIMIT 1;
  IF v_class IN ('mojo_dnc', 'person_dnc') THEN
    RETURN 'mojo_dnc';
  ELSIF v_class = 'wrong_number' THEN
    RETURN 'wrong_number';
  ELSIF v_class = 'disconnected' THEN
    RETURN 'disconnected';
  ELSIF v_class = 'unmapped' THEN
    RETURN 'unmapped_label';
  END IF;

  SELECT matched.bucket
  INTO v_bucket
  FROM (
    SELECT public.dialer_relationship_bucket_v1(phone.relationship, prospect.owner_1_type) AS bucket
    FROM public.prospect_phones AS phone
    JOIN public.prospects AS prospect ON prospect.id = phone.prospect_id
    WHERE public.prospecting_phone_key_v1(phone.phone) = v_key
  ) AS matched
  WHERE matched.bucket IN ('associate_non_family', 'relationship_unknown')
  ORDER BY CASE matched.bucket WHEN 'associate_non_family' THEN 1 ELSE 2 END
  LIMIT 1;
  IF v_bucket IS NOT NULL THEN
    RETURN v_bucket;
  END IF;

  IF public.dialer_property_owner_dnc_fanout_v1(v_key, p_prospect_id) THEN
    RETURN 'property_owner_dnc_fanout';
  END IF;

  v_hold := public.dialer_fanout_voice_hold_v1(v_key, p_prospect_id);
  IF v_hold IS NOT NULL THEN
    RETURN v_hold;
  END IF;
  IF public.dialer_related_person_dnc_v1(v_key, p_prospect_id) THEN
    RETURN 'person_fanout';
  END IF;

    IF EXISTS (
    SELECT 1
    FROM public.prospect_phones AS mine
    JOIN public.prospect_phones AS flagged
      ON flagged.prospect_id = mine.prospect_id
    WHERE public.prospecting_phone_key_v1(mine.phone) = v_key
      AND public.prospecting_phone_key_v1(flagged.phone) IS DISTINCT FROM v_key
      AND public.dialer_suppression_class_v1('prospect_disposition', flagged.last_disposition) = 'person_dnc'
  ) OR (
    p_prospect_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.prospect_phones AS flagged
      WHERE flagged.prospect_id = p_prospect_id
        AND public.prospecting_phone_key_v1(flagged.phone) IS DISTINCT FROM v_key
        AND public.dialer_suppression_class_v1('prospect_disposition', flagged.last_disposition) = 'person_dnc'
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.prospects AS mine
    JOIN public.leads AS lead ON lead.id = mine.lead_id
    WHERE (
      mine.id = p_prospect_id
      OR EXISTS (
        SELECT 1
        FROM public.prospect_phones AS mine_phone
        WHERE mine_phone.prospect_id = mine.id
          AND public.prospecting_phone_key_v1(mine_phone.phone) = v_key
      )
    )
    AND public.prospecting_phone_key_v1(lead.phone) IS DISTINCT FROM v_key
    AND (
      (public.dialer_label_key_v1(lead.dead_reason) = 'dnc_refused'
        OR (
          public.dialer_label_key_v1(lead.dead_reason) IN ('dnc', 'do_not_call')
          AND public.dialer_label_key_v1(lead.call_result) IS DISTINCT FROM 'dnc_number'
        ))
      OR public.dialer_suppression_class_v1('lead_call_result', lead.call_result) = 'person_dnc'
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.crm_mojo_call_events AS mine_event
    JOIN public.crm_mojo_call_events AS other_event
      ON other_event.provider_contact_id = mine_event.provider_contact_id
     AND nullif(btrim(mine_event.provider_contact_id), '') IS NOT NULL
    WHERE public.prospecting_phone_key_v1(mine_event.normalized_phone) = v_key
      AND public.prospecting_phone_key_v1(other_event.normalized_phone) IS DISTINCT FROM v_key
      AND (
        EXISTS (
          SELECT 1
          FROM public.prospect_phones AS flagged
          WHERE public.prospecting_phone_key_v1(flagged.phone) = public.prospecting_phone_key_v1(other_event.normalized_phone)
            AND public.dialer_suppression_class_v1('prospect_disposition', flagged.last_disposition) = 'person_dnc'
        )
        OR EXISTS (
          SELECT 1
          FROM public.leads AS lead
          WHERE public.prospecting_phone_key_v1(lead.phone) = public.prospecting_phone_key_v1(other_event.normalized_phone)
            AND (
              (public.dialer_label_key_v1(lead.dead_reason) = 'dnc_refused'
        OR (
          public.dialer_label_key_v1(lead.dead_reason) IN ('dnc', 'do_not_call')
          AND public.dialer_label_key_v1(lead.call_result) IS DISTINCT FROM 'dnc_number'
        ))
              OR public.dialer_suppression_class_v1('lead_call_result', lead.call_result) = 'person_dnc'
            )
        )
      )
  ) THEN
    RETURN 'person_fanout';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.prospects AS mine
    JOIN public.prospects AS anchor
      ON anchor.dialer_household_key
       = mine.dialer_household_key
    WHERE anchor.id IS DISTINCT FROM mine.id
      AND mine.dialer_household_key IS NOT NULL
      AND (
        mine.id = p_prospect_id
        OR EXISTS (
          SELECT 1
          FROM public.prospect_phones AS mine_phone
          WHERE mine_phone.prospect_id = mine.id
            AND public.prospecting_phone_key_v1(mine_phone.phone) = v_key
        )
      )
      AND (
        EXISTS (
          SELECT 1
          FROM public.prospect_phones AS flagged
          WHERE flagged.prospect_id = anchor.id
            AND public.dialer_suppression_class_v1('prospect_disposition', flagged.last_disposition) = 'person_dnc'
        )
        OR EXISTS (
          SELECT 1
          FROM public.leads AS lead
          WHERE lead.id = anchor.lead_id
            AND (
              (public.dialer_label_key_v1(lead.dead_reason) = 'dnc_refused'
        OR (
          public.dialer_label_key_v1(lead.dead_reason) IN ('dnc', 'do_not_call')
          AND public.dialer_label_key_v1(lead.call_result) IS DISTINCT FROM 'dnc_number'
        ))
              OR public.dialer_suppression_class_v1('lead_call_result', lead.call_result) = 'person_dnc'
            )
        )
      )
  ) THEN
    RETURN 'household_fanout';
  END IF;

  -- Hook only. The encode queue is not created here. A missing table is not a block.
  IF to_regclass('public.mojo_encode_queue') IS NOT NULL THEN
    BEGIN
      EXECUTE $encode$
        SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM public.mojo_encode_queue AS pending
            WHERE public.prospecting_phone_key_v1(pending.phone) = $1
              AND pending.encoded_at IS NULL
          ) THEN 'mojo_encode_pending'
          WHEN EXISTS (
            SELECT 1
            FROM public.mojo_encode_queue AS pending
            WHERE length(public.prospecting_phone_key_v1(pending.phone)) BETWEEN 4 AND 9
              AND right(public.prospecting_phone_key_v1(pending.phone), 4) = right($1, 4)
              AND pending.encoded_at IS NULL
          ) THEN 'hold_last4'
          ELSE NULL
        END
      $encode$
      INTO v_encode
      USING v_key;
      IF v_encode IS NOT NULL THEN
        RETURN v_encode;
      END IF;
    EXCEPTION
      WHEN undefined_column OR undefined_table THEN
        v_encode := NULL;
    END;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.prospect_phones AS phone
    WHERE length(public.prospecting_phone_key_v1(phone.phone)) BETWEEN 4 AND 9
      AND right(public.prospecting_phone_key_v1(phone.phone), 4) = right(v_key, 4)
      AND (
        coalesce(public.dialer_suppression_class_v1('prospect_disposition', phone.last_disposition), 'allow') <> 'allow'
        OR coalesce(public.dialer_suppression_class_v1('phone_connected', phone.phone_connected), 'allow') <> 'allow'
        OR phone.voice_hold IS TRUE
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.leads AS lead
    WHERE length(public.prospecting_phone_key_v1(lead.phone)) BETWEEN 4 AND 9
      AND right(public.prospecting_phone_key_v1(lead.phone), 4) = right(v_key, 4)
      AND (
        coalesce(public.dialer_suppression_class_v1('lead_call_result', lead.call_result), 'allow') <> 'allow'
        OR coalesce(public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason), 'allow') <> 'allow'
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.crm_mojo_call_events AS event
    WHERE length(public.prospecting_phone_key_v1(event.normalized_phone)) BETWEEN 4 AND 9
      AND right(public.prospecting_phone_key_v1(event.normalized_phone), 4) = right(v_key, 4)
      AND coalesce(public.dialer_suppression_class_v1('mojo_outcome', event.outcome), 'allow') <> 'allow'
  ) OR EXISTS (
    SELECT 1
    FROM public.sms_opt_outs AS opt_out
    WHERE opt_out.is_opted_out IS TRUE
      AND length(public.prospecting_phone_key_v1(opt_out.phone)) BETWEEN 4 AND 9
      AND right(public.prospecting_phone_key_v1(opt_out.phone), 4) = right(v_key, 4)
  ) OR EXISTS (
    SELECT 1
    FROM public.crm_mojo_calls AS call
    WHERE call.phone_last4 = right(v_key, 4)
      AND public.dialer_suppression_class_v1('mojo_disposition_raw', call.result_label) IN (
        'mojo_dnc', 'person_dnc', 'disconnected'
      )
  ) THEN
    RETURN 'hold_last4';
  END IF;

  RETURN NULL;
END;
$function$;


CREATE OR REPLACE FUNCTION public.apply_mojo_dial_phone_stamp_v1(
  p_phone text,
  p_disposition text,
  p_call_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  updated_count integer := 0;
  incoming_rank integer := public.dialer_stamp_rank_v1(p_disposition);
BEGIN
  IF p_phone IS NULL OR left(p_phone, 2) IS DISTINCT FROM '+1' OR substring(p_phone from 3) !~ '^[0-9]{10}$' THEN
    RETURN 0;
  END IF;
  IF p_call_at IS NULL THEN
    RAISE EXCEPTION 'invalid_mojo_call_time';
  END IF;
  IF p_disposition IS NOT NULL AND p_disposition NOT IN (
    'dnc', 'dnc_contact', 'dnc_number', 'take_me_off', 'fax', 'bad_number', 'not_in_service',
    'wrong_number', 'disconnected', 'no_answer', 'left_voicemail', 'busy'
  ) THEN
    RAISE EXCEPTION 'invalid_mojo_phone_disposition';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mojo-dial-phone:' || p_phone, 0));

  UPDATE public.prospect_phones AS phone
  SET
    attempted = true,
    last_attempt_at = CASE
      WHEN phone.last_attempt_at IS NULL OR phone.last_attempt_at < p_call_at THEN p_call_at
      ELSE phone.last_attempt_at
    END,
    last_attempt_by = CASE
      WHEN phone.last_attempt_at IS NULL OR phone.last_attempt_at < p_call_at THEN 'Mojo'
      ELSE phone.last_attempt_by
    END,
    last_disposition = CASE
      WHEN public.dialer_stamp_rank_v1(phone.last_disposition) > incoming_rank
        OR (public.dialer_stamp_rank_v1(phone.last_disposition) > 0 AND public.dialer_stamp_rank_v1(phone.last_disposition) = incoming_rank)
        THEN phone.last_disposition
      WHEN p_disposition IS NULL THEN phone.last_disposition
      ELSE p_disposition
    END,
    voice_hold = CASE
      WHEN p_disposition IN ('dnc', 'dnc_contact', 'dnc_number', 'take_me_off') THEN true
      ELSE phone.voice_hold
    END,
    voice_hold_reason = CASE
      WHEN p_disposition IN ('dnc', 'dnc_contact', 'dnc_number', 'take_me_off')
        AND nullif(btrim(coalesce(phone.voice_hold_reason, '')), '') IS NULL THEN 'mojo_dnc'
      ELSE phone.voice_hold_reason
    END,
    voice_hold_at = CASE
      WHEN p_disposition IN ('dnc', 'dnc_contact', 'dnc_number', 'take_me_off') AND phone.voice_hold_at IS NULL THEN p_call_at
      ELSE phone.voice_hold_at
    END,
    voice_hold_by = CASE
      WHEN p_disposition IN ('dnc', 'dnc_contact', 'dnc_number', 'take_me_off')
        AND nullif(btrim(coalesce(phone.voice_hold_by, '')), '') IS NULL THEN 'Mojo'
      ELSE phone.voice_hold_by
    END
  WHERE public.normalize_conversation_phone(phone.phone) = p_phone
    AND (
      phone.attempted IS DISTINCT FROM true
      OR phone.last_attempt_at IS NULL
      OR phone.last_attempt_at < p_call_at
      OR phone.last_disposition IS DISTINCT FROM CASE
        WHEN public.dialer_stamp_rank_v1(phone.last_disposition) > incoming_rank
          OR (public.dialer_stamp_rank_v1(phone.last_disposition) > 0 AND public.dialer_stamp_rank_v1(phone.last_disposition) = incoming_rank)
          THEN phone.last_disposition
        WHEN p_disposition IS NULL THEN phone.last_disposition
        ELSE p_disposition
      END
    );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;

COMMENT ON FUNCTION public.apply_mojo_dial_phone_stamp_v1(text, text, timestamptz) IS
  'Monotonic Mojo stamp. Plain dnc does not replace dnc_contact or take_me_off. no_answer, voicemail, and busy do not replace fax, bad_number, or not_in_service. voice_hold is only set true.';
CREATE OR REPLACE FUNCTION public.apply_mojo_dial_batch_v1(p_calls jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '20s'
AS $batch$
DECLARE
  item jsonb;
  fact jsonb;
  ledger jsonb;
  outcome_value text;
  disposition_value text;
  phone_value text;
  agent_value text;
  label_value text;
  contact_value text;
  call_at_value timestamptz;
  duration_value integer;
  inserted_id uuid;
  calls_applied integer := 0;
  events_inserted integer := 0;
  events_replayed integer := 0;
  phones_updated integer := 0;
  phone_hits integer := 0;
BEGIN
  IF jsonb_typeof(p_calls) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_mojo_dial_batch';
  END IF;
  IF jsonb_array_length(p_calls) > 100 THEN
    RAISE EXCEPTION 'mojo_dial_batch_too_large';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_calls)
  LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_mojo_call';
    END IF;

    outcome_value := nullif(btrim(coalesce(item->>'outcome', '')), '');
    IF outcome_value IS NULL OR outcome_value NOT IN (
      'callback_scheduled', 'meaningful_conversation', 'appointment_set',
      'not_interested', 'wrong_number', 'disconnected', 'no_answer',
      'voicemail_left', 'dnc', 'already_sold', 'listed', 'busy', 'other'
    ) THEN
      RAISE EXCEPTION 'invalid_mojo_outcome';
    END IF;

    disposition_value := nullif(btrim(coalesce(item->>'phone_disposition', '')), '');
    IF disposition_value IS NOT NULL AND disposition_value NOT IN (
      'dnc', 'dnc_contact', 'dnc_number', 'take_me_off', 'fax', 'bad_number', 'not_in_service',
      'wrong_number', 'disconnected', 'no_answer', 'left_voicemail', 'busy'
    ) THEN
      RAISE EXCEPTION 'invalid_mojo_phone_disposition';
    END IF;

    phone_value := nullif(btrim(coalesce(item->>'normalized_phone', '')), '');
    IF phone_value IS NOT NULL AND phone_value !~ '^\+1[0-9]{10}$' THEN
      RAISE EXCEPTION 'invalid_mojo_phone';
    END IF;

    agent_value := nullif(btrim(coalesce(item->>'agent_name', '')), '');
    IF agent_value IS NOT NULL AND (
      char_length(agent_value) > 160 OR agent_value ~ '[0-9]{7}'
    ) THEN
      RAISE EXCEPTION 'invalid_mojo_agent';
    END IF;

    label_value := nullif(btrim(coalesce(item->>'result_label', '')), '');
    IF label_value IS NULL THEN
      label_value := 'Unknown';
    END IF;
    IF char_length(label_value) > 250 THEN
      RAISE EXCEPTION 'invalid_mojo_disposition';
    END IF;

    IF coalesce(item->>'call_at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN
      RAISE EXCEPTION 'invalid_mojo_call_time';
    END IF;
    call_at_value := (item->>'call_at')::timestamptz;

    IF item->'duration_seconds' IS NULL OR jsonb_typeof(item->'duration_seconds') = 'null' THEN
      duration_value := 0;
    ELSIF jsonb_typeof(item->'duration_seconds') = 'number'
      AND (item->>'duration_seconds') ~ '^[0-9]+$'
      AND (item->>'duration_seconds')::integer BETWEEN 0 AND 86400 THEN
      duration_value := (item->>'duration_seconds')::integer;
    ELSE
      RAISE EXCEPTION 'invalid_mojo_call_duration';
    END IF;

    contact_value := nullif(btrim(coalesce(item->>'provider_contact_id', '')), '');
    fact := item - 'normalized_phone' - 'outcome' - 'phone_disposition' - 'agent_name';
    ledger := public.upsert_crm_mojo_call_v1(fact);
    IF ledger IS NULL OR ledger->>'recordId' IS NULL THEN
      RAISE EXCEPTION 'invalid_mojo_call_upsert_result';
    END IF;
    calls_applied := calls_applied + 1;

    phone_hits := public.apply_mojo_dial_phone_stamp_v1(phone_value, disposition_value, call_at_value);
    phones_updated := phones_updated + phone_hits;

    inserted_id := NULL;
    INSERT INTO public.crm_mojo_call_events (
      record_id,
      call_at,
      normalized_phone,
      provider_contact_id,
      duration_seconds,
      disposition_raw,
      outcome,
      agent_name,
      agent_key,
      contact_name,
      unresolved_reason,
      promotion_eligible,
      qualification_status
    ) VALUES (
      ledger->>'recordId',
      call_at_value,
      phone_value,
      contact_value,
      duration_value,
      label_value,
      outcome_value,
      agent_value,
      'mojo',
      CASE
        WHEN coalesce(item->>'contact_initials', '') ~ '^[A-Z](\.[A-Z]){0,3}\.$' THEN item->>'contact_initials'
        ELSE NULL
      END,
      CASE
        WHEN phone_value IS NULL THEN 'invalid_phone'
        WHEN phone_hits = 0 THEN 'unknown_contact'
        ELSE NULL
      END,
      false,
      'not_applicable'
    )
    ON CONFLICT (record_id) DO NOTHING
    RETURNING id INTO inserted_id;

    IF inserted_id IS NULL THEN
      events_replayed := events_replayed + 1;
    ELSE
      events_inserted := events_inserted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'calls', calls_applied,
    'eventsInserted', events_inserted,
    'eventsReplayed', events_replayed,
    'phonesUpdated', phones_updated
  );
END
$batch$;

CREATE OR REPLACE FUNCTION public.dialer_label_coverage_gaps_v1()
RETURNS TABLE (source text, label text)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT DISTINCT labeled.source, labeled.label
  FROM (
    SELECT 'prospect_disposition'::text AS source, public.dialer_label_key_v1(last_disposition) AS label
    FROM public.prospect_phones
    UNION ALL
    SELECT 'phone_connected'::text, public.dialer_label_key_v1(phone_connected) FROM public.prospect_phones
    UNION ALL
    SELECT 'lead_call_result'::text, public.dialer_label_key_v1(call_result) FROM public.leads
    UNION ALL
    SELECT 'lead_dead_reason'::text, public.dialer_label_key_v1(dead_reason) FROM public.leads
    UNION ALL
    SELECT 'mojo_outcome'::text, public.dialer_label_key_v1(outcome) FROM public.crm_mojo_call_events
    UNION ALL
    SELECT 'mojo_disposition_raw'::text, public.dialer_label_key_v1(disposition_raw) FROM public.crm_mojo_call_events
    UNION ALL
    SELECT 'mojo_disposition_raw'::text, public.dialer_label_key_v1(result_label) FROM public.crm_mojo_calls
  ) AS labeled
  WHERE labeled.label IS NOT NULL
    AND public.dialer_suppression_class_v1(labeled.source, labeled.label) = 'unmapped';
$function$;
CREATE OR REPLACE FUNCTION public.record_source_list_export_batch_v1(
  p_actor text,
  p_list_type text DEFAULT NULL,
  p_county text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_violation_kind text DEFAULT NULL,
  p_source_list_id uuid DEFAULT NULL,
  p_line_mode integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_list_type text := nullif(btrim(coalesce(p_list_type, '')), '');
  v_county text := nullif(lower(btrim(coalesce(p_county, ''))), '');
  v_state text := nullif(upper(btrim(coalesce(p_state, ''))), '');
  v_kind text := nullif(lower(btrim(coalesce(p_violation_kind, ''))), '');
  v_rows jsonb;
  v_count integer;
  v_batch_id uuid;
  v_gaps text;
  v_excluded_counts jsonb;
  v_excluded_phones jsonb;
BEGIN
  IF v_actor IS NULL OR char_length(v_actor) > 320 THEN
    RAISE EXCEPTION 'source_list_identity_invalid';
  END IF;
  IF v_list_type IS NOT NULL AND v_list_type NOT IN (
    'tax_delinquent', 'probate_estate', 'probate_no_property', 'foreclosure', 'code_violation'
  ) THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
  IF v_county IS NOT NULL AND v_county NOT IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte') THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
  IF v_state IS NOT NULL AND v_state NOT IN ('MO', 'KS') THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
  IF v_kind IS NOT NULL AND v_kind NOT IN ('dangerous_building', 'board_up', 'structural') THEN
    RAISE EXCEPTION 'source_list_lane_invalid';
  END IF;
  IF coalesce(p_line_mode, 1) < 1
    OR (public.dialer_multi_line_suspended_v1() AND coalesce(p_line_mode, 1) > 1) THEN
    RAISE EXCEPTION 'multi_line_suspended';
  END IF;

  SELECT coalesce(string_agg(gap.source || '=' || gap.label, ', ' ORDER BY gap.source, gap.label), '')
  INTO v_gaps
  FROM public.dialer_label_coverage_gaps_v1() AS gap;
  IF v_gaps <> '' THEN
    RAISE EXCEPTION 'dialer_label_unmapped: %', v_gaps;
  END IF;

  WITH reviewed AS MATERIALIZED (
    SELECT *
    FROM public.source_list_dialer_phone_review AS review
    WHERE (v_list_type IS NULL OR review.list_type = v_list_type)
      AND (v_county IS NULL OR review.county = v_county)
      AND (v_state IS NULL OR review.state = v_state)
      AND (v_kind IS NULL OR review.violation_kind = v_kind)
      AND (p_source_list_id IS NULL OR review.source_list_id = p_source_list_id)
  )
  SELECT
    coalesce((SELECT jsonb_agg(to_jsonb(export_row) ORDER BY export_row.list_type, export_row.county, export_row.parcel_id, export_row.phone_e164) FROM reviewed AS export_row WHERE export_row.block_reason IS NULL AND export_row.phone_e164 IS NOT NULL), '[]'::jsonb),
    coalesce((SELECT jsonb_object_agg(counted.reason, counted.n) FROM (SELECT blocked.block_reason AS reason, count(*) AS n FROM reviewed AS blocked WHERE blocked.block_reason IS NOT NULL GROUP BY blocked.block_reason) AS counted), '{}'::jsonb),
    coalesce((SELECT jsonb_agg(jsonb_build_object('reason', samples.reason, 'phone_masked', samples.phone_masked) ORDER BY samples.reason, samples.phone_masked) FROM (SELECT blocked.block_reason AS reason, public.dialer_phone_mask_v1(coalesce(blocked.phone_e164, blocked.phone_value)) AS phone_masked, row_number() OVER (PARTITION BY blocked.block_reason ORDER BY public.dialer_phone_mask_v1(coalesce(blocked.phone_e164, blocked.phone_value))) AS sample_index FROM reviewed AS blocked WHERE blocked.block_reason IS NOT NULL) AS samples WHERE samples.sample_index <= 20), '[]'::jsonb)
  INTO v_rows, v_excluded_counts, v_excluded_phones;

  v_count := jsonb_array_length(v_rows);
  IF v_count > 10000 THEN
    RAISE EXCEPTION 'source_list_export_too_large';
  END IF;

  INSERT INTO public.source_list_export_batches (
    created_by, list_type, county, state, violation_kind, source_list_id, phone_count
  ) VALUES (
    v_actor, v_list_type, v_county, v_state, v_kind, p_source_list_id, v_count
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO public.source_list_export_batch_phones (export_batch_id, source_list_row_id, phone_e164)
  SELECT v_batch_id, (item->>'source_list_row_id')::uuid, item->>'phone_e164'
  FROM jsonb_array_elements(v_rows) AS item;

  RETURN jsonb_build_object(
    'export_batch_id', v_batch_id,
    'phone_count', v_count,
    'rows', v_rows,
    'excluded_counts', v_excluded_counts,
    'excluded_phones', v_excluded_phones
  );
END;
$function$;


REVOKE ALL ON FUNCTION public.record_source_list_export_batch_v1(text, text, text, text, text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_source_list_export_batch_v1(text, text, text, text, text, uuid, integer)
  TO service_role;

