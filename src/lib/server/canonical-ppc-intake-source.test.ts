import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const route = readFileSync(join(root, 'src/app/api/leads/ppc/route.ts'), 'utf8')
const landing = readFileSync(join(root, 'src/app/(public)/ppc/SellLanding.tsx'), 'utf8')

describe('canonical PPC intake', () => {
  it('captures and scores explicit seller answers without requiring Manifest', () => {
    expect(route).toContain('derivePpcLeadIntelligence(ppcLeadIntelligence)')
    expect(route).toContain('buildPpcLeadCacheUpdates(leadIntelligence)')
    expect(route).toContain('currentLead.motivation_score > leadIntelligence.motivationScore')
    expect(route).toContain('priority: nextPriority')
    expect(route).toContain('if (intelligenceUpdateError) throw intelligenceUpdateError')
    expect(route).not.toMatch(/manifest-sync|ensureManifestExists|updateManifestAndCascade/i)
    expect(route).not.toMatch(/from\(['"]manifests['"]\)/)
  })

  it('uses the canonical lead identifier through submit and booking', () => {
    expect(landing).toContain('if (json.leadId) setLeadId(json.leadId)')
    expect(landing).toContain("params.set('leadId', leadId)")
    expect(landing).not.toMatch(/manifestId|setManifestId/)
  })

  it('retains canonical activity and conversion evidence', () => {
    expect(route).toContain('upsertPpcFormActivity')
    expect(route).toContain('recordPpcTrackingEvent')
    expect(route).toContain('enqueuePpcConversion')
    expect(route).toContain('recordSellerIntakeOperatingState')
  })
})
