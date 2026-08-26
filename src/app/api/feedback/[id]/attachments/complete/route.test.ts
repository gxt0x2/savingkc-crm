import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  maybeSingle: vi.fn(),
  countResult: vi.fn(),
  info: vi.fn(),
  insert: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/server/andon-attachment-access', () => ({
  requireAndonAttachmentOwner: mocks.requireOwner,
}))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: (_columns: string, options?: { head?: boolean }) => options?.head
        ? { eq: () => mocks.countResult() }
        : { eq: () => ({ maybeSingle: mocks.maybeSingle }) },
      insert: (payload: unknown) => {
        mocks.insert(payload)
        return {
          select: () => ({
            single: async () => ({
              data: { id: 'attachment-1', feedback_id: 'andon-1', filename: 'voice-memo.m4a', mime_type: 'audio/mp4', byte_size: 4096, kind: 'audio', created_at: '2026-08-26T12:00:00Z' },
              error: null,
            }),
          }),
        }
      },
    }),
    storage: {
      from: () => ({ info: mocks.info, remove: mocks.remove }),
    },
  }),
}))

import { POST } from './route'

function request(overrides: Record<string, unknown> = {}) {
  return new Request('https://crm.savingkc.com/api/feedback/andon-1/attachments/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: 'voice-memo.m4a',
      mime_type: 'audio/mp4',
      byte_size: 4096,
      storage_path: 'feedback/andon-1/upload-voice-memo.m4a',
      ...overrides,
    }),
  })
}

describe('complete Andon attachment upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireOwner.mockResolvedValue({ ok: true, user: { id: 'user-1', email: 'ernest@savingkc.com' } })
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    mocks.countResult.mockResolvedValue({ count: 0, error: null })
    mocks.info.mockResolvedValue({ data: { size: 4096, contentType: 'audio/mp4' }, error: null })
    mocks.remove.mockResolvedValue({ data: [], error: null })
  })

  it('verifies the private object before linking its metadata', async () => {
    const response = await POST(request() as never, { params: Promise.resolve({ id: 'andon-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload.attachment.kind).toBe('audio')
    expect(mocks.info).toHaveBeenCalledWith('feedback/andon-1/upload-voice-memo.m4a')
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      feedback_id: 'andon-1',
      filename: 'voice-memo.m4a',
      storage_path: 'feedback/andon-1/upload-voice-memo.m4a',
      mime_type: 'audio/mp4',
      byte_size: 4096,
      kind: 'audio',
      uploaded_by: 'ernest@savingkc.com',
    }))
  })

  it('rejects a path outside the owning Andon before checking storage', async () => {
    const response = await POST(request({ storage_path: 'feedback/another-andon/file.m4a' }) as never, { params: Promise.resolve({ id: 'andon-1' }) })

    expect(response.status).toBe(400)
    expect(mocks.requireOwner).not.toHaveBeenCalled()
    expect(mocks.info).not.toHaveBeenCalled()
  })

  it('removes an uploaded object when the attachment limit is reached', async () => {
    mocks.countResult.mockResolvedValue({ count: 8, error: null })

    const response = await POST(request() as never, { params: Promise.resolve({ id: 'andon-1' }) })

    expect(response.status).toBe(409)
    expect(mocks.remove).toHaveBeenCalledWith(['feedback/andon-1/upload-voice-memo.m4a'])
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
