import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  validateTwilioWebhook: vi.fn(),
  rateLimit: vi.fn(),
  getClientIp: vi.fn(),
  isOptedOut: vi.fn(),
  handleOptOut: vi.fn(),
  handleOptIn: vi.fn(),
  isStopKeyword: vi.fn(),
  isStartKeyword: vi.fn(),
  onCommunicationEvent: vi.fn(),
  ensureManifestExists: vi.fn(),
  updateManifestAndCascade: vi.fn(),
  regenerateBriefing: vi.fn(),
  sendPushToAgents: vi.fn(),
  lookupProspectByPhone: vi.fn(),
  createEnrichedLeadFromProspect: vi.fn(),
  formatProspectAlert: vi.fn(),
  safeSendSMS: vi.fn(),
  isGoogleAdsPhoneNumber: vi.fn(),
  markLeadAsGoogleAdsPhoneLead: vi.fn(),
  notifyGoogleAdsTeam: vi.fn(),
  resolveGoogleAdsLeadContext: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

vi.mock('@/lib/twilio-validate', () => ({
  validateTwilioWebhook: mocks.validateTwilioWebhook,
}))

vi.mock('@/middleware/rate-limit', () => ({
  rateLimit: mocks.rateLimit,
  rateLimitConfigs: { webhook: { windowMs: 60_000, max: 100 } },
  getClientIp: mocks.getClientIp,
}))

vi.mock('@/lib/sms-opt-out', () => ({
  isOptedOut: mocks.isOptedOut,
  handleOptOut: mocks.handleOptOut,
  handleOptIn: mocks.handleOptIn,
  isStopKeyword: mocks.isStopKeyword,
  isStartKeyword: mocks.isStartKeyword,
}))

vi.mock('@/lib/manifest-sync', () => ({
  onCommunicationEvent: mocks.onCommunicationEvent,
  ensureManifestExists: mocks.ensureManifestExists,
  updateManifestAndCascade: mocks.updateManifestAndCascade,
}))

vi.mock('@/lib/briefing-regen', () => ({
  regenerateBriefing: mocks.regenerateBriefing,
}))

vi.mock('@/lib/push-notifications', () => ({
  sendPushToAgents: mocks.sendPushToAgents,
}))

vi.mock('@/lib/prospect-lookup', () => ({
  lookupProspectByPhone: mocks.lookupProspectByPhone,
}))

vi.mock('@/lib/prospect-to-lead', () => ({
  createEnrichedLeadFromProspect: mocks.createEnrichedLeadFromProspect,
  formatProspectAlert: mocks.formatProspectAlert,
}))

vi.mock('@/lib/safe-communications', () => ({
  safeSendSMS: mocks.safeSendSMS,
}))

vi.mock('@/lib/call-quality-events', () => ({
  isGoogleAdsPhoneNumber: mocks.isGoogleAdsPhoneNumber,
}))

vi.mock('@/lib/google-ads-phone', () => ({
  googleAdsNewTextTeamMessage: vi.fn(),
  markLeadAsGoogleAdsPhoneLead: mocks.markLeadAsGoogleAdsPhoneLead,
  notifyGoogleAdsTeam: mocks.notifyGoogleAdsTeam,
  phoneLookupVariants: (phone: string) => [phone],
  resolveGoogleAdsLeadContext: mocks.resolveGoogleAdsLeadContext,
}))

vi.mock('@/lib/ghost-risk-calculator', () => ({
  calculateGhostRisk: vi.fn(() => 0),
}))

import { POST } from './route'

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
const PROSPECT_PHONE = '+19135550123'

function makeSmsRequest(body: string): Request {
  const form = new FormData()
  form.set('From', PROSPECT_PHONE)
  form.set('To', '+1816608559')
  form.set('Body', body)
  form.set('MessageSid', `SM-${body}`)
  return new Request('https://crm.savingkc.com/api/twilio-sms-webhook', {
    method: 'POST',
    body: form,
  })
}

function supabaseChain(table: string) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.is = vi.fn(async () => ({ error: null }))
  chain.update = vi.fn(() => chain)
  chain.insert = vi.fn((payload: unknown) => {
    inserts.push({ table, payload })
    return {
      select: () => ({
        single: async () => ({ data: { id: 'lead-created' }, error: null }),
      }),
    }
  })
  chain.maybeSingle = vi.fn(async () => {
    if (table === 'leads') {
      return {
        data: { id: 'lead-123', full_name: 'Jessica Watkins', phone: PROSPECT_PHONE, station: 'new', priority: 'normal' },
        error: null,
      }
    }
    return { data: null, error: null }
  })
  chain.single = vi.fn(async () => ({ data: null, error: null }))
  return chain
}

let inserts: Array<{ table: string; payload: unknown }>

describe('twilio SMS webhook seller responses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inserts = []
    process.env.CASEY_PHONE = '+18167564943'
    process.env.ERNEST_PHONE = '+18162262552'
    process.env.TWILIO_PHONE_NUMBER = '+18163077835'
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.rateLimit.mockReturnValue({ allowed: true })
    mocks.getClientIp.mockReturnValue('127.0.0.1')
    mocks.isOptedOut.mockResolvedValue(false)
    mocks.handleOptOut.mockResolvedValue(undefined)
    mocks.handleOptIn.mockResolvedValue(undefined)
    mocks.isStopKeyword.mockImplementation((value: string) => value.trim().toUpperCase() === 'STOP')
    mocks.isStartKeyword.mockImplementation((value: string) => value.trim().toUpperCase() === 'START')
    mocks.onCommunicationEvent.mockResolvedValue(undefined)
    mocks.ensureManifestExists.mockResolvedValue(undefined)
    mocks.updateManifestAndCascade.mockResolvedValue(true)
    mocks.regenerateBriefing.mockResolvedValue(undefined)
    mocks.sendPushToAgents.mockResolvedValue(1)
    mocks.lookupProspectByPhone.mockResolvedValue([])
    mocks.createEnrichedLeadFromProspect.mockResolvedValue('lead-created')
    mocks.formatProspectAlert.mockReturnValue('prospect context')
    mocks.safeSendSMS.mockResolvedValue({ success: true, sid: 'SM-alert' })
    mocks.isGoogleAdsPhoneNumber.mockReturnValue(false)
    mocks.resolveGoogleAdsLeadContext.mockResolvedValue({ leadId: null, leadName: null })
    mocks.from.mockImplementation((table: string) => supabaseChain(table))
  })

  it('does not send a canned TwiML reply back to a prospect who texts YES', async () => {
    const response = await POST(makeSmsRequest('YES'))

    await expect(response.text()).resolves.toBe(EMPTY_TWIML)
    expect(mocks.safeSendSMS).toHaveBeenCalledTimes(2)
    expect(mocks.safeSendSMS).not.toHaveBeenCalledWith(expect.objectContaining({ to: PROSPECT_PHONE }))
    expect(inserts.some(({ table, payload }) => (
      table === 'lead_activities' &&
      typeof payload === 'object' &&
      payload !== null &&
      (payload as { activity_type?: string; metadata?: { priority?: string } }).activity_type === 'task' &&
      (payload as { metadata?: { priority?: string } }).metadata?.priority === 'critical'
    ))).toBe(true)
  })

  it('does not send a canned TwiML reply back to a prospect who texts CONFIRM', async () => {
    const response = await POST(makeSmsRequest('CONFIRM'))

    await expect(response.text()).resolves.toBe(EMPTY_TWIML)
    expect(mocks.safeSendSMS).not.toHaveBeenCalledWith(expect.objectContaining({ to: PROSPECT_PHONE }))
    expect(inserts.some(({ table, payload }) => (
      table === 'lead_activities' &&
      typeof payload === 'object' &&
      payload !== null &&
      (payload as { activity_type?: string }).activity_type === 'appointment_confirmed'
    ))).toBe(true)
  })

  it('keeps TCPA STOP acknowledgement intact', async () => {
    const response = await POST(makeSmsRequest('STOP'))

    await expect(response.text()).resolves.toContain('You have been unsubscribed')
    expect(mocks.handleOptOut).toHaveBeenCalledWith(PROSPECT_PHONE, 'STOP')
  })
})
