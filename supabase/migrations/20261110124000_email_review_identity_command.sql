-- Keep canonical tables read-only to the email runtime. This command only
-- resolves an existing audience row for an active owner/marketer.
CREATE OR REPLACE FUNCTION public.resolve_email_review_identity(
 p_workspace uuid,p_actor uuid,p_row uuid,p_property text,p_evidence jsonb
) RETURNS TABLE(person_id uuid,property_id uuid,property_address text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE recipient record; method record; person uuid; property record; normalized text; matches integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.em_memberships m JOIN public.agent_profiles a ON a.id=m.agent_profile_id
  WHERE m.workspace_id=p_workspace AND m.auth_user_id=p_actor AND m.active AND m.roles && ARRAY['owner','marketer']::text[]
   AND a.is_active IS DISTINCT FROM false AND (a.user_id IS NULL OR a.user_id=p_actor)) THEN
  RAISE EXCEPTION 'FORBIDDEN';
 END IF;
 IF length(trim(p_property)) NOT BETWEEN 3 AND 500 OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence)=0 THEN
  RAISE EXCEPTION 'IDENTITY_AND_PROPERTY_REQUIRED';
 END IF;
 SELECT p.display_name,a.normalized_address INTO recipient
 FROM public.em_snapshot_rows r JOIN public.em_audience_snapshots s ON s.id=r.snapshot_id AND s.workspace_id=r.workspace_id
 JOIN public.em_parties p ON p.id=r.party_id AND p.workspace_id=r.workspace_id
 JOIN public.em_addresses a ON a.id=r.address_id AND a.workspace_id=r.workspace_id
 WHERE r.workspace_id=p_workspace AND r.id=p_row AND s.id=(SELECT ss.id FROM public.em_audience_snapshots ss WHERE ss.workspace_id=p_workspace AND ss.audience_id=s.audience_id ORDER BY ss.source_revision DESC LIMIT 1);
 IF NOT FOUND THEN RAISE EXCEPTION 'RECIPIENT_NOT_FOUND'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-review-email:'||recipient.normalized_address,0));
 SELECT m.id,m.person_id INTO method FROM public.crm_contact_methods m WHERE m.method_type='email' AND m.normalized_value=recipient.normalized_address FOR UPDATE;
 person:=method.person_id;
 IF person IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.crm_people p WHERE p.id=person AND p.record_status='active' AND lower(trim(p.display_name))=lower(trim(recipient.display_name))) THEN
  RAISE EXCEPTION 'CONTACT_IDENTITY_CONFLICT';
 END IF;
 IF person IS NULL THEN
  INSERT INTO public.crm_people(display_name) VALUES(recipient.display_name) RETURNING id INTO person;
  IF method.id IS NOT NULL THEN
   UPDATE public.crm_contact_methods SET person_id=person,is_primary=true,updated_at=now() WHERE id=method.id;
  ELSE
   INSERT INTO public.crm_contact_methods(person_id,method_type,raw_value,normalized_value,label,is_primary,sms_consent_status,consent_source)
   VALUES(person,'email',recipient.normalized_address,recipient.normalized_address,'reviewed campaign contact',true,'not_applicable','Reviewed source evidence; no consent inferred');
  END IF;
 END IF;
 normalized:=trim(regexp_replace(lower(trim(p_property)),'[^a-z0-9]+',' ','g'));
 PERFORM pg_advisory_xact_lock(hashtextextended('crm-review-property:'||normalized,0));
 SELECT count(*) INTO matches FROM public.crm_properties cp WHERE lower(cp.address)=lower(trim(p_property)) OR cp.normalized_address=normalized;
 IF matches>1 THEN RAISE EXCEPTION 'PROPERTY_AMBIGUOUS'; END IF;
 SELECT cp.id,cp.address INTO property FROM public.crm_properties cp WHERE lower(cp.address)=lower(trim(p_property)) OR cp.normalized_address=normalized FOR SHARE;
 IF NOT FOUND THEN
  INSERT INTO public.crm_properties(normalized_address,address) VALUES(normalized,trim(p_property)) RETURNING id,address INTO property;
 END IF;
 RETURN QUERY SELECT person,property.id,property.address;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_email_review_identity(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_email_review_identity(uuid,uuid,uuid,text,jsonb) TO service_role;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='email_workflow_runtime') THEN
 GRANT EXECUTE ON FUNCTION public.resolve_email_review_identity(uuid,uuid,uuid,text,jsonb) TO email_workflow_runtime;
END IF; END $$;
