import { describe, expect, it } from 'vitest'
import {
  conversionDeadline,
  defaultGoogleAdsQualityScore,
  googleAdsQualityPayload,
  normalizeGoogleAdsQualityScore,
  resolveGoogleAdsQualityScore,
} from './conversion-approval'

describe('ppc conversion approval', () => {
  it('accepts only Google Ads quality scores 1 through 3', () => {
    expect(normalizeGoogleAdsQualityScore(1)).toBe(1)
    expect(normalizeGoogleAdsQualityScore('2')).toBe(2)
    expect(normalizeGoogleAdsQualityScore(3)).toBe(3)
    expect(normalizeGoogleAdsQualityScore(25)).toBeNull()
    expect(normalizeGoogleAdsQualityScore('high')).toBeNull()
  })

  it('resolves quality score from approval payload before conversion value', () => {
    expect(resolveGoogleAdsQualityScore(25, { google_ads_quality_score: 3 })).toBe(3)
    expect(resolveGoogleAdsQualityScore(2, {})).toBe(2)
    expect(resolveGoogleAdsQualityScore(25, {})).toBeNull()
  })

  it('builds approval payload without storing exact profit', () => {
    expect(googleAdsQualityPayload({
      score: 2,
      approvedAt: '2026-05-23T12:00:00.000Z',
      approvedBy: 'savingkc@gmail.com',
    })).toEqual({
      google_ads_quality_score: 2,
      google_ads_value_basis: 'quality_score_1_3',
      google_ads_value_version: '2026-05-23',
      google_ads_approved_at: '2026-05-23T12:00:00.000Z',
      google_ads_approved_by: 'savingkc@gmail.com',
    })
  })

  it('maps default event suggestions conservatively', () => {
    expect(defaultGoogleAdsQualityScore('lead_submitted')).toBe(2)
    expect(defaultGoogleAdsQualityScore('call_connected_5m')).toBe(2)
    expect(defaultGoogleAdsQualityScore('call_connected_60s')).toBe(1)
  })

  it('labels the 90-day upload deadline bands', () => {
    const now = new Date('2026-05-23T12:00:00.000Z')

    expect(conversionDeadline('2026-04-01T12:00:00.000Z', now).status).toBe('normal')
    expect(conversionDeadline('2026-03-15T12:00:00.000Z', now).status).toBe('review')
    expect(conversionDeadline('2026-03-05T12:00:00.000Z', now).status).toBe('urgent')
    expect(conversionDeadline('2026-02-26T12:00:00.000Z', now).status).toBe('critical')
    expect(conversionDeadline('2026-02-20T12:00:00.000Z', now).status).toBe('expired')
  })
})
