import type { MojoHealth } from './mojo-health'

export type MojoAlertDecision = {
  kind: 'none' | 'evidence_review' | 'operational_failure'
  message: string
  failureKey?: 'session' | 'runtime' | 'intake' | 'performance' | 'queue' | 'integrity' | 'verification'
}

/** Evidence review stays visible in health without paging the owner as an outage. */
export function mojoAlertDecision(health: MojoHealth): MojoAlertDecision {
  const failure = (message: string, failureKey: MojoAlertDecision['failureKey']): MojoAlertDecision => ({ kind: 'operational_failure', message, failureKey })
  if (health.reconciliation.error) return failure('Mojo health could not be independently verified', 'verification')
  if (['expired', 'missing'].includes(health.sessionStatus.toLowerCase())) {
    return failure(health.lastError || 'Mojo session needs to be renewed', 'session')
  }
  if (health.syncHealth.toLowerCase() === 'down') {
    return failure(health.lastError || 'Mojo source intake has stopped completing', 'intake')
  }
  if (!health.runtime?.verified) return failure('The Mojo collector does not match the verified release', 'runtime')
  if (['stale', 'unavailable'].includes(health.performance.status)) return failure(health.performance.message, 'performance')
  const callingAge = health.lastSyncCallingAgeMinutes ?? health.lastSyncAgeMinutes
  if (health.businessHours && (callingAge === null || callingAge >= 30)) {
    return failure('Mojo source intake has missed its scheduled completion in the current calling window', 'intake')
  }
  if (health.queue.failed24h > 0 || health.queue.deadLetter > 0 || health.qualification.recordingFailed7d > 0) {
    return failure('Mojo has failed queue or recording work that needs technical review', 'queue')
  }
  if (health.status !== 'attention') return { kind: 'none', message: health.message }
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
  return failure(health.message, 'integrity')
}
