import { describe, expect, it } from 'vitest'
import { mojoAlertDecision } from './mojo-alert-policy'
import type { MojoHealth } from './mojo-health'

function evidenceReview(): MojoHealth {
  return {
    status: 'attention', message: 'CRM reconciliation has 6 unresolved issues',
    sessionStatus: 'healthy', syncHealth: 'healthy', businessHours: true, lastSyncAgeMinutes: 12,
    runtime: { verified: true }, performance: { status: 'current' },
    queue: { failed24h: 0, deadLetter: 0 }, qualification: { recordingFailed7d: 0 },
    reconciliation: {
      message: 'CRM reconciliation has 6 unresolved issues', issueCount: 6,
      checkedAt: '2026-09-10T21:35:00Z', error: null,
      counts: { evidencePendingAllAges: 6, queueOverdue: 0, sourceBatchesUnaccepted: 0 },
    },
  } as MojoHealth
}

describe('Mojo SMS alert decision', () => {
  it('keeps the six known evidence holds visible without treating them as an outage', () => {
    const health = evidenceReview()
    expect(mojoAlertDecision(health).kind).toBe('evidence_review')
    expect(health.status).toBe('attention')
    expect(health.reconciliation.issueCount).toBe(6)
  })

  it.each(['clean', 'watch'] as const)('does not page for %s health', (status) => {
    expect(mojoAlertDecision({ ...evidenceReview(), status }).kind).toBe('none')
  })

  it.each(['expired', 'missing'])('still alerts for a %s session with historical holds', (sessionStatus) => {
    expect(mojoAlertDecision({ ...evidenceReview(), sessionStatus }).kind).toBe('operational_failure')
  })

  it('still alerts when intake is down', () => {
    expect(mojoAlertDecision({ ...evidenceReview(), syncHealth: 'down' }).kind).toBe('operational_failure')
  })

  it('still alerts on a runtime mismatch', () => {
    const health = evidenceReview()
    health.runtime!.verified = false
    expect(mojoAlertDecision(health).kind).toBe('operational_failure')
  })

  it.each(['stale', 'unavailable'] as const)('uses the actual %s KPI cause even when history masks the overall message', (status) => {
    const health = evidenceReview()
    health.performance = { ...health.performance, status, message: 'Provider totals cannot be refreshed' }
    expect(mojoAlertDecision(health)).toEqual({ kind: 'operational_failure', message: 'Provider totals cannot be refreshed', failureKey: 'performance' })
  })

  it('does not confuse a delayed snapshot with an outage', () => {
    const health = evidenceReview()
    health.performance.status = 'delayed'
    expect(mojoAlertDecision(health).kind).toBe('evidence_review')
  })

  it.each([null, 45])('does not let historical holds conceal stale intake (%s minutes)', (lastSyncAgeMinutes) => {
    const result = mojoAlertDecision({ ...evidenceReview(), lastSyncAgeMinutes })
    expect(result.kind).toBe('operational_failure')
    expect(result.message).not.toContain('6 unresolved')
  })

  it('does not count the overnight break as missed intake before the first morning run', () => {
    expect(mojoAlertDecision({ ...evidenceReview(), lastSyncAgeMinutes: 854, lastSyncCallingAgeMinutes: 5 }).kind).toBe('evidence_review')
  })

  it('does not expect intake while the calling schedule is closed', () => {
    expect(mojoAlertDecision({ ...evidenceReview(), businessHours: false, lastSyncAgeMinutes: 200 }).kind).toBe('evidence_review')
  })

  it('retains a provider failure message after hours even when performance status defaults to current', () => {
    expect(mojoAlertDecision({ ...evidenceReview(), businessHours: false, message: 'Provider refresh failed', failureKey: 'integrity' }))
      .toEqual({ kind: 'operational_failure', message: 'Provider refresh failed', failureKey: 'integrity' })
  })

  it('does not suppress failed recording or queue work', () => {
    const health = evidenceReview()
    health.qualification.recordingFailed7d = 1
    expect(mojoAlertDecision(health).kind).toBe('operational_failure')
  })

  it('does not suppress other reconciliation failures', () => {
    const health = evidenceReview()
    health.reconciliation.counts.queueOverdue = 1
    health.reconciliation.issueCount = 7
    expect(mojoAlertDecision(health).kind).toBe('operational_failure')
  })

  it('does not treat an unverified snapshot as evidence-only review', () => {
    const health = evidenceReview()
    health.reconciliation.error = 'Snapshot unavailable'
    expect(mojoAlertDecision(health).kind).toBe('operational_failure')
  })
})
