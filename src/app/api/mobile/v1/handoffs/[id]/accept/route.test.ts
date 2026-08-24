import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), accept: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/auth')>(), requireMobileActor: mocks.actor,
}))
vi.mock('@/lib/server/crm-operating-handoffs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/crm-operating-handoffs')>(), acceptDepartmentHandoff: mocks.accept,
}))

import { POST } from './route'

describe('mobile department handoff acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ actor: { email: 'casey@savingkc.com', name: 'Casey' } })
    mocks.accept.mockResolvedValue({ handoffId: 'handoff-1', status: 'accepted', replayed: false })
  })

  it('accepts with the verified mobile actor', async () => {
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/handoffs/x/accept', {
      method: 'POST', headers: { Authorization: 'Bearer token' },
    }), { params: Promise.resolve({ id: 'handoff-1' }) })

    expect(response.status).toBe(200)
    expect(mocks.accept).toHaveBeenCalledWith({ handoffId: 'handoff-1', actorEmail: 'casey@savingkc.com', actorName: 'Casey' })
  })

  it('rejects an invalid bearer before handoff mutation', async () => {
    const { MobileAuthError } = await import('@/lib/mobile-api/auth')
    mocks.actor.mockRejectedValue(new MobileAuthError('Invalid bearer token'))

    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/handoffs/x/accept', {
      method: 'POST', headers: { Authorization: 'Bearer bad' },
    }), { params: Promise.resolve({ id: 'handoff-1' }) })

    expect(response.status).toBe(401)
    expect(mocks.accept).not.toHaveBeenCalled()
  })
})
