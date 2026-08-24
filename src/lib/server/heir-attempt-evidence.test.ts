import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; lead_id: string | null; activity_type: string; metadata: Record<string, unknown> }>,
}))

function lookup() {
  const filters: Record<string, unknown> = {}
  const builder = {
    eq(field: string, value: unknown) { filters[field] = value; return builder },
    is(field: string, value: unknown) { filters[field] = value; return builder },
    contains(_field: string, value: Record<string, unknown>) { filters.metadata = value; return builder },
    order() { return builder },
    limit() { return builder },
    async maybeSingle() {
      const metadata = filters.metadata as Record<string, unknown>
      const row = mocks.rows.find((item) => (
        item.lead_id === filters.lead_id
        && item.activity_type === filters.activity_type
        && Object.entries(metadata).every(([key, value]) => item.metadata[key] === value)
      ))
      return { data: row ?? null, error: null }
    },
  }
  return builder
}

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from() {
      return {
        select() { return lookup() },
        insert(payload: { lead_id: string | null; activity_type: string; metadata: Record<string, unknown> }) {
          const row = { id: `activity-${mocks.rows.length + 1}`, ...payload }
          mocks.rows.push(row)
          return {
            select() {
              return { async maybeSingle() { return { data: row, error: null } } }
            },
          }
        },
      }
    },
  },
}))

import { insertHeirAttemptEvidenceOnce } from './heir-attempt-evidence'

describe('heir attempt evidence idempotency', () => {
  beforeEach(() => { mocks.rows.length = 0 })

  it('reuses the canonical activity for the same attempt and evidence kind', async () => {
    const input = {
      leadId: 'lead-1',
      activityType: 'call' as const,
      clientAttemptId: 'attempt-1',
      payload: {
        lead_id: 'lead-1',
        activity_type: 'call',
        agent: 'Casey',
        metadata: {
          source: 'heir_dialer',
          client_attempt_id: 'attempt-1',
          disposition: 'no_answer',
        },
      },
    }

    const first = await insertHeirAttemptEvidenceOnce(input)
    const retry = await insertHeirAttemptEvidenceOnce(input)

    expect(first.id).toBe('activity-1')
    expect(retry.id).toBe('activity-1')
    expect(mocks.rows).toHaveLength(1)
  })

  it('deduplicates source-prospect evidence without a shadow Lead', async () => {
    const input = {
      leadId: null,
      prospectId: 'prospect-1',
      activityType: 'call' as const,
      clientAttemptId: 'attempt-source-1',
      payload: {
        lead_id: null,
        activity_type: 'call',
        metadata: {
          source: 'heir_dialer',
          client_attempt_id: 'attempt-source-1',
          prospect_id: 'prospect-1',
        },
      },
    }

    const first = await insertHeirAttemptEvidenceOnce(input)
    const retry = await insertHeirAttemptEvidenceOnce(input)

    expect(first.id).toBe('activity-1')
    expect(retry.id).toBe('activity-1')
    expect(mocks.rows).toHaveLength(1)
    expect(mocks.rows[0]).toMatchObject({ lead_id: null, metadata: { prospect_id: 'prospect-1' } })
  })

  it('keeps separate governed status evidence within one attempt', async () => {
    const base = {
      leadId: 'lead-1',
      activityType: 'status_change' as const,
      clientAttemptId: 'attempt-1',
    }
    await insertHeirAttemptEvidenceOnce({
      ...base,
      action: 'mark_dead',
      payload: {
        lead_id: 'lead-1',
        activity_type: 'status_change',
        metadata: { source: 'heir_dialer', client_attempt_id: 'attempt-1', action: 'mark_dead' },
      },
    })
    await insertHeirAttemptEvidenceOnce({
      ...base,
      action: 'mark_as_lead',
      payload: {
        lead_id: 'lead-1',
        activity_type: 'status_change',
        metadata: { source: 'heir_dialer', client_attempt_id: 'attempt-1', action: 'mark_as_lead' },
      },
    })

    expect(mocks.rows).toHaveLength(2)
  })
})
