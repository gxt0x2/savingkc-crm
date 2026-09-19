import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  reserve: vi.fn(),
  complete: vi.fn(),
  admin: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  insert: vi.fn(),
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

function leadQuery() {
  const query = {
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: { id: leadId }, error: null })),
  }
  return { select: vi.fn(() => query) }
}

function request(key = 'attachment-key-1') {
  const form = new FormData()
  form.append('file', new File(['actual-image-bytes'], 'house.jpg', { type: 'image/jpeg' }))
  return new NextRequest(`https://crm.savingkc.com/api/mobile/v1/leads/${leadId}/attachments`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token', 'Idempotency-Key': key },
    body: form,
  })
}

describe('mobile attachment upload route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireActor.mockResolvedValue({ actor: { email: 'ernest@savingkc.com', name: 'Ernest' } })
    mocks.reserve.mockResolvedValue({ kind: 'reserved' })
    mocks.complete.mockResolvedValue(undefined)
    mocks.upload.mockResolvedValue({ error: null })
    mocks.remove.mockResolvedValue({ error: null })
    mocks.insert.mockReturnValue({
      select: () => ({
        single: async () => ({
          data: {
            id: 'attachment-1',
            filename: 'house.jpg',
            mime_type: 'image/jpeg',
            byte_size: 18,
            uploaded_at: '2026-09-18T20:00:00.000Z',
          },
          error: null,
        }),
      }),
    })
    mocks.admin.mockReturnValue({
      from: (table: string) => table === 'leads' ? leadQuery() : { insert: mocks.insert },
      storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
    })
  })

  it('uploads once, records canonical metadata, and completes the receipt', async () => {
    const response = await POST(request(), context)
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      attachment: { id: 'attachment-1', filename: 'house.jpg', mimeType: 'image/jpeg' },
    })
    expect(mocks.upload).toHaveBeenCalledOnce()
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      entity_type: 'lead',
      entity_id: leadId,
      uploaded_by: 'ernest@savingkc.com',
    }))
    expect(mocks.complete).toHaveBeenCalledOnce()
  })

  it('replays an exact duplicate without uploading a second object', async () => {
    mocks.reserve.mockResolvedValue({
      kind: 'replay',
      status: 201,
      result: { success: true, attachment: { id: 'attachment-1', filename: 'house.jpg', mimeType: 'image/jpeg', byteSize: 18 } },
    })
    const response = await POST(request(), context)
    expect(response.status).toBe(201)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('returns the uploaded attachment when only receipt reconciliation fails', async () => {
    mocks.complete.mockRejectedValue(new Error('receipt unavailable'))
    const response = await POST(request(), context)
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      attachment: { id: 'attachment-1' },
      warning: expect.stringMatching(/uploaded.*reconciliation/i),
    })
    expect(mocks.upload).toHaveBeenCalledOnce()
  })
})
