import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import {
  claimPlayableRecordingActivity,
  markRecordingProcessing,
} from './recording-processing-claim'

function activityChain({
  existing = null,
  insertError = null,
}: {
  existing?: unknown
  insertError?: unknown
} = {}) {
  const updates: unknown[] = []
  const inserts: unknown[] = []
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.contains = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => ({ data: existing, error: null }))
  chain.insert = vi.fn(async (payload: unknown) => {
    inserts.push(payload)
    return { error: insertError }
  })
  chain.update = vi.fn((payload: unknown) => {
    updates.push(payload)
    return chain
  })
  return { chain, inserts, updates }
}

function claimInput() {
  return {
    leadId: 'lead-1',
    recordingSid: 'RE11111111111111111111111111111111',
    recordingUrl: 'https://api.twilio.com/recordings/RE11111111111111111111111111111111',
    callSid: 'CA11111111111111111111111111111111',
    duration: 60,
    recordingStatus: 'completed',
    from: '+19135550123',
    to: '+18163077835',
  }
}

describe('recording processing claims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not reclaim a recording that already completed', async () => {
    const db = activityChain({
      existing: {
        id: 'activity-1',
        metadata: {
          recordingSid: claimInput().recordingSid,
          recordingProcessingState: 'completed',
        },
      },
    })
    mocks.from.mockReturnValue(db.chain)

    const claim = await claimPlayableRecordingActivity(claimInput())

    expect(claim).toMatchObject({
      activityId: 'activity-1',
      shouldProcess: false,
      skipped: 'duplicate_completed',
    })
    expect(db.inserts).toHaveLength(0)
    expect(db.updates).toHaveLength(0)
  })

  it('does not race a fresh in-progress processing lease', async () => {
    const db = activityChain({
      existing: {
        id: 'activity-1',
        metadata: {
          recordingSid: claimInput().recordingSid,
          recordingProcessingState: 'processing',
          recordingProcessingStartedAt: new Date().toISOString(),
        },
      },
    })
    mocks.from.mockReturnValue(db.chain)

    const claim = await claimPlayableRecordingActivity(claimInput())

    expect(claim).toMatchObject({
      shouldProcess: false,
      skipped: 'duplicate_in_progress',
    })
    expect(db.updates).toHaveLength(0)
  })

  it('uses the deterministic primary key to contain a concurrent insert race', async () => {
    const db = activityChain({ insertError: { code: '23505' } })
    mocks.from.mockReturnValue(db.chain)

    const claim = await claimPlayableRecordingActivity(claimInput())

    expect(claim).toMatchObject({
      shouldProcess: false,
      skipped: 'duplicate_in_progress',
    })
    expect(claim.activityId).toMatch(/^[0-9a-f-]{36}$/)
    expect(db.inserts).toHaveLength(1)
  })

  it('persists completion on the claimed activity', async () => {
    const db = activityChain()
    mocks.from.mockReturnValue(db.chain)
    const claim = await claimPlayableRecordingActivity(claimInput())

    await markRecordingProcessing(claim, 'completed')

    expect(claim.shouldProcess).toBe(true)
    expect(db.updates).toContainEqual({
      metadata: expect.objectContaining({
        recordingProcessingState: 'completed',
        recordingProcessingCompletedAt: expect.any(String),
      }),
    })
  })
})
