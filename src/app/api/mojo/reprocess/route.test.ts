import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  requireAdminOrSecret: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

vi.mock('@/lib/api/admin-auth', () => ({
  requireAdminOrSecret: mocks.requireAdminOrSecret,
}))

vi.mock('@/lib/mojo-recording-downloader', () => ({ downloadRecording: vi.fn() }))
vi.mock('@/lib/mojo-transcriber', () => ({ transcribeAudio: vi.fn() }))
vi.mock('@/lib/mojo-call-analyzer', () => ({ analyzeCallTranscript: vi.fn() }))

import { POST } from './route'

describe('/api/mojo/reprocess containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an untrusted caller before reading manifests or starting AI work', async () => {
    mocks.requireAdminOrSecret.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    )

    const response = await POST(new Request('https://crm.savingkc.com/api/mojo/reprocess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
