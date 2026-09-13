import 'server-only'
import type { EmailCommand } from '../contracts'
import { projectEmailHandoffToCrm } from '../crm-adapter'
import { holdCallbackTask } from '../crm-history'
import { check, json, workflowHash, type Context } from './core'

type ManagementCommand = Extract<
  EmailCommand,
  { command: 'HAN-REASSIGN' | 'HAN-RESOLVE' | 'HAN-RETURN' }
>

const ACCESS_HOLDS = new Set([
  'team_role_changed',
  'marketing_stopped',
  'clarification_required',
])

function canReleaseAccessHold(h: {
  state: string
  access_hold_reason: string | null
}) {
  return h.state === 'held' && ACCESS_HOLDS.has(h.access_hold_reason ?? '')
}

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
  check(thread && thread.state !== 'done', 'CALLBACK_HELD')
  check(h.state !== 'completed', 'CALLBACK_HELD')

  if (command.command === 'HAN-RETURN')
    return returnForClarification(context, command, h, thread)

  check(
    thread.content_revision === p.contentRevision,
    'NEW_REPLY_REVIEW_REQUIRED',
  )
  check(
    thread.controller_revision === p.controllerRevision,
    'OWNERSHIP_CHANGED',
  )
  const newOwner =
    command.command === 'HAN-REASSIGN'
      ? command.payload.newOwnerId
      : command.payload.ownerId
  check(newOwner !== p.backupId, 'DISTINCT_BACKUP_REQUIRED')
  const members =
    await tx`select m.auth_user_id,m.roles,a.full_name from em_memberships m
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
    return reassignHandoffs(context, command, h, thread, nextOwner.full_name)
  }

  const resolve = command.payload
  check(
    h.state === 'held' &&
      !h.lead_id &&
      !h.crm_task_id &&
      h.crm_sync_state !== 'synced',
    'HANDOFF_NOT_RESOLVABLE',
  )
  check(resolve.factEvidence.length === 1, 'ONE_MESSAGE_EVIDENCE_REQUIRED')
  const evidence = resolve.factEvidence[0]
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
  if (resolve.requestedContact.phone)
    check(
      resolve.requestedContact.phone.replace(/\D/g, '').length >= 10 &&
        evidence.quote
          .replace(/\D/g, '')
          .includes(resolve.requestedContact.phone.replace(/\D/g, '')),
      'PHONE_EVIDENCE_REQUIRED',
    )
  if (resolve.requestedContact.requestedTimeText)
    check(
      evidence.quote.includes(resolve.requestedContact.requestedTimeText),
      'TIME_EVIDENCE_REQUIRED',
    )
  const input = {
    handoffId: h.id,
    threadId: h.thread_id,
    ownerId: newOwner,
    positiveSellerInterest: resolve.positiveSellerInterest,
    evidenceMessageId: evidence.messageId!,
    evidenceQuote: evidence.quote,
    requestedContact: resolve.requestedContact,
  }
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
          reason: resolve.reason,
        }),
      )},${now})`
  await tx`update em_handoffs set owner_id=${newOwner},backup_id=${resolve.backupId},reason=${resolve.reason},
      requested_contact=${tx.json(json(resolve.requestedContact))},fact_evidence=${tx.json(json(resolve.factEvidence))},
      seller_interest_confirmed=${resolve.positiveSellerInterest},crm_sync_state='pending',crm_sync_reason=null,
      access_hold_reason=null,clarification_question=null,clarification_reviewer_id=null,state='needs_contact' where id=${h.id}`
  await tx`update em_crm_handoff_projections set request_hash=${workflowHash(input)},evidence_message_id=${evidence.messageId!},
      owner_auth_user_id=${newOwner},owner_name=${nextOwner.full_name},state='pending',hold_reason=null,completed_at=null where handoff_id=${h.id} and state='held'`
  const bridge = await projectEmailHandoffToCrm(context, input)
  await transfer(
    context,
    { id: h.id, thread_id: h.thread_id },
    newOwner,
    resolve.backupId,
    command.idempotencyKey,
    bridge.state === 'handoff_saved_crm_synced'
      ? 'Callback task ready'
      : 'CRM review needed',
    false,
  )
  return { entityId: h.id, revision: h.revision + 1, state: bridge.state }
}

async function returnForClarification(
  context: Context,
  command: Extract<EmailCommand, { command: 'HAN-RETURN' }>,
  h: {
    id: string
    thread_id: string
    lead_id: string | null
    crm_task_id: string | null
    crm_task_key: string | null
    revision: number
  },
  thread: { id: string; state: string },
) {
  const { tx, member, now } = context
  const p = command.payload
  check(thread.state !== 'stopped' || Boolean(h.lead_id), 'CALLBACK_HELD')
  const [reviewer] =
    await tx`select m.auth_user_id,a.full_name from em_memberships m
    join agent_profiles a on a.id=m.agent_profile_id and a.is_active is distinct from false and (a.user_id is null or a.user_id=m.auth_user_id)
    where m.workspace_id=${member.workspace_id} and m.auth_user_id=${p.reviewerId} and m.active
      and m.roles && array['owner','reviewer']::text[]`
  check(reviewer?.full_name, 'REVIEWER_UNAVAILABLE')
  await tx`update em_send_intents set state='cancelled',cancellation_reason='returned_for_clarification' where workspace_id=${member.workspace_id}
    and thread_id=${h.thread_id} and state in ('queued','held')`
  await tx`update em_drafts set state='stale' where workspace_id=${member.workspace_id} and thread_id=${h.thread_id} and state='current'`
  if (h.crm_task_id) await holdCallbackTask(context, h.thread_id, 'clarification_required')
  await tx`update em_handoffs set revision=revision+1,state='held',access_hold_reason='clarification_required',
    clarification_question=${p.question},clarification_reviewer_id=${p.reviewerId} where id=${h.id}`
  if (thread.state !== 'stopped')
    await tx`update em_threads set controller='human',controller_user_id=${p.reviewerId},responsible_user_id=${p.reviewerId},
      controller_revision=controller_revision+1,state='needs_review' where workspace_id=${member.workspace_id} and id=${h.thread_id}`
  await tx`update em_notifications set acknowledged_at=coalesce(acknowledged_at,${now})
    where workspace_id=${member.workspace_id} and thread_id=${h.thread_id}
    and (logical_key like 'handoff:%' or logical_key like 'handoff-escalation:%')`
  await tx`insert into em_notifications(workspace_id,thread_id,recipient_id,kind,logical_key,created_at)
    values(${member.workspace_id},${h.thread_id},${p.reviewerId},${`Clarification needed: ${p.question}`},${`handoff:${h.id}:clarify:${command.idempotencyKey}`},${now}) on conflict do nothing`
  await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
    values(${member.workspace_id},${member.auth_user_id},'HAN-RETURN-REVIEW',${h.id},${command.idempotencyKey},
    ${tx.json(json({ question: p.question, reviewerId: p.reviewerId, leadId: h.lead_id }))},${now})`
  return {
    entityId: h.id,
    revision: h.revision + 1,
    state: 'returned_for_clarification',
    invalidates: [
      'email:workspace',
      'crm:conversations',
      'crm:work-items',
      ...(h.lead_id ? [`crm:lead:${h.lead_id}`] : []),
    ],
  }
}

async function reassignHandoffs(
  context: Context,
  command: Extract<EmailCommand, { command: 'HAN-REASSIGN' }>,
  h: {
    id: string
    thread_id: string
    lead_id: string | null
    crm_task_id: string | null
    crm_task_key: string | null
    crm_sync_state: string
    state: string
    access_hold_reason: string | null
    revision: number
  },
  thread: { id: string; state: string },
  ownerName: string,
) {
  const { tx, member, now } = context
  const p = command.payload
  check(
    h.crm_sync_state === 'synced' && h.lead_id && h.crm_task_key,
    'LINK_LEAD_FIRST',
  )
  const [repair] =
    await tx`select id from em_crm_projection_repairs where workspace_id=${member.workspace_id}
      and thread_id=${h.thread_id} and state='pending'`
  check(!repair, 'CALLBACK_HELD')
  const releasing = canReleaseAccessHold(h)
  if (thread.state === 'stopped')
    check(h.access_hold_reason === 'marketing_stopped', 'CALLBACK_HELD')
  else check(!['stopped', 'done'].includes(thread.state), 'CALLBACK_HELD')
  const [lead] = await tx`select * from leads where id=${h.lead_id} for update`
  check(
    lead && lead.assigned_agent === command.payload.expectedCrmOwner,
    'CALLBACK_OWNER_CHANGED',
  )
  check(
    !lead.is_parked &&
      !['dead', 'closed_won', 'closed_lost'].includes(lead.station),
    'CRM_RECORD_HELD',
  )
  const siblings =
    await tx`select id,revision,thread_id,crm_task_id,crm_task_key,lead_id,state,crm_sync_state,access_hold_reason
      from em_handoffs where lead_id=${h.lead_id} and id<>${h.id} and state<>'completed' for update`
  if (siblings.length) {
    const related = p.relatedHandoffs ?? []
    check(
      related.length === siblings.length &&
        siblings.every((s) =>
          related.some(
            (r) => r.handoffId === s.id && r.expectedRevision === s.revision,
          ),
        ) &&
        new Set(related.map((r) => r.handoffId)).size === siblings.length,
      'MULTIPLE_HANDOFFS_REQUIRE_REVIEW',
    )
  } else check(!p.relatedHandoffs?.length, 'MULTIPLE_HANDOFFS_REQUIRE_REVIEW')

  await assignCallback(
    context,
    {
      id: h.id,
      crm_task_id: h.crm_task_id,
      crm_task_key: h.crm_task_key,
      lead_id: h.lead_id,
      access_hold_reason: h.access_hold_reason,
      state: h.state,
    },
    ownerName,
    command.idempotencyKey,
    p.reason,
    releasing,
  )
  for (const sibling of siblings) {
    check(
      sibling.crm_sync_state === 'synced' &&
        sibling.crm_task_key &&
        sibling.lead_id === h.lead_id,
      'MULTIPLE_HANDOFFS_REQUIRE_REVIEW',
    )
    const releaseSibling = canReleaseAccessHold(sibling)
    await assignCallback(
      context,
      sibling,
      ownerName,
      `${command.idempotencyKey}:${sibling.id}`,
      p.reason,
      releaseSibling,
    )
    await transfer(
      context,
      { id: sibling.id, thread_id: sibling.thread_id },
      p.newOwnerId,
      p.backupId,
      `${command.idempotencyKey}:${sibling.id}`,
      releaseSibling
        ? 'Callback released — acceptance needed'
        : 'Callback assigned — acceptance needed',
      sibling.state !== 'held' || releaseSibling,
    )
    if (releaseSibling)
      await tx`update em_handoffs set access_hold_reason=null,clarification_question=null,clarification_reviewer_id=null where id=${sibling.id}`
  }
  await tx`update leads set assigned_agent=${ownerName},updated_at=${now} where id=${h.lead_id}`
  const [actor] =
    await tx`select p.full_name from em_memberships m join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id)
    where m.workspace_id=${member.workspace_id} and m.auth_user_id=${member.auth_user_id}`
  await tx`insert into lead_activities(lead_id,activity_type,description,agent,metadata,created_at)
      values(${h.lead_id},'status_change',${`Lead and email callback assigned to ${ownerName}: ${p.reason}`},
      ${actor?.full_name ?? member.auth_user_id},
      ${tx.json({ origin: 'email_marketing', em_handoff_id: h.id, previous_agent: lead.assigned_agent, assigned_agent: ownerName, related_handoffs: siblings.map((s) => s.id) })},${now})`
  await transfer(
    context,
    { id: h.id, thread_id: h.thread_id },
    p.newOwnerId,
    p.backupId,
    command.idempotencyKey,
    releasing
      ? 'Callback released — acceptance needed'
      : 'Callback assigned — acceptance needed',
    true,
  )
  if (releasing)
    await tx`update em_handoffs set access_hold_reason=null,clarification_question=null,clarification_reviewer_id=null where id=${h.id}`
  return {
    entityId: h.id,
    revision: h.revision + 1,
    state: releasing ? 'callback_released' : 'callback_reassigned',
    invalidates: [
      'crm:conversations',
      'crm:work-items',
      `crm:lead:${h.lead_id}`,
    ],
  }
}

async function assignCallback(
  context: Context,
  h: {
    id: string
    crm_task_id: string | null
    crm_task_key: string | null
    lead_id: string | null
    access_hold_reason?: string | null
    state?: string
  },
  ownerName: string,
  key: string,
  reason: string,
  releaseHold: boolean,
) {
  const { tx, member, now } = context
  await tx`select pg_advisory_xact_lock(hashtextextended('work-item:' || ${h.crm_task_key},0))`
  const [item] =
    await tx`select * from work_items where work_item_key=${h.crm_task_key} for update`
  const [source] =
    await tx`select * from lead_activities where id=${h.crm_task_id} for update`
  const holdReason = source?.metadata?.email_hold_reason
  const held =
    item?.status === 'blocked' &&
    ACCESS_HOLDS.has(holdReason) &&
    (h.access_hold_reason === holdReason || releaseHold)
  check(
    item &&
      source?.lead_id === h.lead_id &&
      source.metadata?.em_handoff_id === h.id &&
      source.metadata?.origin === 'email_marketing' &&
      (item.status === 'pending' || (releaseHold && held)),
    'CALLBACK_HELD',
  )
  const metadata = {
    assigned_to: ownerName,
    last_changed_by: member.auth_user_id,
    last_changed_at: now.toISOString(),
    ...(releaseHold
      ? { status: 'pending', email_hold_reason: null }
      : {}),
  }
  await tx`update lead_activities set metadata=metadata || ${tx.json(metadata)} where id=${h.crm_task_id}`
  const [next] =
    await tx`select * from work_items where work_item_key=${h.crm_task_key}`
  check(
    next?.assigned_to === ownerName &&
      next.status === (releaseHold || item.status === 'pending' ? 'pending' : item.status),
    'CRM_CALLBACK_UPDATE_FAILED',
  )
  await tx`insert into work_item_events(work_item_key,idempotency_key,action,actor,previous_state,next_state,metadata)
      values(${h.crm_task_key},${key},${releaseHold ? 'release' : 'reassign'},${member.auth_user_id},${tx.json(item)},${tx.json(next)},
        ${tx.json({ origin: 'email_marketing', reason })})`
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
  const [thread] =
    await tx`select state from em_threads where workspace_id=${member.workspace_id} and id=${h.thread_id}`
  await tx`update em_send_intents set state='cancelled',cancellation_reason='handoff_changed' where workspace_id=${member.workspace_id}
    and thread_id=${h.thread_id} and state in ('queued','held')`
  await tx`update em_drafts set state='stale' where workspace_id=${member.workspace_id} and thread_id=${h.thread_id} and state='current'`
  await tx`update em_handoffs set owner_id=${ownerId},backup_id=${backupId},revision=revision+1,
    state=case when ${resetState} then 'needs_contact' else state end where id=${h.id}`
  if (thread?.state !== 'stopped')
    await tx`update em_threads set responsible_user_id=${ownerId},controller='human',controller_user_id=${ownerId},
      controller_revision=controller_revision+1,state='human' where workspace_id=${member.workspace_id} and id=${h.thread_id}`
  else
    await tx`update em_threads set responsible_user_id=${ownerId} where workspace_id=${member.workspace_id} and id=${h.thread_id}`
  await tx`update em_notifications set acknowledged_at=coalesce(acknowledged_at,${now}) where workspace_id=${member.workspace_id}
    and thread_id=${h.thread_id} and (logical_key like 'handoff:%' or logical_key like 'handoff-escalation:%')`
  await tx`insert into em_notifications(workspace_id,thread_id,recipient_id,kind,logical_key,created_at)
    values(${member.workspace_id},${h.thread_id},${ownerId},${notice},${`handoff:${h.id}:${key}`},${now}) on conflict do nothing`
}
