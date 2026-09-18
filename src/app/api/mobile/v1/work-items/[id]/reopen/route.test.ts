import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), transition: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/auth')>(), requireMobileActor: mocks.actor }))
vi.mock('@/lib/server/work-items', async (original) => ({ ...await original<typeof import('@/lib/server/work-items')>(), transitionWorkItem: mocks.transition }))
import { POST } from './route'

describe('mobile work-item reopen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ actor: { email: 'casey@savingkc.com', name: 'Casey' } })
    mocks.transition.mockResolvedValue({ changed: true, workItem: { key: 'activity:task-1', version: 4 } })
  })
  it('reopens with version and stable idempotency', async () => {
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/work-items/x/reopen', {
      method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': 'task-reopen-1' }, body: JSON.stringify({ expectedVersion: 3 }),
    }), { params: Promise.resolve({ id: 'activity:task-1' }) })
    expect(response.status).toBe(200)
    expect(mocks.transition).toHaveBeenCalledWith(expect.objectContaining({ action: 'reopen', expectedVersion: 3, idempotencyKey: 'task-reopen-1' }))
  })
})
