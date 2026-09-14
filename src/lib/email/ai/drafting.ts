import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import type { EmailCommand } from '../contracts'
import {
  check,
  json,
  workflowHash,
  type Tx,
  type Result,
} from '../workflow/core'
import {
  emailAiFailureCode,
  EMAIL_AI_INSTRUCTIONS,
  EMAIL_AI_POLICY,
  validateEmailAiOutput,
  visibleEmailBody,
  type EmailAiInput,
  type EmailAiProvider,
} from './provider'

type Dependencies = {
  transact: typeof import('../workflow/service').transact
  requireHuman: typeof import('../workflow/service').requireHuman
}
type Command = Extract<EmailCommand, { command: 'THR-REGENERATE' }>

export async function draftWithAri(
  sql: Sql,
  subject: string,
  command: Command,
  now: Date,
  provider: EmailAiProvider | null,
  dependencies: Dependencies,
): Promise<Result> {
  check(provider, 'AI_NOT_CONNECTED', 503)
  const reservation = await dependencies.transact(
    sql,
    subject,
    command,
    now,
    async (context) => {
      const { tx, member } = context
      const thread = await dependencies.requireHuman(
        context,
        command.payload.threadId,
        command.payload.contentRevision,
        command.payload.controllerRevision,
      )
      const [held] =
        await tx`select id from em_handoffs where workspace_id=${member.workspace_id} and thread_id=${thread.id}
      and state<>'completed' and (state='held' or crm_sync_state<>'synced')`
      const [repair] =
        await tx`select id from em_crm_projection_repairs where workspace_id=${member.workspace_id} and thread_id=${thread.id} and state='pending'`
      check(!held && !repair, 'CALLBACK_HELD')
      check(!thread.reply_queued, 'REPLY_ALREADY_QUEUED')
      const [openSend] =
        await tx`select id from em_send_intents where workspace_id=${member.workspace_id} and thread_id=${thread.id} and origin='human' and state='queued'`
      check(!openSend, 'REPLY_ALREADY_QUEUED')
      const rows =
        await tx`select id,direction,text_body from em_messages where workspace_id=${member.workspace_id} and thread_id=${thread.id} order by sequence desc limit 8`
      const input: EmailAiInput = {
        messages: rows.reverse().map((m) => ({
          id: m.id,
          direction: m.direction,
          body: visibleEmailBody(m.text_body),
        })),
        ...(command.payload.instruction
          ? { instruction: command.payload.instruction }
          : {}),
      }
      check(
        input.messages.some((m) => m.direction === 'inbound'),
        'REPLY_REQUIRED',
      )
      check(
        Buffer.byteLength(
          JSON.stringify(input) + EMAIL_AI_INSTRUCTIONS,
          'utf8',
        ) <= 16000,
        'AI_CONTEXT_TOO_LARGE',
      )
      const hash = workflowHash({
        input,
        model: provider.model,
        policy: EMAIL_AI_POLICY,
        content: thread.content_revision,
        controller: thread.controller_revision,
      })
      // An interrupted call keeps its reservation; never automatically replay it.
      await tx`update em_ai_generations set state='failed',failure_code='AI_INTERRUPTED',completed_at=${now}
      where workspace_id=${member.workspace_id} and state in ('queued','running') and created_at<${new Date(now.getTime() - 120000)}`
      const [cached] =
        await tx`select id,state from em_ai_generations where workspace_id=${member.workspace_id} and thread_id=${thread.id}
      and requested_by=${subject} and prompt_hash=${hash} and state in ('queued','running','ready') order by created_at desc limit 1`
      if (cached) return { entityId: cached.id, state: `ai_${cached.state}` }
      const [budget] =
        await tx`select count(*) filter(where created_at>=${new Date(now.getTime() - 3600000)})::int as hourly,
      count(*)::int as daily from em_ai_generations where workspace_id=${member.workspace_id} and created_at>=${new Date(now.getTime() - 86400000)}`
      check(budget.hourly < 10 && budget.daily < 50, 'AI_BUDGET_REACHED')
      const [generation] =
        await tx`insert into em_ai_generations(workspace_id,thread_id,requested_by,content_revision,controller_revision,prompt_hash,model,policy_version,input_snapshot,state,created_at)
      values(${member.workspace_id},${thread.id},${subject},${thread.content_revision},${thread.controller_revision},${hash},${provider.model},${EMAIL_AI_POLICY},${tx.json(json(input))},'queued',${now}) returning id`
      return { entityId: generation.id, state: 'ai_queued' }
    },
  )
  const id = reservation.entityId
  const claim = randomUUID()
  // Only one concurrent request can claim this durable generation.
  const [generation] =
    await sql`update em_ai_generations set state='running',claim_id=${claim}
    where id=${id} and requested_by=${subject} and state='queued' returning *`
  if (!generation) {
    const [saved] =
      await sql`select state from em_ai_generations where id=${id} and requested_by=${subject}`
    return { entityId: id, state: `ai_${saved?.state ?? 'unavailable'}` }
  }
  let output: unknown = null,
    inputTokens: number | null = null,
    outputTokens: number | null = null,
    providerId: string | null = null,
    failure: string | null = null
  try {
    const result = await provider.generate(
      generation.input_snapshot as EmailAiInput,
    )
    // Persist even invalid structured output; it can never become an approved draft.
    output = json(result.output)
    inputTokens = result.inputTokens ?? null
    outputTokens = result.outputTokens ?? null
    providerId = result.providerGenerationId ?? null
    output = validateEmailAiOutput(
      output,
      generation.input_snapshot as EmailAiInput,
    )
  } catch (error) {
    failure = emailAiFailureCode(error)
  }
  const finishedAt = new Date(Math.max(now.getTime(), Date.now()))
  const final = await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx
    await tx`select id from em_workspaces where id=${generation.workspace_id} for update`
    const [t] =
      await tx`select * from em_threads where id=${generation.thread_id} and workspace_id=${generation.workspace_id} for update`
    const [saved] =
      await tx`select state from em_ai_generations where id=${id} and claim_id=${claim} for update`
    const [queuedReply] =
      await tx`select id from em_send_intents where workspace_id=${generation.workspace_id} and thread_id=${generation.thread_id} and origin='human' and state='queued'`
    const [member] =
      await tx`select m.auth_user_id from em_memberships m join agent_profiles p on p.id=m.agent_profile_id
      where m.workspace_id=${generation.workspace_id} and m.auth_user_id=${subject} and m.active and p.is_active is distinct from false
      and (p.user_id is null or p.user_id=m.auth_user_id) and m.roles && array['owner','reviewer','acquisitions']::text[]`
    const [issue] =
      await tx`select h.id from em_handoffs h left join leads l on l.id=h.lead_id
      left join em_memberships m on m.workspace_id=h.workspace_id and m.auth_user_id=h.owner_id
      left join agent_profiles p on p.id=m.agent_profile_id
      left join work_items w on w.work_item_key=h.crm_task_key
      where h.workspace_id=${generation.workspace_id} and h.thread_id=${generation.thread_id} and h.state<>'completed'
        and (h.state='held' or h.crm_sync_state<>'synced' or p.is_active=false or l.assigned_agent is distinct from email_crm_assignee_name(p.email,p.full_name) or w.assigned_to is distinct from email_crm_assignee_name(p.email,p.full_name))`
    const stale =
      saved?.state === 'stale' ||
      !!queuedReply ||
      !member ||
      !t ||
      ['stopped', 'done'].includes(t.state) ||
      t.controller !== 'human' ||
      t.controller_user_id !== subject ||
      t.content_revision !== generation.content_revision ||
      t.controller_revision !== generation.controller_revision ||
      !!issue
    const state = failure ? 'failed' : stale ? 'stale' : 'ready'
    const cost =
      inputTokens !== null && outputTokens !== null
        ? inputTokens * 0.0000002 + outputTokens * 0.0000012
        : null
    await tx`update em_ai_generations set state=${state},output=${output ? tx.json(json(output)) : null},input_tokens=${inputTokens},output_tokens=${outputTokens},
      estimated_cost_usd=${cost},provider_generation_id=${providerId},failure_code=${failure},completed_at=${finishedAt}
      where id=${id} and claim_id=${claim}`
    return state
  })
  return { entityId: id, state: `ai_${final}` }
}
