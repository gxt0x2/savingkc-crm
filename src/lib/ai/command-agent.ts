import { ToolLoopAgent, isStepCount, tool, type ToolSet } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import { assistantActorCanReadCompanyWide, type AssistantActor } from '@/lib/assistant/auth'
import { GROQ_STRUCTURED_TEXT_MODEL } from '@/lib/ai/groq-models'
import {
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
import { getAiChangeProposalsForLead } from '@/lib/server/ai-change-proposals'
import { supabaseAdmin } from '@/lib/supabase/admin'

const instructions = `You are the SavingKC AI Assistant. You may answer any user request, but company and CRM questions must be answered first through SavingKC's recorded goals, current operating state, and approved workflow paths.

Operating rules:
- Start with a direct answer. For the default response, follow it with no more than three short bullets covering only the decision-relevant live evidence or goal status, the highest-leverage next action, and what can be implemented now.
- Keep a default response at or below 160 words. Do not repeat the request, narrate your research, dump raw tool results, or enumerate everything you checked. If useful supporting material remains, offer to show it instead of including it automatically.
- Expand only when the user explicitly asks for a detailed analysis, full report, audit, exhaustive list, or implementation plan, or when a consequential-change proposal needs validation and rollback detail. Even then, lead with a compact summary and keep the response below 300 words.
- Do not force every response into every category. Omit sections that do not help the user decide or act.
- Think proactively. Surface the next likely constraint, dependency, or follow-up before it becomes a missed lead, stalled contract, routing error, or incomplete closeout. Do not manufacture urgency or evidence.
- The core path is Marketing intake -> New -> meaningful two-way contact and explicit classification -> Lead -> Opportunity -> Appointment -> Offer -> Under Contract -> Dispositions / Transaction Coordination -> Closed -> Debrief -> verified closeout and workflow improvement.
- A newly entered contact stays in New until meaningful two-way contact and explicit classification. Outbound attempts alone update outreach status; they do not promote the contact.
- Identity, ownership, communication outcome, stage, next action, and unresolved attention are the system of record.
- Use the read tools before making claims about CRM data, goals, phone routes, workflows, contacts, or performance. Compare actual performance only with configured goals; call out an unconfigured goal instead of inventing one.
- Never invent a count, route, owner, outcome, or workflow state.
- Cite the CRM sources returned by tools when stating CRM facts. Do not invent URLs.
- You currently have read-only tools. If the user asks you to send a call or message, reassign a record, move a stage, publish a workflow, change routing, delete data, or spend money, do not claim it happened. Return a concrete proposed change, affected records, validation checks, rollback, and the confirmation required.
- Prefer concise, operational answers. Lead with the answer and link the user to the relevant CRM surface using paths such as /contacts, /conversations, /prospecting, /workflows?section=phones, /workflows?section=all, /reports, or /reports/andon.
- Treat phone-number purpose and to/from identity as protected. Flag mismatches rather than assuming they are correct.`

export type CommandAgentProvider = 'gateway' | 'groq'

function commandModel(provider: CommandAgentProvider) {
  if (provider === 'gateway') return 'openai/gpt-5.6-luna'

  const apiKey = process.env.GROQ_API_KEY?.trim()
  if (!apiKey) throw new Error('groq_command_not_configured')
  return createOpenAICompatible({
    name: 'groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey,
    transformRequestBody: (body) => ({
      ...body,
      messages: Array.isArray(body.messages)
        ? body.messages.map((message) => {
            if (!message || typeof message !== 'object' || Array.isArray(message)) return message
            const clean = { ...message }
            delete clean.reasoning_content
            return clean
          })
        : body.messages,
    }),
  }).chatModel(GROQ_STRUCTURED_TEXT_MODEL)
}

export function createCommandAgent(actor: AssistantActor, provider: CommandAgentProvider = 'gateway') {
  const db = supabaseAdmin()
  const scopedTools = {
    getConnectionStatus: tool({
      description: 'Confirm this signed-in actor’s authenticated, read-only connection to the live SavingKC CRM.',
      inputSchema: z.object({}),
      execute: async () => ({
        connected: true,
        mode: 'read-only',
        approvalBoundary: 'Consequential CRM changes remain subject to human review.',
        actor: { access: actor.access, role: actor.role },
        generatedAt: new Date().toISOString(),
      }),
    }),
    getMyAttention: tool({
      description: 'Read the signed-in actor’s current tasks, appointments, stale leads, transaction work, and disposition deadlines.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(30).default(15) }),
      execute: async ({ limit }) => readAssistantAttention(db, actor, limit),
    }),
    findContacts: tool({
      description: 'Find CRM contacts within the signed-in actor’s authorized scope by person, address, phone, or email.',
      inputSchema: z.object({ query: z.string().min(1).max(80), limit: z.number().int().min(1).max(12).default(8) }),
      execute: async ({ query, limit }) => searchAssistantLeads(db, actor, query, limit),
    }),
    getContact360: tool({
      description: 'Read one authorized CRM contact with its activity, appointments, offers, disposition, and transaction-coordination context.',
      inputSchema: z.object({ leadId: z.string().uuid() }),
      execute: async ({ leadId }) => readAssistantLead360(db, actor, leadId),
    }),
    getContactCommunications: tool({
      description: 'Read bounded call, SMS, email, voicemail, and note history for one authorized CRM contact.',
      inputSchema: z.object({ leadId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(50) }),
      execute: async ({ leadId, limit }) => readAssistantCommunications(db, actor, leadId, limit),
    }),
    getPendingAiChangeReviews: tool({
      description: 'List pending, human-reviewed AI change proposals for one authorized CRM contact without approving or applying them.',
      inputSchema: z.object({ leadId: z.string().uuid() }),
      execute: async ({ leadId }) => {
        const lead = await readAssistantLead360(db, actor, leadId)
        if (!lead.record) return { contactId: leadId, proposals: [] }
        return { contactId: leadId, proposals: await getAiChangeProposalsForLead(leadId) }
      },
    }),
  }

  const agentTools: ToolSet = { ...scopedTools }
  if (assistantActorCanReadCompanyWide(actor)) Object.assign(agentTools, {
    getSourceCatalog: tool({
      description: 'List the business data sources available to the assistant and their current connection state.',
      inputSchema: z.object({}),
      execute: async () => readAssistantSourceCatalog(),
    }),
    getOperatingSnapshot: tool({
      description: 'Read a live company-wide SavingKC operating snapshot for a period. Use for counts, pipeline, goals, owners, sources, tasks, deals, and debrief questions.',
      inputSchema: z.object({ days: z.number().int().min(1).max(365).default(30) }),
      execute: async ({ days }) => readAssistantOperatingSnapshot(days),
    }),
    getPhoneSystem: tool({
      description: 'Read the protected company phone-number registry, including voice, SMS, no-answer, outbound, fallback, owner, and workflow paths.',
      inputSchema: z.object({ search: z.string().max(80).optional() }),
      execute: async ({ search }) => readAssistantPhoneSystem(search),
    }),
    getWorkflowRegistry: tool({
      description: 'Read the company workflow registry with triggers, actions, owner, status, approval policy, and implementation sources.',
      inputSchema: z.object({ search: z.string().max(80).optional() }),
      execute: async ({ search }) => readAssistantWorkflowRegistry(db, search),
    }),
    getWebsiteFunnel: tool({
      description: 'Read live website lead and first-party attribution funnel metrics for a bounded period.',
      inputSchema: z.object({ days: z.number().int().min(1).max(365).default(30) }),
      execute: async ({ days }) => readAssistantWebsiteFunnel(db, days),
    }),
    getMarketingSummary: tool({
      description: 'Read live CRM attribution, first-party events, and PPC conversion-outbox status for a bounded period without mutating conversions.',
      inputSchema: z.object({ days: z.number().int().min(1).max(365).default(30) }),
      execute: async ({ days }) => readAssistantMarketingSummary(db, days),
    }),
  })

  return new ToolLoopAgent({
    id: 'savingkc-command-agent',
    model: commandModel(provider),
    instructions: `${instructions}\n\nSigned-in actor: ${actor.fullName} (${actor.access}). Only use tools exposed for this actor.`,
    maxOutputTokens: 500,
    stopWhen: isStepCount(8),
    temperature: 0.2,
    tools: agentTools,
  })
}
