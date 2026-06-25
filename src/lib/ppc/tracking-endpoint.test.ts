import { afterEach, describe, expect, it } from 'vitest'
import { resolvePpcTrackingEndpoint } from './tracking-endpoint'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('resolvePpcTrackingEndpoint', () => {
  it('routes public SavingKC landing captures to the CRM tracking writer', () => {
    delete process.env.PPC_TRACKING_ENDPOINT_URL
    delete process.env.PPC_TRACKING_ORIGIN
    delete process.env.NEXT_PUBLIC_APP_URL

    expect(resolvePpcTrackingEndpoint('https://savingkc.com/ppc-openai?utm_source=chatgpt')).toBe(
      'https://crm.savingkc.com/api/ppc/track',
    )
  })

  it('keeps CRM-hosted landing captures on the current CRM origin', () => {
    delete process.env.PPC_TRACKING_ENDPOINT_URL
    delete process.env.PPC_TRACKING_ORIGIN

    expect(resolvePpcTrackingEndpoint('https://crm.savingkc.com/ppc-openai?utm_source=chatgpt')).toBe(
      'https://crm.savingkc.com/api/ppc/track',
    )
  })

  it('allows a full tracking endpoint override', () => {
    process.env.PPC_TRACKING_ENDPOINT_URL = 'https://collector.savingkc.com/api/ppc/track'
    process.env.PPC_TRACKING_ORIGIN = 'https://ignored.savingkc.com'

    expect(resolvePpcTrackingEndpoint('https://savingkc.com/ppc-openai')).toBe(
      'https://collector.savingkc.com/api/ppc/track',
    )
  })

  it('allows an origin-style tracking override', () => {
    delete process.env.PPC_TRACKING_ENDPOINT_URL
    process.env.PPC_TRACKING_ORIGIN = 'https://collector.savingkc.com'

    expect(resolvePpcTrackingEndpoint('https://savingkc.com/ppc-openai')).toBe(
      'https://collector.savingkc.com/api/ppc/track',
    )
  })
})
