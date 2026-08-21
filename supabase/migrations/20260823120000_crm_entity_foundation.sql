-- Additive CRM entity foundation.
--
-- `leads` remains the compatibility write aggregate for this phase. This
-- migration projects each lead into first-class people, contact methods,
-- properties, and opportunities without rewriting or deleting legacy tables.
-- Production rollout must be rehearsed and explicitly approved before apply.

CREATE TABLE IF NOT EXISTS public.crm_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  record_status text NOT NULL DEFAULT 'active'
    CHECK (record_status IN ('active', 'merged', 'archived')),
  merged_into_id uuid REFERENCES public.crm_people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (merged_into_id IS NULL OR merged_into_id <> id)
);

CREATE TABLE IF NOT EXISTS public.crm_contact_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid REFERENCES public.crm_people(id) ON DELETE SET NULL,
  method_type text NOT NULL CHECK (method_type IN ('phone', 'email')),
  raw_value text NOT NULL,
  normalized_value text NOT NULL,
  label text NOT NULL DEFAULT 'primary',
  is_primary boolean NOT NULL DEFAULT false,
  deliverability_status text NOT NULL DEFAULT 'unknown'
    CHECK (deliverability_status IN ('unknown', 'valid', 'wrong_number', 'disconnected', 'blocked')),
  sms_consent_status text NOT NULL DEFAULT 'unknown'
    CHECK (sms_consent_status IN ('unknown', 'opted_in', 'opted_out', 'not_applicable')),
  consent_source text,
  consent_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (method_type, normalized_value),
  CHECK (method_type = 'phone' OR sms_consent_status = 'not_applicable')
);

CREATE TABLE IF NOT EXISTS public.crm_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_address text NOT NULL UNIQUE,
  address text NOT NULL,
  city text,
  state text,
  zip text,
  county text,
  parcel_id text,
  property_type text,
  bedrooms integer,
  bathrooms numeric,
  sqft integer,
  year_built integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_lead_id uuid NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  primary_person_id uuid NOT NULL REFERENCES public.crm_people(id),
  primary_property_id uuid REFERENCES public.crm_properties(id),
  stage text NOT NULL,
  classification text,
  priority text,
  owner_name text,
  source text,
  lifecycle_status text NOT NULL DEFAULT 'open'
    CHECK (lifecycle_status IN ('open', 'won', 'lost', 'dead', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_opportunity_people (
  opportunity_id uuid NOT NULL REFERENCES public.crm_opportunities(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.crm_people(id),
  relationship_role text NOT NULL DEFAULT 'primary_seller'
    CHECK (relationship_role IN ('primary_seller', 'co_seller', 'owner', 'heir', 'buyer', 'other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (opportunity_id, person_id, relationship_role)
);

CREATE TABLE IF NOT EXISTS public.crm_lead_entity_links (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.crm_people(id),
  property_id uuid REFERENCES public.crm_properties(id),
  opportunity_id uuid NOT NULL UNIQUE REFERENCES public.crm_opportunities(id) ON DELETE CASCADE,
  projection_version integer NOT NULL DEFAULT 1 CHECK (projection_version > 0),
  projected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_identity_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  conflict_type text NOT NULL CHECK (conflict_type IN ('phone_email_disagree', 'method_claimed_elsewhere')),
  selected_person_id uuid NOT NULL REFERENCES public.crm_people(id),
  conflicting_person_id uuid REFERENCES public.crm_people(id),
  method_type text CHECK (method_type IN ('phone', 'email')),
  normalized_value text,
  fingerprint text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  resolution_note text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.crm_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_method_id uuid NOT NULL REFERENCES public.crm_contact_methods(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('sms', 'voice', 'email')),
  event_type text NOT NULL CHECK (event_type IN ('opted_in', 'opted_out', 'status_observed')),
  source text NOT NULL,
  reason text,
  idempotency_key text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contact_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_opportunity_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_lead_entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_identity_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_consent_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.crm_people, public.crm_contact_methods, public.crm_properties,
  public.crm_opportunities, public.crm_opportunity_people, public.crm_lead_entity_links,
  public.crm_identity_conflicts, public.crm_consent_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.crm_people, public.crm_contact_methods, public.crm_properties,
  public.crm_opportunities, public.crm_opportunity_people, public.crm_lead_entity_links,
  public.crm_identity_conflicts, public.crm_consent_events
  TO service_role;

CREATE INDEX IF NOT EXISTS idx_crm_contact_methods_person
  ON public.crm_contact_methods(person_id, method_type, is_primary DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_contact_methods_one_primary
  ON public.crm_contact_methods(person_id, method_type)
  WHERE person_id IS NOT NULL AND is_primary;
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_stage
  ON public.crm_opportunities(lifecycle_status, stage, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_person
  ON public.crm_opportunities(primary_person_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_property
  ON public.crm_opportunities(primary_property_id)
  WHERE primary_property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_identity_conflicts_open
  ON public.crm_identity_conflicts(detected_at DESC, id DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_crm_consent_events_method
  ON public.crm_consent_events(contact_method_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.normalize_crm_email(raw_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN position('@' IN lower(trim(coalesce(raw_email, '')))) > 1
      THEN lower(trim(raw_email))
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_crm_address(
  raw_address text,
  raw_city text DEFAULT NULL,
  raw_state text DEFAULT NULL,
  raw_zip text DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN nullif(trim(raw_address), '') IS NULL THEN NULL ELSE
    nullif(lower(regexp_replace(
      concat_ws('|', nullif(trim(raw_address), ''), nullif(trim(raw_city), ''),
        nullif(trim(raw_state), ''), nullif(trim(raw_zip), '')),
      '[[:space:]]+', ' ', 'g'
    )), '')
  END;
$$;

REVOKE ALL ON FUNCTION public.normalize_crm_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_crm_address(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_crm_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_crm_address(text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_crm_entity_for_lead_core(target_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  lead_row public.leads;
  existing_link public.crm_lead_entity_links;
  phone_value text;
  email_value text;
  address_value text;
  phone_person uuid;
  email_person uuid;
  selected_person uuid;
  selected_property uuid;
  selected_opportunity uuid;
  method_row public.crm_contact_methods;
  opted_out_row public.sms_opt_outs;
  lifecycle_value text;
  conflict_fingerprint text;
  identity_disagrees boolean := false;
BEGIN
  SELECT * INTO lead_row FROM public.leads WHERE id = target_lead_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO existing_link FROM public.crm_lead_entity_links WHERE lead_id = target_lead_id;
  phone_value := public.normalize_conversation_phone(lead_row.phone);
  email_value := public.normalize_crm_email(lead_row.email);
  address_value := public.normalize_crm_address(lead_row.property_address, lead_row.city, lead_row.state, lead_row.zip);

  IF phone_value IS NOT NULL THEN
    SELECT person_id INTO phone_person
    FROM public.crm_contact_methods
    WHERE method_type = 'phone' AND normalized_value = phone_value;
  END IF;
  IF email_value IS NOT NULL THEN
    SELECT person_id INTO email_person
    FROM public.crm_contact_methods
    WHERE method_type = 'email' AND normalized_value = email_value;
  END IF;

  selected_person := CASE
    WHEN existing_link.person_id IS NOT NULL
      AND existing_link.person_id IN (coalesce(phone_person, existing_link.person_id), coalesce(email_person, existing_link.person_id))
      THEN existing_link.person_id
    WHEN phone_person IS NOT NULL THEN phone_person
    WHEN email_person IS NOT NULL THEN email_person
    WHEN existing_link.person_id IS NOT NULL THEN existing_link.person_id
    ELSE NULL
  END;

  IF selected_person IS NULL THEN
    INSERT INTO public.crm_people(display_name)
    VALUES (coalesce(nullif(trim(lead_row.full_name), ''), 'Unknown contact'))
    RETURNING id INTO selected_person;
  ELSE
    UPDATE public.crm_people SET
      display_name = CASE
        WHEN existing_link.person_id = selected_person OR display_name = 'Unknown contact'
          THEN coalesce(nullif(trim(lead_row.full_name), ''), display_name)
        ELSE display_name
      END,
      updated_at = now()
    WHERE id = selected_person;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crm-entity-person:' || selected_person::text, 0)
  );

  IF phone_person IS NOT NULL AND email_person IS NOT NULL AND phone_person <> email_person THEN
    identity_disagrees := true;
    conflict_fingerprint := md5(
      target_lead_id::text || '|phone_email_disagree|' || phone_person::text || '|' || email_person::text
    );
    INSERT INTO public.crm_identity_conflicts(
      lead_id, conflict_type, selected_person_id, conflicting_person_id, fingerprint
    ) VALUES (
      target_lead_id, 'phone_email_disagree', selected_person,
      CASE WHEN selected_person = phone_person THEN email_person ELSE phone_person END,
      conflict_fingerprint
    ) ON CONFLICT (fingerprint) DO UPDATE SET detected_at = now();
  END IF;

  IF phone_value IS NOT NULL THEN
    SELECT * INTO opted_out_row
    FROM public.sms_opt_outs
    WHERE public.normalize_conversation_phone(phone) = phone_value
    ORDER BY updated_at DESC, id DESC
    LIMIT 1;

    INSERT INTO public.crm_contact_methods(
      person_id, method_type, raw_value, normalized_value, is_primary,
      sms_consent_status, consent_source, consent_observed_at
    ) VALUES (
      selected_person, 'phone', lead_row.phone, phone_value, false,
      CASE WHEN opted_out_row.id IS NULL THEN 'unknown'
        WHEN opted_out_row.is_opted_out THEN 'opted_out' ELSE 'opted_in' END,
      CASE WHEN opted_out_row.id IS NULL THEN NULL ELSE 'sms_opt_outs' END,
      coalesce(opted_out_row.updated_at, opted_out_row.opted_out_at, opted_out_row.opted_in_at)
    ) ON CONFLICT (method_type, normalized_value) DO UPDATE SET
      raw_value = EXCLUDED.raw_value,
      sms_consent_status = EXCLUDED.sms_consent_status,
      consent_source = EXCLUDED.consent_source,
      consent_observed_at = EXCLUDED.consent_observed_at,
      updated_at = now()
    RETURNING * INTO method_row;

    IF method_row.person_id IS NULL THEN
      UPDATE public.crm_contact_methods SET person_id = selected_person, updated_at = now()
      WHERE id = method_row.id RETURNING * INTO method_row;
    ELSIF method_row.person_id <> selected_person AND NOT identity_disagrees THEN
      conflict_fingerprint := md5(
        target_lead_id::text || '|method_claimed_elsewhere|phone|' || phone_value || '|' || method_row.person_id::text
      );
      INSERT INTO public.crm_identity_conflicts(
        lead_id, conflict_type, selected_person_id, conflicting_person_id,
        method_type, normalized_value, fingerprint
      ) VALUES (
        target_lead_id, 'method_claimed_elsewhere', selected_person, method_row.person_id,
        'phone', phone_value, conflict_fingerprint
      ) ON CONFLICT (fingerprint) DO UPDATE SET detected_at = now();
    END IF;

    IF method_row.person_id = selected_person THEN
      UPDATE public.crm_contact_methods SET is_primary = false, updated_at = now()
      WHERE person_id = selected_person AND method_type = 'phone' AND id <> method_row.id AND is_primary;
      UPDATE public.crm_contact_methods SET is_primary = true, updated_at = now() WHERE id = method_row.id;
    END IF;
  END IF;

  IF email_value IS NOT NULL THEN
    INSERT INTO public.crm_contact_methods(
      person_id, method_type, raw_value, normalized_value, is_primary, sms_consent_status
    ) VALUES (
      selected_person, 'email', lead_row.email, email_value, false, 'not_applicable'
    ) ON CONFLICT (method_type, normalized_value) DO UPDATE SET
      raw_value = EXCLUDED.raw_value, updated_at = now()
    RETURNING * INTO method_row;

    IF method_row.person_id IS NULL THEN
      UPDATE public.crm_contact_methods SET person_id = selected_person, updated_at = now()
      WHERE id = method_row.id RETURNING * INTO method_row;
    ELSIF method_row.person_id <> selected_person AND NOT identity_disagrees THEN
      conflict_fingerprint := md5(
        target_lead_id::text || '|method_claimed_elsewhere|email|' || email_value || '|' || method_row.person_id::text
      );
      INSERT INTO public.crm_identity_conflicts(
        lead_id, conflict_type, selected_person_id, conflicting_person_id,
        method_type, normalized_value, fingerprint
      ) VALUES (
        target_lead_id, 'method_claimed_elsewhere', selected_person, method_row.person_id,
        'email', email_value, conflict_fingerprint
      ) ON CONFLICT (fingerprint) DO UPDATE SET detected_at = now();
    END IF;

    IF method_row.person_id = selected_person THEN
      UPDATE public.crm_contact_methods SET is_primary = false, updated_at = now()
      WHERE person_id = selected_person AND method_type = 'email' AND id <> method_row.id AND is_primary;
      UPDATE public.crm_contact_methods SET is_primary = true, updated_at = now() WHERE id = method_row.id;
    END IF;
  END IF;

  IF address_value IS NOT NULL THEN
    INSERT INTO public.crm_properties(
      normalized_address, address, city, state, zip, county, parcel_id,
      property_type, bedrooms, bathrooms, sqft, year_built
    ) VALUES (
      address_value, lead_row.property_address, lead_row.city, lead_row.state, lead_row.zip,
      lead_row.county, lead_row.parcel_id, lead_row.property_type,
      coalesce(lead_row.bedrooms, lead_row.beds), lead_row.bathrooms, lead_row.sqft, lead_row.year_built
    ) ON CONFLICT (normalized_address) DO UPDATE SET
      address = crm_properties.address,
      city = coalesce(crm_properties.city, EXCLUDED.city),
      state = coalesce(crm_properties.state, EXCLUDED.state),
      zip = coalesce(crm_properties.zip, EXCLUDED.zip),
      county = coalesce(crm_properties.county, EXCLUDED.county),
      parcel_id = coalesce(crm_properties.parcel_id, EXCLUDED.parcel_id),
      property_type = coalesce(crm_properties.property_type, EXCLUDED.property_type),
      bedrooms = coalesce(crm_properties.bedrooms, EXCLUDED.bedrooms),
      bathrooms = coalesce(crm_properties.bathrooms, EXCLUDED.bathrooms),
      sqft = coalesce(crm_properties.sqft, EXCLUDED.sqft),
      year_built = coalesce(crm_properties.year_built, EXCLUDED.year_built),
      updated_at = now()
    RETURNING id INTO selected_property;
  END IF;

  lifecycle_value := CASE
    WHEN lead_row.station = 'closed_won' THEN 'won'
    WHEN lead_row.station = 'closed_lost' THEN 'lost'
    WHEN lead_row.station = 'dead' OR lead_row.classification = 'dead' THEN 'dead'
    WHEN lead_row.is_parked THEN 'archived'
    ELSE 'open'
  END;

  INSERT INTO public.crm_opportunities(
    source_lead_id, primary_person_id, primary_property_id, stage,
    classification, priority, owner_name, source, lifecycle_status,
    created_at, updated_at
  ) VALUES (
    target_lead_id, selected_person, selected_property, lead_row.station,
    lead_row.classification, lead_row.priority, lead_row.assigned_agent,
    lead_row.source, lifecycle_value, coalesce(lead_row.created_at, now()),
    coalesce(lead_row.updated_at, now())
  ) ON CONFLICT (source_lead_id) DO UPDATE SET
    primary_person_id = EXCLUDED.primary_person_id,
    primary_property_id = EXCLUDED.primary_property_id,
    stage = EXCLUDED.stage,
    classification = EXCLUDED.classification,
    priority = EXCLUDED.priority,
    owner_name = EXCLUDED.owner_name,
    source = EXCLUDED.source,
    lifecycle_status = EXCLUDED.lifecycle_status,
    updated_at = EXCLUDED.updated_at
  RETURNING id INTO selected_opportunity;

  INSERT INTO public.crm_opportunity_people(opportunity_id, person_id, relationship_role)
  VALUES (selected_opportunity, selected_person, 'primary_seller')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.crm_lead_entity_links(
    lead_id, person_id, property_id, opportunity_id, projection_version, projected_at
  ) VALUES (
    target_lead_id, selected_person, selected_property, selected_opportunity, 1, now()
  ) ON CONFLICT (lead_id) DO UPDATE SET
    person_id = EXCLUDED.person_id,
    property_id = EXCLUDED.property_id,
    opportunity_id = EXCLUDED.opportunity_id,
    projection_version = EXCLUDED.projection_version,
    projected_at = now();
END
$$;

REVOKE ALL ON FUNCTION public.refresh_crm_entity_for_lead_core(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_crm_entity_for_lead(target_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm-entity-lead:' || target_lead_id::text, 0));
  PERFORM public.refresh_crm_entity_for_lead_core(target_lead_id);
END
$$;

REVOKE ALL ON FUNCTION public.refresh_crm_entity_for_lead(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_crm_entity_for_lead(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trigger_refresh_crm_entity_for_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.refresh_crm_entity_for_lead(NEW.id);
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.trigger_refresh_crm_entity_for_lead() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_crm_sms_consent_from_opt_out()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  normalized_phone text;
  method_id uuid;
  event_time timestamptz;
BEGIN
  normalized_phone := public.normalize_conversation_phone(NEW.phone);
  IF normalized_phone IS NULL THEN RETURN NEW; END IF;
  event_time := coalesce(NEW.updated_at, NEW.opted_out_at, NEW.opted_in_at, now());

  INSERT INTO public.crm_contact_methods(
    method_type, raw_value, normalized_value, is_primary,
    sms_consent_status, consent_source, consent_observed_at
  ) VALUES (
    'phone', NEW.phone, normalized_phone, false,
    CASE WHEN NEW.is_opted_out THEN 'opted_out' ELSE 'opted_in' END,
    'sms_opt_outs', event_time
  ) ON CONFLICT (method_type, normalized_value) DO UPDATE SET
    raw_value = EXCLUDED.raw_value,
    sms_consent_status = EXCLUDED.sms_consent_status,
    consent_source = EXCLUDED.consent_source,
    consent_observed_at = EXCLUDED.consent_observed_at,
    updated_at = now()
  RETURNING id INTO method_id;

  INSERT INTO public.crm_consent_events(
    contact_method_id, channel, event_type, source, reason, idempotency_key, occurred_at
  ) VALUES (
    method_id, 'sms', CASE WHEN NEW.is_opted_out THEN 'opted_out' ELSE 'opted_in' END,
    'sms_opt_outs', NEW.reason,
    'sms_opt_out:' || NEW.id::text || ':' || extract(epoch FROM event_time)::text || ':' || NEW.is_opted_out::text,
    event_time
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.sync_crm_sms_consent_from_opt_out() FROM PUBLIC, anon, authenticated, service_role;

LOCK TABLE public.leads IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.sms_opt_outs IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO public.crm_contact_methods(
  method_type, raw_value, normalized_value, is_primary,
  sms_consent_status, consent_source, consent_observed_at
)
SELECT
  'phone', source.phone, source.normalized_phone, false,
  CASE WHEN source.is_opted_out THEN 'opted_out' ELSE 'opted_in' END,
  'sms_opt_outs', source.event_time
FROM (
  SELECT DISTINCT ON (public.normalize_conversation_phone(phone))
    phone,
    public.normalize_conversation_phone(phone) AS normalized_phone,
    is_opted_out,
    coalesce(updated_at, opted_out_at, opted_in_at, now()) AS event_time
  FROM public.sms_opt_outs
  WHERE public.normalize_conversation_phone(phone) IS NOT NULL
  ORDER BY public.normalize_conversation_phone(phone), updated_at DESC, id DESC
) AS source
ON CONFLICT (method_type, normalized_value) DO UPDATE SET
  raw_value = EXCLUDED.raw_value,
  sms_consent_status = EXCLUDED.sms_consent_status,
  consent_source = EXCLUDED.consent_source,
  consent_observed_at = EXCLUDED.consent_observed_at,
  updated_at = now();

INSERT INTO public.crm_consent_events(
  contact_method_id, channel, event_type, source, reason, idempotency_key, occurred_at
)
SELECT
  method.id, 'sms', CASE WHEN opt_out.is_opted_out THEN 'opted_out' ELSE 'opted_in' END,
  'sms_opt_outs', opt_out.reason,
  'sms_opt_out:' || opt_out.id::text || ':' ||
    extract(epoch FROM coalesce(opt_out.updated_at, opt_out.opted_out_at, opt_out.opted_in_at, now()))::text ||
    ':' || opt_out.is_opted_out::text,
  coalesce(opt_out.updated_at, opt_out.opted_out_at, opt_out.opted_in_at, now())
FROM public.sms_opt_outs AS opt_out
JOIN public.crm_contact_methods AS method
  ON method.method_type = 'phone'
  AND method.normalized_value = public.normalize_conversation_phone(opt_out.phone)
ON CONFLICT (idempotency_key) DO NOTHING;

DO $$
DECLARE
  lead_record record;
BEGIN
  FOR lead_record IN SELECT id FROM public.leads ORDER BY id LOOP
    PERFORM public.refresh_crm_entity_for_lead_core(lead_record.id);
  END LOOP;
END
$$;

DROP TRIGGER IF EXISTS trigger_refresh_crm_entity_for_lead ON public.leads;
CREATE TRIGGER trigger_refresh_crm_entity_for_lead
AFTER INSERT OR UPDATE OF full_name, phone, email, property_address, city, state, zip,
  county, parcel_id, property_type, bedrooms, beds, bathrooms, sqft, year_built,
  station, classification, priority, assigned_agent, source, is_parked
ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.trigger_refresh_crm_entity_for_lead();

DROP TRIGGER IF EXISTS trigger_sync_crm_sms_consent ON public.sms_opt_outs;
CREATE TRIGGER trigger_sync_crm_sms_consent
AFTER INSERT OR UPDATE OF phone, is_opted_out, opted_out_at, opted_in_at, reason, updated_at
ON public.sms_opt_outs
FOR EACH ROW EXECUTE FUNCTION public.sync_crm_sms_consent_from_opt_out();

COMMENT ON TABLE public.crm_people IS 'Canonical seller and buyer identities projected from compatibility records.';
COMMENT ON TABLE public.crm_contact_methods IS 'Normalized phone and email identities with deliverability and channel consent state.';
COMMENT ON TABLE public.crm_properties IS 'Canonical properties deduplicated by normalized postal identity.';
COMMENT ON TABLE public.crm_opportunities IS 'One acquisition opportunity per compatibility lead during the additive transition.';
COMMENT ON TABLE public.crm_lead_entity_links IS 'Compatibility bridge from leads to canonical person, property, and opportunity records.';
COMMENT ON TABLE public.crm_identity_conflicts IS 'Durable review queue for ambiguous or contradictory identity evidence.';
COMMENT ON TABLE public.crm_consent_events IS 'Append-only consent provenance for canonical contact methods.';
