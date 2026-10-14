import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  validateTwilioWebhook: vi.fn(),
  sendTeamLeadAlert: vi.fn(),
  safeSendSMS: vi.fn(),
  automatedSmsBlockReason: vi.fn(),
  getMissedCallResponse: vi.fn(),
  lookupProspectByPhone: vi.fn(),
  createEnrichedLeadFromProspect: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

vi.mock('@/lib/twilio-validate', () => ({
  validateTwilioWebhook: mocks.validateTwilioWebhook,
}))

vi.mock('@/lib/lead-team-alerts', () => ({
  sendTeamLeadAlert: mocks.sendTeamLeadAlert,
}))

vi.mock('@/lib/safe-communications', () => ({
  safeSendSMS: mocks.safeSendSMS,
}))

vi.mock('@/lib/sms-send-gate', () => ({
  automatedSmsBlockReason: mocks.automatedSmsBlockReason,
}))

vi.mock('@/middleware/rate-limit', () => ({
  rateLimit: () => ({ allowed: true, remaining: 10 }),
  rateLimitConfigs: { webhook: { maxRequests: 60, windowMs: 60_000 } },
  getClientIp: () => '127.0.0.1',
  phoneRateLimit: () => ({ allowed: true, remaining: 2 }),
}))

vi.mock('@/lib/missed-call-messaging', () => ({
  getMissedCallResponse: mocks.getMissedCallResponse,
}))

vi.mock('@/lib/prospect-lookup', () => ({
  lookupProspectByPhone: mocks.lookupProspectByPhone,
}))

vi.mock('@/lib/prospect-to-lead', () => ({
  createEnrichedLeadFromProspect: mocks.createEnrichedLeadFromProspect,
}))

import { POST } from './route'

const CALLER = '+19135550123'
const MAIN_LINE = '+18163077835'
const AUTO_TEXT = 'Sorry we missed you'

type Write = { table: string; action: 'insert' | 'update'; payload: unknown }
type QueryResult = { data: unknown; error: null }

function query(table: string, writes: Write[]) {
  const state: { action: 'select' | 'insert' | 'update' } = { action: 'select' }
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: (payload: unknown) => {
      state.action = 'insert'
      writes.push({ table, action: 'insert', payload })
      return builder
    },
    update: (payload: unknown) => {
      state.action = 'update'
      writes.push({ table, action: 'update', payload })
      return builder
    },
    single: async (): Promise<QueryResult> => {
      if (table === 'leads' && state.action === 'insert') {
        return { data: { id: 'lead-created' }, error: null }
      }
      return { data: null, error: null }
    },
    maybeSingle: async (): Promise<QueryResult> => ({ data: null, error: null }),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) => {
      const data = table === 'leads' && state.action === 'select' ? [] : null
      return Promise.resolve({ data, error: null }).then(resolve, reject)
    },
  }
  return builder
}

function missedCallRequest(overrides: Record<string, string> = {}) {
  return new Request('https://crm.savingkc.com/api/twilio-missed-call', {
    method: 'POST',
    body: new URLSearchParams({
      From: CALLER,
      To: MAIN_LINE,
      CallStatus: 'no-answer',
      CallSid: 'CA11111111111111111111111111111111',
      CallDuration: '0',
      ...overrides,
    }),
  })
}

function payloadOf(write: Write): Record<string, unknown> {
  return write.payload as Record<string, unknown>
}

describe('twilio missed-call parent callback', () => {
  let writes: Write[]

  beforeEach(() => {
    writes = []
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.from.mockImplementation((table: string) => query(table, writes))
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.automatedSmsBlockReason.mockResolvedValue(null)
    mocks.safeSendSMS.mockResolvedValue({ sid: 'SM1' })
    mocks.sendTeamLeadAlert.mockResolvedValue({ recipients: [], smsResults: [], callback: null })
    mocks.lookupProspectByPhone.mockResolvedValue([])
    mocks.getMissedCallResponse.mockResolvedValue({
      shouldSend: true,
      message: AUTO_TEXT,
      agentName: 'Ernest',
      agentPhone: '+18162262552',
      variant: 0,
      delaySeconds: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function post(overrides: Record<string, string> = {}) {
    const response = await POST(missedCallRequest(overrides))
    await vi.runAllTimersAsync()
    return response
  }

  function callLogs() {
    return writes.filter((write) => (
      write.table === 'lead_activities'
      && write.action === 'insert'
      && payloadOf(write).activity_type === 'call'
    ))
  }

  function leadInserts() {
    return writes.filter((write) => write.table === 'leads' && write.action === 'insert')
  }

  it.each(['no-answer', 'busy'])('logs a 0s %s on a non-direct line as abandoned and keeps the lead and auto-text', async (callStatus) => {
    const response = await post({ CallStatus: callStatus })

    expect(response.status).toBe(200)
    expect(mocks.sendTeamLeadAlert).not.toHaveBeenCalled()
    expect(callLogs()).toHaveLength(1)
    expect(payloadOf(callLogs()[0])).toMatchObject({
      activity_type: 'call',
      description: expect.stringContaining('abandoned_before_answer'),
      metadata: {
        callStatus: 'abandoned_before_answer',
        outcome: 'abandoned_before_answer',
        duration: 0,
        to: MAIN_LINE,
      },
    })
    expect(leadInserts()).toHaveLength(1)
    expect(payloadOf(leadInserts()[0])).toMatchObject({
      phone: CALLER,
      source: 'inbound_call',
      priority: 'hot',
    })
    expect(mocks.lookupProspectByPhone).toHaveBeenCalledWith(CALLER)
    expect(mocks.safeSendSMS).toHaveBeenCalledWith(expect.objectContaining({
      body: AUTO_TEXT,
      to: CALLER,
      from: MAIN_LINE,
      senderUse: 'reply',
    }))
  })

  it.each([
    ['Ernest company', '+18166088588'],
    ['Casey company', '+18167277667'],
  ])('leaves a %s direct-ring line on the existing parent-callback skip', async (_label, calledNumber) => {
    const response = await post({ To: calledNumber, CallStatus: 'no-answer', CallDuration: '0' })

    expect(response.status).toBe(200)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.sendTeamLeadAlert).not.toHaveBeenCalled()
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(mocks.getMissedCallResponse).not.toHaveBeenCalled()
    expect(mocks.lookupProspectByPhone).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('keeps missed-call alerts for a 0s no-answer on the dispositions direct ring', async () => {
    const response = await post({ To: '+18166088858', CallStatus: 'no-answer', CallDuration: '0' })

    expect(response.status).toBe(200)
    expect(mocks.sendTeamLeadAlert).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'unknown_missed_call_alert',
      smsBody: expect.stringContaining('Missed call'),
      push: expect.objectContaining({
        title: 'Missed Call - Unknown',
        tag: 'missed-call-unknown',
      }),
    }))
    expect(callLogs()).toHaveLength(1)
    expect(payloadOf(callLogs()[0])).toMatchObject({
      metadata: { callStatus: 'no-answer', to: '+18166088858' },
    })
    expect(JSON.stringify(payloadOf(callLogs()[0]))).not.toContain('abandoned_before_answer')
    expect(leadInserts()).toHaveLength(1)
    expect(mocks.safeSendSMS).toHaveBeenCalledWith(expect.objectContaining({
      body: AUTO_TEXT,
      to: CALLER,
      from: '+18166088858',
    }))
  })
})
