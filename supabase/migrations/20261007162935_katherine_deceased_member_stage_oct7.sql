CREATE TABLE IF NOT EXISTS public.katherine_deceased_member_stage (
  member_id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL,
  prospect_id uuid NOT NULL,
  phone_snapshot text NOT NULL,
  search_text text NOT NULL,
  contacts jsonb NOT NULL,
  processed_at timestamptz
);

CREATE OR REPLACE FUNCTION public.katherine_deceased_process_stage()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payload jsonb;
  result jsonb;
  total_members int := 0;
  total_contacts int := 0;
  total_phones int := 0;
  r record;
  batch jsonb;
  members jsonb := '[]'::jsonb;
  n int := 0;
BEGIN
  FOR r IN
    SELECT member_id, campaign_id, prospect_id, phone_snapshot, search_text, contacts
    FROM public.katherine_deceased_member_stage
    WHERE processed_at IS NULL
    ORDER BY member_id
  LOOP
    members := members || jsonb_build_array(jsonb_build_object(
      'member_id', r.member_id,
      'campaign_id', r.campaign_id,
      'prospect_id', r.prospect_id,
      'phone_snapshot', r.phone_snapshot,
      'search_text', r.search_text,
      'contacts', r.contacts
    ));
    n := n + 1;
    IF n >= 10 THEN
      payload := jsonb_build_object(
        'enrolled_by', 'Katherine',
        'enrollment_source', 'smartskip_deceased_oct7',
        'members', members
      );
      result := public.katherine_deceased_dialer_load_tmp(payload);
      total_members := total_members + COALESCE((result->>'inserted_members')::int, 0);
      total_contacts := total_contacts + COALESCE((result->>'inserted_contacts')::int, 0);
      total_phones := total_phones + COALESCE((result->>'upserted_phones')::int, 0);
      UPDATE public.katherine_deceased_member_stage s
        SET processed_at = now()
        WHERE s.processed_at IS NULL
          AND s.member_id IN (
            SELECT (x->>'member_id')::uuid FROM jsonb_array_elements(members) x
          );
      members := '[]'::jsonb;
      n := 0;
    END IF;
  END LOOP;

  IF n > 0 THEN
    payload := jsonb_build_object(
      'enrolled_by', 'Katherine',
      'enrollment_source', 'smartskip_deceased_oct7',
      'members', members
    );
    result := public.katherine_deceased_dialer_load_tmp(payload);
    total_members := total_members + COALESCE((result->>'inserted_members')::int, 0);
    total_contacts := total_contacts + COALESCE((result->>'inserted_contacts')::int, 0);
    total_phones := total_phones + COALESCE((result->>'upserted_phones')::int, 0);
    UPDATE public.katherine_deceased_member_stage s
      SET processed_at = now()
      WHERE s.processed_at IS NULL
        AND s.member_id IN (
          SELECT (x->>'member_id')::uuid FROM jsonb_array_elements(members) x
        );
  END IF;

  RETURN jsonb_build_object(
    'inserted_members', total_members,
    'inserted_contacts', total_contacts,
    'upserted_phones', total_phones
  );
END;
$$;
