import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  validateTwilioWebhook: vi.fn(),
  sendTeamLeadAlert: vi.fn(),
  safeSendSMS: vi.fn(),
  isDuplicateSms: vi.fn(),
  logSmsSend: vi.fn(),
  automatedSmsBlockReason: vi.fn(),
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

vi.mock('@/lib/sms-dedup', () => ({
  isDuplicateSms: mocks.isDuplicateSms,
  logSmsSend: mocks.logSmsSend,
}))

vi.mock('@/lib/sms-send-gate', () => ({
  automatedSmsBlockReason: mocks.automatedSmsBlockReason,
}))

vi.mock('@/middleware/rate-limit', () => ({
  phoneRateLimit: () => ({ allowed: true, remaining: 1 }),
}))

vi.mock('@/lib/prospect-lookup', () => ({
  lookupProspectByPhone: vi.fn(async () => []),
}))

import { POST } from './route'

const CALLER = '+19135550123'
const MAIN_LINE = '+18163077835'
const DIRECT_LINE = '+18166088588'

type QueryResult = { data: unknown; error: null }

function query(table: string, sink?: unknown[], options?: { lead?: unknown; captureAll?: boolean }) {
  const lead = options && 'lead' in options ? options.lead : { id: 'lead-1', full_name: 'Jane Seller' }
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: (payload: unknown) => {
      if (options?.captureAll) sink?.push({ table, payload })
      else if (table === 'lead_activities') sink?.push(payload)
      return builder
    },
    update: () => builder,
    single: async (): Promise<QueryResult> => ({ data: { id: 'lead-created', full_name: 'New caller · (913) 555-0199' }, error: null }),
    maybeSingle: async (): Promise<QueryResult> => (
      table === 'leads'
        ? { data: lead, error: null }
        : { data: null, error: null }
    ),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) => (
      Promise.resolve({ data: null, error: null }).then(resolve, reject)
    ),
  }
  return builder
}

function dialResultRequest(input: {
  dialStatus: string
  type?: string
  calledNumber?: string
  duration?: string
}) {
  const url = new URL('https://crm.savingkc.com/api/ivr/dial-result')
  url.searchParams.set('from', CALLER)
  url.searchParams.set('leadId', 'lead-1')
  url.searchParams.set('calledNumber', input.calledNumber ?? MAIN_LINE)
  url.searchParams.set('type', input.type ?? 'seller')
  return new Request(url, {
    method: 'POST',
    body: new URLSearchParams({
      CallSid: 'CA11111111111111111111111111111111',
      DialCallSid: 'CA22222222222222222222222222222222',
      DialCallStatus: input.dialStatus,
      DialCallDuration: input.duration ?? '0',
    }),
  })
}

describe('ivr dial-result missed-call alerts', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    mocks.from.mockImplementation((table: string) => query(table))
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.sendTeamLeadAlert.mockResolvedValue({ recipients: [], smsResults: [], callback: null })
    mocks.isDuplicateSms.mockResolvedValue(true)
    mocks.automatedSmsBlockReason.mockResolvedValue(null)
    mocks.safeSendSMS.mockResolvedValue({ sid: 'SM1' })
  })

  it.each([
    ['no-answer', 'seller', MAIN_LINE, 'ivr_missed_call_alert', 'Missed Inbound Call', 'ivr-missed-call'],
    ['busy', 'seller', MAIN_LINE, 'ivr_missed_call_alert', 'Missed Inbound Call', 'ivr-missed-call'],
    ['no-answer', 'direct', DIRECT_LINE, 'direct_missed_call_alert', 'Missed Direct Call', 'direct-missed-call'],
    ['busy', 'direct', DIRECT_LINE, 'direct_missed_call_alert', 'Missed Direct Call', 'direct-missed-call'],
  ])('sends push and team SMS when DialCallStatus is %s for a %s call', async (dialStatus, type, calledNumber, trigger, title, tag) => {
    const response = await POST(dialResultRequest({ dialStatus, type, calledNumber }))
    const twiml = await response.text()

    expect(response.status).toBe(200)
    expect(twiml).toContain('/api/ivr/voicemail')
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(mocks.sendTeamLeadAlert).toHaveBeenCalledTimes(1)
    expect(mocks.sendTeamLeadAlert).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      trigger,
      smsBody: expect.stringContaining('MISSED:'),
      push: expect.objectContaining({ title, tag }),
    }))
  })

  it.each(['canceled', 'failed'])('does not alert when DialCallStatus is %s', async (dialStatus) => {
    const response = await POST(dialResultRequest({ dialStatus }))
    const twiml = await response.text()

    expect(response.status).toBe(200)
    expect(twiml).toContain('/api/ivr/voicemail')
    expect(mocks.sendTeamLeadAlert).not.toHaveBeenCalled()
  })

  it('records the real caller and Ernest client identity for the business line', async () => {
    vi.stubEnv('MOBILE_IN_APP_VOICE', 'true')
    vi.stubEnv('MOBILE_PERSONAL_FORWARD', 'false')
    const inserts: unknown[] = []
    mocks.from.mockImplementation((table: string) => query(table, inserts))

    const response = await POST(dialResultRequest({
      dialStatus: 'completed',
      type: 'direct',
      calledNumber: '+18164292900',
      duration: '12',
    }))

    expect(response.status).toBe(200)
    expect(inserts[0]).toMatchObject({
      activity_type: 'call',
      metadata: {
        direction: 'inbound',
        from: CALLER,
        calledNumber: '+18164292900',
        agent_identity: 'ernest',
      },
    })
    expect(JSON.stringify(inserts[0])).not.toContain('+18166088588')
  })

  it('still creates an inbound lead for a completed seller call', async () => {
    const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
    mocks.from.mockImplementation((table: string) => query(table, inserts, { lead: null, captureAll: true }))
    const url = new URL('https://crm.savingkc.com/api/ivr/dial-result')
    url.searchParams.set('from', '+19135550199')
    url.searchParams.set('calledNumber', '+18164292900')
    url.searchParams.set('type', 'direct')
    const response = await POST(new Request(url, {
      method: 'POST',
      body: new URLSearchParams({
        CallSid: 'CA33333333333333333333333333333333',
        DialCallSid: 'CA44444444444444444444444444444444',
        DialCallStatus: 'completed',
        DialCallDuration: '42',
      }),
    }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<Response></Response>')
    expect(inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'leads',
        payload: expect.objectContaining({
          full_name: 'New caller · (913) 555-0199',
          phone: '+19135550199',
          source: 'inbound_call',
          station: 'new',
          classification: null,
          assigned_agent: 'Ernest',
        }),
      }),
      expect.objectContaining({
        table: 'lead_activities',
        payload: expect.objectContaining({
          lead_id: 'lead-created',
          activity_type: 'call',
          metadata: expect.objectContaining({ direction: 'inbound', from: '+19135550199' }),
        }),
      }),
    ]))
  })

  it.each(['seller', 'direct'])('does not alert when DialCallStatus is completed for a %s call', async (type) => {
    const response = await POST(dialResultRequest({
      dialStatus: 'completed',
      type,
      calledNumber: type === 'direct' ? DIRECT_LINE : MAIN_LINE,
      duration: '42',
    }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<Response></Response>')
    expect(mocks.sendTeamLeadAlert).not.toHaveBeenCalled()
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
  })
})
