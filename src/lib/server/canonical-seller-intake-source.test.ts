import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const route = readFileSync('src/app/api/leads/route.ts', 'utf8')
const enrichmentJobs = readFileSync(
  'supabase/migrations/20260928120000_crm_property_enrichment_jobs.sql',
  'utf8',
)

describe('canonical website seller intake', () => {
  it('records the seller without creating or mutating a Manifest mirror', () => {
    expect(route).not.toMatch(/manifest-sync|ensureManifestExists|updateManifestAndCascade/)
    expect(route).not.toContain('Manifest unavailable')
    expect(route).not.toContain('manifestId')
  })

  it('retains canonical operating state, activity, and PPC evidence', () => {
    expect(route).toContain('upsertWebsiteLeadActivity')
    expect(route).toContain('recordSellerIntakeOperatingState')
    expect(route).toContain('enqueuePpcConversion')
    expect(route).toContain('triggerWebsiteLeadSideEffects')
  })

  it('queues enrichment from the canonical lead write', () => {
    expect(enrichmentJobs).toContain('AFTER INSERT OR UPDATE OF phone, property_address')
    expect(enrichmentJobs).toContain('INSERT INTO public.crm_property_enrichment_jobs(lead_id)')
  })
})
