import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  validateTwilioWebhook: vi.fn(),
}))

vi.mock('@/lib/twilio-validate', () => ({
  validateTwilioWebhook: mocks.validateTwilioWebhook,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { POST as formCallbackResult } from './form-lead-agent-callback-result/route'

const handlers = [{
  name: 'form-lead callback result',
  path: '/api/ivr/form-lead-agent-callback-result?leadId=lead-1&leadPhone=%2B19135550123&callerId=%2B18163077835&batchId=batch-1',
  post: formCallbackResult,
}] as const

function resultRequest(path: string) {
  const form = new FormData()
  form.set('DialCallStatus', 'completed')
  form.set('DialCallSid', 'CA_seller_leg')
  form.set('DialCallDuration', '42')
  return new Request(`https://crm.savingkc.com${path}`, { method: 'POST', body: form })
}

describe('outbound callback result signature containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateTwilioWebhook.mockResolvedValue(false)
    mocks.insert.mockResolvedValue({ error: null })
    mocks.from.mockReturnValue({ insert: mocks.insert })
  })

  it.each(handlers)('rejects an unsigned $name before body parsing or database work', async ({ path, post }) => {
    const request = resultRequest(path)
    const formData = vi.spyOn(request, 'formData')

    const response = await post(request)
    const twiml = await response.text()

    expect(response.status).toBe(403)
    expect(twiml).toContain('<Hangup/>')
    expect(twiml).not.toMatch(/<Dial\b|<Number\b|<Redirect\b/i)
    expect(mocks.validateTwilioWebhook).toHaveBeenCalledWith(request)
    expect(formData).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each(handlers)('contains a $name validator failure before body parsing or database work', async ({ path, post }) => {
    mocks.validateTwilioWebhook.mockRejectedValue(new Error('validator unavailable'))
    const request = resultRequest(path)
    const formData = vi.spyOn(request, 'formData')

    const response = await post(request)
    const twiml = await response.text()

    expect(response.status).toBe(403)
    expect(twiml).toContain('<Hangup/>')
    expect(twiml).not.toMatch(/<Dial\b|<Number\b|<Redirect\b/i)
    expect(formData).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each(handlers)('preserves signed $name persistence', async ({ path, post }) => {
    mocks.validateTwilioWebhook.mockResolvedValue(true)

    const response = await post(resultRequest(path))
    const twiml = await response.text()

    expect(response.status).toBe(200)
    expect(twiml).toContain('<Hangup/>')
    expect(twiml).not.toMatch(/<Dial\b|<Number\b|<Redirect\b/i)
    expect(mocks.from).toHaveBeenCalledWith('lead_activities')
    expect(mocks.insert).toHaveBeenCalledOnce()
  })
})
