export function mojoSupervisorReceipt(result, health, completedAt = new Date().toISOString()) {
  const intakeSucceeded = result.code === 0
  const counts = health?.reconciliation?.counts || {}
  const operationalAttention = !health || !health.runtime?.verified
    || health.sessionStatus === 'expired' || health.syncHealth === 'down'
    || (health.businessHours && (health.lastSyncAgeMinutes == null || health.lastSyncAgeMinutes > 30))
    || counts.sourceBatchesUnaccepted > 0 || counts.queueOverdue > 0 || counts.deadLetterQueue > 0
    || counts.unlinkedFutureFollowups > 0
  return {
    status: !intakeSucceeded ? 'failed' : operationalAttention ? 'attention' : health.status === 'attention' ? 'completed_with_review' : 'healthy',
    intakeSucceeded, completedAt, exitCode: result.code, timedOut: result.timedOut,
    lastSyncAt: health?.lastSyncAt || null, queue: health?.queue || null,
    healthVerified: Boolean(health), operationalAttention,
    performance: health?.performance || null, reconciliation: health?.reconciliation || null,
  }
}
