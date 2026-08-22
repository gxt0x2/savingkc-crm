import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ validate: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/twilio-validate', () => ({ validateTwilioWebhook: mocks.validate }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { rpc: mocks.rpc } }))

import { POST } from './route'

const actionId = '11111111-1111-4111-8111-111111111111'
const messageSid = `SM${'a'.repeat(32)}`

function request(status = 'delivered', errorCode = '') {
  return new Request(`https://crm.savingkc.com/api/twilio-message-status?action_id=${actionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'signed' },
    body: new URLSearchParams({ MessageSid: messageSid, MessageStatus: status, ErrorCode: errorCode }),
  })
}

describe('Twilio prospecting message status callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validate.mockResolvedValue(true)
    mocks.rpc.mockResolvedValue({ data: { status: 'delivered', changed: true }, error: null })
  })

  it('rejects unsigned callbacks before parsing or touching campaign data', async () => {
    mocks.validate.mockResolvedValue(false)
    const input = request()
    const formData = vi.spyOn(input, 'formData')
    const response = await POST(input)
    expect(response.status).toBe(403)
    expect(formData).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('persists a signed carrier delivery receipt through the service-only RPC', async () => {
    const response = await POST(request('delivered'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.rpc).toHaveBeenCalledWith('apply_prospecting_sms_delivery_v1', {
      p_action_id: actionId,
      p_message_sid: messageSid,
      p_message_status: 'delivered',
      p_error_code: null,
    })
  })

  it('asks Twilio to retry a valid receipt that arrived before the send was committed', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'campaign_delivery_not_ready' } })
    const response = await POST(request('undelivered', '30005'))
    expect(response.status).toBe(503)
  })

  it('rejects malformed signed receipt fields before database work', async () => {
    const response = await POST(request('made-up-status'))
    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
