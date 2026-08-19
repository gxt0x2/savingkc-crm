import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureManifestExists: vi.fn(),
  updateManifestAndCascade: vi.fn(),
}))

vi.mock('@/lib/manifest-sync', () => ({
  ensureManifestExists: mocks.ensureManifestExists,
  updateManifestAndCascade: mocks.updateManifestAndCascade,
}))

import { syncLeadActivityMutation } from './lead-activity-sync'

describe('syncLeadActivityMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks the briefing stale and records an audit event', async () => {
    const manifest = {
      ariIntelligence: { briefingStale: false },
      auditTrail: [] as Array<Record<string, unknown>>,
    }
    mocks.ensureManifestExists.mockResolvedValue('manifest-1')
    mocks.updateManifestAndCascade.mockImplementation(async (_leadId, updater) => {
      updater(manifest)
      return true
    })

    await expect(syncLeadActivityMutation({
      leadId: 'lead-1',
      activityId: 'activity-1',
      activityType: 'task',
      mutation: 'deleted',
    })).resolves.toBe(true)

    expect(manifest.ariIntelligence.briefingStale).toBe(true)
    expect(manifest.auditTrail).toContainEqual(expect.objectContaining({
      agent: 'activity:task',
      action: 'activity_deleted',
      details: { activityId: 'activity-1', activityType: 'task' },
    }))
  })

  it('does not attempt a write when no manifest can be resolved', async () => {
    mocks.ensureManifestExists.mockResolvedValue(null)

    await expect(syncLeadActivityMutation({
      leadId: 'lead-1',
      activityId: 'activity-1',
      activityType: 'note',
      mutation: 'updated',
    })).resolves.toBe(false)

    expect(mocks.updateManifestAndCascade).not.toHaveBeenCalled()
  })
})
