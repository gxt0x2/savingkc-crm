import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  createSignedUploadUrl: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/server/andon-attachment-access', () => ({
  requireAndonAttachmentOwner: mocks.requireOwner,
}))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    storage: { from: () => ({ createSignedUploadUrl: mocks.createSignedUploadUrl }) },
  }),
}))

import { POST } from './route'

function request(overrides: Record<string, unknown> = {}) {
  return new Request('https://crm.savingkc.com/api/feedback/andon-1/attachments/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'screen shot.png', mime_type: 'image/png', byte_size: 2048, ...overrides }),
  })
}

describe('prepare Andon attachment upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireOwner.mockResolvedValue({ ok: true, user: { id: 'user-1', email: 'ernest@savingkc.com' } })
    mocks.createSignedUploadUrl.mockImplementation(async (path: string) => ({ data: { path, token: 'signed-token' }, error: null }))
  })

  it('returns a short-lived signed target under the owning Andon', async () => {
    const response = await POST(request() as never, { params: Promise.resolve({ id: 'andon-1' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.bucket).toBe('andon-attachments')
    expect(payload.token).toBe('signed-token')
    expect(payload.path).toMatch(/^feedback\/andon-1\/[\w-]+-screen_shot\.png$/)
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(payload.path, { upsert: false })
  })

  it('rejects oversized files before issuing an upload token', async () => {
    const response = await POST(request({ byte_size: 51 * 1024 * 1024 }) as never, { params: Promise.resolve({ id: 'andon-1' }) })

    expect(response.status).toBe(400)
    expect(mocks.requireOwner).not.toHaveBeenCalled()
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })
})
