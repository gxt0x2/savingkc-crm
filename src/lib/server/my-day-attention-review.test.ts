import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }))

import { recordMyDayMojoReview } from './my-day-attention-review'

function eventLookup(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in']) chain[method] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => ({ data, error }))
  return chain
}

describe('My Day Mojo review persistence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes one deterministic review event against the linked CRM lead', async () => {
    const lookup = eventLookup({
      id: 'event-1',
      record_id: 'mojo-record',
      lead_id: 'lead-1',
      disposition_raw: 'Callback Requested',
      outcome: 'callback_scheduled',
    })
    const insert = vi.fn().mockResolvedValue({ error: null })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'crm_mojo_call_events') return lookup
      if (table === 'lead_activities') return { insert }
      throw new Error(`Unexpected table ${table}`)
    })

    await expect(recordMyDayMojoReview({
      recordId: 'mojo-record',
      reviewedBy: 'casey@savingkc.com',
    })).resolves.toMatchObject({ recordId: 'mojo-record' })

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      lead_id: 'lead-1',
      activity_type: 'mojo_review',
      agent: 'casey@savingkc.com',
      metadata: expect.objectContaining({ record_id: 'mojo-record', event_id: 'event-1' }),
    }))
  })

  it('treats a retry of the same review as a successful idempotent acknowledgement', async () => {
    mocks.from
      .mockReturnValueOnce(eventLookup({
        id: 'event-1', record_id: 'mojo-record', lead_id: 'lead-1', disposition_raw: 'Callback Requested', outcome: 'callback_scheduled',
      }))
      .mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } }) })

    await expect(recordMyDayMojoReview({
      recordId: 'mojo-record',
      reviewedBy: 'casey@savingkc.com',
    })).resolves.toMatchObject({ recordId: 'mojo-record' })
  })

  it('refuses to acknowledge a record that is not a linked reviewable Casey event', async () => {
    mocks.from.mockReturnValue(eventLookup(null))

    await expect(recordMyDayMojoReview({
      recordId: 'unknown',
      reviewedBy: 'casey@savingkc.com',
    })).resolves.toBeNull()
    expect(mocks.from).toHaveBeenCalledTimes(1)
  })
})
