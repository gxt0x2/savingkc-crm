-- A source-reported relative is a potential contact, not proof of title or authority.
ALTER TABLE public.em_party_properties DROP CONSTRAINT IF EXISTS em_party_properties_relationship_check;
ALTER TABLE public.em_party_properties ADD CONSTRAINT em_party_properties_relationship_check
 CHECK(relationship IN ('owner','representative','heir','relative','unconfirmed'));

-- Runtime has SELECT on canonical identity tables. Row locks also require
-- UPDATE privilege, so expose locking only instead of granting data writes.
CREATE OR REPLACE FUNCTION public.lock_email_crm_identity(p_workspace uuid, p_party uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE person uuid;
BEGIN
  SELECT canonical_person_id INTO person FROM public.em_parties
    WHERE workspace_id=p_workspace AND id=p_party AND identity_state='confirmed';
  IF person IS NULL THEN RETURN; END IF;
  PERFORM cp.id FROM public.crm_properties cp JOIN public.em_party_properties ep
    ON ep.canonical_property_id=cp.id WHERE ep.workspace_id=p_workspace
    AND ep.party_id=p_party AND ep.relationship IN ('owner','representative','heir','relative')
    ORDER BY cp.id FOR SHARE OF cp;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-entity-person:' || person,0));
  PERFORM id FROM public.crm_people WHERE id=person FOR UPDATE;
  PERFORM m.id FROM public.crm_contact_methods m WHERE m.person_id=person
    AND m.method_type='email' AND EXISTS (
      SELECT 1 FROM public.em_party_addresses pa JOIN public.em_addresses a ON a.id=pa.address_id
      WHERE pa.workspace_id=p_workspace AND pa.party_id=p_party
      AND pa.relationship='confirmed' AND lower(a.normalized_address)=lower(m.normalized_value)
    ) ORDER BY m.id FOR SHARE OF m;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_email_crm_identity(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_email_crm_identity(uuid,uuid) TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='email_workflow_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.lock_email_crm_identity(uuid,uuid) TO email_workflow_runtime;
  END IF;
END $$;

