import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { generateText, Output } from 'ai'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveAssistantActor } from '@/lib/assistant/auth'
import { readAssistantLead360 } from '@/lib/assistant/queries'
import {
  NEXT_ACTION_MODEL,
  NEXT_ACTION_PROMPT_VERSION,
  NEXT_ACTION_SYSTEM_PROMPT,
  buildNextActionEvidence,
  nextActionProposalPrompt,
  nextActionProposalSchema,
  normalizeNextActionProposal,
  proposalSources,
  type NextActionProposal,
} from '@/lib/ai/next-action-proposal'
import {
  AssistantGenerationError,
  completeAssistantGeneration,
  failAssistantGeneration,
  replayAssistantGeneration,
  startAssistantArtifactGeneration,
  type AssistantSource,
  type AssistantUsage,
} from '@/lib/ai/generation-store'
import { listWorkItems } from '@/lib/server/work-items'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function response(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...HEADERS, ...init?.headers } })
}

function requestId(request: Request): string | null {
  const value = request.headers.get('idempotency-key')?.trim() || ''
  return value.length >= 8 && value.length <= 160 ? value : null
}

function generationRequestId(leadId: string, clientRequestId: string): string {
  return createHash('sha256').update(`next-action-proposal:${leadId}:${clientRequestId}`).digest('hex')
}

function generationResponse(input: {
  proposal: NextActionProposal
  generationId: string
  threadId: string
  sources: AssistantSource[]
  provider: string | null
  model: string | null
  usage: AssistantUsage | null
  estimatedCostMicros: number | null
}) {
  return {
    proposal: input.proposal,
    generationId: input.generationId,
    threadId: input.threadId,
    citations: input.sources,
    provider: input.provider,
    model: input.model,
    usage: input.usage,
    estimatedCostMicros: input.estimatedCostMicros,
    grounded: true,
    execution: 'proposal_only',
    approvalRequired: true,
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AssistantGenerationError) {
    return response({ error: error.message, code: error.code }, { status: error.status })
  }
  const message = error instanceof Error ? error.message : ''
  if (message.toLowerCase().includes('forbidden')) return response({ error: 'This contact is outside your authorized scope.' }, { status: 403 })
  console.error('[next-action-proposal] generation failed', error)
  return response({ error: 'AI next-action drafting is temporarily unavailable.' }, { status: 503 })
}

export async function POST(request: Request) {
  const authenticated = await resolveAuthenticatedActor()
  if (!authenticated) return response({ error: 'Unauthorized' }, { status: 401 })
  const actor = await resolveAssistantActor(authenticated.email)
  if (!actor) return response({ error: 'CRM profile not authorized' }, { status: 403 })
  const stableRequestId = requestId(request)
  if (!stableRequestId) return response({ error: 'A valid Idempotency-Key is required.' }, { status: 400 })

  let generationId: string | null = null
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const leadId = typeof body?.leadId === 'string' ? body.leadId.trim().toLowerCase() : ''
    if (!UUID_PATTERN.test(leadId)) return response({ error: 'Select a valid CRM contact.' }, { status: 400 })

    const openWork = await listWorkItems({ leadId, statuses: ['pending', 'blocked'], limit: 5 })
    if (openWork.length > 0) {
      const current = openWork[0]
      return response({
        error: 'This contact already has open work. Review it before drafting another action.',
        code: 'open_work_exists',
        existingWorkItem: { key: current.key, title: current.title, dueAt: current.dueAt, assignedTo: current.assignedTo },
      }, { status: 409 })
    }

    const snapshot = await readAssistantLead360(supabaseAdmin(), actor, leadId)
    if (!snapshot.record) return response({ error: 'Contact not found.' }, { status: 404 })
    const evidence = buildNextActionEvidence(snapshot)
    if (evidence.length === 0) throw new Error('No verified evidence was available for this contact.')

    const started = await startAssistantArtifactGeneration({
      actorEmail: actor.email,
      actorName: actor.fullName,
      title: 'AI next-action proposal',
      content: `Draft a governed next action for CRM contact ${leadId}.`,
      requestId: generationRequestId(leadId, stableRequestId),
      context: { feature: 'next_action_proposal', leadId, promptVersion: NEXT_ACTION_PROMPT_VERSION },
    })
    generationId = started.generationId

    if (!started.created) {
      const existing = await replayAssistantGeneration(actor.email, started.generationId)
      if (existing.status === 'complete' && existing.reply) {
        const proposal = nextActionProposalSchema.parse(JSON.parse(existing.reply))
        return response(generationResponse({
          proposal,
          generationId: existing.generationId,
          threadId: existing.threadId,
          sources: existing.sources,
          provider: existing.provider,
          model: existing.model,
          usage: existing.usage,
          estimatedCostMicros: existing.estimatedCostMicros,
        }))
      }
      return response({
        error: existing.status === 'running' ? 'This AI draft is already in progress.' : 'This AI draft was already attempted.',
        code: `generation_${existing.status}`,
      }, { status: 409 })
    }

    const result = await generateText({
      model: NEXT_ACTION_MODEL,
      system: NEXT_ACTION_SYSTEM_PROMPT,
      prompt: nextActionProposalPrompt(evidence),
      output: Output.object({ schema: nextActionProposalSchema }),
    })
    const proposal = normalizeNextActionProposal(result.output, evidence)
    const sources = proposalSources(proposal, evidence)
    const provider = result.finalStep.model.provider
    const modelId = result.finalStep.model.modelId
    const model = modelId.includes('/') ? modelId : `${provider}/${modelId}`
    const usage: AssistantUsage = {
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
      totalTokens: result.usage.totalTokens ?? null,
      cacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens ?? null,
    }
    await completeAssistantGeneration({
      generationId: started.generationId,
      actorEmail: actor.email,
      content: JSON.stringify(proposal),
      provider,
      model,
      finishReason: result.finishReason,
      usage,
      toolTrace: [{
        toolCallId: `lead-360:${leadId}`,
        toolName: 'getContact360',
        input: { leadId },
        resultCount: 1,
        sources,
      }],
      sources,
      metadata: {
        feature: 'next_action_proposal',
        promptVersion: NEXT_ACTION_PROMPT_VERSION,
        leadId,
        proposal,
        evidence: evidence.filter((item) => proposal.evidenceIds.includes(item.id)),
      },
    })
    const completed = await replayAssistantGeneration(actor.email, started.generationId)
    return response(generationResponse({
      proposal,
      generationId: completed.generationId,
      threadId: completed.threadId,
      sources: completed.sources,
      provider: completed.provider,
      model: completed.model,
      usage: completed.usage,
      estimatedCostMicros: completed.estimatedCostMicros,
    }))
  } catch (error) {
    if (generationId) {
      await failAssistantGeneration({
        generationId,
        actorEmail: actor.email,
        code: error instanceof AssistantGenerationError ? error.code : 'next_action_generation_failed',
        message: error instanceof Error ? error.message : 'AI next-action generation failed',
      })
    }
    return errorResponse(error)
  }
}
