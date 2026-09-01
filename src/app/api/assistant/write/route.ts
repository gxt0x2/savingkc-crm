import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ANDON_STATUSES } from '@/lib/andon'
import {
  addAndonNote,
  getAndon,
  listOpenAndons,
  setAndonAssignee,
  updateAndonStatus,
} from '@/lib/assistant/andon-write'
import { assistantActorCanWriteAndon, authorizeAssistantRequest, resolveAssistantActor } from '@/lib/assistant/auth'
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
  z.object({
    action: z.literal('update_andon_status'),
    andonId: z.string().uuid(),
    status: z.enum(ANDON_STATUSES),
    ...auditFields,
  }),
  z.object({
    action: z.literal('set_andon_assignee'),
    andonId: z.string().uuid(),
    assignee: z.string().max(120).nullable(),
    ...auditFields,
  }),
  z.object({
    action: z.literal('add_andon_note'),
    andonId: z.string().uuid(),
    note: z.string().min(1).max(4000),
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
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  const credential = authorizeAssistantRequest(request)
  if (!credential) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers })

  const actor = await resolveAssistantActor(credential.email)
  if (!actor) return NextResponse.json({ error: 'CRM profile not authorized' }, { status: 403, headers })
  if (!assistantActorCanWriteAndon(actor)) {
    return NextResponse.json({ error: 'Andon write requires an owner or admin profile' }, { status: 403, headers })
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
      resultCount: assistantResultCount(result) ?? (result && 'andon' in result ? 1 : null),
      durationMs,
    })
    console.info('[assistant-write] completed', { action: parsed.data.action, actor: actor.email, access: actor.access, durationMs })
    return NextResponse.json({ requestId, actor: { access: actor.access }, ...result }, { headers })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CRM assistant write failed'
    const notFound = message === 'Andon not found'
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
      { error: notFound ? 'Andon not found' : 'CRM assistant write failed', requestId },
      { status: notFound ? 404 : 500, headers },
    )
  }
}
