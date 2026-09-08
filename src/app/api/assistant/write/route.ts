import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ANDON_STATUSES } from '@/lib/andon'
import {
  addAndonNote,
  getAndon,
  linkAndonRecord,
  listOpenAndons,
  setAndonAssignee,
  setAndonChatThread,
  updateAndonStatus,
} from '@/lib/assistant/andon-write'
import { assistantActorCanWriteOps, authorizeAssistantRequest, resolveAssistantActor } from '@/lib/assistant/auth'
import {
  addLeadNote,
  AssistantWriteError,
  createLeadAppointment,
  createLeadTask,
  isForbiddenMoneyAction,
  setLeadOwner,
  updateDealFileOps,
  updateLeadStage,
} from '@/lib/assistant/ops-write'
import { assistantResultCount } from '@/lib/assistant/queries'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const headers = { 'Cache-Control': 'private, no-store, max-age=0' }
const auditFields = {
  requestId: z.string().min(1).max(160).optional(),
  threadId: z.string().min(1).max(500).optional(),
}
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list_open_andons'), limit: z.number().int().min(1).max(50).optional(), ...auditFields }),
  z.object({ action: z.literal('get_andon'), andonId: z.string().uuid(), ...auditFields }),
  z.object({ action: z.literal('update_andon_status'), andonId: z.string().uuid(), status: z.enum(ANDON_STATUSES), ...auditFields }),
  z.object({ action: z.literal('set_andon_assignee'), andonId: z.string().uuid(), assignee: z.string().max(120).nullable(), ...auditFields }),
  z.object({ action: z.literal('add_andon_note'), andonId: z.string().uuid(), note: z.string().min(1).max(4000), ...auditFields }),
  z.object({
    action: z.literal('set_andon_chat_thread'),
    andonId: z.string().uuid(),
    chatSpaceId: z.string().max(200).nullable().optional(),
    chatThreadId: z.string().max(200).nullable().optional(),
    ...auditFields,
  }),
  z.object({
    action: z.literal('link_andon_record'),
    andonId: z.string().uuid(),
    recordId: z.string().min(1).max(200),
    recordType: z.enum(['lead', 'property']),
    recordUrl: z.string().max(1000).optional(),
    ...auditFields,
  }),
  z.object({ action: z.literal('add_lead_note'), leadId: z.string().uuid(), note: z.string().min(1).max(4000), ...auditFields }),
  z.object({ action: z.literal('set_lead_owner'), leadId: z.string().uuid(), owner: z.string().max(120).nullable(), ...auditFields }),
  z.object({
    action: z.literal('update_lead_stage'),
    leadId: z.string().uuid(),
    stage: z.string().min(1).max(40),
    deadReason: z.string().max(80).optional(),
    deadReasonNotes: z.string().max(1000).optional(),
    ...auditFields,
  }),
  z.object({
    action: z.literal('set_lead_next_action'),
    leadId: z.string().uuid(),
    title: z.string().min(1).max(200),
    notes: z.string().max(4000).optional(),
    dueAt: z.string().max(80).optional(),
    assignedTo: z.string().max(120).optional(),
    ...auditFields,
  }),
  z.object({
    action: z.literal('create_lead_task'),
    leadId: z.string().uuid(),
    title: z.string().min(1).max(200),
    notes: z.string().max(4000).optional(),
    dueAt: z.string().max(80).optional(),
    assignedTo: z.string().max(120).optional(),
    kind: z.string().max(40).optional(),
    ...auditFields,
  }),
  z.object({
    action: z.literal('create_lead_appointment'),
    leadId: z.string().uuid(),
    scheduledAt: z.string().min(1).max(80),
    type: z.enum(['phone_call', 'in_person', 'google_meet']).optional(),
    assignedTo: z.string().max(120).optional(),
    notes: z.string().max(4000).optional(),
    ...auditFields,
  }),
  z.object({
    action: z.literal('update_deal_file'),
    fileId: z.string().uuid(),
    nextAction: z.string().max(500).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    stage: z.string().max(40).optional(),
    ...auditFields,
  }),
])

type AssistantWriteRequest = z.infer<typeof bodySchema>

async function writeAudit(input: {
  actorEmail: string
  actorAccess: string
  action: string
  requestId: string
  threadId?: string
  success: boolean
  resultCount: number | null
  durationMs: number
  error?: string
}) {
  const { error } = await supabaseAdmin().from('assistant_query_audit').insert({
    actor_email: input.actorEmail,
    actor_access: input.actorAccess,
    action: input.action,
    request_id: input.requestId,
    thread_id: input.threadId || null,
    success: input.success,
    result_count: input.resultCount,
    duration_ms: input.durationMs,
    error: input.error?.slice(0, 500) || null,
  })
  if (error && error.code !== 'PGRST205' && error.code !== '42P01') {
    console.error('[assistant-write] audit write failed', { code: error.code })
  }
}

async function executeWrite(body: AssistantWriteRequest, actor: NonNullable<Awaited<ReturnType<typeof resolveAssistantActor>>>) {
  const db = supabaseAdmin()
  const commandId = body.requestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)
    ? body.requestId
    : crypto.randomUUID()
  switch (body.action) {
    case 'list_open_andons':
      return listOpenAndons(db, body.limit ?? 25)
    case 'get_andon':
      return getAndon(db, body.andonId)
    case 'update_andon_status':
      return updateAndonStatus(db, body.andonId, body.status)
    case 'set_andon_assignee':
      return setAndonAssignee(db, body.andonId, body.assignee)
    case 'add_andon_note':
      return addAndonNote(db, actor, body.andonId, body.note)
    case 'set_andon_chat_thread':
      return setAndonChatThread(db, body.andonId, { chatSpaceId: body.chatSpaceId, chatThreadId: body.chatThreadId })
    case 'link_andon_record':
      return linkAndonRecord(db, body.andonId, body)
    case 'add_lead_note':
      return addLeadNote(db, actor, body.leadId, body.note)
    case 'set_lead_owner':
      return setLeadOwner(actor, body.leadId, body.owner, commandId)
    case 'update_lead_stage':
      return updateLeadStage(actor, body.leadId, body.stage, {
        commandId,
        deadReason: body.deadReason,
        deadReasonNotes: body.deadReasonNotes,
      })
    case 'set_lead_next_action':
      return createLeadTask(actor, { ...body, commandId, primaryNextAction: true })
    case 'create_lead_task':
      return createLeadTask(actor, { ...body, commandId })
    case 'create_lead_appointment':
      return createLeadAppointment(actor, body)
    case 'update_deal_file':
      return updateDealFileOps(db, body)
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  const credential = authorizeAssistantRequest(request)
  if (!credential) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  const raw = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    const action = raw && typeof raw === 'object' && 'action' in raw ? (raw as { action?: unknown }).action : null
    if (isForbiddenMoneyAction(action)) {
      return NextResponse.json({ error: 'Money writes are not allowed', writeScope: 'ops_except_money' }, { status: 403, headers })
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers })
  }

  const actor = await resolveAssistantActor(credential.email)
  if (!actor) return NextResponse.json({ error: 'CRM profile not authorized' }, { status: 403, headers })
  if (!assistantActorCanWriteOps(actor)) {
    return NextResponse.json({ error: 'Assistant write requires an owner or admin profile' }, { status: 403, headers })
  }

  const requestId = parsed.data.requestId || crypto.randomUUID()
  try {
    const result = await executeWrite(parsed.data, actor)
    const durationMs = Date.now() - startedAt
    await writeAudit({
      actorEmail: actor.email,
      actorAccess: actor.access,
      action: parsed.data.action,
      requestId,
      threadId: parsed.data.threadId,
      success: true,
      resultCount: assistantResultCount(result) ?? ('andon' in result || 'note' in result || 'workItem' in result || 'appointment' in result || 'result' in result ? 1 : null),
      durationMs,
    })
    console.info('[assistant-write] completed', { action: parsed.data.action, actor: actor.email, access: actor.access, durationMs })
    return NextResponse.json({ requestId, actor: { access: actor.access }, ...result }, { headers })
  } catch (error) {
    const writeError = error instanceof AssistantWriteError ? error : null
    const message = error instanceof Error ? error.message : 'CRM assistant write failed'
    const notFound = message === 'Andon not found' || writeError?.status === 404
    const durationMs = Date.now() - startedAt
    await writeAudit({
      actorEmail: actor.email,
      actorAccess: actor.access,
      action: parsed.data.action,
      requestId,
      threadId: parsed.data.threadId,
      success: false,
      resultCount: null,
      durationMs,
      error: message,
    })
    console.error('[assistant-write] failed', { action: parsed.data.action, actor: actor.email, durationMs, notFound })
    return NextResponse.json(
      { error: writeError?.message || (notFound ? 'Not found' : 'CRM assistant write failed'), requestId },
      { status: writeError?.status ?? (notFound ? 404 : 500), headers },
    )
  }
}
