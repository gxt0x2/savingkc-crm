-- Widen the dialer export scrub.
-- One label classifier feeds source_list_phone_block_reason_v1 and the Mojo
-- stamp's never-downgrade set. Views source_list_dialer_phone_review, _export,
-- and _suppressed inherit the function. This does not read or write
-- mojo_call_queue, and it does not delete rows.

CREATE OR REPLACE FUNCTION public.dialer_label_key_v1(p_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT nullif(
    regexp_replace(lower(btrim(coalesce(p_label, ''))), '[[:space:]-]+', '_', 'g'),
    ''
  );
$function$;

CREATE OR REPLACE FUNCTION public.dialer_household_key_v1(
  p_county text,
  p_street text,
  p_owner_last text,
  p_owner_name text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  WITH parts AS (
    SELECT
      lower(btrim(coalesce(p_county, ''))) AS county,
      btrim(regexp_replace(regexp_replace(lower(btrim(coalesce(p_street, ''))), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')) AS street,
      coalesce(
        nullif(lower(btrim(coalesce(p_owner_last, ''))), ''),
        CASE
          WHEN position(',' IN lower(btrim(coalesce(p_owner_name, '')))) > 0
            THEN nullif(btrim(split_part(lower(btrim(p_owner_name)), ',', 1)), '')
          ELSE nullif(regexp_replace(lower(btrim(coalesce(p_owner_name, ''))), '^.* ', ''), '')
        END
      ) AS owner_last
  )
  SELECT CASE
    WHEN county = '' OR street = '' OR owner_last IS NULL OR owner_last = '' THEN NULL
    ELSE county || '|' || street || '|' || owner_last
  END
  FROM parts;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_phone_mask_v1(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT CASE
    WHEN length(digits) >= 4 THEN repeat('*', 6) || right(digits, 4)
    ELSE '****'
  END
  FROM (
    SELECT regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') AS digits
  ) AS parsed;
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
    ELSE 'unmapped'
  END
  FROM policy, keyed;
$function$;

COMMENT ON FUNCTION public.dialer_suppression_class_v1(text, text) IS
  'Shared export label policy. never_downgrade protects dnc, do_not_call, dnc_number, dnc_contact, take_me_off, and dead. dataskip_dnc is allow. Any other non-blank label is unmapped and fails closed.';

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
    SELECT 'phone_connected'::text, public.dialer_label_key_v1(phone_connected)
    FROM public.prospect_phones
    UNION ALL
    SELECT 'lead_call_result'::text, public.dialer_label_key_v1(call_result)
    FROM public.leads
    UNION ALL
    SELECT 'lead_dead_reason'::text, public.dialer_label_key_v1(dead_reason)
    FROM public.leads
    UNION ALL
    SELECT 'mojo_outcome'::text, public.dialer_label_key_v1(outcome)
    FROM public.crm_mojo_call_events
  ) AS labeled
  WHERE labeled.label IS NOT NULL
    AND public.dialer_suppression_class_v1(labeled.source, labeled.label) = 'unmapped';
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

CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1(p_phone text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT public.source_list_phone_block_reason_v1(p_phone, NULL::uuid);
$function$;

COMMENT ON FUNCTION public.source_list_phone_block_reason_v1(text, uuid) IS
  'Fail-closed dialer export scrub. Matches last-10 digits. Person labels fan out across the prospect, the lead, and the Mojo contact. Household fan-out uses county, normalized street, and owner last name, and does not match a missing key. A last-4-only match is hold_last4.';

REVOKE ALL ON FUNCTION public.dialer_label_key_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_household_key_v1(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_phone_mask_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_suppression_class_v1(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dialer_label_coverage_gaps_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.source_list_phone_block_reason_v1(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.source_list_phone_block_reason_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_label_key_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_household_key_v1(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_phone_mask_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_suppression_class_v1(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dialer_label_coverage_gaps_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.source_list_phone_block_reason_v1(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.source_list_phone_block_reason_v1(text) TO service_role;

CREATE INDEX IF NOT EXISTS idx_prospect_phones_dialer_phone_key
  ON public.prospect_phones (public.prospecting_phone_key_v1(phone));
CREATE INDEX IF NOT EXISTS idx_crm_mojo_call_events_dialer_phone_key
  ON public.crm_mojo_call_events (public.prospecting_phone_key_v1(normalized_phone));
CREATE INDEX IF NOT EXISTS idx_crm_mojo_call_events_provider_contact
  ON public.crm_mojo_call_events (provider_contact_id)
  WHERE provider_contact_id IS NOT NULL;

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
  public.source_list_phone_block_reason_v1(dialed.phone_value, dialed.prospect_id) AS block_reason
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
) AS dialed;

COMMENT ON VIEW public.source_list_dialer_phone_review IS
  'Review rows include suppressed numbers and block_reason. Do not load the dialer from this view.';
COMMENT ON VIEW public.source_list_dialer_export IS
  'Dialer load file. Drops every phone source_list_phone_block_reason_v1 blocks, including person and household fan-out, at read time.';
COMMENT ON VIEW public.source_list_dialer_suppressed IS
  'Phones removed from the dialer export, with block_reason. Reasons include prospect_dnc, lead_dnc, disconnected, mojo_dnc, person_fanout, household_fanout, and hold_last4.';

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
BEGIN
  IF p_phone IS NULL OR p_phone !~ '^\+1[0-9]{10}$' THEN
    RETURN 0;
  END IF;
  IF p_call_at IS NULL THEN
    RAISE EXCEPTION 'invalid_mojo_call_time';
  END IF;
  IF p_disposition IS NOT NULL AND p_disposition NOT IN (
    'dnc', 'wrong_number', 'disconnected', 'no_answer', 'left_voicemail', 'busy'
  ) THEN
    RAISE EXCEPTION 'invalid_mojo_phone_disposition';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mojo-dial-phone:' || p_phone, 0)
  );

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
      WHEN p_disposition = 'dnc' THEN 'dnc'
      WHEN p_disposition = 'wrong_number'
        AND phone.voice_hold IS NOT TRUE
        AND public.dialer_suppression_class_v1('never_downgrade', phone.last_disposition) IS DISTINCT FROM 'protected'
        THEN 'wrong_number'
      WHEN p_disposition = 'disconnected'
        AND phone.voice_hold IS NOT TRUE
        AND public.dialer_suppression_class_v1('never_downgrade', phone.last_disposition) IS DISTINCT FROM 'protected'
        AND public.dialer_label_key_v1(phone.last_disposition) IS DISTINCT FROM 'wrong_number'
        THEN 'disconnected'
      WHEN p_disposition IN ('no_answer', 'left_voicemail', 'busy')
        AND phone.voice_hold IS NOT TRUE
        AND public.dialer_suppression_class_v1('never_downgrade', phone.last_disposition) IS DISTINCT FROM 'protected'
        AND public.dialer_label_key_v1(phone.last_disposition) IS DISTINCT FROM 'wrong_number'
        AND public.dialer_label_key_v1(phone.last_disposition) IS DISTINCT FROM 'disconnected'
        AND coalesce(public.dialer_label_key_v1(phone.last_disposition), '') NOT IN (
          'spoke_with_owner', 'callback_requested', 'appointment_set',
          'deal_potential', 'offer_made', 'not_interested'
        )
        AND (phone.last_attempt_at IS NULL OR phone.last_attempt_at <= p_call_at)
        THEN p_disposition
      ELSE phone.last_disposition
    END,
    voice_hold = CASE WHEN p_disposition = 'dnc' THEN true ELSE phone.voice_hold END,
    voice_hold_reason = CASE
      WHEN p_disposition = 'dnc' AND nullif(btrim(coalesce(phone.voice_hold_reason, '')), '') IS NULL THEN 'mojo_dnc'
      ELSE phone.voice_hold_reason
    END,
    voice_hold_at = CASE
      WHEN p_disposition = 'dnc' AND phone.voice_hold_at IS NULL THEN p_call_at
      ELSE phone.voice_hold_at
    END,
    voice_hold_by = CASE
      WHEN p_disposition = 'dnc' AND nullif(btrim(coalesce(phone.voice_hold_by, '')), '') IS NULL THEN 'Mojo'
      ELSE phone.voice_hold_by
    END
  WHERE public.normalize_conversation_phone(phone.phone) = p_phone
    AND (
      phone.attempted IS DISTINCT FROM true
      OR (phone.last_attempt_at IS NULL OR phone.last_attempt_at < p_call_at)
      OR (
        p_disposition = 'dnc'
        AND (phone.voice_hold IS DISTINCT FROM true OR phone.last_disposition IS DISTINCT FROM 'dnc')
      )
      OR (
        p_disposition = 'wrong_number'
        AND phone.voice_hold IS NOT TRUE
        AND public.dialer_suppression_class_v1('never_downgrade', phone.last_disposition) IS DISTINCT FROM 'protected'
        AND public.dialer_label_key_v1(phone.last_disposition) IS DISTINCT FROM 'wrong_number'
      )
      OR (
        p_disposition = 'disconnected'
        AND phone.voice_hold IS NOT TRUE
        AND public.dialer_suppression_class_v1('never_downgrade', phone.last_disposition) IS DISTINCT FROM 'protected'
        AND public.dialer_label_key_v1(phone.last_disposition) IS DISTINCT FROM 'wrong_number'
        AND public.dialer_label_key_v1(phone.last_disposition) IS DISTINCT FROM 'disconnected'
      )
    );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;

COMMENT ON FUNCTION public.apply_mojo_dial_phone_stamp_v1(text, text, timestamptz) IS
  'Adds a Mojo dial stamp. Never-downgrade labels come from dialer_suppression_class_v1. voice_hold and attempted are only set true. Does not read or write mojo_call_queue.';

CREATE OR REPLACE FUNCTION public.record_source_list_export_batch_v1(
  p_actor text,
  p_list_type text DEFAULT NULL,
  p_county text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_violation_kind text DEFAULT NULL,
  p_source_list_id uuid DEFAULT NULL
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

COMMENT ON FUNCTION public.record_source_list_export_batch_v1(text, text, text, text, text, uuid) IS
  'Snapshots source_list_dialer_export. excluded_counts and excluded_phones report the scrub. Phones in excluded_phones are masked to the last 4 digits.';
