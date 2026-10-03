-- Read-only identity resolution. Never merge contacts or relink historic SMS.
-- Deploy this RPC before its webhook consumer; a missing RPC must be retryable.
CREATE OR REPLACE FUNCTION public.resolve_inbound_sms_lead_v1(
  p_customer_phone text,
  p_company_phone text,
  p_received_at timestamptz
)
RETURNS TABLE (
  resolution text,
  candidate_count bigint,
  lead_id uuid,
  full_name text,
  phone text,
  station text,
  priority text,
  matched_outbound_activity_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  customer_phone text := public.normalize_conversation_phone(p_customer_phone);
  company_phone text := public.normalize_conversation_phone(p_company_phone);
  candidates bigint;
  selected_lead_id uuid;
  selected_activity_id uuid;
  latest_outbound_at timestamptz;
  latest_outbound_leads bigint;
BEGIN
  IF NULLIF(btrim(p_customer_phone), '') IS NULL OR NULLIF(btrim(p_company_phone), '') IS NULL OR p_received_at IS NULL THEN
    RAISE EXCEPTION 'Customer phone, company phone and received timestamp are required'
      USING ERRCODE = '22023';
  END IF;

  -- Existing conversation normalization covers NANP. A valid signed provider
  -- receipt from an international/shortcode sender still belongs in the inbox;
  -- unsupported identity is review-only, not an endless provider retry.
  IF customer_phone IS NULL OR company_phone IS NULL THEN
    RETURN QUERY SELECT 'unsupported'::text, 0::bigint, NULL::uuid, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::uuid;
    RETURN;
  END IF;

  -- The existing idx_leads_conversation_phone expression index includes
  -- punctuation and Unicode format characters from older imports.
  SELECT count(*) INTO candidates FROM public.leads l
  WHERE public.normalize_conversation_phone(l.phone) = customer_phone;

  IF candidates = 0 THEN
    RETURN QUERY SELECT 'unknown'::text, candidates, NULL::uuid, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::uuid;
    RETURN;
  END IF;

  IF candidates = 1 THEN
    SELECT l.id INTO selected_lead_id FROM public.leads l
    WHERE public.normalize_conversation_phone(l.phone) = customer_phone;
  ELSE
    -- A provider SID proves this was an actual outbound attempt, rather than
    -- a preview, internal alert, or draft. Explicit false/failed states never
    -- establish continuity. The receiving business line must match exactly.
    WITH accepted_outbound AS (
      SELECT a.id, a.lead_id, a.created_at
      FROM public.lead_activities a
      JOIN public.leads l ON l.id = a.lead_id
      WHERE public.normalize_conversation_phone(l.phone) = customer_phone
        AND a.activity_type IN ('sms', 'sms_sent', 'sms_outbound')
        AND public.conversation_activity_direction(a.activity_type, a.metadata) = 'outbound'
        AND public.conversation_is_customer_communication(a.activity_type, a.metadata)
        AND NOT public.conversation_is_legacy_team_alert(a.activity_type, a.description, a.metadata)
        AND public.normalize_conversation_phone(a.metadata->>'from') = company_phone
        AND public.normalize_conversation_phone(a.metadata->>'to') = customer_phone
        AND a.metadata->>'message_sid' ~ '^(SM|MM)[0-9a-fA-F]{32}$'
        AND lower(COALESCE(a.metadata->>'sent', '')) NOT IN ('false', '0')
        AND lower(COALESCE(a.metadata->>'status', '')) NOT IN ('failed', 'undelivered', 'canceled', 'cancelled', 'not_sent_preview')
        AND lower(COALESCE(a.metadata->>'delivery_status', '')) NOT IN ('failed', 'undelivered', 'canceled', 'cancelled', 'not_sent_preview')
        AND a.created_at <= p_received_at
    )
    SELECT max(a.created_at) INTO latest_outbound_at FROM accepted_outbound a;

    -- Repeat the bounded candidate scope at that timestamp. Distinct contacts
    -- sharing the newest timestamp are genuinely ambiguous; UUID order is not
    -- evidence that one person owns the reply.
    SELECT count(DISTINCT a.lead_id), min(a.lead_id::text)::uuid, min(a.id::text)::uuid
      INTO latest_outbound_leads, selected_lead_id, selected_activity_id
    FROM public.lead_activities a
    JOIN public.leads l ON l.id = a.lead_id
    WHERE public.normalize_conversation_phone(l.phone) = customer_phone
      AND a.created_at = latest_outbound_at
      AND a.activity_type IN ('sms', 'sms_sent', 'sms_outbound')
      AND public.conversation_activity_direction(a.activity_type, a.metadata) = 'outbound'
      AND public.conversation_is_customer_communication(a.activity_type, a.metadata)
      AND NOT public.conversation_is_legacy_team_alert(a.activity_type, a.description, a.metadata)
      AND public.normalize_conversation_phone(a.metadata->>'from') = company_phone
      AND public.normalize_conversation_phone(a.metadata->>'to') = customer_phone
      AND a.metadata->>'message_sid' ~ '^(SM|MM)[0-9a-fA-F]{32}$'
      AND lower(COALESCE(a.metadata->>'sent', '')) NOT IN ('false', '0')
      AND lower(COALESCE(a.metadata->>'status', '')) NOT IN ('failed', 'undelivered', 'canceled', 'cancelled', 'not_sent_preview')
      AND lower(COALESCE(a.metadata->>'delivery_status', '')) NOT IN ('failed', 'undelivered', 'canceled', 'cancelled', 'not_sent_preview');

    IF latest_outbound_leads <> 1 THEN
      RETURN QUERY SELECT 'ambiguous'::text, candidates, NULL::uuid, NULL::text,
        NULL::text, NULL::text, NULL::text, NULL::uuid;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT CASE WHEN candidates = 1 THEN 'normalized_phone' ELSE 'outbound_thread' END,
    candidates, l.id, l.full_name::text, l.phone::text, l.station::text, l.priority::text,
    selected_activity_id
  FROM public.leads l WHERE l.id = selected_lead_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_inbound_sms_lead_v1(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_inbound_sms_lead_v1(text, text, timestamptz) TO service_role;
