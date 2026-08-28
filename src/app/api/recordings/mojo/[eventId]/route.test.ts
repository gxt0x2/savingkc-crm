import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  single: vi.fn(),
  createSignedUrl: vi.fn(),
}))

vi.mock('@/lib/api/require-authenticated-user', () => ({
  requireAuthenticatedUser: mocks.authorize,
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }),
    storage: { from: () => ({ createSignedUrl: mocks.createSignedUrl }) },
  }),
}))

import { GET } from './route'

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function request() {
  return new NextRequest(`https://crm.savingkc.com/api/recordings/mojo/${EVENT_ID}`)
}

describe('private Mojo recording playback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue(null)
    mocks.single.mockResolvedValue({ data: { recording_storage_path: `mojo/${EVENT_ID}.mp3` }, error: null })
    mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example/signed-audio' }, error: null })
  })

  it('fails closed before looking up private media', async () => {
    mocks.authorize.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const response = await GET(request(), { params: Promise.resolve({ eventId: EVENT_ID }) })
    expect(response.status).toBe(401)
    expect(mocks.single).not.toHaveBeenCalled()
  })

  it('redirects an authenticated user to a short-lived signed URL', async () => {
    const response = await GET(request(), { params: Promise.resolve({ eventId: EVENT_ID }) })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://storage.example/signed-audio')
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(`mojo/${EVENT_ID}.mp3`, 600)
  })

  it('does not reveal whether malformed event IDs exist', async () => {
    const response = await GET(request(), { params: Promise.resolve({ eventId: 'not-an-event' }) })
    expect(response.status).toBe(404)
    expect(mocks.single).not.toHaveBeenCalled()
  })
})
