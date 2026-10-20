import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateTwilioWebhook: vi.fn(),
  from: vi.fn(),
  safeSendSMS: vi.fn(),
}))

vi.mock('@/lib/twilio-validate', () => ({ validateTwilioWebhook: mocks.validateTwilioWebhook }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))
vi.mock('@/lib/safe-communications', () => ({ safeSendSMS: mocks.safeSendSMS }))
vi.mock('@/lib/format', () => ({ formatPhone: (value: string) => value }))

import { POST } from './route'

function query(result: { data?: unknown; error?: unknown }) {
  const resolved = { data: result.data ?? null, error: result.error ?? null }
  const api = {
    select: () => api,
    insert: () => api,
    update: () => api,
    eq: () => api,
    limit: () => api,
    single: () => Promise.resolve(resolved),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => (
      Promise.resolve(resolved).then(resolve, reject)
    ),
  }
  return api
}

describe('cold-no-input voice path', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.safeSendSMS.mockResolvedValue({ success: true, sid: 'SM-auto' })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return query({ data: { id: 'lead-1', full_name: 'Seller', priority: 'normal' } })
      }
      return query({})
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function post(from = '%2B18164334092') {
    return POST(new Request(
      `https://crm.savingkc.com/api/ivr/cold-no-input?from=${from}&calledNumber=%2B18163100845`,
      { method: 'POST' },
    ))
  }

  it('hangs up without sending an SMS, including after the old auto-text delay', async () => {
    const response = await post()
    const twiml = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/xml')
    expect(twiml).toContain('<Hangup />')
    expect(twiml).toContain('No problem. Have a great day.')
    expect(twiml).not.toContain("We'll send you a quick text")
    expect(twiml).not.toContain('cash offer')

    await vi.runAllTimersAsync()
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
  })

  it('still hangs up anonymous callers without texting them', async () => {
    const response = await post('anonymous')
    expect(await response.text()).toContain('<Hangup />')
    await vi.runAllTimersAsync()
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects an invalid Twilio signature before any CRM or SMS work', async () => {
    mocks.validateTwilioWebhook.mockResolvedValue(false)
    const response = await post()
    expect(response.status).toBe(403)
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
