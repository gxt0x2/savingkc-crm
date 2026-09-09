-- Govern explicit Mojo qualification exceptions and scheduled follow-up contacts.
--
-- A reasoned human exception may override negative-text automation while all
-- other evidence requirements remain in force. A real future follow-up creates
-- a searchable prospect shell and callback work item, but does not grant CRM
-- pipeline promotion authority.

DO $mojo_followups$
DECLARE
  wrapper_signature regprocedure := pg_catalog.to_regprocedure(
    'public.ingest_crm_mojo_call_v1(jsonb,text,timestamp with time zone,timestamp with time zone)'
  );
  wrapper_definition text;
  old_declarations constant text := $old$
  qualified_by_agent boolean := lower(coalesce(p_call->>'qualified_by_agent', 'false')) = 'true';
  negative_intent boolean;$old$;
  new_declarations constant text := $new$
  qualified_by_agent boolean := lower(coalesce(p_call->>'qualified_by_agent', 'false')) = 'true';
  qualification_override_reason text := left(
    nullif(btrim(coalesce(p_call->>'qualification_override_reason', '')), ''),
    500
  );
  negative_intent boolean;$new$;
  old_follow_up_declaration constant text := $old$
  appointment_override boolean;
  promotion_value boolean;$old$;
  new_follow_up_declaration constant text := $new$
  appointment_override boolean;
  scheduled_follow_up boolean := false;
  promotion_value boolean;$new$;
  old_promotion_assignment constant text := $old$
  appointment_override := provider_outcome = 'appointment_set' AND p_follow_up_at IS NOT NULL;
  promotion_value := requested_promotion
    AND provider_outcome IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set')
    AND NOT negative_intent
    AND ($old$;
  new_promotion_assignment constant text := $new$
  appointment_override := provider_outcome = 'appointment_set' AND p_follow_up_at IS NOT NULL;
  scheduled_follow_up := provider_outcome IN ('callback_scheduled', 'meaningful_conversation')
    AND p_follow_up_at IS NOT NULL
    AND p_follow_up_at >= clock_timestamp() - interval '5 minutes';
  promotion_value := requested_promotion
    AND provider_outcome IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set')
    AND (
      NOT negative_intent
      OR (qualified_by_agent AND qualification_override_reason IS NOT NULL)
    )
    AND ($new$;
  old_reason_branch constant text := $old$
    WHEN status_value = 'eligible' AND qualified_by_agent
      THEN ARRAY['agent_qualified', 'minimum_duration_met']::text[]$old$;
  new_reason_branch constant text := $new$
    WHEN status_value = 'eligible' AND qualified_by_agent AND negative_intent
      THEN ARRAY['agent_qualified', 'negative_intent_overridden', 'minimum_duration_met']::text[]
    WHEN status_value = 'eligible' AND qualified_by_agent
      THEN ARRAY['agent_qualified', 'minimum_duration_met']::text[]$new$;
  old_core_authority constant text :=
    'CASE WHEN promotion_value THEN provider_outcome ELSE ''other'' END';
  new_core_authority constant text :=
    'CASE WHEN promotion_value OR scheduled_follow_up THEN provider_outcome ELSE ''other'' END';
  old_activity_metadata constant text := $old$
        'qualification_reasons', to_jsonb(reasons_value)$old$;
  new_activity_metadata constant text := $new$
        'qualification_reasons', to_jsonb(reasons_value),
        'qualification_override_reason', qualification_override_reason$new$;
BEGIN
  IF wrapper_signature IS NULL THEN
    RAISE EXCEPTION 'ingest_crm_mojo_call_v1 wrapper is required before the follow-up patch';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(wrapper_signature)
  INTO wrapper_definition;

  IF pg_catalog.strpos(wrapper_definition, old_declarations) = 0
    OR pg_catalog.strpos(wrapper_definition, old_follow_up_declaration) = 0
    OR pg_catalog.strpos(wrapper_definition, old_promotion_assignment) = 0
    OR pg_catalog.strpos(wrapper_definition, old_reason_branch) = 0
    OR pg_catalog.strpos(wrapper_definition, old_core_authority) = 0
    OR pg_catalog.strpos(wrapper_definition, old_activity_metadata) = 0 THEN
    RAISE EXCEPTION 'expected Mojo qualification v1.1 function fragments were not found';
  END IF;

  wrapper_definition := pg_catalog.replace(wrapper_definition, old_declarations, new_declarations);
  wrapper_definition := pg_catalog.replace(wrapper_definition, old_follow_up_declaration, new_follow_up_declaration);
  wrapper_definition := pg_catalog.replace(wrapper_definition, old_promotion_assignment, new_promotion_assignment);
  wrapper_definition := pg_catalog.replace(wrapper_definition, old_reason_branch, new_reason_branch);
  wrapper_definition := pg_catalog.replace(wrapper_definition, old_core_authority, new_core_authority);
  wrapper_definition := pg_catalog.replace(wrapper_definition, old_activity_metadata, new_activity_metadata);
  EXECUTE wrapper_definition;
END
$mojo_followups$;

REVOKE ALL ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz)
  TO service_role;

INSERT INTO public.system_config(key, value, updated_at)
VALUES ('mojo_qualification_version', '"mojo_qualification_v1_2"'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

COMMENT ON FUNCTION public.ingest_crm_mojo_call_v1(jsonb,text,timestamptz,timestamptz) IS
  'Records Mojo evidence using qualification v1.2: reasoned human exceptions are audited, and scheduled callbacks create searchable non-pipeline contacts.';
