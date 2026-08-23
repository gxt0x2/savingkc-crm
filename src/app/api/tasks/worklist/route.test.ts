import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), worklist: vi.fn() }))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/task-worklist', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/task-worklist')>('@/lib/server/task-worklist')
  return { ...actual, getTaskWorklist: mocks.worklist }
})

import { GET } from './route'
import { TaskWorklistError } from '@/lib/server/task-worklist'

const page = {
  items: [], counts: { all: 0, due_today: 0, overdue: 0, upcoming: 0, completed: 0 }, laneCounts: { current: 0, review: 0, quarantine: 0, all: 0 },
  pageInfo: { limit: 20, total: 0, hasMore: false, nextCursor: null }, serverNow: '2026-08-21T15:00:00Z',
}

describe('task worklist route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.worklist.mockResolvedValue(page)
  })

  it('requires a route-local authenticated actor before reading tasks', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await GET(new Request('https://crm.savingkc.com/api/tasks/worklist'))
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.worklist).not.toHaveBeenCalled()
  })

  it('forwards only supported query inputs and returns bounded telemetry', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/tasks/worklist?view=overdue&status=active&q=seller&limit=20&sort=newest&lane=current'))
    expect(response.status).toBe(200)
    expect(mocks.worklist).toHaveBeenCalledWith(expect.objectContaining({ view: 'overdue', status: 'active', query: 'seller', limit: 20, sort: 'newest', lane: 'current' }))
    expect(response.headers.get('server-timing')).toContain('task_rows')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('retires historical lanes from the operator worklist', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/tasks/worklist?lane=quarantine'))
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({ replacement: '/tasks' })
    expect(mocks.worklist).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid requests and a generic 503 for read-model failures', async () => {
    mocks.worklist.mockRejectedValueOnce(new TaskWorklistError('Task sort is invalid.', 'invalid'))
    expect((await GET(new Request('https://crm.savingkc.com/api/tasks/worklist?sort=nope'))).status).toBe(400)

    mocks.worklist.mockRejectedValueOnce(new Error('database details'))
    const response = await GET(new Request('https://crm.savingkc.com/api/tasks/worklist'))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Task worklist is unavailable.' })
  })
})
