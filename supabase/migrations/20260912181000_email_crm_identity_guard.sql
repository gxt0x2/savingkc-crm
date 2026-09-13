-- Serialize Email Lead creation with every other Lead insert that resolves to
-- the same known canonical person and property. This is deliberately narrower
-- than a global person/property uniqueness rule: only an Email-created Lead
-- owns a durable claim, and a terminal or parked claim permits a new intake.

DO $$
BEGIN
  IF to_regprocedure('public.normalize_crm_email(text)') IS NULL
    OR to_regprocedure('public.normalize_crm_address(text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'email CRM identity guard requires canonical CRM normalizers';
  END IF;
END
$$;

CREATE TABLE public.em_crm_identity_claims (
  person_id uuid NOT NULL REFERENCES public.crm_people(id) ON DELETE RESTRICT,
  property_id uuid NOT NULL REFERENCES public.crm_properties(id) ON DELETE RESTRICT,
  lead_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, property_id),
  CONSTRAINT em_crm_identity_claims_lead_fk
    FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE public.em_crm_identity_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.em_crm_identity_claims
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.em_crm_identity_claims
  TO service_role;

CREATE POLICY "Service role full access on em_crm_identity_claims"
  ON public.em_crm_identity_claims
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.guard_email_crm_identity_on_lead_insert_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  normalized_email_value text;
  normalized_property_value text;
  resolved_person_id uuid;
  resolved_property_id uuid;
  claimed_lead_id uuid;
  claimed_station text;
  claimed_classification text;
  claimed_is_parked boolean;
  existing_active_lead_id uuid;
  email_source boolean := lower(btrim(coalesce(NEW.source::text, ''))) = 'email_marketing';
BEGIN
  normalized_email_value := public.normalize_crm_email(NEW.email);
  normalized_property_value := public.normalize_crm_address(
    NEW.property_address,
    NEW.city,
    NEW.state,
    NEW.zip
  );

  IF normalized_email_value IS NULL OR normalized_property_value IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT method.person_id
  INTO resolved_person_id
  FROM public.crm_contact_methods AS method
  JOIN public.crm_people AS person ON person.id = method.person_id
  WHERE method.method_type = 'email'
    AND method.normalized_value = normalized_email_value
    AND person.record_status = 'active';

  IF resolved_person_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT property.id
  INTO resolved_property_id
  FROM public.crm_properties AS property
  WHERE property.normalized_address = normalized_property_value;

  IF resolved_property_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- This exact key is also acquired by the Email adapter before it searches
  -- canonical links. The lock therefore covers both race orders: a non-Email
  -- insert must finish its AFTER projection before Email can search, while an
  -- Email insert publishes its claim before another source can continue.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'email-crm-identity:' || resolved_person_id::text || ':' || resolved_property_id::text,
      0
    )
  );

  SELECT claim.lead_id
  INTO claimed_lead_id
  FROM public.em_crm_identity_claims AS claim
  WHERE claim.person_id = resolved_person_id
    AND claim.property_id = resolved_property_id
  FOR UPDATE;

  IF claimed_lead_id IS NOT NULL THEN
    -- PostgreSQL runs BEFORE INSERT triggers for the proposed row of an
    -- INSERT ... ON CONFLICT (id) DO UPDATE. A claim owned by that same id is
    -- the existing record, not a competing intake; let conflict handling run.
    IF claimed_lead_id = NEW.id THEN
      RETURN NEW;
    END IF;

    SELECT lead.station, lead.classification, lead.is_parked
    INTO claimed_station, claimed_classification, claimed_is_parked
    FROM public.leads AS lead
    WHERE lead.id = claimed_lead_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'EMAIL_CRM_IDENTITY_CLAIM_CORRUPT';
    END IF;

    IF NOT coalesce(claimed_is_parked, false)
      AND lower(btrim(coalesce(claimed_station, ''))) NOT IN (
        'closed', 'closed_won', 'closed_lost', 'dead'
      )
      AND lower(btrim(coalesce(claimed_classification, ''))) <> 'dead' THEN
      RAISE EXCEPTION 'EMAIL_CRM_IDENTITY_ALREADY_LINKED';
    END IF;

    -- A terminal or parked Email Lead no longer reserves the pair. Deleting
    -- the claim in this transaction lets the new intake proceed; rollback
    -- restores the old claim automatically if the new insert fails.
    -- hygiene-approved-destructive: transactional release of one parked or
    -- terminal Email person/property claim so a later intake can proceed.
    -- The same insert transaction rolls the claim back if the new Lead fails.
    -- No customer, message, or campaign rows are purged.
    DELETE FROM public.em_crm_identity_claims
    WHERE person_id = resolved_person_id
      AND property_id = resolved_property_id;
  END IF;

  IF email_source THEN
    -- The normal Email path already performs this search under the same lock.
    -- Repeating it here protects direct service-role inserts from bypassing the
    -- adapter and creating a duplicate against an older, unclaimed CRM Lead.
    SELECT lead.id
    INTO existing_active_lead_id
    FROM public.crm_lead_entity_links AS link
    JOIN public.leads AS lead ON lead.id = link.lead_id
    WHERE link.person_id = resolved_person_id
      AND link.property_id = resolved_property_id
      AND NOT coalesce(lead.is_parked, false)
      AND lower(btrim(coalesce(lead.station, ''))) NOT IN (
        'closed', 'closed_won', 'closed_lost', 'dead'
      )
      AND lower(btrim(coalesce(lead.classification, ''))) <> 'dead'
    -- Prefer a competing id if legacy data already contains more than one
    -- active link for the pair; the same-id upsert exception must not hide it.
    ORDER BY (lead.id = NEW.id), lead.id
    LIMIT 1
    FOR UPDATE OF lead;

    IF existing_active_lead_id = NEW.id THEN
      RETURN NEW;
    ELSIF existing_active_lead_id IS NOT NULL THEN
      RAISE EXCEPTION 'EMAIL_CRM_IDENTITY_ALREADY_LINKED';
    END IF;

    IF NEW.id IS NULL THEN
      RAISE EXCEPTION 'EMAIL_CRM_IDENTITY_LEAD_ID_REQUIRED';
    END IF;

    INSERT INTO public.em_crm_identity_claims(person_id, property_id, lead_id)
    VALUES (resolved_person_id, resolved_property_id, NEW.id);
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.guard_email_crm_identity_on_lead_insert_v1()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_email_crm_identity_on_lead_insert_v1()
  TO service_role;

CREATE TRIGGER guard_email_crm_identity_on_lead_insert
BEFORE INSERT ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.guard_email_crm_identity_on_lead_insert_v1();

COMMENT ON TABLE public.em_crm_identity_claims IS
  'Private active Email Lead claim for one canonical person/property pair; terminal or parked claims are retired by the next intake.';
COMMENT ON FUNCTION public.guard_email_crm_identity_on_lead_insert_v1() IS
  'Serializes every resolvable Lead insert with Email Lead creation without changing the inserted source.';
