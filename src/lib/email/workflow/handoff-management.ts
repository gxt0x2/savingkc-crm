import 'server-only'
import type { EmailCommand } from '../contracts'
import { projectEmailHandoffToCrm } from '../crm-adapter'
import { check, json, workflowHash, type Context } from './core'

type ManagementCommand = Extract<
  EmailCommand,
  { command: 'HAN-REASSIGN' | 'HAN-RESOLVE' }
>

/** Explicit human decisions under the shared Email transaction and Lead lock. */
export async function manageHandoff(
  context: Context,
  command: ManagementCommand,
) {
  const { tx, member, now } = context
  const p = command.payload
  const ws = member.workspace_id
  const [h] =
    await tx`select * from em_handoffs where workspace_id=${ws} and id=${p.handoffId} for update`
  check(h, 'HANDOFF_NOT_FOUND', 404)
  check(h.revision === command.expectedRevision, 'HANDOFF_CHANGED')
  check(
    member.roles.some((r) => ['owner', 'reviewer'].includes(r)) ||
      h.owner_id === member.auth_user_id,
    'CALLBACK_OWNER_REQUIRED',
    403,
  )
  const [thread] =
    await tx`select * from em_threads where workspace_id=${ws} and id=${h.thread_id} for update`
  check(thread && !['stopped', 'done'].includes(thread.state), 'CALLBACK_HELD')
  check(
    thread.content_revision === p.contentRevision,
    'NEW_REPLY_REVIEW_REQUIRED',
  )
  check(
    thread.controller_revision === p.controllerRevision,
    'OWNERSHIP_CHANGED',
  )
  check(h.state !== 'completed', 'CALLBACK_HELD')
  const newOwner =
    command.command === 'HAN-REASSIGN'
      ? command.payload.newOwnerId
      : command.payload.ownerId
  check(newOwner !== p.backupId, 'DISTINCT_BACKUP_REQUIRED')
  const members =
    await tx`select m.auth_user_id,m.roles,email_crm_assignee_name(a.email,a.full_name) as full_name from em_memberships m
    join agent_profiles a on a.id=m.agent_profile_id and a.is_active is distinct from false and (a.user_id is null or a.user_id=m.auth_user_id) where m.workspace_id=${ws} and m.active`
  const eligible = (id: string) =>
    members.find(
      (m) =>
        m.auth_user_id === id &&
        m.full_name &&
        m.roles.some((r: string) => ['owner', 'acquisitions'].includes(r)),
    )
  const nextOwner = eligible(newOwner)
  check(nextOwner && eligible(p.backupId), 'ASSIGNEE_UNAVAILABLE')
  check(
    members.filter((m) => m.full_name === nextOwner.full_name).length === 1,
    'ASSIGNEE_AMBIGUOUS',
  )

  if (command.command === 'HAN-REASSIGN') {
    check(
      h.crm_sync_state === 'synced' && h.lead_id && h.crm_task_key,
      'LINK_LEAD_FIRST',
    )
    const [repair] =
      await tx`select id from em_crm_projection_repairs where workspace_id=${ws}
      and thread_id=${h.thread_id} and state='pending'`
    check(!repair, 'CALLBACK_HELD')
    const [lead] =
      await tx`select * from leads where id=${h.lead_id} for update`
    check(
      lead && lead.assigned_agent === command.payload.expectedCrmOwner,
      'CALLBACK_OWNER_CHANGED',
    )
    check(
      !lead.is_parked &&
        !['dead', 'closed_won', 'closed_lost'].includes(lead.station),
      'CRM_RECORD_HELD',
    )
    const [other] =
      await tx`select id from em_handoffs where lead_id=${h.lead_id} and id<>${h.id} and state<>'completed'`
    check(!other, 'MULTIPLE_HANDOFFS_REQUIRE_REVIEW')
    await tx`select pg_advisory_xact_lock(hashtextextended('work-item:' || ${h.crm_task_key},0))`
    const [item] =
      await tx`select * from work_items where work_item_key=${h.crm_task_key} for update`
    const [source] =
      await tx`select * from lead_activities where id=${h.crm_task_id} for update`
    check(
      item?.status === 'pending' &&
        item.source_id === h.crm_task_id &&
        source?.lead_id === h.lead_id &&
        source.metadata?.em_handoff_id === h.id &&
        source.metadata?.origin === 'email_marketing',
      'CALLBACK_HELD',
    )
    await tx`update leads set assigned_agent=${nextOwner.full_name},updated_at=${now} where id=${h.lead_id}`
    await tx`update lead_activities set metadata=metadata || ${tx.json({
      assigned_to: nextOwner.full_name,
      last_changed_by: member.auth_user_id,
      last_changed_at: now.toISOString(),
    })} where id=${h.crm_task_id}`
    const [next] =
      await tx`select * from work_items where work_item_key=${h.crm_task_key}`
    check(
      next?.assigned_to === nextOwner.full_name && next.status === 'pending',
      'CRM_CALLBACK_UPDATE_FAILED',
    )
    await tx`insert into work_item_events(work_item_key,idempotency_key,action,actor,previous_state,next_state,metadata)
      values(${h.crm_task_key},${command.idempotencyKey},'reassign',${member.auth_user_id},${tx.json(item)},${tx.json(next)},
        ${tx.json({ origin: 'email_marketing', reason: p.reason })})`
    await tx`insert into lead_activities(lead_id,activity_type,description,agent,metadata,created_at)
      values(${h.lead_id},'status_change',${`Lead and email callback assigned to ${nextOwner.full_name}: ${p.reason}`},
      ${members.find((m) => m.auth_user_id === member.auth_user_id)?.full_name ?? member.auth_user_id},
      ${tx.json({ origin: 'email_marketing', em_handoff_id: h.id, previous_agent: lead.assigned_agent, assigned_agent: nextOwner.full_name })},${now})`
  } else {
    const p = command.payload
    check(
      h.state === 'held' &&
        !h.lead_id &&
        !h.crm_task_id &&
        h.crm_sync_state !== 'synced',
      'HANDOFF_NOT_RESOLVABLE',
    )
    check(p.factEvidence.length === 1, 'ONE_MESSAGE_EVIDENCE_REQUIRED')
    const evidence = p.factEvidence[0]
    const [latest] =
      await tx`select id,text_body from em_messages where workspace_id=${ws} and thread_id=${h.thread_id}
      and direction='inbound' order by sequence desc limit 1`
    check(latest?.id === evidence.messageId, 'NEW_REPLY_REVIEW_REQUIRED')
    check(
      evidence.source === 'message' &&
        evidence.quote &&
        latest.text_body.includes(evidence.quote),
      'EVIDENCE_CHANGED',
    )
    if (p.requestedContact.phone)
      check(
        p.requestedContact.phone.replace(/\D/g, '').length >= 10 &&
          evidence.quote
            .replace(/\D/g, '')
            .includes(p.requestedContact.phone.replace(/\D/g, '')),
        'PHONE_EVIDENCE_REQUIRED',
      )
    if (p.requestedContact.requestedTimeText)
      check(
        evidence.quote.includes(p.requestedContact.requestedTimeText),
        'TIME_EVIDENCE_REQUIRED',
      )
    const input = {
      handoffId: h.id,
      threadId: h.thread_id,
      ownerId: newOwner,
      positiveSellerInterest: p.positiveSellerInterest,
      evidenceMessageId: evidence.messageId!,
      evidenceQuote: evidence.quote,
      requestedContact: p.requestedContact,
    }
    // Preserve the previous reviewed request before amending the held attempt.
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
      values(${ws},${member.auth_user_id},'HAN-RESOLVE-REVIEW',${h.id},${command.idempotencyKey},
      ${tx.json(
        json({
          previous: {
            ownerId: h.owner_id,
            backupId: h.backup_id,
            factEvidence: h.fact_evidence,
            requestedContact: h.requested_contact,
            positiveSellerInterest: h.seller_interest_confirmed,
            holdReason: h.crm_sync_reason,
          },
          next: input,
          reason: p.reason,
        }),
      )},${now})`
    await tx`update em_handoffs set owner_id=${newOwner},backup_id=${p.backupId},reason=${p.reason},
      requested_contact=${tx.json(json(p.requestedContact))},fact_evidence=${tx.json(json(p.factEvidence))},
      seller_interest_confirmed=${p.positiveSellerInterest},crm_sync_state='pending',crm_sync_reason=null,state='needs_contact' where id=${h.id}`
    await tx`update em_crm_handoff_projections set request_hash=${workflowHash(input)},evidence_message_id=${evidence.messageId!},
      owner_auth_user_id=${newOwner},owner_name=${nextOwner.full_name},state='pending',hold_reason=null,completed_at=null where handoff_id=${h.id} and state='held'`
    const bridge = await projectEmailHandoffToCrm(context, input)
    await transfer(
      context,
      { id: h.id, thread_id: h.thread_id },
      newOwner,
      p.backupId,
      command.idempotencyKey,
      bridge.state === 'handoff_saved_crm_synced'
        ? 'Callback task ready'
        : 'CRM review needed',
      false,
    )
    return { entityId: h.id, revision: h.revision + 1, state: bridge.state }
  }
  await transfer(
    context,
    { id: h.id, thread_id: h.thread_id },
    newOwner,
    p.backupId,
    command.idempotencyKey,
    'Callback assigned — acceptance needed',
    true,
  )
  return {
    entityId: h.id,
    revision: h.revision + 1,
    state: 'callback_reassigned',
    invalidates: [
      'crm:conversations',
      'crm:work-items',
      `crm:lead:${h.lead_id}`,
    ],
  }
}

async function transfer(
  context: Context,
  h: { id: string; thread_id: string },
  ownerId: string,
  backupId: string,
  key: string,
  notice: string,
  resetState: boolean,
) {
  const { tx, member, now } = context
  await tx`update em_send_intents set state='cancelled',cancellation_reason='handoff_changed' where workspace_id=${member.workspace_id}
    and thread_id=${h.thread_id} and state in ('queued','held')`
  await tx`update em_drafts set state='stale' where workspace_id=${member.workspace_id} and thread_id=${h.thread_id} and state='current'`
  await tx`update em_handoffs set owner_id=${ownerId},backup_id=${backupId},revision=revision+1,
    state=case when ${resetState} then 'needs_contact' else state end where id=${h.id}`
  await tx`update em_threads set responsible_user_id=${ownerId},controller='human',controller_user_id=${ownerId},
    controller_revision=controller_revision+1,state='human' where workspace_id=${member.workspace_id} and id=${h.thread_id}`
  await tx`update em_notifications set acknowledged_at=coalesce(acknowledged_at,${now}) where workspace_id=${member.workspace_id}
    and thread_id=${h.thread_id} and logical_key like 'handoff:%'`
  await tx`insert into em_notifications(workspace_id,thread_id,recipient_id,kind,logical_key,created_at)
    values(${member.workspace_id},${h.thread_id},${ownerId},${notice},${`handoff:${h.id}:${key}`},${now}) on conflict do nothing`
}
