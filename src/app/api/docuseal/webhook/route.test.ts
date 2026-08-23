import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  timingSafeEqual: vi.fn(),
  supabaseAdmin: vi.fn(),
  ensureTcFileForSignedAssignment: vi.fn(),
  recordAssignmentToTcHandoff: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('node:crypto', () => ({
  timingSafeEqual: mocks.timingSafeEqual,
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}))

vi.mock('@/lib/tc', () => ({
  ensureTcFileForSignedAssignment: mocks.ensureTcFileForSignedAssignment,
}))
vi.mock('@/lib/server/crm-operating-handoffs', () => ({
  recordAssignmentToTcHandoff: mocks.recordAssignmentToTcHandoff,
}))

import { POST } from './route'

function request(options: { secret?: string; body?: string } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (options.secret !== undefined) headers.set('Docuseal-Signature', options.secret)
  return new NextRequest('https://crm.savingkc.com/api/docuseal/webhook', {
    method: 'POST',
    headers,
    body: options.body ?? JSON.stringify({
      event_type: 'submission.completed',
      data: {
        submission_id: 123,
        completed_at: '2026-08-18T12:00:00.000Z',
        documents: [{ url: 'https://sign.savingkc.com/document.pdf' }],
      },
    }),
  })
}

describe('DocuSeal webhook authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DOCUSEAL_WEBHOOK_SECRET', 'configured-secret')
    mocks.timingSafeEqual.mockImplementation((supplied: Buffer, expected: Buffer) => supplied.equals(expected))
    mocks.eq.mockResolvedValue({ error: null })
    mocks.update.mockReturnValue({ eq: mocks.eq })
    mocks.from.mockReturnValue({ update: mocks.update })
    mocks.supabaseAdmin.mockReturnValue({ from: mocks.from })
    mocks.ensureTcFileForSignedAssignment.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      lead_id: '22222222-2222-4222-8222-222222222222',
      buyer_offer_id: '33333333-3333-4333-8333-333333333333',
    })
    mocks.recordAssignmentToTcHandoff.mockResolvedValue({ handoffId: 'handoff-1', status: 'accepted' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('fails closed before parsing or database access when the secret is absent', async () => {
    vi.stubEnv('DOCUSEAL_WEBHOOK_SECRET', '')

    const response = await POST(request({ secret: 'anything', body: '{not-json' }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'DocuSeal webhook authentication is not configured' })
    expect(mocks.timingSafeEqual).not.toHaveBeenCalled()
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled()
  })

  it('rejects a different-length secret before constant-time comparison or parsing', async () => {
    const response = await POST(request({ secret: 'short', body: '{not-json' }))

    expect(response.status).toBe(401)
    expect(mocks.timingSafeEqual).not.toHaveBeenCalled()
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled()
  })

  it('uses constant-time comparison for a same-length invalid secret before parsing', async () => {
    const response = await POST(request({ secret: 'invalid-secret!!!', body: '{not-json' }))

    expect(response.status).toBe(401)
    expect(mocks.timingSafeEqual).toHaveBeenCalledOnce()
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled()
  })

  it('processes a valid signed completion only after authentication', async () => {
    const response = await POST(request({ secret: 'configured-secret' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.timingSafeEqual).toHaveBeenCalledOnce()
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      assignment_signed_at: expect.any(String),
      assignment_document_url: 'https://sign.savingkc.com/document.pdf',
    }))
    expect(mocks.eq).toHaveBeenCalledWith('assignment_submission_id', '123')
    expect(mocks.ensureTcFileForSignedAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ from: mocks.from }),
      '123',
    )
    expect(mocks.recordAssignmentToTcHandoff).toHaveBeenCalledWith(expect.objectContaining({
      commandId: '11111111-1111-4111-8111-111111111111',
      buyerOfferId: '33333333-3333-4333-8333-333333333333',
      evidenceReference: '123',
      actorName: 'DocuSeal',
    }))
  })
})
