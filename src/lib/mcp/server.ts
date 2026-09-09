import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
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
import {
  assistantActorCanReadCompanyWide,
  resolveAssistantActor,
  type AssistantActor,
} from '@/lib/assistant/auth'
import { getAiChangeProposalsForLead } from '@/lib/server/ai-change-proposals'
import { supabaseAdmin } from '@/lib/supabase/admin'

type ToolContext = {
  authInfo?: AuthInfo
  requestId: string | number
  sessionId?: string
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

function content(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
}

async function writeAudit(input: {
  actor: AssistantActor
  action: string
  requestId: string
  threadId?: string
  success: boolean
  resultCount: number | null
  durationMs: number
  error?: string
}) {
  const { error } = await supabaseAdmin().from('assistant_query_audit').insert({
    actor_email: input.actor.email,
    actor_access: input.actor.access,
    action: input.action,
    request_id: input.requestId,
    thread_id: input.threadId || null,
    success: input.success,
    result_count: input.resultCount,
    duration_ms: input.durationMs,
    error: input.error?.slice(0, 500) || null,
  })
  if (error && error.code !== 'PGRST205' && error.code !== '42P01') {
    console.error('[crm-mcp] audit write failed', { code: error.code })
  }
}

async function runRead(
  action: string,
  context: ToolContext,
  execute: (actor: AssistantActor) => Promise<unknown> | unknown,
  options: { companyWide?: boolean } = {},
) {
  const startedAt = Date.now()
  const email = context.authInfo?.extra?.email
  if (typeof email !== 'string' || !email.trim()) {
    return { ...content({ error: 'CRM MCP identity is unavailable.' }), isError: true }
  }

  const actor = await resolveAssistantActor(email)
  if (!actor) return { ...content({ error: 'CRM profile is not authorized.' }), isError: true }
  if (options.companyWide && !assistantActorCanReadCompanyWide(actor)) {
    return { ...content({ error: 'Company-wide access requires an owner or admin profile.' }), isError: true }
  }

  const requestId = String(context.requestId || crypto.randomUUID()).slice(0, 160)
  try {
    const result = await execute(actor)
    const durationMs = Date.now() - startedAt
    await writeAudit({
      actor,
      action: `mcp:${action}`,
      requestId,
      threadId: context.sessionId,
      success: true,
      resultCount: assistantResultCount(result),
      durationMs,
    })
    console.info('[crm-mcp] completed', { action, access: actor.access, durationMs })
    return content(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CRM MCP read failed'
    const durationMs = Date.now() - startedAt
    await writeAudit({
      actor,
      action: `mcp:${action}`,
      requestId,
      threadId: context.sessionId,
      success: false,
      resultCount: null,
      durationMs,
      error: message,
    })
    console.error('[crm-mcp] failed', { action, access: actor.access, durationMs })
    return { ...content({ error: 'The requested CRM read is temporarily unavailable.' }), isError: true }
  }
}

export function registerCrmMcpTools(server: McpServer) {
  server.registerTool(
    'crm_connection_status',
    {
      title: 'SavingKC CRM connection status',
      description: 'Confirm the authenticated, read-only connection to the live SavingKC CRM.',
      annotations: READ_ONLY,
    },
    (context) => runRead('connection_status', context, (actor) => ({
      connected: true,
      mode: 'read-only',
      approvalBoundary: 'Consequential CRM changes remain subject to human review.',
      actor: { access: actor.access, role: actor.role },
      generatedAt: new Date().toISOString(),
    })),
  )

  server.registerTool(
    'crm_source_catalog',
    {
      title: 'SavingKC source catalog',
      description: 'List the live business data sources available to this CRM connection and their current connection state.',
      annotations: READ_ONLY,
    },
    (context) => runRead('source_catalog', context, () => readAssistantSourceCatalog(), { companyWide: true }),
  )

  server.registerTool(
    'crm_attention_queue',
    {
      title: 'SavingKC attention queue',
      description: 'Read current CRM items that need attention, including pending tasks and stale active contacts.',
      inputSchema: { limit: z.number().int().min(1).max(30).optional() },
      annotations: READ_ONLY,
    },
    ({ limit }, context) => runRead('attention', context, (actor) => readAssistantAttention(supabaseAdmin(), actor, limit ?? 15)),
  )

  server.registerTool(
    'crm_search_contacts',
    {
      title: 'Search SavingKC contacts',
      description: 'Search live CRM contacts by seller name, property address, phone number, or email. Returns at most 12 matches.',
      inputSchema: {
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(12).optional(),
      },
      annotations: READ_ONLY,
    },
    ({ query, limit }, context) => runRead('lead_search', context, (actor) => searchAssistantLeads(supabaseAdmin(), actor, query, limit ?? 8)),
  )

  server.registerTool(
    'crm_contact_360',
    {
      title: 'Read SavingKC contact 360',
      description: 'Read a live, permission-scoped 360-degree CRM view for one contact, including property, pipeline, tasks, and deal context.',
      inputSchema: { contactId: z.string().uuid() },
      annotations: READ_ONLY,
    },
    ({ contactId }, context) => runRead('lead_360', context, (actor) => readAssistantLead360(supabaseAdmin(), actor, contactId)),
  )

  server.registerTool(
    'crm_contact_communications',
    {
      title: 'Read SavingKC contact communications',
      description: 'Read the recent CRM communication timeline for one contact. Secret and signed-URL metadata is removed.',
      inputSchema: {
        contactId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ_ONLY,
    },
    ({ contactId, limit }, context) => runRead('communications', context, (actor) => readAssistantCommunications(supabaseAdmin(), actor, contactId, limit ?? 50)),
  )

  server.registerTool(
    'crm_pending_ai_change_reviews',
    {
      title: 'Read pending AI change reviews',
      description: 'List pending, human-reviewed AI change proposals for one CRM contact. This tool never approves or applies a proposal.',
      inputSchema: { contactId: z.string().uuid() },
      annotations: READ_ONLY,
    },
    ({ contactId }, context) => runRead('pending_ai_change_reviews', context, async (actor) => {
      const lead = await readAssistantLead360(supabaseAdmin(), actor, contactId)
      if (!lead.record) return { contactId, proposals: [] }
      return { contactId, proposals: await getAiChangeProposalsForLead(contactId) }
    }),
  )

  server.registerTool(
    'crm_operating_snapshot',
    {
      title: 'SavingKC operating snapshot',
      description: 'Read live company-wide pipeline, activity, task, deal, goal, source, and owner counts for a bounded period.',
      inputSchema: { days: z.number().int().min(1).max(365).optional() },
      annotations: READ_ONLY,
    },
    ({ days }, context) => runRead('operating_snapshot', context, () => readAssistantOperatingSnapshot(days ?? 30), { companyWide: true }),
  )

  server.registerTool(
    'crm_workflow_registry',
    {
      title: 'SavingKC workflow registry',
      description: 'Read approved workflow definitions and implementation references from the live CRM control center.',
      inputSchema: { search: z.string().max(100).optional() },
      annotations: READ_ONLY,
    },
    ({ search }, context) => runRead('workflow_registry', context, () => readAssistantWorkflowRegistry(supabaseAdmin(), search), { companyWide: true }),
  )

  server.registerTool(
    'crm_phone_system',
    {
      title: 'SavingKC phone system registry',
      description: 'Read the protected SavingKC phone-number registry, ownership, routing, and health notes.',
      inputSchema: { search: z.string().max(100).optional() },
      annotations: READ_ONLY,
    },
    ({ search }, context) => runRead('phone_system', context, () => readAssistantPhoneSystem(search), { companyWide: true }),
  )

  server.registerTool(
    'website_funnel_summary',
    {
      title: 'SavingKC website funnel summary',
      description: 'Read live website lead and first-party attribution funnel metrics, including recent non-test events.',
      inputSchema: { days: z.number().int().min(1).max(365).optional() },
      annotations: READ_ONLY,
    },
    ({ days }, context) => runRead('website_funnel', context, () => readAssistantWebsiteFunnel(supabaseAdmin(), days ?? 30), { companyWide: true }),
  )

  server.registerTool(
    'marketing_summary',
    {
      title: 'SavingKC marketing summary',
      description: 'Read live CRM attribution, first-party events, and PPC conversion-outbox status without replaying or mutating conversions.',
      inputSchema: { days: z.number().int().min(1).max(365).optional() },
      annotations: READ_ONLY,
    },
    ({ days }, context) => runRead('marketing_summary', context, () => readAssistantMarketingSummary(supabaseAdmin(), days ?? 30), { companyWide: true }),
  )
}
