import { NextResponse } from 'next/server'
import { z } from 'zod'
import { assistantActorCanReadCompanyWide, authorizeAssistantRequest, resolveAssistantActor } from '@/lib/assistant/auth'
import {
  assistantResultCount,
  readAssistantAttention,
  readAssistantCommunications,
  readAssistantLead360,
  readAssistantMarketingSummary,
  readAssistantOperatingSnapshot,
  readAssistantPhoneSystem,
  readAssistantSourceCatalog,
  readAssistantWebsiteFunnel,
  readAssistantWorkflowRegistry,
  searchAssistantLeads,
} from '@/lib/assistant/queries'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const headers = { 'Cache-Control': 'private, no-store, max-age=0' }
const auditFields = {
  requestId: z.string().min(1).max(160).optional(),
  threadId: z.string().min(1).max(500).optional(),
}
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('source_catalog'), ...auditFields }),
  z.object({ action: z.literal('attention'), limit: z.number().int().min(1).max(30).optional(), ...auditFields }),
  z.object({ action: z.literal('lead_search'), query: z.string().min(1).max(200), limit: z.number().int().min(1).max(12).optional(), ...auditFields }),
  z.object({ action: z.literal('lead_360'), leadId: z.string().uuid(), ...auditFields }),
  z.object({ action: z.literal('communications'), leadId: z.string().uuid(), limit: z.number().int().min(1).max(100).optional(), ...auditFields }),
  z.object({ action: z.literal('operating_snapshot'), days: z.number().int().min(1).max(365).optional(), ...auditFields }),
  z.object({ action: z.literal('workflow_registry'), search: z.string().max(100).optional(), ...auditFields }),
  z.object({ action: z.literal('phone_system'), search: z.string().max(100).optional(), ...auditFields }),
  z.object({ action: z.literal('website_funnel'), days: z.number().int().min(1).max(365).optional(), ...auditFields }),
  z.object({ action: z.literal('marketing_summary'), days: z.number().int().min(1).max(365).optional(), ...auditFields }),
])

type AssistantRequest = z.infer<typeof bodySchema>
const COMPANY_WIDE_ACTIONS = new Set<AssistantRequest['action']>([
  'source_catalog',
  'operating_snapshot',
  'workflow_registry',
  'phone_system',
  'website_funnel',
  'marketing_summary',
])

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
    console.error('[assistant-read] audit write failed', { code: error.code })
  }
}

async function executeRead(body: AssistantRequest, actor: NonNullable<Awaited<ReturnType<typeof resolveAssistantActor>>>) {
  const db = supabaseAdmin()
  switch (body.action) {
    case 'source_catalog':
      return readAssistantSourceCatalog()
    case 'attention':
      return readAssistantAttention(db, actor, body.limit ?? 15)
    case 'lead_search':
      return searchAssistantLeads(db, actor, body.query, body.limit ?? 8)
    case 'lead_360':
      return readAssistantLead360(db, actor, body.leadId)
    case 'communications':
      return readAssistantCommunications(db, actor, body.leadId, body.limit ?? 50)
    case 'operating_snapshot':
      return readAssistantOperatingSnapshot(body.days ?? 30)
    case 'workflow_registry':
      return readAssistantWorkflowRegistry(db, body.search)
    case 'phone_system':
      return readAssistantPhoneSystem(body.search)
    case 'website_funnel':
      return readAssistantWebsiteFunnel(db, body.days ?? 30)
    case 'marketing_summary':
      return readAssistantMarketingSummary(db, body.days ?? 30)
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
  if (COMPANY_WIDE_ACTIONS.has(parsed.data.action) && !assistantActorCanReadCompanyWide(actor)) {
    return NextResponse.json({ error: 'Company-wide access requires an owner or admin profile' }, { status: 403, headers })
  }

  const requestId = parsed.data.requestId || crypto.randomUUID()
  try {
    const result = await executeRead(parsed.data, actor)
    const durationMs = Date.now() - startedAt
    await writeAudit({
      actorEmail: actor.email,
      actorAccess: actor.access,
      action: parsed.data.action,
      requestId,
      threadId: parsed.data.threadId,
      success: true,
      resultCount: assistantResultCount(result),
      durationMs,
    })
    console.info('[assistant-read] completed', { action: parsed.data.action, actor: actor.email, access: actor.access, durationMs })
    return NextResponse.json({ requestId, actor: { access: actor.access }, ...result }, { headers })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CRM assistant read failed'
    const forbidden = message.startsWith('Forbidden:')
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
    console.error('[assistant-read] failed', { action: parsed.data.action, actor: actor.email, durationMs, forbidden })
    return NextResponse.json({ error: forbidden ? 'Forbidden' : 'CRM assistant read failed', requestId }, { status: forbidden ? 403 : 500, headers })
  }
}
