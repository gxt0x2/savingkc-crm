import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  validateTwilioWebhook: vi.fn(),
  rateLimit: vi.fn(),
  getClientIp: vi.fn(),
  regenerateBriefing: vi.fn(),
  sendPushToAgents: vi.fn(),
  sendPushToAgentNames: vi.fn(),
  sendMobilePushToAgentNames: vi.fn(),
  lookupProspectByPhone: vi.fn(),
  createEnrichedLeadFromProspect: vi.fn(),
  formatProspectAlert: vi.fn(),
  safeSendSMS: vi.fn(),
  isGoogleAdsPhoneNumber: vi.fn(),
  notifyGoogleAdsTeam: vi.fn(),
  resolveGoogleAdsLeadContext: vi.fn(),
  processInboundSmsConsent: vi.fn(),
  recordAppointmentSmsResponse: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('@/lib/twilio-validate', () => ({ validateTwilioWebhook: mocks.validateTwilioWebhook }))
vi.mock('@/middleware/rate-limit', () => ({
  rateLimit: mocks.rateLimit,
  rateLimitConfigs: { webhook: { windowMs: 60_000, max: 100 } },
  getClientIp: mocks.getClientIp,
}))
vi.mock('@/lib/sms-consent-audit', () => ({ processInboundSmsConsent: mocks.processInboundSmsConsent }))
vi.mock('@/lib/briefing-regen', () => ({ regenerateBriefing: mocks.regenerateBriefing }))
vi.mock('@/lib/push-notifications', () => ({
  sendPushToAgents: mocks.sendPushToAgents,
  sendPushToAgentNames: mocks.sendPushToAgentNames,
}))
vi.mock('@/lib/mobile-push', () => ({ sendMobilePushToAgentNames: mocks.sendMobilePushToAgentNames }))
vi.mock('@/lib/prospect-lookup', () => ({ lookupProspectByPhone: mocks.lookupProspectByPhone }))
vi.mock('@/lib/prospect-to-lead', () => ({
  createEnrichedLeadFromProspect: mocks.createEnrichedLeadFromProspect,
  formatProspectAlert: mocks.formatProspectAlert,
}))
vi.mock('@/lib/safe-communications', () => ({ safeSendSMS: mocks.safeSendSMS }))
vi.mock('@/lib/call-quality-events', () => ({ isGoogleAdsPhoneNumber: mocks.isGoogleAdsPhoneNumber }))
vi.mock('@/lib/google-ads-phone', () => ({
  googleAdsNewTextTeamMessage: vi.fn(),
  markLeadAsGoogleAdsPhoneLead: vi.fn(),
  notifyGoogleAdsTeam: mocks.notifyGoogleAdsTeam,
  phoneLookupVariants: (phone: string) => [phone],
  resolveGoogleAdsLeadContext: mocks.resolveGoogleAdsLeadContext,
}))
vi.mock('@/lib/server/appointment-sms-response', () => ({ recordAppointmentSmsResponse: mocks.recordAppointmentSmsResponse }))
vi.mock('@/lib/after-request', () => ({ afterRequest: (work: () => unknown) => { void work() } }))

import { POST } from './route'

const PHONE = '+19135550123'
const SELL_AUTO_TEXT = "Thanks for calling Saving KC Homebuyers. Were you looking to sell a property? Reply YES and we'll call you right back."

type Row = { table: string; payload: Record<string, unknown> }
let inserts: Row[]
let updates: Row[]
let knownLead: boolean
let priorOutbound: string | null
let activity: { id: string; lead_id: string | null; metadata: Record<string, unknown> } | null

function trigger(row: Row): string | undefined {
  return (row.payload.metadata as { trigger?: string } | undefined)?.trigger
}

function wroteClassification() {
  return [...inserts, ...updates].some((row) => JSON.stringify(row.payload).includes('"classification":"lead"'))
}

function chain(table: string) {
  const filters: Array<[string, unknown]> = []
  let pending: Record<string, unknown> | null = null
  const api: Record<string, unknown> = {}
  const self = () => api
  api.select = self
  api.eq = (column: string, value: unknown) => { filters.push([column, value]); return api }
  api.in = (column: string, value: unknown) => { filters.push([column, value]); return api }
  api.is = self
  api.order = self
  api.limit = self
  api.update = (payload: Record<string, unknown>) => { pending = payload; updates.push({ table, payload }); return api }
  api.insert = (payload: Record<string, unknown>) => { pending = payload; inserts.push({ table, payload }); return api }
  api.maybeSingle = async () => {
    if (table === 'lead_activities' && filters.some(([, value]) => value === 'outbound')) {
      return { data: priorOutbound ? { description: priorOutbound } : null, error: null }
    }
    if (table === 'lead_activities' && pending && activity) {
      if (typeof pending.lead_id === 'string') activity = { ...activity, lead_id: pending.lead_id }
      if (pending.metadata && typeof pending.metadata === 'object') activity = { ...activity, metadata: pending.metadata as Record<string, unknown> }
      return { data: { id: activity.id, lead_id: activity.lead_id }, error: null }
    }
    if (table === 'lead_activities' && activity) {
      const directions = filters.find(([column]) => column === 'metadata->>direction')?.[1]
      if (Array.isArray(directions) && !directions.includes(String(activity.metadata.direction))) return { data: null, error: null }
      return { data: activity, error: null }
    }
    return { data: null, error: null }
  }
  api.single = async () => {
    if (table === 'lead_activities' && pending) {
      activity = { id: 'activity-1', lead_id: (pending.lead_id as string | null) ?? null, metadata: pending.metadata as Record<string, unknown> }
      return { data: { id: activity.id, lead_id: activity.lead_id }, error: null }
    }
    if (table === 'leads' && pending) return { data: { id: 'lead-created' }, error: null }
    return { data: null, error: null }
  }
  return api
}

function request(body: string, from = PHONE) {
  const form = new FormData()
  form.set('From', from)
  form.set('To', '+18166088588')
  form.set('Body', body)
  form.set('MessageSid', `SM-${body}`)
  return new Request('https://crm.savingkc.com/api/twilio-sms-webhook', { method: 'POST', body: form })
}

describe('inbound SMS selling-intent gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T15:00:00.000Z'))
    inserts = []
    updates = []
    knownLead = true
    priorOutbound = null
    activity = null
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.rateLimit.mockReturnValue({ allowed: true })
    mocks.getClientIp.mockReturnValue('127.0.0.1')
    mocks.processInboundSmsConsent.mockImplementation(async (input: { keyword: string }) => (
      input.keyword.trim().toUpperCase() === 'STOP' ? '<Response><Message>You have been unsubscribed</Message></Response>' : null
    ))
    mocks.safeSendSMS.mockResolvedValue({ success: true, sid: 'SM-alert' })
    mocks.lookupProspectByPhone.mockResolvedValue([])
    mocks.createEnrichedLeadFromProspect.mockResolvedValue('lead-created')
    mocks.formatProspectAlert.mockReturnValue('prospect context')
    mocks.isGoogleAdsPhoneNumber.mockReturnValue(false)
    mocks.resolveGoogleAdsLeadContext.mockResolvedValue({ leadId: null, leadName: null })
    mocks.recordAppointmentSmsResponse.mockResolvedValue({ handled: false })
    mocks.regenerateBriefing.mockResolvedValue(undefined)
    mocks.sendPushToAgents.mockResolvedValue(1)
    mocks.sendPushToAgentNames.mockResolvedValue(1)
    mocks.sendMobilePushToAgentNames.mockResolvedValue(1)
    mocks.from.mockImplementation((table: string) => chain(table))
    mocks.rpc.mockImplementation(async () => ({
      data: [{
        resolution: knownLead ? 'normalized_phone' : 'unknown',
        candidate_count: knownLead ? 1 : 0,
        lead_id: knownLead ? 'lead-123' : null,
        full_name: knownLead ? 'Jessica Watkins' : null,
        phone: knownLead ? PHONE : null,
        station: 'new',
        priority: 'warm',
        matched_outbound_activity_id: null,
      }],
      error: null,
    }))
  })

  it('saves "Please text me." on a known contact without paging or classifying a lead', async () => {
    expect((await POST(request('Please text me.'))).status).toBe(200)
    expect(activity?.lead_id).toBe('lead-123')
    expect(activity?.metadata.direction).toBe('received')
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(inserts.some((row) => trigger(row) === 'lead_reply_alert')).toBe(false)
    expect(wroteClassification()).toBe(false)
  })

  it('pages a known contact who says they want to sell, without writing classification', async () => {
    expect((await POST(request('I am interested in selling'))).status).toBe(200)
    expect(inserts.some((row) => trigger(row) === 'lead_reply_alert')).toBe(true)
    expect(mocks.safeSendSMS).toHaveBeenCalled()
    expect(wroteClassification()).toBe(false)
  })

  it('does not take the YES branch for a lone Y or a YES with no sell auto-text', async () => {
    expect((await POST(request('Y'))).status).toBe(200)
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(inserts.some((row) => trigger(row) === 'yes_reply_alert')).toBe(false)

    activity = null
    inserts = []
    updates = []
    mocks.safeSendSMS.mockClear()
    expect((await POST(request('YES'))).status).toBe(200)
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(wroteClassification()).toBe(false)
  })

  it('pages YES only when it answers the sell auto-text', async () => {
    priorOutbound = SELL_AUTO_TEXT
    expect((await POST(request('YES'))).status).toBe(200)
    expect(inserts.some((row) => trigger(row) === 'yes_reply_alert')).toBe(true)
    expect(mocks.safeSendSMS).toHaveBeenCalled()
    expect(wroteClassification()).toBe(false)
  })

  it('creates a tax-list prospect for an identity check and does not page', async () => {
    knownLead = false
    mocks.lookupProspectByPhone.mockResolvedValue([{ prospect_id: 'prospect-1', owner_1: 'Owner', county: 'jackson' }])
    expect((await POST(request('Is this Saving KC?'))).status).toBe(200)
    expect(mocks.createEnrichedLeadFromProspect).toHaveBeenCalledWith(expect.anything(), PHONE, 'tax_delinquent_inbound_sms', 'warm')
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(inserts.some((row) => trigger(row) === 'prospect_sms_alert')).toBe(false)
  })

  it('pages a tax-list contact who asks for an offer and does not classify them', async () => {
    knownLead = false
    mocks.lookupProspectByPhone.mockResolvedValue([{ prospect_id: 'prospect-1', owner_1: 'Owner', county: 'jackson' }])
    expect((await POST(request('I want an offer on my property'))).status).toBe(200)
    expect(mocks.createEnrichedLeadFromProspect).toHaveBeenCalledWith(expect.anything(), PHONE, 'tax_delinquent_inbound_sms', 'hot')
    expect(inserts.some((row) => trigger(row) === 'prospect_sms_alert')).toBe(true)
    expect(wroteClassification()).toBe(false)
  })

  it('keeps STOP on the consent path with no page and no opt-out write from the intent helper', async () => {
    const response = await POST(request('STOP'))
    await expect(response.text()).resolves.toContain('You have been unsubscribed')
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(inserts.filter((row) => row.table === 'sms_opt_outs')).toHaveLength(0)
  })
})
