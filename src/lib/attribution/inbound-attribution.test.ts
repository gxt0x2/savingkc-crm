import { describe, expect, it } from 'vitest'
import { buildInboundAttribution, parseMojoCallbackNumbers } from './inbound-attribution'

const NOW = '2026-11-10T12:00:00Z'
const BUSINESS = '+18164292900'
const MOJO = ['+18165550101']

describe('inbound call and SMS attribution', () => {
  it('reads Mojo callback numbers from loose env text', () => {
    expect(parseMojoCallbackNumbers('(816) 555-0101, 8165550102;garbage')).toEqual(['+18165550101', '+18165550102'])
    expect(parseMojoCallbackNumbers(undefined)).toEqual([])
  })

  it('leaves a business-line call with no other evidence as unknown origin', () => {
    const a = buildInboundAttribution({ channel: 'call', calledNumber: BUSINESS, callSid: 'CA1', now: NOW })
    expect(a).toEqual({
      schema: 'lead_attribution_v1',
      lead_source_type: 'inbound_call',
      phone: { tracking_number: BUSINESS, call_sid: 'CA1' },
      captured_at: NOW,
      derived_from: 'inbound:unknown_origin',
    })
  })

  it('marks a business-line call forwarded from a Mojo line as a cold-call callback', () => {
    const a = buildInboundAttribution({
      channel: 'call', calledNumber: BUSINESS, forwardedFrom: '816-555-0101', mojoCallbackNumbers: MOJO, now: NOW,
    })
    expect(a.first_touch).toEqual({ source: 'cold_call', medium: 'callback' })
    expect(a.dialer).toEqual({ provider: 'mojo' })
    expect(a.phone).toEqual({ tracking_number: BUSINESS, forwarded_from: '+18165550101' })
    expect(a.derived_from).toBe('inbound:forwarded_from')
  })

  it('keeps an unrecognized forwarding line as evidence without naming a source', () => {
    const a = buildInboundAttribution({
      channel: 'call', calledNumber: BUSINESS, forwardedFrom: '+18165559999', mojoCallbackNumbers: MOJO, now: NOW,
    })
    expect(a.first_touch).toBeUndefined()
    expect(a.phone?.forwarded_from).toBe('+18165559999')
    expect(a.derived_from).toBe('inbound:unknown_origin')
  })

  it('marks a caller on a prospect list as a cold-call callback without naming Mojo', () => {
    const a = buildInboundAttribution({ channel: 'call', calledNumber: BUSINESS, prospectMatched: true, now: NOW })
    expect(a.first_touch).toEqual({ source: 'cold_call', medium: 'callback' })
    expect(a.dialer).toBeUndefined()
    expect(a.derived_from).toBe('inbound:prospect_phone_match')
  })

  it('trusts a Google Ads line over a prospect match', () => {
    const a = buildInboundAttribution({ channel: 'call', calledNumber: '+18166088808', prospectMatched: true, now: NOW })
    expect(a.first_touch).toMatchObject({ source: 'google', medium: 'cpc' })
    expect(a.first_touch?.campaign).toBeTruthy()
    expect(a.derived_from).toBe('inbound:tracking_number')
  })

  it('marks a CRM cold-call callback line by the dialed number', () => {
    const a = buildInboundAttribution({ channel: 'call', calledNumber: '+18166404701', now: NOW })
    expect(a.first_touch).toEqual({ source: 'cold_call', medium: 'callback' })
    expect(a.derived_from).toBe('inbound:tracking_number')
  })

  it('records texts as inbound_sms and does not store a number forwarded from itself', () => {
    const a = buildInboundAttribution({ channel: 'sms', calledNumber: BUSINESS, forwardedFrom: BUSINESS, now: NOW })
    expect(a.lead_source_type).toBe('inbound_sms')
    expect(a.phone).toEqual({ tracking_number: BUSINESS })
  })
})

describe('known Mojo caller IDs', () => {
  it('tags a callback forwarded from each Mojo rotation number', async () => {
    const { MOJO_CALLER_ID_NUMBERS } = await import('@/lib/twilio-numbers')
    for (const mojo of ['+18165520819', '+18163715792', '+18165520812']) {
      const a = buildInboundAttribution({ channel: 'call', calledNumber: BUSINESS, forwardedFrom: mojo, mojoCallbackNumbers: MOJO_CALLER_ID_NUMBERS })
      expect(a.dialer).toEqual({ provider: 'mojo' })
    }
  })
})
