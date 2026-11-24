import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateTwilioWebhook: vi.fn(),
  handleOptOut: vi.fn(),
  handleOptIn: vi.fn(),
  processInboundSmsConsent: vi.fn(),
  from: vi.fn(),
  sendTeamLeadAlert: vi.fn(),
  queueInboundLeadAttribution: vi.fn(),
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

vi.mock('@/lib/lead-team-alerts', () => ({
  sendTeamLeadAlert: mocks.sendTeamLeadAlert,
}))

vi.mock('@/lib/server/inbound-lead-attribution', () => ({
  queueInboundLeadAttribution: mocks.queueInboundLeadAttribution,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { POST } from './route'

const SELL_AUTO_TEXT = "Thanks for calling Saving KC Homebuyers. Were you looking to sell a property? Reply YES and we'll call you right back."

function chain(outbound: string | null) {
  const api: Record<string, unknown> = {}
  const filters: Array<[string, unknown]> = []
  const self = () => api
  api.select = self
  api.eq = (column: string, value: unknown) => {
    filters.push([column, value])
    return api
  }
  api.limit = self
  api.order = self
  api.insert = () => api
  api.single = async () => ({ data: { id: 'lead-fallback' }, error: null })
  api.maybeSingle = async () => {
    const direction = filters.find(([column]) => column === 'metadata->>direction')?.[1]
    if (direction === 'outbound') {
      return { data: outbound ? { description: outbound } : null, error: null }
    }
    return { data: null, error: null }
  }
  return api
}

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
    mocks.sendTeamLeadAlert.mockResolvedValue({ recipients: [], smsResults: [], channelResults: [], callback: null })
    mocks.from.mockImplementation(() => chain(null))
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
    expect(mocks.sendTeamLeadAlert).not.toHaveBeenCalled()
  })

  it('does not page a recovered text that has no selling intent', async () => {
    const response = await POST(request('Please text me.'))

    expect(response.status).toBe(200)
    expect(mocks.sendTeamLeadAlert).not.toHaveBeenCalled()
  })

  it('pages a recovered text that states selling intent', async () => {
    const response = await POST(request('I am interested in selling'))

    expect(response.status).toBe(200)
    expect(mocks.sendTeamLeadAlert).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'carrier_sms_fallback',
      smsBody: expect.stringContaining('I am interested in selling'),
      metadata: expect.objectContaining({ intent_quote: 'I am interested in selling' }),
    }))
  })

  it('does not treat a bare YES as selling intent unless it answers the sell auto-text', async () => {
    expect((await POST(request('YES'))).status).toBe(200)
    expect(mocks.sendTeamLeadAlert).not.toHaveBeenCalled()

    mocks.from.mockImplementation(() => chain(SELL_AUTO_TEXT))
    expect((await POST(request('YES'))).status).toBe(200)
    expect(mocks.sendTeamLeadAlert).toHaveBeenCalledTimes(1)
  })
})
