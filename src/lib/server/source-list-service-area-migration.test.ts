import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261203130000_source_list_service_area_block.sql'),
  'utf8',
)

describe('source list service area migration', () => {
  it('blocks a present county or situs county outside the five counties', () => {
    const reason = migration.indexOf("THEN 'out_of_service_area'")
    const leadDnc = migration.indexOf("THEN 'lead_dnc'")
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1')
    expect(migration).toContain('p_county text DEFAULT NULL')
    expect(migration).toContain('p_situs_county text DEFAULT NULL')
    expect(reason).toBeGreaterThan(leadDnc)
    expect(migration).toContain("normalized.slug IS NOT NULL")
    expect(migration).toContain("NOT IN ('jackson', 'clay', 'platte', 'johnson', 'wyandotte')")
    expect(migration).toContain('dialed.county')
    expect(migration).toContain('dialed.situs_county')
    expect(migration).toContain("row.raw->>'situs_county'")
    expect(migration).toContain("row.raw->>'county'")
    expect(migration).toContain('prospect.county')
    expect(migration).toContain('property.county')
    expect(migration).toContain('64063')
    expect(migration).toContain('64080')
    expect(migration).not.toMatch(/->>'zip'|situs_zip|postal_code|zip_code/)
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.source_list_phone_block_reason_v1(text)')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.source_list_phone_block_reason_v1(text, text, text)')
  })

  it('keeps the existing phone scrub and does not touch other tables', () => {
    expect(migration).toContain("THEN 'invalid_phone'")
    expect(migration).toContain("THEN 'sms_opt_out'")
    expect(migration).toContain('phone.voice_hold IS TRUE')
    expect(migration).toContain("THEN 'prospect_dnc'")
    expect(migration).toContain("THEN 'wrong_number'")
    expect(migration).toContain("THEN 'disconnected'")
    expect(migration).toContain("THEN 'contact_opt_out'")
    expect(migration).toContain("THEN 'contact_blocked'")
    expect(migration).toContain("THEN 'lead_dnc'")
    expect(migration).toContain("row.status IN ('ready', 'loaded_to_dialer')")
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i)
    expect(migration).not.toMatch(/\b(?:insert|update|delete|from|join|into|truncate)\s+(?:public\.)?mojo_call_queue\b/i)
    expect(migration).not.toMatch(/\bALTER TABLE public\.(?:prospects|crm_properties|leads|sms_opt_outs|prospect_phones)\b/)
  })
})
