import { ToolLoopAgent, isStepCount, tool, type ToolSet } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import { assistantActorCanReadCompanyWide, type AssistantActor } from '@/lib/assistant/auth'
import { GROQ_STRUCTURED_TEXT_MODEL } from '@/lib/ai/groq-models'
import {
  readAssistantAttention,
  readAssistantCommunications,
  readAssistantLead360,
  readAssistantOperatingSnapshot,
  readAssistantPhoneSystem,
  readAssistantWorkflowRegistry,
  searchAssistantLeads,
} from '@/lib/assistant/queries'
import { supabaseAdmin } from '@/lib/supabase/admin'

const instructions = `You are the SavingKC AI Assistant. You may answer any user request, but company and CRM questions must be answered first through SavingKC's recorded goals, current operating state, and approved workflow paths.

Operating rules:
- Start with a direct answer. Then state: (1) what the live evidence says, (2) whether the company is on or off its recorded goal or operating path, (3) the highest-leverage next action, and (4) what can be implemented now.
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
  }

  const agentTools: ToolSet = { ...scopedTools }
  if (assistantActorCanReadCompanyWide(actor)) Object.assign(agentTools, {
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
  })

  return new ToolLoopAgent({
    id: 'savingkc-command-agent',
    model: commandModel(provider),
    instructions: `${instructions}\n\nSigned-in actor: ${actor.fullName} (${actor.access}). Only use tools exposed for this actor.`,
    stopWhen: isStepCount(8),
    temperature: 0.2,
    tools: agentTools,
  })
}
