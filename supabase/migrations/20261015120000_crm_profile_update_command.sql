-- Canonical contact profile updates.
--
-- Human edits still write through the compatibility lead while the existing
-- lead trigger owns canonical person, contact-method, property, and opportunity
-- synchronization. This command makes the write, canonical postcondition, and
-- immutable activity audit one transaction so the API cannot report success
-- when the authoritative read would immediately show different values.

CREATE OR REPLACE FUNCTION public.crm_update_lead_profile_v1(
  target_lead_id uuid,
  target_patch jsonb,
  target_actor_email text,
  target_actor_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  lead_row public.leads;
  updated_lead public.leads;
  entity_link public.crm_lead_entity_links;
  person_row public.crm_people;
  property_row public.crm_properties;
  opportunity_row public.crm_opportunities;
  phone_value text;
  email_value text;
  changed_fields text[];
  allowed_fields constant text[] := ARRAY[
    'full_name', 'phone', 'email', 'property_address', 'city', 'state',
    'zip', 'county', 'source', 'notes', 'offer_amount'
  ];
  requested_field text;
BEGIN
  IF target_lead_id IS NULL THEN RAISE EXCEPTION 'lead_id_required'; END IF;
  IF jsonb_typeof(target_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'profile_patch_required'; END IF;
  IF nullif(btrim(target_actor_email), '') IS NULL OR nullif(btrim(target_actor_name), '') IS NULL THEN
    RAISE EXCEPTION 'actor_required';
  END IF;

  SELECT array_agg(field_name ORDER BY field_name) INTO changed_fields
  FROM jsonb_object_keys(target_patch) AS fields(field_name);
  IF coalesce(array_length(changed_fields, 1), 0) = 0 THEN RAISE EXCEPTION 'profile_patch_required'; END IF;
  FOREACH requested_field IN ARRAY changed_fields LOOP
    IF NOT requested_field = ANY(allowed_fields) THEN RAISE EXCEPTION 'unsupported_profile_field:%', requested_field; END IF;
    IF requested_field = 'offer_amount' THEN
      IF jsonb_typeof(target_patch -> requested_field) IS DISTINCT FROM 'number'
        OR (target_patch ->> requested_field)::numeric <= 0
        OR (target_patch ->> requested_field)::numeric > 100000000 THEN
        RAISE EXCEPTION 'invalid_profile_field:%', requested_field;
      END IF;
    ELSIF jsonb_typeof(target_patch -> requested_field) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'invalid_profile_field:%', requested_field;
    END IF;
  END LOOP;
  IF target_patch ? 'full_name' AND nullif(btrim(target_patch ->> 'full_name'), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_profile_field:full_name';
  END IF;

  SELECT * INTO lead_row FROM public.leads WHERE id = target_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found'; END IF;

  UPDATE public.leads SET
    full_name = CASE WHEN target_patch ? 'full_name' THEN nullif(btrim(target_patch ->> 'full_name'), '') ELSE full_name END,
    phone = CASE WHEN target_patch ? 'phone' THEN nullif(btrim(target_patch ->> 'phone'), '') ELSE phone END,
    email = CASE WHEN target_patch ? 'email' THEN nullif(lower(btrim(target_patch ->> 'email')), '') ELSE email END,
    property_address = CASE WHEN target_patch ? 'property_address' THEN nullif(btrim(target_patch ->> 'property_address'), '') ELSE property_address END,
    city = CASE WHEN target_patch ? 'city' THEN nullif(btrim(target_patch ->> 'city'), '') ELSE city END,
    state = CASE WHEN target_patch ? 'state' THEN nullif(btrim(target_patch ->> 'state'), '') ELSE state END,
    zip = CASE WHEN target_patch ? 'zip' THEN nullif(btrim(target_patch ->> 'zip'), '') ELSE zip END,
    county = CASE WHEN target_patch ? 'county' THEN nullif(btrim(target_patch ->> 'county'), '') ELSE county END,
    source = CASE WHEN target_patch ? 'source' THEN nullif(btrim(target_patch ->> 'source'), '') ELSE source END,
    notes = CASE WHEN target_patch ? 'notes' THEN nullif(btrim(target_patch ->> 'notes'), '') ELSE notes END,
    offer_amount = CASE WHEN target_patch ? 'offer_amount' THEN (target_patch ->> 'offer_amount')::numeric ELSE offer_amount END,
    updated_at = now()
  WHERE id = target_lead_id
  RETURNING * INTO updated_lead;

  -- The existing AFTER UPDATE trigger refreshes this link and its canonical
  -- rows before control returns to this function.
  SELECT * INTO entity_link
  FROM public.crm_lead_entity_links
  WHERE lead_id = target_lead_id;

  IF entity_link.lead_id IS NOT NULL THEN
    -- The projection trigger owns identity selection. These targeted updates
    -- finish requested edits that the additive projection intentionally does
    -- not overwrite (for example, an existing property's county).
    IF target_patch ? 'full_name' THEN
      UPDATE public.crm_people SET
        display_name = coalesce(nullif(btrim(updated_lead.full_name), ''), 'Unknown contact'),
        updated_at = now()
      WHERE id = entity_link.person_id;
    END IF;

    IF target_patch ? 'phone' AND updated_lead.phone IS NULL THEN
      UPDATE public.crm_contact_methods SET
        person_id = NULL,
        is_primary = false,
        updated_at = now()
      WHERE person_id = entity_link.person_id AND method_type = 'phone';
    END IF;

    IF target_patch ? 'email' AND updated_lead.email IS NULL THEN
      UPDATE public.crm_contact_methods SET
        person_id = NULL,
        is_primary = false,
        updated_at = now()
      WHERE person_id = entity_link.person_id AND method_type = 'email';
    END IF;

    IF entity_link.property_id IS NOT NULL
      AND target_patch ?| ARRAY['property_address', 'city', 'state', 'zip', 'county'] THEN
      UPDATE public.crm_properties SET
        address = CASE WHEN target_patch ? 'property_address' THEN updated_lead.property_address ELSE address END,
        city = CASE WHEN target_patch ? 'city' THEN updated_lead.city ELSE city END,
        state = CASE WHEN target_patch ? 'state' THEN updated_lead.state ELSE state END,
        zip = CASE WHEN target_patch ? 'zip' THEN updated_lead.zip ELSE zip END,
        county = CASE WHEN target_patch ? 'county' THEN updated_lead.county ELSE county END,
        updated_at = now()
      WHERE id = entity_link.property_id;
    END IF;

    IF target_patch ? 'source' THEN
      UPDATE public.crm_opportunities SET source = updated_lead.source, updated_at = now()
      WHERE id = entity_link.opportunity_id;
    END IF;

    SELECT * INTO person_row FROM public.crm_people WHERE id = entity_link.person_id;
    IF entity_link.property_id IS NOT NULL THEN
      SELECT * INTO property_row FROM public.crm_properties WHERE id = entity_link.property_id;
    END IF;
    SELECT * INTO opportunity_row FROM public.crm_opportunities WHERE id = entity_link.opportunity_id;

    IF target_patch ? 'full_name'
      AND btrim(coalesce(person_row.display_name, '')) IS DISTINCT FROM coalesce(nullif(btrim(updated_lead.full_name), ''), 'Unknown contact') THEN
      RAISE EXCEPTION 'canonical_profile_conflict:full_name';
    END IF;

    IF target_patch ? 'phone' THEN
      SELECT method.normalized_value INTO phone_value
      FROM public.crm_contact_methods AS method
      WHERE method.person_id = entity_link.person_id AND method.method_type = 'phone'
      ORDER BY method.is_primary DESC, method.updated_at DESC, method.id DESC
      LIMIT 1;
      IF public.normalize_conversation_phone(updated_lead.phone) IS DISTINCT FROM phone_value THEN
        RAISE EXCEPTION 'canonical_profile_conflict:phone';
      END IF;
    END IF;

    IF target_patch ? 'email' THEN
      SELECT method.normalized_value INTO email_value
      FROM public.crm_contact_methods AS method
      WHERE method.person_id = entity_link.person_id AND method.method_type = 'email'
      ORDER BY method.is_primary DESC, method.updated_at DESC, method.id DESC
      LIMIT 1;
      IF public.normalize_crm_email(updated_lead.email) IS DISTINCT FROM email_value THEN
        RAISE EXCEPTION 'canonical_profile_conflict:email';
      END IF;
    END IF;

    IF entity_link.property_id IS NOT NULL THEN
      IF target_patch ? 'property_address' AND btrim(coalesce(property_row.address, '')) IS DISTINCT FROM btrim(coalesce(updated_lead.property_address, '')) THEN RAISE EXCEPTION 'canonical_profile_conflict:property_address'; END IF;
      IF target_patch ? 'city' AND btrim(coalesce(property_row.city, '')) IS DISTINCT FROM btrim(coalesce(updated_lead.city, '')) THEN RAISE EXCEPTION 'canonical_profile_conflict:city'; END IF;
      IF target_patch ? 'state' AND btrim(coalesce(property_row.state, '')) IS DISTINCT FROM btrim(coalesce(updated_lead.state, '')) THEN RAISE EXCEPTION 'canonical_profile_conflict:state'; END IF;
      IF target_patch ? 'zip' AND btrim(coalesce(property_row.zip, '')) IS DISTINCT FROM btrim(coalesce(updated_lead.zip, '')) THEN RAISE EXCEPTION 'canonical_profile_conflict:zip'; END IF;
      IF target_patch ? 'county' AND btrim(coalesce(property_row.county, '')) IS DISTINCT FROM btrim(coalesce(updated_lead.county, '')) THEN RAISE EXCEPTION 'canonical_profile_conflict:county'; END IF;
    END IF;
    IF target_patch ? 'source' AND btrim(coalesce(opportunity_row.source, '')) IS DISTINCT FROM btrim(coalesce(updated_lead.source, '')) THEN RAISE EXCEPTION 'canonical_profile_conflict:source'; END IF;
  END IF;

  INSERT INTO public.lead_activities(lead_id, activity_type, description, agent, metadata)
  VALUES (
    target_lead_id,
    'profile_update',
    'Contact profile updated',
    btrim(target_actor_name),
    jsonb_build_object(
      'source', 'crm_update_lead_profile_v1',
      'changed_fields', to_jsonb(changed_fields),
      'actor_email', lower(btrim(target_actor_email))
    )
  );

  RETURN jsonb_build_object(
    'lead', to_jsonb(updated_lead),
    'changedFields', to_jsonb(changed_fields),
    'entityLinked', entity_link.lead_id IS NOT NULL
  );
END
$$;

REVOKE ALL ON FUNCTION public.crm_update_lead_profile_v1(uuid, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_update_lead_profile_v1(uuid, jsonb, text, text)
  TO service_role;

COMMENT ON FUNCTION public.crm_update_lead_profile_v1(uuid, jsonb, text, text) IS
  'Atomically updates an allowlisted lead profile, verifies canonical read authority, and records an immutable human audit event.';
