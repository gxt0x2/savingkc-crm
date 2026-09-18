import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  admin: vi.fn(),
  read: vi.fn(),
  updateResult: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileActor: mocks.actor,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

import { POST } from './route'

const context = { params: Promise.resolve({ id: 'lead-1' }) }
function request(pinned: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/leads/lead-1/favorite', {
    method: 'POST',
    headers: { Authorization: 'Bearer user', 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned }),
  })
}

describe('mobile top-opportunity pin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      user: { id: 'user-1' },
    })
    mocks.read.mockResolvedValue({ data: { id: 'lead-1', is_favorite: false }, error: null })
    mocks.updateResult.mockResolvedValue({ data: { id: 'lead-1', is_favorite: true }, error: null })
    mocks.insert.mockResolvedValue({ error: null })
    mocks.update.mockReturnValue({
      eq: () => ({ select: () => ({ maybeSingle: mocks.updateResult }) }),
    })
    mocks.admin.mockReturnValue({
      from: (table: string) => {
        if (table === 'lead_activities') return { insert: mocks.insert }
        return {
          select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }),
          update: mocks.update,
        }
      },
    })
  })

  it('writes the desired canonical favorite and server-derived audit actor', async () => {
    const response = await POST(request(true), context)

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ is_favorite: true }))
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      lead_id: 'lead-1',
      agent: 'Casey',
      metadata: expect.objectContaining({ actor_email: 'casey@savingkc.com', pinned: true }),
    }))
  })

  it('is duplicate-safe when the lead already has the desired value', async () => {
    mocks.read.mockResolvedValue({ data: { id: 'lead-1', is_favorite: true }, error: null })

    const response = await POST(request(true), context)

    expect(response.status).toBe(200)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('rejects a non-boolean desired state before mutation', async () => {
    const response = await POST(request('yes'), context)

    expect(response.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
