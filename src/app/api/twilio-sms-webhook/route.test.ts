import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
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

vi.mock('@/lib/sms-consent-audit', () => ({
  processInboundSmsConsent: mocks.processInboundSmsConsent,
}))

vi.mock('@/lib/briefing-regen', () => ({
  regenerateBriefing: mocks.regenerateBriefing,
}))

vi.mock('@/lib/push-notifications', () => ({
  sendPushToAgents: mocks.sendPushToAgents,
  sendPushToAgentNames: mocks.sendPushToAgentNames,
}))

vi.mock('@/lib/mobile-push', () => ({
  sendMobilePushToAgentNames: mocks.sendMobilePushToAgentNames,
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

vi.mock('@/lib/server/appointment-sms-response', () => ({
  recordAppointmentSmsResponse: mocks.recordAppointmentSmsResponse,
}))

import { POST } from './route'

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
const PROSPECT_PHONE = '+19135550123'

function makeSmsRequest(body: string, from = PROSPECT_PHONE, to = '+1816608559'): Request {
  const form = new FormData()
  form.set('From', from)
  form.set('To', to)
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
  const filters: Array<[string, unknown]> = []
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
    if (table === 'leads') {
      if (phoneLookupError && filters.some(([column]) => column === 'phone')) return { data: null, error: phoneLookupError }
      if (filters.some(([column]) => column === 'id')) {
        const id = filters.find(([column]) => column === 'id')?.[1]
        return { data: createdLeadRow?.id === id ? createdLeadRow : lead.id === id ? lead : null, error: null }
      }
      const phone = filters.find(([column]) => column === 'phone')?.[1]
      if (createdLeadRow && phone === createdLeadRow.phone) return { data: createdLeadRow, error: null }
      if (reviewUnknown) return { data: null, error: null }
      return { data: lead, error: null }
    }
    if (table === 'lead_activities' && pendingUpdate) {
      const payload = pendingUpdate
      pendingUpdate = null
      if (payload.lead_id) {
        if (reviewLinkFailure) return { data: null, error: { message: 'link DB unavailable' } }
        if (!existingSmsRow || existingSmsRow.id !== filters.find(([column]) => column === 'id')?.[1] || (existingSmsRow.lead_id ?? null) !== null) return { data: null, error: null }
        if (filters.some(([column, expected]) => column.startsWith('metadata->>') && existingSmsRow?.metadata?.[column.slice('metadata->>'.length)] !== expected)) return { data: null, error: null }
        existingSmsRow = { ...existingSmsRow, lead_id: String(payload.lead_id) }
        return { data: { id: existingSmsRow.id, lead_id: existingSmsRow.lead_id }, error: null }
      }
      const metadata = payload.metadata as Record<string, unknown> | undefined
      if (!metadata || !existingSmsRow) return { data: null, error: null }
      if (completionFailure && metadata.inbound_processing_state === 'completed') return { data: null, error: { message: 'completion interrupted' } }
      if (claimConflict && metadata.inbound_processing_state === 'processing') return { data: null, error: null }
      for (const [column, expected] of filters) {
        if (column === 'metadata->>message_sid' && existingSmsRow.metadata?.message_sid !== expected) return { data: null, error: null }
        if (column === 'metadata->>inbound_processing_state' && existingSmsRow.metadata?.inbound_processing_state !== expected) return { data: null, error: null }
        if (column === 'metadata->>inbound_processing_claim_id' && existingSmsRow.metadata?.inbound_processing_claim_id !== expected) return { data: null, error: null }
      }
      existingSmsRow = { ...existingSmsRow, metadata }
      return { data: { id: existingSmsRow.id }, error: null }
    }
    if (table === 'lead_activities' && !pendingUpdate && filters.some(([column]) => column === 'id')) {
      if (filters.some(([column, expected]) => column.startsWith('metadata->>') && existingSmsRow?.metadata?.[column.slice('metadata->>'.length)] !== expected)) return { data: null, error: null }
      return { data: existingSmsRow && existingSmsRow.id === filters.find(([column]) => column === 'id')?.[1]
        ? { id: existingSmsRow.id, lead_id: existingSmsRow.lead_id } : null, error: null }
    }
    if (table === 'lead_activities' && dedupeQueryError) return { data: null, error: dedupeQueryError }
    if (table === 'lead_activities' && existingSmsRow) {
      const directions = filters.find(([column]) => column === 'metadata->>direction')?.[1] as string[] | undefined
      if (directions && !directions.includes(String(existingSmsRow.metadata?.direction))) return { data: null, error: null }
      return { data: existingSmsRow, error: null }
    }
    return { data: null, error: null }
  })
  chain.single = vi.fn(async () => {
    if (table === 'lead_activities' && pendingInsert?.activity_type === 'sms') {
      const payload = pendingInsert
      pendingInsert = null
      if (smsInsertError) return { data: null, error: smsInsertError }
      existingSmsRow = { id: 'activity-persisted', lead_id: payload.lead_id as string | null, metadata: payload.metadata as Record<string, unknown> }
      return { data: { id: existingSmsRow.id, lead_id: existingSmsRow.lead_id }, error: null }
    }
    if (table === 'leads' && pendingInsert) {
      const payload = pendingInsert
      pendingInsert = null
      if (reviewCreateFailure) return { data: null, error: { message: 'create DB unavailable' } }
      if (reviewCreateNoId) return { data: null, error: null }
      createdLeadRow = { id: 'lead-created', full_name: String(payload.full_name), phone: String(payload.phone), station: 'new', priority: 'warm' }
      if (loseClaimBeforeLink && existingSmsRow) existingSmsRow.metadata = { ...existingSmsRow.metadata, inbound_processing_claim_id: 'newer-handler' }
      return { data: { id: createdLeadRow.id }, error: null }
    }
    return { data: null, error: null }
  })
  return chain
}

let inserts: Array<{ table: string; payload: unknown }>
let updates: Array<{ table: string; payload: unknown }>
let existingSmsRow: { id: string; lead_id?: string | null; metadata?: Record<string, unknown>; created_at?: string } | null
let claimConflict: boolean
let completionFailure: boolean
let pendingUpdate: Record<string, unknown> | null
let pendingInsert: Record<string, unknown> | null
let reviewUnknown = false
let reviewLinkFailure = false
let reviewCreateFailure = false
let reviewCreateNoId = false
let loseClaimBeforeLink = false
let phoneLookupError: { message: string } | null
type SyntheticLead = { id: string; phone: string; full_name?: string; station?: string; priority?: string; source?: string; assigned_to?: string | null }
let createdLeadRow: SyntheticLead | null
let lead: SyntheticLead
let smsInsertError: { code?: string; message: string } | null
let dedupeQueryError: { message: string } | null

describe('twilio SMS webhook seller responses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T15:00:00.000Z')) // Weekday, 10 AM Central
    inserts = []
    updates = []
    existingSmsRow = null
    claimConflict = false
    completionFailure = false
    pendingUpdate = null
    pendingInsert = null
    reviewUnknown = false
    reviewLinkFailure = false
    reviewCreateFailure = false
    reviewCreateNoId = false
    loseClaimBeforeLink = false
    phoneLookupError = null
    createdLeadRow = null
    lead = { id: 'lead-123', full_name: 'Jessica Watkins', phone: PROSPECT_PHONE, station: 'new', priority: 'normal' }
    smsInsertError = null
    dedupeQueryError = null
    process.env.CASEY_PHONE = '+18167564943'
    process.env.ERNEST_PHONE = '+18162262552'
    process.env.TWILIO_PHONE_NUMBER = '+18163077835'
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.rateLimit.mockReturnValue({ allowed: true })
    mocks.getClientIp.mockReturnValue('127.0.0.1')
    mocks.isOptedOut.mockResolvedValue(false)
    mocks.handleOptOut.mockResolvedValue(undefined)
    mocks.handleOptIn.mockResolvedValue(undefined)
    mocks.processInboundSmsConsent.mockImplementation(async (input: { keyword: string }) => (
      input.keyword.trim().toUpperCase() === 'STOP'
        ? '<Response><Message>You have been unsubscribed</Message></Response>'
        : null
    ))
    mocks.isStopKeyword.mockImplementation((value: string) => value.trim().toUpperCase() === 'STOP')
    mocks.isStartKeyword.mockImplementation((value: string) => value.trim().toUpperCase() === 'START')
    mocks.regenerateBriefing.mockResolvedValue(undefined)
    mocks.sendPushToAgents.mockResolvedValue(1)
    mocks.sendPushToAgentNames.mockResolvedValue(1)
    mocks.sendMobilePushToAgentNames.mockResolvedValue(1)
    mocks.lookupProspectByPhone.mockResolvedValue([])
    mocks.createEnrichedLeadFromProspect.mockResolvedValue('lead-created')
    mocks.formatProspectAlert.mockReturnValue('prospect context')
    mocks.safeSendSMS.mockResolvedValue({ success: true, sid: 'SM-alert' })
    mocks.isGoogleAdsPhoneNumber.mockReturnValue(false)
    mocks.resolveGoogleAdsLeadContext.mockResolvedValue({ leadId: null, leadName: null })
    mocks.recordAppointmentSmsResponse.mockImplementation(async ({ message }: { message: string }) => (
      message.trim().toUpperCase() === 'CONFIRM'
        ? { handled: true, appointmentId: 'appointment-1', response: 'confirm' }
        : { handled: false }
    ))
    mocks.from.mockImplementation((table: string) => supabaseChain(table))
    mocks.rpc.mockImplementation(async () => {
      if (phoneLookupError) return { data: null, error: phoneLookupError }
      const matchedLead = createdLeadRow ?? (reviewUnknown ? null : lead)
      return { data: [{
        resolution: matchedLead ? 'normalized_phone' : 'unknown', candidate_count: matchedLead ? 1 : 0,
        lead_id: matchedLead?.id ?? null, full_name: matchedLead?.full_name ?? null,
        phone: matchedLead?.phone ?? null, station: matchedLead?.station ?? null, priority: matchedLead?.priority ?? null,
        matched_outbound_activity_id: null,
      }], error: null }
    })
  })

  afterEach(() => vi.useRealTimers())

  it('does not send a canned TwiML reply back to a prospect who texts YES', async () => {
    const response = await POST(makeSmsRequest('YES'))

    await expect(response.text()).resolves.toBe(EMPTY_TWIML)
    expect(mocks.safeSendSMS).toHaveBeenCalledTimes(2)
    expect(mocks.safeSendSMS).not.toHaveBeenCalledWith(expect.objectContaining({ to: PROSPECT_PHONE }))
    expect(inserts.some(({ table, payload }) => (
      table === 'lead_activities' &&
      typeof payload === 'object' &&
      payload !== null &&
      (payload as { activity_type?: string }).activity_type === 'task'
    ))).toBe(false)
  })

  it('alerts only Casey for texts to Casey company line during the 8-to-5 window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T13:00:00.000Z')) // 8:00 AM Central

    const response = await POST(makeSmsRequest('YES', PROSPECT_PHONE, '+18167277667'))

    await expect(response.text()).resolves.toBe(EMPTY_TWIML)
    expect(mocks.safeSendSMS).toHaveBeenCalledTimes(1)
    expect(mocks.safeSendSMS).toHaveBeenCalledWith(expect.objectContaining({ to: '+18167564943' }))
    expect(mocks.safeSendSMS).not.toHaveBeenCalledWith(expect.objectContaining({ to: '+18162262552' }))
    expect(mocks.sendPushToAgentNames).toHaveBeenCalledWith(['Casey'], expect.any(Object))
    expect(mocks.sendMobilePushToAgentNames).toHaveBeenCalledWith(['Casey'], expect.objectContaining({
      data: expect.objectContaining({
        kind: 'inbound_sms',
        href: '/conversation/lead-123',
        leadId: 'lead-123',
        eventId: 'sms_SM-YES',
      }),
    }))
    vi.useRealTimers()
  })

  it('suppresses alerts for texts to Casey company line at 5 PM Central', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T22:00:00.000Z')) // 5:00 PM Central

    const response = await POST(makeSmsRequest('YES', PROSPECT_PHONE, '+18167277667'))

    await expect(response.text()).resolves.toBe(EMPTY_TWIML)
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(mocks.sendPushToAgentNames).toHaveBeenCalledWith([], expect.any(Object))
    expect(mocks.sendMobilePushToAgentNames).toHaveBeenCalledWith([], expect.objectContaining({
      data: expect.objectContaining({ kind: 'inbound_sms', eventId: 'sms_SM-YES' }),
    }))
    vi.useRealTimers()
  })

  it('sends Expo push to Ernest and Casey for a known lead text while keeping Web Push', async () => {
    const response = await POST(makeSmsRequest('Please call me', '+19137179716', '+18166088588'))

    await expect(response.text()).resolves.toBe(EMPTY_TWIML)
    expect(mocks.sendPushToAgents).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Lead Texted',
      url: '/leads/lead-123',
    }))
    expect(mocks.sendMobilePushToAgentNames).toHaveBeenCalledWith(['Ernest', 'Casey'], {
      title: 'Lead Texted',
      body: 'Jessica Watkins: "Please call me"',
      data: {
        href: '/conversation/lead-123',
        kind: 'inbound_sms',
        leadId: 'lead-123',
        eventId: 'sms_SM-Please call me',
      },
    })
  })

  it('does not send a canned TwiML reply back to a prospect who texts CONFIRM', async () => {
    const response = await POST(makeSmsRequest('CONFIRM'))

    await expect(response.text()).resolves.toBe(EMPTY_TWIML)
    expect(mocks.safeSendSMS).not.toHaveBeenCalledWith(expect.objectContaining({ to: PROSPECT_PHONE }))
    expect(mocks.recordAppointmentSmsResponse).toHaveBeenCalledWith({
      leadId: 'lead-123',
      message: 'CONFIRM',
      messageSid: 'SM-CONFIRM',
    })
    expect(mocks.regenerateBriefing).toHaveBeenCalledWith('lead-123', 'appointment_confirmed')
  })

  it('keeps TCPA STOP acknowledgement intact', async () => {
    const response = await POST(makeSmsRequest('STOP'))

    await expect(response.text()).resolves.toContain('You have been unsubscribed')
    expect(mocks.processInboundSmsConsent).toHaveBeenCalledWith(expect.objectContaining({
      from: PROSPECT_PHONE,
      messageSid: 'SM-STOP',
      source: 'twilio_sms_webhook',
    }))
  })

  it('returns a retryable response when inbound conversation persistence fails', async () => {
    smsInsertError = { code: '08006', message: 'database unavailable' }

    const response = await POST(makeSmsRequest('Please call me'))

    expect(response.status).toBe(503)
    await expect(response.text()).resolves.toBe(EMPTY_TWIML)
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(mocks.sendPushToAgents).not.toHaveBeenCalled()
  })

  it('acknowledges a previously recorded MessageSid without repeating downstream actions', async () => {
    existingSmsRow = { id: 'activity-existing', metadata: { direction: 'received', message_sid: 'SM-Please call me' } }

    const response = await POST(makeSmsRequest('Please call me'))

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe(EMPTY_TWIML)
    expect(mocks.processInboundSmsConsent).not.toHaveBeenCalled()
    expect(inserts).toEqual([])
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(mocks.sendPushToAgents).not.toHaveBeenCalled()
  })

  it('resumes a persisted pending MessageSid and only acknowledges after marking it completed', async () => {
    existingSmsRow = { id: 'activity-pending', lead_id: null, metadata: {
      source: 'twilio_sms_webhook', inbound_webhook_version: '2', inbound_processing_state: 'pending',
      direction: 'received', message_sid: 'SM-Please call me', from: PROSPECT_PHONE, to: '+1816608559',
    } }
    const response = await POST(makeSmsRequest('Please call me'))
    expect(response.status).toBe(200)
    expect(mocks.safeSendSMS).toHaveBeenCalled()
    expect(updates).toContainEqual(expect.objectContaining({
      table: 'lead_activities',
      payload: expect.objectContaining({ metadata: expect.objectContaining({ inbound_processing_state: 'completed' }) }),
    }))
  })

  it('returns retryable after inbound persistence when downstream processing is interrupted, then resumes the same SID', async () => {
    mocks.safeSendSMS.mockRejectedValueOnce(new Error('alert transport interrupted'))
    const first = await POST(makeSmsRequest('Please call me'))
    expect(first.status).toBe(503)
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('processing')
    expect(updates.some(({ payload }) => (
      (payload as { metadata?: { inbound_processing_state?: string } }).metadata?.inbound_processing_state === 'completed'
    ))).toBe(false)

    vi.setSystemTime(new Date('2026-06-03T15:01:01.000Z'))
    const retry = await POST(makeSmsRequest('Please call me'))
    expect(retry.status).toBe(200)
    expect(updates.some(({ payload }) => (
      (payload as { metadata?: { inbound_processing_state?: string } }).metadata?.inbound_processing_state === 'completed'
    ))).toBe(true)
  })

  it.each([
    ['lead insert error', () => { reviewCreateFailure = true }],
    ['lead insert without an id', () => { reviewCreateNoId = true }],
  ])('leaves the SID retryable after %s and links the persisted activity on recovery', async (_label, configure) => {
    reviewUnknown = true
    configure()

    const first = await POST(makeSmsRequest('Please call me'))
    expect(first.status).toBe(503)
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('processing')
    expect(existingSmsRow?.lead_id ?? null).toBeNull()
    expect(existingSmsRow?.metadata?.inbound_processing_state).not.toBe('completed')

    reviewCreateFailure = false
    reviewCreateNoId = false
    vi.setSystemTime(new Date('2026-06-03T15:01:01.000Z'))
    const retry = await POST(makeSmsRequest('Please call me'))

    expect(retry.status).toBe(200)
    expect(existingSmsRow?.lead_id).toBe('lead-created')
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('completed')
    expect(inserts.filter(({ table }) => table === 'leads')).toHaveLength(2)
  })

  it('repairs the persisted activity link on retry after lead creation succeeded but linking failed', async () => {
    reviewUnknown = true
    reviewLinkFailure = true

    const first = await POST(makeSmsRequest('Please call me'))
    expect(first.status).toBe(503)
    expect(createdLeadRow?.id).toBe('lead-created')
    expect(existingSmsRow?.lead_id ?? null).toBeNull()
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('processing')

    reviewLinkFailure = false
    vi.setSystemTime(new Date('2026-06-03T15:01:01.000Z'))
    const retry = await POST(makeSmsRequest('Please call me'))

    expect(retry.status).toBe(200)
    expect(existingSmsRow?.lead_id).toBe('lead-created')
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('completed')
    expect(inserts.filter(({ table }) => table === 'leads')).toHaveLength(1)
  })

  it('does not complete stale processing until it repairs an existing lead link without creating a duplicate', async () => {
    existingSmsRow = { id: 'activity-stale', lead_id: null, metadata: {
      source: 'twilio_sms_webhook', inbound_webhook_version: '2', inbound_processing_state: 'processing',
      inbound_processing_started_at: '2026-06-03T14:58:00.000Z', inbound_processing_claim_id: 'expired-claim',
      direction: 'received', message_sid: 'SM-Please call me', from: PROSPECT_PHONE, to: '+1816608559',
    } }
    createdLeadRow = { id: 'lead-created', full_name: 'Previously created seller', phone: PROSPECT_PHONE, station: 'new', priority: 'warm' }

    const response = await POST(makeSmsRequest('Please call me'))

    expect(response.status).toBe(200)
    expect(existingSmsRow?.lead_id).toBe('lead-created')
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('completed')
    expect(inserts.filter(({ table }) => table === 'leads')).toHaveLength(0)
  })

  it('returns retryable when the phone lookup fails instead of treating the sender as a new lead', async () => {
    phoneLookupError = { message: 'lead lookup unavailable' }

    const response = await POST(makeSmsRequest('Please call me'))

    expect(response.status).toBe(503)
    expect(inserts.filter(({ table }) => table === 'leads')).toHaveLength(0)
    expect(existingSmsRow).toBeNull()
  })

  it('does not complete a generic YES activity until the newly created lead is linked', async () => {
    reviewUnknown = true
    reviewLinkFailure = true

    const response = await POST(makeSmsRequest('YES'))

    expect(response.status).toBe(503)
    expect(existingSmsRow?.lead_id ?? null).toBeNull()
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('processing')
    expect(existingSmsRow?.metadata?.inbound_processing_state).not.toBe('completed')
  })

  it('persists the link before completing a newly created generic YES lead', async () => {
    reviewUnknown = true

    const response = await POST(makeSmsRequest('YES'))

    expect(response.status).toBe(200)
    expect(existingSmsRow?.lead_id).toBe('lead-created')
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('completed')
  })

  it('keeps a YES prospect activity retryable when enrichment returns no lead id', async () => {
    reviewUnknown = true
    mocks.lookupProspectByPhone.mockResolvedValue([{ prospect_id: 'prospect-1', contact_name: 'Prospect', relationship: 'owner', owner_1: 'Owner' }])
    mocks.createEnrichedLeadFromProspect.mockResolvedValueOnce(null)

    const response = await POST(makeSmsRequest('YES'))

    expect(response.status).toBe(503)
    expect(existingSmsRow?.lead_id ?? null).toBeNull()
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('processing')
    expect(existingSmsRow?.metadata?.inbound_processing_state).not.toBe('completed')
  })

  it('returns retryable when prospect enrichment does not return a lead id', async () => {
    reviewUnknown = true
    mocks.lookupProspectByPhone.mockResolvedValue([{ prospect_id: 'prospect-1', contact_name: 'Prospect', relationship: 'owner', owner_1: 'Owner' }])
    mocks.createEnrichedLeadFromProspect.mockResolvedValueOnce(null)

    const response = await POST(makeSmsRequest('Please call me'))

    expect(response.status).toBe(503)
    expect(existingSmsRow?.lead_id ?? null).toBeNull()
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('processing')
    expect(existingSmsRow?.metadata?.inbound_processing_state).not.toBe('completed')
  })

  it('returns retryable when Google Ads lead resolution has no id', async () => {
    reviewUnknown = true
    mocks.isGoogleAdsPhoneNumber.mockReturnValue(true)
    mocks.resolveGoogleAdsLeadContext.mockResolvedValue({ leadId: null, leadName: null })

    const response = await POST(makeSmsRequest('Please call me'))

    expect(response.status).toBe(503)
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('processing')
    expect(existingSmsRow?.metadata?.inbound_processing_state).not.toBe('completed')
  })

  it('does not complete the Google Ads activity when its lead link cannot be persisted', async () => {
    reviewUnknown = true
    mocks.isGoogleAdsPhoneNumber.mockReturnValue(true)
    mocks.resolveGoogleAdsLeadContext.mockResolvedValue({ leadId: 'lead-ads', leadName: 'Ads seller' })
    reviewLinkFailure = true

    const response = await POST(makeSmsRequest('Please call me'))

    expect(response.status).toBe(503)
    expect(existingSmsRow?.lead_id ?? null).toBeNull()
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('processing')
    expect(existingSmsRow?.metadata?.inbound_processing_state).not.toBe('completed')
  })

  it('links a Google Ads inbound activity before completing its MessageSid', async () => {
    reviewUnknown = true
    mocks.isGoogleAdsPhoneNumber.mockReturnValue(true)
    mocks.resolveGoogleAdsLeadContext.mockResolvedValue({ leadId: 'lead-ads', leadName: 'Ads seller' })

    const response = await POST(makeSmsRequest('Please call me'))

    expect(response.status).toBe(200)
    expect(existingSmsRow?.lead_id).toBe('lead-ads')
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('completed')
  })

  it('returns retryable while an active lease is held', async () => {
    existingSmsRow = { id: 'activity-processing', metadata: {
      direction: 'received',
      inbound_processing_state: 'processing',
      inbound_processing_started_at: '2026-06-03T14:59:30.000Z',
      inbound_processing_claim_id: 'active-claim',
    } }
    const response = await POST(makeSmsRequest('Please call me'))
    expect(response.status).toBe(503)
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
  })

  it('does not treat a same-SID internal alert as the canonical inbound receipt', async () => {
    const alert = { id: 'alert-same-sid', metadata: { direction: 'outbound_alert', message_sid: 'SM-Please call me', to_agents: ['Ernest'] } }
    existingSmsRow = alert
    const response = await POST(makeSmsRequest('Please call me'))
    expect(response.status).toBe(200)
    expect(existingSmsRow?.id).toBe('activity-persisted')
    expect(existingSmsRow?.metadata?.direction).toBe('received')
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('completed')
    expect(alert.metadata).toEqual({ direction: 'outbound_alert', message_sid: 'SM-Please call me', to_agents: ['Ernest'] })
    expect(mocks.processInboundSmsConsent).toHaveBeenCalledOnce()
  })

  it('cannot relink or complete after another handler takes the processing claim', async () => {
    reviewUnknown = true
    loseClaimBeforeLink = true
    const response = await POST(makeSmsRequest('Can you call me?'))
    expect(response.status).toBe(503)
    expect(existingSmsRow?.lead_id).toBeNull()
    expect(existingSmsRow?.metadata?.inbound_processing_claim_id).toBe('newer-handler')
    expect(existingSmsRow?.metadata?.inbound_processing_state).toBe('processing')
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
  })

  it('does not run downstream work when the atomic SID claim loses a concurrent race', async () => {
    existingSmsRow = { id: 'activity-pending', metadata: { direction: 'received', inbound_processing_state: 'pending' } }
    claimConflict = true
    const response = await POST(makeSmsRequest('Please call me'))
    expect(response.status).toBe(503)
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
  })

  it('acknowledges a concurrent duplicate rejected by the unique MessageSid index', async () => {
    smsInsertError = { code: '23505', message: 'duplicate key lead_activities_twilio_inbound_message_sid_v2' }

    const response = await POST(makeSmsRequest('Please call me'))

    expect(response.status).toBe(503)
    await expect(response.text()).resolves.toBe(EMPTY_TWIML)
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(mocks.sendPushToAgents).not.toHaveBeenCalled()
  })

  it('returns a retryable response when MessageSid deduplication cannot be checked', async () => {
    dedupeQueryError = { message: 'read unavailable' }

    const response = await POST(makeSmsRequest('Please call me'))

    expect(response.status).toBe(503)
    await expect(response.text()).resolves.toBe(EMPTY_TWIML)
    expect(inserts).toEqual([])
    expect(mocks.processInboundSmsConsent).not.toHaveBeenCalled()
  })

  it('returns a retryable failure when TCPA STOP cannot be persisted', async () => {
    mocks.processInboundSmsConsent.mockRejectedValue(new Error('suppression database unavailable'))

    const response = await POST(makeSmsRequest('STOP'))

    expect(response.status).toBe(503)
    await expect(response.text()).resolves.toBe(EMPTY_TWIML)
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(mocks.processInboundSmsConsent).toHaveBeenCalledOnce()
  })

  it('marks every team-originated activity as internal conversation traffic', async () => {
    const response = await POST(makeSmsRequest('Internal coordination', '+18167564943'))

    await expect(response.text()).resolves.toBe(EMPTY_TWIML)
    const teamSmsRows = inserts.filter(({ table, payload }) => (
      table === 'lead_activities' &&
      typeof payload === 'object' &&
      payload !== null &&
      (payload as { activity_type?: string }).activity_type === 'sms'
    ))
    expect(teamSmsRows.length).toBeGreaterThan(0)
    for (const row of teamSmsRows) {
      expect(row.payload).toMatchObject({ metadata: { is_team: true } })
    }
  })
})
