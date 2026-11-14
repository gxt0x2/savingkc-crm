-- Associate-type filter and property-level owner DNC fan-out.
-- Replaces the export blocker. Does not clear voice_hold, does not downgrade a
-- DNC stamp, and does not read or write mojo_call_queue.


CREATE OR REPLACE FUNCTION public.dialer_relationship_bucket_v1(p_relationship text, p_owner_type text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  rel text := public.dialer_label_key_v1(p_relationship);
  owner_type text := public.dialer_label_key_v1(p_owner_type);
BEGIN
  IF rel = 'associate'
    OR owner_type = ANY (ARRAY['neighbor', 'coworker', 'past_neighbor', 'friend', 'landlord', 'tenant']) THEN
    RETURN 'associate_non_family';
  END IF;
  IF rel = ANY (ARRAY['owner', 'subject', 'co_owner']) THEN
    RETURN 'owner';
  END IF;
  IF rel = ANY (ARRAY['unknown', 'entity_contact']) THEN
    RETURN 'relationship_unknown';
  END IF;
  IF rel = ANY (ARRAY['relative', 'spouse', 'parent', 'child', 'sibling', 'in_law', 'other_relative'])
    OR owner_type = ANY (ARRAY['in_law', 'child', 'parent', 'sibling', 'spouse', 'other_relative', 'unknown', 'individual']) THEN
    RETURN 'relative';
  END IF;
  RETURN 'relationship_unknown';
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_property_key_v1(
  p_parcel text,
  p_county text,
  p_street text,
  p_zip text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  parcel text := nullif(upper(regexp_replace(coalesce(p_parcel, ''), '[[:space:]]+', '', 'g')), '');
  county text := nullif(lower(btrim(coalesce(p_county, ''))), '');
  street text := nullif(btrim(regexp_replace(regexp_replace(lower(btrim(coalesce(p_street, ''))), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')), '');
  zip_digits text := regexp_replace(coalesce(p_zip, ''), '[^0-9]', '', 'g');
BEGIN
  IF parcel IS NOT NULL THEN
    RETURN 'parcel:' || parcel;
  END IF;
  IF county IS NULL OR street IS NULL THEN
    RETURN NULL;
  END IF;
  IF length(zip_digits) >= 5 THEN
    RETURN 'addr:' || county || '|' || street || '|' || left(zip_digits, 5);
  END IF;
  IF zip_digits = '' THEN
    RETURN 'addr:' || county || '|' || street;
  END IF;
  RETURN 'addr:' || county || '|' || street || '|' || zip_digits;
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
    WHEN undefined_column OR undefined_table THEN
      RAISE EXCEPTION 'mojo_encode_pending_unreadable'
        USING HINT = 'public.mojo_encode_queue must expose phone and encoded_at';
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_property_owner_dnc_fanout_v1(p_key text, p_prospect_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.prospect_phones AS owner_phone
    JOIN public.prospects AS owner_prospect ON owner_prospect.id = owner_phone.prospect_id
    WHERE public.dialer_relationship_bucket_v1(owner_phone.relationship, owner_prospect.owner_1_type) = 'owner'
      AND length(public.prospecting_phone_key_v1(owner_phone.phone)) = 10
      AND public.dialer_property_key_v1(
        owner_prospect.parcel_id,
        owner_prospect.county,
        coalesce(owner_prospect.situs_street, owner_prospect.situs_address),
        owner_prospect.situs_zip
      ) IN (
        SELECT public.dialer_property_key_v1(
          candidate.parcel_id,
          candidate.county,
          coalesce(candidate.situs_street, candidate.situs_address),
          candidate.situs_zip
        )
        FROM public.prospects AS candidate
        WHERE (
          candidate.id = p_prospect_id
          OR EXISTS (
            SELECT 1
            FROM public.prospect_phones AS mine
            WHERE mine.prospect_id = candidate.id
              AND public.prospecting_phone_key_v1(mine.phone) = p_key
          )
        )
      )
      AND public.dialer_property_key_v1(
        owner_prospect.parcel_id,
        owner_prospect.county,
        coalesce(owner_prospect.situs_street, owner_prospect.situs_address),
        owner_prospect.situs_zip
      ) IS NOT NULL
      AND (
        EXISTS (
          SELECT 1
          FROM public.prospect_phones AS any_phone
          WHERE public.prospecting_phone_key_v1(any_phone.phone) = public.prospecting_phone_key_v1(owner_phone.phone)
            AND public.dialer_suppression_class_v1('property_owner_dnc', any_phone.last_disposition) = 'property_owner_dnc'
        )
        OR EXISTS (
          SELECT 1
          FROM public.sms_opt_outs AS opt_out
          WHERE opt_out.is_opted_out IS TRUE
            AND public.prospecting_phone_key_v1(opt_out.phone) = public.prospecting_phone_key_v1(owner_phone.phone)
        )
        OR EXISTS (
          SELECT 1
          FROM public.crm_mojo_call_events AS event
          WHERE public.prospecting_phone_key_v1(event.normalized_phone) = public.prospecting_phone_key_v1(owner_phone.phone)
            AND public.dialer_label_key_v1(event.outcome) = 'dnc'
        )
        OR public.dialer_encode_queue_has_phone_v1(public.prospecting_phone_key_v1(owner_phone.phone))
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.dialer_multi_line_suspended_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT coalesce(
    (
      SELECT CASE
        WHEN value = 'false'::jsonb THEN false
        WHEN jsonb_typeof(value) = 'object' AND coalesce(value->>'suspended', '') = 'false' THEN false
        ELSE true
      END
      FROM public.system_config
      WHERE key = 'dialer_multi_line_suspended'
    ),
    true
  );
$function$;

INSERT INTO public.system_config(key, value, updated_at)
VALUES ('dialer_multi_line_suspended', 'true'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

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
      AS mojo_allow
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
      WHEN label = ANY (policy.lead_dead_phone_dnc) THEN 'lead_dnc'
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
    SELECT public.dialer_suppression_class_v1('mojo_outcome', event.outcome) AS class
    FROM public.crm_mojo_call_events AS event
    WHERE public.prospecting_phone_key_v1(event.normalized_phone) = v_key
  ) AS matched
  WHERE matched.class IS NOT NULL AND matched.class <> 'allow'
  ORDER BY CASE matched.class
    WHEN 'mojo_dnc' THEN 1
    WHEN 'disconnected' THEN 2
    WHEN 'unmapped' THEN 3
    ELSE 4
  END
  LIMIT 1;
  IF v_class = 'mojo_dnc' THEN
    RETURN 'mojo_dnc';
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
      public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason) = 'person_dnc'
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
              public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason) = 'person_dnc'
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
      ON public.dialer_household_key_v1(anchor.county, coalesce(anchor.situs_street, anchor.situs_address), anchor.owner_1_last, anchor.owner_1)
       = public.dialer_household_key_v1(mine.county, coalesce(mine.situs_street, mine.situs_address), mine.owner_1_last, mine.owner_1)
    WHERE anchor.id IS DISTINCT FROM mine.id
      AND public.dialer_household_key_v1(mine.county, coalesce(mine.situs_street, mine.situs_address), mine.owner_1_last, mine.owner_1) IS NOT NULL
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
              public.dialer_suppression_class_v1('lead_dead_reason', lead.dead_reason) = 'person_dnc'
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
        RAISE EXCEPTION 'mojo_encode_pending_unreadable'
          USING HINT = 'public.mojo_encode_queue must expose phone and encoded_at';
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
  ) THEN
    RETURN 'hold_last4';
  END IF;

  RETURN NULL;
END;
$function$;


REVOKE ALL ON FUNCTION public.dialer_relationship_bucket_v1(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_property_key_v1(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_encode_queue_has_phone_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_property_owner_dnc_fanout_v1(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_multi_line_suspended_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_relationship_bucket_v1(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_property_key_v1(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_encode_queue_has_phone_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_property_owner_dnc_fanout_v1(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_multi_line_suspended_v1() TO service_role;

DROP FUNCTION IF EXISTS public.record_source_list_export_batch_v1(text, text, text, text, text, uuid);

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

  SELECT coalesce(jsonb_agg(to_jsonb(export_row) ORDER BY export_row.list_type, export_row.county, export_row.parcel_id, export_row.phone_e164), '[]'::jsonb)
  INTO v_rows
  FROM public.source_list_dialer_export AS export_row
  WHERE (v_list_type IS NULL OR export_row.list_type = v_list_type)
    AND (v_county IS NULL OR export_row.county = v_county)
    AND (v_state IS NULL OR export_row.state = v_state)
    AND (v_kind IS NULL OR export_row.violation_kind = v_kind)
    AND (p_source_list_id IS NULL OR export_row.source_list_id = p_source_list_id)
    AND export_row.phone_e164 IS NOT NULL;

  v_count := jsonb_array_length(v_rows);
  IF v_count > 10000 THEN
    RAISE EXCEPTION 'source_list_export_too_large';
  END IF;

  SELECT coalesce(jsonb_object_agg(counted.reason, counted.n), '{}'::jsonb)
  INTO v_excluded_counts
  FROM (
    SELECT suppressed.block_reason AS reason, count(*) AS n
    FROM public.source_list_dialer_suppressed AS suppressed
    WHERE (v_list_type IS NULL OR suppressed.list_type = v_list_type)
      AND (v_county IS NULL OR suppressed.county = v_county)
      AND (v_state IS NULL OR suppressed.state = v_state)
      AND (v_kind IS NULL OR suppressed.violation_kind = v_kind)
      AND (p_source_list_id IS NULL OR suppressed.source_list_id = p_source_list_id)
    GROUP BY suppressed.block_reason
  ) AS counted;

  SELECT coalesce(jsonb_agg(jsonb_build_object('reason', samples.reason, 'phone_masked', samples.phone_masked) ORDER BY samples.reason, samples.phone_masked), '[]'::jsonb)
  INTO v_excluded_phones
  FROM (
    SELECT
      suppressed.block_reason AS reason,
      public.dialer_phone_mask_v1(coalesce(suppressed.phone_e164, suppressed.phone_value)) AS phone_masked,
      row_number() OVER (
        PARTITION BY suppressed.block_reason
        ORDER BY public.dialer_phone_mask_v1(coalesce(suppressed.phone_e164, suppressed.phone_value))
      ) AS sample_index
    FROM public.source_list_dialer_suppressed AS suppressed
    WHERE (v_list_type IS NULL OR suppressed.list_type = v_list_type)
      AND (v_county IS NULL OR suppressed.county = v_county)
      AND (v_state IS NULL OR suppressed.state = v_state)
      AND (v_kind IS NULL OR suppressed.violation_kind = v_kind)
      AND (p_source_list_id IS NULL OR suppressed.source_list_id = p_source_list_id)
  ) AS samples
  WHERE samples.sample_index <= 20;

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

COMMENT ON FUNCTION public.dialer_relationship_bucket_v1(text, text) IS
  'Counsel EXC-2026-11-14-002. owner, relative, associate_non_family, or relationship_unknown. Unknown fails closed.';
COMMENT ON FUNCTION public.dialer_property_key_v1(text, text, text, text) IS
  'parcel_id when present; otherwise county, normalized street, and zip5. A blank zip keeps county and street.';
COMMENT ON FUNCTION public.source_list_phone_block_reason_v1(text, uuid) IS
  'Fail-closed export scrub. After direct DNC checks: associate_non_family, relationship_unknown, property_owner_dnc_fanout, then person and household fan-out. Does not clear voice_hold.';
COMMENT ON FUNCTION public.record_source_list_export_batch_v1(text, text, text, text, text, uuid, integer) IS
  'Snapshots the scrubbed export. Refuses line mode above 1 while dialer_multi_line_suspended is true. Excluded phones are masked to the last 4.';
