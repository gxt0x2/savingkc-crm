import { describe, expect, it } from 'vitest'
import { paidSourceIdentifier, paidSourceIdentifierType, paidSourceKey, paidSourceLabel, paidSourceSlug } from './paid-source'

describe('paid source attribution', () => {
  it('labels OpenAI Ads when oppref is present', () => {
    const attribution = { oppref: 'oppref_123', landingUrl: 'https://savingkc.com/ppc?oppref=oppref_123' }

    expect(paidSourceKey(attribution)).toBe('openai_ads')
    expect(paidSourceLabel(attribution)).toBe('OpenAI Ads')
    expect(paidSourceSlug(attribution)).toBe('openai_ads')
    expect(paidSourceIdentifier(attribution)).toBe('oppref_123')
    expect(paidSourceIdentifierType(attribution)).toBe('oppref')
  })

  it('labels OpenAI Ads from ChatGPT source and referrer signals even without oppref', () => {
    expect(paidSourceKey({ utm_source: 'chatgpt', landingUrl: 'https://savingkc.com/ppc?utm_source=chatgpt' })).toBe('openai_ads')
    expect(paidSourceKey({ referrer: 'https://chatgpt.com/c/seller-search', landingUrl: 'https://savingkc.com/ppc' })).toBe('openai_ads')
    expect(paidSourceIdentifier({ referrer: 'https://chatgpt.com/c/seller-search' })).toBe('')
    expect(paidSourceIdentifierType({ referrer: 'https://chatgpt.com/c/seller-search' })).toBe('--')
  })

  it('keeps Google Ads as the default paid-search source', () => {
    const attribution = { gclid: 'gclid_123', utm_source: 'google' }

    expect(paidSourceKey(attribution)).toBe('google_ads')
    expect(paidSourceLabel(attribution)).toBe('Google Ads')
    expect(paidSourceSlug(attribution)).toBe('google_ads')
    expect(paidSourceIdentifier(attribution)).toBe('gclid_123')
    expect(paidSourceIdentifierType(attribution)).toBe('gclid')
  })
})
