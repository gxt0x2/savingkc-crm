import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  validateTwilioWebhook: vi.fn(),
  rateLimit: vi.fn(),
  getClientIp: vi.fn(),
  isOptedOut: vi.fn(),
  handleOptOut: vi.fn(),
  handleOptIn: vi.fn(),
  isStopKeyword: vi.fn(),
  isStartKeyword: vi.fn(),
  regenerateBriefing: vi.fn(),
  sendPushToAgents: vi.fn(),
  sendPushToAgentNames: vi.fn(),
  sendMobilePushToAgentNames: vi.fn(),
  lookupProspectByPhone: vi.fn(),
  createEnrichedLeadFromProspect: vi.fn(),
  formatProspectAlert: vi.fn(),
  safeSendSMS: vi.fn(),
  isGoogleAdsPhoneNumber: vi.fn(),
  markLeadAsGoogleAdsPhoneLead: vi.fn(),
  notifyGoogleAdsTeam: vi.fn(),
  resolveGoogleAdsLeadContext: vi.fn(),
  processInboundSmsConsent: vi.fn(),
  recordAppointmentSmsResponse: vi.fn(),
  afterRequest: vi.fn((work: () => unknown) => { void work() }),
}))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('@/lib/twilio-validate', () => ({ validateTwilioWebhook: mocks.validateTwilioWebhook }))
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
  markLeadAsGoogleAdsPhoneLead: mocks.markLeadAsGoogleAdsPhoneLead,
  notifyGoogleAdsTeam: mocks.notifyGoogleAdsTeam,
  phoneLookupVariants: (phone: string) => [phone],
  resolveGoogleAdsLeadContext: mocks.resolveGoogleAdsLeadContext,
}))
vi.mock('@/lib/server/appointment-sms-response', () => ({ recordAppointmentSmsResponse: mocks.recordAppointmentSmsResponse }))
vi.mock('@/lib/after-request', () => ({ afterRequest: (work: () => unknown) => mocks.afterRequest(work) }))

import { POST } from './route'

const PROSPECT_PHONE = '+19135550123'

type OutboundRow = { id: string; lead_id?: string | null; metadata: Record<string, unknown> }
type SmsRow = { id: string; lead_id: string | null; metadata: Record<string, unknown> }

let inserts: Array<{ table: string; payload: unknown }>
let updates: Array<{ table: string; payload: unknown }>
let existingSmsRow: SmsRow | null
let pendingUpdate: Record<string, unknown> | null
let pendingInsert: Record<string, unknown> | null
let knownLead: boolean
let matchedOutbound: OutboundRow | null
let matchedOutboundActivityId: string | null
let outboundLookupError: { message: string } | null

function makeSmsRequest(body: string) {
  const form = new FormData()
  form.set('From', PROSPECT_PHONE)
  form.set('To', '+1816608559')
  form.set('Body', body)
  form.set('MessageSid', `SM-${body}`)
  return new Request('https://crm.savingkc.com/api/twilio-sms-webhook', { method: 'POST', body: form })
}

function directionsOf(filters: Array<[string, unknown]>): string[] | null {
  const value = filters.find(([column]) => column === 'metadata->>direction')?.[1]
  return Array.isArray(value) ? value.map(String) : null
}

function supabaseChain(table: string) {
  const filters: Array<[string, unknown]> = []
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn((column: string, value: unknown) => { filters.push([column, value]); return chain })
  chain.in = vi.fn((column: string, value: unknown) => { filters.push([column, value]); return chain })
  chain.limit = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.is = vi.fn((column: string, value: unknown) => { filters.push([column, value]); return chain })
  chain.update = vi.fn((payload: unknown) => {
    updates.push({ table, payload })
    pendingUpdate = payload as Record<string, unknown>
    return chain
  })
  chain.insert = vi.fn((payload: unknown) => {
    inserts.push({ table, payload })
    pendingInsert = payload as Record<string, unknown>
    return chain
  })
  chain.maybeSingle = vi.fn(async () => {
    if (table !== 'lead_activities') return { data: null, error: null }
    const outbound = matchedOutbound
    const directions = directionsOf(filters)
    const outboundQuery = Boolean(directions?.includes('outbound'))
      || filters.some(([column, value]) => column === 'id' && value === outbound?.id)
    if (!pendingUpdate && outboundLookupError && outboundQuery) return { data: null, error: outboundLookupError }
    if (!pendingUpdate && outbound && filters.some(([column, value]) => column === 'id' && value === outbound.id)) {
      return { data: outbound, error: null }
    }
    if (!pendingUpdate && outbound && outboundQuery) return { data: outbound, error: null }
    if (pendingUpdate) {
      const payload = pendingUpdate
      pendingUpdate = null
      if (!existingSmsRow) return { data: null, error: null }
      if (payload.lead_id) {
        if ((existingSmsRow.lead_id ?? null) !== null) return { data: null, error: null }
        existingSmsRow = { ...existingSmsRow, lead_id: String(payload.lead_id) }
        return { data: { id: existingSmsRow.id, lead_id: existingSmsRow.lead_id }, error: null }
      }
      const metadata = payload.metadata as Record<string, unknown> | undefined
      if (!metadata) return { data: null, error: null }
      existingSmsRow = { ...existingSmsRow, metadata }
      return { data: { id: existingSmsRow.id }, error: null }
    }
    if (filters.some(([column]) => column === 'id')) {
      const id = filters.find(([column]) => column === 'id')?.[1]
      const row = existingSmsRow
      return { data: row && row.id === id ? { id: row.id, lead_id: row.lead_id } : null, error: null }
    }
    if (directions && existingSmsRow && !directions.includes(String(existingSmsRow.metadata.direction))) {
      return { data: null, error: null }
    }
    return { data: existingSmsRow, error: null }
  })
  chain.single = vi.fn(async () => {
    if (table === 'lead_activities' && pendingInsert?.activity_type === 'sms' && !existingSmsRow) {
      const payload = pendingInsert
      pendingInsert = null
      existingSmsRow = {
        id: 'activity-persisted',
        lead_id: (payload.lead_id as string | null) ?? null,
        metadata: payload.metadata as Record<string, unknown>,
      }
      return { data: { id: existingSmsRow.id, lead_id: existingSmsRow.lead_id }, error: null }
    }
    if (table === 'leads' && pendingInsert) {
      pendingInsert = null
      return { data: { id: 'lead-created' }, error: null }
    }
    return { data: null, error: null }
  })
  return chain
}

function hotEvent() {
  return inserts.some(({ table, payload }) => (
    table === 'ari_briefing_events' && (payload as { event_type?: string }).event_type === 'yes_reply_seller'
  ))
}

describe('YES replies follow the automated prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T15:00:00.000Z'))
    inserts = []
    updates = []
    existingSmsRow = null
    pendingUpdate = null
    pendingInsert = null
    knownLead = true
    matchedOutbound = null
    matchedOutboundActivityId = null
    outboundLookupError = null
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.rateLimit.mockReturnValue({ allowed: true })
    mocks.getClientIp.mockReturnValue('127.0.0.1')
    mocks.processInboundSmsConsent.mockResolvedValue(null)
    mocks.isStopKeyword.mockReturnValue(false)
    mocks.isStartKeyword.mockReturnValue(false)
    mocks.regenerateBriefing.mockResolvedValue(undefined)
    mocks.sendPushToAgents.mockResolvedValue(1)
    mocks.sendPushToAgentNames.mockResolvedValue(1)
    mocks.sendMobilePushToAgentNames.mockResolvedValue(1)
    mocks.lookupProspectByPhone.mockResolvedValue([])
    mocks.createEnrichedLeadFromProspect.mockResolvedValue('lead-created')
    mocks.formatProspectAlert.mockReturnValue('prospect context')
    mocks.safeSendSMS.mockResolvedValue({ success: true, sid: 'SM-alert' })
    mocks.isGoogleAdsPhoneNumber.mockReturnValue(false)
    mocks.recordAppointmentSmsResponse.mockResolvedValue({ handled: false })
    mocks.afterRequest.mockImplementation((work: () => unknown) => { void work() })
    mocks.from.mockImplementation((table: string) => supabaseChain(table))
    mocks.rpc.mockImplementation(async () => {
      if (!knownLead) {
        return { data: [{
          resolution: 'unknown', candidate_count: 0, lead_id: null, full_name: null,
          phone: null, station: null, priority: null, matched_outbound_activity_id: null,
        }], error: null }
      }
      return { data: [{
        resolution: 'normalized_phone', candidate_count: 1, lead_id: 'lead-123',
        full_name: 'Jessica Watkins', phone: PROSPECT_PHONE, station: 'new', priority: 'normal',
        matched_outbound_activity_id: matchedOutboundActivityId,
      }], error: null }
    })
  })

  it('keeps a YES answer to a mobile 1:1 on the normal lead reply alert', async () => {
    matchedOutboundActivityId = 'outbound-1to1'
    matchedOutbound = {
      id: 'outbound-1to1',
      lead_id: 'lead-123',
      metadata: { direction: 'outbound', source: 'mobile_app', template_id: 'sms.conversation.1to1.v1' },
    }

    const response = await POST(makeSmsRequest('YES'))

    expect(response.status).toBe(200)
    expect(mocks.sendPushToAgents).toHaveBeenCalledWith(expect.objectContaining({ title: 'Lead Texted' }))
    expect(hotEvent()).toBe(false)
    expect(updates.some(({ table, payload }) => table === 'leads' && (payload as { priority?: string }).priority === 'hot')).toBe(false)
  })

  it('keeps a YES answer to a web 1:1 on the normal lead reply alert', async () => {
    matchedOutbound = {
      id: 'outbound-web',
      lead_id: 'lead-123',
      metadata: { direction: 'outbound', to: PROSPECT_PHONE },
    }

    const response = await POST(makeSmsRequest('Y'))

    expect(response.status).toBe(200)
    expect(mocks.sendPushToAgents).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Lead Texted',
      body: 'Jessica Watkins: "Y"',
    }))
    expect(inserts.some(({ payload }) => (payload as { metadata?: { trigger?: string } }).metadata?.trigger === 'lead_reply_alert')).toBe(true)
    expect(inserts.some(({ payload }) => (payload as { metadata?: { trigger?: string } }).metadata?.trigger === 'yes_reply_alert')).toBe(false)
  })

  it.each([
    'missed_call_auto',
    'cold_callback_auto_text',
    'missed_call_followup',
  ])('still treats YES to a %s prompt as a hot seller reply', async (trigger) => {
    matchedOutboundActivityId = 'outbound-auto'
    matchedOutbound = {
      id: 'outbound-auto',
      lead_id: 'lead-123',
      metadata: { direction: 'outbound', trigger, to: PROSPECT_PHONE },
    }

    const response = await POST(makeSmsRequest('YES'))

    expect(response.status).toBe(200)
    expect(mocks.sendPushToAgents).toHaveBeenCalledWith(expect.objectContaining({ title: 'HOT: YES Reply' }))
    expect(updates).toContainEqual({ table: 'leads', payload: { priority: 'hot' } })
    expect(hotEvent()).toBe(true)
  })

  it('creates the YES-reply lead when an unknown sender answers an auto-text', async () => {
    knownLead = false
    matchedOutbound = {
      id: 'outbound-unknown',
      lead_id: null,
      metadata: { direction: 'outbound', trigger: 'missed_call_auto', to: PROSPECT_PHONE },
    }

    const response = await POST(makeSmsRequest('YES PLEASE'))

    expect(response.status).toBe(200)
    expect(inserts).toContainEqual(expect.objectContaining({
      table: 'leads',
      payload: expect.objectContaining({
        full_name: 'Inbound Seller (YES reply)',
        source: 'sms_yes_reply',
        priority: 'hot',
        phone: PROSPECT_PHONE,
      }),
    }))
    expect(mocks.sendPushToAgents).toHaveBeenCalledWith(expect.objectContaining({ title: 'HOT: YES Reply' }))
  })

  it('creates a normal unknown lead when YES has no automated prompt', async () => {
    knownLead = false

    const response = await POST(makeSmsRequest('YES'))

    expect(response.status).toBe(200)
    expect(inserts).toContainEqual(expect.objectContaining({
      table: 'leads',
      payload: expect.objectContaining({ source: 'inbound_sms', priority: 'warm' }),
    }))
    expect(inserts.some(({ table, payload }) => table === 'leads' && (payload as { source?: string }).source === 'sms_yes_reply')).toBe(false)
    expect(hotEvent()).toBe(false)
  })

  it('uses the normal reply alert when the prompt lookup fails', async () => {
    matchedOutboundActivityId = 'outbound-auto'
    matchedOutbound = {
      id: 'outbound-auto',
      lead_id: 'lead-123',
      metadata: { direction: 'outbound', trigger: 'missed_call_auto' },
    }
    outboundLookupError = { message: 'lookup unavailable' }

    const response = await POST(makeSmsRequest('YES'))

    expect(response.status).toBe(200)
    expect(mocks.sendPushToAgents).toHaveBeenCalledWith(expect.objectContaining({ title: 'Lead Texted' }))
    expect(updates.some(({ table, payload }) => table === 'leads' && (payload as { priority?: string }).priority === 'hot')).toBe(false)
  })
})
