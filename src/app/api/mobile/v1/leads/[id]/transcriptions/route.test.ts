import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  reserve: vi.fn(),
  complete: vi.fn(),
  admin: vi.fn(),
}))

vi.mock('@/lib/mobile-api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileActor: mocks.requireActor,
}))
vi.mock('@/lib/mobile-api/command-receipts', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/command-receipts')>(),
  reserveMobileCommand: mocks.reserve,
  completeMobileCommand: mocks.complete,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

import { POST } from './route'

const leadId = '1705b085-47c6-432d-9371-97dcabfc9bbc'
const context = { params: Promise.resolve({ id: leadId }) }
const originalKey = process.env.GROQ_API_KEY
const originalFetch = globalThis.fetch

function request(key = 'transcript-key-1') {
  const form = new FormData()
  form.append('file', new File(['actual-audio-bytes'], 'voice.m4a', { type: 'audio/mp4' }))
  return new NextRequest(`https://crm.savingkc.com/api/mobile/v1/leads/${leadId}/transcriptions`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token', 'Idempotency-Key': key },
    body: form,
  })
}

describe('mobile voice transcription route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GROQ_API_KEY = 'test-groq-key'
    mocks.requireActor.mockResolvedValue({ actor: { email: 'ernest@savingkc.com', name: 'Ernest' } })
    mocks.reserve.mockResolvedValue({ kind: 'reserved' })
    mocks.complete.mockResolvedValue(undefined)
    const query = {
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: { id: leadId }, error: null })),
    }
    mocks.admin.mockReturnValue({ from: () => ({ select: () => query }) })
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ text: 'Call Friday after two.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = originalKey
  })

  it('uses the real recording, returns provider text, and completes a receipt', async () => {
    const response = await POST(request(), context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      text: 'Call Friday after two.',
      provider: 'groq',
    })
    expect(globalThis.fetch).toHaveBeenCalledOnce()
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }))
  })

  it('replays an exact retry without paying the provider twice', async () => {
    mocks.reserve.mockResolvedValue({
      kind: 'replay',
      status: 200,
      result: { success: true, text: 'Call Friday after two.', provider: 'groq', model: 'whisper-large-v3-turbo' },
    })
    const response = await POST(request(), context)
    expect(response.status).toBe(200)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('records a definite provider failure so the same retry replays safely', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad audio' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch
    const response = await POST(request(), context)
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/audio draft/i) })
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      status: 502,
      result: { error: expect.stringMatching(/audio draft/i) },
    }))
  })

  it('returns the usable transcript when only receipt reconciliation fails', async () => {
    mocks.complete.mockRejectedValue(new Error('receipt unavailable'))
    const response = await POST(request(), context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      text: 'Call Friday after two.',
      warning: expect.stringMatching(/transcript.*reconciliation/i),
    })
  })
})
