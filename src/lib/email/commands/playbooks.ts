import 'server-only'
import type { EmailCommand } from '../contracts'
import {
  canPublishAiPolicy,
  evaluateDeterministicFixtures,
  fixtureSetHash,
  modelEvaluationUnavailable,
} from '../ai/evaluations'
import {
  DETERMINISTIC_FIXTURE_SET_ID,
  DETERMINISTIC_MODEL_ID,
  REQUIRED_ESCALATIONS,
} from '../ai/constants'
import { publishingRaisesAutonomy } from '../playbooks'
import {
  WorkflowError,
  check,
  json,
  workflowHash,
  type Context,
  type Result,
} from '../workflow/core'

const commands = new Set(['PB-SAVE', 'PB-SIMULATE', 'PB-PUBLISH'])
export const isPlaybookCommand = (command: string) => commands.has(command)

export async function applyPlaybookCommand(
  context: Context,
  command: EmailCommand,
): Promise<Result> {
  const { tx, member, now } = context,
    ws = member.workspace_id
  check(isPlaybookCommand(command.command), 'ACTION_NOT_IMPLEMENTED', 400)
  if (command.command === 'PB-SIMULATE')
    check(
      member.roles.some((r) => ['owner', 'reviewer'].includes(r)),
      'FORBIDDEN',
      403,
    )
  else check(member.roles.includes('owner'), 'FORBIDDEN', 403)

  if (command.command === 'PB-SAVE') {
    const p = command.payload
    check(p.program === 'seller_outreach', 'PILOT_SELLER_OUTREACH_ONLY', 400)
    check(p.policy.supportedLanguages.every((l) => l === 'en'), 'LANGUAGE_NOT_EVALUATED', 400)
    check(
      p.policy.allowedActions.every((a) => a !== 'confirm_verified_booking'),
      'CALENDAR_NOT_CONNECTED',
    )
    const contentHash = workflowHash({
      name: p.name,
      program: p.program,
      policy: p.policy,
      prompt: p.prompt,
      requiredEscalations: REQUIRED_ESCALATIONS,
    })
    const existing = command.entityId
      ? (
          await tx`select * from em_playbooks where workspace_id=${ws} and id=${command.entityId} for update`
        )[0]
      : null
    if (existing) {
      check(
        command.expectedRevision === existing.revision,
        'STALE_PLAYBOOK',
      )
      const [published] =
        await tx`select id from em_playbook_versions where workspace_id=${ws} and playbook_id=${existing.id} order by version_number desc limit 1`
      check(!published || command.entityId, 'PLAYBOOK_VERSION_IMMUTABLE')
      await tx`update em_playbooks set name=${p.name},program=${p.program},revision=revision+1 where workspace_id=${ws} and id=${existing.id}`
      await tx`insert into em_playbook_drafts(playbook_id,workspace_id,policy,prompt,content_hash,revision,updated_at)
        values(${existing.id},${ws},${tx.json(json(p.policy))},${p.prompt},${contentHash},${existing.revision + 1},${now})
        on conflict (playbook_id) do update set policy=${tx.json(json(p.policy))},prompt=${p.prompt},content_hash=${contentHash},revision=${existing.revision + 1},updated_at=${now}`
      return {
        entityId: existing.id,
        revision: existing.revision + 1,
        state: 'playbook_draft_saved',
      }
    }
    const [created] =
      await tx`insert into em_playbooks(workspace_id,name,program,created_by) values(${ws},${p.name},${p.program},${member.auth_user_id}) returning id,revision`
    await tx`insert into em_playbook_drafts(playbook_id,workspace_id,policy,prompt,content_hash,revision,updated_at)
      values(${created.id},${ws},${tx.json(json(p.policy))},${p.prompt},${contentHash},${created.revision},${now})`
    return {
      entityId: created.id,
      revision: created.revision,
      state: 'playbook_draft_saved',
    }
  }

  if (command.command === 'PB-SIMULATE') {
    const p = command.payload
    check(
      p.fixtureSetId === DETERMINISTIC_FIXTURE_SET_ID,
      'UNKNOWN_FIXTURE_SET',
      400,
    )
    check(!modelEvaluationUnavailable(p.modelId), 'MODEL_EVALUATION_UNAVAILABLE')
    const [draft] =
      await tx`select d.*,b.id as playbook_id from em_playbook_drafts d join em_playbooks b on b.id=d.playbook_id and b.workspace_id=d.workspace_id
      where d.workspace_id=${ws} and d.content_hash=${p.playbookDraftHash}`
    check(draft, 'PLAYBOOK_DRAFT_NOT_FOUND', 404)
    const cases = evaluateDeterministicFixtures()
    const passed = canPublishAiPolicy(cases)
    const [run] =
      await tx`insert into em_evaluation_runs(workspace_id,playbook_id,draft_hash,fixture_set_id,fixture_set_hash,model_id,kind,cases,critical_failed,passed,created_by,created_at)
      values(${ws},${draft.playbook_id},${p.playbookDraftHash},${p.fixtureSetId},${fixtureSetHash()},${p.modelId},'deterministic',${tx.json(json(cases))},${cases.filter((c) => c.critical && !c.passed).length},${passed},${member.auth_user_id},${now}) returning id`
    return {
      entityId: run.id,
      state: passed ? 'evaluation_recorded' : 'evaluation_blocked',
    }
  }

  if (command.command !== 'PB-PUBLISH')
    throw new WorkflowError('ACTION_NOT_IMPLEMENTED', 400)
  const p = command.payload
  const [run] =
    await tx`select * from em_evaluation_runs where workspace_id=${ws} and id=${p.evalRunId}`
  check(run, 'EVALUATION_NOT_FOUND', 404)
  check(run.draft_hash === p.draftHash, 'EVALUATION_DRAFT_MISMATCH')
  check(run.kind === 'deterministic' && run.passed, 'EVALUATION_NOT_CURRENT')
  check(run.model_id === DETERMINISTIC_MODEL_ID, 'MODEL_EVALUATION_UNAVAILABLE')
  const [draft] =
    await tx`select d.*,b.program from em_playbook_drafts d join em_playbooks b on b.id=d.playbook_id
    where d.workspace_id=${ws} and d.content_hash=${p.draftHash} for update`
  check(draft, 'PLAYBOOK_DRAFT_NOT_FOUND', 404)
  const policy = draft.policy as { allowedActions: string[] }
  check(policy.allowedActions.length === 0, 'AUTOMATION_READINESS_REQUIRED')
  const [latest] =
    await tx`select policy from em_playbook_versions where workspace_id=${ws} and playbook_id=${draft.playbook_id} order by version_number desc limit 1`
  if (latest)
    check(
      !publishingRaisesAutonomy({
        previousActions: (latest.policy as { allowedActions: string[] })
          .allowedActions,
        nextActions: policy.allowedActions,
      }),
      'AUTONOMY_RAISE_BLOCKED',
    )
  const [version] =
    await tx`insert into em_playbook_versions(workspace_id,playbook_id,version_number,policy,prompt,content_hash,eval_run_id,published_by,published_at)
    values(${ws},${draft.playbook_id},coalesce((select max(version_number) from em_playbook_versions where playbook_id=${draft.playbook_id}),0)+1,
      ${tx.json(json(draft.policy))},${draft.prompt},${draft.content_hash},${run.id},${member.auth_user_id},${now}) returning id,version_number`
  return {
    entityId: version.id,
    revision: version.version_number,
    state: 'playbook_published_draft_only',
  }
}
