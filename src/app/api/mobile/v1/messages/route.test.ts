import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireMobileActor: vi.fn(),
  admin: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  maybeSingle: vi.fn(),
  sendLeadSms: vi.fn(),
  emailSend: vi.fn(),
  autoAdvance: vi.fn(),
  reserve: vi.fn(),
  complete: vi.fn(),
}))

vi.mock('@/lib/mobile-api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileActor: mocks.requireMobileActor,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/send-lead-sms', () => ({ sendLeadSms: mocks.sendLeadSms }))
vi.mock('@/lib/pipeline-auto-advance', () => ({ checkAutoAdvance: mocks.autoAdvance }))
vi.mock('@/lib/preview-safety', () => ({ externalSideEffectsDisabled: () => false }))
vi.mock('@/lib/mobile-api/command-receipts', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/command-receipts')>(),
  reserveMobileCommand: mocks.reserve,
  completeMobileCommand: mocks.complete,
}))
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.emailSend } } }))

import { POST } from './route'

function request(body: Record<string, unknown>, idempotencyKey = '11111111-1111-4111-8111-111111111111') {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/messages', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test',
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('mobile messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RESEND_API_KEY = 'test-key'
    process.env.CRM_MOBILE_EMAIL_SENDERS = 'casey@savingkc.com=casey@savingkc.com'
    mocks.requireMobileActor.mockResolvedValue({
      user: { id: 'casey-id', email: 'casey@savingkc.com' },
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
    })
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'lead-1', phone: '+18165550100', email: 'seller@example.com' }, error: null })
    mocks.insert.mockResolvedValue({ error: null })
    mocks.from.mockImplementation((table: string) => table === 'leads'
      ? { select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }
      : { insert: mocks.insert })
    mocks.admin.mockReturnValue({ from: mocks.from })
    mocks.autoAdvance.mockResolvedValue(undefined)
    mocks.reserve.mockResolvedValue({ kind: 'reserved' })
    mocks.complete.mockResolvedValue(undefined)
  })

  afterEach(() => {
    delete process.env.RESEND_API_KEY
    delete process.env.CRM_MOBILE_EMAIL_SENDERS
  })

  it('requires a stable idempotency key before any provider call', async () => {
    const response = await POST(request({ leadId: 'lead-1', channel: 'email', body: 'Hello' }, ''))
    expect(response.status).toBe(400)
    expect(mocks.emailSend).not.toHaveBeenCalled()
    expect(mocks.reserve).not.toHaveBeenCalled()
  })

  it('does not claim an email was sent when the provider rejects it', async () => {
    mocks.emailSend.mockResolvedValue({ data: null, error: { message: 'domain not verified' } })
    const response = await POST(request({ leadId: 'lead-1', channel: 'email', body: 'Hello', subject: 'Offer' }))
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ sent: false, persisted: false, deliveryState: 'provider_rejected' })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ status: 502 }))
  })

  it('uses Caseys approved mailbox, provider idempotency, and persists provider evidence', async () => {
    mocks.emailSend.mockResolvedValue({ data: { id: 'email-provider-1' }, error: null })
    const response = await POST(request({ leadId: 'lead-1', channel: 'email', body: 'Hello', subject: 'Offer' }))
    expect(response.status).toBe(200)
    expect(mocks.emailSend).toHaveBeenCalledWith(expect.objectContaining({
      from: 'Casey at SavingKC <casey@savingkc.com>',
      to: ['seller@example.com'],
    }), { idempotencyKey: '11111111-1111-4111-8111-111111111111' })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'Casey',
      metadata: expect.objectContaining({
        actor_email: 'casey@savingkc.com',
        provider_message_id: 'email-provider-1',
        idempotency_key: '11111111-1111-4111-8111-111111111111',
      }),
    }))
    await expect(response.json()).resolves.toMatchObject({ sent: true, persisted: true, id: 'email-provider-1' })
  })

  it('replays a completed command without contacting the provider', async () => {
    mocks.reserve.mockResolvedValue({
      kind: 'replay', status: 200,
      result: { success: true, channel: 'email', sent: true, persisted: true, id: 'email-provider-1' },
    })
    const response = await POST(request({ leadId: 'lead-1', channel: 'email', body: 'Hello' }))
    expect(response.status).toBe(200)
    expect(mocks.emailSend).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ sent: true, id: 'email-provider-1' })
  })

  it('reports delivery unknown without writing invented history', async () => {
    mocks.emailSend.mockRejectedValue(new Error('socket closed'))
    const response = await POST(request({ leadId: 'lead-1', channel: 'email', body: 'Hello' }))
    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toMatchObject({ sent: null, persisted: false, code: 'delivery_unknown' })
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
