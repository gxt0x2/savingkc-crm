import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261202120000_source_lists.sql'),
  'utf8',
)

describe('source list migration', () => {
  it('adds the file ledger, current rows, and status history without changing existing data', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.source_lists')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.source_list_rows')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.source_list_row_files')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.source_list_row_status_history')
    expect(migration).toContain("status IN ('new', 'needs_check', 'ready', 'excluded_entity', 'dropped', 'loaded_to_dialer')")
    expect(migration).toContain('REFERENCES public.crm_properties(id) ON DELETE SET NULL')
    expect(migration).toContain('REFERENCES public.prospects(id) ON DELETE SET NULL')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.source_lists, public.source_list_rows TO service_role')
    expect(migration).not.toMatch(/\bALTER TABLE public\.(?:prospects|crm_properties|leads|sms_opt_outs|prospect_phones|crm_contact_methods|mortgage_foreclosure_prospects|mojo_call_queue)\b/)
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i)
    expect(migration).not.toMatch(/\b(?:insert|update|delete|from|join|into|truncate)\s+(?:public\.)?mojo_call_queue\b/i)
    expect(migration).not.toMatch(/INSERT INTO public\.(?:prospects|crm_properties|leads|mortgage_foreclosure_prospects|mojo_call_queue)\b/)
  })

  it('upserts by parcel or case and keeps a human status on re-import', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.import_source_list_v1')
    expect(migration).toContain('source_list_rows_natural_key')
    expect(migration).toContain("WHEN v_case_first AND body.case_body IS NOT NULL THEN 'case:' || body.case_body")
    expect(migration).toContain("WHEN public.source_list_rows.status = 'new' THEN EXCLUDED.status")
    expect(migration).toContain('source_list_row_files')
    expect(migration).toContain('ambiguous_property_match')
    expect(migration).toContain("coalesce(prospect.prospect_track, 'tax') <> 'mortgage_foreclosure'")
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.import_source_list_v1')
  })

  it('scrubs opt-out and do-not-call numbers when the dialer export is read', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1')
    expect(migration).toContain('public.sms_opt_outs')
    expect(migration).toContain('opt_out.is_opted_out IS TRUE')
    expect(migration).toContain('phone.voice_hold IS TRUE')
    expect(migration).toContain("'dnc', 'do_not_call'")
    expect(migration).toContain("method.sms_consent_status = 'opted_out'")
    expect(migration).toContain("'dnc_refused', 'dnc', 'do_not_call'")
    expect(migration).toContain('lead.call_result')
    expect(migration).toContain('CREATE OR REPLACE VIEW public.source_list_dialer_export')
    expect(migration).toContain('WITH (security_invoker = true)')
    expect(migration).toContain('WHERE block_reason IS NULL')
    expect(migration).toContain("row.status IN ('ready', 'loaded_to_dialer')")
    expect(migration).toContain('CREATE OR REPLACE VIEW public.source_list_dialer_suppressed')
    expect(migration).toContain('REVOKE ALL ON TABLE public.source_list_dialer_phone_review')
    expect(migration).not.toMatch(/\b(?:insert|update|delete|from|join|into|truncate)\s+(?:public\.)?mojo_call_queue\b/i)
  })
})
