import type { MojoAlertDecision } from './mojo-alert-policy'
import { mojoSchedule } from './mojo-schedule.mjs'

export type MojoRecoveryRun = {
  id: string; runtime_digest: string; started_at: string; updated_at: string
  completed_at: string | null; status: 'running' | 'recovered' | 'exhausted'
  attempt_count: number; failure_key: string | null; failure_message: string | null
  last_sync_at: string | null; attempts: unknown[]
}
export type MojoRecoveryIncident = {
  id: string; first_seen_at: string; failure_key: string; failure_message: string
  alert_claimed_at: string | null; sms_status: string | null
}
export type MojoRecoveryDecision = {
  state: 'healthy' | 'scheduled' | 'recovering' | 'action_required'
  escalate: boolean; message: string; action: string | null
}

const ACTIONS: Record<string, string> = {
  session: 'Sign in to Mojo on the collector Mac if login or MFA is requested. Ingestion will retry automatically.',
  runtime: 'Restore the verified Mojo collector release on the Mac.',
  intake: 'Technical repair is needed for source intake. Do not reimport seller records manually.',
  performance: 'Technical repair is needed for the Mojo totals connection. Ingestion continues to retry.',
  queue: 'Review the failed item evidence before changing records. Automatic retries are exhausted.',
  integrity: 'Review the conflicting source evidence; automatic business-data changes are blocked.',
  verification: 'Restore CRM health verification so recovery can be confirmed.',
}

/** The hosted monitor waits for the Mac, but can still detect a dead collector. */
export function mojoRecoveryDecision(alert: MojoAlertDecision, run: MojoRecoveryRun | null,
  incident: MojoRecoveryIncident | null, expectedDigest: string, now = new Date()): MojoRecoveryDecision {
  if (alert.kind !== 'operational_failure') return { state: 'healthy', escalate: false,
    message: 'Automatic intake is operating; evidence review remains separate.', action: null }
  const schedule = mojoSchedule(now)
  if (!schedule.businessHours) return { state: 'scheduled', escalate: false,
    message: 'Recovery resumes in the next calling window.', action: null }
  const runAge = run ? (now.getTime() - Date.parse(run.started_at)) / 60_000 : Infinity
  const sameWindow = run && mojoSchedule(new Date(run.started_at)).date === schedule.date
    && run.runtime_digest === expectedDigest && runAge >= 0
  const exhausted = sameWindow && run.status === 'exhausted' && run.attempt_count === 3
    && run.failure_key === alert.failureKey && runAge <= 30
    && (!incident || Date.parse(run.completed_at || run.updated_at || run.started_at) >= Date.parse(incident.first_seen_at))
  const waitingMinutes = incident ? Math.max(0, Math.min(schedule.minutesSinceOpen,
    (now.getTime() - Date.parse(incident.first_seen_at)) / 60_000)) : 0
  if (sameWindow && run.status === 'running' && runAge < 20 && waitingMinutes < 30) {
    return { state: 'recovering', escalate: false, message: 'The Mac is attempting and verifying automatic recovery.', action: null }
  }
  if (exhausted) return { state: 'action_required', escalate: true,
    message: `Three automatic recovery attempts failed. ${alert.message}`,
    action: ACTIONS[alert.failureKey || 'verification'] }
  if (schedule.withinStartupGrace) return { state: 'scheduled', escalate: false,
    message: 'Waiting for the first scheduled run and verification by 8:30 AM Central.', action: null }
  if (waitingMinutes < 30) return { state: 'recovering', escalate: false,
    message: 'Waiting for the next scheduled recovery cycle; escalation is limited to unresolved failures.', action: null }
  const workerMissing = !sameWindow || runAge >= 30
  return { state: 'action_required', escalate: true,
    message: workerMissing ? 'The Mac has not provided a recovery receipt within 30 minutes of a detected failure.'
      : `Automatic recovery has not resolved this failure within 30 minutes. ${alert.message}`,
    action: workerMissing ? 'Check that the collector Mac is powered on and connected to the internet; restore its collector if needed.'
      : ACTIONS[alert.failureKey || 'verification'] }
}
