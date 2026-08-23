import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activities: [] as Array<{ id: string; lead_id: string; activity_type: string; metadata: Record<string, unknown> }>,
  manifest: {
    communications: { transcripts: [] as unknown[] },
    pipeline: {},
    flags: {},
    ariIntelligence: {} as { recommendedActions?: unknown[] },
    auditTrail: [] as Array<{ details?: Record<string, unknown> }>,
  },
  upsertAppointment: vi.fn(),
  autoAdvance: vi.fn(),
  queueConversion: vi.fn(),
  regenerate: vi.fn(),
}))

function activityLookup() {
  const filters: Record<string, unknown> = {}
  const builder = {
    eq(field: string, value: unknown) {
      filters[field] = value
      return builder
    },
    contains(_field: string, value: Record<string, unknown>) {
      filters.metadata = value
      return builder
    },
    order() { return builder },
    limit() { return builder },
    async maybeSingle() {
      const metadata = filters.metadata as Record<string, unknown>
      const row = mocks.activities.find((item) => (
        item.lead_id === filters.lead_id
        && item.activity_type === filters.activity_type
        && Object.entries(metadata).every(([key, value]) => item.metadata[key] === value)
      ))
      return { data: row ? { id: row.id, metadata: row.metadata } : null, error: null }
    },
  }
  return builder
}

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from(table: string) {
      if (table === 'lead_activities') {
        return {
          select() { return activityLookup() },
          insert(payload: { lead_id: string; activity_type: string; metadata: Record<string, unknown> }) {
            const row = { id: `activity-${mocks.activities.length + 1}`, ...payload }
            mocks.activities.push(row)
            return {
              select() {
                return { async maybeSingle() { return { data: { id: row.id }, error: null } } }
              },
            }
          },
        }
      }
      if (table === 'leads') {
        return { update() { return { async eq() { return { error: null } } } } }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  },
}))
vi.mock('@/lib/appointments', () => ({ upsertAppointmentFromCall: mocks.upsertAppointment }))
vi.mock('@/lib/pipeline-auto-advance', () => ({ checkAutoAdvance: mocks.autoAdvance }))
vi.mock('@/lib/ppc/appointment-booked-conversion', () => ({
  queuePpcAppointmentBookedConversion: mocks.queueConversion,
}))
vi.mock('@/lib/briefing-regen', () => ({ EAGER_REGEN_EVENTS: new Set<string>(), regenerateBriefing: mocks.regenerate }))
vi.mock('@/lib/manifest-sync', () => ({
  ensureManifestExists: vi.fn(),
  updateManifestAndCascade: vi.fn(async (_leadId: string, updater: (value: unknown) => void) => {
    updater(mocks.manifest)
    return true
  }),
}))

import { recordLeadDisposition } from './lead-disposition-command'

describe('lead disposition evidence idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activities.length = 0
    mocks.manifest.communications = { transcripts: [] }
    mocks.manifest.pipeline = {}
    mocks.manifest.flags = {}
    mocks.manifest.ariIntelligence = {}
    mocks.manifest.auditTrail = []
    mocks.autoAdvance.mockResolvedValue(undefined)
    mocks.queueConversion.mockResolvedValue({ queued: true, reason: 'queued' })
  })

  it('reuses call evidence and manifest append-only entries on a retry', async () => {
    const command = {
      disposition: 'callback_requested' as const,
      notes: 'Call Friday',
      phone: '+18165550100',
      appointmentAt: null,
      clientAttemptId: 'attempt-123',
    }

    const first = await recordLeadDisposition('lead-1', 'Ernest Dodson', command)
    const retry = await recordLeadDisposition('lead-1', 'Ernest Dodson', command)

    expect(first.activityId).toBe('activity-1')
    expect(retry.activityId).toBe('activity-1')
    expect(mocks.activities).toHaveLength(1)
    expect(mocks.activities[0].metadata).toMatchObject({ client_attempt_id: 'attempt-123' })
    expect(mocks.manifest.auditTrail).toHaveLength(1)
    expect(mocks.manifest.ariIntelligence.recommendedActions).toHaveLength(1)
  })

  it('reuses appointment and call activities for the same dialer attempt', async () => {
    mocks.upsertAppointment.mockResolvedValue({
      id: 'appointment-1',
      scheduled_at: '2026-08-24T15:00:00.000Z',
      type: 'phone_call',
    })
    const command = {
      disposition: 'appointment_set' as const,
      notes: 'Meet at the property',
      phone: '+18165550100',
      appointmentAt: '2026-08-24T15:00:00.000Z',
      clientAttemptId: 'attempt-appointment',
    }

    const first = await recordLeadDisposition('lead-1', 'Ernest Dodson', command)
    const retry = await recordLeadDisposition('lead-1', 'Ernest Dodson', command)

    expect(first).toMatchObject({ activityId: 'activity-2', appointmentId: 'appointment-1' })
    expect(retry).toMatchObject({ activityId: 'activity-2', appointmentId: 'appointment-1' })
    expect(mocks.activities.map((row) => row.activity_type)).toEqual(['appointment', 'call'])
    expect(mocks.activities.every((row) => row.metadata.client_attempt_id === 'attempt-appointment')).toBe(true)
    expect(mocks.manifest.auditTrail).toHaveLength(1)
  })

  it('refuses to rewrite an attempt with a conflicting outcome', async () => {
    const first = {
      disposition: 'no_answer' as const,
      notes: null,
      phone: '+18165550100',
      appointmentAt: null,
      clientAttemptId: 'attempt-conflict',
    }
    await recordLeadDisposition('lead-1', 'Ernest Dodson', first)

    await expect(recordLeadDisposition('lead-1', 'Ernest Dodson', {
      ...first,
      disposition: 'callback_requested',
    })).rejects.toThrow('already saved with a different outcome')
    expect(mocks.activities).toHaveLength(1)
  })
})
