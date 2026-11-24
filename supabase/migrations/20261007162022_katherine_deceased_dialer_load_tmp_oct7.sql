CREATE OR REPLACE FUNCTION public.katherine_deceased_dialer_load_tmp(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m jsonb;
  c jsonb;
  v_member_id uuid;
  v_campaign_id uuid;
  v_prospect_id uuid;
  v_phone_id uuid;
  v_e164 text;
  v_key text;
  v_status text;
  v_reason text;
  v_ready int;
  v_member_status text;
  v_member_reason text;
  v_phone_snapshot text;
  inserted_members int := 0;
  inserted_contacts int := 0;
  upserted_phones int := 0;
BEGIN
  FOR m IN SELECT * FROM jsonb_array_elements(p_payload->'members')
  LOOP
    v_member_id := (m->>'member_id')::uuid;
    v_campaign_id := (m->>'campaign_id')::uuid;
    v_prospect_id := (m->>'prospect_id')::uuid;
    v_phone_snapshot := m->>'phone_snapshot';
    v_ready := 0;

    -- upsert each contact phone onto prospect
    FOR c IN SELECT * FROM jsonb_array_elements(m->'contacts')
    LOOP
      v_e164 := c->>'e164';
      SELECT id INTO v_phone_id
      FROM prospect_phones x
      WHERE x.prospect_id = v_prospect_id
        AND normalize_conversation_phone(x.phone) = normalize_conversation_phone(v_e164)
      ORDER BY x.is_verified_contact DESC, x.created_at ASC
      LIMIT 1;

      IF v_phone_id IS NULL THEN
        v_phone_id := COALESCE((c->>'phone_id')::uuid, gen_random_uuid());
        INSERT INTO prospect_phones (id, prospect_id, phone, phone_type, contact_name, relationship, is_verified_contact)
        VALUES (
          v_phone_id,
          v_prospect_id,
          v_e164,
          NULLIF(c->>'type',''),
          NULLIF(c->>'name',''),
          NULLIF(c->>'rel',''),
          false
        );
        upserted_phones := upserted_phones + 1;
      ELSE
        UPDATE prospect_phones x SET
          contact_name = CASE WHEN COALESCE(x.contact_name,'') = '' THEN NULLIF(c->>'name','') ELSE x.contact_name END,
          relationship = CASE
            WHEN COALESCE(x.relationship,'') = '' THEN NULLIF(c->>'rel','')
            WHEN lower(COALESCE(x.relationship,'')) = 'owner' AND COALESCE(c->>'rel','') NOT IN ('','owner') THEN c->>'rel'
            ELSE x.relationship
          END,
          phone_type = CASE WHEN COALESCE(x.phone_type,'') = '' THEN NULLIF(c->>'type','') ELSE x.phone_type END
        WHERE x.id = v_phone_id;
      END IF;
    END LOOP;

    -- insert member (skip if already present for campaign+prospect)
    IF EXISTS (
      SELECT 1 FROM prospecting_campaign_members
      WHERE campaign_id = v_campaign_id AND prospect_id = v_prospect_id AND subject_kind = 'prospect'
    ) THEN
      CONTINUE;
    END IF;

    -- precompute contact statuses to decide member status
    v_ready := 0;
    FOR c IN SELECT * FROM jsonb_array_elements(m->'contacts')
    LOOP
      v_e164 := c->>'e164';
      v_status := 'ready';
      v_reason := NULL;
      IF EXISTS (
        SELECT 1 FROM sms_opt_outs o
        WHERE o.is_opted_out = true
          AND normalize_conversation_phone(o.phone) = normalize_conversation_phone(v_e164)
      ) THEN
        v_status := 'suppressed';
        v_reason := 'sms_opt_out';
      ELSIF EXISTS (
        SELECT 1 FROM prospect_phones x
        WHERE x.prospect_id = v_prospect_id
          AND normalize_conversation_phone(x.phone) = normalize_conversation_phone(v_e164)
          AND (
            lower(COALESCE(x.phone_connected,'')) IN ('no','false','disconnected')
            OR lower(COALESCE(x.last_disposition,'')) IN ('disconnected','wrong_number','dead','dnc')
          )
      ) THEN
        v_status := 'suppressed';
        v_reason := 'disconnected';
      END IF;
      IF v_status = 'ready' THEN
        v_ready := v_ready + 1;
      END IF;
    END LOOP;

    IF v_ready > 0 THEN
      v_member_status := 'active';
      v_member_reason := NULL;
    ELSE
      v_member_status := 'suppressed';
      v_member_reason := 'all_phone_targets_blocked';
    END IF;

    INSERT INTO prospecting_campaign_members (
      id, campaign_id, lead_id, phone_snapshot, timezone, status, suppression_reason,
      current_step_position, enrolled_by, search_text, subject_kind, prospect_id, enrollment_source
    ) VALUES (
      v_member_id,
      v_campaign_id,
      NULL,
      v_phone_snapshot,
      'America/Chicago',
      v_member_status,
      v_member_reason,
      0,
      COALESCE(p_payload->>'enrolled_by', 'Katherine'),
      COALESCE(m->>'search_text', ''),
      'prospect',
      v_prospect_id,
      COALESCE(p_payload->>'enrollment_source', 'smartskip_deceased_oct7')
    );
    inserted_members := inserted_members + 1;

    FOR c IN SELECT * FROM jsonb_array_elements(m->'contacts')
    LOOP
      v_e164 := c->>'e164';
      v_key := right(regexp_replace(v_e164, '\\D', '', 'g'), 10);
      SELECT id INTO v_phone_id
      FROM prospect_phones x
      WHERE x.prospect_id = v_prospect_id
        AND normalize_conversation_phone(x.phone) = normalize_conversation_phone(v_e164)
      ORDER BY x.is_verified_contact DESC, x.created_at ASC
      LIMIT 1;

      v_status := 'ready';
      v_reason := NULL;
      IF EXISTS (
        SELECT 1 FROM sms_opt_outs o
        WHERE o.is_opted_out = true
          AND normalize_conversation_phone(o.phone) = normalize_conversation_phone(v_e164)
      ) THEN
        v_status := 'suppressed';
        v_reason := 'sms_opt_out';
      ELSIF EXISTS (
        SELECT 1 FROM prospect_phones x
        WHERE x.id = v_phone_id
          AND (
            lower(COALESCE(x.phone_connected,'')) IN ('no','false','disconnected')
            OR lower(COALESCE(x.last_disposition,'')) IN ('disconnected','wrong_number','dead','dnc')
          )
      ) THEN
        v_status := 'suppressed';
        v_reason := 'disconnected';
      END IF;

      INSERT INTO prospecting_campaign_member_contacts (
        member_id, source_kind, prospect_id, prospect_phone_id, contact_key, phone_snapshot,
        contact_name, relationship, phone_type, status, suppression_reason, selected_for_sms
      ) VALUES (
        v_member_id,
        'prospect_phone',
        v_prospect_id,
        v_phone_id,
        v_key,
        v_e164,
        NULLIF(c->>'name',''),
        NULLIF(c->>'rel',''),
        NULLIF(c->>'type',''),
        v_status,
        v_reason,
        false
      )
      ON CONFLICT (member_id, contact_key) DO NOTHING;
      inserted_contacts := inserted_contacts + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted_members', inserted_members,
    'inserted_contacts', inserted_contacts,
    'upserted_phones', upserted_phones
  );
END;
$$;
