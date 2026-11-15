-- Pat 4f: owner-line release requires owner_1_type person, unless the owner
-- name is a clean first and last with no company word.
-- Pat 4g: a middle-name or co-owner release also requires relationship owner,
-- verified_source dataskip_run* or smartskip_*, and is_skip_traced.
-- Does not read or write mojo_call_queue. Does not recreate the export batch.

DROP FUNCTION IF EXISTS public.dialer_owner_line_release_v1(text, text, text, text, boolean, text);

CREATE OR REPLACE FUNCTION public.dialer_owner_line_release_v1(
  p_relationship text,
  p_contact_name text,
  p_owner_name text,
  p_owner_last text,
  p_skip_traced boolean,
  p_verified_source text,
  p_owner_type text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  owner_name text := btrim(coalesce(p_owner_name, ''));
  contact_name text := btrim(coalesce(p_contact_name, ''));
  rel text := regexp_replace(lower(btrim(coalesce(p_relationship, ''))), '[[:space:]-]+', '_', 'g');
  contact_key text := regexp_replace(lower(btrim(coalesce(p_contact_name, ''))), '[[:space:]-]+', '_', 'g');
  owner_text text;
  contact_text text;
  skip_hit boolean;
  line_tokens text[];
  hint_tokens text[];
  hint text;
  segments text[];
  segment text;
  words text[];
  stripped text[];
  non_initial text[];
  rest text[];
  first_words text[];
  county boolean;
  people jsonb := '[]'::jsonb;
  person jsonb;
  middles text[];
  first_name text;
  last_name text;
  carried text;
  upcoming text;
  contact_tokens text[];
  contact_given text[];
  contact_first text;
  contact_last text;
  person_last text;
  person_first text;
  middle text;
  parts text[];
  i integer;
  n integer;
  trustee_at integer;
  force_last_first boolean;
  matched boolean;
  owner_type text;
  clean_tokens text[];
  o3_ok boolean;
  primary_index integer;
  contact_middles text[] := ARRAY[]::text[];
  person_full_middles text[];
  j integer;
BEGIN
  IF rel = 'registered_agent'
    OR contact_key = 'registered_agent'
    OR contact_key LIKE '%registered_agent%' THEN
    RETURN false;
  END IF;
  IF owner_name = '' OR contact_name = '' THEN
    RETURN false;
  END IF;

  owner_text := lower(regexp_replace(owner_name, '[[:space:]]+', ' ', 'g'));
  contact_text := lower(regexp_replace(contact_name, '[[:space:]]+', ' ', 'g'));
  IF owner_text ~ '\met[[:space:]]+al\M'
    OR owner_text ~ '\mheirs[[:space:]]+of\M'
    OR owner_text ~ '\mestate[[:space:]]+of\M'
    OR owner_text ~ '\mdeceased\M'
    OR owner_text ~ '\mc[[:space:]]*/[[:space:]]*o\M'
    OR contact_text ~ '\met[[:space:]]+al\M'
    OR contact_text ~ '\mheirs[[:space:]]+of\M'
    OR contact_text ~ '\mestate[[:space:]]+of\M'
    OR contact_text ~ '\mdeceased\M'
    OR contact_text ~ '\mc[[:space:]]*/[[:space:]]*o\M' THEN
    RETURN false;
  END IF;

  owner_type := nullif(lower(btrim(coalesce(p_owner_type, ''))), '');
  IF owner_type IS DISTINCT FROM 'person' THEN
    IF owner_type IS NOT NULL THEN
      RETURN false;
    END IF;
    IF position('&' IN owner_name) > 0 OR position(',' IN owner_name) > 0
      OR owner_text ~ '\met[[:space:]]+al\M'
      OR owner_text ~ '\mheirs[[:space:]]+of\M'
      OR owner_text ~ '\mestate[[:space:]]+of\M'
      OR owner_text ~ '\mdeceased\M'
      OR owner_text ~ '\mc[[:space:]]*/[[:space:]]*o\M' THEN
      RETURN false;
    END IF;
    clean_tokens := public.dialer_owner_line_tokens_v1(owner_name);
    n := coalesce(cardinality(clean_tokens), 0);
    WHILE n > 1 AND clean_tokens[n] = ANY (ARRAY['jr', 'sr', 'ii', 'iii', 'iv', 'junior', 'senior']) LOOP
      clean_tokens := clean_tokens[1:n - 1];
      n := n - 1;
    END LOOP;
    IF coalesce(cardinality(clean_tokens), 0) <> 2
      OR EXISTS (
        SELECT 1 FROM unnest(clean_tokens) AS token
        WHERE length(token) = 1
          OR token = ANY (ARRAY['llc', 'inc', 'incorporated', 'corp', 'corporation', 'trust', 'bank', 'company', 'llp', 'pllc', 'lp'])
          OR token IN ('trustee', 'trustees')
          OR token LIKE '%-trustee'
          OR token LIKE '%-trustees'
      ) THEN
      RETURN false;
    END IF;
  END IF;

  o3_ok := rel = 'owner'
    AND coalesce(p_skip_traced, false)
    AND (
      lower(btrim(coalesce(p_verified_source, ''))) ~ '^dataskip_run'
      OR lower(btrim(coalesce(p_verified_source, ''))) ~ '^smartskip_'
    );

  skip_hit := coalesce(p_skip_traced, false)
    OR position('skip' IN lower(coalesce(p_verified_source, ''))) > 0;
  line_tokens := public.dialer_owner_line_tokens_v1(owner_name);
  hint_tokens := public.dialer_owner_line_tokens_v1(p_owner_last);
  n := coalesce(cardinality(hint_tokens), 0);
  WHILE n > 1 AND hint_tokens[n] = ANY (ARRAY['jr', 'sr', 'ii', 'iii', 'iv', 'junior', 'senior']) LOOP
    hint_tokens := hint_tokens[1:n - 1];
    n := n - 1;
  END LOOP;
  hint := NULL;
  IF coalesce(cardinality(hint_tokens), 0) > 0 THEN
    hint := hint_tokens[cardinality(hint_tokens)];
    IF hint IS NULL
      OR length(hint) = 1
      OR hint = ANY (ARRAY['llc', 'inc', 'incorporated', 'corp', 'corporation', 'trust', 'bank', 'company', 'llp', 'pllc', 'lp'])
      OR NOT hint = ANY (line_tokens) THEN
      hint := NULL;
    END IF;
  END IF;

  SELECT coalesce(array_agg(part ORDER BY ordinal), ARRAY[]::text[])
  INTO segments
  FROM (
    SELECT btrim(raw_part) AS part, ordinality AS ordinal
    FROM unnest(string_to_array(owner_name, '&')) WITH ORDINALITY AS split(raw_part, ordinality)
    WHERE btrim(raw_part) <> ''
  ) AS split_parts;

  IF coalesce(cardinality(segments), 0) = 0 THEN
    RETURN false;
  END IF;

  first_words := public.dialer_owner_line_tokens_v1(segments[1]);
  trustee_at := 0;
  FOR i IN 1..coalesce(cardinality(first_words), 0) LOOP
    IF first_words[i] IN ('trustee', 'trustees')
      OR first_words[i] LIKE '%-trustee'
      OR first_words[i] LIKE '%-trustees' THEN
      trustee_at := i;
      EXIT;
    END IF;
  END LOOP;
  IF trustee_at > 0 THEN
    first_words := CASE WHEN trustee_at = 1 THEN ARRAY[]::text[] ELSE first_words[1:trustee_at - 1] END;
  END IF;
  n := coalesce(cardinality(first_words), 0);
  WHILE n > 1 AND first_words[n] = ANY (ARRAY['jr', 'sr', 'ii', 'iii', 'iv', 'junior', 'senior']) LOOP
    first_words := first_words[1:n - 1];
    n := n - 1;
  END LOOP;

  county := false;
  IF coalesce(cardinality(first_words), 0) > 0 THEN
    county := (hint IS NOT NULL AND first_words[1] = hint)
      OR (
        cardinality(first_words) >= 3
        AND length(first_words[cardinality(first_words)]) = 1
        AND length(first_words[1]) > 1
      );
  END IF;

  FOREACH segment IN ARRAY segments LOOP
    words := public.dialer_owner_line_tokens_v1(segment);
    IF EXISTS (
      SELECT 1 FROM unnest(words) AS token
      WHERE token = ANY (ARRAY['llc', 'inc', 'incorporated', 'corp', 'corporation', 'trust', 'bank', 'company', 'llp', 'pllc', 'lp'])
    ) AND NOT EXISTS (
      SELECT 1 FROM unnest(words) AS token
      WHERE token IN ('trustee', 'trustees') OR token LIKE '%-trustee' OR token LIKE '%-trustees'
    ) THEN
      CONTINUE;
    END IF;

    trustee_at := 0;
    FOR i IN 1..coalesce(cardinality(words), 0) LOOP
      IF words[i] IN ('trustee', 'trustees') OR words[i] LIKE '%-trustee' OR words[i] LIKE '%-trustees' THEN
        trustee_at := i;
        EXIT;
      END IF;
    END LOOP;
    IF trustee_at > 0 THEN
      words := CASE WHEN trustee_at = 1 THEN ARRAY[]::text[] ELSE words[1:trustee_at - 1] END;
    END IF;
    IF coalesce(cardinality(words), 0) = 0 THEN
      CONTINUE;
    END IF;

    first_name := NULL;
    last_name := NULL;
    middles := ARRAY[]::text[];
    stripped := words;
    n := coalesce(cardinality(stripped), 0);
    WHILE n > 1 AND stripped[n] = ANY (ARRAY['jr', 'sr', 'ii', 'iii', 'iv', 'junior', 'senior']) LOOP
      stripped := stripped[1:n - 1];
      n := n - 1;
    END LOOP;

    SELECT coalesce(array_agg(token ORDER BY ordinal), ARRAY[]::text[])
    INTO non_initial
    FROM unnest(stripped) WITH ORDINALITY AS parsed(token, ordinal)
    WHERE length(token) > 1;

    IF coalesce(cardinality(non_initial), 0) = 0 THEN
      CONTINUE;
    END IF;

    IF county THEN
      IF cardinality(non_initial) = 1 OR length(stripped[1]) = 1 THEN
        first_name := non_initial[1];
        SELECT coalesce(array_agg(token ORDER BY ordinal), ARRAY[]::text[])
        INTO middles
        FROM unnest(stripped) WITH ORDINALITY AS parsed(token, ordinal)
        WHERE token IS DISTINCT FROM first_name;
        people := people || jsonb_build_array(jsonb_build_object('first', first_name, 'middles', to_jsonb(middles), 'last', NULL));
      ELSE
        force_last_first := (hint IS NOT NULL AND stripped[1] = hint)
          OR cardinality(non_initial) >= 3
          OR EXISTS (SELECT 1 FROM unnest(stripped) AS token WHERE length(token) = 1);
        IF force_last_first AND length(stripped[1]) > 1 THEN
          last_name := stripped[1];
          rest := stripped[2:cardinality(stripped)];
          SELECT token INTO first_name
          FROM unnest(rest) WITH ORDINALITY AS parsed(token, ordinal)
          WHERE length(token) > 1
          ORDER BY ordinal
          LIMIT 1;
          IF first_name IS NOT NULL THEN
            SELECT coalesce(array_agg(token ORDER BY ordinal), ARRAY[]::text[])
            INTO middles
            FROM unnest(rest) WITH ORDINALITY AS parsed(token, ordinal)
            WHERE token IS DISTINCT FROM first_name;
            people := people || jsonb_build_array(jsonb_build_object('first', first_name, 'middles', to_jsonb(middles), 'last', last_name));
          END IF;
        ELSE
          SELECT coalesce(array_agg(token ORDER BY ordinal), ARRAY[]::text[])
          INTO middles
          FROM unnest(stripped[2:cardinality(stripped)]) WITH ORDINALITY AS parsed(token, ordinal);
          people := people || jsonb_build_array(
            jsonb_build_object('first', stripped[1], 'middles', to_jsonb(coalesce(middles, ARRAY[]::text[])), 'last', NULL),
            jsonb_build_object('first', stripped[2], 'middles', '[]'::jsonb, 'last', stripped[1])
          );
        END IF;
      END IF;
    ELSE
      IF cardinality(non_initial) = 1 THEN
        first_name := non_initial[1];
        SELECT coalesce(array_agg(token ORDER BY ordinal), ARRAY[]::text[])
        INTO middles
        FROM unnest(stripped) WITH ORDINALITY AS parsed(token, ordinal)
        WHERE length(token) = 1;
        people := people || jsonb_build_array(jsonb_build_object('first', first_name, 'middles', to_jsonb(middles), 'last', NULL));
      ELSE
        last_name := non_initial[cardinality(non_initial)];
        first_name := non_initial[1];
        SELECT coalesce(array_agg(token ORDER BY ordinal), ARRAY[]::text[])
        INTO middles
        FROM (
          SELECT token, ordinal FROM unnest(non_initial) WITH ORDINALITY AS parsed(token, ordinal)
          WHERE ordinal > 1 AND ordinal < cardinality(non_initial)
          UNION ALL
          SELECT token, 1000 + ordinal FROM unnest(stripped) WITH ORDINALITY AS parsed(token, ordinal)
          WHERE length(token) = 1
        ) AS middle_tokens;
        people := people || jsonb_build_array(jsonb_build_object('first', first_name, 'middles', to_jsonb(coalesce(middles, ARRAY[]::text[])), 'last', last_name));
      END IF;
    END IF;
  END LOOP;

  carried := NULL;
  FOR i IN 0..jsonb_array_length(people) - 1 LOOP
    person := people -> i;
    IF nullif(person->>'last', '') IS NOT NULL THEN
      carried := person->>'last';
    ELSIF carried IS NOT NULL THEN
      people := jsonb_set(people, ARRAY[i::text, 'last'], to_jsonb(carried));
    END IF;
  END LOOP;
  upcoming := NULL;
  FOR i IN REVERSE jsonb_array_length(people) - 1..0 LOOP
    person := people -> i;
    IF nullif(person->>'last', '') IS NOT NULL THEN
      upcoming := person->>'last';
    ELSIF upcoming IS NOT NULL THEN
      people := jsonb_set(people, ARRAY[i::text, 'last'], to_jsonb(upcoming));
    END IF;
  END LOOP;

  contact_tokens := public.dialer_owner_line_tokens_v1(contact_name);
  n := coalesce(cardinality(contact_tokens), 0);
  WHILE n > 1 AND contact_tokens[n] = ANY (ARRAY['jr', 'sr', 'ii', 'iii', 'iv', 'junior', 'senior']) LOOP
    contact_tokens := contact_tokens[1:n - 1];
    n := n - 1;
  END LOOP;
  IF coalesce(cardinality(contact_tokens), 0) < 2 THEN
    RETURN false;
  END IF;
  contact_last := contact_tokens[cardinality(contact_tokens)];
  IF contact_last IS NULL OR length(contact_last) = 1 THEN
    RETURN false;
  END IF;
  SELECT coalesce(array_agg(token ORDER BY ordinal), ARRAY[]::text[])
  INTO contact_given
  FROM unnest(contact_tokens[1:cardinality(contact_tokens) - 1]) WITH ORDINALITY AS parsed(token, ordinal)
  WHERE length(token) > 1;
  IF coalesce(cardinality(contact_given), 0) = 0 THEN
    RETURN false;
  END IF;
  contact_first := contact_given[1];

  IF coalesce(cardinality(contact_given), 0) > 1 THEN
    contact_middles := contact_given[2:cardinality(contact_given)];
  END IF;
  primary_index := NULL;
  FOR j IN 0..jsonb_array_length(people) - 1 LOOP
    IF nullif((people -> j)->>'last', '') IS NOT NULL THEN
      primary_index := j;
      EXIT;
    END IF;
  END LOOP;

  FOR i IN 0..jsonb_array_length(people) - 1 LOOP
    person := people -> i;
    person_last := nullif(person->>'last', '');
    person_first := nullif(person->>'first', '');
    IF person_last IS NULL OR person_first IS NULL THEN
      CONTINUE;
    END IF;
    matched := person_last = contact_last;
    IF NOT matched AND position('-' IN person_last) > 0 THEN
      parts := string_to_array(person_last, '-');
      matched := cardinality(parts) >= 2
        AND cardinality(contact_tokens) >= cardinality(parts)
        AND contact_tokens[cardinality(contact_tokens) - cardinality(parts) + 1:cardinality(contact_tokens)] = parts;
    END IF;
    IF NOT matched THEN
      CONTINUE;
    END IF;
    IF person_first = contact_first OR EXISTS (
      SELECT 1
      FROM (VALUES
        ('bill', 'william'), ('billy', 'william'), ('will', 'william'),
        ('bob', 'robert'), ('rob', 'robert'), ('bobby', 'robert'),
        ('liz', 'elizabeth'), ('beth', 'elizabeth'), ('betty', 'elizabeth'),
        ('jim', 'james'), ('jimmy', 'james'),
        ('joe', 'joseph'), ('joey', 'joseph'),
        ('tom', 'thomas'), ('tommy', 'thomas'),
        ('mike', 'michael'),
        ('dave', 'david'),
        ('dan', 'daniel'), ('danny', 'daniel'),
        ('chris', 'christopher'),
        ('matt', 'matthew'),
        ('tony', 'anthony'),
        ('steve', 'steven'), ('steve', 'stephen'),
        ('chuck', 'charles'), ('charlie', 'charles'),
        ('jack', 'john'), ('johnny', 'john'),
        ('kate', 'katherine'), ('kathy', 'katherine'), ('katie', 'katherine'), ('cathy', 'katherine'),
        ('rick', 'richard'), ('rich', 'richard'), ('dick', 'richard')
      ) AS nick(short_name, full_name)
      WHERE (person_first = nick.short_name AND contact_first = nick.full_name)
        OR (person_first = nick.full_name AND contact_first = nick.short_name)
    ) THEN
      SELECT coalesce(array_agg(value ORDER BY ordinal), ARRAY[]::text[])
      INTO person_full_middles
      FROM jsonb_array_elements_text(coalesce(person->'middles', '[]'::jsonb)) WITH ORDINALITY AS parsed(value, ordinal)
      WHERE length(value) > 1;
      IF i IS DISTINCT FROM primary_index
        OR person_full_middles IS DISTINCT FROM contact_middles THEN
        IF NOT o3_ok THEN
          CONTINUE;
        END IF;
      END IF;
      RETURN true;
    END IF;
    IF TRUE THEN
      FOR middle IN
        SELECT value
        FROM jsonb_array_elements_text(coalesce(person->'middles', '[]'::jsonb)) AS value
        WHERE length(value) > 1
      LOOP
        IF middle = contact_first OR EXISTS (
          SELECT 1
          FROM (VALUES
            ('bill', 'william'), ('billy', 'william'), ('will', 'william'),
            ('bob', 'robert'), ('rob', 'robert'), ('bobby', 'robert'),
            ('liz', 'elizabeth'), ('beth', 'elizabeth'), ('betty', 'elizabeth'),
            ('jim', 'james'), ('jimmy', 'james'),
            ('joe', 'joseph'), ('joey', 'joseph'),
            ('tom', 'thomas'), ('tommy', 'thomas'),
            ('mike', 'michael'),
            ('dave', 'david'),
            ('dan', 'daniel'), ('danny', 'daniel'),
            ('chris', 'christopher'),
            ('matt', 'matthew'),
            ('tony', 'anthony'),
            ('steve', 'steven'), ('steve', 'stephen'),
            ('chuck', 'charles'), ('charlie', 'charles'),
            ('jack', 'john'), ('johnny', 'john'),
            ('kate', 'katherine'), ('kathy', 'katherine'), ('katie', 'katherine'), ('cathy', 'katherine'),
            ('rick', 'richard'), ('rich', 'richard'), ('dick', 'richard')
          ) AS nick(short_name, full_name)
          WHERE (middle = nick.short_name AND contact_first = nick.full_name)
            OR (middle = nick.full_name AND contact_first = nick.short_name)
        ) THEN
          IF o3_ok THEN
            RETURN true;
          END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN false;
END;
$function$;

COMMENT ON FUNCTION public.dialer_owner_line_release_v1(text, text, text, text, boolean, text, text) IS
  'Owner-line release. owner_1_type must be person, unless the owner name is a clean first and last with no company word. A middle-name or co-owner match also needs relationship owner, dataskip_run* or smartskip_*, and is_skip_traced. subject, auto, manual, mojo_*, and null do not qualify.';

REVOKE ALL ON FUNCTION public.dialer_owner_line_release_v1(text, text, text, text, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_owner_line_release_v1(text, text, text, text, boolean, text, text) TO service_role;

-- Same block-reason function as 20261209120000, passing owner type into the release.
CREATE OR REPLACE FUNCTION public.source_list_phone_block_reasons_v1(
  p_phones text[],
  p_prospects uuid[],
  p_counties text[] DEFAULT NULL,
  p_situs_counties text[] DEFAULT NULL
)
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
      counties.county,
      counties.situs_county,
      public.normalize_conversation_phone(item.phone) AS e164,
      public.prospecting_phone_key_v1(item.phone) AS key10
    FROM unnest(coalesce(p_phones, ARRAY[]::text[]), coalesce(p_prospects, ARRAY[]::uuid[]))
      WITH ORDINALITY AS item(phone, prospect_id, ordinal)
    LEFT JOIN unnest(
      coalesce(p_counties, array_fill(NULL::text, ARRAY[coalesce(cardinality(p_phones), 0)])),
      coalesce(p_situs_counties, array_fill(NULL::text, ARRAY[coalesce(cardinality(p_phones), 0)]))
    ) WITH ORDINALITY AS counties(county, situs_county, ordinal)
      ON counties.ordinal = item.ordinal
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
      public.dialer_label_key_v1(phone.relationship) AS relationship_key,
      public.dialer_label_key_v1(prospect.owner_1_type) AS owner_type_key
    FROM public.prospect_phones AS phone
    JOIN public.prospects AS prospect ON prospect.id = phone.prospect_id
  ),
  bucketed_phones AS MATERIALIZED (
    SELECT
      classified_phones.*,
      CASE
        WHEN relationship_key = 'associate'
          OR owner_type_key IN ('neighbor', 'coworker', 'past_neighbor', 'friend', 'landlord', 'tenant') THEN 'associate_non_family'
        WHEN relationship_key IN ('owner', 'subject', 'co_owner') THEN 'owner'
        WHEN relationship_key IN ('unknown', 'entity_contact') OR owner_type_key = 'unknown' THEN 'relationship_unknown'
        WHEN relationship_key IN ('relative', 'spouse', 'parent', 'child', 'sibling', 'in_law', 'other_relative')
          OR owner_type_key IN ('in_law', 'child', 'parent', 'sibling', 'spouse', 'other_relative', 'individual') THEN 'relative'
        ELSE 'relationship_unknown'
      END AS bucket
    FROM classified_phones
  ),
  fanout_anchors AS MATERIALIZED (
    SELECT prospect_id, key10, dialer_property_key
    FROM bucketed_phones
    WHERE voice_hold IS TRUE
      AND public.dialer_label_key_v1(voice_hold_reason) LIKE '%mojo_dnc_contact_fanout%'
      AND length(key10) = 10
  ),
  fanout_keys AS MATERIALIZED (
    SELECT sibling.key10, anchor.dialer_property_key AS property_key, anchor.prospect_id
    FROM fanout_anchors AS anchor
    JOIN bucketed_phones AS sibling ON sibling.prospect_id = anchor.prospect_id AND length(sibling.key10) = 10
  ),
  person_dnc_homes AS MATERIALIZED (
    SELECT DISTINCT dialer_household_key, prospect_id, key10
    FROM bucketed_phones
    WHERE disposition_key IN ('dnc_contact', 'take_me_off')
  ),
  mojo_person_keys AS MATERIALIZED (
    SELECT dialer_phone_key AS key10, provider_contact_id
    FROM public.crm_mojo_call_events
    WHERE length(dialer_phone_key) = 10
      AND public.dialer_label_key_v1(disposition_raw) IN ('dnc_contact', 'take_me_off')
  ),
  short_last4 AS MATERIALIZED (
    SELECT DISTINCT right(key10, 4) AS last4
    FROM bucketed_phones
    WHERE length(key10) BETWEEN 4 AND 9
      AND (
        voice_hold IS TRUE
        OR (disposition_key IS NOT NULL AND disposition_key NOT IN (
          'no_answer', 'left_voicemail', 'left_vm', 'not_interested', 'spoke_with_owner',
          'callback_requested', 'busy', 'appointment_set', 'deal_potential', 'offer_made',
          'answered', 'contact', 'interested'
        ))
        OR (connected_key IS NOT NULL AND connected_key NOT IN ('connected', 'dataskip_dnc'))
      )
  ),
  sibling_person_keys AS MATERIALIZED (
    SELECT DISTINCT mine.key10
    FROM bucketed_phones AS mine
    JOIN bucketed_phones AS flagged
      ON flagged.prospect_id = mine.prospect_id
     AND flagged.key10 IS DISTINCT FROM mine.key10
     AND flagged.disposition_key IN ('dnc_contact', 'take_me_off')
    WHERE length(mine.key10) = 10
  ),
  mojo_sibling_keys AS MATERIALIZED (
    SELECT DISTINCT mine.key10
    FROM bucketed_phones AS mine
    JOIN bucketed_phones AS other
      ON other.prospect_id = mine.prospect_id
     AND other.key10 IS DISTINCT FROM mine.key10
    JOIN mojo_person_keys AS marked ON marked.key10 = other.key10
    WHERE length(mine.key10) = 10
  ),
  household_blocked_keys AS MATERIALIZED (
    SELECT DISTINCT mine.key10, mine.prospect_id
    FROM bucketed_phones AS mine
    JOIN person_dnc_homes AS anchor
      ON anchor.dialer_household_key = mine.dialer_household_key
     AND anchor.prospect_id IS DISTINCT FROM mine.prospect_id
    WHERE length(mine.key10) = 10
  ),
  dnc_properties AS MATERIALIZED (
    SELECT DISTINCT owner.dialer_property_key AS property_key
    FROM bucketed_phones AS owner
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
  property_blocked AS MATERIALIZED (
    SELECT DISTINCT prospect_id, key10
    FROM bucketed_phones
    WHERE dialer_property_key IN (SELECT property_key FROM dnc_properties)
  ),
  voice_blocks AS MATERIALIZED (
    SELECT DISTINCT key10
    FROM bucketed_phones
    WHERE length(key10) = 10
      AND voice_hold IS TRUE
      AND coalesce(public.dialer_label_key_v1(voice_hold_reason), '') NOT LIKE '%mojo_dnc_contact_fanout%'
  ),
  disposition_blocks AS MATERIALIZED (
    SELECT key10,
      CASE
        WHEN disposition_key IN ('dnc', 'do_not_call', 'dnc_number', 'dnc_contact', 'take_me_off') THEN 'prospect_dnc'
        WHEN disposition_key = 'wrong_number' THEN 'wrong_number'
        WHEN disposition_key IN ('dead', 'fax', 'disconnected', 'bad_number', 'not_in_service') THEN 'disconnected'
        ELSE 'unmapped_label'
      END AS block_reason,
      CASE
        WHEN disposition_key IN ('dnc', 'do_not_call', 'dnc_number', 'dnc_contact', 'take_me_off') THEN 40
        WHEN disposition_key = 'wrong_number' THEN 41
        WHEN disposition_key IN ('dead', 'fax', 'disconnected', 'bad_number', 'not_in_service') THEN 42
        ELSE 43
      END AS priority
    FROM bucketed_phones
    WHERE length(key10) = 10
      AND disposition_key IS NOT NULL
      AND disposition_key NOT IN (
        'no_answer', 'left_voicemail', 'left_vm', 'not_interested', 'spoke_with_owner',
        'callback_requested', 'busy', 'appointment_set', 'deal_potential', 'offer_made',
        'answered', 'contact', 'interested'
      )
  ),
  connected_blocks AS MATERIALIZED (
    SELECT key10,
      CASE
        WHEN connected_key = 'wrong_number' THEN 'wrong_number'
        WHEN connected_key IN ('disconnected', 'false', 'no', 'bad_number') THEN 'disconnected'
        ELSE 'unmapped_label'
      END AS block_reason,
      CASE
        WHEN connected_key = 'wrong_number' THEN 51
        WHEN connected_key IN ('disconnected', 'false', 'no', 'bad_number') THEN 52
        ELSE 53
      END AS priority
    FROM bucketed_phones
    WHERE length(key10) = 10
      AND connected_key IS NOT NULL
      AND connected_key NOT IN ('connected', 'dataskip_dnc')
  ),
  relationship_blocks AS MATERIALIZED (
    SELECT prospect_id, key10,
      CASE bucket WHEN 'associate_non_family' THEN 'associate_non_family' ELSE 'relationship_unknown' END AS block_reason,
      CASE bucket WHEN 'associate_non_family' THEN 90 ELSE 91 END AS priority
    FROM bucketed_phones
    WHERE length(key10) = 10
      AND bucket IN ('associate_non_family', 'relationship_unknown')
      AND NOT (
        (
          bucket = 'relationship_unknown'
          AND public.dialer_unknown_tie_release_v1(
            relationship, contact_name, owner_1, owner_1_last, is_skip_traced, verified_source
          )
        )
        OR public.dialer_owner_line_release_v1(
          relationship, contact_name, owner_1, owner_1_last, is_skip_traced, verified_source, owner_type_key
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
    JOIN voice_blocks AS blocked ON blocked.key10 = input.key10
    UNION ALL
    SELECT input.ordinal, blocked.block_reason, blocked.priority
    FROM input
    JOIN disposition_blocks AS blocked ON blocked.key10 = input.key10
    UNION ALL
    SELECT input.ordinal, blocked.block_reason, blocked.priority
    FROM input
    JOIN connected_blocks AS blocked ON blocked.key10 = input.key10
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
    SELECT input.ordinal, blocked.block_reason, blocked.priority
    FROM input
    JOIN relationship_blocks AS blocked
      ON blocked.key10 = input.key10
     AND (input.prospect_id IS NULL OR blocked.prospect_id = input.prospect_id)
    UNION ALL
    SELECT input.ordinal, 'property_owner_dnc_fanout', 100
    FROM input
    JOIN property_blocked AS blocked
      ON blocked.prospect_id = input.prospect_id OR blocked.key10 = input.key10
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
    JOIN sibling_person_keys AS blocked ON blocked.key10 = input.key10
    UNION ALL
    SELECT input.ordinal, 'person_fanout', 121
    FROM input
    JOIN person_dnc_homes AS flagged
      ON flagged.prospect_id = input.prospect_id
     AND flagged.key10 IS DISTINCT FROM input.key10
    WHERE input.prospect_id IS NOT NULL
    UNION ALL
    SELECT input.ordinal, 'person_fanout', 123
    FROM input
    JOIN mojo_sibling_keys AS blocked ON blocked.key10 = input.key10
    UNION ALL
    SELECT input.ordinal, 'person_fanout', 124
    FROM input
    JOIN public.crm_mojo_call_events AS mine_event ON mine_event.dialer_phone_key = input.key10
    JOIN mojo_person_keys AS marked
      ON marked.provider_contact_id = mine_event.provider_contact_id
     AND nullif(btrim(mine_event.provider_contact_id), '') IS NOT NULL
     AND marked.key10 IS DISTINCT FROM input.key10
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
    JOIN bucketed_phones AS shared ON shared.key10 = lead.dialer_phone_key
    JOIN bucketed_phones AS sibling
      ON sibling.prospect_id = shared.prospect_id AND sibling.key10 = input.key10
    UNION ALL
    SELECT input.ordinal, 'household_fanout', 130
    FROM input
    JOIN household_blocked_keys AS blocked
      ON blocked.prospect_id = input.prospect_id OR blocked.key10 = input.key10
    UNION ALL
    SELECT input.ordinal, 'household_fanout', 131
    FROM input
    JOIN bucketed_phones AS mine ON mine.prospect_id = input.prospect_id
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
    SELECT input.ordinal,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM (VALUES (input.county), (input.situs_county)) AS candidate(county_value)
          CROSS JOIN LATERAL (SELECT NULLIF(lower(btrim(candidate.county_value)), '') AS slug) AS normalized
          WHERE normalized.slug IS NOT NULL
            AND normalized.slug NOT IN ('unknown', 'unresolved', 'jackson', 'clay', 'platte', 'wyandotte', 'johnson')
        ) THEN 'out_of_service_area'
        ELSE 'county_unresolved'
      END,
      200
    FROM input
    WHERE (p_counties IS NOT NULL OR p_situs_counties IS NOT NULL)
      AND (
        EXISTS (
          SELECT 1
          FROM (VALUES (input.county), (input.situs_county)) AS candidate(county_value)
          CROSS JOIN LATERAL (SELECT NULLIF(lower(btrim(candidate.county_value)), '') AS slug) AS normalized
          WHERE normalized.slug IS NOT NULL
            AND normalized.slug NOT IN ('unknown', 'unresolved', 'jackson', 'clay', 'platte', 'wyandotte', 'johnson')
        )
        OR NOT EXISTS (
          SELECT 1
          FROM (VALUES (input.county), (input.situs_county)) AS candidate(county_value)
          CROSS JOIN LATERAL (SELECT NULLIF(lower(btrim(candidate.county_value)), '') AS slug) AS normalized
          WHERE normalized.slug IN ('jackson', 'clay', 'platte', 'wyandotte', 'johnson')
        )
      )
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
          SELECT 1 FROM short_last4 AS short_phone
          WHERE short_phone.last4 = right(input.key10, 4)
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
            AND (
              EXISTS (
                SELECT 1
                FROM public.crm_mojo_call_events AS tied
                WHERE nullif(btrim(call.provider_contact_id), '') IS NOT NULL
                  AND tied.provider_contact_id = call.provider_contact_id
                  AND (
                    tied.dialer_phone_key = input.key10
                    OR tied.dialer_phone_key IN (
                      SELECT same.dialer_phone_key
                      FROM public.prospect_phones AS same
                      WHERE same.prospect_id = input.prospect_id
                    )
                  )
              )
              OR EXISTS (
                SELECT 1
                FROM public.prospects AS owned
                WHERE call.lead_id IS NOT NULL
                  AND owned.lead_id = call.lead_id
                  AND (
                    owned.id = input.prospect_id
                    OR EXISTS (
                      SELECT 1 FROM public.prospect_phones AS mine
                      WHERE mine.prospect_id = owned.id AND mine.dialer_phone_key = input.key10
                    )
                  )
              )
              OR EXISTS (
                SELECT 1
                FROM public.prospects AS call_home
                JOIN public.prospects AS mine
                  ON mine.dialer_household_key = call_home.dialer_household_key
                 AND mine.dialer_household_key IS NOT NULL
                WHERE call.lead_id IS NOT NULL
                  AND call_home.lead_id = call.lead_id
                  AND (
                    mine.id = input.prospect_id
                    OR EXISTS (
                      SELECT 1 FROM public.prospect_phones AS phone
                      WHERE phone.prospect_id = mine.id AND phone.dialer_phone_key = input.key10
                    )
                  )
              )
            )
        )
      )
  )
  SELECT DISTINCT ON (hit.ordinal) hit.ordinal, hit.block_reason
  FROM hits AS hit
  ORDER BY hit.ordinal, hit.priority;
$function$;

REVOKE ALL ON FUNCTION public.source_list_phone_block_reasons_v1(text[], uuid[], text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.source_list_phone_block_reasons_v1(text[], uuid[], text[], text[]) TO service_role;
