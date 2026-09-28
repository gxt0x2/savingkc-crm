-- Jackson County excess-proceeds lane on the Deal File.
-- Robin owns leads.station. This lane stores Chapter 141 fields and does not
-- add stages. Recommended path, using stations that already exist:
--   raw            -> new
--   enriched       -> qualified
--   in_conversation -> contacted
--   under_contract -> under_contract (services agreement)
--   closed         -> closed_won (funds recovered)
--   dead           -> dead
-- Claim deadline is sale_date + 2 years (RSMo 141.580.4). Zestimate is stored
-- only when a value and an as-of date are both supplied.

SET lock_timeout = '10s';
SET statement_timeout = '5min';

DO $$
DECLARE
  source_constraint_name text;
  source_constraint_expression text;
  source_type text;
  source_column smallint;
  source_constraint_count integer;
  source_constraint_validated boolean;
  source_constraint_noinherit boolean;
BEGIN
  SELECT typ.typname, col.attnum INTO source_type, source_column
  FROM pg_attribute col JOIN pg_type typ ON typ.oid = col.atttypid
  WHERE col.attrelid = 'public.leads'::regclass AND col.attname = 'source';
  IF source_type NOT IN ('text', 'varchar') THEN
    RAISE EXCEPTION 'excess proceeds requires a text leads.source column';
  END IF;
  SELECT count(*) INTO source_constraint_count FROM pg_constraint
  WHERE conrelid = 'public.leads'::regclass AND contype = 'c'
    AND source_column = ANY (conkey);
  IF source_constraint_count > 1 THEN
    RAISE EXCEPTION 'excess proceeds source constraint is ambiguous';
  END IF;
  SELECT constraint_row.conname,
    pg_get_expr(constraint_row.conbin, constraint_row.conrelid),
    constraint_row.convalidated, constraint_row.connoinherit
  INTO source_constraint_name, source_constraint_expression,
    source_constraint_validated, source_constraint_noinherit
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.leads'::regclass
    AND constraint_row.contype = 'c'
    AND source_column = ANY (constraint_row.conkey)
    AND cardinality(constraint_row.conkey) = 1;

  IF source_constraint_expression IS NOT NULL
    AND source_constraint_expression NOT LIKE '%excess_proceeds%'
  THEN
    EXECUTE format('ALTER TABLE public.leads DROP CONSTRAINT %I', source_constraint_name);
    EXECUTE format(
      'ALTER TABLE public.leads ADD CONSTRAINT %I CHECK ((%s) OR source::text = %L) %s NOT VALID',
      source_constraint_name,
      source_constraint_expression,
      'excess_proceeds',
      CASE WHEN source_constraint_noinherit THEN 'NO INHERIT' ELSE '' END
    );
    IF source_constraint_validated THEN
      EXECUTE format('ALTER TABLE public.leads VALIDATE CONSTRAINT %I', source_constraint_name);
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.crm_excess_proceeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  track text NOT NULL DEFAULT 'excess_proceeds' CHECK (track = 'excess_proceeds'),
  county_source text NOT NULL DEFAULT 'jackson_dlt' CHECK (county_source = 'jackson_dlt'),
  suit_no text NOT NULL CHECK (char_length(suit_no) BETWEEN 1 AND 40),
  parcel_no text NOT NULL CHECK (char_length(parcel_no) BETWEEN 1 AND 40),
  owner_name text CHECK (owner_name IS NULL OR char_length(owner_name) <= 200),
  property_address text CHECK (property_address IS NULL OR char_length(property_address) <= 300),
  city text,
  state text,
  zip text,
  sale_date date,
  purchase_price numeric(14, 2) CHECK (purchase_price IS NULL OR (purchase_price >= 0 AND purchase_price <= 100000000)),
  judgment_amount numeric(14, 2) CHECK (judgment_amount IS NULL OR (judgment_amount >= 0 AND judgment_amount <= 100000000)),
  excess_amount numeric(14, 2) CHECK (excess_amount IS NULL OR (excess_amount >= 0 AND excess_amount <= 100000000)),
  claim_deadline date,
  claim_period_elapsed boolean NOT NULL DEFAULT false,
  confirmed_date date,
  deed_date date,
  set_aside_date date,
  refund_date date,
  excess_application_filed_date date,
  excess_denied_date date,
  excess_paid_date date,
  payout_ready boolean NOT NULL DEFAULT false,
  zestimate numeric(14, 2) CHECK (zestimate IS NULL OR (zestimate >= 0 AND zestimate <= 100000000)),
  zestimate_as_of date,
  score numeric(8, 2) CHECK (score IS NULL OR (score >= 0 AND score <= 1000)),
  owner_is_entity boolean NOT NULL DEFAULT false,
  counsel_status text NOT NULL DEFAULT 'pending' CHECK (counsel_status IN ('pending', 'clear', 'blocked')),
  form_pack_status text NOT NULL DEFAULT 'none' CHECK (form_pack_status IN ('none', 'drafted', 'signed')),
  form_pack_url text CHECK (form_pack_url IS NULL OR (char_length(form_pack_url) <= 500 AND form_pack_url ~ '^https?://')),
  surplus_fee_pct numeric(5, 2) NOT NULL DEFAULT 10 CHECK (surplus_fee_pct >= 0 AND surplus_fee_pct <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_excess_proceeds_zestimate_pair CHECK (
    (zestimate IS NULL AND zestimate_as_of IS NULL)
    OR (zestimate IS NOT NULL AND zestimate_as_of IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_excess_proceeds_suit_parcel
  ON public.crm_excess_proceeds (suit_no, parcel_no);
CREATE INDEX IF NOT EXISTS idx_crm_excess_proceeds_excess_amount
  ON public.crm_excess_proceeds (excess_amount DESC NULLS LAST, id);
CREATE INDEX IF NOT EXISTS idx_crm_excess_proceeds_score
  ON public.crm_excess_proceeds (score DESC NULLS LAST, id);
CREATE INDEX IF NOT EXISTS idx_crm_excess_proceeds_claim_deadline
  ON public.crm_excess_proceeds (claim_deadline);

ALTER TABLE public.crm_excess_proceeds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_excess_proceeds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.crm_excess_proceeds TO service_role;

COMMENT ON TABLE public.crm_excess_proceeds IS
  'Jackson County Chapter 141 excess-proceeds lane. One row per Deal File. Idempotent on suit_no + parcel_no. claim_deadline is sale_date + 2 years.';

CREATE OR REPLACE FUNCTION public.sync_excess_proceeds_claim_clock_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.sale_date IS NULL THEN
    NEW.claim_deadline := NULL;
    NEW.claim_period_elapsed := false;
  ELSE
    NEW.claim_deadline := (NEW.sale_date + interval '2 years')::date;
    NEW.claim_period_elapsed := NEW.claim_deadline < CURRENT_DATE;
  END IF;
  NEW.updated_at := pg_catalog.now();
  IF NEW.zestimate IS NULL THEN
    NEW.zestimate_as_of := NULL;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.sync_excess_proceeds_claim_clock_v1() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_excess_proceeds_claim_clock ON public.crm_excess_proceeds;
CREATE TRIGGER crm_excess_proceeds_claim_clock
  BEFORE INSERT OR UPDATE ON public.crm_excess_proceeds
  FOR EACH ROW EXECUTE FUNCTION public.sync_excess_proceeds_claim_clock_v1();

CREATE OR REPLACE FUNCTION public.upsert_jackson_excess_proceeds_batch_v1(
  target_rows jsonb,
  target_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  element jsonb;
  suit text;
  parcel text;
  existing public.crm_excess_proceeds;
  lead_id uuid;
  inserted_count integer := 0;
  updated_count integer := 0;
  errors jsonb := '[]'::jsonb;
  sale_value date;
  purchase_value numeric;
  judgment_value numeric;
  excess_value numeric;
  confirmed_value date;
  deed_value date;
  set_aside_value date;
  refund_value date;
  filed_value date;
  denied_value date;
  paid_value date;
  zest_value numeric;
  zest_as_of date;
  score_value numeric;
  entity_value boolean;
  counsel_value text;
  form_value text;
  payout_value boolean;
  fee_value numeric;
  url_value text;
  owner_value text;
  address_value text;
  city_value text;
  state_value text;
  zip_value text;
BEGIN
  IF nullif(btrim(coalesce(target_actor, '')), '') IS NULL THEN
    RAISE EXCEPTION 'actor_required';
  END IF;
  IF jsonb_typeof(target_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'rows_required';
  END IF;
  IF jsonb_array_length(target_rows) > 1000 THEN
    RAISE EXCEPTION 'import_limit';
  END IF;

  FOR element IN SELECT value FROM jsonb_array_elements(target_rows) AS rows(value)
  LOOP
    BEGIN
      suit := upper(regexp_replace(btrim(coalesce(element->>'suit_no', '')), '\s+', '', 'g'));
      parcel := upper(regexp_replace(btrim(coalesce(element->>'parcel_no', '')), '\s+', '', 'g'));
      IF suit = '' OR parcel = '' OR char_length(suit) > 40 OR char_length(parcel) > 40 THEN
        RAISE EXCEPTION 'invalid_identity';
      END IF;

      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('excess-proceeds:' || suit || ':' || parcel, 0));
      SELECT * INTO existing FROM public.crm_excess_proceeds WHERE suit_no = suit AND parcel_no = parcel;

      owner_value := nullif(btrim(coalesce(element->>'owner_name', '')), '');
      address_value := nullif(btrim(coalesce(element->>'property_address', '')), '');
      city_value := nullif(btrim(coalesce(element->>'city', '')), '');
      state_value := nullif(upper(btrim(coalesce(element->>'state', ''))), '');
      zip_value := nullif(btrim(coalesce(element->>'zip', '')), '');
      IF state_value IS NOT NULL AND state_value !~ '^[A-Z]{2}$' THEN
        RAISE EXCEPTION 'invalid_state';
      END IF;

      IF coalesce((element->>'sale_date_provided')::boolean, false) THEN
        sale_value := nullif(element->>'sale_date', '')::date;
      ELSE
        sale_value := existing.sale_date;
      END IF;
      IF coalesce((element->>'purchase_price_provided')::boolean, false) THEN
        purchase_value := nullif(element->>'purchase_price', '')::numeric;
      ELSE
        purchase_value := existing.purchase_price;
      END IF;
      IF coalesce((element->>'judgment_amount_provided')::boolean, false) THEN
        judgment_value := nullif(element->>'judgment_amount', '')::numeric;
      ELSE
        judgment_value := existing.judgment_amount;
      END IF;
      IF coalesce((element->>'excess_amount_provided')::boolean, false) THEN
        excess_value := nullif(element->>'excess_amount', '')::numeric;
      ELSE
        excess_value := existing.excess_amount;
      END IF;
      IF purchase_value < 0 OR judgment_value < 0 OR excess_value < 0
        OR purchase_value > 100000000 OR judgment_value > 100000000 OR excess_value > 100000000 THEN
        RAISE EXCEPTION 'invalid_amount';
      END IF;

      IF coalesce((element->>'confirmed_date_provided')::boolean, false) THEN
        confirmed_value := nullif(element->>'confirmed_date', '')::date;
      ELSE
        confirmed_value := existing.confirmed_date;
      END IF;
      IF coalesce((element->>'deed_date_provided')::boolean, false) THEN
        deed_value := nullif(element->>'deed_date', '')::date;
      ELSE
        deed_value := existing.deed_date;
      END IF;
      IF coalesce((element->>'set_aside_date_provided')::boolean, false) THEN
        set_aside_value := nullif(element->>'set_aside_date', '')::date;
      ELSE
        set_aside_value := existing.set_aside_date;
      END IF;
      IF coalesce((element->>'refund_date_provided')::boolean, false) THEN
        refund_value := nullif(element->>'refund_date', '')::date;
      ELSE
        refund_value := existing.refund_date;
      END IF;
      IF coalesce((element->>'excess_application_filed_date_provided')::boolean, false) THEN
        filed_value := nullif(element->>'excess_application_filed_date', '')::date;
      ELSE
        filed_value := existing.excess_application_filed_date;
      END IF;
      IF coalesce((element->>'excess_denied_date_provided')::boolean, false) THEN
        denied_value := nullif(element->>'excess_denied_date', '')::date;
      ELSE
        denied_value := existing.excess_denied_date;
      END IF;
      IF coalesce((element->>'excess_paid_date_provided')::boolean, false) THEN
        paid_value := nullif(element->>'excess_paid_date', '')::date;
      ELSE
        paid_value := existing.excess_paid_date;
      END IF;

      IF coalesce((element->>'zestimate_provided')::boolean, false) THEN
        IF nullif(element->>'zestimate', '') IS NULL OR nullif(element->>'zestimate_as_of', '') IS NULL THEN
          zest_value := NULL;
          zest_as_of := NULL;
        ELSE
          zest_value := (element->>'zestimate')::numeric;
          zest_as_of := (element->>'zestimate_as_of')::date;
          IF zest_value < 0 OR zest_value > 100000000 THEN RAISE EXCEPTION 'invalid_zestimate'; END IF;
        END IF;
      ELSE
        zest_value := existing.zestimate;
        zest_as_of := existing.zestimate_as_of;
      END IF;

      IF coalesce((element->>'score_provided')::boolean, false) THEN
        score_value := nullif(element->>'score', '')::numeric;
        IF score_value < 0 OR score_value > 1000 THEN RAISE EXCEPTION 'invalid_score'; END IF;
      ELSE
        score_value := existing.score;
      END IF;

      IF coalesce((element->>'owner_is_entity_provided')::boolean, false) THEN
        entity_value := coalesce((element->>'owner_is_entity')::boolean, false);
      ELSIF existing.id IS NOT NULL THEN
        entity_value := existing.owner_is_entity;
      ELSE
        entity_value := false;
      END IF;

      IF coalesce((element->>'counsel_status_provided')::boolean, false) THEN
        counsel_value := coalesce(nullif(element->>'counsel_status', ''), 'pending');
      ELSIF existing.id IS NOT NULL THEN
        counsel_value := existing.counsel_status;
      ELSE
        counsel_value := 'pending';
      END IF;
      IF counsel_value NOT IN ('pending', 'clear', 'blocked') THEN RAISE EXCEPTION 'invalid_counsel_status'; END IF;

      IF coalesce((element->>'form_pack_status_provided')::boolean, false) THEN
        form_value := coalesce(nullif(element->>'form_pack_status', ''), 'none');
      ELSIF existing.id IS NOT NULL THEN
        form_value := existing.form_pack_status;
      ELSE
        form_value := 'none';
      END IF;
      IF form_value NOT IN ('none', 'drafted', 'signed') THEN RAISE EXCEPTION 'invalid_form_pack_status'; END IF;

      IF coalesce((element->>'payout_ready_provided')::boolean, false) THEN
        payout_value := coalesce((element->>'payout_ready')::boolean, false);
      ELSIF existing.id IS NOT NULL THEN
        payout_value := existing.payout_ready;
      ELSE
        payout_value := false;
      END IF;

      IF coalesce((element->>'surplus_fee_pct_provided')::boolean, false) THEN
        fee_value := coalesce(nullif(element->>'surplus_fee_pct', '')::numeric, 10);
      ELSIF existing.id IS NOT NULL THEN
        fee_value := existing.surplus_fee_pct;
      ELSE
        fee_value := 10;
      END IF;
      IF fee_value < 0 OR fee_value > 100 THEN RAISE EXCEPTION 'invalid_fee_pct'; END IF;

      IF coalesce((element->>'form_pack_url_provided')::boolean, false) THEN
        url_value := nullif(btrim(coalesce(element->>'form_pack_url', '')), '');
      ELSE
        url_value := existing.form_pack_url;
      END IF;
      IF url_value IS NOT NULL AND (char_length(url_value) > 500 OR url_value !~ '^https?://') THEN
        RAISE EXCEPTION 'invalid_form_pack_url';
      END IF;

      IF existing.id IS NULL THEN
        INSERT INTO public.leads (
          full_name, property_address, city, state, zip, county, parcel_id, source,
          station, classification, priority, is_parked
        ) VALUES (
          owner_value,
          address_value,
          city_value,
          coalesce(state_value, 'MO'),
          zip_value,
          'Jackson',
          parcel,
          'excess_proceeds',
          'new',
          NULL,
          'cold',
          false
        ) RETURNING id INTO lead_id;

        INSERT INTO public.crm_excess_proceeds (
          lead_id, suit_no, parcel_no, owner_name, property_address, city, state, zip,
          sale_date, purchase_price, judgment_amount, excess_amount,
          confirmed_date, deed_date, set_aside_date, refund_date,
          excess_application_filed_date, excess_denied_date, excess_paid_date,
          payout_ready, zestimate, zestimate_as_of, score, owner_is_entity,
          counsel_status, form_pack_status, form_pack_url, surplus_fee_pct
        ) VALUES (
          lead_id, suit, parcel, owner_value, address_value, city_value, coalesce(state_value, 'MO'), zip_value,
          sale_value, purchase_value, judgment_value, excess_value,
          confirmed_value, deed_value, set_aside_value, refund_value,
          filed_value, denied_value, paid_value,
          payout_value, zest_value, zest_as_of, score_value, entity_value,
          counsel_value, form_value, url_value, fee_value
        );

        INSERT INTO public.lead_activities (lead_id, activity_type, description, agent, metadata)
        VALUES (
          lead_id,
          'status_change',
          'Jackson excess-proceeds Deal File opened from county CSV',
          btrim(target_actor),
          jsonb_build_object('source', 'jackson_dlt', 'track', 'excess_proceeds', 'suit_no', suit, 'parcel_no', parcel)
        );
        inserted_count := inserted_count + 1;
      ELSE
        UPDATE public.leads SET
          full_name = coalesce(owner_value, full_name),
          property_address = coalesce(address_value, property_address),
          city = coalesce(city_value, city),
          state = coalesce(state_value, state),
          zip = coalesce(zip_value, zip),
          county = coalesce(county, 'Jackson'),
          parcel_id = coalesce(parcel_id, parcel),
          updated_at = now()
        WHERE id = existing.lead_id;

        UPDATE public.crm_excess_proceeds SET
          owner_name = coalesce(owner_value, owner_name),
          property_address = coalesce(address_value, property_address),
          city = coalesce(city_value, city),
          state = coalesce(state_value, state),
          zip = coalesce(zip_value, zip),
          sale_date = sale_value,
          purchase_price = purchase_value,
          judgment_amount = judgment_value,
          excess_amount = excess_value,
          confirmed_date = confirmed_value,
          deed_date = deed_value,
          set_aside_date = set_aside_value,
          refund_date = refund_value,
          excess_application_filed_date = filed_value,
          excess_denied_date = denied_value,
          excess_paid_date = paid_value,
          payout_ready = payout_value,
          zestimate = zest_value,
          zestimate_as_of = zest_as_of,
          score = score_value,
          owner_is_entity = entity_value,
          counsel_status = counsel_value,
          form_pack_status = form_value,
          form_pack_url = url_value,
          surplus_fee_pct = fee_value
        WHERE id = existing.id;
        updated_count := updated_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      errors := errors || jsonb_build_array(jsonb_build_object(
        'suit_no', suit,
        'parcel_no', parcel,
        'message', SQLERRM
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object('inserted', inserted_count, 'updated', updated_count, 'errors', errors);
END
$$;

REVOKE ALL ON FUNCTION public.upsert_jackson_excess_proceeds_batch_v1(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_jackson_excess_proceeds_batch_v1(jsonb, text) TO service_role;

COMMENT ON FUNCTION public.upsert_jackson_excess_proceeds_batch_v1(jsonb, text) IS
  'Creates or updates Jackson excess-proceeds Deal Files. Idempotent on suit_no + parcel_no. Does not move an existing station.';

-- Ledger categories for recovered surplus and Saving KC fee income.
-- excess_proceeds_recovery is the gross surplus. excess_proceeds_fee is fee income for Treasury P&L.
DO $$
DECLARE
  category_constraint_name text;
BEGIN
  SELECT con.conname INTO category_constraint_name
  FROM pg_constraint con
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
  WHERE con.conrelid = 'public.crm_deal_ledger_lines'::regclass
    AND con.contype = 'c'
    AND att.attname = 'category'
    AND cardinality(con.conkey) = 1;
  IF category_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.crm_deal_ledger_lines DROP CONSTRAINT %I', category_constraint_name);
  END IF;
END $$;

ALTER TABLE public.crm_deal_ledger_lines
  ADD CONSTRAINT crm_deal_ledger_lines_category_check
  CHECK (category IN (
    'assignment_fee',
    'transaction_fee',
    'emd',
    'overhead',
    'other',
    'excess_proceeds_recovery',
    'excess_proceeds_fee'
  ));

CREATE OR REPLACE FUNCTION public.post_crm_deal_ledger_line_v1(
  target_lead_id uuid,
  target_file_number text,
  target_property_address text,
  target_amount numeric,
  target_direction text,
  target_posted_on date,
  target_source text,
  target_memo text,
  target_category text,
  target_idempotency_key text,
  target_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  lead_row public.leads;
  file_row public.tc_files;
  line_row public.crm_deal_ledger_lines;
  resolved_tc_file_id uuid := NULL;
  resolved_dispo_deal_id uuid := NULL;
  resolved_file_number text := NULL;
  normalized_source text := nullif(btrim(target_source), '');
  normalized_direction text := lower(btrim(coalesce(target_direction, '')));
  normalized_category text := lower(btrim(coalesce(target_category, '')));
  normalized_file_number text := nullif(btrim(target_file_number), '');
  normalized_address text := nullif(regexp_replace(btrim(coalesce(target_property_address, '')), '\s+', ' ', 'g'), '');
  normalized_memo text := nullif(btrim(target_memo), '');
  normalized_actor text := nullif(btrim(target_actor), '');
  identity_key text;
  match_count integer;
BEGIN
  IF target_amount IS NULL OR target_amount <= 0 OR target_amount > 100000000 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;
  IF normalized_direction IS NULL OR normalized_direction NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'invalid_direction';
  END IF;
  IF normalized_category IS NULL OR normalized_category NOT IN ('assignment_fee', 'transaction_fee', 'emd', 'overhead', 'other', 'excess_proceeds_recovery', 'excess_proceeds_fee') THEN
    RAISE EXCEPTION 'invalid_category';
  END IF;
  IF normalized_source IS NULL OR char_length(normalized_source) > 200 THEN
    RAISE EXCEPTION 'invalid_source';
  END IF;
  IF target_posted_on IS NULL THEN
    RAISE EXCEPTION 'invalid_posted_on';
  END IF;
  IF length(coalesce(normalized_memo, '')) > 1000 THEN
    RAISE EXCEPTION 'invalid_memo';
  END IF;
  IF target_lead_id IS NULL AND normalized_file_number IS NULL AND normalized_address IS NULL THEN
    RAISE EXCEPTION 'deal_key_required';
  END IF;

  identity_key := nullif(btrim(coalesce(target_idempotency_key, '')), '');
  IF identity_key IS NULL THEN
    identity_key := normalized_source || ':' || normalized_category || ':' || normalized_direction;
  END IF;
  IF char_length(identity_key) < 8 OR char_length(identity_key) > 200 THEN
    RAISE EXCEPTION 'invalid_idempotency_key';
  END IF;
  IF normalized_actor IS NULL THEN
    normalized_actor := 'system';
  END IF;
  IF char_length(normalized_actor) > 120 THEN
    RAISE EXCEPTION 'invalid_actor';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('deal-ledger:' || identity_key, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'deal-ledger-identity:' || normalized_source || ':' || normalized_category || ':' || normalized_direction,
      0
    )
  );

  IF target_lead_id IS NOT NULL THEN
    SELECT * INTO lead_row FROM public.leads WHERE id = target_lead_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'deal_not_found'; END IF;
  ELSIF normalized_file_number IS NOT NULL THEN
    SELECT COUNT(*) INTO match_count FROM public.tc_files WHERE file_number = normalized_file_number;
    IF match_count > 1 THEN RAISE EXCEPTION 'deal_ambiguous'; END IF;
    SELECT * INTO file_row FROM public.tc_files WHERE file_number = normalized_file_number LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'deal_not_found'; END IF;
    SELECT * INTO lead_row FROM public.leads WHERE id = file_row.lead_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'deal_not_found'; END IF;
  ELSE
    SELECT COUNT(*) INTO match_count
    FROM public.leads
    WHERE lower(regexp_replace(btrim(coalesce(property_address, '')), '\s+', ' ', 'g'))
      = lower(normalized_address);
    IF match_count > 1 THEN RAISE EXCEPTION 'deal_ambiguous'; END IF;
    SELECT * INTO lead_row
    FROM public.leads
    WHERE lower(regexp_replace(btrim(coalesce(property_address, '')), '\s+', ' ', 'g'))
      = lower(normalized_address)
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'deal_not_found'; END IF;
  END IF;

  IF normalized_file_number IS NOT NULL THEN
    SELECT * INTO file_row
    FROM public.tc_files
    WHERE file_number = normalized_file_number
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 1;
    IF FOUND THEN
      IF file_row.lead_id IS DISTINCT FROM lead_row.id THEN
        RAISE EXCEPTION 'deal_key_conflict';
      END IF;
      resolved_tc_file_id := file_row.id;
      resolved_dispo_deal_id := file_row.dispo_deal_id;
      resolved_file_number := file_row.file_number;
    END IF;
  END IF;

  IF resolved_tc_file_id IS NULL THEN
    SELECT * INTO file_row
    FROM public.tc_files
    WHERE lead_id = lead_row.id
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 1;
    IF FOUND THEN
      resolved_tc_file_id := file_row.id;
      resolved_dispo_deal_id := file_row.dispo_deal_id;
      resolved_file_number := coalesce(normalized_file_number, file_row.file_number);
    END IF;
  END IF;

  SELECT * INTO line_row
  FROM public.crm_deal_ledger_lines
  WHERE idempotency_key = identity_key
     OR (source = normalized_source AND category = normalized_category AND direction = normalized_direction)
  LIMIT 1;

  IF FOUND THEN
    IF line_row.lead_id IS DISTINCT FROM lead_row.id
      OR line_row.amount IS DISTINCT FROM round(target_amount, 2)
      OR line_row.direction IS DISTINCT FROM normalized_direction
      OR line_row.posted_on IS DISTINCT FROM target_posted_on
      OR line_row.source IS DISTINCT FROM normalized_source
      OR line_row.category IS DISTINCT FROM normalized_category
      OR line_row.idempotency_key IS DISTINCT FROM identity_key THEN
      RAISE EXCEPTION 'ledger_line_conflict';
    END IF;
    RETURN jsonb_build_object('line', to_jsonb(line_row), 'replayed', true);
  END IF;

  INSERT INTO public.crm_deal_ledger_lines (
    lead_id,
    tc_file_id,
    dispo_deal_id,
    file_number,
    property_address,
    amount,
    direction,
    posted_on,
    source,
    memo,
    category,
    idempotency_key,
    actor
  ) VALUES (
    lead_row.id,
    resolved_tc_file_id,
    resolved_dispo_deal_id,
    coalesce(normalized_file_number, resolved_file_number),
    coalesce(normalized_address, nullif(btrim(coalesce(lead_row.property_address, '')), '')),
    round(target_amount, 2),
    normalized_direction,
    target_posted_on,
    normalized_source,
    normalized_memo,
    normalized_category,
    identity_key,
    normalized_actor
  )
  RETURNING * INTO line_row;

  RETURN jsonb_build_object('line', to_jsonb(line_row), 'replayed', false);
END
$$;



CREATE OR REPLACE FUNCTION public.crm_deal_ledger_ytd_v1(target_year integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  year_value integer := target_year;
  payload jsonb;
BEGIN
  IF year_value IS NULL THEN
    year_value := EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chicago'))::integer;
  END IF;
  IF year_value < 2000 OR year_value > 2100 THEN
    RAISE EXCEPTION 'invalid_year';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'category', grouped.category,
    'direction', grouped.direction,
    'amount', grouped.amount,
    'line_count', grouped.line_count
  ) ORDER BY grouped.category, grouped.direction), '[]'::jsonb)
  INTO payload
  FROM (
    SELECT category, direction, round(sum(amount), 2) AS amount, count(*)::integer AS line_count
    FROM public.crm_deal_ledger_lines
    WHERE posted_on >= make_date(year_value, 1, 1)
      AND posted_on < make_date(year_value + 1, 1, 1)
    GROUP BY category, direction
  ) AS grouped;
  RETURN jsonb_build_object('year', year_value, 'rows', payload);
END
$$;

REVOKE ALL ON FUNCTION public.crm_deal_ledger_ytd_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_deal_ledger_ytd_v1(integer) TO service_role;

COMMENT ON FUNCTION public.crm_deal_ledger_ytd_v1(integer) IS
  'Calendar-year totals from posted Deal File ledger lines, including excess-proceeds recovery and fee income.';

