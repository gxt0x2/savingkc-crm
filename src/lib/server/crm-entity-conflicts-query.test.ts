import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  conflictResult: { data: [] as Array<Record<string, unknown>>, error: null as { message: string } | null },
  peopleResult: { data: [] as Array<Record<string, unknown>>, error: null as { message: string } | null },
  leadResult: { data: [] as Array<Record<string, unknown>>, error: null as { message: string } | null },
  order: vi.fn(),
  limit: vi.fn(),
  or: vi.fn(),
  peopleIn: vi.fn(),
  leadsIn: vi.fn(),
}))

function thenableConflictQuery() {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: mocks.order,
    limit: mocks.limit,
    or: mocks.or,
    then: (resolve: (value: typeof mocks.conflictResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(mocks.conflictResult).then(resolve, reject),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  mocks.order.mockReturnValue(query)
  mocks.limit.mockReturnValue(query)
  mocks.or.mockReturnValue(query)
  return query
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    const conflicts = thenableConflictQuery()
    return {
      from: (table: string) => {
        if (table === 'crm_identity_conflicts') return conflicts
        if (table === 'crm_people') {
          return { select: () => ({ in: mocks.peopleIn.mockImplementation(async () => mocks.peopleResult) }) }
        }
        if (table === 'leads') {
          return { select: () => ({ in: mocks.leadsIn.mockImplementation(async () => mocks.leadResult) }) }
        }
        throw new Error(`Unexpected table ${table}`)
      },
    }
  },
}))

import { readCrmEntityConflictsPage } from './crm-entity-conflicts'

describe('CRM entity conflict database query', () => {
  beforeEach(() => {
    mocks.order.mockReset()
    mocks.limit.mockReset()
    mocks.or.mockReset()
    mocks.peopleIn.mockReset()
    mocks.leadsIn.mockReset()
    mocks.conflictResult = { data: [], error: null }
    mocks.peopleResult = { data: [], error: null }
    mocks.leadResult = { data: [], error: null }
  })

  it('uses a limit-plus-one keyset page and bounded hydration queries', async () => {
    mocks.conflictResult.data = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        lead_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        conflict_type: 'method_claimed_elsewhere',
        selected_person_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        conflicting_person_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        method_type: 'phone',
        normalized_value: '+18165550123',
        status: 'open',
        detected_at: '2026-08-21T12:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000000',
        lead_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        conflict_type: 'phone_email_disagree',
        selected_person_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        conflicting_person_id: null,
        method_type: null,
        normalized_value: null,
        status: 'open',
        detected_at: '2026-08-20T12:00:00.000Z',
      },
    ]
    mocks.peopleResult.data = [
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', display_name: 'Seller One' },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', display_name: 'Seller Two' },
    ]
    mocks.leadResult.data = [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      full_name: 'Seller One',
      property_address: '123 Main',
      station: 'new',
      assigned_agent: 'Ernest',
    }]

    const page = await readCrmEntityConflictsPage({ limit: 1 })

    expect(mocks.order).toHaveBeenNthCalledWith(1, 'detected_at', { ascending: false })
    expect(mocks.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false })
    expect(mocks.limit).toHaveBeenCalledWith(2)
    expect(mocks.peopleIn).toHaveBeenCalledWith('id', [
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ])
    expect(mocks.leadsIn).toHaveBeenCalledWith('id', ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'])
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ maskedValue: '•••0123', selectedPerson: { displayName: 'Seller One' } })
    expect(page.pageInfo.hasMore).toBe(true)
    expect(page.pageInfo.nextCursor).toBeTruthy()
  })

  it('applies the validated keyset cursor before reading a later page', async () => {
    const cursor = Buffer.from(JSON.stringify({
      detectedAt: '2026-08-21T12:00:00.000Z',
      id: '11111111-1111-4111-8111-111111111111',
    })).toString('base64url')

    await readCrmEntityConflictsPage({ cursor })
    expect(mocks.or).toHaveBeenCalledWith(
      'detected_at.lt.2026-08-21T12:00:00.000Z,and(detected_at.eq.2026-08-21T12:00:00.000Z,id.lt.11111111-1111-4111-8111-111111111111)',
    )
  })
})
