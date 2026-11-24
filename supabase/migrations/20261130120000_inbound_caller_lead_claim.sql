-- Missed-call lead dedupe (handoff Item 6, 2026-11-06).
--
-- Twilio sometimes delivers two parent calls from the same caller to
-- 429-2900 within milliseconds (distinct CallSids, both 0s abandoned).
-- /api/twilio-missed-call looked the phone up, found nothing, and both
-- requests inserted a bare "Missed Call …" lead (Nov 2 ×2, Nov 5 ×1).
--
-- This RPC serializes lead creation per caller phone with a transaction
-- advisory lock and returns the existing lead when a concurrent request
-- already created one. It does NOT merge or touch existing duplicates.

CREATE OR REPLACE FUNCTION public.claim_inbound_caller_lead(
  p_phone text,
  p_full_name text,
  p_priority text DEFAULT 'hot'
)
RETURNS TABLE (lead_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_new uuid;
BEGIN
  IF p_phone IS NULL OR btrim(p_phone) = '' THEN
    RAISE EXCEPTION 'claim_inbound_caller_lead: phone required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('inbound_caller_lead:' || p_phone, 0));

  SELECT l.id INTO v_existing
  FROM public.leads l
  WHERE l.phone = p_phone
  ORDER BY l.created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT v_existing, false;
    RETURN;
  END IF;

  INSERT INTO public.leads (full_name, phone, source, station, priority)
  VALUES (p_full_name, p_phone, 'inbound_call', 'new', COALESCE(p_priority, 'hot'))
  RETURNING id INTO v_new;

  RETURN QUERY SELECT v_new, true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_inbound_caller_lead(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_inbound_caller_lead(text, text, text) TO service_role;
