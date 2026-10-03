import { describe, expect, it, vi } from 'vitest'
import { resolveInboundSmsLead } from './inbound-sms-lead'

const input = ['+19137179716', '+18166088588', '2026-10-03T15:57:26Z'] as const
const resolved = {
  resolution: 'outbound_thread', candidate_count: 2,
  lead_id: '68997f70-04be-4119-bb24-c5e959f4d6b1', full_name: 'Ernest Dodson',
  phone: '\u202a(913) 717-9716\u202c', station: 'contacted', priority: 'normal',
  matched_outbound_activity_id: '88d0ab17-7f3c-49e4-95cb-8031961b0711',
}

describe('inbound SMS identity RPC contract', () => {
  it('retains exact canonical identity and outbound continuity evidence', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [resolved], error: null })
    expect(await resolveInboundSmsLead({ rpc }, ...input)).toEqual({ kind: 'outbound_thread', candidateCount: 2,
      lead: { id: resolved.lead_id, full_name: resolved.full_name, phone: resolved.phone, station: 'contacted', priority: 'normal' },
      matchedOutboundActivityId: resolved.matched_outbound_activity_id,
    })
    expect(rpc).toHaveBeenCalledWith('resolve_inbound_sms_lead_v1', {
      p_customer_phone: input[0], p_company_phone: input[1], p_received_at: input[2],
    })
  })

  it.each(['unknown', 'ambiguous', 'unsupported'] as const)('keeps %s explicit and unlinked', async (resolution) => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ resolution, candidate_count: resolution === 'ambiguous' ? 2 : 0,
      lead_id: null, matched_outbound_activity_id: null }], error: null })
    expect(await resolveInboundSmsLead({ rpc }, ...input)).toMatchObject({ kind: resolution, lead: null })
  })

  it.each([null, [], [resolved, resolved], [{ ...resolved, candidate_count: null }], [{ ...resolved, candidate_count: -1 }],
    [{ ...resolved, candidate_count: 1 }], [{ ...resolved, matched_outbound_activity_id: '' }],
    [{ ...resolved, resolution: 'unknown', candidate_count: 0 }], [{ ...resolved, resolution: 'ambiguous', lead_id: null }]])
  ('rejects malformed or contradictory results instead of guessing a contact: %j', async (data) => {
    await expect(resolveInboundSmsLead({ rpc: vi.fn().mockResolvedValue({ data, error: null }) }, ...input)).rejects.toThrow('identity resolution')
  })

  it('surfaces missing migration errors without a compatibility fallback', async () => {
    await expect(resolveInboundSmsLead({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC not found' } }) }, ...input))
      .rejects.toThrow('identity resolution failed: RPC not found')
  })
})
