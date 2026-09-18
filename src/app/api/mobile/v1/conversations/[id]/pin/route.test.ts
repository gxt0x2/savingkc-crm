import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  admin: vi.fn(),
  readLead: vi.fn(),
  updateUser: vi.fn(),
}))

vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileUser: mocks.user,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

import { POST } from './route'

const context = { params: Promise.resolve({ id: 'lead-1' }) }
function request(pinned: boolean) {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/conversations/lead-1/pin', {
    method: 'POST',
    headers: { Authorization: 'Bearer user', 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned }),
  })
}

describe('mobile pinned chat preference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({
      user: { id: 'user-1', email: 'ernest@savingkc.com', app_metadata: { pinned_chat_ids: [] } },
    })
    mocks.readLead.mockResolvedValue({ data: { id: 'lead-1' }, error: null })
    mocks.updateUser.mockResolvedValue({ error: null })
    mocks.admin.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.readLead }) }) }),
      auth: { admin: { updateUserById: mocks.updateUser } },
    })
  })

  it('persists the pin on the authenticated user for cross-device continuity', async () => {
    const response = await POST(request(true), context)

    expect(response.status).toBe(200)
    expect(mocks.updateUser).toHaveBeenCalledWith('user-1', {
      app_metadata: { pinned_chat_ids: ['lead-1'] },
    })
  })

  it('is duplicate-safe and avoids an auth update when already pinned', async () => {
    mocks.user.mockResolvedValue({
      user: { id: 'user-1', email: 'ernest@savingkc.com', app_metadata: { pinned_chat_ids: ['lead-1'] } },
    })

    const response = await POST(request(true), context)

    expect(response.status).toBe(200)
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('removes only the requested conversation pin', async () => {
    mocks.user.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'ernest@savingkc.com',
        app_metadata: { pinned_chat_ids: ['lead-2', 'lead-1'] },
      },
    })

    const response = await POST(request(false), context)

    expect(response.status).toBe(200)
    expect(mocks.updateUser).toHaveBeenCalledWith('user-1', {
      app_metadata: { pinned_chat_ids: ['lead-2'] },
    })
  })
})
