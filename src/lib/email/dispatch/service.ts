import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import { z } from 'zod'
import { ownerWorkspace } from '../connections/access'
import { check, workflowHash, type Tx } from '../workflow/core'

export function liveDispatchBlockReason(input?: {
  enabledEnv?: string | undefined
  sendEnabled?: boolean
  evidenceEnv?: string | undefined
}) {
  if (input?.enabledEnv !== 'true') return 'LIVE_DISPATCH_DISABLED'
  if (!input.sendEnabled) return 'WORKSPACE_PAUSED'
  if (input.evidenceEnv !== 'true') return 'CONTROLLED_PROVIDER_EVIDENCE_REQUIRED'
  return 'CONTROLLED_PROVIDER_EVIDENCE_REQUIRED'
}

const enqueueSchema = z
  .object({
    intentId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    idempotencyKey: z.string().uuid(),
  })
  .strict()

export async function enqueueRemoteDispatch(
  sql: Sql,
  subject: string,
  raw: unknown,
  now = new Date(),
) {
  const parsed = enqueueSchema.safeParse(raw)
  check(parsed.success, 'INVALID_DISPATCH', 400)
  const input = parsed.data
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject)
    const hash = workflowHash(input)
    const [prior] =
      await tx`select payload_hash,result from em_command_receipts where workspace_id=${ws.id} and actor_id=${subject} and idempotency_key=${input.idempotencyKey}`
    if (prior) {
      check(prior.payload_hash === hash, 'IDEMPOTENCY_MISMATCH')
      return prior.result as { entityId: string; state: string }
    }
    check(ws.revision === input.expectedRevision, 'REVISION_CONFLICT')
    const [intent] =
      await tx`select id,state from em_send_intents where workspace_id=${ws.id} and id=${input.intentId} for update`
    check(intent, 'INTENT_NOT_FOUND', 404)
    check(
      ['queued', 'held', 'uncertain'].includes(intent.state),
      'INTENT_NOT_DISPATCHABLE',
    )
    const [job] =
      await tx`insert into em_jobs(workspace_id,kind,dedupe_key,entity_id,state,run_after)
        values(${ws.id},'dispatch',${`dispatch:${intent.id}`},${intent.id},'ready',${now})
        on conflict (workspace_id,kind,dedupe_key) do update set run_after=excluded.run_after
        where em_jobs.state in ('ready','retry','dead')
        returning id,state`
    check(job, 'DISPATCH_ALREADY_CLAIMED')
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
      values(${ws.id},${subject},'OPS-DISPATCH-ENQUEUE',${intent.id},${input.idempotencyKey},${tx.json({
        jobId: job.id,
        live: false,
      })},${now})`
    const result = { entityId: job.id as string, state: 'dispatch_queued' }
    await tx`insert into em_command_receipts(workspace_id,actor_id,idempotency_key,command,payload_hash,result)
      values(${ws.id},${subject},${input.idempotencyKey},'OPS-DISPATCH-ENQUEUE',${hash},${tx.json(result)})`
    return result
  })
}

export async function processNextDispatch(
  sql: Sql,
  subject: string,
  clock = () => new Date(),
) {
  const now = clock()
  const claim = await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject)
    const [workspace] =
      await tx`select send_enabled,revision from em_workspaces where id=${ws.id}`
    const [job] =
      await tx`select * from em_jobs where workspace_id=${ws.id} and kind='dispatch'
        and ((state in ('ready','retry') and run_after<=${now}) or (state='leased' and lease_until<${now}))
        order by run_after,id for update skip locked limit 1`
    if (!job) return null
    const token = randomUUID()
    await tx`update em_jobs set state='leased',lease_token=${token},lease_until=${new Date(now.getTime() + 90_000)},attempts=attempts+1
      where workspace_id=${ws.id} and id=${job.id}`
    return {
      workspaceId: ws.id as string,
      jobId: job.id as string,
      token,
      entityId: job.entity_id as string,
      sendEnabled: workspace.send_enabled as boolean,
      revision: workspace.revision as number,
    }
  })
  if (!claim) return { state: 'idle', processed: 0 }
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx
    const [fresh] =
      await tx`select lease_token,state from em_jobs where workspace_id=${claim.workspaceId} and id=${claim.jobId} for update`
    if (fresh?.lease_token !== claim.token || fresh.state !== 'leased')
      return { state: 'lease_lost', processed: 0 }
    const reason = liveDispatchBlockReason({
      enabledEnv: process.env.EMAIL_LIVE_DISPATCH_ENABLED,
      sendEnabled: claim.sendEnabled,
      evidenceEnv: process.env.EMAIL_CONTROLLED_PROVIDER_EVIDENCE,
    })
    await tx`update em_send_intents set state='held',cancellation_reason=${reason},remote_outcome=${reason}
      where workspace_id=${claim.workspaceId} and id=${claim.entityId} and state in ('queued','dispatching','uncertain')`
    await tx`update em_jobs set state='done',lease_token=null,lease_until=null,last_error=${reason}
      where workspace_id=${claim.workspaceId} and id=${claim.jobId} and lease_token=${claim.token}`
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
      values(${claim.workspaceId},${subject},'worker.dispatch.held',${claim.entityId},${claim.jobId},${tx.json({
        reason,
        liveSend: false,
      })},${now})`
    return { state: 'held', processed: 1, reason }
  })
}

export async function reconcileRemoteIntent(
  tx: Tx,
  workspaceId: string,
  subject: string,
  intentId: string,
  evidence: unknown,
  requestId: string,
  now: Date,
) {
  const [intent] =
    await tx`select * from em_send_intents where workspace_id=${workspaceId} and id=${intentId} for update`
  check(intent, 'INTENT_NOT_FOUND', 404)
  check(
    ['uncertain', 'held', 'rejected', 'dispatching'].includes(intent.state),
    'INTENT_NOT_RECONCILABLE',
  )
  await tx`update em_send_intents set state='held',cancellation_reason='reconciled_without_resend',
    remote_outcome=coalesce(remote_outcome,'reconciled'),reconciled_at=${now}
    where workspace_id=${workspaceId} and id=${intent.id}`
  await tx`update em_jobs set state='dead',last_error='reconciled_without_resend' where workspace_id=${workspaceId}
    and kind='dispatch' and entity_id=${intent.id} and state in ('ready','retry','leased')`
  await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
    values(${workspaceId},${subject},'OPS-RECONCILE',${intent.id},${requestId},${tx.json({
      priorState: intent.state,
      evidenceHash: evidence == null ? null : workflowHash(evidence),
      resent: false,
    })},${now})`
  return { entityId: intent.id as string, state: 'reconciled_held' }
}
