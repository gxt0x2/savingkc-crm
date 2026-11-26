CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text,
  phone text,
  email text,
  property_address text,
  city text,
  state text,
  zip text,
  source text,
  station text DEFAULT 'new',
  priority text DEFAULT 'normal',
  assigned_agent text,
  classification text,
  mojo_record_id text,
  call_result text,
  call_duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  activity_type text NOT NULL,
  description text,
  agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL
);

CREATE TABLE public.prospect_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  phone text
);

CREATE TABLE public.agent_daily_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL,
  date date NOT NULL,
  calls_made integer DEFAULT 0,
  meaningful_conversations integer DEFAULT 0,
  dispositions_logged integer DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (agent_id, date)
);

CREATE TABLE public.crm_mojo_call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id text NOT NULL UNIQUE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  activity_id uuid REFERENCES public.lead_activities(id) ON DELETE SET NULL,
  call_at timestamptz NOT NULL,
  normalized_phone text,
  contact_name text,
  property_address text,
  city text,
  state text,
  zip text,
  email text,
  duration_seconds integer NOT NULL DEFAULT 0,
  disposition_raw text NOT NULL,
  outcome text NOT NULL,
  agent_name text,
  agent_key text NOT NULL,
  notes text,
  list_name text,
  campaign_name text,
  recording_url text,
  follow_up_at timestamptz,
  unresolved_reason text,
  provider_contact_id text,
  provider_recording_id text,
  promotion_eligible boolean NOT NULL DEFAULT false,
  qualification_status text NOT NULL DEFAULT 'not_applicable',
  qualification_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  recording_processing_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sms_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  is_opted_out boolean NOT NULL DEFAULT true,
  opted_out_at timestamptz NOT NULL DEFAULT now(),
  reason text
);

CREATE TABLE public.system_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rehearsal_notes (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE OR REPLACE FUNCTION public.normalize_conversation_phone(raw_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH normalized AS (
    SELECT regexp_replace(coalesce(raw_phone, ''), '[^0-9]', '', 'g') AS digits
  )
  SELECT CASE
    WHEN length(digits) = 10 THEN '+1' || digits
    WHEN length(digits) = 11 AND digits LIKE '1%' THEN '+' || digits
    ELSE NULL
  END
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION public.rehearse_expect(p_ok boolean, p_message text, p_detail jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT coalesce(p_ok, false) THEN
    RAISE EXCEPTION '% %', p_message, coalesce(p_detail::text, '');
  END IF;
END
$$;
