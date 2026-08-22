import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), select: vi.fn(), in: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }) }))

import { getTaskWorklist, TaskWorklistError } from './task-worklist'

const item = {
  key: 'activity:task-1', sourceKind: 'activity', sourceId: 'task-1', leadId: 'lead-1', tcFileId: null,
  kind: 'callback', title: 'Call seller', description: null, status: 'pending', priority: 'high',
  dueAt: '2026-08-21T15:00:00.000Z', assignedTo: 'Casey', department: 'acquisitions', role: null,
  primaryNextAction: true, version: 2, sourceCreatedAt: '2026-08-20T15:00:00.000Z', completedAt: null,
  updatedAt: '2026-08-20T15:00:00.000Z',
  operationalLane: 'current',
  contact: { id: 'lead-1', fullName: 'Seller One', phone: '+18165550123', email: null, propertyAddress: '1 Main St', city: 'Kansas City', state: 'MO', zip: '64101', station: 'contacted', createdAt: '2026-08-01T00:00:00Z' },
}

describe('task worklist read model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockReturnValue({ select: mocks.select })
    mocks.select.mockReturnValue({ in: mocks.in })
    mocks.in.mockResolvedValue({ data: [{ id: 'lead-1', station: 'contacted', classification: 'warm' }], error: null })
    mocks.rpc.mockResolvedValue({
      data: { items: [item], hasMore: true, total: 23, counts: { all: 30, due_today: 4, overdue: 7, upcoming: 10, completed: 9 }, laneCounts: { current: 14, review: 8, all: 30 } },
      error: null,
    })
  })

  it('passes bounded server filters and Central day boundaries to the RPC', async () => {
    const result = await getTaskWorklist({
      department: 'acquisitions', view: 'due_today', status: 'active', assignee: 'Casey', due: 'seven_days',
      type: 'offer', query: 'Seller', sort: 'due_asc', limit: 20, now: new Date('2026-08-21T15:00:00Z'),
    })

    expect(mocks.rpc).toHaveBeenCalledWith('task_worklist_page_v2', expect.objectContaining({
      p_department: 'acquisitions', p_view: 'due_today', p_status_filter: 'active', p_assignee: 'Casey',
      p_due_filter: 'seven_days', p_kinds: ['send_offer'], p_query: 'Seller', p_sort: 'due_asc', p_limit: 20,
      p_lane: 'current',
      p_today_start: '2026-08-21T05:00:00.000Z', p_tomorrow_start: '2026-08-22T05:00:00.000Z',
    }))
    expect(result.items).toEqual([{ ...item, operationalLane: 'current', reviewReason: 'none' }])
    expect(result.pageInfo).toMatchObject({ total: 23, hasMore: true, limit: 20 })
    expect(result.pageInfo.nextCursor).toEqual(expect.any(String))
    expect(result.laneCounts).toEqual({ current: 14, review: 8, quarantine: 8, all: 30 })
  })

  it('uses the correct Central midnight across the fall DST transition', async () => {
    await getTaskWorklist({ now: new Date('2026-11-01T18:00:00Z') })
    expect(mocks.rpc).toHaveBeenCalledWith('task_worklist_page_v2', expect.objectContaining({
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
    [{ lane: 'made_up' }, 'lane'],
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

  it('attaches canonical review evidence without trusting the projection label', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        items: [item, { ...item, key: 'activity:task-2', sourceId: 'task-2', leadId: null, contact: null }],
        hasMore: false, total: 2, counts: {}, laneCounts: {},
      },
      error: null,
    })
    mocks.in.mockResolvedValueOnce({ data: [{ id: 'lead-1', station: 'closed_lost', classification: 'warm' }], error: null })

    const result = await getTaskWorklist({ lane: 'all' })

    expect(mocks.from).toHaveBeenCalledWith('leads')
    expect(mocks.select).toHaveBeenCalledWith('id,station,classification')
    expect(mocks.in).toHaveBeenCalledWith('id', ['lead-1'])
    expect(result.items.map(({ operationalLane, reviewReason }) => ({ operationalLane, reviewReason }))).toEqual([
      { operationalLane: 'review', reviewReason: 'terminal_station' },
      { operationalLane: 'review', reviewReason: 'unlinked' },
    ])
  })

  it('never upgrades a persisted review task to current when its contact is active', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        items: [{ ...item, operationalLane: 'review' }],
        hasMore: false, total: 1, counts: { all: 1 }, laneCounts: { current: 0, review: 1, all: 1 },
      },
      error: null,
    })

    const result = await getTaskWorklist({ lane: 'review' })

    expect(result.items[0]).toMatchObject({ operationalLane: 'review', reviewReason: 'legacy_event' })
  })

  it('preserves the server-classified automation quarantine without loading lead evidence', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        items: [{ ...item, operationalLane: 'quarantine' }],
        hasMore: false, total: 1, counts: { all: 1 }, laneCounts: { current: 0, review: 0, all: 1 },
      },
      error: null,
    })

    const result = await getTaskWorklist({ lane: 'quarantine' })

    expect(mocks.rpc).toHaveBeenCalledWith('task_worklist_page_v2', expect.objectContaining({ p_lane: 'quarantine' }))
    expect(mocks.from).not.toHaveBeenCalled()
    expect(result.items[0]).toMatchObject({ operationalLane: 'quarantine', reviewReason: 'automation_source' })
    expect(result.laneCounts.quarantine).toBe(1)
  })

  it('fails closed when canonical review evidence cannot be loaded', async () => {
    mocks.in.mockResolvedValueOnce({ data: null, error: { message: 'database unavailable' } })
    await expect(getTaskWorklist({})).rejects.toMatchObject({ code: 'unavailable' })
  })
})
