import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lookupInboundCallerName: vi.fn(async () => ''),
  validateTwilioWebhook: vi.fn(),
}))

vi.mock('@/lib/twilio-validate', () => ({
  validateTwilioWebhook: mocks.validateTwilioWebhook,
}))

vi.mock('@/lib/telephony/inbound-caller-name', () => ({
  lookupInboundCallerName: mocks.lookupInboundCallerName,
}))

import { POST } from './route'

function request(to: string) {
  return new Request('https://crm.savingkc.com/api/twilio/fallback/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      From: '+18165550199',
      To: to,
      CallSid: 'CA_fallback',
    }),
  })
}

describe('carrier voice fallback', () => {
  beforeEach(() => {
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.lookupInboundCallerName.mockReset()
    mocks.lookupInboundCallerName.mockResolvedValue('')
  })

  it('dials the Voice client with the PSTN From and still rings the cell', async () => {
    mocks.lookupInboundCallerName.mockResolvedValue('Jane Seller')
    const response = await POST(request('+18166088588'))
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain('callerId="+18165550199"')
    expect(text).toContain('<Identity>ernest</Identity>')
    expect(text).toContain('<Parameter name="callerNumber" value="+18165550199" />')
    expect(text).toContain('<Parameter name="callerName" value="Jane Seller" />')
    expect(text).toContain('<Parameter name="calledNumber" value="+18166088588" />')
    expect(text).toContain('<Number>+18162262552</Number>')
    expect(text).toContain('timeout="15"')
    expect(mocks.lookupInboundCallerName).toHaveBeenCalledWith('+18165550199')
  })

  it('still rings the cell and the client when the contact lookup fails', async () => {
    mocks.lookupInboundCallerName.mockRejectedValue(new Error('database unavailable'))
    const response = await POST(request('+18166088588'))
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain('callerId="+18165550199"')
    expect(text).toContain('<Parameter name="callerName" value="" />')
    expect(text).toContain('<Number>+18162262552</Number>')
  })

  it('keeps a cell-only company line on the company DID', async () => {
    const response = await POST(request('+18167277667'))
    const text = await response.text()

    expect(text).toContain('callerId="+18167277667"')
    expect(text).not.toContain('<Client')
    expect(text).toContain('<Number>')
    expect(mocks.lookupInboundCallerName).not.toHaveBeenCalled()
  })
})
