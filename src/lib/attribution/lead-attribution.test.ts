import { describe, expect, it } from 'vitest'
import { gaClientIdFromCookie, mergeLeadAttribution, normalizePageHistory, websiteFormAttribution, PAGE_HISTORY_CAP } from './lead-attribution'

describe('lead attribution v1', () => {
  it('parses GA4 client id from _ga cookie', () => {
    expect(gaClientIdFromCookie('GA1.1.1234567890.1700000000')).toBe('1234567890.1700000000')
    expect(gaClientIdFromCookie('1234567890.1700000000')).toBe('1234567890.1700000000')
    expect(gaClientIdFromCookie('garbage')).toBeUndefined()
  })

  it('caps page history', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ p: `/p${i}`, t: 'x' }))
    const h = normalizePageHistory(many)!
    expect(h).toHaveLength(PAGE_HISTORY_CAP)
    expect(h.at(-1)!.path).toBe('/p29')
  })

  it('falls back to legacy referrer/landing when the script payload is missing', () => {
    const a = websiteFormAttribution({
      touch: undefined,
      legacy: { referrer: 'https://www.google.com/', landingUrl: 'https://www.savingkc.com/', sessionId: 's1', formSource: 'homepage-hero', attribution: { form_step: 'submitted' } },
      now: '2026-10-13T00:00:00Z',
    })
    expect(a.first_touch).toEqual({ referrer: 'https://www.google.com/', landing_page: 'https://www.savingkc.com/' })
    expect(a.form).toEqual({ source: 'homepage-hero', step: 'submitted' })
  })

  it('keeps first touch write-once on merge', () => {
    const first = websiteFormAttribution({ touch: { first_touch: { utm_source: 'google', utm_medium: 'cpc' } }, legacy: {} })
    const second = websiteFormAttribution({ touch: { first_touch: { utm_source: 'facebook' }, last_touch: { utm_source: 'facebook' } }, legacy: {} })
    const m = mergeLeadAttribution(first, second)
    expect(m.first_touch?.source).toBe('google')
    expect(m.last_touch?.source).toBe('facebook')
  })
})
