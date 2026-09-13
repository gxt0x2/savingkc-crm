import type { EmailJob } from './jobs'
export function selectWorkerBatch(jobs: EmailJob[], now: Date, remainingMs: number) {
  if (remainingMs < 10_000) return []
  const priority = ['ingest_event', 'classify_reply', 'dispatch']
  return jobs.filter((job) => job.state === 'ready' || job.state === 'retry' || (job.state === 'leased' && !!job.leaseUntil && job.leaseUntil < now)).sort((a,b) => priority.indexOf(a.kind) - priority.indexOf(b.kind)).slice(0, 20)
}
