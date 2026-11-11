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
})
