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

function request(body: Record<string, unknown>): Request {
  return new Request('https://crm.savingkc.com/api/conversations/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
      return { insert: mocks.insert }
    })
    mocks.insert.mockResolvedValue({ error: null })
    mocks.checkAutoAdvance.mockResolvedValue(undefined)
    mocks.sendLeadSms.mockResolvedValue({
      status: 'sent',
      sid: 'SM123',
      from: '+18166088559',
      persisted: true,
      deliveryState: 'delivered_and_persisted',
    })
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
