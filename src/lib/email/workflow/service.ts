import 'server-only'
import { commandAllowedInMode } from './mode'
import { queueIntent } from './queue-intent'
import { readHostedReadiness } from '../setup/readiness'
import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import { projectEmailHandoffToCrm } from '../crm-adapter'
import { projectCrmChanges } from '../crm-repairs'
import { changeCallback, validateCallbackTime } from './callback-actions'
import { retryReceivedJob } from '../inbound/retry'
import { manageHandoff } from './handoff-management'
import { draftWithAri } from '../ai/drafting'
import {
  configuredEmailAiProvider,
  emailAiAvailable,
  type EmailAiProvider,
} from '../ai/provider'
import { emailCommandSchema } from '../contracts'
import { emailWorkspaceConfigSchema } from '../config'
import { pilotFollowUp, pilotFollowUpExpires, pilotSendSlot } from './schedule'
import {
  WorkflowError,
  check,
  json,
  workflowHash,
  type Tx,
  type Member,
  type Context,
  type SuppressionContext,
  type Result,
} from './core'
export { WorkflowError, workflowHash } from './core'
import {
  applySettingsCommand,
  isSettingsCommand,
  readSettings,
} from '../commands/settings'
import type { PilotConfig, PilotReview, PilotState } from './types'

function canManage(member: Member) {
  return member.roles.some((r) => ['owner', 'marketer'].includes(r))
}
function canSeeTeam(member: Member) {
  return member.roles.some((r) => ['owner', 'marketer', 'reviewer'].includes(r))
}
function canWork(member: Member) {
  return member.roles.some((r) =>
    ['owner', 'reviewer', 'acquisitions'].includes(r),
  )
}
async function membership(tx: Tx, subject: string) {
  const [member] = await tx<
    Member[]
  >`select m.workspace_id,m.auth_user_id,m.roles from em_memberships m join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id) where m.auth_user_id=${subject} and m.active`
  check(member, 'NO_EMAIL_MEMBERSHIP', 403)
  return member
}
async function threadFor(context: Context, id: string) {
  const { tx, member } = context
  const [thread] =
    await tx`select * from em_threads where workspace_id=${member.workspace_id} and id=${id} for update`
  check(
    thread &&
      (canSeeTeam(member) ||
        thread.responsible_user_id === member.auth_user_id ||
        thread.controller_user_id === member.auth_user_id),
    'THREAD_NOT_FOUND',
    404,
  )
  return thread
}
export async function requireHuman(
  context: Context,
  id: string,
  contentRevision?: number,
  controllerRevision?: number,
) {
  check(canWork(context.member), 'FORBIDDEN', 403)
  const thread = await threadFor(context, id)
  check(!thread.inbound_pending, 'REPLY_CONTENT_PENDING')
  check(thread.state !== 'stopped', 'THREAD_STOPPED')
  check(thread.state !== 'done', 'THREAD_DONE')
  check(
    thread.controller === 'human' &&
      thread.controller_user_id === context.member.auth_user_id,
    'TAKE_OVER_FIRST',
  )
  if (contentRevision !== undefined)
    check(
      thread.content_revision === contentRevision,
      'NEW_REPLY_REVIEW_REQUIRED',
    )
  if (controllerRevision !== undefined)
    check(
      thread.controller_revision === controllerRevision,
      'OWNERSHIP_CHANGED',
    )
  const assignments =
    await context.tx`select h.id,l.assigned_agent,p.full_name,w.assigned_to
    from em_handoffs h join leads l on l.id=h.lead_id
    left join em_memberships m on m.workspace_id=h.workspace_id and m.auth_user_id=h.owner_id and m.active
    left join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id)
    left join work_items w on w.work_item_key=h.crm_task_key
    where h.workspace_id=${context.member.workspace_id} and h.thread_id=${id} and h.crm_sync_state='synced' and h.state<>'completed' for update of l`
  check(
    assignments.every(
      (a) =>
        a.full_name &&
        a.assigned_agent === a.full_name &&
        a.assigned_to === a.full_name,
    ),
    'CALLBACK_OWNER_CHANGED',
  )
  return thread
}
async function invalidate(context: SuppressionContext, threadId: string, reason: string) {
  await context.tx`update em_send_intents set state='cancelled',cancellation_reason=${reason} where workspace_id=${context.member.workspace_id} and thread_id=${threadId} and state in ('queued','held')`
  await context.tx`update em_drafts set state='stale' where workspace_id=${context.member.workspace_id} and thread_id=${threadId} and state='current'`
  await context.tx`update em_ai_generations set state='stale' where workspace_id=${context.member.workspace_id} and thread_id=${threadId} and state in ('queued','running','ready')`
}
async function notify(
  context: Context,
  threadId: string,
  recipient: string,
  kind: string,
  key: string,
) {
  await context.tx`insert into em_notifications(workspace_id,thread_id,recipient_id,kind,logical_key,created_at)
    values(${context.member.workspace_id},${threadId},${recipient},${kind},${key},${context.now}) on conflict do nothing`
}

/** The workspace lock is the common serialization point for this bounded pilot.
 * Receipt, audit and business writes commit together. No provider I/O occurs
 * within this transaction. Production remote workers remain disabled. */
export async function transact(
  sql: Sql,
  subject: string,
  input: { command: string; idempotencyKey: string },
  now: Date,
  handler: (context: Context) => Promise<Result>,
): Promise<Result> {
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx
    // Resolve again after acquiring the lock: deactivation must not reuse a
    // stale membership cached at the HTTP boundary.
    const initial = await membership(tx, subject)
    const [workspace] =
      await tx`select execution_mode from em_workspaces where id=${initial.workspace_id} for update`
    const member = await membership(tx, subject)
    check(
      isSettingsCommand(input.command) ||
        commandAllowedInMode(input.command, workspace?.execution_mode),
      'WORKSPACE_NOT_READY',
    )
    const [prior] =
      await tx`select payload_hash,result from em_command_receipts where workspace_id=${member.workspace_id} and actor_id=${subject} and idempotency_key=${input.idempotencyKey}`
    const hash = workflowHash(input)
    if (prior) {
      check(prior.payload_hash === hash, 'IDEMPOTENCY_MISMATCH')
      return prior.result as Result
    }
    const result = await handler({ tx, member, now })
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
      values(${member.workspace_id},${subject},${input.command},${result.entityId},${input.idempotencyKey},${tx.json({ state: result.state, transport: workspace.execution_mode })},${now})`
    await tx`insert into em_command_receipts(workspace_id,actor_id,idempotency_key,command,payload_hash,result)
      values(${member.workspace_id},${subject},${input.idempotencyKey},${input.command},${hash},${tx.json(json(result))})`
    return result
  }) as Promise<Result>
}

async function review(
  context: Context,
  campaignId: string,
): Promise<PilotReview> {
  const { tx, member, now } = context
  const [campaign] =
    await tx`select * from em_campaigns where workspace_id=${member.workspace_id} and id=${campaignId}`
  check(campaign, 'CAMPAIGN_NOT_FOUND', 404)
  const [workspace] = await tx`select execution_mode,revision,send_enabled from em_workspaces where id=${member.workspace_id}`
  const config = campaign.draft_config as PilotConfig
  check(config.audienceId && config.steps?.length === 2, 'SAVE_SEQUENCE_FIRST')
  const [snapshot] =
    await tx`select * from em_audience_snapshots where workspace_id=${member.workspace_id} and audience_id=${config.audienceId} order by source_revision desc limit 1`
  check(snapshot, 'RECIPIENT_REVIEW_REQUIRED')
  const rows =
    await tx`select r.id,r.address_id,r.party_id,r.eligibility,r.evidence_hash,
      a.normalized_address,a.verification_state,a.verification_expires_at,a.restriction_revision,
      p.display_name,p.identity_state,
      exists(select 1 from em_suppressions s where s.workspace_id=r.workspace_id and (s.address_id=r.address_id or s.address_id in
        (select pa.address_id from em_party_addresses pa where pa.workspace_id=r.workspace_id and pa.party_id=r.party_id and pa.relationship='confirmed'))) as suppressed,
      exists(select 1 from em_enrollments e where e.workspace_id=r.workspace_id and (e.address_id=r.address_id or e.party_id=r.party_id) and e.state in ('queued','waiting_reply','held','replied')) as enrolled,
      (select count(*) from em_party_addresses pa where pa.workspace_id=r.workspace_id and pa.address_id=r.address_id and pa.relationship in ('confirmed','shared')) as identity_links,
      exists(select 1 from em_party_addresses pa where pa.workspace_id=r.workspace_id and pa.address_id=r.address_id and pa.party_id=r.party_id and pa.relationship='confirmed') as confirmed
    from em_snapshot_rows r join em_addresses a on a.id=r.address_id and a.workspace_id=r.workspace_id
    left join em_parties p on p.id=r.party_id and p.workspace_id=r.workspace_id
    where r.workspace_id=${member.workspace_id} and r.snapshot_id=${snapshot.id} order by r.id`
  const seenAddresses = new Set<string>(),
    seenParties = new Set<string>()
  const recipients = rows.map((r) => {
    const reasons: string[] = []
    if (r.suppressed) reasons.push('Marketing stopped')
    if (r.enrolled)
      reasons.push('Already in an active conversation or campaign')
    if (r.eligibility !== 'eligible')
      reasons.push('Excluded or awaiting review')
    if (
      r.identity_state !== 'confirmed' ||
      !r.confirmed ||
      Number(r.identity_links) !== 1
    )
      reasons.push('Identity needs review')
    if (
      r.verification_state !== 'valid' ||
      !r.verification_expires_at ||
      new Date(r.verification_expires_at) <= now
    )
      reasons.push('Address verification required')
    if (workspace.execution_mode === 'simulation' && !String(r.normalized_address).endsWith('.test'))
      reasons.push('Local pilot accepts fabricated .test addresses only')
    if (seenAddresses.has(r.address_id) || seenParties.has(r.party_id))
      reasons.push('Duplicate person or address')
    if (reasons.length === 0) {
      seenAddresses.add(r.address_id)
      seenParties.add(r.party_id)
    }
    return {
      id: r.id,
      addressId: r.address_id,
      partyId: r.party_id,
      name: r.display_name ?? 'Unresolved person',
      email: r.normalized_address,
      eligible: reasons.length === 0,
      reasons,
    }
  })
  const audienceHash = workflowHash({
    snapshot: snapshot.content_hash,
    recipients,
  })
  const draftHash = workflowHash({
    campaignId,
    revision: campaign.revision,
    workspaceRevision: workspace.revision,
    config,
    audienceHash,
  })
  return {
    campaignId,
    revision: Number(campaign.revision),
    recipients,
    audienceHash,
    draftHash,
    estimateHash: workflowHash({
      draftHash,
      count: recipients.filter((r) => r.eligible).length,
      cost: 0,
    }),
    // This token is explicitly simulation-only, never provider readiness.
    readinessRunId: campaign.id,
  }
}

export async function getPilotReview(
  sql: Sql,
  subject: string,
  campaignId: string,
  now = new Date(),
) {
  return sql.begin('isolation level repeatable read', async (transaction) => {
    const tx = transaction as unknown as Tx
    const member = await membership(tx, subject)
    check(canManage(member), 'FORBIDDEN', 403)
    return review({ tx, member, now }, campaignId)
  }) as Promise<PilotReview>
}


export async function executePilotCommand(
  sql: Sql,
  subject: string,
  raw: unknown,
  now = new Date(),
  aiProvider?: EmailAiProvider | null,
): Promise<Result> {
  const parsed = emailCommandSchema.safeParse(raw)
  check(parsed.success, 'INVALID_COMMAND', 400)
  const command = parsed.data
  if (command.command === 'THR-REGENERATE')
    return draftWithAri(
      sql,
      subject,
      command,
      now,
      aiProvider === undefined ? configuredEmailAiProvider() : aiProvider,
      { transact, requireHuman },
    )
  return transact(sql, subject, command, now, async (context) => {
    const { tx, member } = context
    const ws = member.workspace_id
    if (isSettingsCommand(command.command))
      return applySettingsCommand(context, command)
    if (command.command.startsWith('CAM-'))
      check(canManage(member), 'FORBIDDEN', 403)
    switch (command.command) {
      case 'CAM-CREATE': {
        check(
          command.payload.program === 'seller_outreach',
          'PILOT_SELLER_OUTREACH_ONLY',
          400,
        )
        check(command.payload.name.length <= 120, 'CAMPAIGN_NAME_TOO_LONG', 400)
        const [created] =
          await tx`insert into em_campaigns(workspace_id,name,program,owner_id) values(${ws},${command.payload.name},${command.payload.program},${subject}) returning id,revision`
        return {
          entityId: created.id,
          revision: Number(created.revision),
          state: 'draft',
        }
      }
      case 'CAM-SAVE': {
        check(
          command.entityId && command.expectedRevision !== undefined,
          'REVISION_REQUIRED',
          400,
        )
        const config = command.payload.draftConfig
        check(
          config.steps.length === 2 &&
            config.timezone === 'America/Chicago' &&
            config.startLocal === '09:00' &&
            config.endLocal === '17:00' &&
            config.mode === 'draft_only' &&
            config.copyMode === 'template',
          'UNSUPPORTED_PILOT_SETTINGS',
          400,
        )
        check(
          config.weekdays.length === 5 &&
            ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].every(
              (day) => (config.weekdays as string[]).includes(day),
            ),
          'WEEKDAYS_REQUIRED',
          400,
        )
        check(new Date(config.expiresAt) > now, 'CAMPAIGN_EXPIRED', 400)
        check(
          config.steps.every(
            (step) => !/[{}]/.test(step.subject + step.bodyTemplate),
          ),
          'USE_REVIEWED_LITERAL_COPY',
          400,
        )
        const [audience] =
          await tx`select id from em_audiences where workspace_id=${ws} and id=${config.audienceId} and program='seller_outreach' and state='ready'`
        check(audience, 'RECIPIENT_LIST_NOT_READY')
        const [saved] =
          await tx`update em_campaigns set draft_config=${tx.json(json(config))},revision=revision+1
          where workspace_id=${ws} and id=${command.entityId} and revision=${command.expectedRevision} and state='draft' returning id,revision`
        check(saved, 'DRAFT_CHANGED')
        return {
          entityId: saved.id,
          revision: Number(saved.revision),
          state: 'draft',
        }
      }
      case 'CAM-LAUNCH': {
        const [execution] = await tx`select execution_mode from em_workspaces where id=${ws}`
        if (execution.execution_mode === 'hosted') {
          const readiness = await readHostedReadiness(tx, ws)
          check(readiness.ready && readiness.sendingEnabled, 'HOSTED_LAUNCH_NOT_READY')
        }
        check(command.entityId, 'CAMPAIGN_REQUIRED', 400)
        const [campaign] =
          await tx`select * from em_campaigns where workspace_id=${ws} and id=${command.entityId}`
        check(campaign?.state === 'draft', 'CAMPAIGN_NOT_DRAFT')
        check(
          command.expectedRevision !== undefined &&
            Number(campaign.revision) === command.expectedRevision,
          'DRAFT_CHANGED',
        )
        const current = await review(context, campaign.id)
        check(
          current.draftHash === command.payload.draftHash &&
            current.audienceHash === command.payload.audienceHash &&
            current.estimateHash === command.payload.estimateHash &&
            current.readinessRunId === command.payload.readinessRunId,
          'REVIEW_CHANGED',
        )
        const recipients = current.recipients.filter((r) => r.eligible)
        const config = campaign.draft_config as PilotConfig
        check(
          recipients.length > 0 &&
            recipients.length === command.payload.approvedMaxRecipients &&
            recipients.length <= config.maxRecipients,
          'RECIPIENT_COUNT_CHANGED',
        )
        const [workspace] =
          await tx`select pause_reason from em_workspaces where id=${ws}`
        check(!workspace.pause_reason, 'WORKSPACE_PAUSED')
        const start = pilotSendSlot(
          command.payload.startAt ? new Date(command.payload.startAt) : now,
        )
        check(
          start >= now && start < new Date(config.expiresAt),
          'INVALID_START_TIME',
        )
        const [snapshot] =
          await tx`select id from em_audience_snapshots where workspace_id=${ws} and audience_id=${config.audienceId} order by source_revision desc limit 1`
        const [version] =
          await tx`insert into em_campaign_versions(workspace_id,campaign_id,version_number,snapshot_id,playbook_version_id,config,content_hash,review_hash,published_by)
          values(${ws},${campaign.id},1,${snapshot.id},${config.playbookVersionId},${tx.json(json(config))},${current.draftHash},${current.audienceHash},${subject}) returning id`
        for (const recipient of recipients) {
          const [enrollment] =
            await tx`insert into em_enrollments(workspace_id,campaign_id,campaign_version_id,party_id,address_id) values(${ws},${campaign.id},${version.id},${recipient.partyId},${recipient.addressId}) returning id`
          const [thread] =
            await tx`insert into em_threads(workspace_id,campaign_id,enrollment_id,address_id,party_id,subject,responsible_user_id)
            values(${ws},${campaign.id},${enrollment.id},${recipient.addressId},${recipient.partyId},${config.steps[0].subject},${subject}) returning id`
          await queueIntent(context, {
            threadId: thread.id,
            key: `${enrollment.id}:0`,
            body: config.steps[0].bodyTemplate,
            subject: config.steps[0].subject,
            step: 0,
            origin: 'sequence',
            contentRevision: 0,
            controllerRevision: 0,
            due: start,
            expires: new Date(config.expiresAt),
          })
        }
        const [saved] =
          await tx`update em_campaigns set active_version_id=${version.id},state='active',revision=revision+1 where workspace_id=${ws} and id=${campaign.id} returning revision`
        return {
          entityId: campaign.id,
          revision: Number(saved.revision),
          state: execution.execution_mode === 'hosted' ? 'active' : 'simulation_active',
        }
      }
      case 'CAM-PAUSE': {
        check(command.entityId, 'CAMPAIGN_REQUIRED', 400)
        const [campaign] =
          await tx`update em_campaigns set state='paused',revision=revision+1 where workspace_id=${ws} and id=${command.entityId} and state='active' returning id,revision`
        check(campaign, 'CAMPAIGN_NOT_ACTIVE')
        return {
          entityId: campaign.id,
          revision: Number(campaign.revision),
          state: 'paused',
        }
      }
      case 'THR-TAKEOVER': {
        check(canWork(member), 'FORBIDDEN', 403)
        const thread = await threadFor(context, command.payload.threadId)
        check(thread.state !== 'stopped', 'THREAD_STOPPED')
        check(
          thread.controller_revision ===
            command.payload.expectedControllerRevision,
          'OWNERSHIP_CHANGED',
        )
        check(
          !thread.controller_user_id ||
            thread.controller_user_id === subject ||
            member.roles.includes('owner'),
          'OTHER_AGENT_CONTROLS_THREAD',
        )
        await invalidate(context, thread.id, 'human_takeover')
        await tx`update em_threads set controller='human',controller_user_id=${subject},responsible_user_id=${subject},controller_revision=controller_revision+1,state='human' where id=${thread.id} and workspace_id=${ws}`
        await tx`update em_enrollments set state='held' where workspace_id=${ws} and id=${thread.enrollment_id} and state in ('queued','waiting_reply')`
        return {
          entityId: thread.id,
          state: 'human',
          revision: thread.controller_revision + 1,
        }
      }
      case 'THR-DRAFT': {
        const { threadId, body, contentRevision, controllerRevision } =
          command.payload
        await requireHuman(
          context,
          threadId,
          contentRevision,
          controllerRevision,
        )
        await tx`update em_drafts set state='stale' where workspace_id=${ws} and thread_id=${threadId} and state='current'`
        const bodyHash = workflowHash(body)
        const [draft] =
          await tx`insert into em_drafts(workspace_id,thread_id,author_id,body,body_hash,content_revision,controller_revision)
          values(${ws},${threadId},${subject},${body},${bodyHash},${contentRevision},${controllerRevision}) returning id`
        return { entityId: draft.id, state: 'draft_saved', bodyHash }
      }
      case 'THR-SEND': {
        const p = command.payload
        const [draft] =
          await tx`select * from em_drafts where workspace_id=${ws} and id=${p.draftId} and author_id=${subject}`
        check(
          draft?.state === 'current' && draft.body_hash === p.bodyHash,
          'DRAFT_CHANGED',
        )
        const thread = await requireHuman(
          context,
          draft.thread_id,
          p.contentRevision,
          p.controllerRevision,
        )
        check(
          draft.content_revision === p.contentRevision &&
            draft.controller_revision === p.controllerRevision,
          'DRAFT_CHANGED',
        )
        const [restriction] =
          await tx`select id from em_suppressions where workspace_id=${ws} and address_id=${thread.address_id}`
        check(!restriction, 'MARKETING_STOPPED')
        const [queued] =
          await tx`select id from em_send_intents where workspace_id=${ws} and thread_id=${thread.id}
          and origin='human' and state='queued'`
        check(!queued, 'REPLY_ALREADY_QUEUED')
        const id = await queueIntent(context, {
          threadId: thread.id,
          key: `draft:${draft.id}`,
          body: draft.body,
          subject: thread.subject,
          step: 0,
          origin: 'human',
          contentRevision: p.contentRevision,
          controllerRevision: p.controllerRevision,
          due: pilotSendSlot(now),
          expires: new Date(now.getTime() + 7 * 86400000),
        })
        await tx`update em_drafts set state='sent' where workspace_id=${ws} and id=${draft.id}`
        const [mode] = await tx`select execution_mode from em_workspaces where id=${ws}`
        return { entityId: id, state: mode.execution_mode === 'hosted' ? 'queued' : 'queued_simulation' }
      }
      case 'THR-HANDOFF': {
        const p = command.payload
        check(command.expectedRevision !== undefined, 'REVISION_REQUIRED', 400)
        check(p.factEvidence.length === 1, 'ONE_MESSAGE_EVIDENCE_REQUIRED', 400)
        const thread = await requireHuman(
          context,
          p.threadId,
          command.expectedRevision,
        )
        const members =
          await tx`select m.auth_user_id,m.roles from em_memberships m join agent_profiles a on a.id=m.agent_profile_id and a.is_active is distinct from false and (a.user_id is null or a.user_id=m.auth_user_id) where m.workspace_id=${ws} and m.auth_user_id in (${p.ownerId},${p.backupId}) and m.active`
        check(
          [p.ownerId, p.backupId].every((id) =>
            members.some(
              (m) =>
                m.auth_user_id === id &&
                m.roles.some((r: string) =>
                  ['owner', 'acquisitions'].includes(r),
                ),
            ),
          ),
          'ASSIGNEE_UNAVAILABLE',
        )
        check(p.ownerId !== p.backupId, 'DISTINCT_BACKUP_REQUIRED', 400)
        for (const evidence of p.factEvidence) {
          check(
            evidence.source === 'message' &&
              evidence.messageId &&
              evidence.quote,
            'MESSAGE_EVIDENCE_REQUIRED',
            400,
          )
          const [message] =
            await tx`select text_body from em_messages where workspace_id=${ws} and thread_id=${thread.id} and id=${evidence.messageId} and direction='inbound'`
          check(
            message && message.text_body.includes(evidence.quote),
            'EVIDENCE_CHANGED',
          )
        }
        const [latestInbound] =
          await tx`select id from em_messages where workspace_id=${ws} and thread_id=${thread.id} and direction='inbound' order by sequence desc limit 1`
        check(
          latestInbound?.id === p.factEvidence[0].messageId,
          'NEW_REPLY_REVIEW_REQUIRED',
        )
        const quoted = p.factEvidence.map((e) => e.quote).join(' ')
        if (p.requestedContact.phone)
          check(
            quoted
              .replace(/\D/g, '')
              .includes(p.requestedContact.phone.replace(/\D/g, '')) &&
              p.requestedContact.phone.replace(/\D/g, '').length >= 10,
            'PHONE_EVIDENCE_REQUIRED',
          )
        if (p.requestedContact.requestedTimeText)
          check(
            quoted.includes(p.requestedContact.requestedTimeText),
            'TIME_EVIDENCE_REQUIRED',
          )
        const [handoff] =
          await tx`insert into em_handoffs(workspace_id,thread_id,owner_id,backup_id,reason,requested_contact,fact_evidence,seller_interest_confirmed,crm_sync_state,created_at)
          values(${ws},${thread.id},${p.ownerId},${p.backupId},${p.reason},${tx.json(json(p.requestedContact))},${tx.json(json(p.factEvidence))},${p.positiveSellerInterest},'pending',${now}) on conflict(thread_id) do nothing returning id`
        check(handoff, 'HANDOFF_ALREADY_EXISTS')
        await invalidate(context, thread.id, 'handoff')
        await tx`update em_threads set responsible_user_id=${p.ownerId},controller_user_id=${p.ownerId},outcome='call_requested',controller_revision=controller_revision+1 where workspace_id=${ws} and id=${thread.id}`
        const evidence = p.factEvidence[0]
        const bridge = await projectEmailHandoffToCrm(context, {
          handoffId: handoff.id,
          threadId: thread.id,
          ownerId: p.ownerId,
          positiveSellerInterest: p.positiveSellerInterest,
          evidenceMessageId: evidence.messageId!,
          evidenceQuote: evidence.quote!,
          requestedContact: p.requestedContact,
        })
        await notify(
          context,
          thread.id,
          p.ownerId,
          bridge.state === 'handoff_saved_crm_synced'
            ? 'Callback task ready'
            : bridge.state === 'handoff_saved_crm_review'
              ? 'CRM review needed'
              : 'CRM connection needs attention',
          `handoff:${handoff.id}`,
        )
        return {
          entityId: handoff.id,
          state: bridge.state,
          invalidates: [
            'email:workspace',
            ...(bridge.leadId ? [`crm:lead:${bridge.leadId}`] : []),
            ...(bridge.leadId ? ['crm:conversations', 'crm:work-items'] : []),
          ],
        }
      }
      case 'THR-SCHEDULE': {
        const p = command.payload
        const thread = await requireHuman(
          context,
          p.threadId,
          p.contentRevision,
          p.controllerRevision,
        )
        check(thread.lead_id, 'LINK_LEAD_FIRST')
        const [held] =
          await tx`select id from em_crm_projection_repairs where workspace_id=${ws} and thread_id=${thread.id} and state='pending' limit 1`
        check(!held, 'CALLBACK_HELD')
        const [lead] =
          await tx`select id,is_parked,station from leads where id=${thread.lead_id} for update`
        check(
          lead &&
            !lead.is_parked &&
            !['dead', 'closed_won', 'closed_lost'].includes(lead.station),
          'CRM_RECORD_HELD',
        )
        const [assignee] = await tx`select p.full_name from em_memberships m
          join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id)
          where m.workspace_id=${ws} and m.auth_user_id=${p.assigneeId} and m.active
          and m.roles && array['owner','reviewer','acquisitions']::text[]`
        check(assignee?.full_name, 'TASK_ASSIGNEE_UNAVAILABLE', 403)
        const [actor] =
          await tx`select p.full_name from em_memberships m join agent_profiles p on p.id=m.agent_profile_id where m.workspace_id=${ws} and m.auth_user_id=${subject}`
        const start = new Date(p.startAt)
        if (['callback', 'follow_up', 'appointment'].includes(p.kind))
          validateCallbackTime(start, now)
        else check(start > now, 'INVALID_TASK_TIME')
        const [created] =
          await tx`select create_work_item_v2(${actor.full_name},${`email-schedule:${ws}:${command.idempotencyKey}`},${thread.lead_id},${p.kind},${p.title},${p.note},${start},${assignee.full_name},'acquisitions','acquisitions','normal',false,
          ${tx.json({ origin: 'email_marketing', em_thread_id: thread.id, email_task_notes: p.note, calendar_booking_verified: false })}) as result`
        const task = created?.result?.workItem
        check(
          task?.source_id &&
            task.lead_id === thread.lead_id &&
            task.assigned_to === assignee.full_name &&
            task.kind === p.kind &&
            new Date(task.due_at).getTime() === start.getTime(),
          'CRM_TASK_CREATE_FAILED',
        )
        await notify(
          context,
          thread.id,
          p.assigneeId,
          'task_assigned',
          `scheduled-task:${task.source_id}`,
        )
        return {
          entityId: task.source_id,
          state:
            p.kind === 'appointment'
              ? 'appointment_task_created'
              : 'task_created',
          invalidates: [
            'email:workspace',
            'crm:work-items',
            `crm:lead:${thread.lead_id}`,
          ],
        }
      }
      case 'THR-NOTE': {
        check(canWork(member), 'FORBIDDEN', 403)
        const thread = await threadFor(context, command.payload.threadId)
        check(thread.lead_id, 'LINK_LEAD_FIRST')
        const [actor] =
          await tx`select p.full_name from em_memberships m join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id)
          where m.workspace_id=${ws} and m.auth_user_id=${subject}`
        const [note] =
          await tx`insert into lead_activities(lead_id,activity_type,description,agent,metadata,created_at)
          values(${thread.lead_id},'note',${command.payload.body},${actor.full_name},
          ${tx.json({ origin: 'email_marketing', em_thread_id: thread.id })},${now}) returning id`
        return { entityId: note.id, state: 'note_saved' }
      }
      case 'HAN-REASSIGN':
      case 'HAN-RESOLVE': {
        check(canWork(member), 'FORBIDDEN', 403)
        const [h] =
          await tx`select thread_id from em_handoffs where workspace_id=${ws} and id=${command.payload.handoffId}`
        check(h, 'HANDOFF_NOT_FOUND', 404)
        await threadFor(context, h.thread_id)
        return manageHandoff(context, command)
      }
      case 'HAN-SCHEDULE':
      case 'HAN-OUTCOME':
      case 'HAN-ACCEPT': {
        const p = command.payload
        const [h] =
          await tx`select thread_id from em_handoffs where workspace_id=${ws} and id=${p.handoffId}`
        check(h, 'HANDOFF_NOT_FOUND', 404)
        const revision = 'contentRevision' in p ? p.contentRevision : undefined
        if (command.command !== 'HAN-ACCEPT')
          check(revision !== undefined, 'REVISION_REQUIRED')
        await requireHuman(context, h.thread_id, revision)
        if (command.command === 'HAN-SCHEDULE') {
          const p = command.payload
          check(p.mode === 'task', 'CALENDAR_NOT_CONNECTED')
          check(p.timezone === 'America/Chicago', 'CHICAGO_TIMEZONE_REQUIRED')
          const start = new Date(p.startAt)
          validateCallbackTime(start, now)
          await invalidate(context, h.thread_id, 'callback_scheduled')
          return changeCallback(
            context,
            p.handoffId,
            command.expectedRevision,
            { dueAt: start, title: p.title, note: p.note },
            command.idempotencyKey,
          )
        }
        if (command.command === 'HAN-OUTCOME') {
          const p = command.payload
          const remainsOpen =
            p.outcome === 'follow_up' || p.outcome === 'no_contact'
          check(
            !p.completedAt || new Date(p.completedAt) <= now,
            'INVALID_OUTCOME_TIME',
          )
          check(
            !remainsOpen || (p.nextDueAt && p.nextAction),
            'NEXT_ACTION_REQUIRED',
          )
          const dueAt = remainsOpen ? new Date(p.nextDueAt!) : undefined
          if (dueAt) validateCallbackTime(dueAt, now)
          await invalidate(context, h.thread_id, 'callback_outcome')
          return changeCallback(
            context,
            p.handoffId,
            command.expectedRevision,
            {
              outcome: p.outcome,
              outcomeNote: p.note,
              ...(remainsOpen
                ? { dueAt, title: p.nextAction }
                : { completeNote: p.note }),
            },
            command.idempotencyKey,
          )
        }
        return changeCallback(
          context,
          p.handoffId,
          command.expectedRevision,
          { accept: true },
          command.idempotencyKey,
        )
      }
      case 'THR-CLOSE': {
        check(command.payload.closed, 'REOPEN_NOT_SUPPORTED')
        check(canWork(member), 'FORBIDDEN', 403)
        const t = await threadFor(context, command.payload.threadId)
        check(t.controller_user_id === subject, 'TAKE_OVER_FIRST')
        check(t.state !== 'stopped', 'THREAD_STOPPED')
        check(
          command.expectedRevision === t.content_revision,
          'NEW_REPLY_REVIEW_REQUIRED',
        )
        const [open] =
          await tx`select id from em_handoffs where workspace_id=${ws} and thread_id=${t.id} and state<>'completed'`
        check(!open, 'FINISH_CALLBACK_FIRST')
        await invalidate(context, t.id, 'thread_closed')
        await tx`update em_threads set state=${command.payload.closed ? 'done' : 'human'} where id=${t.id}`
        return {
          entityId: t.id,
          state: command.payload.closed ? 'conversation_done' : 'human',
        }
      }
      case 'SUP-ADD': {
        check(canWork(member), 'FORBIDDEN', 403)
        check(
          command.payload.scope === 'all_marketing' &&
            command.payload.addressIds?.length === 1 &&
            !command.payload.partyIds &&
            !command.payload.importId,
          'PILOT_ADDRESS_SUPPRESSION_ONLY',
          400,
        )
        const addressId = command.payload.addressIds[0]
        const [thread] =
          await tx`select id from em_threads where workspace_id=${ws} and address_id=${addressId} order by created_at desc limit 1`
        check(thread, 'THREAD_NOT_FOUND', 404)
        await threadFor(context, thread.id)
        await suppress(context, addressId, command.payload.reason)
        return { entityId: addressId, state: 'marketing_stopped' }
      }
      case 'NTF-ACK': {
        const [notice] =
          await tx`update em_notifications set acknowledged_at=coalesce(acknowledged_at,${now}) where workspace_id=${ws} and id=${command.payload.eventId} and recipient_id=${subject} returning id`
        check(notice, 'NOTIFICATION_NOT_FOUND', 404)
        return { entityId: notice.id, state: 'acknowledged' }
      }
      case 'OPS-REPLAY': {
        check(member.roles.includes('owner'), 'FORBIDDEN', 403)
        const p = command.payload
        const [receiving] =
          await tx`select id from em_jobs where workspace_id=${ws} and id=${p.jobId} and kind='resend_receive_content'`
        if (receiving)
          return retryReceivedJob(
            context,
            p.jobId,
            p.expectedFailureCode,
            p.reason,
            command.idempotencyKey,
          )
        const [repair] =
          await tx`select * from em_crm_projection_repairs where workspace_id=${ws} and id=${p.jobId} for update`
        check(repair, 'CRM_REPAIR_NOT_FOUND', 404)
        check(
          repair.state === 'pending' &&
            repair.last_error_code === p.expectedFailureCode,
          'CRM_REPAIR_CHANGED',
        )
        await projectCrmChanges(context, repair.thread_id, {})
        const [next] =
          await tx`select state from em_crm_projection_repairs where workspace_id=${ws} and id=${repair.id}`
        await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
          values(${ws},${subject},'CRM-REPAIR-ATTEMPT',${repair.id},${command.idempotencyKey},
            ${tx.json({ reason: p.reason, priorFailureCode: p.expectedFailureCode, state: next.state })},${now})`
        return {
          entityId: repair.id,
          state:
            next.state === 'resolved'
              ? 'crm_repair_resolved'
              : 'crm_repair_pending',
          invalidates: [
            'email:workspace',
            'crm:conversations',
            'crm:work-items',
          ],
        }
      }
      default:
        throw new WorkflowError('ACTION_NOT_IMPLEMENTED', 422)
    }
  })
}

export async function suppress(
  context: SuppressionContext,
  addressId: string,
  reason: string,
  evidenceId?: string,
) {
  const { tx, member, now } = context,
    ws = member.workspace_id
  // Follow only unambiguous confirmed aliases. Shared addresses stop themselves
  // but must never silently identify or merge multiple people.
  const aliases =
    await tx`select distinct a.id from em_addresses a where a.workspace_id=${ws} and (a.id=${addressId} or a.id in (
    select alias.address_id from em_party_addresses source join em_party_addresses alias on alias.workspace_id=source.workspace_id and alias.party_id=source.party_id
    where source.workspace_id=${ws} and source.address_id=${addressId} and source.relationship='confirmed' and alias.relationship='confirmed'
      and (select count(*) from em_party_addresses p where p.workspace_id=${ws} and p.address_id=${addressId} and p.relationship in ('confirmed','shared'))=1))`
  for (const alias of aliases) {
    await tx`insert into em_suppressions(workspace_id,address_id,reason,evidence_message_id,created_by,effective_at)
      values(${ws},${alias.id},${reason},${evidenceId ?? null},${member.auth_user_id},${now}) on conflict(workspace_id,address_id) do nothing`
    await tx`update em_addresses set restriction_revision=restriction_revision+1 where workspace_id=${ws} and id=${alias.id}`
    const threads =
      await tx`select id from em_threads where workspace_id=${ws} and address_id=${alias.id}`
    for (const thread of threads) {
      await invalidate(context, thread.id, 'marketing_stopped')
      await tx`update em_threads set state='stopped',outcome=case when ${reason}='unsubscribe' then 'unsubscribed' else outcome end,controller_revision=controller_revision+1 where workspace_id=${ws} and id=${thread.id}`
      await tx`update em_handoffs set state='held',revision=revision+1 where workspace_id=${ws} and thread_id=${thread.id} and state<>'completed'`
      await projectCrmChanges(context, thread.id, {
        history: true,
        holdReason: 'marketing_stopped',
      })
    }
    await tx`update em_enrollments set state='suppressed' where workspace_id=${ws} and address_id=${alias.id} and state in ('queued','waiting_reply','held','replied')`
  }
}

/** Test-only transport entry points. Not exposed by the CRM API. */
export async function simulateInbound(
  sql: Sql,
  subject: string,
  input: { threadId: string; eventId: string; body: string },
  now = new Date(),
) {
  check(
    input.body.trim().length > 0 && input.body.length <= 10000,
    'INVALID_MESSAGE',
    400,
  )
  return transact(
    sql,
    subject,
    { command: 'LOCAL-INBOUND', idempotencyKey: input.eventId, ...input },
    now,
    async (context) => {
      check(canManage(context.member), 'FORBIDDEN', 403)
      const { tx, member } = context,
        ws = member.workspace_id
      const thread = await threadFor(context, input.threadId)
      check(
        await tx`select id from em_messages where workspace_id=${ws} and thread_id=${thread.id} and direction='outbound'`.then(
          (rows) => rows.length > 0,
        ),
        'NO_OUTBOUND_MESSAGE',
      )
      const eventKey = `inbound:${input.eventId}`
      const [prior] =
        await tx`select id,thread_id,content_hash from em_messages where workspace_id=${ws} and event_key=${eventKey}`
      if (prior) {
        check(
          prior.thread_id === thread.id &&
            prior.content_hash === workflowHash(input.body),
          'EVENT_PAYLOAD_MISMATCH',
        )
        return { entityId: prior.id, state: 'already_received' }
      }
      const [message] =
        await tx`insert into em_messages(workspace_id,thread_id,direction,text_body,subject,transport,event_key,content_hash,occurred_at,sequence)
      values(${ws},${thread.id},'inbound',${input.body},${thread.subject},'simulation',${eventKey},${workflowHash(input.body)},${now},${thread.content_revision + 1}) returning id`
      await invalidate(context, thread.id, 'inbound_received')
      await tx`update em_threads set content_revision=content_revision+1,last_message_at=${now},state=case when state='stopped' then state else 'needs_review' end where workspace_id=${ws} and id=${thread.id}`
      await tx`update em_enrollments set state='replied' where workspace_id=${ws} and id=${thread.enrollment_id} and state<>'suppressed'`
      await notify(
        context,
        thread.id,
        thread.responsible_user_id,
        'Reply needs review',
        eventKey,
      )
      // Conservative exact opt-out recognition for local fixtures. All other
      // inbound stays on human review; no AI classification claim is made.
      if (/\b(unsubscribe|stop emailing|remove me)\b/i.test(input.body))
        await suppress(context, thread.address_id, 'unsubscribe', message.id)
      else await projectCrmChanges(context, thread.id, { history: true })
      return { entityId: message.id, state: 'received_sequence_stopped' }
    },
  )
}

export async function simulateDelivery(
  sql: Sql,
  subject: string,
  requestId: string = randomUUID(),
  now = new Date(),
) {
  return transact(
    sql,
    subject,
    { command: 'LOCAL-DELIVER', idempotencyKey: requestId },
    now,
    async (context) => {
      const { tx, member } = context,
        ws = member.workspace_id
      check(canManage(member), 'FORBIDDEN', 403)
      const [workspace] =
        await tx`select pause_reason from em_workspaces where id=${ws}`
      check(!workspace.pause_reason, 'WORKSPACE_PAUSED')
      if (pilotSendSlot(now).getTime() !== now.getTime())
        return { entityId: ws, state: 'outside_weekday_sending_hours' }
      // Bounded to one acceptance per tick: resumption cannot drain a backlog.
      const due =
        await tx`select i.*,t.address_id,t.party_id,t.responsible_user_id,t.controller_user_id,t.controller,t.state as thread_state,t.content_revision,t.controller_revision,t.enrollment_id,
        e.campaign_version_id,c.state as campaign_state
      from em_send_intents i join em_threads t on t.id=i.thread_id and t.workspace_id=i.workspace_id
      join em_enrollments e on e.id=t.enrollment_id and e.workspace_id=t.workspace_id
      join em_campaigns c on c.id=t.campaign_id and c.workspace_id=t.workspace_id
      where i.workspace_id=${ws} and i.state='queued' and i.not_before<=${now}
      order by case when i.origin='human' then 0 else 1 end,i.not_before,i.id`
      let waitingCapacity = false
      for (const intent of due) {
        if (intent.origin === 'sequence' && intent.campaign_state !== 'active')
          continue
        const [restriction] =
          await tx`select id from em_suppressions where workspace_id=${ws} and (address_id=${intent.address_id} or address_id in
        (select pa.address_id from em_party_addresses pa where pa.workspace_id=${ws} and pa.party_id=${intent.party_id} and pa.relationship='confirmed')) limit 1`
        const [address] =
          await tx`select normalized_address,verification_state,verification_expires_at from em_addresses where workspace_id=${ws} and id=${intent.address_id}`
        const [responsible] =
          await tx`select m.auth_user_id from em_memberships m join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id) where m.workspace_id=${ws} and m.auth_user_id=${intent.responsible_user_id} and m.active and m.roles && array['owner','marketer','reviewer','acquisitions']::text[]`
        const controllerActive =
          intent.controller !== 'human' ||
          (
            await tx`select m.auth_user_id from em_memberships m join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id) where m.workspace_id=${ws} and m.auth_user_id=${intent.controller_user_id} and m.active and m.roles && array['owner','reviewer','acquisitions']::text[]`
          ).length > 0
        const stale =
          intent.expected_content_revision !== intent.content_revision ||
          intent.expected_controller_revision !== intent.controller_revision
        if (
          restriction ||
          intent.thread_state === 'stopped' ||
          stale ||
          (intent.origin === 'sequence' && intent.controller !== 'none')
        ) {
          await tx`update em_send_intents set state='cancelled',cancellation_reason='dispatch_guard' where workspace_id=${ws} and id=${intent.id}`
          continue
        }
        if (
          !responsible ||
          !controllerActive ||
          !address?.normalized_address.endsWith('.test') ||
          address.verification_state !== 'valid' ||
          !address.verification_expires_at ||
          new Date(address.verification_expires_at) <= now ||
          workflowHash(intent.frozen_payload) !== intent.payload_hash
        ) {
          await tx`update em_send_intents set state='held',cancellation_reason='readiness_changed' where workspace_id=${ws} and id=${intent.id}`
          await tx`update em_threads set state='needs_review' where workspace_id=${ws} and id=${intent.thread_id}`
          continue
        }
        if (new Date(intent.expires_at) <= now) {
          await tx`update em_send_intents set state='held',cancellation_reason='window_expired' where workspace_id=${ws} and id=${intent.id}`
          await tx`update em_threads set state='needs_review' where workspace_id=${ws} and id=${intent.thread_id}`
          continue
        }
        const [version] =
          await tx`select config,campaign_id from em_campaign_versions where workspace_id=${ws} and id=${intent.campaign_version_id}`
        const config = version.config as PilotConfig
        const [usage] = await tx`select
        count(*) filter(where i.accepted_at >= date_trunc('day',${now}::timestamptz at time zone 'America/Chicago') at time zone 'America/Chicago')::int as day,
        count(*) filter(where i.accepted_at > ${new Date(now.getTime() - 3600000)})::int as hour,
        count(*) filter(where t.campaign_id=${version.campaign_id} and i.accepted_at >= date_trunc('day',${now}::timestamptz at time zone 'America/Chicago') at time zone 'America/Chicago')::int as campaign_day,
        count(*) filter(where t.campaign_id=${version.campaign_id} and i.accepted_at > ${new Date(now.getTime() - 3600000)})::int as campaign_hour
        from em_send_intents i join em_threads t on t.workspace_id=i.workspace_id and t.id=i.thread_id
        where i.workspace_id=${ws} and i.state='accepted_simulated' and i.accepted_at<=${now}`
        // Shared pilot caps cannot be multiplied by creating another campaign.
        if (
          usage.day >= 10 ||
          usage.hour >= 2 ||
          usage.campaign_day >= config.dailyLimit ||
          usage.campaign_hour >= config.hourlyLimit
        ) {
          waitingCapacity = true
          continue
        }
        const body = intent.frozen_payload as { body: string; subject: string }
        await tx`insert into em_messages(workspace_id,thread_id,intent_id,direction,text_body,subject,transport,event_key,content_hash,occurred_at,sequence)
        values(${ws},${intent.thread_id},${intent.id},'outbound',${body.body},${body.subject},'simulation',${`intent:${intent.id}`},${workflowHash(body)},${now},${intent.content_revision + 1})`
        await tx`update em_send_intents set state='accepted_simulated',accepted_at=${now} where workspace_id=${ws} and id=${intent.id}`
        await tx`update em_threads set content_revision=content_revision+1,last_message_at=${now},state='waiting' where workspace_id=${ws} and id=${intent.thread_id}`
        await tx`update em_drafts set state='stale' where workspace_id=${ws} and thread_id=${intent.thread_id} and state='current'`
        await projectCrmChanges(context, intent.thread_id, { history: true })
        if (intent.origin === 'sequence' && intent.step === 0) {
          const due = pilotFollowUp(now)
          // The last permitted slot ends on local calendar day 10, even across DST.
          const end = new Date(
            Math.min(
              pilotFollowUpExpires(now).getTime(),
              new Date(config.expiresAt).getTime(),
            ),
          )
          if (end > due) {
            await queueIntent(context, {
              threadId: intent.thread_id,
              key: `${intent.enrollment_id}:1`,
              body: config.steps[1].bodyTemplate,
              subject: config.steps[1].subject,
              step: 1,
              origin: 'sequence',
              contentRevision: intent.content_revision + 1,
              controllerRevision: intent.controller_revision,
              due,
              expires: end,
            })
            await tx`update em_enrollments set state='waiting_reply' where workspace_id=${ws} and id=${intent.enrollment_id}`
          } else
            await tx`update em_enrollments set state='completed' where workspace_id=${ws} and id=${intent.enrollment_id}`
        } else if (intent.origin === 'sequence')
          await tx`update em_enrollments set state='completed' where workspace_id=${ws} and id=${intent.enrollment_id}`
        return { entityId: intent.id, state: 'accepted_simulated' }
      }
      return {
        entityId: ws,
        state: waitingCapacity
          ? 'waiting_for_shared_capacity'
          : 'no_due_messages',
      }
    },
  )
}

export async function readPilotState(
  sql: Sql,
  subject: string,
  now = new Date(),
): Promise<PilotState> {
  return sql.begin('isolation level repeatable read', async (transaction) => {
    const tx = transaction as unknown as Tx
    const member = await membership(tx, subject),
      ws = member.workspace_id
    const [workspace] =
      await tx`select execution_mode,pause_reason,config,send_enabled from em_workspaces where id=${ws}`
    const team = canSeeTeam(member)
    const threads =
      await tx`select t.*,p.display_name as name,a.normalized_address as email,c.name as campaign_name,
      h.id as handoff_id,h.state as handoff_state,h.requested_contact,
      h.owner_id as handoff_owner_id,h.backup_id as handoff_backup_id,
      h.crm_sync_state,h.crm_sync_reason,h.crm_task_id,h.crm_task_key,
      h.revision as handoff_revision,h.scheduled_for,
      (select jsonb_build_object('id',g.id,'state',g.state,'model',g.model,'output',g.output,'created_at',g.created_at,'estimated_cost_usd',g.estimated_cost_usd,
        'input_tokens',g.input_tokens,'output_tokens',g.output_tokens,'content_revision',g.content_revision,'controller_revision',g.controller_revision,'failure_code',g.failure_code)
        from em_ai_generations g where g.workspace_id=t.workspace_id and g.thread_id=t.id order by g.created_at desc,g.id desc limit 1) as ai_generation,
      l.assigned_agent as crm_owner_name,
      (h.crm_sync_state='synced' and h.state<>'completed' and
        (l.assigned_agent is distinct from ho.full_name or w.assigned_to is distinct from ho.full_name)) as callback_owner_changed,
      (select count(*)::int from work_items wi where wi.lead_id=t.lead_id and wi.status in ('pending','blocked')) as open_task_count,
      coalesce((select jsonb_agg(jsonb_build_object('key',wi.work_item_key,'source_id',wi.source_id,'title',wi.title,'kind',wi.kind,'status',wi.status,'due_at',wi.due_at,'assigned_to',wi.assigned_to,
        'notes',coalesce(wi.source_metadata->>'email_task_notes',wi.source_metadata->>'notes')) order by wi.due_at nulls last,wi.work_item_key)
        from (select * from work_items where lead_id=t.lead_id and status in ('pending','blocked') order by due_at nulls last,work_item_key limit 50) wi),'[]'::jsonb) as open_tasks,
      w.title as callback_title,
      (select metadata->>'email_task_notes' from lead_activities where id=h.crm_task_id) as callback_notes,
      (select case when i.state in ('held','uncertain','rejected') or (i.state='dispatching' and i.first_attempt_at<${now}::timestamptz-interval '2 minutes') then i.state else null end from em_send_intents i where i.workspace_id=t.workspace_id and i.thread_id=t.id order by i.created_at desc,i.id desc limit 1) as sending_issue,
      exists(select 1 from em_messages m where m.thread_id=t.id and m.direction='outbound') as has_outbound,
      exists(select 1 from em_send_intents i where i.thread_id=t.id and i.origin='human' and i.state='queued') as reply_queued,
      (select min(i.not_before) from em_send_intents i where i.thread_id=t.id and i.state='queued') as next_email_at,
      (select to_jsonb(cp) from em_party_properties ep join crm_properties cp on cp.id=ep.canonical_property_id
       where ep.workspace_id=t.workspace_id and ep.party_id=t.party_id and ep.relationship='owner'
       and (select count(*) from em_party_properties ep2 where ep2.workspace_id=t.workspace_id and ep2.party_id=t.party_id and ep2.relationship='owner')=1) as property,
      coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'body',n.description,'author',n.agent,'created_at',n.created_at) order by n.created_at desc,n.id)
        from (select * from lead_activities where lead_id=t.lead_id and activity_type='note' order by created_at desc,id limit 30) n),'[]'::jsonb) as notes,
      coalesce(r.history_required,false) as crm_history_repair_required,
      coalesce(r.callback_hold_required,false) as crm_callback_repair_required,
      r.id as crm_repair_id,r.last_error_code as crm_repair_error_code,
      w.status as callback_task_state,w.due_at as callback_due_at,
      l.station as lead_stage,l.classification as lead_classification,l.source as lead_source
      from em_threads t join em_parties p on p.id=t.party_id and p.workspace_id=t.workspace_id
      join em_addresses a on a.id=t.address_id and a.workspace_id=t.workspace_id
      join em_campaigns c on c.id=t.campaign_id and c.workspace_id=t.workspace_id
      left join em_handoffs h on h.thread_id=t.id and h.workspace_id=t.workspace_id
      left join em_memberships hm on hm.workspace_id=t.workspace_id and hm.auth_user_id=h.owner_id
      left join agent_profiles ho on ho.id=hm.agent_profile_id and ho.is_active is distinct from false and (ho.user_id is null or ho.user_id=hm.auth_user_id)
      left join em_crm_projection_repairs r on r.thread_id=t.id and r.workspace_id=t.workspace_id and r.state='pending'
      left join leads l on l.id=t.lead_id
      left join work_items w on w.source_kind='activity' and w.source_id=h.crm_task_id
      where t.workspace_id=${ws} and (${team} or t.responsible_user_id=${subject} or t.controller_user_id=${subject})
      order by t.last_message_at desc nulls last,t.id limit 500`
    const ids = threads.map((t) => t.id)
    const messages = ids.length
      ? await tx`select id,thread_id,direction,text_body,occurred_at,transport from em_messages where workspace_id=${ws} and thread_id = any(${tx.array(ids)}::uuid[]) order by thread_id,sequence`
      : []
    const drafts = ids.length
      ? await tx`select id,thread_id,body,body_hash,content_revision,controller_revision,state from em_drafts where workspace_id=${ws} and thread_id = any(${tx.array(ids)}::uuid[]) and author_id=${subject} order by created_at`
      : []
    const campaigns = canManage(member)
      ? await tx`select c.id,c.name,c.state,c.revision,c.draft_config,
      (select count(*)::int from em_enrollments e where e.campaign_id=c.id) as approved,
      (select count(*)::int from em_threads t where t.campaign_id=c.id and exists(select 1 from em_messages m where m.thread_id=t.id and m.direction='outbound')) as started,
      (select min(i.not_before) from em_send_intents i join em_threads t on t.id=i.thread_id where t.campaign_id=c.id and i.state='queued' and c.state='active') as next_send
      from em_campaigns c where c.workspace_id=${ws} order by c.created_at desc,c.id limit 100`
      : []
    const audiences = canManage(member)
      ? await tx`select id,name from em_audiences where workspace_id=${ws} and state='ready' order by name`
      : []
    const members =
      await tx`select m.auth_user_id as id,coalesce(p.full_name,'Team member') as name from em_memberships m join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id) where m.workspace_id=${ws} and m.active and m.roles && array['owner','acquisitions']::text[] order by name`
    const configuredTeam = emailWorkspaceConfigSchema.parse(
      workspace.config,
    ).team
    const routing =
      configuredTeam &&
      [configuredTeam.acquisitionOwnerId, configuredTeam.backupId].every((id) =>
        members.some((m) => m.id === id),
      )
        ? {
            acquisitionOwnerId: configuredTeam.acquisitionOwnerId,
            backupId: configuredTeam.backupId,
          }
        : null
    const notifications =
      await tx`select id,thread_id,kind,acknowledged_at from em_notifications where workspace_id=${ws} and recipient_id=${subject} order by created_at desc limit 100`
    const activity = canManage(member)
      ? await tx`select id,action,created_at from em_audit_events where workspace_id=${ws} order by created_at desc,id desc limit 30`
      : []
    return json({
      senders: canManage(member) ? await tx`select s.id,s.from_name as name,s.local_part||'@'||d.name_ascii as address from em_senders s join em_domains d on d.id=s.domain_id and d.workspace_id=s.workspace_id where s.workspace_id=${ws} and s.state='active' and not d.paused order by s.id` : [],
      sendingEnabled: workspace.send_enabled,
      ai_available: emailAiAvailable(),
      mode: workspace.execution_mode,
      paused: !!workspace.pause_reason,
      pauseReason: workspace.pause_reason,
      actorId: subject,
      roles: member.roles,
      asOf: now.toISOString(),
      campaigns,
      threads,
      messages,
      drafts,
      audiences,
      members,
      routing,
      notifications,
      activity,
      settings: member.roles.includes('owner')
        ? await readSettings({ tx, member, now })
        : null,
    }) as PilotState
  }) as Promise<PilotState>
}

/** Private durable generation URL; rechecks current thread access on every read. */
export async function readPilotGeneration(
  sql: Sql,
  subject: string,
  id: string,
) {
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx
    const member = await membership(tx, subject)
    const [generation] =
      await tx`select * from em_ai_generations where workspace_id=${member.workspace_id} and id=${id}`
    check(generation, 'GENERATION_NOT_FOUND', 404)
    await threadFor({ tx, member, now: new Date() }, generation.thread_id)
    return json(generation)
  })
}
