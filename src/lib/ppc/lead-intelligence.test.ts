import { describe, expect, it } from 'vitest'
import { buildManifest } from '@/lib/manifest-builder'
import {
  applyPpcLeadIntelligenceToManifest,
  buildPpcLeadCacheUpdates,
  ppcLeadIntelligenceFromActivityMetadata,
} from './lead-intelligence'

describe('PPC lead intelligence promotion', () => {
  it('promotes paid form answers into the manifest fields lead cards read', () => {
    const manifest = buildManifest({
      firstName: 'Stuart',
      source: 'ppc-landing',
      station: 'new',
      priority: 'warm',
      propertyAddress: '59 E 107th St',
    })

    const result = applyPpcLeadIntelligenceToManifest(manifest, {
      source: 'ppc_form_submit',
      formStatus: 'submitted',
      situation: 'condition',
      timeline: 'asap',
      condition: 'needs-work',
      auctionStatus: 'not-sure',
      address: '59 E 107th St',
      city: 'Kansas City',
      state: 'MO',
      zip: '64114',
      county: 'jackson',
      capturedAt: '2026-06-06T15:00:00.000Z',
    })

    expect(result.sellerSituation).toBe(
      'PPC intake: reason: Property condition is the issue; condition: Property needs work; timing: ASAP; auction status: not sure; county: Jackson, MO.',
    )
    expect(result.motivationScore).toBe(10)
    expect(manifest.situation.summary).toBe(result.sellerSituation)
    expect(manifest.situation.type).toContain('distressed_condition')
    expect(manifest.situation.motivation?.primary).toBe('Sell as-is instead of making repairs')
    expect(manifest.situation.motivation?.urgencyLevel).toBe('critical')
    expect(manifest.situation.timeline?.preferredClosing).toBe('As soon as possible')
    expect(manifest.property.condition?.overall).toBe('fair')
    expect((manifest.property as Record<string, unknown>).county).toBe('Jackson')
    expect(manifest.agentNotes?.some((note) => note.source === 'ppc_form')).toBe(true)
    expect(manifest.ariIntelligence?.briefingStale).toBe(true)
    expect(buildPpcLeadCacheUpdates(result)).toMatchObject({
      seller_situation: result.sellerSituation,
    })
  })

  it('does not lower a stronger existing motivation score', () => {
    const manifest = buildManifest({ firstName: 'Existing', source: 'mojo' })
    manifest.situation.motivation!.score = 9

    const result = applyPpcLeadIntelligenceToManifest(manifest, {
      source: 'ppc_form_autosave',
      formStatus: 'stage_3_complete_no_submit',
      situation: 'other',
      timeline: 'exploring',
      condition: 'good',
    })

    expect(result.motivationScore).toBe(3)
    expect(manifest.situation.motivation?.score).toBe(9)
  })

  it('extracts PPC intelligence from activity metadata', () => {
    const input = ppcLeadIntelligenceFromActivityMetadata(
      {
        source: 'ppc_form_submit',
        form_status: 'submitted',
        situation_raw: 'tax-delinquent',
        timeline_raw: '60-days',
        condition_raw: 'major-repair',
        auction_status: 'yes',
        address: '123 Main St',
        attribution: { gclid: 'click-1' },
      },
      { county: 'Clay', state: 'MO', capturedAt: '2026-06-06T18:00:00.000Z' },
    )

    expect(input).toMatchObject({
      source: 'ppc_form_submit',
      formStatus: 'submitted',
      situation: 'tax-delinquent',
      timeline: '60-days',
      condition: 'major-repair',
      auctionStatus: 'yes',
      address: '123 Main St',
      county: 'Clay',
      state: 'MO',
    })
  })

  it('records redemption and excess-proceeds qualifiers without overwriting physical condition', () => {
    const redemptionManifest = buildManifest({
      firstName: 'Redeem',
      source: 'ppc-landing',
      station: 'new',
      priority: 'warm',
    })
    const redemption = applyPpcLeadIntelligenceToManifest(redemptionManifest, {
      source: 'ppc_form_submit',
      formStatus: 'submitted',
      situation: 'redemption-window',
      timeline: 'asap',
      condition: 'redeem-title',
      auctionStatus: 'yes',
    })

    expect(redemption.sellerSituation).toContain('Tax-sale redemption window')
    expect(redemptionManifest.situation.type).toContain('tax_sale_redemption')
    expect(redemptionManifest.situation.motivation?.signals).toContain('Needs title help during redemption')
    expect(redemptionManifest.property.condition?.overall).toBeUndefined()

    const proceedsManifest = buildManifest({
      firstName: 'Proceeds',
      source: 'ppc-landing',
      station: 'new',
      priority: 'warm',
    })
    applyPpcLeadIntelligenceToManifest(proceedsManifest, {
      source: 'ppc_form_submit',
      formStatus: 'submitted',
      situation: 'excess-proceeds',
      timeline: '60-days',
      condition: 'proceeds-heirs',
      auctionStatus: 'yes',
    })

    expect(proceedsManifest.situation.type).toContain('excess_proceeds')
    expect(proceedsManifest.situation.motivation?.signals).toContain('Multiple heirs or owners involved')
    expect(proceedsManifest.property.condition?.overall).toBeUndefined()
  })
})
