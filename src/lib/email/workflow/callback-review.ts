import 'server-only'
import type { Row } from 'postgres'
import { callbackRequest } from './callback-request'
export { callbackRequest, isCallbackTest } from './callback-request'
import { check, type Context, type Result } from './core'

export async function stoppedCallback(context: Context, thread: { id: string; address_id: string }) {
  const { tx, member } = context
  const [message] = await tx`select id,text_body,occurred_at from em_messages where workspace_id=${member.workspace_id} and thread_id=${thread.id} and direction='inbound' order by sequence desc limit 1`
  const [suppression] = await tx`select max(effective_at) as stopped_at from em_suppressions where workspace_id=${member.workspace_id} and address_id=${thread.address_id}`
  check(message && suppression?.stopped_at && new Date(message.occurred_at) > new Date(suppression.stopped_at) && callbackRequest(message.text_body)?.explicitCall, 'NEW_CALLBACK_REQUEST_REQUIRED')
}

/** Called under the same command transaction and workspace lock as handoff. */
export async function recordCallbackTest(context: Context, threadId: string, messageId: string): Promise<Result> {
  const { tx, member, now } = context
  await tx`insert into em_notifications(workspace_id,thread_id,recipient_id,kind,logical_key,created_at)
    values(${member.workspace_id},${threadId},${member.auth_user_id},'SYSTEM TEST reviewed — no Lead, task or call created',${`test-callback:${messageId}`},${now}) on conflict do nothing`
  return { entityId: messageId, state: 'test_callback_reviewed' }
}

export async function annotateCallbackRequests(context: Context, threads: Row[], messages: Row[]) {
  if (!threads.length) return
  const { tx, member } = context
  const ids = threads.map(t => t.id)
  const reviewed = await tx`select entity_id from em_audit_events where workspace_id=${member.workspace_id} and action='THR-HANDOFF' and detail->>'state'='test_callback_reviewed' and entity_id in (select id from em_messages where thread_id=any(${tx.array(ids)}::uuid[]) and workspace_id=${member.workspace_id})`
  const reviewedIds = new Set(reviewed.map(r => r.entity_id))
  const latest = new Map<string, Row>()
  for (const message of messages) if (message.direction === 'inbound') latest.set(message.thread_id, message)
  for (const thread of threads) {
    const inbound = latest.get(thread.id)
    const request = inbound ? callbackRequest(inbound.text_body) : null
    const afterStop = thread.state !== 'stopped' || (request?.explicitCall && thread.marketing_stopped_at && inbound && new Date(inbound.occurred_at) > new Date(thread.marketing_stopped_at))
    thread.callback_request = request && afterStop && !thread.inbound_pending && !thread.handoff_id
      ? { ...request, messageId: inbound!.id, reviewed: reviewedIds.has(inbound!.id) }
      : null
  }
}
