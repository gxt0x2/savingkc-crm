import 'server-only'
import type { EmailCommand } from '../contracts'
import { emailWorkspaceConfigSchema } from '../config'
import { projectCrmChanges } from '../crm-repairs'
import {
  check,
  json,
  workflowHash,
  type Context,
  type Result,
} from '../workflow/core'
import type { PilotSettings } from '../workflow/types'
import { intendedOutreachOpsBrief } from '../domains/intended'

const settingsCommands = new Set([
  'SET-BUSINESS',
  'SET-TEAM',
  'SET-ROLES',
  'SET-AUTOMATION',
  'SET-ENABLE',
  'SET-PAUSE',
  'SET-FINISH',
  'SET-READINESS',
])
export const isSettingsCommand = (command: string) =>
  settingsCommands.has(command)
const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

async function affectedWork(context: Context, subject: string) {
  const { tx, member } = context
  // The review hash includes revisions and queued work. A new reply, draft,
  // handoff or dispatch after review requires a new removal review.
  const threads =
    await tx`select id,controller_revision,content_revision,state from em_threads where workspace_id=${member.workspace_id}
    and (responsible_user_id=${subject} or controller_user_id=${subject}) and state<>'stopped' order by id`
  const handoffs =
    await tx`select id,thread_id,state from em_handoffs where workspace_id=${member.workspace_id} and (owner_id=${subject} or backup_id=${subject}) order by id`
  const ids = [
    ...new Set([
      ...threads.map((t) => t.id),
      ...handoffs.map((h) => h.thread_id),
    ]),
  ]
  const intents = ids.length
    ? await tx`select id,state from em_send_intents where workspace_id=${member.workspace_id} and thread_id=any(${tx.array(ids)}::uuid[]) and state in ('queued','held') order by id`
    : []
  const drafts = ids.length
    ? await tx`select id,state from em_drafts where workspace_id=${member.workspace_id} and thread_id=any(${tx.array(ids)}::uuid[]) and state='current' order by id`
    : []
  const campaigns =
    await tx`select id,revision,state from em_campaigns where workspace_id=${member.workspace_id} and owner_id=${subject} and state='active' order by id`
  return {
    ids,
    hash: workflowHash({ threads, handoffs, intents, drafts, campaigns }),
    count: ids.length,
    campaigns,
  }
}

export async function readSettings(context: Context): Promise<PilotSettings> {
  const { tx, member } = context
  check(member.roles.includes('owner'), 'FORBIDDEN', 403)
  const [workspace] =
    await tx`select config,revision from em_workspaces where id=${member.workspace_id}`
  const config = emailWorkspaceConfigSchema.parse(workspace.config)
  const rows =
    await tx`select m.auth_user_id as id,m.roles,m.active,m.revision,coalesce(p.full_name,'Team member') as name,
    (p.id is not null) as crm_active
    from em_memberships m left join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id) where m.workspace_id=${member.workspace_id} order by m.auth_user_id`
  const members = []
  for (const row of rows) {
    const work = await affectedWork(context, row.id)
    members.push({
      ...row,
      affectedWorkHash: work.hash,
      affectedThreads: work.count,
    })
  }
  const [playbook] =
    await tx`select id from em_playbook_versions where workspace_id=${member.workspace_id} order by published_at desc limit 1`
  const [calendar] =
    await tx`select enabled from em_scheduling_policies where workspace_id=${member.workspace_id}`
  const [line] =
    await tx`select state from em_response_lines where workspace_id=${member.workspace_id}`
  const [run] =
    await tx`select id from em_readiness_runs where workspace_id=${member.workspace_id} order by created_at desc limit 1`
  const practiceRecipients =
    await tx`select id,normalized_address as email from em_addresses where workspace_id=${member.workspace_id} and normalized_address like '%.test' order by normalized_address limit 20`
  const configHash = workflowHash({
    business: config.business ?? null,
    team: config.team ?? null,
    automation: config.automation ?? null,
  })
  return json({
    revision: workspace.revision,
    config,
    members,
    practiceRecipients,
    lastSimulationRunId: run?.id ?? null,
    configHash,
    readiness: {
      state: 'blocked',
      sendingEnabled: false,
      blockers: [
        `Resend product API key is not wired. Outreach DNS is ops-verified (${intendedOutreachOpsBrief()}). Sending stays off`,
        playbook
          ? 'Ari draft-only policy is saved; paid model evaluations are still required for automatic replies'
          : 'A published draft-only reply policy has not been saved',
        calendar?.enabled
          ? 'Calendar booking was marked enabled without a verified Google connection'
          : 'Google Calendar tokens are not verified; callbacks stay as CRM tasks',
        line
          ? 'A response number is intended only; live routing has not been tested'
          : 'No email-response phone line has been saved',
        'Push device registration is not verified',
        'Controlled delivery, reply and opt-out checks have not run against a live provider',
      ],
    },
  }) as PilotSettings
}

/** Called only inside the common workspace lock, after fresh membership lookup.
 * The caller commits these writes, the audit and receipt in one transaction. */
export async function applySettingsCommand(
  context: Context,
  command: EmailCommand,
): Promise<Result> {
  const { tx, member, now } = context,
    ws = member.workspace_id
  check(isSettingsCommand(command.command), 'ACTION_NOT_IMPLEMENTED', 400)
  check(
    command.command === 'SET-PAUSE'
      ? member.roles.some((r) =>
          ['owner', 'marketer', 'reviewer', 'acquisitions'].includes(r),
        )
      : member.roles.includes('owner'),
    'FORBIDDEN',
    403,
  )
  const [workspace] = await tx`select * from em_workspaces where id=${ws}`
  if (command.command === 'SET-PAUSE') {
    const [saved] =
      await tx`update em_workspaces set send_enabled=false,ai_auto_enabled=false,pause_reason=${command.payload.reason},revision=revision+1 where id=${ws} returning revision`
    return { entityId: ws, revision: saved.revision, state: 'paused' }
  }
  // Finish and enable stay fail-closed without live provider evidence.
  // A simulation checklist can be recorded; it never becomes current readiness.
  if (['SET-ENABLE', 'SET-FINISH'].includes(command.command)) {
    check(false, 'PROVIDER_READINESS_UNAVAILABLE')
  }
  if (command.command === 'SET-READINESS') {
    check(command.payload.kind === 'simulation', 'PROVIDER_READINESS_UNAVAILABLE')
    check(command.payload.maximumTestSends === 0, 'SIMULATION_SENDS_FORBIDDEN', 400)
    const config = emailWorkspaceConfigSchema.parse(workspace.config)
    const currentHash = workflowHash({
      business: config.business ?? null,
      team: config.team ?? null,
      automation: config.automation ?? null,
    })
    check(command.payload.configHash === currentHash, 'STALE_SETTINGS')
    for (const id of command.payload.testRecipientIds) {
      const [address] =
        await tx`select normalized_address from em_addresses where workspace_id=${ws} and id=${id}`
      check(address?.normalized_address?.endsWith('.test'), 'PRACTICE_RECIPIENT_REQUIRED', 400)
    }
    const [playbook] =
      await tx`select id from em_playbook_versions where workspace_id=${ws} limit 1`
    const [calendar] =
      await tx`select workspace_id from em_scheduling_policies where workspace_id=${ws}`
    const [line] =
      await tx`select id from em_response_lines where workspace_id=${ws}`
    const blockers = [
      'Provider connection and sender-domain verification',
      playbook ? null : 'Published draft-only reply policy',
      calendar ? null : 'Saved weekday calendar policy',
      line ? null : 'Intended email-response number',
      'Verified Google Calendar access',
      'Provisioned response-line routing',
      'Push device registration',
      'Controlled live delivery and reply checks',
    ].filter((row): row is string => Boolean(row))
    const [run] =
      await tx`insert into em_readiness_runs(workspace_id,kind,config_hash,state,blockers,created_by,created_at)
      values(${ws},'simulation',${currentHash},'blocked',${tx.json(blockers)},${member.auth_user_id},${now}) returning id`
    delete config.readiness
    await tx`update em_workspaces set config=${tx.json(json(config))},send_enabled=false,ai_auto_enabled=false,setup_completed_at=null,revision=revision+1 where id=${ws}`
    return {
      entityId: run.id,
      revision: workspace.revision + 1,
      state: 'simulation_checklist_blocked',
    }
  }
  const config = emailWorkspaceConfigSchema.parse(workspace.config)
  if (command.command === 'SET-ROLES') {
    const [target] =
      await tx`select * from em_memberships where workspace_id=${ws} and auth_user_id=${command.payload.authUserId}`
    check(target, 'MEMBERSHIP_NOT_FOUND', 404)
    check(command.expectedRevision === target.revision, 'STALE_MEMBERSHIP')
    const { roles, active } = command.payload
    if (active) {
      const [profile] =
        await tx`select id from agent_profiles where id=${target.agent_profile_id} and is_active is distinct from false and (user_id is null or user_id=${target.auth_user_id})`
      check(profile, 'TEAM_MEMBER_INACTIVE')
    }
    const removesOwner =
      target.active &&
      target.roles.includes('owner') &&
      (!active || !roles.includes('owner'))
    if (removesOwner) {
      const [owners] =
        await tx`select count(*)::int as count from em_memberships m join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id) where m.workspace_id=${ws} and m.auth_user_id<>${target.auth_user_id} and m.active and m.roles @> array['owner']::text[]`
      check(owners.count > 0, 'LAST_OWNER')
    }
    const work = await affectedWork(context, target.auth_user_id)
    check(
      command.payload.affectedWorkHash === work.hash,
      'AFFECTED_WORK_CHANGED',
    )
    const reduced =
      target.active &&
      (!active ||
        target.roles.some(
          (r: string) => !roles.includes(r as (typeof roles)[number]),
        ))
    const [saved] =
      await tx`update em_memberships set roles=${roles},active=${active},revision=revision+1 where id=${target.id} returning revision`
    if (reduced) {
      await tx`insert into em_membership_holds(workspace_id,removed_auth_user_id,backup_auth_user_id,affected_work_hash)
        values(${ws},${target.auth_user_id},${config.team?.backupId ?? null},${work.hash})`
      if (work.ids.length) {
        await tx`update em_send_intents set state='cancelled',cancellation_reason='team_role_changed' where workspace_id=${ws} and thread_id=any(${tx.array(work.ids)}::uuid[]) and state in ('queued','held')`
        await tx`update em_drafts set state='stale' where workspace_id=${ws} and thread_id=any(${tx.array(work.ids)}::uuid[]) and state='current'`
        await tx`update em_threads set controller='none',controller_user_id=null,controller_revision=controller_revision+1,state=case when state='stopped' then state else 'needs_review' end where workspace_id=${ws} and id=any(${tx.array(work.ids)}::uuid[])`
        await tx`update em_handoffs set state='held',revision=revision+1,access_hold_reason='team_role_changed' where workspace_id=${ws} and thread_id=any(${tx.array(work.ids)}::uuid[]) and state<>'completed'`
        for (const threadId of work.ids)
          await projectCrmChanges(context, threadId, {
            holdReason: 'team_role_changed',
          })
        await tx`insert into em_notifications(workspace_id,thread_id,recipient_id,kind,logical_key,created_at)
          select ${ws},t.id,m.auth_user_id,'team_member_work_held',${command.idempotencyKey}||':'||t.id||':'||m.auth_user_id,${now}
          from em_threads t cross join em_memberships m where t.workspace_id=${ws} and t.id=any(${tx.array(work.ids)}::uuid[])
          and m.workspace_id=${ws} and m.active and m.roles @> array['owner']::text[] on conflict do nothing`
      }
      await tx`update em_campaigns set state='paused',revision=revision+1 where workspace_id=${ws} and owner_id=${target.auth_user_id} and state='active'`
      // An invalid team assignment cannot continue to look like completed setup.
      if (
        config.team &&
        [
          config.team.reviewerId,
          config.team.acquisitionOwnerId,
          config.team.backupId,
        ].includes(target.auth_user_id)
      )
        delete config.team
    }
    delete config.readiness
    await tx`update em_workspaces set config=${tx.json(json(config))},send_enabled=false,ai_auto_enabled=false,setup_completed_at=null,revision=revision+1 where id=${ws}`
    return {
      entityId: target.id,
      revision: saved.revision,
      state: reduced ? 'work_held' : 'roles_saved',
    }
  }
  check(command.expectedRevision === workspace.revision, 'STALE_SETTINGS')
  switch (command.command) {
    case 'SET-BUSINESS': {
      const p = command.payload
      check(p.timezone === 'America/Chicago', 'CHICAGO_TIMEZONE_REQUIRED', 400)
      check(
        /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
          p.primaryDomain,
        ),
        'INVALID_PRIMARY_DOMAIN',
        400,
      )
      check(
        new URL(p.privacyUrl).protocol === 'https:',
        'HTTPS_PRIVACY_URL_REQUIRED',
        400,
      )
      if (
        config.business?.primaryDomain &&
        config.business.primaryDomain !== p.primaryDomain.toLowerCase()
      ) {
        await tx`update em_domains set paused=true,state='held',failure_code='BUSINESS_DOMAIN_CHANGED',check_token=null,revision=revision+1 where workspace_id=${ws}`
        await tx`update em_senders set state='paused',revision=revision+1 where workspace_id=${ws} and state='active'`
      }
      config.business = { ...p, primaryDomain: p.primaryDomain.toLowerCase() }
      break
    }
    case 'SET-TEAM': {
      const p = command.payload
      check(p.calendarMode === 'manual', 'CALENDAR_NOT_CONNECTED')
      check(
        p.hours.timezone === 'America/Chicago' &&
          p.hours.weekdays.every((d) => weekdays.includes(d)),
        'WEEKDAY_HOURS_REQUIRED',
        400,
      )
      check(
        /^([01]\d|2[0-3]):[0-5]\d$/.test(p.hours.startLocal) &&
          /^([01]\d|2[0-3]):[0-5]\d$/.test(p.hours.endLocal) &&
          p.hours.startLocal >= '08:30' &&
          p.hours.startLocal < p.hours.endLocal,
        'INVALID_TEAM_HOURS',
        400,
      )
      for (const [subject, allowed] of [
        [p.reviewerId, ['owner', 'reviewer']],
        [p.acquisitionOwnerId, ['owner', 'acquisitions']],
        [p.backupId, ['owner', 'acquisitions']],
      ] as const) {
        const [assignee] =
          await tx`select m.roles from em_memberships m join agent_profiles a on a.id=m.agent_profile_id and a.is_active is distinct from false and (a.user_id is null or a.user_id=m.auth_user_id)
          where m.workspace_id=${ws} and m.auth_user_id=${subject} and m.active`
        check(
          assignee && allowed.some((r) => assignee.roles.includes(r)),
          'TEAM_ROLE_REQUIRED',
        )
      }
      check(
        p.acquisitionOwnerId !== p.backupId,
        'DISTINCT_BACKUP_REQUIRED',
        400,
      )
      config.team = p
      break
    }
    case 'SET-AUTOMATION': {
      check(
        command.payload.mode === 'draft_only',
        'AUTOMATION_READINESS_REQUIRED',
      )
      const [version] =
        await tx`select id,policy from em_playbook_versions where workspace_id=${ws} and id=${command.payload.playbookVersionId}`
      check(version, 'PLAYBOOK_NOT_PUBLISHED')
      check(
        ((version.policy as { allowedActions?: string[] }).allowedActions ?? [])
          .length === 0,
        'AUTOMATION_READINESS_REQUIRED',
      )
      config.automation = command.payload
      break
    }
    default:
      check(false, 'ACTION_NOT_IMPLEMENTED', 400)
  }
  delete config.readiness
  const parsed = emailWorkspaceConfigSchema.parse(config)
  const [saved] =
    await tx`update em_workspaces set config=${tx.json(json(parsed))},send_enabled=false,ai_auto_enabled=false,setup_completed_at=null,revision=revision+1 where id=${ws} returning revision`
  return { entityId: ws, revision: saved.revision, state: 'settings_saved' }
}
