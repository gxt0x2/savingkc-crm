import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/after-request', () => ({ afterRequest: vi.fn() }))

import { stampInboundLeadAttribution, type InboundLeadAttributionDeps } from './inbound-lead-attribution'

const SID = `CA${'a'.repeat(32)}`

function deps(overrides: Partial<InboundLeadAttributionDeps> = {}) {
  const saved: Array<{ leadId: string; attribution: Record<string, unknown> }> = []
  const d: InboundLeadAttributionDeps = {
    loadAttribution: async () => null,
    saveAttribution: async (leadId, attribution) => { saved.push({ leadId, attribution: attribution as unknown as Record<string, unknown> }) },
    isProspectPhone: async () => false,
    fetchForwardedFrom: async () => null,
    mojoCallbackNumbers: () => ['+18165550101'],
    findPhoneClicks: async () => [],
    loadNumberChannel: async () => null,
    linkJourney: async () => {},
    ...overrides,
  }
  return { d, saved }
}

describe('stampInboundLeadAttribution', () => {
  it('does nothing without a lead', async () => {
    const { d, saved } = deps()
    expect(await stampInboundLeadAttribution({ leadId: null, channel: 'call' }, d)).toBe(false)
    expect(saved).toHaveLength(0)
  })

  it('never overwrites an existing standard record', async () => {
    const { d, saved } = deps({ loadAttribution: async () => ({ schema: 'lead_attribution_v1', lead_source_type: 'website_form' }) })
    expect(await stampInboundLeadAttribution({ leadId: 'L1', channel: 'call', calledNumber: '+18164292900' }, d)).toBe(false)
    expect(saved).toHaveLength(0)
  })

  it('tags a Mojo callback forwarded to the business line', async () => {
    const { d, saved } = deps({ fetchForwardedFrom: async () => '+18165550101' })
    const wrote = await stampInboundLeadAttribution({
      leadId: 'L1', channel: 'call', callerNumber: '+19135551212', calledNumber: '+18164292900', callSid: SID,
    }, d)
    expect(wrote).toBe(true)
    expect(saved[0].attribution).toMatchObject({
      lead_source_type: 'inbound_call',
      first_touch: { source: 'cold_call', medium: 'callback' },
      dialer: { provider: 'mojo' },
      phone: { tracking_number: '+18164292900', call_sid: SID, forwarded_from: '+18165550101' },
      derived_from: 'inbound:forwarded_from',
    })
  })

  it('falls back to the prospect list when the carrier gives no forwarding number', async () => {
    const { d, saved } = deps({ isProspectPhone: async () => true })
    await stampInboundLeadAttribution({ leadId: 'L1', channel: 'call', callerNumber: '+19135551212', calledNumber: '+18164292900', callSid: SID }, d)
    expect(saved[0].attribution.derived_from).toBe('inbound:prospect_phone_match')
  })

  it('still writes the tracking number when both lookups fail', async () => {
    const { d, saved } = deps({
      isProspectPhone: async () => { throw new Error('db down') },
      fetchForwardedFrom: async () => { throw new Error('twilio down') },
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await stampInboundLeadAttribution({ leadId: 'L1', channel: 'call', callerNumber: '+19135551212', calledNumber: '+18164292900', callSid: SID }, d)).toBe(true)
    expect(saved[0].attribution).toMatchObject({ phone: { tracking_number: '+18164292900' }, derived_from: 'inbound:unknown_origin' })
    log.mockRestore()
  })

  it('skips the Twilio lookup for texts and for malformed call SIDs', async () => {
    const fetchForwardedFrom = vi.fn(async () => '+18165550101')
    const { d, saved } = deps({ fetchForwardedFrom })
    await stampInboundLeadAttribution({ leadId: 'L1', channel: 'sms', calledNumber: '+18164292900', callSid: SID }, d)
    await stampInboundLeadAttribution({ leadId: 'L2', channel: 'call', calledNumber: '+18164292900', callSid: 'nope' }, d)
    expect(fetchForwardedFrom).not.toHaveBeenCalled()
    expect(saved).toHaveLength(2)
  })

  it('reports false instead of throwing when the save fails', async () => {
    const { d } = deps({ saveAttribution: async () => { throw new Error('write failed') } })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await stampInboundLeadAttribution({ leadId: 'L1', channel: 'call', calledNumber: '+18164292900' }, d)).toBe(false)
    log.mockRestore()
  })

  const click = { session_id: 'sess-0001', visitor_id: 'vis-0001', traffic_source: 'google_ads', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'tax-2026', gclid: 'Cj0KCQ', page_path: '/what-i-owe/' }

  it('credits a public-number call to the one website session that tapped the number (G2)', async () => {
    const linked: unknown[] = []
    const { d, saved } = deps({ findPhoneClicks: async () => [click, { ...click }], linkJourney: async (...args) => { linked.push(args) } })
    await stampInboundLeadAttribution({ leadId: 'L1', channel: 'call', callerNumber: '+19135551212', calledNumber: '+18164292900', callSid: SID }, d)
    expect(saved[0].attribution).toMatchObject({
      derived_from: 'inbound:phone_click_match',
      first_touch: { source: 'google', medium: 'cpc', campaign: 'tax-2026', gclid: 'Cj0KCQ', landing_page: '/what-i-owe/' },
      site_session_id: 'sess-0001',
      site_visitor_id: 'vis-0001',
    })
    expect(linked).toEqual([['L1', 'sess-0001', 'vis-0001']])
  })

  it('gives no website credit when two sessions tapped, and falls back to the number channel (G7)', async () => {
    const linked: unknown[] = []
    const { d, saved } = deps({
      findPhoneClicks: async () => [click, { ...click, session_id: 'sess-0002' }],
      loadNumberChannel: async () => ({ channel: 'public_number', campaign: 'website and brand' }),
      linkJourney: async (...args) => { linked.push(args) },
    })
    await stampInboundLeadAttribution({ leadId: 'L1', channel: 'call', calledNumber: '+18164292900', callSid: SID }, d)
    expect(saved[0].attribution).toMatchObject({
      derived_from: 'inbound:number_channel',
      first_touch: { source: 'public_number', medium: 'phone', campaign: 'website and brand' },
    })
    expect(linked).toEqual([])
  })

  it('keeps a Mojo callback ahead of a phone tap and does not link the journey', async () => {
    const linked: unknown[] = []
    const { d, saved } = deps({ fetchForwardedFrom: async () => '+18165550101', findPhoneClicks: async () => [click], linkJourney: async (...args) => { linked.push(args) } })
    await stampInboundLeadAttribution({ leadId: 'L1', channel: 'call', calledNumber: '+18164292900', callSid: SID }, d)
    expect(saved[0].attribution.derived_from).toBe('inbound:forwarded_from')
    expect(linked).toEqual([])
  })

  it('only looks for phone taps on the public number', async () => {
    const findPhoneClicks = vi.fn(async () => [click])
    const { d, saved } = deps({ findPhoneClicks, loadNumberChannel: async () => ({ channel: 'direct_mail', campaign: 'Nov drop' }) })
    await stampInboundLeadAttribution({ leadId: 'L1', channel: 'sms', calledNumber: '+18166088770' }, d)
    expect(findPhoneClicks).not.toHaveBeenCalled()
    expect(saved[0].attribution).toMatchObject({ derived_from: 'inbound:number_channel', first_touch: { source: 'direct_mail', medium: 'sms', campaign: 'Nov drop' } })
  })

  it('credits a mail response number to its drop even when the caller is a prospect (G8)', async () => {
    const { d, saved } = deps({ isProspectPhone: async () => true, loadNumberChannel: async () => ({ channel: 'direct_mail', campaign: 'jackson-tax-nov-1124' }) })
    await stampInboundLeadAttribution({ leadId: 'L1', channel: 'call', callerNumber: '+19135551212', calledNumber: '+18166088770', callSid: SID }, d)
    expect(saved[0].attribution).toMatchObject({ derived_from: 'inbound:number_channel', first_touch: { source: 'direct_mail', medium: 'phone', campaign: 'jackson-tax-nov-1124' } })
  })

  it('still lets the prospect match win on a public-number channel', async () => {
    const { d, saved } = deps({ isProspectPhone: async () => true, loadNumberChannel: async () => ({ channel: 'public_number', campaign: 'website and brand' }) })
    await stampInboundLeadAttribution({ leadId: 'L1', channel: 'call', callerNumber: '+19135551212', calledNumber: '+18164292900', callSid: SID }, d)
    expect(saved[0].attribution.derived_from).toBe('inbound:prospect_phone_match')
  })
})

