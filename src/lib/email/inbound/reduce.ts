import 'server-only'
import { check, type Tx } from '../workflow/core'

export const deliveryEventTypes = [
  'email.sent',
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.delivery_delayed',
] as const
export const diagnosticEventTypes = ['email.opened', 'email.clicked'] as const
export type DeliveryEventType = (typeof deliveryEventTypes)[number]

export function isDeliveryEvent(type: string): type is DeliveryEventType {
  return (deliveryEventTypes as readonly string[]).includes(type)
}
export function isDiagnosticEvent(type: string) {
  return (diagnosticEventTypes as readonly string[]).includes(type)
}

export async function reduceDeliveryEvent(
  tx: Tx,
  input: {
    workspaceId: string
    connectionId: string
    eventId: string
    providerEventId: string
    type: DeliveryEventType
    providerEmailId: string | null
    occurredAt: Date
    now: Date
  },
) {
  if (!input.providerEmailId) {
    return { matched: false as const, holdReason: 'unmatched_delivery' }
  }
  const [intent] =
    await tx`select i.id,i.thread_id,t.address_id from em_send_intents i
      join em_threads t on t.workspace_id=i.workspace_id and t.id=i.thread_id
      where i.workspace_id=${input.workspaceId} and i.provider_message_id=${input.providerEmailId}`
  const [message] = intent
    ? []
    : await tx`select m.intent_id,m.thread_id,t.address_id from em_messages m
      join em_threads t on t.workspace_id=m.workspace_id and t.id=m.thread_id
      where m.workspace_id=${input.workspaceId} and m.provider_email_id=${input.providerEmailId}`
  const match = intent ?? (message?.intent_id ? message : null)
  if (!match)
    return { matched: false as const, holdReason: 'unmatched_delivery' }
  const intentId = (match.id ?? match.intent_id) as string
  await tx`insert into em_delivery_facts(workspace_id,connection_id,provider_event_id,provider_email_id,intent_id,type,occurred_at)
    values(${input.workspaceId},${input.connectionId},${input.providerEventId},${input.providerEmailId},${intentId},${input.type},${input.occurredAt})
    on conflict (workspace_id,connection_id,provider_event_id) do nothing`
  if (input.type === 'email.delivered')
    await tx`update em_send_intents set remote_outcome='delivered' where workspace_id=${input.workspaceId} and id=${intentId} and state in ('accepted','uncertain','accepted_simulated')`
  if (input.type === 'email.sent')
    await tx`update em_send_intents set remote_outcome=coalesce(remote_outcome,'sent') where workspace_id=${input.workspaceId} and id=${intentId}`
  return {
    matched: true as const,
    holdReason: null,
    threadId: match.thread_id as string,
    addressId: match.address_id as string,
    suppressionReason:
      input.type === 'email.bounced'
        ? ('hard_bounce' as const)
        : input.type === 'email.complained'
          ? ('complaint' as const)
          : null,
  }
}

export async function acknowledgeEventReview(
  tx: Tx,
  workspaceId: string,
  subject: string,
  incidentKey: string,
  note: string,
  now: Date,
) {
  const jobId = incidentKey.startsWith('resend_event_review:')
    ? incidentKey.slice('resend_event_review:'.length)
    : incidentKey
  check(/^[0-9a-f-]{36}$/i.test(jobId), 'REVIEW_NOT_FOUND', 404)
  const [job] =
    await tx`select * from em_jobs where workspace_id=${workspaceId} and id=${jobId} and kind='resend_event_review' for update`
  check(job, 'REVIEW_NOT_FOUND', 404)
  check(job.state === 'dead', 'REVIEW_CHANGED')
  await tx`update em_jobs set state='done',last_error=null,lease_token=null,lease_until=null where workspace_id=${workspaceId} and id=${job.id}`
  await tx`update em_provider_events set state='processed' where workspace_id=${workspaceId} and id=${job.entity_id} and state='quarantined'`
  const [remaining] =
    await tx`select count(*)::int as n from em_jobs where workspace_id=${workspaceId} and kind='resend_event_review' and state='dead'`
  const [workspace] =
    await tx`select pause_reason from em_workspaces where id=${workspaceId}`
  let released = false
  if (
    remaining.n === 0 &&
    workspace.pause_reason === 'Resend event needs review'
  ) {
    await tx`update em_workspaces set pause_reason=null,revision=revision+1 where id=${workspaceId}`
    released = true
  }
  await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
    values(${workspaceId},${subject},'OPS-ACK',${job.id},${job.id},${tx.json({
      note,
      releasedPause: released,
    })},${now})`
  return {
    entityId: job.id as string,
    state: released ? 'review_released' : 'review_acknowledged',
  }
}
