import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const prospectPromotion = readFileSync(join(root, 'src/lib/prospect-to-lead.ts'), 'utf8')
const googleAdsPhone = readFileSync(join(root, 'src/lib/google-ads-phone.ts'), 'utf8')

describe('canonical prospect promotion', () => {
  it('links the county-list source record and stores typed promotion evidence', () => {
    expect(prospectPromotion).toContain(".from('prospects')")
    expect(prospectPromotion).toContain(".update({ lead_id: leadId })")
    expect(prospectPromotion).toContain('parcel_id: match.parcel_id || null')
    expect(prospectPromotion).toContain("activity_type: 'status_change'")
    expect(prospectPromotion).toContain("source: 'prospect_promotion'")
    expect(prospectPromotion).toContain('delinquent_years_category: match.delinquent_years_category')
    expect(prospectPromotion).toContain('is_deceased: match.is_deceased')
  })

  it('does not create or mutate Manifest compatibility state', () => {
    for (const [file, source] of [
      ['src/lib/prospect-to-lead.ts', prospectPromotion],
      ['src/lib/google-ads-phone.ts', googleAdsPhone],
    ] as const) {
      expect(source, file).not.toMatch(/manifest-sync|manifest-builder|ensureManifestExists|updateManifest/i)
      expect(source, file).not.toMatch(/from\(['"]manifests['"]\)/)
    }
  })

  it('keeps Google Ads phone attribution on canonical lead source and priority fields', () => {
    expect(googleAdsPhone).toContain(".update({ source: profile.source, priority: 'hot' })")
    expect(googleAdsPhone).toContain('await updateLeadSource(leadId, calledNumber)')
    expect(googleAdsPhone).toContain('getGoogleAdsPhoneProfile')
  })
})
