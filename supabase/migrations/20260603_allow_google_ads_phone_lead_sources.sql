-- Allow Google Ads phone-tracking calls to create and stamp CRM leads.
-- Production rejected source='google_ads_phone' on 2026-06-03 because the
-- application had evolved faster than the leads.source check constraint.

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_source_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_source_check CHECK (
    source IS NULL
    OR source::text = ANY(ARRAY[
      'manual',
      'website_form',
      'ppc-landing',
      'google_ads',
      'google-ads',
      'google_ads_phone',
      'google_ads_tax_phone',
      'paid-search',
      'inbound_call',
      'inbound_ivr',
      'inbound_ivr_no_input',
      'inbound_sms',
      'inbound_voicemail',
      'mojo',
      'mojo_call',
      'mojo_dialer',
      'other',
      'youtube',
      'cold_call_callback',
      'tax_delinquent_inbound_call',
      'tax_delinquent_inbound_sms',
      'import',
      'historical_import',
      'google_sheets',
      'heir_dialer',
      'appointment_modal',
      'Ghost Protocol - Trigger Event'
    ])
  );
