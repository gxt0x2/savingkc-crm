import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), transition: vi.fn() }))
vi.mock('@/lib/mobile-api/mobile-command-access', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/mobile-command-access')>(), requireAuthorizedMobileWorkItem: mocks.actor }))
vi.mock('@/lib/server/work-items', async (original) => ({ ...await original<typeof import('@/lib/server/work-items')>(), transitionWorkItem: mocks.transition }))
import { POST } from './route'

function request(body: unknown, key = 'task-cancel-1') {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/work-items/x/cancel', {
    method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body),
  })
}
const context = { params: Promise.resolve({ id: 'activity:task-1' }) }

describe('mobile work-item cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ actor: { name: 'Casey' } })
    mocks.transition.mockResolvedValue({ changed: true, workItem: { key: 'activity:task-1', status: 'cancelled', version: 4 } })
  })

  it('uses actor-scoped canonical cancel with version and stable identity', async () => {
    const response = await POST(request({ expectedVersion: 3 }), context)
    expect(response.status).toBe(200)
    expect(mocks.actor).toHaveBeenCalledWith(expect.any(NextRequest), 'activity:task-1')
    expect(mocks.transition).toHaveBeenCalledWith({ key: 'activity:task-1', actor: 'Casey', action: 'cancel', expectedVersion: 3, idempotencyKey: 'task-cancel-1' })
    expect(await response.json()).toMatchObject({ item: { status: 'cancelled', version: 4 } })
    expect(response.headers.get('Cache-Control')).toContain('no-store')
  })

  it('does not invoke the command without version or stable key', async () => {
    expect((await POST(request({}), context)).status).toBe(400)
    expect((await POST(request({ expectedVersion: 3 }, 'short'), context)).status).toBe(400)
    expect(mocks.transition).not.toHaveBeenCalled()
  })

  it('does not invoke the command when scope check fails', async () => {
    const { MobileCommandAccessError } = await import('@/lib/mobile-api/mobile-command-access')
    mocks.actor.mockRejectedValueOnce(new MobileCommandAccessError('outside scope', 403))
    expect((await POST(request({ expectedVersion: 3 }), context)).status).toBe(403)
    expect(mocks.transition).not.toHaveBeenCalled()
  })
})
