import 'server-only'
import { callbackRequest } from '../workflow/callback-request'
import { authoredReplyText } from '../reply-text'
import { isOptOutReply } from './content'
import { emailWorkspaceConfigSchema } from '../config'
import { projectEmailHandoffToCrm } from '../crm-adapter'
import { json, type Context } from '../workflow/core'

/** Deliberately narrow: uncertain prose stays in the human review queue. */
export function automaticCallbackRequest(body: string) {
  const text = authoredReplyText(body).trim()
  const request = callbackRequest(text)
  if (!request?.explicitCall || request.testOnly || isOptOutReply(text)) return null
  const phones = text.match(/(?:\+?1[ .-]?)?\(?[2-9]\d{2}\)?[ .-]?[2-9]\d{2}[ .-]?\d{4}/g) ?? []
  if (phones.length !== 1 || phones[0] !== request.phone) return null
  // Require an affirmative first-person instruction, not a question, condition or quotation.
  if (!/^(?:(?:hi|hello|yes|sure|okay|ok)[,.!\s]+)?(?:please\s+)?(?:call me|give me a call|reach me)\b/i.test(text)) return null
  if (/[?"“”]|\b(if|unless|not|don't|never|stop|remove|unsubscribe|wrong|instead|but|example|test|fake|false|dummy|his|her|their|brother|sister|attorney|agent)\b/i.test(text)) return null
  if (text.length > 240) return null
  return request
}

/** Runs within the receiving transaction and workspace lock; never calls a provider. */
export async function automaticallyHandoffCallback(context: Context, threadId: string, messageId: string) {
  const { tx, member, now } = context
  const ws = member.workspace_id
  const [thread] = await tx`select t.*,c.name as campaign_name,c.is_test from em_threads t join em_campaigns c on c.id=t.campaign_id where t.workspace_id=${ws} and t.id=${threadId} for update of t`
  if (!thread || thread.inbound_pending || thread.state === 'stopped' || thread.is_test || thread.campaign_name === 'Controlled setup test') return false
  const [existing] = await tx`select id from em_handoffs where workspace_id=${ws} and thread_id=${threadId}`
  if (existing) return false
  const [message] = await tx`select id,text_body from em_messages where workspace_id=${ws} and thread_id=${threadId} and direction='inbound' order by sequence desc limit 1`
  if (message?.id !== messageId) return false
  const request = automaticCallbackRequest(message.text_body)
  if (!request) return false
  const [suppression] = await tx`select id from em_suppressions where workspace_id=${ws} and address_id=${thread.address_id} limit 1`
  if (suppression) return false
  const [workspace] = await tx`select config from em_workspaces where id=${ws}`
  const team = emailWorkspaceConfigSchema.safeParse(workspace.config)
  const routing = team.success ? team.data.team : undefined
  if (!routing || routing.acquisitionOwnerId === routing.backupId) return false
  const members = await tx`select m.auth_user_id from em_memberships m join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id) where m.workspace_id=${ws} and m.active and (m.roles && array['owner','acquisitions']::text[]) and m.auth_user_id in (${routing.acquisitionOwnerId},${routing.backupId})`
  if (members.length !== 2) return false
  const contact = { phone: request.phone, ...(request.time ? { requestedTimeText: request.time } : {}) }
  const evidence = [{ source: 'message', messageId, quote: message.text_body }]
  const [handoff] = await tx`insert into em_handoffs(workspace_id,thread_id,owner_id,backup_id,reason,requested_contact,fact_evidence,seller_interest_confirmed,crm_sync_state,created_at)
    values(${ws},${threadId},${routing.acquisitionOwnerId},${routing.backupId},'Automatic handoff: explicit first-person callback request',${tx.json(contact)},${tx.json(evidence)},true,'pending',${now}) returning id`
  await tx`update em_threads set controller='human',controller_user_id=${routing.acquisitionOwnerId},responsible_user_id=${routing.acquisitionOwnerId},controller_revision=controller_revision+1,state='human',outcome='call_requested' where id=${threadId}`
  await tx`update em_send_intents set state='cancelled',cancellation_reason='automatic_callback' where thread_id=${threadId} and state in ('queued','held')`
  await tx`update em_drafts set state='stale' where thread_id=${threadId} and state='current'`
  await tx`update em_ai_generations set state='stale' where thread_id=${threadId} and state in ('queued','running','ready')`
  const bridge = await projectEmailHandoffToCrm(context, {
    handoffId: handoff.id, threadId, ownerId: routing.acquisitionOwnerId,
    positiveSellerInterest: true, evidenceMessageId: messageId,
    evidenceQuote: message.text_body, requestedContact: contact,
  })
  await tx`insert into em_notifications(workspace_id,thread_id,recipient_id,kind,logical_key,created_at)
    values(${ws},${threadId},${routing.acquisitionOwnerId},${bridge.state === 'handoff_saved_crm_synced' ? 'Callback task ready' : 'CRM review needed'},${`handoff:${handoff.id}`},${now}) on conflict do nothing`
  await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
    values(${ws},${member.auth_user_id},'AUTOMATIC-CALLBACK',${handoff.id},${messageId},${tx.json(json({ ...bridge, messageId, automation: 'explicit_callback_v1' }))},${now})`
  return true
}
