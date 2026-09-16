import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCampaignCallContactGroups, type CampaignCallContactSnapshot } from './prospecting-campaign-call-contacts'
import { applyCampaignContactCallPolicy } from './campaign-contact-call-policy'

const evaluate = vi.hoisted(() => vi.fn())
vi.mock('./dialer-call-eligibility', () => ({ evaluateOutboundDialerCall: evaluate }))

const snapshot: CampaignCallContactSnapshot = {
  id: 'reviewed-contact', source_kind: 'prospect_phone', prospect_id: 'prospect-1',
  prospect_phone_id: 'phone-1', phone_snapshot: '+18165550100', contact_name: 'Seller',
  relationship: 'owner', phone_type: 'mobile', status: 'ready', suppression_reason: null,
  enrolled_at: '2026-08-24T12:00:00.000Z',
}

describe('current policy on reviewed campaign contacts', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['disconnected', 'dead_lead', 'do_not_call'])('blocks a stale ready snapshot when live policy returns %s', async (reason) => {
    evaluate.mockResolvedValue({ allowed: false, reason })
    const original = buildCampaignCallContactGroups([snapshot], new Map())
    const result = await applyCampaignContactCallPolicy(original, { leadId: null, prospectId: 'prospect-1' })
    expect(result[0].phones[0]).toMatchObject({ id: snapshot.id, number: snapshot.phone_snapshot, status: 'suppressed', suppression_reason: reason })
    expect(result[0].unattempted_count).toBe(0)
    expect(original[0].phones[0].status).toBe('ready')
    expect(evaluate).toHaveBeenCalledWith({ phone: snapshot.phone_snapshot, source: 'web_heir_dialer', surface: 'prospecting', leadId: null, prospectId: 'prospect-1', prospectPhoneId: 'phone-1' }, { timeoutMs: expect.any(Number) })
  })

  it('preserves existing suppression and the reviewed identity of allowed contacts', async () => {
    evaluate.mockResolvedValue({ allowed: true })
    const original = buildCampaignCallContactGroups([snapshot, { ...snapshot, id: 'blocked', status: 'suppressed', suppression_reason: 'do_not_contact' }], new Map())
    const result = await applyCampaignContactCallPolicy(original, { leadId: 'lead-1', prospectId: null })
    expect(evaluate).toHaveBeenCalledOnce()
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-1', prospectId: 'prospect-1' }), expect.any(Object))
    expect(result).toEqual(original)
  })

  it('returns an availability failure instead of mislabeling an outage as a dead contact', async () => {
    evaluate.mockResolvedValue({ allowed: false, reason: 'policy_unavailable' })
    const original = buildCampaignCallContactGroups([snapshot], new Map())
    await expect(applyCampaignContactCallPolicy(original, { leadId: null, prospectId: 'prospect-1' })).rejects.toThrow('Current calling rules could not be checked')
    expect(original[0].phones[0].status).toBe('ready')
  })

  it('bounds simultaneous policy checks for a large contact group', async () => {
    let active = 0
    let peak = 0
    evaluate.mockImplementation(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return { allowed: true }
    })
    const original = buildCampaignCallContactGroups(Array.from({ length: 13 }, (_, i) => ({ ...snapshot, id: `contact-${i}` })), new Map())
    expect(await applyCampaignContactCallPolicy(original, { leadId: null, prospectId: 'prospect-1' })).toEqual(original)
    expect(peak).toBeLessThanOrEqual(4)
    expect(evaluate).toHaveBeenCalledTimes(13)
  })
})
