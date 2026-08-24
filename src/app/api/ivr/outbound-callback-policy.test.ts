import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateTwilioWebhook: vi.fn(),
  evaluateOutboundDialerCall: vi.fn(),
  recordBlockedDialerCall: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/twilio-validate', () => ({
  validateTwilioWebhook: mocks.validateTwilioWebhook,
}))

vi.mock('@/lib/server/dialer-call-eligibility', () => ({
  evaluateOutboundDialerCall: mocks.evaluateOutboundDialerCall,
  recordBlockedDialerCall: mocks.recordBlockedDialerCall,
}))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))

import { POST as formCallback } from './form-lead-agent-callback/route'

function request(path: string) {
  const form = new FormData()
  form.set('CallSid', 'CA_agent_leg')
  return new Request(`https://crm.savingkc.com${path}`, { method: 'POST', body: form })
}

const blocked = {
  allowed: false,
  normalizedPhone: '+19135550123',
  reason: 'do_not_call',
  message: 'This number is on the do-not-call list.',
  policyVersion: 'dialer_safety_v1',
  checkedAt: '2026-08-19T17:00:00.000Z',
  leadId: 'lead-1',
  prospectPhoneId: null,
}

const allowed = {
  allowed: true,
  normalizedPhone: '+19135550123',
  policyVersion: 'dialer_safety_v1',
  checkedAt: '2026-08-19T17:00:00.000Z',
  leadId: 'lead-1',
  prospectPhoneId: null,
}

describe('server-created outbound callback policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.evaluateOutboundDialerCall.mockResolvedValue(blocked)
    mocks.recordBlockedDialerCall.mockResolvedValue(undefined)
  })

  it('blocks a suppressed seller leg before emitting a dialable verb', async () => {
    const response = await formCallback(request('/api/ivr/form-lead-agent-callback?leadId=lead-1&leadPhone=%2B19135550123&callerId=%2B18163077835&agentName=Casey'))
    const twiml = await response.text()

    expect(response.status).toBe(200)
    expect(twiml).toContain('Call blocked by contact policy')
    expect(twiml).not.toMatch(/<Dial\b|<Number\b|<Redirect\b/i)
    expect(mocks.recordBlockedDialerCall).toHaveBeenCalledOnce()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('contains a provider-validator failure before body, policy, or database work', async () => {
    mocks.validateTwilioWebhook.mockRejectedValue(new Error('validator unavailable'))
    const callbackRequest = request('/api/ivr/form-lead-agent-callback?leadId=lead-1&leadPhone=%2B19135550123&callerId=%2B18163077835&batchId=batch-1')
    const formData = vi.spyOn(callbackRequest, 'formData')

    const response = await formCallback(callbackRequest)
    const twiml = await response.text()

    expect(response.status).toBe(403)
    expect(twiml).toContain('<Hangup/>')
    expect(twiml).not.toMatch(/<Dial\b|<Number\b|<Redirect\b/i)
    expect(formData).not.toHaveBeenCalled()
    expect(mocks.evaluateOutboundDialerCall).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects an invalid provider signature before body, policy, or database work', async () => {
    mocks.validateTwilioWebhook.mockResolvedValue(false)
    const callbackRequest = request('/api/ivr/form-lead-agent-callback?leadId=lead-1&leadPhone=%2B19135550123&callerId=%2B18163077835&batchId=batch-1')
    const formData = vi.spyOn(callbackRequest, 'formData')

    const response = await formCallback(callbackRequest)
    const twiml = await response.text()

    expect(response.status).toBe(403)
    expect(twiml).toContain('<Hangup/>')
    expect(twiml).not.toMatch(/<Dial\b|<Number\b|<Redirect\b/i)
    expect(formData).not.toHaveBeenCalled()
    expect(mocks.evaluateOutboundDialerCall).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each(['insert', 'lookup'] as const)('fails the form callback closed when claim %s fails', async (failure) => {
    mocks.evaluateOutboundDialerCall.mockResolvedValue(allowed)
    const insertChain: Record<string, unknown> = {}
    insertChain.insert = vi.fn(() => insertChain)
    insertChain.select = vi.fn(() => insertChain)
    insertChain.single = vi.fn(async () => failure === 'insert'
      ? { data: null, error: { message: 'claim insert failed' } }
      : { data: { id: 'claim-1', created_at: '2026-08-19T17:00:00Z' }, error: null })
    const lookupChain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'gte', 'contains', 'order']) lookupChain[method] = vi.fn(() => lookupChain)
    lookupChain.limit = vi.fn(async () => ({ data: null, error: { message: 'claim lookup failed' } }))
    mocks.from.mockReturnValueOnce(insertChain)
    if (failure === 'lookup') mocks.from.mockReturnValueOnce(lookupChain)

    const response = await formCallback(request('/api/ivr/form-lead-agent-callback?leadId=lead-1&leadPhone=%2B19135550123&callerId=%2B18163077835&agentName=Casey&batchId=batch-1'))
    const twiml = await response.text()

    expect(response.status).toBe(200)
    expect(twiml).toContain('could not be safely claimed')
    expect(twiml).toContain('<Hangup/>')
    expect(twiml).not.toMatch(/<Dial\b|<Number\b|<Redirect\b/i)
    expect(mocks.evaluateOutboundDialerCall).toHaveBeenCalledTimes(1)
    expect(mocks.recordBlockedDialerCall).not.toHaveBeenCalled()
  })

  it('rechecks live policy after claiming and blocks a newly suppressed seller leg', async () => {
    mocks.evaluateOutboundDialerCall
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce(blocked)
    const insertChain: Record<string, unknown> = {}
    insertChain.insert = vi.fn(() => insertChain)
    insertChain.select = vi.fn(() => insertChain)
    insertChain.single = vi.fn(async () => ({ data: { id: 'claim-1', created_at: '2026-08-19T17:00:00Z' }, error: null }))
    const lookupChain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'gte', 'contains', 'order']) lookupChain[method] = vi.fn(() => lookupChain)
    lookupChain.limit = vi.fn(async () => ({
      data: [{ id: 'claim-1', metadata: { agentName: 'Casey' }, created_at: '2026-08-19T17:00:00Z' }],
      error: null,
    }))
    mocks.from.mockReturnValueOnce(insertChain).mockReturnValueOnce(lookupChain)

    const response = await formCallback(request('/api/ivr/form-lead-agent-callback?leadId=lead-1&leadPhone=%2B19135550123&callerId=%2B18163077835&agentName=Casey&batchId=batch-1'))
    const twiml = await response.text()

    expect(response.status).toBe(200)
    expect(twiml).toContain('Call blocked by contact policy')
    expect(twiml).not.toMatch(/<Dial\b|<Number\b|<Redirect\b/i)
    expect(mocks.evaluateOutboundDialerCall).toHaveBeenCalledTimes(2)
    expect(mocks.from).toHaveBeenCalledTimes(2)
    expect(mocks.recordBlockedDialerCall).toHaveBeenCalledOnce()
  })

  it('preserves the claimed form-lead seller leg when the live policy allows it', async () => {
    mocks.evaluateOutboundDialerCall.mockResolvedValue(allowed)
    const insertChain: Record<string, unknown> = {}
    insertChain.insert = vi.fn(() => insertChain)
    insertChain.select = vi.fn(() => insertChain)
    insertChain.single = vi.fn(async () => ({ data: { id: 'claim-1', created_at: '2026-08-19T17:00:00Z' }, error: null }))
    const lookupChain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'gte', 'contains', 'order']) lookupChain[method] = vi.fn(() => lookupChain)
    lookupChain.limit = vi.fn(async () => ({
      data: [{ id: 'claim-1', metadata: { agentName: 'Casey' }, created_at: '2026-08-19T17:00:00Z' }],
      error: null,
    }))
    mocks.from.mockReturnValueOnce(insertChain).mockReturnValueOnce(lookupChain)

    const response = await formCallback(request('/api/ivr/form-lead-agent-callback?leadId=lead-1&leadPhone=(913)%20555-0123&callerId=%2B18163077835&agentName=Casey&batchId=batch-1'))
    const twiml = await response.text()

    expect(response.status).toBe(200)
    expect(twiml.match(/<Dial\b/g)).toHaveLength(1)
    expect(twiml).toContain('<Number>+19135550123</Number>')
    expect(mocks.evaluateOutboundDialerCall).toHaveBeenCalledTimes(2)
  })
})
