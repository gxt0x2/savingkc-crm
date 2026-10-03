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

describe('twilio SMS webhook identity continuity', () => {
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

  it('links a reply to the accepted outbound thread when a dead placeholder shares the normalized number', async () => {
    lead = { id: '68997f70-04be-4119-bb24-c5e959f4d6b1', full_name: 'Ernest Dodson', phone: '\u202a(913) 717-9716\u202c', station: 'contacted', priority: 'normal' }
    mocks.rpc.mockResolvedValue({ data: [{ resolution: 'outbound_thread', candidate_count: 2,
      lead_id: lead.id, full_name: lead.full_name, phone: lead.phone, station: lead.station, priority: lead.priority,
      matched_outbound_activity_id: '88d0ab17-7f3c-49e4-95cb-8031961b0711' }], error: null })
    const response = await POST(makeSmsRequest('Reply to Hello', '+19137179716', '+18166088588'))
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_inbound_sms_lead_v1', {
      p_customer_phone: '+19137179716', p_company_phone: '+18166088588', p_received_at: '2026-06-03T15:00:00.000Z',
    })
    expect(existingSmsRow).toMatchObject({ lead_id: lead.id, metadata: {
      inbound_lead_resolution: 'outbound_thread', inbound_lead_candidate_count: 2,
      inbound_matched_outbound_activity_id: '88d0ab17-7f3c-49e4-95cb-8031961b0711', inbound_processing_state: 'completed',
    } })
    expect(mocks.lookupProspectByPhone).not.toHaveBeenCalled()
    expect(inserts.filter(({ table }) => table === 'leads')).toHaveLength(0)
  })

  it.each(['YES', 'CONFIRM', 'Please call me'])('retains an ambiguous %s as unmatched without automatic side effects, including on retry', async (body) => {
    mocks.rpc.mockResolvedValue({ data: [{ resolution: 'ambiguous', candidate_count: 2,
      lead_id: null, matched_outbound_activity_id: null }], error: null })
    mocks.isGoogleAdsPhoneNumber.mockReturnValue(true)
    const response = await POST(makeSmsRequest(body))
    expect(response.status).toBe(200)
    expect(existingSmsRow).toMatchObject({ lead_id: null, metadata: {
      needs_identity_review: true, inbound_lead_resolution: 'ambiguous', inbound_processing_state: 'completed',
    } })
    expect(mocks.lookupProspectByPhone).not.toHaveBeenCalled()
    expect(mocks.createEnrichedLeadFromProspect).not.toHaveBeenCalled()
    expect(mocks.resolveGoogleAdsLeadContext).not.toHaveBeenCalled()
    expect(mocks.recordAppointmentSmsResponse).not.toHaveBeenCalled()
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(mocks.sendPushToAgents).not.toHaveBeenCalled()
    expect(inserts.filter(({ table }) => table === 'leads')).toHaveLength(0)
    const count = inserts.length
    expect((await POST(makeSmsRequest(body))).status).toBe(200)
    expect(inserts).toHaveLength(count)
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it.each(['+442079460123', '54321', 'SenderName'])('retains unsupported sender %s as unmatched review without automatic actions or retry storms', async (from) => {
    mocks.rpc.mockResolvedValue({ data: [{ resolution: 'unsupported', candidate_count: 0,
      lead_id: null, matched_outbound_activity_id: null }], error: null })
    mocks.isGoogleAdsPhoneNumber.mockReturnValue(true)
    expect((await POST(makeSmsRequest('CONFIRM', from))).status).toBe(200)
    expect(existingSmsRow).toMatchObject({ lead_id: null, metadata: {
      from, inbound_lead_resolution: 'unsupported', inbound_identity_review_reason: 'unsupported_phone_identity',
      needs_identity_review: true, inbound_processing_state: 'completed',
    } })
    expect(mocks.lookupProspectByPhone).not.toHaveBeenCalled()
    expect(mocks.resolveGoogleAdsLeadContext).not.toHaveBeenCalled()
    expect(mocks.recordAppointmentSmsResponse).not.toHaveBeenCalled()
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(inserts.filter(({ table }) => table === 'leads')).toHaveLength(0)
    expect((await POST(makeSmsRequest('CONFIRM', from))).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(inserts).toHaveLength(1)
  })

  it('keeps an unsupported identity retryable only when receipt persistence fails', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ resolution: 'unsupported', candidate_count: 0,
      lead_id: null, matched_outbound_activity_id: null }], error: null })
    smsInsertError = { message: 'DB unavailable' }
    expect((await POST(makeSmsRequest('Hello', '+442079460123'))).status).toBe(503)
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(existingSmsRow).toBeNull()
  })

  it.each([
    { code: 'PGRST202', message: 'Could not find resolve_inbound_sms_lead_v1' },
    { code: '08006', message: 'database unavailable' },
  ])('fails retryably without raw phone fallback when identity resolution fails: $code', async (error) => {
    mocks.rpc.mockResolvedValue({ data: null, error })
    const response = await POST(makeSmsRequest('Reply'))
    expect(response.status).toBe(503)
    expect(mocks.from).not.toHaveBeenCalledWith('leads')
    expect(inserts).toEqual([])
    expect(mocks.lookupProspectByPhone).not.toHaveBeenCalled()
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
  })

  it('preserves the already linked identity while resuming a pending SID', async () => {
    existingSmsRow = { id: 'activity-pending', lead_id: lead.id, metadata: {
      direction: 'received', message_sid: 'SM-Please call me', inbound_processing_state: 'pending',
    } }
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'must not reroute a linked receipt' } })
    expect((await POST(makeSmsRequest('Please call me'))).status).toBe(200)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(existingSmsRow?.lead_id).toBe(lead.id)
  })

  it('resolves an interrupted unlinked receipt at its original timestamp, rather than retry time', async () => {
    existingSmsRow = { id: 'activity-pending', lead_id: null, created_at: '2026-06-03T14:57:00.000Z', metadata: {
      direction: 'received', message_sid: 'SM-Please call me', inbound_processing_state: 'pending',
    } }
    expect((await POST(makeSmsRequest('Please call me'))).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_inbound_sms_lead_v1', expect.objectContaining({
      p_received_at: '2026-06-03T14:57:00.000Z',
    }))
    expect(existingSmsRow?.lead_id).toBe(lead.id)
  })

  it('keeps a pending ambiguous receipt in human review even if later outbound activity could resolve it', async () => {
    existingSmsRow = { id: 'activity-pending', lead_id: null, metadata: {
      direction: 'received', message_sid: 'SM-CONFIRM', inbound_processing_state: 'pending',
      inbound_lead_resolution: 'ambiguous', inbound_lead_candidate_count: 2, needs_identity_review: true,
    } }
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'must not reinterpret an ambiguous receipt' } })
    expect((await POST(makeSmsRequest('CONFIRM'))).status).toBe(200)
    expect(existingSmsRow).toMatchObject({ lead_id: null, metadata: {
      needs_identity_review: true, inbound_processing_state: 'completed',
    } })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.recordAppointmentSmsResponse).not.toHaveBeenCalled()
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })

  it.each(['ambiguous', 'unsupported'] as const)('pins a first %s resolution on an unmarked pending receipt across interruption and expired-lease retry', async (resolution) => {
    const from = resolution === 'unsupported' ? '+442079460123' : PROSPECT_PHONE
    const receivedAt = '2026-06-03T14:57:00.000Z'
    existingSmsRow = { id: 'activity-pending', lead_id: null, created_at: receivedAt, metadata: {
      direction: 'received', message_sid: 'SM-CONFIRM', from, to: '+18166088588', source: 'original-receipt-source',
      inbound_processing_state: 'pending', original_receipt_marker: 'preserve',
    } }
    mocks.rpc.mockResolvedValue({ data: [{ resolution, candidate_count: resolution === 'ambiguous' ? 2 : 0,
      lead_id: null, matched_outbound_activity_id: null }], error: null })
    completionFailure = true
    expect((await POST(makeSmsRequest('CONFIRM', from, '+18166088588'))).status).toBe(503)
    expect(existingSmsRow).toMatchObject({ lead_id: null, metadata: {
      direction: 'received', message_sid: 'SM-CONFIRM', from, to: '+18166088588', source: 'original-receipt-source',
      original_receipt_marker: 'preserve', inbound_received_at: receivedAt,
      inbound_lead_resolution: resolution, inbound_lead_candidate_count: resolution === 'ambiguous' ? 2 : 0,
      needs_identity_review: true, inbound_processing_state: 'processing',
      ...(resolution === 'unsupported' ? { inbound_identity_review_reason: 'unsupported_phone_identity' } : {}),
    } })
    const interruptedClaim = existingSmsRow?.metadata?.inbound_processing_claim_id
    expect(interruptedClaim).toEqual(expect.any(String))
    completionFailure = false
    vi.advanceTimersByTime(61_000)
    // New outbound evidence must not reinterpret an already-reviewed receipt.
    mocks.rpc.mockResolvedValue({ data: [{ resolution: 'normalized_phone', candidate_count: 1,
      lead_id: lead.id, full_name: lead.full_name, phone: from, matched_outbound_activity_id: null }], error: null })
    expect((await POST(makeSmsRequest('CONFIRM', from, '+18166088588'))).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(existingSmsRow).toMatchObject({ lead_id: null, metadata: {
      source: 'original-receipt-source', original_receipt_marker: 'preserve', inbound_received_at: receivedAt,
      inbound_lead_resolution: resolution, needs_identity_review: true, inbound_processing_state: 'completed',
    } })
    expect(existingSmsRow?.metadata?.inbound_processing_claim_id).not.toBe(interruptedClaim)
    expect(mocks.lookupProspectByPhone).not.toHaveBeenCalled()
    expect(mocks.resolveGoogleAdsLeadContext).not.toHaveBeenCalled()
    expect(mocks.recordAppointmentSmsResponse).not.toHaveBeenCalled()
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })

})
