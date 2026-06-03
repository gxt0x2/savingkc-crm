import { describe, it, expect } from 'vitest'
import {
  carrierDailyCap,
  dailyCapForTrustScore,
  hourlyCapForDaily,
  buildTierInfo,
  A2P_FALLBACK_DAILY_CAP,
} from './a2p-tier'

// Mirrors the published T-Mobile A2P 10DLC daily limits (the binding carrier).
describe('a2p-tier — daily cap by Trust Score (vetted Standard brand)', () => {
  it('maps each Trust Score band to the carrier daily cap', () => {
    expect(dailyCapForTrustScore(100)).toBe(200_000)
    expect(dailyCapForTrustScore(75)).toBe(200_000)
    expect(dailyCapForTrustScore(74)).toBe(40_000)
    expect(dailyCapForTrustScore(50)).toBe(40_000)
    expect(dailyCapForTrustScore(49)).toBe(10_000)
    expect(dailyCapForTrustScore(25)).toBe(10_000)
    expect(dailyCapForTrustScore(24)).toBe(2_000)
    expect(dailyCapForTrustScore(1)).toBe(2_000)
  })

  it('falls back conservatively when the score is unknown', () => {
    expect(dailyCapForTrustScore(null)).toBe(A2P_FALLBACK_DAILY_CAP)
    expect(dailyCapForTrustScore(NaN)).toBe(A2P_FALLBACK_DAILY_CAP)
  })
})

describe('a2p-tier — carrier daily cap by brand type', () => {
  it('sole proprietor is 1,000/day regardless of score', () => {
    expect(carrierDailyCap({ trustScore: 90, brandType: 'SOLE_PROPRIETOR', vetted: false })).toBe(1_000)
  })

  it('unvetted (low-volume) Standard is held to 2,000/day even with a high score', () => {
    expect(carrierDailyCap({ trustScore: 90, brandType: 'STANDARD', vetted: false })).toBe(2_000)
  })

  it('Russell 3000 unvetted brand gets the top tier', () => {
    expect(carrierDailyCap({ trustScore: null, brandType: 'STANDARD', vetted: false, russell3000: true })).toBe(200_000)
  })

  it('vetted Standard uses the Trust Score band', () => {
    expect(carrierDailyCap({ trustScore: 62, brandType: 'STANDARD', vetted: true })).toBe(40_000)
    expect(carrierDailyCap({ trustScore: 80, brandType: 'STANDARD', vetted: true })).toBe(200_000)
  })
})

describe('a2p-tier — derived hourly cap', () => {
  it('never drops below the fallback and never exceeds the daily cap', () => {
    expect(hourlyCapForDaily(2_000)).toBe(300) // round(2000/8)=250 < 300 floor
    expect(hourlyCapForDaily(40_000)).toBe(5_000)
    expect(hourlyCapForDaily(200_000)).toBe(25_000)
    expect(hourlyCapForDaily(500)).toBeLessThanOrEqual(500)
  })
})

describe('a2p-tier — tier label', () => {
  it('describes a vetted standard brand with its score', () => {
    const t = buildTierInfo({ trustScore: 62, brandType: 'STANDARD', vetted: true }, 'twilio')
    expect(t.carrierDailyCap).toBe(40_000)
    expect(t.label).toContain('Vetted Standard')
    expect(t.label).toContain('62')
    expect(t.source).toBe('twilio')
  })
})
