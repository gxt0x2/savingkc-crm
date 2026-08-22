import { createHash } from 'node:crypto'
import { generateText, Output } from 'ai'
import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveAssistantActor } from '@/lib/assistant/auth'
import {
  PROSPECTING_CADENCE_MODEL,
  PROSPECTING_CADENCE_PROMPT_VERSION,
  PROSPECTING_CADENCE_SYSTEM_PROMPT,
  normalizeProspectingCadence,
  prospectingCadencePrompt,
  prospectingCadenceSchema,
  type ProspectingCadenceDraft,
  type ProspectingCadenceStep,
} from '@/lib/ai/prospecting-cadence'
import {
  AssistantGenerationError,
  completeAssistantGeneration,
  failAssistantGeneration,
  replayAssistantGeneration,
  startAssistantArtifactGeneration,
  type AssistantUsage,
} from '@/lib/ai/generation-store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

function response(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...HEADERS, ...init?.headers } })
}

function idempotencyKey(request: Request) {
  const value = request.headers.get('idempotency-key')?.trim() || ''
  return value.length >= 8 && value.length <= 160 ? value : null
}

function generationRequestId(actorEmail: string, clientRequestId: string) {
  return createHash('sha256').update(`prospecting-cadence:${actorEmail.toLowerCase()}:${clientRequestId}`).digest('hex')
}

function resultBody(input: {
  draft: ProspectingCadenceDraft
  generationId: string
  threadId: string
  provider: string | null
  model: string | null
  usage: AssistantUsage | null
  estimatedCostMicros: number | null
}) {
  return {
    ...input,
    execution: 'proposal_only',
    approvalRequired: true,
  }
}

function cleanSteps(value: unknown): ProspectingCadenceStep[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 4).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const bodyTemplate = typeof row.bodyTemplate === 'string' ? row.bodyTemplate.trim().slice(0, 320) : ''
    const delayMinutes = Number(row.delayMinutes)
    return bodyTemplate && Number.isInteger(delayMinutes) && delayMinutes >= 0 && delayMinutes <= 43_200
      ? [{ bodyTemplate, delayMinutes }]
      : []
  })
}

function errorResponse(error: unknown) {
  if (error instanceof AssistantGenerationError) return response({ error: error.message, code: error.code }, { status: error.status })
  console.error('[prospecting-cadence] generation failed', error)
  return response({ error: 'AI cadence drafting is temporarily unavailable.' }, { status: 503 })
}

export async function POST(request: Request) {
  const authenticated = await resolveAuthenticatedActor()
  if (!authenticated) return response({ error: 'Unauthorized' }, { status: 401 })
  const actor = await resolveAssistantActor(authenticated.email)
  if (!actor) return response({ error: 'CRM profile not authorized' }, { status: 403 })
  const clientRequestId = idempotencyKey(request)
  if (!clientRequestId) return response({ error: 'A valid Idempotency-Key is required.' }, { status: 400 })

  let generationId: string | null = null
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const campaignName = typeof body?.campaignName === 'string' ? body.campaignName.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
    const objective = typeof body?.objective === 'string' ? body.objective.replace(/\s+/g, ' ').trim().slice(0, 400) : ''
    const currentSteps = cleanSteps(body?.currentSteps)
    if (!campaignName) return response({ error: 'Name the campaign before drafting its cadence.' }, { status: 400 })

    const started = await startAssistantArtifactGeneration({
      actorEmail: actor.email,
      actorName: actor.fullName,
      title: `AI cadence draft · ${campaignName}`,
      content: `Draft a human-reviewed SMS cadence proposal for ${campaignName}.`,
      requestId: generationRequestId(actor.email, clientRequestId),
      context: { feature: 'prospecting_cadence', promptVersion: PROSPECTING_CADENCE_PROMPT_VERSION, campaignName },
    })
    generationId = started.generationId

    if (!started.created) {
      const existing = await replayAssistantGeneration(actor.email, started.generationId)
      if (existing.status === 'complete' && existing.reply) {
        const draft = normalizeProspectingCadence(JSON.parse(existing.reply))
        return response(resultBody({
          draft,
          generationId: existing.generationId,
          threadId: existing.threadId,
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
      model: PROSPECTING_CADENCE_MODEL,
      system: PROSPECTING_CADENCE_SYSTEM_PROMPT,
      prompt: prospectingCadencePrompt({ campaignName, objective, currentSteps }),
      output: Output.object({ schema: prospectingCadenceSchema }),
    })
    const draft = normalizeProspectingCadence(result.output)
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
      content: JSON.stringify(draft),
      provider,
      model,
      finishReason: result.finishReason,
      usage,
      toolTrace: [],
      sources: [],
      metadata: { feature: 'prospecting_cadence', promptVersion: PROSPECTING_CADENCE_PROMPT_VERSION, campaignName, draft },
    })
    const completed = await replayAssistantGeneration(actor.email, started.generationId)
    return response(resultBody({
      draft,
      generationId: completed.generationId,
      threadId: completed.threadId,
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
        code: error instanceof AssistantGenerationError ? error.code : 'prospecting_cadence_generation_failed',
        message: error instanceof Error ? error.message : 'AI cadence generation failed',
      })
    }
    return errorResponse(error)
  }
}
