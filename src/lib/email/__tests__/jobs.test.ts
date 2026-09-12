import { describe, expect, it } from 'vitest'
import { finishJob, leaseJob } from '../jobs'
import { selectWorkerBatch } from '../worker'
const now = new Date('2026-09-12T12:00:00Z')
describe('email jobs', () => {
 it('fences completion to its lease holder', () => { const leased=leaseJob({id:'j',kind:'dispatch',state:'ready'},'a',now); expect(()=>finishJob(leased,'b','done')).toThrow('LEASE_FENCE_MISMATCH'); expect(finishJob(leased,'a','done').state).toBe('done') })
 it('prioritizes inbound work and stops claiming near the time budget', () => { const jobs=[{id:'d',kind:'dispatch',state:'ready' as const},{id:'i',kind:'ingest_event',state:'ready' as const}]; expect(selectWorkerBatch(jobs,now,45_000).map(x=>x.id)).toEqual(['i','d']); expect(selectWorkerBatch(jobs,now,9_000)).toEqual([]) })
})
