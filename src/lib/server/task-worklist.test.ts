import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc }) }))

import { getTaskWorklist, TaskWorklistError } from './task-worklist'

const item = {
  key: 'activity:task-1', sourceKind: 'activity', sourceId: 'task-1', leadId: 'lead-1', tcFileId: null,
  kind: 'callback', title: 'Call seller', description: null, status: 'pending', priority: 'high',
  dueAt: '2026-08-21T15:00:00.000Z', assignedTo: 'Casey', department: 'acquisitions', role: null,
  primaryNextAction: true, version: 2, sourceCreatedAt: '2026-08-20T15:00:00.000Z', completedAt: null,
  updatedAt: '2026-08-20T15:00:00.000Z',
  contact: { id: 'lead-1', fullName: 'Seller One', phone: '+18165550123', email: null, propertyAddress: '1 Main St', city: 'Kansas City', state: 'MO', zip: '64101', station: 'contacted', createdAt: '2026-08-01T00:00:00Z' },
}

describe('task worklist read model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({
      data: { items: [item], hasMore: true, total: 23, counts: { all: 30, due_today: 4, overdue: 7, upcoming: 10, completed: 9 } },
      error: null,
    })
  })

  it('passes bounded server filters and Central day boundaries to the RPC', async () => {
    const result = await getTaskWorklist({
      department: 'acquisitions', view: 'due_today', status: 'active', assignee: 'Casey', due: 'seven_days',
      type: 'offer', query: 'Seller', sort: 'due_asc', limit: 20, now: new Date('2026-08-21T15:00:00Z'),
    })

    expect(mocks.rpc).toHaveBeenCalledWith('task_worklist_page_v1', expect.objectContaining({
      p_department: 'acquisitions', p_view: 'due_today', p_status_filter: 'active', p_assignee: 'Casey',
      p_due_filter: 'seven_days', p_kinds: ['send_offer'], p_query: 'Seller', p_sort: 'due_asc', p_limit: 20,
      p_today_start: '2026-08-21T05:00:00.000Z', p_tomorrow_start: '2026-08-22T05:00:00.000Z',
    }))
    expect(result.items).toEqual([item])
    expect(result.pageInfo).toMatchObject({ total: 23, hasMore: true, limit: 20 })
    expect(result.pageInfo.nextCursor).toEqual(expect.any(String))
  })

  it('uses the correct Central midnight across the fall DST transition', async () => {
    await getTaskWorklist({ now: new Date('2026-11-01T18:00:00Z') })
    expect(mocks.rpc).toHaveBeenCalledWith('task_worklist_page_v1', expect.objectContaining({
      p_today_start: '2026-11-01T05:00:00.000Z',
      p_tomorrow_start: '2026-11-02T06:00:00.000Z',
    }))
  })

  it('binds an opaque cursor to its sort order', async () => {
    const first = await getTaskWorklist({ sort: 'due_asc' })
    await expect(getTaskWorklist({ sort: 'newest', cursor: first.pageInfo.nextCursor })).rejects.toMatchObject({ code: 'invalid' })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ query: 'ab' }, 'search'],
    [{ query: 'x'.repeat(101) }, 'search'],
    [{ limit: Number.NaN }, 'limit'],
    [{ type: 'made_up' }, 'type'],
  ])('rejects invalid input before querying the database: %s', async (input, message) => {
    await expect(getTaskWorklist(input)).rejects.toBeInstanceOf(TaskWorklistError)
    await expect(getTaskWorklist(input)).rejects.toThrow(message)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('fails closed when the RPC or response contract is unavailable', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'function missing' } })
    await expect(getTaskWorklist({})).rejects.toMatchObject({ code: 'unavailable' })
    mocks.rpc.mockResolvedValueOnce({ data: { items: [{}], counts: {} }, error: null })
    await expect(getTaskWorklist({})).rejects.toMatchObject({ code: 'unavailable' })
  })
})
