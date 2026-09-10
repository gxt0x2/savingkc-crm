import type { MojoHealth } from './mojo-health'

export type MojoAlertDecision = {
  kind: 'none' | 'evidence_review' | 'operational_failure'
  message: string
}

/** Evidence review stays visible in health without paging the owner as an outage. */
export function mojoAlertDecision(health: MojoHealth): MojoAlertDecision {
  const failure = (message: string): MojoAlertDecision => ({ kind: 'operational_failure', message })
  if (health.status !== 'attention') return { kind: 'none', message: health.message }
  if (['expired', 'missing'].includes(health.sessionStatus.toLowerCase())) {
    return failure(health.lastError || 'Mojo session needs to be renewed')
  }
  if (health.syncHealth.toLowerCase() === 'down') {
    return failure(health.lastError || 'Mojo source intake has stopped completing')
  }
  if (!health.runtime?.verified) return failure('The Mojo collector does not match the verified release')
  if (['stale', 'unavailable'].includes(health.performance.status)) return failure(health.performance.message)
  if (health.businessHours && (health.lastSyncAgeMinutes === null || health.lastSyncAgeMinutes > 30)) {
    return failure(health.lastSyncAgeMinutes === null
      ? 'Mojo source intake has no successful completion during calling hours'
      : `Mojo source intake has not completed for ${health.lastSyncAgeMinutes} minutes during calling hours`)
  }
  if (health.queue.failed24h > 0 || health.queue.deadLetter > 0 || health.qualification.recordingFailed7d > 0) {
    return failure('Mojo has failed queue or recording work that needs technical review')
  }
  const counts = health.reconciliation.counts
  const onlyEvidenceHolds = counts.evidencePendingAllAges > 0
    && health.reconciliation.issueCount === counts.evidencePendingAllAges
    && Object.entries(counts).every(([key, value]) => key === 'evidencePendingAllAges' || value === 0)
  if (onlyEvidenceHolds && health.message === health.reconciliation.message
    && health.reconciliation.checkedAt && !health.reconciliation.error
    && health.sessionStatus.toLowerCase() === 'healthy' && health.syncHealth.toLowerCase() === 'healthy'
    && ['current', 'delayed'].includes(health.performance.status)) {
    return { kind: 'evidence_review', message: health.reconciliation.message }
  }
  return failure(health.message)
}
