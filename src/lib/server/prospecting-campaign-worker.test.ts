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

function prospectBuilder() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: '66666666-6666-4666-8666-666666666666',
        owner_1: 'Jordan Seller',
        situs_street: '2 Oak Ave',
        situs_city: 'Kansas City',
        situs_state: 'MO',
        situs_zip: '64118',
      },
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

  it('renders and sends one claimed action with durable campaign provenance', async () => {
    mocks.send.mockResolvedValue({
      status: 'sent', sid: 'SM123', from: action.fromPhone,
      persisted: true, deliveryState: 'delivered_and_persisted',
    })
    await expect(processProspectingCampaignActions(1)).resolves.toEqual({
      processed: 1, sent: 1, deferred: 0, blocked: 0, failed: 0,
    })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      leadId: action.leadId,
      body: 'Hi Alex, this is Casey about 1 Main St.',
      fromPhone: action.fromPhone,
      metadata: expect.objectContaining({ prospecting_campaign_action_id: action.id }),
      statusCallback: `https://crm.savingkc.com/api/twilio-message-status?action_id=${action.id}#rc=3&rp=5xx,ct,rt&ct=2000&rt=5000`,
    }))
    expect(mocks.rpc).toHaveBeenCalledWith('finish_prospecting_campaign_action_v1', expect.objectContaining({
      p_result: 'sent', p_provider_sid: 'SM123',
    }))
  })

  it('turns a final opt-out check into durable suppression without sending again', async () => {
    mocks.send.mockResolvedValue({ status: 'skipped', reason: 'opted_out' })
    await expect(processProspectingCampaignActions(1)).resolves.toMatchObject({ blocked: 1, sent: 0 })
    expect(mocks.rpc).toHaveBeenCalledWith('finish_prospecting_campaign_action_v1', expect.objectContaining({
      p_result: 'blocked', p_error_code: 'do_not_contact',
    }))
  })

  it('sends an explicitly reviewed source Prospect recipient without creating a shadow Lead', async () => {
    const prospectAction = {
      ...action,
      subjectKind: 'prospect' as const,
      leadId: null,
      prospectId: '66666666-6666-4666-8666-666666666666',
      prospectPhoneId: '77777777-7777-4777-8777-777777777777',
    }
    mocks.from.mockImplementation((table: string) => {
      if (table === 'prospects') return prospectBuilder()
      throw new Error(`Unexpected table ${table}`)
    })
    mocks.rpc.mockImplementation((name: string) => {
      if (name === 'claim_prospecting_campaign_action_v1') return Promise.resolve({ data: prospectAction, error: null })
      if (name === 'reserve_prospecting_sms_send_v1') return Promise.resolve({ data: { reserved: true }, error: null })
      if (name === 'finish_prospecting_campaign_action_v1') return Promise.resolve({ data: { status: 'sent' }, error: null })
      throw new Error(`Unexpected RPC ${name}`)
    })
    mocks.send.mockResolvedValue({
      status: 'sent', sid: 'SM456', from: action.fromPhone,
      persisted: true, deliveryState: 'delivered_and_persisted',
    })

    await expect(processProspectingCampaignActions(1)).resolves.toMatchObject({ sent: 1 })
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      leadId: null,
      phone: action.phone,
      body: 'Hi Jordan, this is Casey about 2 Oak Ave, Kansas City, MO, 64118.',
      metadata: expect.objectContaining({
        subject_kind: 'prospect',
        prospect_id: prospectAction.prospectId,
        prospect_phone_id: prospectAction.prospectPhoneId,
        thread_key: `phone:${action.phone}`,
      }),
    }))
  })

  it('satisfies a duplicate step instead of retrying it after the safety window', async () => {
    mocks.send.mockResolvedValue({ status: 'skipped', reason: 'duplicate' })
    await expect(processProspectingCampaignActions(1)).resolves.toMatchObject({ sent: 1, deferred: 0 })
    expect(mocks.rpc).toHaveBeenCalledWith('finish_prospecting_campaign_action_v1', expect.objectContaining({
      p_result: 'sent', p_error_code: 'deduplicated_existing_send', p_provider_sid: null,
    }))
  })
})
