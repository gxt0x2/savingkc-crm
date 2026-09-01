import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendLeadSms: vi.fn(),
  externalSideEffectsDisabled: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
  resendSend: vi.fn(),
  checkAutoAdvance: vi.fn(),
  getClaims: vi.fn(),
  profileMaybeSingle: vi.fn(),
  recipientMaybeSingle: vi.fn(),
  assertDialerControl: vi.fn(),
}))

vi.mock('@/lib/api/dialer-mutation-control', () => ({
  assertDialerMutationControl: mocks.assertDialerControl,
  dialerMutationControlErrorResponse: (error: unknown) => {
    const typed = error as { code?: string; status?: number; message?: string }
    return typed.code
      ? Response.json({ error: typed.message, code: typed.code }, { status: typed.status || 409 })
      : null
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getClaims: mocks.getClaims } }),
}))

vi.mock('@/lib/send-lead-sms', () => ({
  sendLeadSms: mocks.sendLeadSms,
}))

vi.mock('@/lib/preview-safety', () => ({
  externalSideEffectsDisabled: mocks.externalSideEffectsDisabled,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

vi.mock('@/lib/pipeline-auto-advance', () => ({
  checkAutoAdvance: mocks.checkAutoAdvance,
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.resendSend }
  },
}))

import { POST } from './route'

function request(body: Record<string, unknown>, headers?: Record<string, string>): Request {
  return new Request('https://crm.savingkc.com/api/conversations/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('conversation sends', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.externalSideEffectsDisabled.mockReturnValue(false)
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: 'user-ernest', email: 'ernest@savingkc.com' } },
      error: null,
    })
    mocks.profileMaybeSingle.mockResolvedValue({ data: { full_name: 'Ernest Dodson' }, error: null })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'agent_profiles') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: mocks.profileMaybeSingle }),
          }),
        }
      }
      if (table === 'leads' || table === 'prospect_phones') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: mocks.recipientMaybeSingle }),
          }),
        }
      }
      return { insert: mocks.insert }
    })
    mocks.insert.mockResolvedValue({ error: null })
    mocks.recipientMaybeSingle.mockResolvedValue({ data: { phone: '+19135550123' }, error: null })
    mocks.checkAutoAdvance.mockResolvedValue(undefined)
    mocks.sendLeadSms.mockResolvedValue({
      status: 'sent',
      sid: 'SM123',
      from: '+18166088559',
      persisted: true,
      deliveryState: 'delivered_and_persisted',
    })
    mocks.assertDialerControl.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('discards a client sender override when the thread requests server resolution', async () => {
    const response = await POST(request({
      mode: 'sms',
      leadId: 'lead-1',
      phone: '+19135550123',
      body: 'Hello',
      fromPhone: '+18163077835',
      resolveSenderFromConversation: true,
      agent: 'Spoofed Agent',
    }))

    expect(response.status).toBe(200)
    expect(mocks.sendLeadSms).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      phone: '+19135550123',
      fromPhone: undefined,
      agent: 'Ernest Dodson',
    }))
  })

  it('blocks a stale heir-dialer send before any external delivery', async () => {
    mocks.assertDialerControl.mockRejectedValue(Object.assign(new Error('Dialing control moved'), {
      code: 'session_control_lost',
      status: 409,
    }))

    const response = await POST(request({
      mode: 'sms',
      leadId: 'lead-1',
      phone: '+19135550123',
      body: 'Hello',
      source: 'heir_dialer',
      dialerSessionId: '11111111-1111-4111-8111-111111111111',
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'session_control_lost' })
    expect(mocks.sendLeadSms).not.toHaveBeenCalled()
    expect(mocks.resendSend).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.assertDialerControl).toHaveBeenCalledWith(expect.objectContaining({
      required: true,
      subject: { leadId: 'lead-1' },
    }))
  })

  it('blocks a controlled SMS whose source phone belongs to another seller', async () => {
    mocks.assertDialerControl.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    mocks.recipientMaybeSingle.mockResolvedValue({
      data: { phone: '+19135550123', prospects: { lead_id: 'lead-2' } },
      error: null,
    })

    const response = await POST(request({
      mode: 'sms',
      leadId: 'lead-1',
      phone: '+19135550123',
      prospectPhoneId: 'phone-1',
      body: 'Hello',
      source: 'heir_dialer',
      dialerSessionId: '11111111-1111-4111-8111-111111111111',
    }, { 'X-Dialer-Operation': 'operation-1' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'recipient_context_mismatch' })
    expect(mocks.sendLeadSms).not.toHaveBeenCalled()
  })

  it('reports an SMS that was delivered but not persisted without inviting a resend', async () => {
    mocks.sendLeadSms.mockResolvedValue({
      status: 'sent',
      sid: 'SM123',
      from: '+18166088559',
      persisted: false,
      deliveryState: 'delivered_not_persisted',
      warning: 'SMS delivered, but CRM history could not be saved. Do not resend this message.',
    })

    const response = await POST(request({
      mode: 'sms',
      leadId: 'lead-1',
      phone: '+19135550123',
      body: 'Hello',
      resolveSenderFromConversation: true,
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      sent: true,
      persisted: false,
      deliveryState: 'delivered_not_persisted',
      warning: expect.stringContaining('Do not resend'),
    })
  })

  it('passes protected cancellation and post-provider revalidation into the SMS sender', async () => {
    mocks.assertDialerControl.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    mocks.sendLeadSms.mockImplementation(async (input: { beforePersistence?: () => Promise<void> }) => {
      await input.beforePersistence?.()
      return {
        status: 'sent',
        sid: 'SM123',
        from: '+18166088559',
        persisted: true,
        deliveryState: 'delivered_and_persisted',
      }
    })

    const response = await POST(request({
      mode: 'sms',
      leadId: 'lead-1',
      phone: '+19135550123',
      body: 'Hello',
      dialerSessionId: '11111111-1111-4111-8111-111111111111',
    }, { 'X-Dialer-Operation': 'operation-1' }))

    expect(response.status).toBe(200)
    expect(mocks.sendLeadSms).toHaveBeenCalledWith(expect.objectContaining({
      signal: expect.any(AbortSignal),
      beforePersistence: expect.any(Function),
    }))
    expect(mocks.assertDialerControl).toHaveBeenCalledTimes(2)
    expect(mocks.assertDialerControl).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: '11111111-1111-4111-8111-111111111111',
      required: true,
    }))
  })

  it('marks an uncertain protected SMS result so the client retains the operation hold', async () => {
    mocks.assertDialerControl.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    mocks.sendLeadSms.mockResolvedValue({
      status: 'failed',
      deliveryState: 'delivery_unknown',
      error: 'Twilio did not return a confirmed delivery result. Do not resend this message.',
    })

    const response = await POST(request({
      mode: 'sms',
      leadId: 'lead-1',
      phone: '+19135550123',
      body: 'Hello',
      dialerSessionId: '11111111-1111-4111-8111-111111111111',
    }, { 'X-Dialer-Operation': 'operation-1' }))

    expect(response.status).toBe(504)
    expect(response.headers.get('x-dialer-operation-uncertain')).toBe('true')
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      sent: null,
      code: 'delivery_unknown',
      deliveryState: 'delivery_unknown',
      error: expect.stringContaining('Do not resend'),
    })
  })

  it('requires a route-local authenticated user before sending', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: {} }, error: null })

    const response = await POST(request({
      mode: 'sms',
      leadId: 'lead-1',
      phone: '+19135550123',
      body: 'Hello',
    }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mocks.sendLeadSms).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('falls back to authenticated email when the actor profile has no name', async () => {
    mocks.profileMaybeSingle.mockResolvedValue({ data: { full_name: ' ' }, error: null })

    await POST(request({
      mode: 'sms',
      leadId: 'lead-1',
      phone: '+19135550123',
      body: 'Hello',
      agent: 'Spoofed Agent',
    }))

    expect(mocks.sendLeadSms).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'ernest@savingkc.com',
    }))
  })

  it('returns a non-success response when email delivery is disabled', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    mocks.externalSideEffectsDisabled.mockReturnValue(true)

    const response = await POST(request({ mode: 'email', leadId: 'lead-1', to: 'seller@example.com', body: 'Hello' }))
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload).toMatchObject({ success: false, sent: false })
    expect(mocks.resendSend).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('returns a non-success response when email delivery is not configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '')

    const response = await POST(request({ mode: 'email', leadId: 'lead-1', to: 'seller@example.com', body: 'Hello' }))
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload).toMatchObject({ success: false, sent: false, error: 'Email delivery is not configured' })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('does not report or log a provider-rejected email as sent', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    mocks.resendSend.mockResolvedValue({ data: null, error: { message: 'Recipient rejected' } })

    const response = await POST(request({ mode: 'email', leadId: 'lead-1', to: 'seller@example.com', body: 'Hello' }))
    const payload = await response.json()

    expect(response.status).toBe(502)
    expect(payload).toEqual({ success: false, sent: false, error: 'Recipient rejected' })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('logs and reports email success only after provider acceptance', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    mocks.resendSend.mockResolvedValue({ data: { id: 'email-1' }, error: null })

    const response = await POST(request({ mode: 'email', leadId: 'lead-1', to: 'seller@example.com', body: 'Hello' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      sent: true,
      persisted: true,
      deliveryState: 'delivered_and_persisted',
      id: 'email-1',
    })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      activity_type: 'email',
      agent: 'Ernest Dodson',
      metadata: expect.objectContaining({ sent: true }),
    }))
  })

  it('bounds a protected Resend call and reasserts before email CRM mutations', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    mocks.assertDialerControl.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    mocks.resendSend.mockResolvedValue({ data: { id: 'email-1' }, error: null })
    mocks.checkAutoAdvance.mockImplementation(async (
      _leadId: string,
      _trigger: string,
      options?: { beforeMutation?: () => Promise<void> },
    ) => {
      await options?.beforeMutation?.()
      return { advanced: false }
    })

    const response = await POST(request({
      mode: 'email',
      leadId: 'lead-1',
      to: 'seller@example.com',
      body: 'Hello',
      dialerSessionId: '11111111-1111-4111-8111-111111111111',
    }, { 'X-Dialer-Operation': 'operation-1' }))

    expect(response.status).toBe(200)
    expect(mocks.resendSend).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      signal: expect.any(AbortSignal),
      idempotencyKey: 'operation-1',
    }))
    expect(mocks.assertDialerControl).toHaveBeenCalledTimes(3)
    expect(mocks.assertDialerControl.mock.invocationCallOrder[1]).toBeLessThan(mocks.insert.mock.invocationCallOrder[0])
    expect(mocks.assertDialerControl.mock.invocationCallOrder[2]).toBeGreaterThan(mocks.checkAutoAdvance.mock.invocationCallOrder[0])
  })

  it('marks a protected Resend transport timeout as delivery-unknown', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    mocks.assertDialerControl.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    mocks.resendSend.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'))

    const response = await POST(request({
      mode: 'email',
      leadId: 'lead-1',
      to: 'seller@example.com',
      body: 'Hello',
      dialerSessionId: '11111111-1111-4111-8111-111111111111',
    }, { 'X-Dialer-Operation': 'operation-1' }))

    expect(response.status).toBe(504)
    expect(response.headers.get('x-dialer-operation-uncertain')).toBe('true')
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      sent: null,
      code: 'delivery_unknown',
      deliveryState: 'delivery_unknown',
      error: expect.stringContaining('Do not resend'),
    })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.checkAutoAdvance).not.toHaveBeenCalled()
  })

  it('recognizes the Resend SDK transport-error result as delivery-unknown', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    mocks.assertDialerControl.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    mocks.resendSend.mockResolvedValue({
      data: null,
      error: {
        name: 'application_error',
        statusCode: null,
        message: 'Unable to fetch data. The request could not be resolved.',
      },
    })

    const response = await POST(request({
      mode: 'email',
      leadId: 'lead-1',
      to: 'seller@example.com',
      body: 'Hello',
      dialerSessionId: '11111111-1111-4111-8111-111111111111',
    }, { 'X-Dialer-Operation': 'operation-1' }))

    expect(response.status).toBe(504)
    expect(response.headers.get('x-dialer-operation-uncertain')).toBe('true')
    await expect(response.json()).resolves.toMatchObject({
      code: 'delivery_unknown',
      deliveryState: 'delivery_unknown',
      error: expect.stringContaining('Do not resend'),
    })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.checkAutoAdvance).not.toHaveBeenCalled()
  })

  it('awaits protected email auto-advance work before returning', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    mocks.assertDialerControl.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    mocks.resendSend.mockResolvedValue({ data: { id: 'email-1' }, error: null })
    let releaseAutoAdvance!: () => void
    mocks.checkAutoAdvance.mockImplementation(() => new Promise((resolve) => {
      releaseAutoAdvance = () => resolve({ advanced: false })
    }))
    const settled = vi.fn()

    const posting = POST(request({
      mode: 'email',
      leadId: 'lead-1',
      to: 'seller@example.com',
      body: 'Hello',
      dialerSessionId: '11111111-1111-4111-8111-111111111111',
    }, { 'X-Dialer-Operation': 'operation-1' })).then(settled)

    await vi.waitFor(() => expect(mocks.checkAutoAdvance).toHaveBeenCalledOnce())
    expect(settled).not.toHaveBeenCalled()
    releaseAutoAdvance()
    await posting
    expect(settled).toHaveBeenCalledOnce()
  })

  it('reports delivered-but-not-persisted without turning delivery into a retryable failure', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    mocks.resendSend.mockResolvedValue({ data: { id: 'email-1' }, error: null })
    mocks.insert.mockResolvedValue({ error: { message: 'Database unavailable' } })

    const response = await POST(request({
      mode: 'email',
      leadId: 'lead-1',
      to: 'seller@example.com',
      body: 'Hello',
      agent: 'Spoofed Agent',
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      sent: true,
      persisted: false,
      deliveryState: 'delivered_not_persisted',
      warning: expect.stringContaining('Do not resend'),
      id: 'email-1',
    })
  })
})
