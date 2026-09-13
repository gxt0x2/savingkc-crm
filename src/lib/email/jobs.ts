export interface EmailJob { id: string; state: 'ready' | 'leased' | 'retry' | 'done' | 'dead'; leaseToken?: string; leaseUntil?: Date; kind: string }
export function canClaim(job: EmailJob, now: Date) { return job.state === 'ready' || job.state === 'retry' || (job.state === 'leased' && !!job.leaseUntil && job.leaseUntil < now) }
export function leaseJob(job: EmailJob, token: string, now: Date, leaseMs = 90_000): EmailJob {
  if (!canClaim(job, now)) throw new Error('JOB_NOT_CLAIMABLE')
  return { ...job, state: 'leased', leaseToken: token, leaseUntil: new Date(now.getTime() + leaseMs) }
}
export function finishJob(job: EmailJob, token: string, state: 'done' | 'retry' | 'dead'): EmailJob {
  if (job.state !== 'leased' || job.leaseToken !== token) throw new Error('LEASE_FENCE_MISMATCH')
  return { ...job, state, leaseToken: undefined, leaseUntil: undefined }
}
