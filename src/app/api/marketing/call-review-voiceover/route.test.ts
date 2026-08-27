import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentUserEmail: vi.fn(),
  isCurrentUserAdmin: vi.fn(),
  maybeSingle: vi.fn(),
  createSignedUploadUrl: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.getCurrentUserEmail,
  isCurrentUserAdmin: mocks.isCurrentUserAdmin,
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }) }),
    storage: { from: () => ({ createSignedUploadUrl: mocks.createSignedUploadUrl }) },
  }),
}))

vi.mock('@/lib/marketing/call-recordings', () => ({
  readCallReviewWorkflow: () => ({ status: 'submitted', assignedReviewer: 'ernest@savingkc.com' }),
}))

import { POST } from './route'

function request(values: Record<string, unknown> = {}) {
  return new NextRequest('https://crm.savingkc.com/api/marketing/call-review-voiceover', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ activityId: 'call-42', mimeType: 'audio/webm;codecs=opus', byteSize: 2_000_000, ...values }),
  })
}

describe('call review voiceover direct upload preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUserEmail.mockResolvedValue('ernest@savingkc.com')
    mocks.isCurrentUserAdmin.mockResolvedValue(false)
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'call-42', metadata: {} }, error: null })
    mocks.createSignedUploadUrl.mockResolvedValue({ data: { token: 'signed-token' }, error: null })
  })

  it('accepts an Opus codec MIME type and returns a signed storage target', async () => {
    const response = await POST(request())
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload).toMatchObject({ token: 'signed-token', bucket: 'deal-documents', mimeType: 'audio/webm;codecs=opus' })
    expect(payload.path).toMatch(/^call-review-voiceovers\/call-42\/[\w-]+\.webm$/)
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(payload.path, { upsert: false })
  })

  it('rejects an oversized recording before issuing a token', async () => {
    const response = await POST(request({ byteSize: 51 * 1024 * 1024 }))

    expect(response.status).toBe(413)
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled()
  })
})
