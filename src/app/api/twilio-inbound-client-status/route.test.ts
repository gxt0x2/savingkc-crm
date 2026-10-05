import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateTwilioWebhook: vi.fn(),
}))

vi.mock('@/lib/twilio-validate', () => ({
  validateTwilioWebhook: mocks.validateTwilioWebhook,
}))

import { POST } from './route'

const CALL_SID = `CA${'a'.repeat(32)}`
const PARENT_CALL_SID = `CA${'b'.repeat(32)}`

function callbackRequest(values: Record<string, string> = {}) {
  const body = new FormData()
  for (const [key, value] of Object.entries({
    CallSid: CALL_SID,
    ParentCallSid: PARENT_CALL_SID,
    CallStatus: 'ringing',
    ErrorCode: '13224',
    To: 'client:ernest',
    From: '+19135550199',
    ...values,
  })) body.set(key, value)
  return new Request('https://crm.savingkc.com/api/twilio-inbound-client-status', {
    method: 'POST',
    body,
  })
}

describe('inbound Voice client status callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateTwilioWebhook.mockResolvedValue(true)
  })

  it('is public to Twilio and still checks the provider signature in the route', () => {
    const proxy = readFileSync('src/proxy.ts', 'utf8')
    expect(proxy).toContain("'/api/twilio-inbound-client-status'")
  })

  it('records call SID, status, and error code without the caller number', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    const response = await POST(callbackRequest())

    expect(response.status).toBe(204)
    expect(info).toHaveBeenCalledWith('[inbound-client-leg]', {
      callSid: CALL_SID,
      parentCallSid: PARENT_CALL_SID,
      status: 'ringing',
      errorCode: '13224',
      client: 'ernest',
    })
    expect(JSON.stringify(info.mock.calls)).not.toContain('+19135550199')
    info.mockRestore()
  })

  it('records a ringing leg that has no error code', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const body = new FormData()
    body.set('CallSid', CALL_SID)
    body.set('CallStatus', 'initiated')
    body.set('To', 'client:ernest')

    const response = await POST(new Request('https://crm.savingkc.com/api/twilio-inbound-client-status', {
      method: 'POST',
      body,
    }))

    expect(response.status).toBe(204)
    expect(info).toHaveBeenCalledWith('[inbound-client-leg]', {
      callSid: CALL_SID,
      parentCallSid: null,
      status: 'initiated',
      errorCode: null,
      client: 'ernest',
    })
    info.mockRestore()
  })

  it('rejects an invalid signature before recording the callback', async () => {
    mocks.validateTwilioWebhook.mockResolvedValue(false)
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    const response = await POST(callbackRequest())

    expect(response.status).toBe(403)
    expect(info).not.toHaveBeenCalled()
    info.mockRestore()
  })
})
