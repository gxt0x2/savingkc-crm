-- Synthetic behavior checks for the socket-only disposable PostgreSQL cluster.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_setting('port') <> '65479' OR current_setting('listen_addresses') <> '' THEN
    RAISE EXCEPTION 'This fixture requires the isolated task database with TCP disabled';
  END IF;
END $$;
-- All test rows are rolled back. Requires the repo's minimal leads bootstrap
-- and 20261002150000_mobile_message_send_receipts migration.
BEGIN;
INSERT INTO public.leads(id,full_name) VALUES ('00000000-0000-4000-8000-000000000901','Synthetic receipt test lead');
-- The fixture owner expires synthetic leases directly. Runtime writes still
-- go through SECURITY DEFINER RPCs; service-role execution is tested below.
DO $$
DECLARE
  test_lead uuid := '00000000-0000-4000-8000-000000000901';
  claim_one jsonb;
  claim_two jsonb;
  claim_retry jsonb;
  actor_one uuid := '00000000-0000-4000-8000-000000000101';
  actor_two uuid := '00000000-0000-4000-8000-000000000102';
  token_one uuid := '00000000-0000-4000-8000-000000000201';
  token_two uuid := '00000000-0000-4000-8000-000000000202';
  token_three uuid := '00000000-0000-4000-8000-000000000203';
  key_one text := repeat('a',64);
  key_sms text := repeat('b',64);
  provider_key text := 'fixture-provider-key';
BEGIN
  claim_one := public.claim_mobile_message_send_v1(actor_one,key_one,test_lead,'email',repeat('c',64),token_one,provider_key);
  IF claim_one->>'kind' <> 'reserved' THEN RAISE EXCEPTION 'first claim was not reserved: %',claim_one; END IF;
  claim_two := public.claim_mobile_message_send_v1(actor_one,key_one,test_lead,'email',repeat('c',64),token_two,provider_key);
  IF claim_two->>'kind' <> 'pending' THEN RAISE EXCEPTION 'active duplicate claim was not fenced: %',claim_two; END IF;
  claim_two := public.claim_mobile_message_send_v1(actor_one,key_one,test_lead,'email',repeat('d',64),token_two,provider_key);
  IF claim_two->>'kind' <> 'conflict' THEN RAISE EXCEPTION 'changed fingerprint was not rejected: %',claim_two; END IF;
  claim_two := public.claim_mobile_message_send_v1(actor_two,key_one,test_lead,'email',repeat('c',64),token_two,'other-provider-key');
  IF claim_two->>'kind' <> 'reserved' THEN RAISE EXCEPTION 'different actor was not isolated: %',claim_two; END IF;

  IF NOT public.transition_mobile_message_send_v1(actor_one,key_one,token_one,'reserved','sending',NULL,0,'{}'::jsonb) THEN
    RAISE EXCEPTION 'reserved->sending transition failed';
  END IF;
  UPDATE public.mobile_message_send_receipts SET lease_expires_at=clock_timestamp()-interval '1 second'
    WHERE actor_user_id=actor_one AND idempotency_key_hash=key_one;
  claim_retry := public.claim_mobile_message_send_v1(actor_one,key_one,test_lead,'email',repeat('c',64),token_three,provider_key);
  IF claim_retry->>'kind' <> 'recovered' OR claim_retry->>'state' <> 'sending' THEN
    RAISE EXCEPTION 'expired email attempt was not recoverable within provider window: %',claim_retry;
  END IF;
  IF public.transition_mobile_message_send_v1(actor_one,key_one,token_one,'sending','provider_accepted','email-id',202,'{"sent":true}'::jsonb) THEN
    RAISE EXCEPTION 'superseded claim token transitioned the email receipt';
  END IF;
  IF NOT public.transition_mobile_message_send_v1(actor_one,key_one,token_three,'sending','provider_accepted','email-id',202,'{"sent":true}'::jsonb) THEN
    RAISE EXCEPTION 'recovered claim could not persist provider acceptance';
  END IF;
  IF NOT public.transition_mobile_message_send_v1(actor_one,key_one,token_three,'provider_accepted','completed','email-id',200,'{"sent":true,"persisted":true}'::jsonb) THEN
    RAISE EXCEPTION 'accepted email receipt could not complete';
  END IF;
  claim_two := public.claim_mobile_message_send_v1(actor_one,key_one,test_lead,'email',repeat('c',64),token_two,provider_key);
  IF claim_two->>'kind' <> 'replay' OR (claim_two->>'status')::int <> 200 THEN
    RAISE EXCEPTION 'completed command did not replay its stored response: %',claim_two;
  END IF;

  claim_one := public.claim_mobile_message_send_v1(actor_one,key_sms,test_lead,'sms',repeat('e',64),token_one,'sms-provider-key');
  IF claim_one->>'kind' <> 'reserved' THEN RAISE EXCEPTION 'SMS first claim failed: %',claim_one; END IF;
  IF NOT public.transition_mobile_message_send_v1(actor_one,key_sms,token_one,'reserved','sending',NULL,0,'{}'::jsonb) THEN
    RAISE EXCEPTION 'SMS reserved->sending transition failed';
  END IF;
  UPDATE public.mobile_message_send_receipts SET lease_expires_at=clock_timestamp()-interval '1 second'
    WHERE actor_user_id=actor_one AND idempotency_key_hash=key_sms;
  claim_retry := public.claim_mobile_message_send_v1(actor_one,key_sms,test_lead,'sms',repeat('e',64),token_three,'sms-provider-key');
  IF claim_retry->>'kind' <> 'recovered' OR claim_retry->>'state' <> 'sending' THEN
    RAISE EXCEPTION 'stale SMS claim was not reserved for no-send reconciliation: %',claim_retry;
  END IF;
  IF NOT public.transition_mobile_message_send_v1(actor_one,key_sms,token_three,'sending','uncertain',NULL,409,
    '{"error":"SMS delivery outcome is unknown. Do not resend this command."}'::jsonb) THEN
    RAISE EXCEPTION 'stale SMS claim could not be made terminal without a canonical activity';
  END IF;
  claim_two := public.claim_mobile_message_send_v1(actor_one,key_sms,test_lead,'sms',repeat('e',64),token_two,'sms-provider-key');
  IF claim_two->>'kind' <> 'replay' OR (claim_two->>'status')::int <> 409
    OR claim_two#>>'{result,error}' NOT LIKE '%unknown%' THEN
    RAISE EXCEPTION 'ambiguous SMS receipt did not replay as uncertain: %',claim_two;
  END IF;

  claim_one := public.claim_mobile_message_send_v1(actor_one,repeat('f',64),test_lead,'email',repeat('1',64),token_one,'expired-provider-key');
  IF claim_one->>'kind' <> 'reserved' THEN RAISE EXCEPTION 'expired-window email fixture claim failed'; END IF;
  IF NOT public.transition_mobile_message_send_v1(actor_one,repeat('f',64),token_one,'reserved','sending',NULL,0,'{}'::jsonb) THEN
    RAISE EXCEPTION 'expired-window email transition failed';
  END IF;
  UPDATE public.mobile_message_send_receipts SET provider_attempt_at=clock_timestamp()-interval '23 hours 1 second',
    lease_expires_at=clock_timestamp()-interval '1 second'
    WHERE actor_user_id=actor_one AND idempotency_key_hash=repeat('f',64);
  claim_retry := public.claim_mobile_message_send_v1(actor_one,repeat('f',64),test_lead,'email',repeat('1',64),token_three,'expired-provider-key');
  IF claim_retry->>'kind' <> 'replay' OR (claim_retry->>'status')::int <> 409 THEN
    RAISE EXCEPTION 'email beyond conservative replay window was not terminal: %',claim_retry;
  END IF;
END $$;
RESET ROLE;

DO $$
DECLARE command_id text := '00000000-0000-4000-8000-000000000990';
BEGIN
  INSERT INTO public.lead_activities (lead_id,activity_type,description,metadata)
    VALUES ('00000000-0000-4000-8000-000000000901','email','Synthetic command activity',
      jsonb_build_object('direction','outbound','mobile_message_command_id',command_id));
  BEGIN
    INSERT INTO public.lead_activities (lead_id,activity_type,description,metadata)
      VALUES ('00000000-0000-4000-8000-000000000901','email','Duplicate synthetic command activity',
        jsonb_build_object('direction','outbound','mobile_message_command_id',command_id));
    RAISE EXCEPTION 'duplicate command activity was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
SET LOCAL ROLE anon;
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.claim_mobile_message_send_v1(
      '00000000-0000-4000-8000-000000000111',repeat('a',64),
      '00000000-0000-4000-8000-000000000901','email',repeat('c',64),
      '00000000-0000-4000-8000-000000000211','fixture-provider-key');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'public role unexpectedly executed receipt RPC'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$
DECLARE denied boolean := false; authorized_claim jsonb;
BEGIN
  authorized_claim := public.claim_mobile_message_send_v1(
    '00000000-0000-4000-8000-000000000111',repeat('a',64),
    '00000000-0000-4000-8000-000000000901','email',repeat('c',64),
    '00000000-0000-4000-8000-000000000211','fixture-provider-key');
  IF authorized_claim->>'kind' <> 'reserved' THEN RAISE EXCEPTION 'service role could not execute receipt RPC'; END IF;
  BEGIN
    PERFORM public.claim_mobile_message_send_v1(
      '00000000-0000-4000-8000-000000000111',NULL,
      '00000000-0000-4000-8000-000000000901','email',repeat('c',64),
      '00000000-0000-4000-8000-000000000211','fixture-provider-key');
  EXCEPTION WHEN raise_exception THEN denied := SQLERRM='mobile_message_send_invalid_claim';
  END;
  IF NOT denied THEN RAISE EXCEPTION 'NULL key hash was not rejected'; END IF;
END $$;
ROLLBACK;
