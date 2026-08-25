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
    limit() { return builder },
    async maybeSingle() {
      const metadata = filters.metadata as Record<string, unknown>
      const row = mocks.rows.find((item) => (
        item.lead_id === filters.lead_id
        && item.activity_type === filters.activity_type
        && Object.entries(metadata).every(([key, value]) => item.metadata[key] === value)
      ))
      return { data: row ? { id: row.id } : null, error: null }
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
          return { select() { return { async maybeSingle() { return { data: { id: row.id }, error: null } } } } }
        },
      }
    },
  },
}))

import { insertCallLogEvidenceOnce } from './call-log-evidence'

describe('call log evidence idempotency', () => {
  beforeEach(() => { mocks.rows.length = 0 })

  it('stores started and ended telemetry once per durable attempt', async () => {
    const base = {
      leadId: 'lead-1',
      source: 'telephony_bar' as const,
      clientAttemptId: 'attempt-1',
    }
    const started = {
      ...base,
      event: 'call_started' as const,
      payload: {
        lead_id: 'lead-1', activity_type: 'call',
        metadata: { source: 'telephony_bar', action: 'call_started', client_attempt_id: 'attempt-1' },
      },
    }
    const ended = {
      ...base,
      event: 'call_ended' as const,
      payload: {
        lead_id: 'lead-1', activity_type: 'call',
        metadata: { source: 'telephony_bar', action: 'call_ended', client_attempt_id: 'attempt-1' },
      },
    }
    const dispositioned = {
      ...base,
      event: 'call_disposition' as const,
      payload: {
        lead_id: 'lead-1', activity_type: 'call',
        metadata: { source: 'telephony_bar', action: 'call_disposition', client_attempt_id: 'attempt-1' },
      },
    }

    expect(await insertCallLogEvidenceOnce(started)).toEqual({ id: 'activity-1', created: true })
    expect(await insertCallLogEvidenceOnce(started)).toEqual({ id: 'activity-1', created: false })
    expect(await insertCallLogEvidenceOnce(ended)).toEqual({ id: 'activity-2', created: true })
    expect(await insertCallLogEvidenceOnce(ended)).toEqual({ id: 'activity-2', created: false })
    expect(await insertCallLogEvidenceOnce(dispositioned)).toEqual({ id: 'activity-3', created: true })
    expect(await insertCallLogEvidenceOnce(dispositioned)).toEqual({ id: 'activity-3', created: false })
    expect(mocks.rows).toHaveLength(3)
  })
})
