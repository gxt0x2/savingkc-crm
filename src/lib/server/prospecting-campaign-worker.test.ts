import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  send: vi.fn(),
  caps: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))
vi.mock('@/lib/send-lead-sms', () => ({ sendLeadSms: mocks.send }))
vi.mock('@/lib/twilio-a2p', () => ({ resolveSmsCaps: mocks.caps }))

import { processProspectingCampaignActions } from './prospecting-campaign-worker'

const action = {
  id: '11111111-1111-4111-8111-111111111111',
  campaignId: '22222222-2222-4222-8222-222222222222',
  memberId: '33333333-3333-4333-8333-333333333333',
  stepId: '44444444-4444-4444-8444-444444444444',
  subjectKind: 'lead' as const,
  leadId: '55555555-5555-4555-8555-555555555555',
  prospectId: null,
  prospectPhoneId: null,
  attemptCount: 1,
  phone: '+19135550123',
  timezone: 'America/Chicago',
  bodyTemplate: 'Hi {{first_name}}, this is {{agent_name}} about {{property_address}}.',
  fromPhone: '+18163077835',
  sendWindowStart: '09:00:00',
  sendWindowEnd: '19:00:00',
  sendDays: [1, 2, 3, 4, 5, 6],
  perHour: 75,
  perDay: 500,
  ownerName: 'Casey',
}

function leadBuilder() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: action.leadId, full_name: 'Alex Seller', phone: action.phone, property_address: '1 Main St' },
      error: null,
    }),
  }
}

describe('prospecting campaign worker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T15:00:00.000Z'))
    vi.clearAllMocks()
    mocks.from.mockReturnValue(leadBuilder())
    mocks.caps.mockResolvedValue({ perHour: 150, perDay: 1000 })
    mocks.rpc.mockImplementation((name: string) => {
      if (name === 'claim_prospecting_campaign_action_v1') return Promise.resolve({ data: action, error: null })
      if (name === 'reserve_prospecting_sms_send_v1') return Promise.resolve({ data: { reserved: true }, error: null })
      if (name === 'finish_prospecting_campaign_action_v1') return Promise.resolve({ data: { status: 'sent' }, error: null })
      throw new Error(`Unexpected RPC ${name}`)
    })
  })

  afterEach(() => vi.useRealTimers())

  it('blocks a claimed lead action without sending', async () => {
    await expect(processProspectingCampaignActions(1)).resolves.toEqual({
      processed: 1, sent: 0, deferred: 0, blocked: 1, failed: 0,
    })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('finish_prospecting_campaign_action_v1', expect.objectContaining({
      p_result: 'blocked', p_error_code: 'automated_sms_disabled', p_provider_sid: null,
    }))
  })

  it('blocks a claimed prospect action without creating a lead or sending', async () => {
    const prospectAction = {
      ...action,
      subjectKind: 'prospect' as const,
      leadId: null,
      prospectId: '66666666-6666-4666-8666-666666666666',
      prospectPhoneId: '77777777-7777-4777-8777-777777777777',
    }
    mocks.rpc.mockImplementation((name: string) => {
      if (name === 'claim_prospecting_campaign_action_v1') return Promise.resolve({ data: prospectAction, error: null })
      if (name === 'finish_prospecting_campaign_action_v1') return Promise.resolve({ data: { status: 'blocked' }, error: null })
      throw new Error(`Unexpected RPC ${name}`)
    })

    await expect(processProspectingCampaignActions(1)).resolves.toMatchObject({ blocked: 1, sent: 0 })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
