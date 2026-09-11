import { describe, expect, it } from 'vitest'
import { mojoCallingAge, mojoSchedule } from './mojo-schedule.mjs'
import { mojoRecoveryDecision, type MojoRecoveryRun, type MojoRecoveryIncident } from './mojo-recovery-policy'
const failure = { kind: 'operational_failure' as const, message: 'Session renewal failed', failureKey: 'session' as const }
const incident = { id: 'i', first_seen_at: '2026-09-11T14:00:00Z' } as MojoRecoveryIncident
const run = { id: 'r', started_at: '2026-09-11T14:05:00Z', status: 'running', runtime_digest: 'verified', attempt_count: 1, failure_key: 'session', completed_at: '2026-09-11T14:15:00Z' } as MojoRecoveryRun
const decide = (at: string, latest: MojoRecoveryRun | null = run, observed: MojoRecoveryIncident | null = incident) => mojoRecoveryDecision(failure, latest, observed, 'verified', new Date(at))
describe('Mojo recovery before escalation', () => {
  it('gives the 8:05 watchdog a startup window before the 8:07 collector', () => {
    expect(decide('2026-09-11T13:05:00Z', null, null)).toMatchObject({ state: 'scheduled', escalate: false })
    expect(mojoCallingAge('2026-09-10T22:51:00Z', new Date('2026-09-11T13:05:00Z'))).toBe(5)
  })
  it('shares weekends, the confirmed holiday and DST between Mac and server', () => {
    for (const at of ['2026-09-12T15:00:00Z','2026-09-07T15:00:00Z','2026-09-11T23:00:00Z']) {
      expect(mojoSchedule(new Date(at)).businessHours).toBe(false)
      expect(decide(at, null, null).escalate).toBe(false)
    }
    expect(mojoSchedule(new Date('2026-11-02T14:05:00Z'))).toMatchObject({ businessHours: true, minutesSinceOpen: 5 })
    expect(mojoSchedule(new Date('2026-03-09T13:05:00Z'))).toMatchObject({ businessHours: true, minutesSinceOpen: 5 })
  })
  it('does not escalate an active recovery or an initial unverified symptom', () => {
    expect(decide('2026-09-11T14:10:00Z').escalate).toBe(false)
    expect(decide('2026-09-11T14:10:00Z', null, null).escalate).toBe(false)
  })
  it('escalates a verified three-attempt failure with a concrete action', () => {
    expect(decide('2026-09-11T14:15:00Z', { ...run, status: 'exhausted', attempt_count: 3 })).toMatchObject({ state: 'action_required', escalate: true, action: expect.stringContaining('Sign in') })
  })
  it('does not treat yesterday, another runtime or a different failure as exhausted recovery', () => {
    for (const change of [{ started_at: '2026-09-10T14:05:00Z' }, { runtime_digest: 'retired' }, { failure_key: 'queue' }]) {
      expect(decide('2026-09-11T14:15:00Z', { ...run, status: 'exhausted', attempt_count: 3, ...change }).escalate).toBe(false)
    }
  })
  it('escalates a dead worker or an abandoned running receipt after the deadline', () => {
    for (const latest of [null, run]) expect(decide('2026-09-11T14:40:00Z', latest)).toMatchObject({ escalate: true, action: expect.stringContaining('powered on') })
  })
  it('cannot hide an unresolved incident by continually starting a new run', () => {
    expect(decide('2026-09-11T14:40:00Z', { ...run, started_at: '2026-09-11T14:35:00Z' }).escalate).toBe(true)
  })
  it('never escalates evidence holds alone', () => {
    expect(mojoRecoveryDecision({ kind: 'evidence_review', message: '6 holds' }, run, incident, 'verified').escalate).toBe(false)
  })
})
