-- Sanctioned prospect merge rehearsal.
-- Fictional 555 numbers only. No production data.
--
-- Household: 1 survivor + 19 sources, 49 phones, every one voice-held and dnc.
-- 3 Friend, 4 Coworker, 3 Past neighbor. Nothing is deleted.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE OR REPLACE FUNCTION public.normalize_conversation_phone(raw_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH normalized AS (
    SELECT regexp_replace(COALESCE(raw_phone, ''), '[^0-9]', '', 'g') AS digits
  )
  SELECT CASE
    WHEN length(digits) = 10 THEN '+1' || digits
    WHEN length(digits) = 11 AND digits LIKE '1%' THEN '+' || digits
    ELSE NULL
  END
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION public.prospecting_phone_key_v1(phone_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN length(regexp_replace(coalesce(phone_value, ''), '[^0-9]', '', 'g')) >= 10
      THEN right(regexp_replace(phone_value, '[^0-9]', '', 'g'), 10)
    ELSE regexp_replace(coalesce(phone_value, ''), '[^0-9]', '', 'g')
  END;
$$;

CREATE TABLE public.prospects (
  id uuid PRIMARY KEY,
  county text NOT NULL,
  parcel_id text,
  owner_1 text,
  owner_1_type text,
  lead_id uuid,
  situs_street text,
  situs_zip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.prospect_phones (
  id uuid PRIMARY KEY,
  prospect_id uuid NOT NULL REFERENCES public.prospects(id),
  phone text NOT NULL,
  relationship text,
  voice_hold boolean NOT NULL DEFAULT false,
  voice_hold_reason text,
  voice_hold_at timestamptz,
  voice_hold_by text,
  last_disposition text
);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY,
  full_name text,
  phone text,
  station text,
  classification text,
  dead_reason text,
  call_result text
);

CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY,
  lead_id uuid,
  prospect_id uuid,
  activity_type text
);

CREATE TABLE public.work_items (
  work_item_key text PRIMARY KEY,
  source_kind text NOT NULL CHECK (source_kind IN ('activity', 'tc_task')),
  source_id uuid NOT NULL,
  lead_id uuid,
  tc_file_id uuid,
  kind text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'blocked', 'cancelled')),
  priority text NOT NULL DEFAULT 'normal',
  due_at timestamptz,
  assigned_to text,
  department text NOT NULL DEFAULT 'acquisitions',
  role text,
  primary_next_action boolean NOT NULL DEFAULT false,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  source_created_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  operational_lane text NOT NULL DEFAULT 'review' CHECK (operational_lane IN ('current', 'review')),
  prospect_id uuid,
  UNIQUE (source_kind, source_id)
);

CREATE TABLE public.prospecting_campaigns (
  id uuid PRIMARY KEY,
  kind text NOT NULL
);

CREATE TABLE public.prospecting_campaign_members (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.prospecting_campaigns(id),
  lead_id uuid,
  prospect_id uuid REFERENCES public.prospects(id),
  subject_kind text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  suppression_reason text,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_prospecting_campaign_members_prospect_subject
  ON public.prospecting_campaign_members (campaign_id, prospect_id)
  WHERE subject_kind = 'prospect';

CREATE TABLE public.prospecting_campaign_member_contacts (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES public.prospecting_campaign_members(id),
  prospect_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.prospecting_campaign_actions (
  id uuid PRIMARY KEY,
  prospect_id uuid,
  lead_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1(p_phone text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.prospect_phones AS phone
      WHERE phone.voice_hold IS TRUE
        AND public.prospecting_phone_key_v1(phone.phone) = public.prospecting_phone_key_v1(p_phone)
    ) THEN 'voice_hold'
    ELSE NULL
  END;
$$;

CREATE TABLE public.source_lists (
  id uuid PRIMARY KEY,
  pull_date date,
  source_file_name text
);

CREATE TABLE public.source_list_rows (
  id uuid PRIMARY KEY,
  source_list_id uuid NOT NULL REFERENCES public.source_lists(id),
  list_type text,
  county text,
  state text,
  violation_kind text,
  parcel_id text,
  case_id text,
  address text,
  owner_names text,
  amount_owed numeric,
  property_id uuid,
  prospect_id uuid,
  status text,
  phones text[]
);

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
  public.source_list_phone_block_reason_v1(dialed.phone_value) AS block_reason,
  NULL::text AS line_check_flag,
  false AS requires_licensee_disclosure
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

\i :migration

CREATE OR REPLACE VIEW public.source_list_dialer_export
WITH (security_invoker = true) AS
SELECT *
FROM public.source_list_dialer_phone_review
WHERE block_reason IS NULL;

CREATE OR REPLACE VIEW public.source_list_dialer_suppressed
WITH (security_invoker = true) AS
SELECT *
FROM public.source_list_dialer_phone_review
WHERE block_reason IS NOT NULL;

CREATE TEMP TABLE household_plan (
  n integer PRIMARY KEY,
  owner_type text NOT NULL,
  phone_count integer NOT NULL
);

INSERT INTO household_plan (n, owner_type, phone_count) VALUES
  (1, 'Owner', 10),
  (2, 'Friend', 1),
  (3, 'Friend', 1),
  (4, 'Friend', 1),
  (5, 'Coworker', 1),
  (6, 'Coworker', 1),
  (7, 'Coworker', 1),
  (8, 'Coworker', 1),
  (9, 'Past neighbor', 1),
  (10, 'Past neighbor', 1),
  (11, 'Past neighbor', 1),
  (12, 'In-law', 2),
  (13, 'Landlord', 1),
  (14, 'Tenant', 1),
  (15, 'Spouse', 5),
  (16, 'Sibling', 5),
  (17, 'Relative', 5),
  (18, 'Owner', 5),
  (19, 'Child', 3),
  (20, 'Owner', 2);

DO $$
DECLARE
  plan record;
  phone_n integer := 0;
  slot integer;
  prospect_id uuid;
  phone_id uuid;
BEGIN
  IF (SELECT count(*) FROM household_plan) <> 20 THEN
    RAISE EXCEPTION 'household plan must be 20 records';
  END IF;
  IF (SELECT sum(phone_count) FROM household_plan) <> 49 THEN
    RAISE EXCEPTION 'household plan must be 49 phones';
  END IF;
  IF (SELECT sum(phone_count) FROM household_plan WHERE owner_type = 'Friend') <> 3 THEN
    RAISE EXCEPTION 'household plan must include 3 Friend phones';
  END IF;
  IF (SELECT sum(phone_count) FROM household_plan WHERE owner_type = 'Coworker') <> 4 THEN
    RAISE EXCEPTION 'household plan must include 4 Coworker phones';
  END IF;
  IF (SELECT sum(phone_count) FROM household_plan WHERE owner_type = 'Past neighbor') <> 3 THEN
    RAISE EXCEPTION 'household plan must include 3 Past neighbor phones';
  END IF;

  FOR plan IN SELECT * FROM household_plan ORDER BY n LOOP
    prospect_id := ('00000000-0000-4000-8000-' || lpad(plan.n::text, 12, '0'))::uuid;
    INSERT INTO public.prospects (id, county, parcel_id, owner_1, owner_1_type, situs_street, situs_zip)
    VALUES (
      prospect_id,
      'jackson',
      'FIXTURE-PARCEL-100',
      CASE WHEN plan.n = 1 THEN 'Household Owner' ELSE plan.owner_type || ' ' || plan.n END,
      plan.owner_type,
      '100 Merge Lane',
      '64105'
    );
    FOR slot IN 1..plan.phone_count LOOP
      phone_n := phone_n + 1;
      phone_id := ('00000000-0000-4000-8100-' || lpad(phone_n::text, 12, '0'))::uuid;
      INSERT INTO public.prospect_phones (
        id, prospect_id, phone, voice_hold, voice_hold_reason, voice_hold_at, voice_hold_by, last_disposition
      ) VALUES (
        phone_id,
        prospect_id,
        '+1816555' || lpad(phone_n::text, 4, '0'),
        true,
        'household_dnc',
        '2026-01-15 15:00:00+00',
        'Household fixture',
        'dnc'
      );
    END LOOP;
  END LOOP;

  IF phone_n <> 49 THEN
    RAISE EXCEPTION 'inserted % household phones', phone_n;
  END IF;
END $$;

INSERT INTO public.prospect_phones (
  id, prospect_id, phone, voice_hold, last_disposition
) VALUES (
  '00000000-0000-4000-8100-000000000050',
  '00000000-0000-4000-8000-000000000001',
  '+18165550050',
  false,
  NULL
);

INSERT INTO public.leads (id, full_name, phone, station, classification)
VALUES (
  '00000000-0000-4000-8000-0000000000aa',
  'In Law Lead',
  '+18165550021',
  'new',
  'lead'
);

UPDATE public.prospects
SET lead_id = '00000000-0000-4000-8000-0000000000aa'
WHERE id = '00000000-0000-4000-8000-000000000012';

INSERT INTO public.lead_activities (id, lead_id, prospect_id, activity_type)
VALUES (
  '00000000-0000-4000-8000-0000000000ab',
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-000000000012',
  'note'
);

INSERT INTO public.work_items (
  work_item_key, source_kind, source_id, lead_id, prospect_id, kind, title,
  status, department, source_created_at, operational_lane
) VALUES (
  'activity:00000000-0000-4000-8000-0000000000ab',
  'activity',
  '00000000-0000-4000-8000-0000000000ab',
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-000000000012',
  'note',
  'Household note',
  'pending',
  'acquisitions',
  '2026-02-01 00:00:00+00',
  'current'
);

INSERT INTO public.prospecting_campaigns (id, kind)
VALUES ('00000000-0000-4000-8000-0000000000c1', 'dialer');

INSERT INTO public.prospecting_campaign_members (
  id, campaign_id, prospect_id, subject_kind, status, enrolled_at
) VALUES
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000015', 'prospect', 'active', '2026-02-01'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000016', 'prospect', 'active', '2026-02-02');

INSERT INTO public.prospecting_campaign_member_contacts (id, member_id, prospect_id)
VALUES
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000015'),
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-000000000016');

INSERT INTO public.prospecting_campaign_actions (id, prospect_id)
VALUES ('00000000-0000-4000-8000-0000000000c7', '00000000-0000-4000-8000-000000000015');

INSERT INTO public.source_lists (id, pull_date, source_file_name)
VALUES ('00000000-0000-4000-8000-0000000000d1', '2026-03-01', 'fictional-household.csv');

INSERT INTO public.source_list_rows (
  id, source_list_id, list_type, county, state, address, prospect_id, status, phones
) VALUES
  (
    '00000000-0000-4000-8000-0000000000d2',
    '00000000-0000-4000-8000-0000000000d1',
    'tax', 'jackson', 'MO', '100 Merge Lane',
    '00000000-0000-4000-8000-000000000002',
    'ready', '{}'
  ),
  (
    '00000000-0000-4000-8000-0000000000d3',
    '00000000-0000-4000-8000-0000000000d1',
    'tax', 'jackson', 'MO', '100 Merge Lane',
    '00000000-0000-4000-8000-000000000001',
    'ready', '{}'
  );

DO $$
DECLARE
  sources uuid[];
  dry jsonb;
  merged jsonb;
  rerun jsonb;
  kept_merged_at timestamptz;
  phone_total bigint;
BEGIN
  SELECT array_agg(id ORDER BY id)
    INTO sources
  FROM public.prospects
  WHERE id <> '00000000-0000-4000-8000-000000000001';

  IF cardinality(sources) <> 19 THEN
    RAISE EXCEPTION 'expected 19 sources, got %', cardinality(sources);
  END IF;

  phone_total := (SELECT count(*) FROM public.prospect_phones);
  dry := public.merge_prospects_v1(
    '00000000-0000-4000-8000-000000000001',
    sources,
    'merge-test'
  );

  IF dry ->> 'dry_run' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'default call must be a dry run';
  END IF;
  IF (dry -> 'counts' ->> 'phones_reponted')::integer <> 39
    OR (dry -> 'counts' ->> 'prospects_merged')::integer <> 19
    OR (dry -> 'counts' ->> 'phones_deleted')::integer <> 0
    OR (dry -> 'counts' ->> 'prospects_deleted')::integer <> 0
  THEN
    RAISE EXCEPTION 'dry run diff %', dry -> 'counts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.prospects
    WHERE id = ANY (sources) AND record_status IS DISTINCT FROM 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.prospect_phones
    WHERE source_prospect_id IS NOT NULL
  ) OR (SELECT count(*) FROM public.prospect_phones) <> phone_total THEN
    RAISE EXCEPTION 'dry run wrote rows';
  END IF;

  merged := public.merge_prospects_v1(
    '00000000-0000-4000-8000-000000000001',
    sources,
    'merge-test',
    false
  );
  IF merged ->> 'dry_run' IS DISTINCT FROM 'false'
    OR merged ->> 'allow_cross_property' IS DISTINCT FROM 'false'
    OR jsonb_array_length(merged -> 'cross_property_overrides') <> 0
    OR (merged -> 'counts' ->> 'phones_reponted')::integer <> 39
    OR (merged -> 'counts' ->> 'prospects_merged')::integer <> 19
    OR (merged -> 'counts' ->> 'phones_deleted')::integer <> 0
    OR (merged -> 'counts' ->> 'leads_reponted')::integer <> 2
    OR (merged -> 'counts' ->> 'campaign_members_reponted')::integer <> 1
    OR (merged -> 'counts' ->> 'campaign_members_left_on_source')::integer <> 1
  THEN
    RAISE EXCEPTION 'merge diff %', merged -> 'counts';
  END IF;
  IF (SELECT count(*) FROM public.prospect_phones) <> phone_total THEN
    RAISE EXCEPTION 'phone rows were deleted';
  END IF;
  IF (SELECT count(*) FROM public.prospects) <> 20 THEN
    RAISE EXCEPTION 'prospect rows were deleted';
  END IF;

  IF (
    SELECT count(*)
    FROM public.prospect_phones
    WHERE right(phone, 4)::integer BETWEEN 1 AND 49
      AND voice_hold IS TRUE
      AND last_disposition = 'dnc'
      AND voice_hold_reason = 'household_dnc'
      AND voice_hold_by = 'Household fixture'
      AND voice_hold_at = '2026-01-15 15:00:00+00'
      AND prospect_id = '00000000-0000-4000-8000-000000000001'
  ) <> 49 THEN
    RAISE EXCEPTION 'household phones were not all kept on hold and dnc';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.prospect_phones AS phone
    JOIN public.prospects AS source ON source.id = phone.source_prospect_id
    WHERE phone.relationship_detail IS DISTINCT FROM source.owner_1_type
  ) THEN
    RAISE EXCEPTION 'relationship_detail was not preserved';
  END IF;

  IF (
    SELECT count(*) FROM public.prospect_phones
    WHERE source_prospect_id IS NULL
      AND right(phone, 4)::integer BETWEEN 1 AND 10
  ) <> 10 THEN
    RAISE EXCEPTION 'survivor phones should keep a null source';
  END IF;

  IF (SELECT count(*) FROM public.prospect_phones WHERE relationship_detail = 'Friend') <> 3
    OR (SELECT count(*) FROM public.prospect_phones WHERE relationship_detail = 'Coworker') <> 4
    OR (SELECT count(*) FROM public.prospect_phones WHERE relationship_detail = 'Past neighbor') <> 3
    OR (SELECT count(*) FROM public.prospect_phones WHERE relationship_detail = 'In-law') <> 2
    OR (SELECT count(*) FROM public.prospect_phones WHERE relationship_detail = 'Landlord') <> 1
    OR (SELECT count(*) FROM public.prospect_phones WHERE relationship_detail = 'Tenant') <> 1
  THEN
    RAISE EXCEPTION 'associate and in-law relationship counts changed';
  END IF;

  IF (SELECT count(*) FROM public.prospects WHERE record_status = 'merged' AND merged_into_id = '00000000-0000-4000-8000-000000000001') <> 19
    OR (SELECT record_status FROM public.prospects WHERE id = '00000000-0000-4000-8000-000000000001') IS DISTINCT FROM 'active'
    OR (SELECT merged_into_id FROM public.prospects WHERE id = '00000000-0000-4000-8000-000000000001') IS NOT NULL
  THEN
    RAISE EXCEPTION 'survivor pointer is wrong';
  END IF;

  IF (SELECT lead_id FROM public.prospects WHERE id = '00000000-0000-4000-8000-000000000001')
      IS DISTINCT FROM '00000000-0000-4000-8000-0000000000aa'
    OR (SELECT lead_id FROM public.prospects WHERE id = '00000000-0000-4000-8000-000000000012') IS NOT NULL
    OR (SELECT prospect_id FROM public.lead_activities WHERE id = '00000000-0000-4000-8000-0000000000ab')
      IS DISTINCT FROM '00000000-0000-4000-8000-000000000001'
    OR (SELECT prospect_id FROM public.work_items WHERE work_item_key = 'activity:00000000-0000-4000-8000-0000000000ab')
      IS DISTINCT FROM '00000000-0000-4000-8000-000000000001'
    OR (SELECT count(*) FROM public.leads) <> 1
  THEN
    RAISE EXCEPTION 'lead was not re-pointed';
  END IF;

  IF (SELECT prospect_id FROM public.prospecting_campaign_members WHERE id = '00000000-0000-4000-8000-0000000000c2')
      IS DISTINCT FROM '00000000-0000-4000-8000-000000000001'
    OR (SELECT status FROM public.prospecting_campaign_members WHERE id = '00000000-0000-4000-8000-0000000000c2') IS DISTINCT FROM 'active'
    OR (SELECT prospect_id FROM public.prospecting_campaign_members WHERE id = '00000000-0000-4000-8000-0000000000c3')
      IS DISTINCT FROM '00000000-0000-4000-8000-000000000016'
    OR (SELECT status FROM public.prospecting_campaign_members WHERE id = '00000000-0000-4000-8000-0000000000c3') IS DISTINCT FROM 'suppressed'
    OR (SELECT suppression_reason FROM public.prospecting_campaign_members WHERE id = '00000000-0000-4000-8000-0000000000c3') IS DISTINCT FROM 'prospect_merged'
    OR (SELECT count(*) FROM public.prospecting_campaign_members) <> 2
    OR (SELECT prospect_id FROM public.prospecting_campaign_member_contacts WHERE id = '00000000-0000-4000-8000-0000000000c6')
      IS DISTINCT FROM '00000000-0000-4000-8000-000000000001'
    OR (SELECT prospect_id FROM public.prospecting_campaign_member_contacts WHERE id = '00000000-0000-4000-8000-0000000000c5')
      IS DISTINCT FROM '00000000-0000-4000-8000-000000000001'
    OR (SELECT prospect_id FROM public.prospecting_campaign_actions WHERE id = '00000000-0000-4000-8000-0000000000c7')
      IS DISTINCT FROM '00000000-0000-4000-8000-000000000001'
  THEN
    RAISE EXCEPTION 'campaign members were not re-pointed without a delete';
  END IF;

  IF (SELECT prospect_id FROM public.source_list_rows WHERE id = '00000000-0000-4000-8000-0000000000d2')
      IS DISTINCT FROM '00000000-0000-4000-8000-000000000002'
    OR (SELECT count(*) FROM public.source_list_dialer_export WHERE prospect_id = '00000000-0000-4000-8000-000000000002') <> 0
    OR (SELECT count(*) FROM public.source_list_dialer_phone_review
        WHERE prospect_id = '00000000-0000-4000-8000-000000000002'
          AND phone_e164 = '+18165550050'
          AND block_reason = 'merged_prospect') <> 1
    OR (SELECT count(*) FROM public.source_list_dialer_export
        WHERE prospect_id = '00000000-0000-4000-8000-000000000001'
          AND phone_e164 = '+18165550050') <> 1
    OR (SELECT count(*) FROM public.source_list_dialer_suppressed
        WHERE prospect_id = '00000000-0000-4000-8000-000000000002'
          AND block_reason = 'merged_prospect') <> 50
  THEN
    RAISE EXCEPTION 'merged prospects are still dialable or phones did not resolve';
  END IF;

  SELECT prospect.merged_at INTO kept_merged_at
  FROM public.prospects AS prospect
  WHERE prospect.id = '00000000-0000-4000-8000-000000000002';

  rerun := public.merge_prospects_v1(
    '00000000-0000-4000-8000-000000000001',
    sources,
    'merge-test',
    false
  );
  IF (rerun -> 'counts' ->> 'phones_reponted')::integer <> 0
    OR (rerun -> 'counts' ->> 'prospects_merged')::integer <> 0
    OR (rerun -> 'counts' ->> 'phones_deleted')::integer <> 0
    OR (rerun -> 'counts' ->> 'leads_reponted')::integer <> 0
    OR (SELECT prospect.merged_at FROM public.prospects AS prospect WHERE prospect.id = '00000000-0000-4000-8000-000000000002') IS DISTINCT FROM kept_merged_at
    OR (SELECT count(*) FROM public.prospect_phones WHERE right(phone, 4)::integer BETWEEN 1 AND 49 AND voice_hold IS TRUE AND last_disposition = 'dnc') <> 49
  THEN
    RAISE EXCEPTION 're-run was not idempotent: %', rerun -> 'counts';
  END IF;
END $$;

DO $$
BEGIN
  INSERT INTO public.prospects (id, county, parcel_id, owner_1, owner_1_type, situs_street, situs_zip)
  VALUES (
    '00000000-0000-4000-8000-0000000000e1',
    'jackson', 'FIXTURE-PARCEL-100', 'Fresh Owner', 'Owner', '100 Merge Lane', '64105'
  );
  BEGIN
    PERFORM public.merge_prospects_v1(
      '00000000-0000-4000-8000-000000000002',
      ARRAY['00000000-0000-4000-8000-0000000000e1']::uuid[],
      'merge-test',
      false
    );
    RAISE EXCEPTION 'merge into a merged target was allowed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM IS DISTINCT FROM 'prospect_merge_target_merged' THEN
        RAISE;
      END IF;
  END;
  IF (SELECT record_status FROM public.prospects WHERE id = '00000000-0000-4000-8000-0000000000e1') IS DISTINCT FROM 'active'
    OR (SELECT record_status FROM public.prospects WHERE id = '00000000-0000-4000-8000-000000000002') IS DISTINCT FROM 'merged'
    OR (SELECT merged_into_id FROM public.prospects WHERE id = '00000000-0000-4000-8000-000000000002')
      IS DISTINCT FROM '00000000-0000-4000-8000-000000000001'
  THEN
    RAISE EXCEPTION 'refused merge changed rows';
  END IF;
END $$;

DO $$
DECLARE
  result jsonb;
BEGIN
  INSERT INTO public.prospects (id, county, parcel_id, owner_1, owner_1_type, situs_street, situs_zip) VALUES
    ('00000000-0000-4000-8000-0000000000f1', 'jackson', 'FIXTURE-PARCEL-200', 'Associate Target', 'Owner', '200 Merge Lane', '64106'),
    ('00000000-0000-4000-8000-0000000000f2', 'jackson', 'FIXTURE-PARCEL-200', 'Associate Friend', 'Friend', '200 Merge Lane', '64106');
  INSERT INTO public.prospect_phones (
    id, prospect_id, phone, voice_hold, voice_hold_reason, voice_hold_at, voice_hold_by, last_disposition
  ) VALUES
    (
      '00000000-0000-4000-8100-000000000061',
      '00000000-0000-4000-8000-0000000000f2',
      '+18165550061',
      false, NULL, NULL, NULL, 'no_answer'
    ),
    (
      '00000000-0000-4000-8100-000000000062',
      '00000000-0000-4000-8000-0000000000f2',
      '+18165550062',
      true, 'keep-me', '2026-03-01 12:00:00+00', 'Original', 'take_me_off'
    );
  result := public.merge_prospects_v1(
    '00000000-0000-4000-8000-0000000000f1',
    ARRAY['00000000-0000-4000-8000-0000000000f2']::uuid[],
    'merge-test',
    false
  );
  IF (result -> 'counts' ->> 'phones_deleted')::integer <> 0 THEN
    RAISE EXCEPTION 'associate merge deleted phones';
  END IF;
  IF (SELECT voice_hold FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000061') IS NOT TRUE
    OR (SELECT last_disposition FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000061') IS DISTINCT FROM 'no_answer'
    OR (SELECT voice_hold_reason FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000061') IS DISTINCT FROM 'associate_relationship'
    OR (SELECT relationship_detail FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000061') IS DISTINCT FROM 'Friend'
    OR (SELECT voice_hold FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000062') IS NOT TRUE
    OR (SELECT voice_hold_reason FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000062') IS DISTINCT FROM 'keep-me'
    OR (SELECT voice_hold_by FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000062') IS DISTINCT FROM 'Original'
    OR (SELECT voice_hold_at FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000062') IS DISTINCT FROM '2026-03-01 12:00:00+00'::timestamptz
    OR (SELECT last_disposition FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000062') IS DISTINCT FROM 'take_me_off'
  THEN
    RAISE EXCEPTION 'associate hold or protected label changed';
  END IF;
END $$;

DO $$
BEGIN
  IF public.prospect_disposition_protected_v1('dnc') IS NOT TRUE
    OR public.prospect_disposition_protected_v1('Do Not Call') IS NOT TRUE
    OR public.prospect_disposition_protected_v1('dnc_contact') IS NOT TRUE
    OR public.prospect_disposition_protected_v1('dnc_number') IS NOT TRUE
    OR public.prospect_disposition_protected_v1('take_me_off') IS NOT TRUE
    OR public.prospect_disposition_protected_v1('dead') IS NOT TRUE
    OR public.prospect_disposition_protected_v1('no_answer') IS NOT FALSE
    OR public.prospect_associate_relationship_v1('Friend') IS NOT TRUE
    OR public.prospect_associate_relationship_v1('Coworker') IS NOT TRUE
    OR public.prospect_associate_relationship_v1('Neighbor') IS NOT TRUE
    OR public.prospect_associate_relationship_v1('Past neighbor') IS NOT TRUE
    OR public.prospect_associate_relationship_v1('Past-neighbor') IS NOT TRUE
    OR public.prospect_associate_relationship_v1('Landlord') IS NOT TRUE
    OR public.prospect_associate_relationship_v1('Tenant') IS NOT TRUE
    OR public.prospect_associate_relationship_v1('In-law') IS NOT FALSE
  THEN
    RAISE EXCEPTION 'never-downgrade or associate set is wrong';
  END IF;

  CREATE OR REPLACE FUNCTION public.dialer_suppression_class_v1(p_source text, p_label text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  AS $fn$
    SELECT CASE
      WHEN p_source = 'never_downgrade' AND lower(btrim(coalesce(p_label, ''))) = 'custom_hold' THEN 'protected'
      ELSE NULL
    END
  $fn$;

  IF public.prospect_disposition_protected_v1('custom_hold') IS NOT TRUE
    OR public.prospect_disposition_protected_v1('dnc') IS NOT FALSE
  THEN
    RAISE EXCEPTION 'merge did not defer to dialer_suppression_class_v1';
  END IF;

  DROP FUNCTION public.dialer_suppression_class_v1(text, text);
END $$;

DO $$
DECLARE
  chain jsonb;
BEGIN
  INSERT INTO public.prospects (id, county, parcel_id, owner_1, owner_1_type, situs_street, situs_zip) VALUES
    ('00000000-0000-4000-8000-0000000000a1', 'jackson', 'FIXTURE-PARCEL-300', 'Chain Source', 'Sibling', '300 Merge Lane', '64108'),
    ('00000000-0000-4000-8000-0000000000a2', 'jackson', 'FIXTURE-PARCEL-300', 'Chain Middle', 'Owner', '300 Merge Lane', '64108'),
    ('00000000-0000-4000-8000-0000000000a3', 'jackson', 'FIXTURE-PARCEL-300', 'Chain Survivor', 'Owner', '300 Merge Lane', '64108');
  INSERT INTO public.prospect_phones (
    id, prospect_id, phone, voice_hold, voice_hold_reason, voice_hold_at, voice_hold_by, last_disposition
  ) VALUES (
    '00000000-0000-4000-8100-000000000081',
    '00000000-0000-4000-8000-0000000000a1',
    '+18165550081',
    true, 'chain_dnc', '2026-04-01 12:00:00+00', 'Chain', 'dnc'
  );
  PERFORM public.merge_prospects_v1(
    '00000000-0000-4000-8000-0000000000a2',
    ARRAY['00000000-0000-4000-8000-0000000000a1']::uuid[],
    'merge-test', false
  );
  chain := public.merge_prospects_v1(
    '00000000-0000-4000-8000-0000000000a3',
    ARRAY['00000000-0000-4000-8000-0000000000a2']::uuid[],
    'merge-test', false
  );
  IF public.prospect_dial_subject_id_v1('00000000-0000-4000-8000-0000000000a1')
      IS DISTINCT FROM '00000000-0000-4000-8000-0000000000a3'
    OR (SELECT prospect_id FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000081')
      IS DISTINCT FROM '00000000-0000-4000-8000-0000000000a3'
    OR (SELECT source_prospect_id FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000081')
      IS DISTINCT FROM '00000000-0000-4000-8000-0000000000a1'
    OR (SELECT relationship_detail FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000081') IS DISTINCT FROM 'Sibling'
    OR (SELECT voice_hold_reason FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000081') IS DISTINCT FROM 'chain_dnc'
    OR (SELECT last_disposition FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000081') IS DISTINCT FROM 'dnc'
    OR (chain -> 'counts' ->> 'phones_deleted')::integer <> 0
  THEN
    RAISE EXCEPTION 'merge chain did not keep the phone on the survivor';
  END IF;

  IF (
    SELECT count(*)
    FROM public.prospect_phones
    WHERE right(phone, 4)::integer BETWEEN 1 AND 49
      AND voice_hold IS TRUE
      AND last_disposition = 'dnc'
      AND voice_hold_by = 'Household fixture'
      AND relationship_detail IS NOT DISTINCT FROM (
        SELECT owner_1_type FROM public.prospects WHERE id = prospect_phones.source_prospect_id
      )
  ) <> 49 THEN
    RAISE EXCEPTION 'later merges changed the household phones';
  END IF;
END $$;

DO $$
DECLARE
  refused boolean := false;
  same_property jsonb;
  overridden jsonb;
BEGIN
  INSERT INTO public.prospects (id, county, parcel_id, owner_1, owner_1_type, situs_street, situs_zip) VALUES
    ('00000000-0000-4000-8000-000000000101', 'jackson', 'PARCEL-A', 'West Owner', 'Owner', '500 Other Road', '64101'),
    ('00000000-0000-4000-8000-000000000102', 'jackson', 'PARCEL-B', 'East Owner', 'Owner', '500 Other Road', '64101');
  BEGIN
    PERFORM public.merge_prospects_v1(
      '00000000-0000-4000-8000-000000000101',
      ARRAY['00000000-0000-4000-8000-000000000102']::uuid[],
      'merge-test',
      false,
      false
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM IS DISTINCT FROM 'prospect_merge_cross_property' THEN
        RAISE;
      END IF;
      refused := true;
  END;
  IF NOT refused
    OR (SELECT record_status FROM public.prospects WHERE id = '00000000-0000-4000-8000-000000000102') IS DISTINCT FROM 'active'
  THEN
    RAISE EXCEPTION 'cross-property merge was not refused';
  END IF;

  INSERT INTO public.prospects (id, county, parcel_id, owner_1, owner_1_type, situs_street, situs_zip) VALUES
    ('00000000-0000-4000-8000-000000000103', 'jackson', NULL, 'Address Target', 'Owner', '500 Same Street', '64111'),
    ('00000000-0000-4000-8000-000000000104', 'Jackson', NULL, 'Address Source', 'Owner', '500  same street', '64111-1234'),
    ('00000000-0000-4000-8000-000000000105', 'jackson', 'PARCEL-SAME', 'Parcel Target', 'Owner', '1 First', '64102'),
    ('00000000-0000-4000-8000-000000000106', 'clay', 'parcel same', 'Parcel Source', 'Owner', '99 Different', '64000');
  same_property := public.merge_prospects_v1(
    '00000000-0000-4000-8000-000000000103',
    ARRAY['00000000-0000-4000-8000-000000000104']::uuid[],
    'merge-test',
    false
  );
  PERFORM public.merge_prospects_v1(
    '00000000-0000-4000-8000-000000000105',
    ARRAY['00000000-0000-4000-8000-000000000106']::uuid[],
    'merge-test',
    false
  );
  IF same_property ->> 'allow_cross_property' IS DISTINCT FROM 'false'
    OR (SELECT record_status FROM public.prospects WHERE id = '00000000-0000-4000-8000-000000000104') IS DISTINCT FROM 'merged'
    OR (SELECT record_status FROM public.prospects WHERE id = '00000000-0000-4000-8000-000000000106') IS DISTINCT FROM 'merged'
  THEN
    RAISE EXCEPTION 'same-property merge was refused';
  END IF;

  INSERT INTO public.prospects (id, county, parcel_id, owner_1, owner_1_type, situs_street, situs_zip) VALUES
    ('00000000-0000-4000-8000-000000000107', 'jackson', 'PARCEL-C', 'Override Target', 'Owner', '9 Override', '64103'),
    ('00000000-0000-4000-8000-000000000108', 'clay', 'PARCEL-D', 'Override Source', 'Owner', '8 Elsewhere', '64001');
  overridden := public.merge_prospects_v1(
    '00000000-0000-4000-8000-000000000107',
    ARRAY['00000000-0000-4000-8000-000000000108']::uuid[],
    'merge-test',
    false,
    true
  );
  IF overridden ->> 'allow_cross_property' IS DISTINCT FROM 'true'
    OR NOT (overridden -> 'cross_property_overrides') @> '[{"source_id":"00000000-0000-4000-8000-000000000108"}]'::jsonb
    OR (SELECT merged_into_id FROM public.prospects WHERE id = '00000000-0000-4000-8000-000000000108')
      IS DISTINCT FROM '00000000-0000-4000-8000-000000000107'
  THEN
    RAISE EXCEPTION 'cross-property override was not logged: %', overridden -> 'cross_property_overrides';
  END IF;
END $$;

DO $$
DECLARE
  result jsonb;
BEGIN
  INSERT INTO public.prospects (id, county, parcel_id, owner_1, owner_1_type, situs_street, situs_zip) VALUES
    ('00000000-0000-4000-8000-000000000111', 'jackson', 'FIXTURE-PARCEL-400', 'Exc Target', 'Owner', '400 Exc Lane', '64104'),
    ('00000000-0000-4000-8000-000000000112', 'jackson', 'FIXTURE-PARCEL-400', 'Exc Source', 'Owner', '400 Exc Lane', '64104');
  INSERT INTO public.prospect_phones (
    id, prospect_id, phone, relationship, relationship_detail, voice_hold, last_disposition
  ) VALUES
    ('00000000-0000-4000-8100-000000000201', '00000000-0000-4000-8000-000000000112', '+18165550201', 'Other Relative', 'Other Relative', false, 'no_answer'),
    ('00000000-0000-4000-8100-000000000202', '00000000-0000-4000-8000-000000000112', '+18165550202', NULL, 'Unknown', false, 'no_answer'),
    ('00000000-0000-4000-8100-000000000203', '00000000-0000-4000-8000-000000000112', '+18165550203', 'entity_contact', NULL, false, 'no_answer'),
    ('00000000-0000-4000-8100-000000000204', '00000000-0000-4000-8000-000000000112', '+18165550204', 'entity_contact', 'officer', false, 'no_answer'),
    ('00000000-0000-4000-8100-000000000205', '00000000-0000-4000-8000-000000000112', '+18165550205', 'relationship_unknown', NULL, false, 'no_answer'),
    ('00000000-0000-4000-8100-000000000206', '00000000-0000-4000-8000-000000000112', '+18165550206', 'owner', 'Unknown', false, 'no_answer'),
    ('00000000-0000-4000-8100-000000000207', '00000000-0000-4000-8000-000000000112', '+18165550207', 'Friend', 'school friend', false, 'no_answer'),
    ('00000000-0000-4000-8100-000000000208', '00000000-0000-4000-8000-000000000112', '+18165550208', 'member', 'entity_contact', false, 'no_answer');
  result := public.merge_prospects_v1(
    '00000000-0000-4000-8000-000000000111',
    ARRAY['00000000-0000-4000-8000-000000000112']::uuid[],
    'merge-test',
    false
  );
  IF (result -> 'counts' ->> 'phones_deleted')::integer <> 0 THEN
    RAISE EXCEPTION 'exc-002 merge deleted phones';
  END IF;
  IF (SELECT voice_hold FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000201') IS NOT FALSE
    OR (SELECT relationship FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000201') IS DISTINCT FROM 'Other Relative'
    OR (SELECT voice_hold FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000202') IS NOT TRUE
    OR (SELECT voice_hold_reason FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000202') IS DISTINCT FROM 'relationship_unknown'
    OR (SELECT relationship_detail FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000202') IS DISTINCT FROM 'Unknown'
    OR (SELECT voice_hold FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000203') IS NOT TRUE
    OR (SELECT voice_hold_reason FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000203') IS DISTINCT FROM 'entity_contact'
    OR (SELECT relationship FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000203') IS DISTINCT FROM 'entity_contact'
    OR (SELECT voice_hold FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000204') IS NOT FALSE
    OR (SELECT relationship_detail FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000204') IS DISTINCT FROM 'officer'
    OR (SELECT voice_hold FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000205') IS NOT TRUE
    OR (SELECT voice_hold_reason FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000205') IS DISTINCT FROM 'relationship_unknown'
    OR (SELECT voice_hold FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000206') IS NOT FALSE
    OR (SELECT relationship FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000206') IS DISTINCT FROM 'owner'
    OR (SELECT voice_hold FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000207') IS NOT TRUE
    OR (SELECT voice_hold_reason FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000207') IS DISTINCT FROM 'associate_relationship'
    OR (SELECT relationship_detail FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000207') IS DISTINCT FROM 'school friend'
    OR (SELECT voice_hold FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000208') IS NOT FALSE
    OR (SELECT relationship FROM public.prospect_phones WHERE id = '00000000-0000-4000-8100-000000000208') IS DISTINCT FROM 'member'
  THEN
    RAISE EXCEPTION 'exc-002 voice hold set is wrong';
  END IF;
END $$;

DO $$
DECLARE
  view_sql text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'source_list_dialer_phone_review'
      AND column_name = 'line_check_flag'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'source_list_dialer_phone_review'
      AND column_name = 'requires_licensee_disclosure'
  ) THEN
    RAISE EXCEPTION 'review view lost stacked columns';
  END IF;
  view_sql := pg_get_viewdef('public.source_list_dialer_phone_review'::regclass, true);
  IF view_sql NOT LIKE '%prospect_dial_subject_id_v1%'
    OR view_sql NOT LIKE '%merged_prospect%'
    OR view_sql NOT LIKE '%source_list_phone_block_reason_v1(phone_value, prospect_id)%'
    OR view_sql NOT LIKE '%line_check_flag%'
  THEN
    RAISE EXCEPTION 'review view patch missed the stack-safe markers: %', view_sql;
  END IF;

  EXECUTE $view$
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
      public.source_list_phone_block_reason_v1(dialed.phone_value, dialed.prospect_id) AS block_reason,
      NULL::text AS line_check_flag,
      false AS requires_licensee_disclosure,
      'stacked'::text AS basis
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
    ) AS dialed
  $view$;
  PERFORM public.prospect_merge_patch_review_view_v1();
  view_sql := pg_get_viewdef('public.source_list_dialer_phone_review'::regclass, true);
  IF view_sql NOT LIKE '%line_check_flag%'
    OR view_sql NOT LIKE '%requires_licensee_disclosure%'
    OR view_sql NOT LIKE '%basis%'
    OR view_sql NOT LIKE '%prospect_dial_subject_id_v1%'
    OR view_sql NOT LIKE '%merged_prospect%'
    OR view_sql NOT LIKE '%source_list_phone_block_reason_v1(%'
  THEN
    RAISE EXCEPTION 're-patch dropped stacked columns: %', view_sql;
  END IF;
  IF (
    SELECT block_reason
    FROM public.source_list_dialer_phone_review
    WHERE prospect_id = '00000000-0000-4000-8000-000000000002'
      AND phone_value = '+18165550050'
  ) IS DISTINCT FROM 'merged_prospect' THEN
    RAISE EXCEPTION 're-patched view did not block the merged prospect';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE public.prospects
    SET merged_into_id = id
    WHERE id = '00000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'self merge check did not fire';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
  BEGIN
    UPDATE public.prospects
    SET record_status = 'archived'
    WHERE id = '00000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'record_status check did not fire';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END $$;
