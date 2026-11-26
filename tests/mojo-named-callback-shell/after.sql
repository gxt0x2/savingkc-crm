DO $after$
DECLARE
  result jsonb;
  again jsonb;
  lead_id uuid;
  lead_count integer;
  event_count integer;
  dated_before jsonb;
BEGIN
  PERFORM public.rehearse_expect(
    (SELECT to_jsonb(lead) FROM public.leads AS lead WHERE lead.id = '10000000-0000-4000-8000-0000000000aa')
      IS NOT DISTINCT FROM (SELECT value FROM public.rehearsal_notes WHERE key = 'sentinel'),
    'migration changed an unrelated lead'
  );
  PERFORM public.rehearse_expect(
    (SELECT value FROM public.system_config WHERE key = 'mojo_qualification_version')
      = '"mojo_qualification_v1_3"'::jsonb,
    'qualification version was not advanced'
  );
  PERFORM public.rehearse_expect(
    pg_catalog.to_regclass('public.mojo_call_queue') IS NULL,
    'mojo_call_queue was created'
  );
  PERFORM public.rehearse_expect(
    pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.ingest_crm_mojo_call_governed_v1(jsonb,text,timestamptz,timestamptz)'::regprocedure), 'callback_without_scheduled_time') > 0
      AND pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.ingest_crm_mojo_call_governed_v1(jsonb,text,timestamptz,timestamptz)'::regprocedure), 'named_identity_shell') > 0,
    'governed function lost the ineligible callback reason or the shell gate'
  );

  result := public.rehearse_mojo_ingest(
    'after-undated', 'Pat Seller', '8165551003', 'callback_scheduled', 'Callback Requested', NULL, NULL
  );
  PERFORM public.rehearse_expect(result->>'leadId' IS NOT NULL, 'named callback without a date did not create a shell', result);
  PERFORM public.rehearse_expect(result->>'promotionEligible' = 'false', 'named callback without a date was promoted', result);
  PERFORM public.rehearse_expect(result->>'qualificationStatus' = 'ineligible', 'named callback without a date changed qualification', result);
  PERFORM public.rehearse_expect(
    result->'qualificationReasons' = '["callback_without_scheduled_time"]'::jsonb,
    'named callback without a date lost callback_without_scheduled_time',
    result
  );
  PERFORM public.rehearse_expect(result->>'unresolvedReason' IS NULL, 'named callback was labeled unknown_contact', result);
  PERFORM public.rehearse_expect(result->>'outcome' = 'callback_scheduled', 'provider outcome was downgraded', result);
  PERFORM public.rehearse_expect(
    EXISTS (
      SELECT 1 FROM public.leads AS lead
      WHERE lead.id = (result->>'leadId')::uuid
        AND lead.station = 'new'
        AND lead.source = 'mojo_call'
        AND lead.full_name = 'Pat Seller'
    ),
    'shell was not a searchable non-pipeline contact',
    result
  );
  SELECT count(*) INTO lead_count
  FROM public.leads
  WHERE public.normalize_conversation_phone(phone) = '+18165551003';
  PERFORM public.rehearse_expect(lead_count = 1, 'undated callback created more than one lead', to_jsonb(lead_count));

  lead_id := (result->>'leadId')::uuid;
  again := public.rehearse_mojo_ingest(
    'after-undated', 'Pat Seller', '8165551003', 'callback_scheduled', 'Callback Requested', NULL, NULL
  );
  PERFORM public.rehearse_expect(again->>'replayed' = 'true', 're-ingest was not a replay', again);
  PERFORM public.rehearse_expect((again->>'leadId')::uuid = lead_id, 're-ingest returned a different lead', again);
  SELECT count(*) INTO lead_count FROM public.leads WHERE public.normalize_conversation_phone(phone) = '+18165551003';
  SELECT count(*) INTO event_count FROM public.crm_mojo_call_events WHERE record_id = 'after-undated';
  PERFORM public.rehearse_expect(lead_count = 1 AND event_count = 1, 're-ingest duplicated the lead or event', jsonb_build_object('leads', lead_count, 'events', event_count));

  dated_before := (SELECT value FROM public.rehearsal_notes WHERE key = 'dated-before');
  result := public.rehearse_mojo_ingest(
    'after-dated', 'Pat Seller', '8165551004', 'callback_scheduled', 'Callback Requested',
    clock_timestamp() + interval '3 days', NULL
  );
  PERFORM public.rehearse_expect(result->>'leadId' IS NOT NULL, 'dated callback stopped creating a shell', result);
  PERFORM public.rehearse_expect(result->>'promotionEligible' = dated_before->>'promotionEligible', 'dated callback promotion changed', result);
  PERFORM public.rehearse_expect(result->>'qualificationStatus' = dated_before->>'qualificationStatus', 'dated callback status changed', result);
  PERFORM public.rehearse_expect(result->'qualificationReasons' = dated_before->'qualificationReasons', 'dated callback reasons changed', result);
  PERFORM public.rehearse_expect(result->>'unresolvedReason' IS NULL, 'dated callback became unresolved', result);

  result := public.rehearse_mojo_ingest(
    'after-past', 'Pat Seller', '8165551005', 'callback_scheduled', 'Callback Requested',
    timestamptz '2020-01-01 15:00:00+00', NULL
  );
  PERFORM public.rehearse_expect(result->>'leadId' IS NULL, 'past callback date started creating a shell', result);

  result := public.rehearse_mojo_ingest(
    'after-noname', '', '8165551006', 'callback_scheduled', 'Callback Requested', NULL, NULL
  );
  PERFORM public.rehearse_expect(
    result->>'leadId' IS NULL AND result->>'unresolvedReason' = 'unknown_contact',
    'callback without a name created a shell',
    result
  );
  result := public.rehearse_mojo_ingest(
    'after-unknown', 'Unknown', '8165551007', 'callback_scheduled', 'Callback Requested', NULL, NULL
  );
  PERFORM public.rehearse_expect(result->>'leadId' IS NULL, 'placeholder Unknown created a shell', result);
  result := public.rehearse_mojo_ingest(
    'after-mojo-lead', 'Mojo Lead', '8165551012', 'callback_scheduled', 'Callback Requested', NULL, NULL
  );
  PERFORM public.rehearse_expect(result->>'leadId' IS NULL, 'placeholder Mojo Lead created a shell', result);

  result := public.rehearse_mojo_ingest(
    'after-dnc', 'Pat Seller', '8165551013', 'dnc', 'DNC Number', NULL, true
  );
  PERFORM public.rehearse_expect(result->>'leadId' IS NULL, 'DNC outcome created a shell', result);
  result := public.rehearse_mojo_ingest(
    'after-dnc-label', 'Pat Seller', '8165551014', 'callback_scheduled', 'DNC Number', NULL, true
  );
  PERFORM public.rehearse_expect(result->>'leadId' IS NULL, 'DNC disposition created a shell', result);

  INSERT INTO public.sms_opt_outs(phone, is_opted_out, reason)
  VALUES ('+18165551008', true, 'STOP'), ('+18165551009', true, 'STOP');
  result := public.rehearse_mojo_ingest(
    'after-optout', 'Pat Seller', '8165551008', 'callback_scheduled', 'Callback Requested', NULL, NULL
  );
  PERFORM public.rehearse_expect(result->>'leadId' IS NULL, 'TCPA opt-out created a shell', result);
  result := public.rehearse_mojo_ingest(
    'after-optout-dated', 'Pat Seller', '8165551009', 'callback_scheduled', 'Callback Requested',
    clock_timestamp() + interval '3 days', NULL
  );
  PERFORM public.rehearse_expect(result->>'leadId' IS NOT NULL, 'dated callback on an opt-out changed', result);
  PERFORM public.rehearse_expect(result->>'promotionEligible' = 'false', 'dated opt-out callback was promoted', result);

  INSERT INTO public.leads(id, full_name, phone, source, station, priority)
  VALUES ('20000000-0000-4000-8000-000000000010', 'Already Known', '+18165551010', 'manual', 'contacted', 'normal');
  result := public.rehearse_mojo_ingest(
    'after-existing', 'Pat Seller', '(816) 555-1010', 'callback_scheduled', 'Callback Requested', NULL, NULL
  );
  PERFORM public.rehearse_expect((result->>'leadId')::uuid = '20000000-0000-4000-8000-000000000010', 'existing phone was not reused', result);
  SELECT count(*) INTO lead_count FROM public.leads WHERE public.normalize_conversation_phone(phone) = '+18165551010';
  PERFORM public.rehearse_expect(lead_count = 1, 'existing phone created a duplicate lead', to_jsonb(lead_count));
  PERFORM public.rehearse_expect(
    (SELECT station FROM public.leads WHERE id = '20000000-0000-4000-8000-000000000010') = 'contacted',
    'existing lead was replaced with a new shell'
  );

  INSERT INTO public.leads(full_name, phone, source, station, priority)
  VALUES
    ('First Duplicate', '+18165551011', 'manual', 'new', 'normal'),
    ('Second Duplicate', '8165551011', 'manual', 'new', 'normal');
  result := public.rehearse_mojo_ingest(
    'after-duplicate', 'Pat Seller', '8165551011', 'callback_scheduled', 'Callback Requested', NULL, NULL
  );
  PERFORM public.rehearse_expect(
    result->>'leadId' IS NULL AND result->>'unresolvedReason' = 'duplicate_phone',
    'duplicate phone identity check changed',
    result
  );
  SELECT count(*) INTO lead_count FROM public.leads WHERE public.normalize_conversation_phone(phone) = '+18165551011';
  PERFORM public.rehearse_expect(lead_count = 2, 'duplicate phone created another lead', to_jsonb(lead_count));

  result := public.rehearse_mojo_ingest(
    'after-lead-exists', 'Pat Seller', '8165551015', 'no_answer', 'No Answer', NULL, true
  );
  PERFORM public.rehearse_expect(result->>'leadId' IS NOT NULL, 'lead_exists with a name did not create a shell', result);
  PERFORM public.rehearse_expect(result->>'promotionEligible' = 'false', 'lead_exists shell was promoted', result);
  PERFORM public.rehearse_expect(result->>'outcome' = 'no_answer', 'lead_exists changed the provider outcome', result);
  PERFORM public.rehearse_expect(result->>'unresolvedReason' IS NULL, 'lead_exists shell was labeled unknown_contact', result);

  result := public.rehearse_mojo_ingest(
    'after-not-a-lead', 'Pat Seller', '8165551016', 'no_answer', 'No Answer', NULL, false
  );
  PERFORM public.rehearse_expect(result->>'leadId' IS NULL, 'named no-answer without lead_exists created a shell', result);
END
$after$;

SET ROLE anon;
DO $anon$
BEGIN
  BEGIN
    PERFORM public.ingest_crm_mojo_call_v1('{}'::jsonb, 'other', timestamptz '2026-11-19 18:00:00+00', NULL);
    RAISE EXCEPTION 'anon was allowed to ingest';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$anon$;
RESET ROLE;

SET ROLE service_role;
DO $core_locked$
BEGIN
  BEGIN
    PERFORM public.ingest_crm_mojo_call_core_v1('{}'::jsonb, 'other', timestamptz '2026-11-19 18:00:00+00', NULL);
    RAISE EXCEPTION 'service_role was allowed to call the core ingest';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$core_locked$;
RESET ROLE;

SELECT 'PASS: named callback shell, dated callback unchanged, no-name, DNC, opt-out, dedupe, and replay' AS result;
