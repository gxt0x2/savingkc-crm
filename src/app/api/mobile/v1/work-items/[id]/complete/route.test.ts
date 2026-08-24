import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), transition: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/auth')>(), requireMobileActor: mocks.actor,
}))
vi.mock('@/lib/server/work-items', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/work-items')>(), transitionWorkItem: mocks.transition,
}))

import { POST } from './route'

const context = { params: Promise.resolve({ id: 'activity:task-1' }) }

describe('mobile work-item completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ actor: { email: 'casey@savingkc.com', name: 'Casey' } })
    mocks.transition.mockResolvedValue({ changed: true, workItem: { key: 'activity:task-1', version: 3 } })
  })

  it('completes through the versioned canonical work-item service', async () => {
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/work-items/x/complete', {
      method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 2 }),
    }), context)

    expect(response.status).toBe(200)
    expect(mocks.transition).toHaveBeenCalledWith(expect.objectContaining({
      key: 'activity:task-1', actor: 'Casey', action: 'complete', expectedVersion: 2,
    }))
  })

  it('rejects an invalid bearer before work-item mutation', async () => {
    const { MobileAuthError } = await import('@/lib/mobile-api/auth')
    mocks.actor.mockRejectedValue(new MobileAuthError('Invalid bearer token'))

    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/work-items/x/complete', {
      method: 'POST', headers: { Authorization: 'Bearer bad' },
    }), context)

    expect(response.status).toBe(401)
    expect(mocks.transition).not.toHaveBeenCalled()
  })
})
