import { beforeEach, describe, expect, it, vi } from 'vitest'

const SID = `SM${'d'.repeat(32)}`
const MEDIA_URL = `https://api.twilio.com/2010-04-01/Accounts/AC${'b'.repeat(32)}/Messages/${SID}/Media/ME${'c'.repeat(32)}`

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  upload: vi.fn(),
  validateTwilioWebhook: vi.fn(),
  processInboundSmsConsent: vi.fn(),
  sendTeamLeadAlert: vi.fn(),
  sendPushToAgents: vi.fn(),
  sendMobilePushToAgentNames: vi.fn(),
  queueInboundLeadAttribution: vi.fn(),
}))

vi.mock('@/lib/twilio-validate', () => ({ validateTwilioWebhook: mocks.validateTwilioWebhook }))
vi.mock('@/lib/sms-consent-audit', () => ({ processInboundSmsConsent: mocks.processInboundSmsConsent }))
vi.mock('@/lib/lead-team-alerts', () => ({ sendTeamLeadAlert: mocks.sendTeamLeadAlert }))
vi.mock('@/lib/server/inbound-lead-attribution', () => ({ queueInboundLeadAttribution: mocks.queueInboundLeadAttribution }))
vi.mock('@/lib/agent-routing', () => ({ getAgentRouting: () => ({ primary: { name: 'Casey' } }) }))
vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from: mocks.from,
    storage: { from: () => ({ upload: mocks.upload }) },
  },
}))
vi.mock('@/lib/push-notifications', () => ({
  sendPushToAgents: mocks.sendPushToAgents,
  sendPushToAgentNames: vi.fn(),
}))
vi.mock('@/lib/mobile-push', () => ({ sendMobilePushToAgentNames: mocks.sendMobilePushToAgentNames }))
vi.mock('@/lib/after-request', () => ({ afterRequest: (work: () => unknown) => { void work() } }))
vi.mock('@/lib/safe-communications', () => ({ safeSendSMS: vi.fn() }))

import { POST } from './route'

let inserts: Array<{ table: string; payload: Record<string, unknown> }>

beforeEach(() => {
  vi.clearAllMocks()
  inserts = []
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACtest')
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token')
  mocks.validateTwilioWebhook.mockResolvedValue(true)
  mocks.processInboundSmsConsent.mockResolvedValue(null)
  mocks.upload.mockResolvedValue({ error: null })
  mocks.sendTeamLeadAlert.mockResolvedValue({ recipients: [], smsResults: [], channelResults: [], callback: null })
  mocks.from.mockImplementation((table: string) => {
    const api: Record<string, unknown> = {}
    const self = () => api
    api.select = self
    api.eq = self
    api.limit = self
    api.insert = (payload: Record<string, unknown>) => {
      inserts.push({ table, payload })
      return api
    }
    api.maybeSingle = async () => ({ data: null, error: null })
    api.single = async () => ({ data: { id: 'lead-fallback' }, error: null })
    return api
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(Uint8Array.from([8, 8]), {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
  })))
})

function request(from: string): Request {
  const params = new URLSearchParams({
    From: from,
    To: '+18166088588',
    Body: '',
    MessageSid: SID,
    NumMedia: '2',
    MediaUrl0: MEDIA_URL,
    MediaContentType0: 'image/jpeg',
    MediaUrl1: MEDIA_URL,
    MediaContentType1: 'image/jpeg',
  })
  return new Request('https://crm.savingkc.com/api/twilio/fallback/sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
}

describe('carrier SMS fallback MMS', () => {
  it('stores a photo-only team MMS on an unmatched thread and does not create a seller lead', async () => {
    const response = await POST(request('+18162262552'))

    expect(response.status).toBe(200)
    expect(inserts.some((row) => row.table === 'leads')).toBe(false)
    expect(mocks.sendTeamLeadAlert).not.toHaveBeenCalled()
    const activity = inserts.find((row) => row.table === 'lead_activities')
    expect(activity?.payload).toMatchObject({
      lead_id: null,
      description: 'Sent 2 photos',
      metadata: { num_media: 2, team_sender: true, source: 'carrier_sms_fallback' },
    })
    expect(JSON.stringify(activity?.payload)).not.toMatch(/twilio\.com|test-token/)
    expect(mocks.sendPushToAgents).toHaveBeenCalledWith(expect.objectContaining({
      body: 'Sent 2 photos',
      url: `/conversations?lead=${encodeURIComponent('unmatched:+18162262552')}`,
    }))
    expect(mocks.sendMobilePushToAgentNames).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      data: expect.objectContaining({ leadId: 'unmatched:+18162262552' }),
    }))
  })
})
