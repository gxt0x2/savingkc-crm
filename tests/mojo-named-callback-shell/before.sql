INSERT INTO public.leads (id, full_name, phone, station, priority, source)
VALUES (
  '10000000-0000-4000-8000-0000000000aa',
  'Untouched Seller',
  '+18165551999',
  'new',
  'normal',
  'manual'
);

INSERT INTO public.rehearsal_notes(key, value)
SELECT 'sentinel', to_jsonb(lead)
FROM public.leads AS lead
WHERE lead.id = '10000000-0000-4000-8000-0000000000aa';

DO $before$
DECLARE
  undated jsonb;
  dated jsonb;
BEGIN
  undated := public.rehearse_mojo_ingest(
    'before-undated', 'Pat Seller', '8165551001', 'callback_scheduled', 'Callback Requested', NULL, NULL
  );
  PERFORM public.rehearse_expect(undated->>'leadId' IS NULL, 'pre-patch undated callback created a lead', undated);
  PERFORM public.rehearse_expect(
    undated->>'unresolvedReason' = 'unknown_contact',
    'pre-patch undated callback was not labeled unknown_contact',
    undated
  );

  dated := public.rehearse_mojo_ingest(
    'before-dated', 'Pat Seller', '8165551002', 'callback_scheduled', 'Callback Requested',
    clock_timestamp() + interval '3 days', NULL
  );
  PERFORM public.rehearse_expect(dated->>'leadId' IS NOT NULL, 'pre-patch dated callback did not create a shell', dated);
  PERFORM public.rehearse_expect(dated->>'promotionEligible' = 'false', 'pre-patch dated callback was promoted', dated);
  PERFORM public.rehearse_expect(dated->>'unresolvedReason' IS NULL, 'pre-patch dated callback was unresolved', dated);
  INSERT INTO public.rehearsal_notes(key, value) VALUES (
    'dated-before',
    jsonb_build_object(
      'promotionEligible', dated->>'promotionEligible',
      'qualificationStatus', dated->>'qualificationStatus',
      'qualificationReasons', dated->'qualificationReasons',
      'unresolvedReason', dated->>'unresolvedReason'
    )
  );
END
$before$;
