import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateTwilioWebhook: vi.fn(),
  handleOptOut: vi.fn(),
  handleOptIn: vi.fn(),
  processInboundSmsConsent: vi.fn(),
}))

vi.mock('@/lib/twilio-validate', () => ({
  validateTwilioWebhook: mocks.validateTwilioWebhook,
}))

vi.mock('@/lib/sms-opt-out', () => ({
  handleOptOut: mocks.handleOptOut,
  handleOptIn: mocks.handleOptIn,
  isStopKeyword: (value: string) => value.trim().toUpperCase() === 'STOP',
  isStartKeyword: (value: string) => value.trim().toUpperCase() === 'START',
}))

vi.mock('@/lib/sms-consent-audit', () => ({
  processInboundSmsConsent: mocks.processInboundSmsConsent,
}))

import { POST } from './route'

function request(message: string): Request {
  return new Request('https://crm.savingkc.com/api/twilio/fallback/sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      From: '+19135550123',
      To: '+18163077835',
      Body: message,
      MessageSid: 'SM-consent-event',
    }),
  })
}

describe('carrier SMS fallback consent persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.handleOptOut.mockResolvedValue(undefined)
    mocks.handleOptIn.mockResolvedValue(undefined)
    mocks.processInboundSmsConsent.mockImplementation(async (input: { keyword: string }) => (
      input.keyword.trim().toUpperCase() === 'STOP'
        ? '<Response><Message>You have been unsubscribed</Message></Response>'
        : null
    ))
  })

  it('acknowledges STOP only after the opt-out is persisted', async () => {
    const response = await POST(request('STOP'))

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('You have been unsubscribed')
    expect(mocks.processInboundSmsConsent).toHaveBeenCalledWith(expect.objectContaining({
      from: '+19135550123',
      messageSid: 'SM-consent-event',
      source: 'carrier_sms_fallback',
    }))
  })

  it('returns a retryable failure when STOP persistence fails', async () => {
    mocks.processInboundSmsConsent.mockRejectedValue(new Error('suppression database unavailable'))

    const response = await POST(request('STOP'))

    expect(response.status).toBe(503)
    await expect(response.text()).resolves.toContain('<Response></Response>')
    expect(mocks.processInboundSmsConsent).toHaveBeenCalledOnce()
  })
})
