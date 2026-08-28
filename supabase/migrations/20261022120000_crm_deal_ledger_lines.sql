-- Deal File ledger. Robin owns this schema.
-- Money posted on a deal is an append-only line, not assignment_fee / notes.

CREATE TABLE IF NOT EXISTS public.crm_deal_ledger_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  tc_file_id uuid REFERENCES public.tc_files(id) ON DELETE SET NULL,
  dispo_deal_id uuid REFERENCES public.dispo_deals(id) ON DELETE SET NULL,
  file_number text,
  property_address text,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0 AND amount <= 100000000),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  posted_on date NOT NULL,
  source text NOT NULL CHECK (char_length(btrim(source)) > 0 AND char_length(source) <= 200),
  memo text CHECK (memo IS NULL OR char_length(memo) <= 1000),
  category text NOT NULL CHECK (category IN (
    'assignment_fee',
    'transaction_fee',
    'emd',
    'overhead',
    'other'
  )),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) >= 8 AND char_length(idempotency_key) <= 200),
  actor text NOT NULL DEFAULT 'system' CHECK (char_length(btrim(actor)) > 0 AND char_length(actor) <= 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_deal_ledger_lines_idempotency
  ON public.crm_deal_ledger_lines (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_deal_ledger_lines_identity
  ON public.crm_deal_ledger_lines (source, category, direction);
CREATE INDEX IF NOT EXISTS idx_crm_deal_ledger_lines_lead_posted
  ON public.crm_deal_ledger_lines (lead_id, posted_on ASC, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_crm_deal_ledger_lines_file_number
  ON public.crm_deal_ledger_lines (file_number, posted_on ASC)
  WHERE file_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_deal_ledger_lines_tc_file
  ON public.crm_deal_ledger_lines (tc_file_id, posted_on ASC)
  WHERE tc_file_id IS NOT NULL;

ALTER TABLE public.crm_deal_ledger_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.crm_deal_ledger_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.crm_deal_ledger_lines TO service_role;

DROP POLICY IF EXISTS "Service role read insert on crm_deal_ledger_lines" ON public.crm_deal_ledger_lines;
CREATE POLICY "Service role read insert on crm_deal_ledger_lines"
  ON public.crm_deal_ledger_lines FOR SELECT TO service_role
  USING (true);

DROP POLICY IF EXISTS "Service role insert on crm_deal_ledger_lines" ON public.crm_deal_ledger_lines;
CREATE POLICY "Service role insert on crm_deal_ledger_lines"
  ON public.crm_deal_ledger_lines FOR INSERT TO service_role
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.forbid_crm_deal_ledger_line_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'deal_ledger_immutable';
END
$$;

REVOKE ALL ON FUNCTION public.forbid_crm_deal_ledger_line_mutation_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.forbid_crm_deal_ledger_line_mutation_v1() TO service_role;

DROP TRIGGER IF EXISTS crm_deal_ledger_lines_no_update ON public.crm_deal_ledger_lines;
CREATE TRIGGER crm_deal_ledger_lines_no_update
  BEFORE UPDATE OR DELETE ON public.crm_deal_ledger_lines
  FOR EACH ROW EXECUTE FUNCTION public.forbid_crm_deal_ledger_line_mutation_v1();

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
  IF normalized_category IS NULL OR normalized_category NOT IN ('assignment_fee', 'transaction_fee', 'emd', 'overhead', 'other') THEN
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

REVOKE ALL ON FUNCTION public.post_crm_deal_ledger_line_v1(
  uuid, text, text, numeric, text, date, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_crm_deal_ledger_line_v1(
  uuid, text, text, numeric, text, date, text, text, text, text, text
) TO service_role;

COMMENT ON TABLE public.crm_deal_ledger_lines IS
  'Append-only Deal File money lines. Robin owns this schema. Engines post; browsers do not mutate.';
COMMENT ON FUNCTION public.post_crm_deal_ledger_line_v1(
  uuid, text, text, numeric, text, date, text, text, text, text, text
) IS
  'Inserts one Deal File ledger line or returns the existing identical line. Never updates a posted line.';
