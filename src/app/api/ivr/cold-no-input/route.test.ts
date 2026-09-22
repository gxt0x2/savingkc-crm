import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateTwilioWebhook: vi.fn(),
  from: vi.fn(),
  automatedSmsBlockReason: vi.fn(),
  isDuplicateSms: vi.fn(),
  logSmsSend: vi.fn(),
  phoneRateLimit: vi.fn(),
  safeSendSMS: vi.fn(),
}))

vi.mock('@/lib/twilio-validate', () => ({ validateTwilioWebhook: mocks.validateTwilioWebhook }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))
vi.mock('@/lib/sms-send-gate', () => ({ automatedSmsBlockReason: mocks.automatedSmsBlockReason }))
vi.mock('@/lib/sms-dedup', () => ({
  isDuplicateSms: mocks.isDuplicateSms,
  logSmsSend: mocks.logSmsSend,
}))
vi.mock('@/middleware/rate-limit', () => ({ phoneRateLimit: mocks.phoneRateLimit }))
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

describe('cold_callback_auto_text suppression', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.phoneRateLimit.mockReturnValue({ allowed: true })
    mocks.isDuplicateSms.mockResolvedValue(false)
    mocks.logSmsSend.mockResolvedValue(undefined)
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

  async function post() {
    return POST(new Request(
      'https://crm.savingkc.com/api/ivr/cold-no-input?from=%2B18164334092&calledNumber=%2B18163100845',
      { method: 'POST' },
    ))
  }

  it('sends the cash-offer auto-text when the gate allows it', async () => {
    mocks.automatedSmsBlockReason.mockResolvedValue(null)

    const response = await post()
    expect(await response.text()).toContain("We'll send you a quick text")
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()
    expect(mocks.automatedSmsBlockReason).toHaveBeenCalledWith({ phone: '+18164334092', leadId: 'lead-1' })
    expect(mocks.safeSendSMS).toHaveBeenCalledWith(expect.objectContaining({
      to: '+18164334092',
      body: expect.stringContaining('cash offer'),
    }))
  })

  it('does not send cold_callback_auto_text when the gate blocks the phone', async () => {
    mocks.automatedSmsBlockReason.mockResolvedValue('opted_out')

    const response = await post()
    const twiml = await response.text()
    expect(twiml).not.toContain("We'll send you a quick text")
    expect(twiml).toContain('Have a great day')

    await vi.runAllTimersAsync()
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(mocks.logSmsSend).not.toHaveBeenCalled()
  })

  it('does not send when suppression status cannot be verified', async () => {
    mocks.automatedSmsBlockReason.mockRejectedValue(new Error('SMS suppression status could not be verified'))

    const response = await post()
    expect(response.status).toBe(200)
    await vi.runAllTimersAsync()
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
  })
})
