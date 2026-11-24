-- Scrub wrong-number and disconnected prospect phones, and record which
-- export batch a dialer load came from. Additive: new columns, new tables,
-- and replacement function bodies. Existing source-list rows are unchanged.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS public.source_list_export_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  list_type text,
  county text,
  state text,
  violation_kind text,
  source_list_id uuid,
  phone_count integer NOT NULL,
  CONSTRAINT source_list_export_batches_actor_check CHECK (char_length(created_by) BETWEEN 1 AND 320),
  CONSTRAINT source_list_export_batches_phone_count_check CHECK (phone_count >= 0 AND phone_count <= 10000),
  CONSTRAINT source_list_export_batches_list_type_check CHECK (
    list_type IS NULL OR list_type IN (
      'tax_delinquent', 'probate_estate', 'probate_no_property', 'foreclosure', 'code_violation'
    )
  ),
  CONSTRAINT source_list_export_batches_county_check CHECK (
    county IS NULL OR county IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte')
  ),
  CONSTRAINT source_list_export_batches_state_check CHECK (state IS NULL OR state IN ('MO', 'KS')),
  CONSTRAINT source_list_export_batches_violation_kind_check CHECK (
    violation_kind IS NULL OR violation_kind IN ('dangerous_building', 'board_up', 'structural')
  )
);

COMMENT ON TABLE public.source_list_export_batches IS
  'One scrubbed dialer export. loaded_export_batch_id on a source list row points here so a load can be tied to the scrub that produced it.';

CREATE TABLE IF NOT EXISTS public.source_list_export_batch_phones (
  export_batch_id uuid NOT NULL REFERENCES public.source_list_export_batches(id) ON DELETE RESTRICT,
  source_list_row_id uuid NOT NULL REFERENCES public.source_list_rows(id) ON DELETE RESTRICT,
  phone_e164 text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (export_batch_id, source_list_row_id, phone_e164),
  CONSTRAINT source_list_export_batch_phones_e164_check CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE INDEX IF NOT EXISTS idx_source_list_export_batch_phones_row
  ON public.source_list_export_batch_phones (source_list_row_id, export_batch_id);

COMMENT ON TABLE public.source_list_export_batch_phones IS
  'Phones that were clear at the moment this export batch was scrubbed.';

ALTER TABLE public.source_list_rows
  ADD COLUMN IF NOT EXISTS loaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS loaded_export_batch_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.source_list_rows'::regclass
      AND conname = 'source_list_rows_loaded_batch_fk'
  ) THEN
    ALTER TABLE public.source_list_rows
      ADD CONSTRAINT source_list_rows_loaded_batch_fk
      FOREIGN KEY (loaded_export_batch_id)
      REFERENCES public.source_list_export_batches(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN public.source_list_rows.loaded_at IS
  'When this row was marked loaded_to_dialer. Kept if the status later changes.';
COMMENT ON COLUMN public.source_list_rows.loaded_export_batch_id IS
  'The scrubbed export batch that was loaded. Required when status becomes loaded_to_dialer.';

ALTER TABLE public.source_list_row_status_history
  ADD COLUMN IF NOT EXISTS export_batch_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.source_list_row_status_history'::regclass
      AND conname = 'source_list_row_status_history_batch_fk'
  ) THEN
    ALTER TABLE public.source_list_row_status_history
      ADD CONSTRAINT source_list_row_status_history_batch_fk
      FOREIGN KEY (export_batch_id)
      REFERENCES public.source_list_export_batches(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN public.source_list_row_status_history.export_batch_id IS
  'Export batch recorded when the row was marked loaded_to_dialer.';

ALTER TABLE public.source_list_export_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_list_export_batch_phones ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.source_list_export_batches, public.source_list_export_batch_phones
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.source_list_export_batches, public.source_list_export_batch_phones
  TO service_role;

CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1(p_phone text)
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
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.source_list_phone_block_reason_v1(text) IS
  'Live scrub. Returns why a phone is excluded, including prospect_phones wrong-number and disconnected stamps or dispositions, or null when it may be exported.';

COMMENT ON VIEW public.source_list_dialer_export IS
  'Dialer load file. Drops opt-out, do-not-call, voice-hold, blocked, wrong-number, and disconnected phones at read time.';

COMMENT ON VIEW public.source_list_dialer_suppressed IS
  'Phones removed from the dialer export, with block_reason such as wrong_number or disconnected.';

CREATE OR REPLACE FUNCTION public.source_list_row_status_history_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.status_reason IS NOT DISTINCT FROM OLD.status_reason
    AND NEW.loaded_export_batch_id IS NOT DISTINCT FROM OLD.loaded_export_batch_id
  THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.source_list_row_status_history (
    source_list_row_id, from_status, to_status, status_reason, changed_by, export_batch_id
  ) VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    NEW.status_reason,
    NEW.updated_by,
    CASE WHEN NEW.status = 'loaded_to_dialer' THEN NEW.loaded_export_batch_id ELSE NULL END
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS source_list_row_status_history ON public.source_list_rows;
CREATE TRIGGER source_list_row_status_history
  AFTER INSERT OR UPDATE OF status, status_reason, loaded_export_batch_id
  ON public.source_list_rows
  FOR EACH ROW
  EXECUTE FUNCTION public.source_list_row_status_history_v1();

DROP FUNCTION IF EXISTS public.set_source_list_row_status_v1(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.set_source_list_row_status_v1(
  p_row_id uuid,
  p_status text,
  p_status_reason text,
  p_actor text,
  p_export_batch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_reason text := nullif(btrim(coalesce(p_status_reason, '')), '');
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_row public.source_list_rows;
BEGIN
  IF p_row_id IS NULL OR v_actor IS NULL OR char_length(v_actor) > 320 THEN
    RAISE EXCEPTION 'source_list_identity_invalid';
  END IF;
  IF v_status IS NULL OR v_status NOT IN (
    'new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer'
  ) THEN
    RAISE EXCEPTION 'source_list_status_invalid';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'source_list_status_invalid';
  END IF;
  IF v_status = 'loaded_to_dialer' AND p_export_batch_id IS NULL THEN
    RAISE EXCEPTION 'source_list_export_batch_required';
  END IF;
  IF v_status <> 'loaded_to_dialer' AND p_export_batch_id IS NOT NULL THEN
    RAISE EXCEPTION 'source_list_export_batch_mismatch';
  END IF;
  IF v_status = 'loaded_to_dialer' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.source_list_export_batches WHERE id = p_export_batch_id
    ) THEN
      RAISE EXCEPTION 'source_list_export_batch_not_found';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.source_list_export_batch_phones AS phone
      WHERE phone.export_batch_id = p_export_batch_id
        AND phone.source_list_row_id = p_row_id
    ) THEN
      RAISE EXCEPTION 'source_list_export_batch_mismatch';
    END IF;
  END IF;

  UPDATE public.source_list_rows
  SET status = v_status,
      status_reason = v_reason,
      updated_by = v_actor,
      updated_at = clock_timestamp(),
      loaded_at = CASE WHEN v_status = 'loaded_to_dialer' THEN clock_timestamp() ELSE loaded_at END,
      loaded_export_batch_id = CASE
        WHEN v_status = 'loaded_to_dialer' THEN p_export_batch_id
        ELSE loaded_export_batch_id
      END
  WHERE id = p_row_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'source_list_row_not_found';
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'status_reason', v_row.status_reason,
    'status_changed_at', v_row.status_changed_at,
    'loaded_at', v_row.loaded_at,
    'loaded_export_batch_id', v_row.loaded_export_batch_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.set_source_list_row_status_v1(uuid, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_source_list_row_status_v1(uuid, text, text, text, uuid)
  TO service_role;

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
    'rows', v_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_source_list_export_batch_v1(text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_source_list_export_batch_v1(text, text, text, text, text, uuid)
  TO service_role;

COMMENT ON FUNCTION public.record_source_list_export_batch_v1(text, text, text, text, text, uuid) IS
  'Snapshots source_list_dialer_export into a batch. The returned rows are the phones stored for that scrub.';
