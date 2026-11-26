-- A Mojo "Callback Requested" with a real contact name opens the same
-- searchable non-pipeline identity shell as a scheduled callback, even when
-- follow_up_at is null. promotion_eligible stays false and the
-- callback_without_scheduled_time reason stays in place. A Mojo lead_exists
-- flag with a real name uses that same shell.
--
-- DNC outcomes, DNC dispositions, and TCPA opt-outs (sms_opt_outs) do not open
-- the shell. Phone identity matching in ingest_crm_mojo_call_core_v1 is
-- unchanged: an invalid phone, a duplicate phone, or an existing lead still
-- resolves exactly as before. Service-area classification is not part of this
-- function and is not modified. This migration does not read or write
-- mojo_call_queue and does not backfill existing leads or call events.

DO $mojo_named_shell$
DECLARE
  governed_signature regprocedure := pg_catalog.to_regprocedure(
    'public.ingest_crm_mojo_call_governed_v1(jsonb,text,timestamp with time zone,timestamp with time zone)'
  );
  core_signature regprocedure := pg_catalog.to_regprocedure(
    'public.ingest_crm_mojo_call_core_v1(jsonb,text,timestamp with time zone,timestamp with time zone)'
  );
  governed_definition text;
  core_definition text;
  old_declaration constant text := $old$
  scheduled_follow_up boolean := false;
  promotion_value boolean;$old$;
  new_declaration constant text := $new$
  scheduled_follow_up boolean := false;
  named_identity_shell boolean := false;
  promotion_value boolean;$new$;
  old_core_call constant text := $old$
  -- The retained core function receives only the enforced outcome. This keeps
  -- old callers fail-closed: `other` never creates a lead shell.
  core_result := public.ingest_crm_mojo_call_core_v1(
    p_call,
    CASE WHEN promotion_value OR scheduled_follow_up THEN provider_outcome ELSE 'other' END,
    p_call_at,
    p_follow_up_at
  );$old$;
  new_core_call constant text := $new$
  -- Named callback requests, and Mojo rows with lead_exists, get the same
  -- searchable shell as a scheduled follow-up. Passing the provider outcome
  -- through (instead of downgrading it to "other") keeps a known name from
  -- being stored as unknown_contact. Promotion is still promotion_value only.
  named_identity_shell :=
    nullif(btrim(coalesce(p_call->>'contact_name', '')), '') IS NOT NULL
    AND lower(btrim(p_call->>'contact_name')) NOT IN ('unknown', 'mojo lead')
    AND provider_outcome IS DISTINCT FROM 'dnc'
    AND lower(coalesce(p_call->>'disposition', '')) NOT LIKE '%dnc%'
    AND lower(coalesce(p_call->>'disposition', '')) NOT LIKE '%do not call%'
    AND NOT EXISTS (
      SELECT 1
      FROM public.sms_opt_outs AS opt_out
      WHERE opt_out.is_opted_out IS TRUE
        AND public.normalize_conversation_phone(opt_out.phone)
          = public.normalize_conversation_phone(p_call->>'phone_number')
    )
    AND (
      (provider_outcome = 'callback_scheduled' AND p_follow_up_at IS NULL)
      OR CASE
        WHEN p_call->'lead_exists' IS NULL OR jsonb_typeof(p_call->'lead_exists') = 'null' THEN false
        WHEN jsonb_typeof(p_call->'lead_exists') = 'boolean' THEN (p_call->>'lead_exists')::boolean
        ELSE lower(btrim(coalesce(p_call->>'lead_exists', ''))) IN ('true', 't', '1', 'yes')
      END
    );
  IF named_identity_shell
    AND provider_outcome NOT IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set') THEN
    p_call := jsonb_set(p_call, '{named_identity_shell}', 'true'::jsonb, true);
  ELSE
    p_call := p_call - 'named_identity_shell';
  END IF;
  core_result := public.ingest_crm_mojo_call_core_v1(
    p_call,
    CASE
      WHEN promotion_value OR scheduled_follow_up OR named_identity_shell THEN provider_outcome
      ELSE 'other'
    END,
    p_call_at,
    p_follow_up_at
  );$new$;
  old_shell_branch constant text := $old$
    ELSIF p_outcome IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set')
      AND name_value IS NOT NULL
      AND lower(name_value) NOT IN ('unknown', 'mojo lead') THEN$old$;
  new_shell_branch constant text := $new$
    ELSIF (
        p_outcome IN ('callback_scheduled', 'meaningful_conversation', 'appointment_set')
        OR (
          coalesce(p_call->>'named_identity_shell', '') = 'true'
          AND p_outcome IS DISTINCT FROM 'dnc'
        )
      )
      AND name_value IS NOT NULL
      AND lower(name_value) NOT IN ('unknown', 'mojo lead') THEN$new$;
  governed_done boolean;
  core_done boolean;
BEGIN
  IF governed_signature IS NULL OR core_signature IS NULL THEN
    RAISE EXCEPTION 'mojo governed ingest functions are required before the named callback shell patch';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(governed_signature) INTO governed_definition;
  SELECT pg_catalog.pg_get_functiondef(core_signature) INTO core_definition;

  governed_done := pg_catalog.strpos(governed_definition, 'named_identity_shell boolean := false') > 0;
  core_done := pg_catalog.strpos(core_definition, 'p_call->>''named_identity_shell''') > 0;

  IF governed_done AND core_done THEN
    NULL;
  ELSIF governed_done OR core_done THEN
    RAISE EXCEPTION 'mojo named identity shell patch is partially applied';
  ELSIF pg_catalog.strpos(governed_definition, old_declaration) = 0
    OR pg_catalog.strpos(governed_definition, old_core_call) = 0
    OR pg_catalog.strpos(core_definition, old_shell_branch) = 0 THEN
    RAISE EXCEPTION 'expected Mojo qualification v1.2 function fragments were not found';
  ELSE
    governed_definition := pg_catalog.replace(governed_definition, old_declaration, new_declaration);
    governed_definition := pg_catalog.replace(governed_definition, old_core_call, new_core_call);
    core_definition := pg_catalog.replace(core_definition, old_shell_branch, new_shell_branch);
    EXECUTE governed_definition;
    EXECUTE core_definition;
  END IF;
END
$mojo_named_shell$;

REVOKE ALL ON FUNCTION public.ingest_crm_mojo_call_core_v1(jsonb,text,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.ingest_crm_mojo_call_governed_v1(jsonb,text,timestamptz,timestamptz)
  FROM PUBLIC, anon, authenticated;

INSERT INTO public.system_config(key, value, updated_at)
VALUES ('mojo_qualification_version', '"mojo_qualification_v1_3"'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

COMMENT ON FUNCTION public.ingest_crm_mojo_call_governed_v1(jsonb,text,timestamptz,timestamptz) IS
  'Records Mojo evidence using qualification v1.3. A named callback request or Mojo lead_exists row creates a searchable non-pipeline contact even without a follow-up time. Promotion stays fail-closed, and DNC outcomes plus TCPA opt-outs do not open that shell.';
