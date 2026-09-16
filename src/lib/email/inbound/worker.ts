import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import { connectionMasterKey, ownerWorkspace } from '../connections/service'
import { decryptEmailSecret, encryptEmailSecret } from '../secrets'
import {
  check,
  json,
  WorkflowError,
  workflowHash,
  type Tx,
  type Context,
} from '../workflow/core'
import { suppress } from '../workflow/service'
import { projectCrmChanges } from '../crm-repairs'
import { normalizeReceivedContent, authoredReplyText } from './content'
import { receivingProvider, type ReceivingProvider } from './provider'
import { automaticallyHandoffCallback } from './automatic-callback'

const retryable = new Set([
  'REPLY_PROVIDER_UNAVAILABLE',
  'REPLY_NOT_READY',
  'REPLY_RATE_LIMIT',
])
/** One bounded provider GET per claimed job. No sending, attachment fetch or AI. */
export async function processNextReceivedReply(
  sql: Sql,
  subject: string,
  provider: ReceivingProvider = receivingProvider,
  clock = () => new Date(),
  key = connectionMasterKey(),
) {
  check(key, 'CREDENTIAL_STORAGE_REQUIRED', 503)
  const claim = await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject),
      now = clock()
    await tx`update em_jobs set state='dead',last_error='REPLY_LEASE_EXHAUSTED',lease_token=null,lease_until=null where workspace_id=${ws.id} and kind='resend_receive_content' and state='leased' and lease_until<${now} and attempts>=5`
    const [job] =
      await tx`select * from em_jobs where workspace_id=${ws.id} and kind='resend_receive_content' and attempts<5 and ((state in ('ready','retry') and run_after<=${now}) or (state='leased' and lease_until<${now})) order by run_after,id for update skip locked limit 1`
    if (!job) return null
    const [event] =
      await tx`select e.*,c.encrypted_secret,c.state as connection_state,ep.active as endpoint_active,ep.revision as endpoint_revision from em_provider_events e join em_service_connections c on c.workspace_id=e.workspace_id and c.id=e.connection_id join em_webhook_endpoints ep on ep.id=e.endpoint_id and ep.connection_id=c.id where e.id=${job.entity_id} and e.workspace_id=${ws.id}`
    if (
      !event?.thread_id ||
      event.state !== 'pending' ||
      event.connection_state !== 'checked' ||
      !event.endpoint_active
    ) {
      await tx`update em_jobs set state='dead',last_error='REPLY_CONNECTION_REVIEW',lease_token=null,lease_until=null where id=${job.id}`
      return { blocked: true as const, jobId: job.id }
    }
    const secret = decryptEmailSecret(
      event.encrypted_secret,
      key,
      `${ws.id}/${event.connection_id}/resend/1`,
    )
    const token = randomUUID()
    await tx`update em_jobs set state='leased',lease_token=${token},lease_until=${new Date(now.getTime() + 90000)},attempts=attempts+1,updated_at=${now} where id=${job.id}`
    return {
      blocked: false as const,
      jobId: job.id,
      workspace: ws.id as string,
      event,
      token,
      secret,
    }
  })
  if (!claim) return { state: 'idle' }
  if (claim.blocked) return { state: 'review_required', jobId: claim.jobId }
  try {
    const raw = await provider.get(claim.secret, claim.event.provider_email_id)
    const serialized = JSON.stringify(raw)
    check(
      serialized && Buffer.byteLength(serialized) <= 2097152,
      'REPLY_CONTENT_REVIEW_REQUIRED',
    )
    let content: ReturnType<typeof normalizeReceivedContent>
    try {
      content = normalizeReceivedContent(raw)
    } catch {
      throw new WorkflowError('REPLY_CONTENT_REVIEW_REQUIRED')
    }
    return await sql.begin(async (transaction) => {
      const tx = transaction as unknown as Tx,
        ws = await ownerWorkspace(tx, subject),
        now = clock()
      check(ws.id === claim.workspace, 'REPLY_WORKSPACE_CHANGED')
      const [job] =
        await tx`select * from em_jobs where id=${claim.jobId} and workspace_id=${ws.id} for update`
      check(
        job?.state === 'leased' &&
          job.lease_token === claim.token &&
          new Date(job.lease_until) > now,
        'REPLY_LEASE_LOST',
      )
      const [event] =
        await tx`select e.*,c.state as connection_state,ep.active,ep.revision as endpoint_revision from em_provider_events e join em_service_connections c on c.workspace_id=e.workspace_id and c.id=e.connection_id join em_webhook_endpoints ep on ep.id=e.endpoint_id and ep.connection_id=c.id where e.workspace_id=${ws.id} and e.id=${claim.event.id} for update of e,c,ep`
      check(
        event?.state === 'pending' &&
          event.connection_state === 'checked' &&
          event.active &&
          event.endpoint_revision === claim.event.endpoint_revision,
        'REPLY_CONNECTION_REVIEW',
      )
      const original = JSON.parse(
        decryptEmailSecret(
          event.encrypted_payload,
          key,
          `${ws.id}/${event.id}/resend-event/1`,
        ),
      )
      check(
        content.id === event.provider_email_id &&
          content.message_id === original.data.message_id &&
          content.from.toLowerCase() === original.data.from.toLowerCase(),
        'REPLY_IDENTITY_REVIEW',
      )
      const addresses = (
        content.received_for?.length ? content.received_for : content.to
      ).map((a) => a.toLowerCase())
      const aliases =
        await tx`select distinct a.thread_id from em_reply_aliases a where a.workspace_id=${ws.id} and a.connection_id=${event.connection_id} and a.address=any(${tx.array(addresses)})`
      check(
        aliases.length === 1 && aliases[0].thread_id === event.thread_id,
        'REPLY_IDENTITY_REVIEW',
      )
      const [thread] =
        await tx`select t.*,a.normalized_address from em_threads t join em_addresses a on a.workspace_id=t.workspace_id and a.id=t.address_id where t.workspace_id=${ws.id} and t.id=${event.thread_id} for update of t`
      check(thread, 'REPLY_IDENTITY_REVIEW')
      // A signed webhook authenticates the transport, not a changed sender. Human review is required.
      check(
        content.from.toLowerCase() === thread.normalized_address,
        'REPLY_IDENTITY_REVIEW',
      )
      const context: Context = {
        tx,
        member: {
          workspace_id: ws.id,
          auth_user_id: subject,
          roles: ['owner'],
        },
        now,
      }
      const [existing] =
        await tx`select id,thread_id,content_hash from em_messages where connection_id=${event.connection_id} and provider_email_id=${content.id} and transport='resend' and direction='inbound'`
      const contentHash = workflowHash({
        text: content.text,
        subject: content.subject,
        messageId: content.message_id,
        from: content.from,
        attachments: content.attachments,
      })
      check(
        !existing ||
          (existing.thread_id === thread.id &&
            existing.content_hash === contentHash),
        'REPLY_IDENTITY_REVIEW',
      )
      let messageId = existing?.id
      if (!existing) {
        const [message] =
          await tx`insert into em_messages(workspace_id,thread_id,direction,text_body,subject,sequence,transport,event_key,content_hash,occurred_at,connection_id,provider_email_id,rfc_message_id,rfc_in_reply_to,received_at,attachment_metadata)
          values(${ws.id},${thread.id},'inbound',${content.text},${content.subject},${thread.content_revision + 1},'resend',${`resend:${event.connection_id}:${content.id}`},${contentHash},${now},${event.connection_id},${content.id},${content.message_id},${content.headers['in-reply-to'] ?? null},${now},${tx.json(content.attachments)}) returning id`
        messageId = message.id
        await tx`update em_threads set content_revision=content_revision+1,last_message_at=${now},state=case when state='stopped' then state else 'needs_review' end where id=${thread.id}`
        await tx`update em_enrollments set state='replied' where workspace_id=${ws.id} and id=${thread.enrollment_id} and state not in ('suppressed','failed')`
        if (content.optOut)
          await suppress(context, thread.address_id, 'unsubscribe', message.id)
        else await projectCrmChanges(context, thread.id, { history: true })
        const hasPhone =
          /(?:\+?1[ .-]?)?\(?[2-9]\d{2}\)?[ .-]?\d{3}[ .-]?\d{4}/.test(
            authoredReplyText(content.text),
          )
        const autoReply =
          content.headers['auto-submitted'] &&
          content.headers['auto-submitted'].toLowerCase() !== 'no'
        await tx`insert into em_notifications(workspace_id,thread_id,recipient_id,kind,logical_key,created_at) values(${ws.id},${thread.id},${thread.responsible_user_id},${content.optOut ? 'Seller unsubscribed' : autoReply ? 'Automatic reply received — review' : hasPhone ? 'Phone number received — review callback' : 'Reply needs review'},${`received:${event.connection_id}:${content.id}`},${now}) on conflict do nothing`
      }
      await tx`update em_provider_events set state='processed',hold_reason=null,encrypted_content=${tx.json(json(encryptEmailSecret(serialized, key, `${ws.id}/${event.id}/resend-content/1`, 1)))} where id=${event.id}`
      await tx`update em_threads set inbound_pending=exists(select 1 from em_provider_events where workspace_id=${ws.id} and thread_id=${thread.id} and state<>'processed' and type='email.received') where id=${thread.id}`
      if (!content.optOut && (!content.headers['auto-submitted'] || content.headers['auto-submitted'].toLowerCase() === 'no')) {
        const handled = await automaticallyHandoffCallback(context, thread.id, messageId)
        if (handled) await tx`update em_notifications set acknowledged_at=${now} where workspace_id=${ws.id} and logical_key=${`received:${event.connection_id}:${content.id}`}`
      }
      await tx`update em_jobs set state='done',lease_token=null,lease_until=null,last_error=null,updated_at=${now} where id=${job.id} and lease_token=${claim.token}`
      return {
        state: existing
          ? 'already_received'
          : content.optOut
            ? 'unsubscribed'
            : 'received',
        jobId: job.id,
        messageId,
      }
    })
  } catch (error) {
    const code =
      error instanceof WorkflowError ? error.code : 'REPLY_RETRIEVAL_FAILED'
    return sql.begin(async (transaction) => {
      const tx = transaction as unknown as Tx,
        ws = await ownerWorkspace(tx, subject),
        now = clock()
      const [job] =
        await tx`select * from em_jobs where id=${claim.jobId} and workspace_id=${ws.id} for update`
      if (
        !job ||
        job.state !== 'leased' ||
        job.lease_token !== claim.token ||
        new Date(job.lease_until) <= now
      )
        return { state: 'lease_lost', jobId: claim.jobId }
      const retry = retryable.has(code) && job.attempts < 5
      await tx`update em_jobs set state=${retry ? 'retry' : 'dead'},lease_token=null,lease_until=null,last_error=${code},run_after=${new Date(now.getTime() + Math.min(3600000, 30000 * 2 ** job.attempts))},updated_at=${now} where id=${job.id}`
      if (!retry)
        await tx`update em_provider_events set state='quarantined',hold_reason=${code} where id=${claim.event.id}`
      return {
        state: retry ? 'retry_scheduled' : 'review_required',
        jobId: job.id,
        code,
      }
    })
  }
}
