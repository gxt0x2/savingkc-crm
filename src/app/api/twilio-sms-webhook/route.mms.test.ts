import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { inboundSmsInboxRow } from '@/lib/server/inbound-sms-thread'

const SID = `SM${'a'.repeat(32)}`
const MEDIA_URL = `https://api.twilio.com/2010-04-01/Accounts/AC${'b'.repeat(32)}/Messages/${SID}/Media/ME${'c'.repeat(32)}`
const ERNEST_PERSONAL = '+18162262552'
const COMPANY_LINE = '+18166088588'
const SELLER = '+19137179716'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  validateTwilioWebhook: vi.fn(),
  rateLimit: vi.fn(),
  getClientIp: vi.fn(),
  safeSendSMS: vi.fn(),
  sendPushToAgents: vi.fn(),
  sendPushToAgentNames: vi.fn(),
  sendMobilePushToAgentNames: vi.fn(),
  lookupProspectByPhone: vi.fn(),
  processInboundSmsConsent: vi.fn(),
  recordAppointmentSmsResponse: vi.fn(),
  isGoogleAdsPhoneNumber: vi.fn(),
  notifyGoogleAdsTeam: vi.fn(),
  resolveGoogleAdsLeadContext: vi.fn(),
  queueInboundLeadAttribution: vi.fn(),
  afterRequest: vi.fn((work: () => unknown) => { void work() }),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload }) },
  },
}))
vi.mock('@/lib/twilio-validate', () => ({ validateTwilioWebhook: mocks.validateTwilioWebhook }))
vi.mock('@/middleware/rate-limit', () => ({
  rateLimit: mocks.rateLimit,
  rateLimitConfigs: { webhook: { windowMs: 60_000, max: 100 } },
  getClientIp: mocks.getClientIp,
}))
vi.mock('@/lib/safe-communications', () => ({ safeSendSMS: mocks.safeSendSMS }))
vi.mock('@/lib/push-notifications', () => ({
  sendPushToAgents: mocks.sendPushToAgents,
  sendPushToAgentNames: mocks.sendPushToAgentNames,
}))
vi.mock('@/lib/mobile-push', () => ({ sendMobilePushToAgentNames: mocks.sendMobilePushToAgentNames }))
vi.mock('@/lib/prospect-lookup', () => ({ lookupProspectByPhone: mocks.lookupProspectByPhone }))
vi.mock('@/lib/prospect-to-lead', () => ({
  createEnrichedLeadFromProspect: vi.fn(),
  formatProspectAlert: vi.fn(() => 'prospect'),
}))
vi.mock('@/lib/sms-consent-audit', () => ({ processInboundSmsConsent: mocks.processInboundSmsConsent }))
vi.mock('@/lib/call-quality-events', () => ({ isGoogleAdsPhoneNumber: mocks.isGoogleAdsPhoneNumber }))
vi.mock('@/lib/google-ads-phone', () => ({
  googleAdsNewTextTeamMessage: vi.fn(),
  markLeadAsGoogleAdsPhoneLead: vi.fn(),
  notifyGoogleAdsTeam: mocks.notifyGoogleAdsTeam,
  resolveGoogleAdsLeadContext: mocks.resolveGoogleAdsLeadContext,
}))
vi.mock('@/lib/server/appointment-sms-response', () => ({ recordAppointmentSmsResponse: mocks.recordAppointmentSmsResponse }))
vi.mock('@/lib/server/inbound-lead-attribution', () => ({ queueInboundLeadAttribution: mocks.queueInboundLeadAttribution }))
vi.mock('@/lib/after-request', () => ({ afterRequest: (work: () => unknown) => mocks.afterRequest(work) }))
vi.mock('@/lib/briefing-regen', () => ({ regenerateBriefing: vi.fn() }))

import { POST } from './route'

let inserts: Array<{ table: string; payload: Record<string, unknown> }>
let persisted: { id: string; lead_id: string | null; metadata: Record<string, unknown>; description: string } | null

function chain(table: string) {
  const api: Record<string, unknown> = {}
  let payload: Record<string, unknown> | null = null
  const self = () => api
  api.select = self
  api.eq = self
  api.in = self
  api.limit = self
  api.order = self
  api.is = self
  api.insert = (value: Record<string, unknown>) => {
    inserts.push({ table, payload: value })
    payload = value
    return api
  }
  api.update = self
  api.maybeSingle = async () => ({ data: persisted ? { id: persisted.id, lead_id: persisted.lead_id } : null, error: null })
  api.single = async () => {
    if (table === 'lead_activities' && payload) {
      persisted = {
        id: 'activity-mms',
        lead_id: (payload.lead_id as string | null) ?? null,
        metadata: payload.metadata as Record<string, unknown>,
        description: String(payload.description),
      }
      return { data: { id: persisted.id, lead_id: persisted.lead_id }, error: null }
    }
    return { data: { id: 'lead-created' }, error: null }
  }
  return api
}

function request(from: string, body = ''): Request {
  const form = new FormData()
  form.set('From', from)
  form.set('To', COMPANY_LINE)
  form.set('Body', body)
  form.set('MessageSid', SID)
  form.set('NumMedia', '1')
  form.set('MediaUrl0', MEDIA_URL)
  form.set('MediaContentType0', 'image/jpeg')
  return new Request('https://crm.savingkc.com/api/twilio-sms-webhook', { method: 'POST', body: form })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-03T15:00:00.000Z'))
  inserts = []
  persisted = null
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACtest')
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token')
  mocks.validateTwilioWebhook.mockResolvedValue(true)
  mocks.rateLimit.mockReturnValue({ allowed: true })
  mocks.getClientIp.mockReturnValue('127.0.0.1')
  mocks.safeSendSMS.mockResolvedValue({ success: true, sid: 'SM-alert' })
  mocks.sendPushToAgents.mockResolvedValue(1)
  mocks.sendPushToAgentNames.mockResolvedValue(1)
  mocks.sendMobilePushToAgentNames.mockResolvedValue(1)
  mocks.lookupProspectByPhone.mockResolvedValue([])
  mocks.processInboundSmsConsent.mockResolvedValue(null)
  mocks.recordAppointmentSmsResponse.mockResolvedValue({ handled: false })
  mocks.isGoogleAdsPhoneNumber.mockReturnValue(false)
  mocks.resolveGoogleAdsLeadContext.mockResolvedValue({ leadId: null, leadName: null })
  mocks.upload.mockResolvedValue({ error: null })
  mocks.from.mockImplementation((table: string) => chain(table))
  mocks.rpc.mockResolvedValue({
    data: [{
      resolution: 'normalized_phone',
      candidate_count: 1,
      lead_id: 'lead-seller',
      full_name: 'Seller',
      phone: SELLER,
      station: 'new',
      priority: 'warm',
      matched_outbound_activity_id: null,
    }],
    error: null,
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(Uint8Array.from([1, 2, 3, 4]), {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
  })))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function primaryInsert() {
  return inserts.find((row) => row.table === 'lead_activities' && row.payload.metadata
    && (row.payload.metadata as { inbound_webhook_source?: string }).inbound_webhook_source === 'twilio_sms_webhook')
}

describe('inbound MMS webhook', () => {
  it('stores a photo-only seller MMS and captions the activity and push', async () => {
    const response = await POST(request(SELLER))

    expect(response.status).toBe(200)
    expect(mocks.upload).toHaveBeenCalledWith(
      `${SID}/0-mms-0.jpg`,
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: 'image/jpeg', upsert: true }),
    )
    const primary = primaryInsert()
    expect(primary?.payload).toMatchObject({
      lead_id: 'lead-seller',
      description: 'Sent a photo',
      metadata: {
        num_media: 1,
        mms: [{ storage_bucket: 'inbound-mms', storage_path: `${SID}/0-mms-0.jpg`, content_type: 'image/jpeg' }],
      },
    })
    expect(JSON.stringify(primary?.payload)).not.toMatch(/twilio\.com|test-token|MediaUrl/)
    expect(mocks.sendMobilePushToAgentNames).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      body: 'Seller: "Sent a photo"',
      data: expect.objectContaining({
        href: '/conversation/lead-seller',
        leadId: 'lead-seller',
      }),
    }))
    expect(mocks.safeSendSMS).not.toHaveBeenCalledWith(expect.objectContaining({ to: SELLER }))
  })

  it('opens a team-to-company-line photo on an unmatched inbox thread', async () => {
    const response = await POST(request(ERNEST_PERSONAL))

    expect(response.status).toBe(200)
    const primary = primaryInsert()
    expect(primary?.payload).toMatchObject({
      lead_id: null,
      description: 'Sent a photo',
      metadata: { team_sender: true, direction: 'received', from: ERNEST_PERSONAL, to: COMPANY_LINE, num_media: 1 },
    })
    expect((primary?.payload.metadata as { is_team?: boolean }).is_team).toBeUndefined()
    expect(inserts.some((row) => row.table === 'leads')).toBe(false)
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(inboundSmsInboxRow({
      lead_id: primary?.payload.lead_id as string | null,
      activity_type: 'sms',
      description: String(primary?.payload.description),
      metadata: primary?.payload.metadata as Record<string, unknown>,
    })).toEqual({
      visible: true,
      threadId: `unmatched:${ERNEST_PERSONAL}`,
      threadKey: `phone:${ERNEST_PERSONAL}`,
    })
    const threadId = `unmatched:${ERNEST_PERSONAL}`
    expect(mocks.sendPushToAgents).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Team SMS: Ernest',
      body: 'Sent a photo',
      url: `/conversations?lead=${encodeURIComponent(threadId)}`,
    }))
    expect(mocks.sendMobilePushToAgentNames).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      data: expect.objectContaining({
        href: `/conversation/${threadId}`,
        leadId: threadId,
      }),
    }))
    expect(JSON.stringify(mocks.sendPushToAgents.mock.calls)).not.toContain('"/conversations"')
  })
})
