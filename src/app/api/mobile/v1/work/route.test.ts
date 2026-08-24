import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  getTaskWorklist: vi.fn(),
  admin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eqDepartment: vi.fn(),
  eqStatus: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
}))

vi.mock('@/lib/mobile-api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileActor: mocks.actor,
}))
vi.mock('@/lib/server/task-worklist', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/task-worklist')>(),
  getTaskWorklist: mocks.getTaskWorklist,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

import { GET } from './route'

function request(query = '') {
  return new NextRequest(`https://crm.savingkc.com/api/mobile/v1/work${query}`, {
    headers: { Authorization: 'Bearer test' },
  })
}

describe('mobile work queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ actor: { email: 'casey@savingkc.com', name: 'Casey' } })
    mocks.getTaskWorklist.mockResolvedValue({ items: [{ key: 'activity:task-1' }], counts: { all: 1 }, serverNow: '2026-08-24T12:00:00Z' })
    mocks.limit.mockResolvedValue({ data: [{ id: 'handoff-1' }], error: null })
    mocks.order.mockReturnValue({ limit: mocks.limit })
    mocks.eqStatus.mockReturnValue({ order: mocks.order })
    mocks.eqDepartment.mockReturnValue({ eq: mocks.eqStatus })
    mocks.select.mockReturnValue({ eq: mocks.eqDepartment })
    mocks.from.mockReturnValue({ select: mocks.select })
    mocks.admin.mockReturnValue({ from: mocks.from })
  })

  it('binds Mine to the verified actor and maps TC to the canonical handoff department', async () => {
    const response = await GET(request('?department=tc&scope=mine'))

    expect(response.status).toBe(200)
    expect(mocks.getTaskWorklist).toHaveBeenCalledWith(expect.objectContaining({
      department: 'tc', assignee: 'Casey', lane: 'current', limit: 25,
    }))
    expect(mocks.eqDepartment).toHaveBeenCalledWith('to_department', 'transaction_coordination')
    await expect(response.json()).resolves.toMatchObject({ actor: 'Casey', tasks: [{ key: 'activity:task-1' }] })
  })

  it('uses an explicit unassigned filter instead of downloading all tasks', async () => {
    const response = await GET(request('?scope=unassigned'))

    expect(response.status).toBe(200)
    expect(mocks.getTaskWorklist).toHaveBeenCalledWith(expect.objectContaining({ assignee: '__unassigned' }))
  })

  it('rejects an invalid department before task or handoff reads', async () => {
    const response = await GET(request('?department=marketing'))

    expect(response.status).toBe(400)
    expect(mocks.getTaskWorklist).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('rejects an invalid bearer before reading operational data', async () => {
    const { MobileAuthError } = await import('@/lib/mobile-api/auth')
    mocks.actor.mockRejectedValue(new MobileAuthError('Invalid bearer token'))

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.getTaskWorklist).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
