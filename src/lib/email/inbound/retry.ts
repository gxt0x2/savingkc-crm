import 'server-only'
import { check, type Context } from '../workflow/core'
export const RETRIEVAL_RETRY_CODES = [
  'REPLY_PROVIDER_UNAVAILABLE',
  'REPLY_NOT_READY',
  'REPLY_ROUTING_NOT_READY',
  'REPLY_RATE_LIMIT',
  'REPLY_CONNECTION_REJECTED',
  'REPLY_RETRIEVAL_FAILED',
  'REPLY_LEASE_EXHAUSTED',
  'REPLY_CONNECTION_REVIEW',
]
export async function retryReceivedJob(
  context: Context,
  jobId: string,
  expectedFailureCode: string,
  reason: string,
  requestId: string,
) {
  const { tx, member, now } = context
  check(member.roles.includes('owner'), 'FORBIDDEN', 403)
  const [job] =
    await tx`select j.*,e.connection_id,e.endpoint_id,e.thread_id from em_jobs j join em_provider_events e on e.id=j.entity_id and e.workspace_id=j.workspace_id where j.workspace_id=${member.workspace_id} and j.id=${jobId} for update of j,e`
  check(
    job?.kind === 'resend_receive_content' &&
      job.state === 'dead' &&
      (job.thread_id || job.last_error === 'REPLY_ROUTING_NOT_READY') &&
      job.last_error === expectedFailureCode &&
      RETRIEVAL_RETRY_CODES.includes(expectedFailureCode),
    'REPLY_RETRY_REVIEW_REQUIRED',
  )
  const [binding] =
    await tx`select c.state,e.active from em_service_connections c join em_webhook_endpoints e on e.connection_id=c.id and e.workspace_id=c.workspace_id where c.id=${job.connection_id} and e.id=${job.endpoint_id}`
  check(
    binding?.state === 'checked' && binding.active,
    'REPLY_CONNECTION_REVIEW',
  )
  await tx`update em_jobs set state='retry',attempts=0,run_after=${now},lease_token=null,lease_until=null,updated_at=${now} where id=${job.id}`
  await tx`update em_provider_events set state='pending',hold_reason=${job.thread_id ? 'awaiting_reply_content' : 'awaiting_routing_headers'} where id=${job.entity_id}`
  await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at) values(${member.workspace_id},${member.auth_user_id},'RECEIVING-RETRY',${job.id},${requestId},${tx.json({ reason, priorFailureCode: expectedFailureCode, priorAttempts: job.attempts })},${now})`
  return { entityId: job.id, state: 'reply_retry_queued' }
}
