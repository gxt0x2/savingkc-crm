import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260924120000_crm_property_facts.sql', 'utf8')
const leadRoute = readFileSync('src/app/api/leads/[id]/route.ts', 'utf8')
const leadPage = readFileSync('src/app/(app)/leads/[id]/page.tsx', 'utf8')
const zillowRoute = readFileSync('src/app/api/enrich-zillow/route.ts', 'utf8')
const redfinRoute = readFileSync('src/app/api/enrich-redfin/route.ts', 'utf8')

describe('canonical CRM property facts', () => {
  it('projects source-backed lead and county facts without consulting Manifest', () => {
    expect(migration).toContain('sync_crm_property_facts_for_lead')
    expect(migration).toContain('prospect_row.cumulative_due')
    expect(migration).toContain('prospect_row.earliest_delinquent_year')
    expect(migration).toContain('prospect_row.occupancy_status')
    expect(migration).toContain("regexp_replace(btrim(lead_row.lot_size::text), ',', '', 'g')::numeric")
    expect(migration).not.toMatch(/\bmanifests\b/i)
  })

  it('keeps enrichment writes server-only and canonical', () => {
    expect(migration).toContain('update_crm_property_enrichment_v1')
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.update_crm_property_enrichment_v1[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.update_crm_property_enrichment_v1[\s\S]*TO service_role/)
    expect(zillowRoute).toContain("supabase.rpc('update_crm_property_enrichment_v1'")
    expect(redfinRoute).toContain("supabase.rpc('update_crm_property_enrichment_v1'")
    expect(`${zillowRoute}\n${redfinRoute}`).not.toContain("from('manifests')")
    expect(`${zillowRoute}\n${redfinRoute}`).not.toContain("@/lib/manifest-sync")
  })

  it('makes lead detail a canonical entity reader with no Manifest payload', () => {
    expect(leadRoute).toContain('safeReadLeadEntityContext(id)')
    expect(leadRoute).not.toContain("from('manifests')")
    expect(leadPage).toContain('const canonicalProperty = lead.entityContext?.property ?? null')
    expect(leadPage).not.toContain('manifestProperty')
    expect(leadPage).not.toContain('manifestRowId')
  })
})
