-- Pat 4f: owner-line release requires owner_1_type person or individual, unless
-- the owner name is a clean first and last with no company word.
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
  IF owner_type IS NULL OR owner_type NOT IN ('person', 'individual') THEN
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
          OR token = ANY (ARRAY['llc', 'inc', 'incorporated', 'corp', 'corporation', 'trust', 'bank', 'company', 'llp', 'pllc', 'lp', 'properties', 'homes', 'holdings', 'investments', 'realty', 'rentals', 'group', 'partners', 'ventures', 'capital', 'enterprises', 'management', 'development'])
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
      OR hint = ANY (ARRAY['llc', 'inc', 'incorporated', 'corp', 'corporation', 'trust', 'bank', 'company', 'llp', 'pllc', 'lp', 'properties', 'homes', 'holdings', 'investments', 'realty', 'rentals', 'group', 'partners', 'ventures', 'capital', 'enterprises', 'management', 'development'])
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
      WHERE token = ANY (ARRAY['llc', 'inc', 'incorporated', 'corp', 'corporation', 'trust', 'bank', 'company', 'llp', 'pllc', 'lp', 'properties', 'homes', 'holdings', 'investments', 'realty', 'rentals', 'group', 'partners', 'ventures', 'capital', 'enterprises', 'management', 'development'])
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
  'Owner-line release. owner_1_type must be person or individual, unless the owner name is a clean first and last with no company word. A middle-name or co-owner match also needs relationship owner, dataskip_run* or smartskip_*, and is_skip_traced. subject, auto, manual, mojo_*, and null do not qualify.';

REVOKE ALL ON FUNCTION public.dialer_owner_line_release_v1(text, text, text, text, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_owner_line_release_v1(text, text, text, text, boolean, text, text) TO service_role;

-- Patch the live block-reason function so it passes owner type. Do not
-- paste an older copy of that function.
DO $patch$
DECLARE
  def text := pg_get_functiondef('public.source_list_phone_block_reasons_v1(text[], uuid[], text[], text[])'::regprocedure);
  old text := $old$public.dialer_owner_line_release_v1(
          relationship, contact_name, owner_1, owner_1_last, is_skip_traced, verified_source
        )$old$;
  new text := $new$public.dialer_owner_line_release_v1(
          relationship, contact_name, owner_1, owner_1_last, is_skip_traced, verified_source, owner_type_key
        )$new$;
BEGIN
  IF position(old IN def) = 0 THEN
    RAISE EXCEPTION 'owner-line call site was not found on the live block-reason function';
  END IF;
  EXECUTE replace(def, old, new);
END;
$patch$;
