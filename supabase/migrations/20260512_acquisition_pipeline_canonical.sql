-- Acquisition Pipeline Canonicalization
--
-- Collapses legacy acquisition station names into five active stages and
-- replaces "nurture as a stage" with a parking state.

BEGIN;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS is_parked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS parked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parked_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_parked
  ON public.leads(is_parked, parked_until)
  WHERE is_parked = TRUE;

UPDATE public.leads
SET station = CASE COALESCE(
        (
          SELECT manifest->>'previousStation'
          FROM public.manifests
          WHERE manifests.lead_id = leads.id
          LIMIT 1
        ),
        'contacted'
      )
      WHEN 'new' THEN 'new'
      WHEN 'intake' THEN 'new'
      WHEN 'not_contacted' THEN 'new'
      WHEN 'contacted' THEN 'contacted'
      WHEN 'attempting_contact' THEN 'contacted'
      WHEN 'nurture' THEN 'contacted'
      WHEN 'qualified' THEN 'qualified'
      WHEN 'qualifying' THEN 'qualified'
      WHEN 'discovery' THEN 'qualified'
      WHEN 'appointment_set' THEN 'appointment_set'
      WHEN 'appt_set' THEN 'appointment_set'
      WHEN 'appointment' THEN 'appointment_set'
      WHEN 'offer_made' THEN 'offer_made'
      WHEN 'offer' THEN 'offer_made'
      WHEN 'offer_prep' THEN 'offer_made'
      WHEN 'offer_presented' THEN 'offer_made'
      WHEN 'negotiating' THEN 'offer_made'
      WHEN 'negotiations' THEN 'offer_made'
      ELSE 'contacted'
    END,
    is_parked = TRUE,
    parked_at = COALESCE(parked_at, NOW()),
    parked_reason = COALESCE(parked_reason, 'migrated_from_nurture_stage')
WHERE station = 'nurture';

UPDATE public.leads SET station = 'new' WHERE station IN ('intake', 'not_contacted');
UPDATE public.leads SET station = 'contacted' WHERE station = 'attempting_contact';
UPDATE public.leads SET station = 'qualified' WHERE station IN ('qualifying', 'discovery');
UPDATE public.leads SET station = 'appointment_set' WHERE station IN ('appt_set', 'appointment');
UPDATE public.leads SET station = 'offer_made' WHERE station IN ('offer', 'offer_prep', 'offer_presented', 'negotiating', 'negotiations');
UPDATE public.leads SET station = 'under_contract' WHERE station IN ('contract', 'contract_signed', 'inspection', 'closing_prep', 'closing');
UPDATE public.leads SET station = 'closed_won' WHERE station IN ('closed', 'disposition');

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_station_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_station_check CHECK (
  station IS NULL OR station::text = ANY(ARRAY[
    'new',
    'contacted',
    'qualified',
    'appointment_set',
    'offer_made',
    'under_contract',
    'closed_won',
    'closed_lost',
    'dead'
  ])
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'manifests'
      AND column_name = 'current_station'
  ) THEN
    UPDATE public.manifests SET current_station = 'contacted' WHERE current_station = 'nurture';
    UPDATE public.manifests SET current_station = 'new' WHERE current_station IN ('intake', 'not_contacted');
    UPDATE public.manifests SET current_station = 'contacted' WHERE current_station = 'attempting_contact';
    UPDATE public.manifests SET current_station = 'qualified' WHERE current_station IN ('qualifying', 'discovery');
    UPDATE public.manifests SET current_station = 'appointment_set' WHERE current_station IN ('appt_set', 'appointment');
    UPDATE public.manifests SET current_station = 'offer_made' WHERE current_station IN ('offer', 'offer_prep', 'offer_presented', 'negotiating', 'negotiations');
    UPDATE public.manifests SET current_station = 'under_contract' WHERE current_station IN ('contract', 'contract_signed', 'inspection', 'closing_prep', 'closing');
    UPDATE public.manifests SET current_station = 'closed_won' WHERE current_station IN ('closed', 'disposition');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_station_acquisition
  ON public.leads(station)
  WHERE station IN ('new', 'contacted', 'qualified', 'appointment_set', 'offer_made')
    AND is_parked = FALSE;

COMMIT;
