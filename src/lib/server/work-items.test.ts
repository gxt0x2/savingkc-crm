import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), laneLookup: vi.fn(), eq: vi.fn(), readRows: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    const query = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      eq: mocks.eq.mockImplementation(() => query),
      in: mocks.laneLookup,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(mocks.readRows()).then(resolve, reject),
    }
    return { rpc: mocks.rpc, from: vi.fn(() => query) }
  },
}))

import { createWorkItem, listWorkItems, normalizeWorkItemKind, transitionWorkItem, transitionWorkItemsBulk } from './work-items'

const row = {
  work_item_key: 'activity:10000000-0000-0000-0000-000000000001',
  source_kind: 'activity',
  source_id: '10000000-0000-0000-0000-000000000001',
  lead_id: '00000000-0000-0000-0000-000000000001',
  tc_file_id: null,
  kind: 'follow_up',
  title: 'Call seller',
  description: null,
  status: 'pending',
  priority: 'normal',
  due_at: '2026-08-21T14:00:00.000Z',
  assigned_to: 'Casey',
  department: 'acquisitions',
  role: 'setter',
  primary_next_action: true,
  version: 1,
  source_created_at: '2026-08-20T14:00:00.000Z',
  completed_at: null,
  updated_at: '2026-08-20T14:00:00.000Z',
}

describe('canonical work-item server service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.laneLookup.mockImplementation((_field: string, keys: string[]) => Promise.resolve({
      data: keys.map((key) => ({ work_item_key: key, operational_lane: 'current' })),
      error: null,
    }))
    mocks.readRows.mockReturnValue({ data: [row], error: null })
  })

  it('normalizes legacy UI labels into the canonical kind vocabulary', () => {
    expect(normalizeWorkItemKind('offer')).toBe('send_offer')
    expect(normalizeWorkItemKind('research')).toBe('task')
    expect(normalizeWorkItemKind('general')).toBe('task')
    expect(normalizeWorkItemKind('callback')).toBe('callback')
  })

  it('creates through the idempotent database boundary', async () => {
    mocks.rpc.mockResolvedValue({ data: { created: true, workItem: row }, error: null })
    const result = await createWorkItem({
      actor: 'Casey',
      idempotencyKey: 'create-key-0001',
      kind: 'follow_up',
      title: 'Call seller',
      assignedTo: 'Casey',
      department: 'acquisitions',
    })

    expect(result.created).toBe(true)
    expect(result.workItem.key).toBe(row.work_item_key)
    expect(mocks.rpc).toHaveBeenCalledWith('create_work_item_v1', expect.objectContaining({
      p_actor: 'Casey',
      p_idempotency_key: 'create-key-0001',
    }))
  })

  it('defaults every standard read to the current operational lane', async () => {
    await expect(listWorkItems({ limit: 10 })).resolves.toHaveLength(1)
    expect(mocks.eq).toHaveBeenCalledWith('operational_lane', 'current')
  })

  it('translates an edit patch to the canonical database field names', async () => {
    mocks.rpc.mockResolvedValue({ data: { changed: true, workItem: { ...row, title: 'Call later', version: 2 } }, error: null })
    await transitionWorkItem({
      key: row.work_item_key,
      actor: 'Casey',
      action: 'edit',
      idempotencyKey: 'edit-key-000001',
      expectedVersion: 1,
      patch: { title: 'Call later', dueAt: null, assignedTo: null },
    })

    expect(mocks.rpc).toHaveBeenCalledWith('transition_work_item_v1', expect.objectContaining({
      p_expected_version: 1,
      p_patch: { title: 'Call later', due_at: null, assigned_to: null },
    }))
  })

  it('sends one bulk RPC so a multi-task action shares one transaction', async () => {
    mocks.rpc.mockResolvedValue({ data: { changed: 1, workItems: [row] }, error: null })
    const result = await transitionWorkItemsBulk({
      keys: [row.work_item_key],
      actor: 'Casey',
      action: 'complete',
      idempotencyKey: 'bulk-key-000001',
    })

    expect(result.changed).toBe(1)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('transition_work_items_bulk_v1', expect.objectContaining({
      p_work_item_keys: [row.work_item_key],
    }))
  })

  it('fails closed when the projection is not installed', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function does not exist' } })

    await expect(createWorkItem({
      actor: 'Casey',
      idempotencyKey: 'create-key-0002',
      kind: 'task',
      title: 'Review file',
      assignedTo: 'Casey',
      department: 'acquisitions',
    })).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('surfaces the duplicate-primary invariant as an actionable conflict', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'primary_next_action_exists' },
    })

    await expect(createWorkItem({
      actor: 'Casey',
      idempotencyKey: 'create-key-0003',
      leadId: row.lead_id,
      kind: 'follow_up',
      title: 'Call seller again',
      assignedTo: 'Casey',
      department: 'acquisitions',
      primaryNextAction: true,
    })).rejects.toMatchObject({
      code: 'conflict',
      message: 'This opportunity already has a primary next action. Refresh and edit it instead.',
    })
  })

  it('fails closed before mutation when a historical item is not current work', async () => {
    mocks.laneLookup.mockResolvedValue({ data: [{ work_item_key: row.work_item_key, operational_lane: 'review' }], error: null })

    await expect(transitionWorkItem({
      key: row.work_item_key,
      actor: 'Casey',
      action: 'complete',
      idempotencyKey: 'test-value',
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
