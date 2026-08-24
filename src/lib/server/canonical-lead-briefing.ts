import { createHash } from 'node:crypto'
import { generateText, Output } from 'ai'
import { readAssistantLead360 } from '@/lib/assistant/queries'
import type { AssistantActor } from '@/lib/assistant/auth'
import {
  LEAD_BRIEFING_MODEL,
  LEAD_BRIEFING_PROMPT_VERSION,
  LEAD_BRIEFING_SYSTEM_PROMPT,
  buildLeadBriefingEvidence,
  leadBriefingSchema,
  leadBriefingInputFingerprint,
  leadBriefingPrompt,
  leadBriefingSourceSnapshotAt,
  leadBriefingSources,
  normalizeLeadBriefing,
  type LeadBriefing,
} from '@/lib/ai/lead-briefing'
import {
  completeAssistantGeneration,
  failAssistantGeneration,
  replayAssistantGeneration,
  startAssistantArtifactGeneration,
  type AssistantUsage,
} from '@/lib/ai/generation-store'
import { generateGroqLeadBriefing } from '@/lib/ai/groq-lead-briefing'
import { readLeadEntityContext } from '@/lib/server/crm-entity-foundation'
import { listWorkItems } from '@/lib/server/work-items'
import { supabaseAdmin } from '@/lib/supabase/admin'

const SYSTEM_ACTOR: AssistantActor = {
  email: 'briefing-worker@savingkc.internal',
  fullName: 'SavingKC AI Briefing Worker',
  role: 'system',
  access: 'owner',
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type CanonicalBriefingClaim = {
  leadId: string
  revision: number
  claimToken: string
  reason: string
  requestedBy: string
}

export type CanonicalBriefingState = {
  leadId: string
  briefing: {
    situation: string | null
    motivation: string | null
    strategy: string | null
    generatedAt: string
    generatedBy: string
    promptVersion: string | null
    generationId: string | null
    sourceSnapshotAt: string | null
    sourceRevision: number | null
  } | null
  freshness: 'current' | 'stale' | 'missing' | 'legacy'
  refresh: {
    status: string
    revision: number
    availableAt: string
    attempts: number
  } | null
}

function requireLeadId(value: string): string {
  const leadId = value.trim().toLowerCase()
  if (!UUID_PATTERN.test(leadId)) throw new Error('invalid_lead_id')
  return leadId
}

function requestId(leadId: string, revision: number, requestKey: string, fingerprint: string) {
  return createHash('sha256')
    .update(`canonical-briefing:${LEAD_BRIEFING_PROMPT_VERSION}:${leadId}:${revision}:${requestKey}:${fingerprint}`)
    .digest('hex')
}

function providerModel(result: Awaited<ReturnType<typeof generateText>>) {
  const provider = result.finalStep.model.provider
  const modelId = result.finalStep.model.modelId
  return { provider, model: modelId.includes('/') ? modelId : `${provider}/${modelId}` }
}

function usage(result: Awaited<ReturnType<typeof generateText>>): AssistantUsage {
  return {
    inputTokens: result.usage.inputTokens ?? null,
    outputTokens: result.usage.outputTokens ?? null,
    totalTokens: result.usage.totalTokens ?? null,
    cacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens ?? null,
  }
}

async function generateBriefingModel(evidence: ReturnType<typeof buildLeadBriefingEvidence>) {
  const system = LEAD_BRIEFING_SYSTEM_PROMPT
  const prompt = leadBriefingPrompt(evidence)
  if (process.env.GROQ_API_KEY?.trim()) {
    return generateGroqLeadBriefing({ system, prompt })
  }

  const result = await generateText({
    model: LEAD_BRIEFING_MODEL,
    system,
    prompt,
    output: Output.object({ schema: leadBriefingSchema }),
  })
  const modelInfo = providerModel(result)
  return {
    output: result.output,
    provider: modelInfo.provider,
    model: modelInfo.model,
    finishReason: result.finishReason,
    usage: usage(result),
  }
}

async function saveBriefing(input: {
  leadId: string
  briefing: LeadBriefing
  generationId: string
  generatedBy: string
  fingerprint: string
  sourceSnapshotAt: string | null
  sourceRevision: number
  evidence: ReturnType<typeof buildLeadBriefingEvidence>
}) {
  const selected = new Set(input.briefing.evidenceIds)
  const generatedFrom = {
    promptVersion: LEAD_BRIEFING_PROMPT_VERSION,
    inputFingerprint: input.fingerprint,
    evidence: input.evidence.filter((item) => selected.has(item.id)),
  }
  const { data, error } = await supabaseAdmin().rpc('save_current_briefing_v1', {
    p_lead_id: input.leadId,
    p_situation: input.briefing.situation,
    p_motivation: input.briefing.motivation,
    p_strategy: input.briefing.strategy,
    p_generated_by: input.generatedBy,
    p_generated_from: generatedFrom,
    p_generation_id: input.generationId,
    p_prompt_version: LEAD_BRIEFING_PROMPT_VERSION,
    p_input_fingerprint: input.fingerprint,
    p_source_snapshot_at: input.sourceSnapshotAt,
    p_source_revision: input.sourceRevision,
  })
  if (error || !data) throw new Error(`briefing_save_failed:${error?.message || 'empty_result'}`)
}

export async function queueCanonicalLeadBriefing(input: {
  leadId: string
  reason: string
  requestedBy: string
  delaySeconds?: number
}): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc('queue_crm_briefing_v1', {
    p_lead_id: requireLeadId(input.leadId),
    p_reason: input.reason,
    p_requested_by: input.requestedBy,
    p_delay_seconds: input.delaySeconds ?? 60,
  })
  const revision = Number(data)
  if (error || !Number.isInteger(revision) || revision < 1) {
    throw new Error(`briefing_queue_failed:${error?.message || 'invalid_revision'}`)
  }
  return revision
}

export async function claimCanonicalLeadBriefings(limit = 3): Promise<CanonicalBriefingClaim[]> {
  const { data, error } = await supabaseAdmin().rpc('claim_crm_briefing_jobs_v1', { p_limit: limit })
  if (error) throw new Error(`briefing_claim_failed:${error.message}`)
  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    leadId: String(row.lead_id),
    revision: Number(row.revision),
    claimToken: String(row.claim_token),
    reason: String(row.reason || 'crm_changed'),
    requestedBy: String(row.requested_by || 'system:crm'),
  })).filter((row) => UUID_PATTERN.test(row.leadId) && UUID_PATTERN.test(row.claimToken) && Number.isInteger(row.revision) && row.revision > 0)
}

export async function finishCanonicalLeadBriefing(input: {
  claim: CanonicalBriefingClaim
  success: boolean
  error?: string | null
}): Promise<string> {
  const { data, error } = await supabaseAdmin().rpc('finish_crm_briefing_job_v1', {
    p_lead_id: input.claim.leadId,
    p_revision: input.claim.revision,
    p_claim_token: input.claim.claimToken,
    p_success: input.success,
    p_error: input.error || null,
  })
  if (error || typeof data !== 'string') throw new Error(`briefing_finish_failed:${error?.message || 'invalid_status'}`)
  return data
}

export async function getCanonicalLeadBriefingState(leadIdValue: string): Promise<CanonicalBriefingState> {
  const leadId = requireLeadId(leadIdValue)
  const db = supabaseAdmin()
  const [briefingResult, jobResult] = await Promise.all([
    db.from('briefings')
      .select('situation,motivation,strategy,generated_at,generated_by,prompt_version,generation_id,source_snapshot_at,source_revision')
      .eq('lead_id', leadId)
      .eq('is_current', true)
      .maybeSingle(),
    db.from('crm_briefing_jobs')
      .select('status,revision,available_at,attempts')
      .eq('lead_id', leadId)
      .maybeSingle(),
  ])
  if (briefingResult.error || jobResult.error) {
    throw new Error(`briefing_state_unavailable:${(briefingResult.error || jobResult.error)?.message}`)
  }
  const briefing = briefingResult.data
  const job = jobResult.data
  const sourceRevision = briefing?.source_revision == null ? null : Number(briefing.source_revision)
  const jobRevision = job?.revision == null ? null : Number(job.revision)
  const freshness: CanonicalBriefingState['freshness'] = !briefing
    ? 'missing'
    : !briefing.prompt_version || sourceRevision == null
      ? 'legacy'
      : job && (job.status !== 'completed' || jobRevision == null || sourceRevision < jobRevision)
        ? 'stale'
        : 'current'

  return {
    leadId,
    briefing: briefing ? {
      situation: briefing.situation,
      motivation: briefing.motivation,
      strategy: briefing.strategy,
      generatedAt: briefing.generated_at,
      generatedBy: briefing.generated_by,
      promptVersion: briefing.prompt_version,
      generationId: briefing.generation_id,
      sourceSnapshotAt: briefing.source_snapshot_at,
      sourceRevision,
    } : null,
    freshness,
    refresh: job ? {
      status: job.status,
      revision: Number(job.revision),
      availableAt: job.available_at,
      attempts: Number(job.attempts),
    } : null,
  }
}

export async function generateCanonicalLeadBriefing(input: {
  claim: CanonicalBriefingClaim
}): Promise<{ generationId: string; briefing: LeadBriefing }> {
  const leadId = requireLeadId(input.claim.leadId)
  const actor = SYSTEM_ACTOR
  const db = supabaseAdmin()
  const [leadSnapshot, entityContext, workItems, coOwnerResult] = await Promise.all([
    readAssistantLead360(db, actor, leadId),
    readLeadEntityContext(leadId),
    listWorkItems({ leadId, statuses: ['pending', 'blocked'], limit: 10 }),
    db.from('lead_co_owners').select('name,relationship,source,updated_at,created_at').eq('lead_id', leadId).order('created_at', { ascending: true }).limit(10),
  ])
  if (coOwnerResult.error) throw new Error(`briefing_co_owner_read_failed:${coOwnerResult.error.message}`)
  if (!leadSnapshot.record) throw new Error('briefing_lead_not_found')

  const evidence = buildLeadBriefingEvidence({
    leadId,
    leadSnapshot,
    entityContext,
    workItems,
    coOwners: coOwnerResult.data || [],
  })
  if (evidence.length === 0) throw new Error('briefing_evidence_unavailable')
  const fingerprint = leadBriefingInputFingerprint(evidence)
  const snapshotAt = leadBriefingSourceSnapshotAt(evidence)
  const started = await startAssistantArtifactGeneration({
    actorEmail: actor.email,
    actorName: actor.fullName,
    title: 'Canonical lead briefing',
    content: `Generate a grounded lead briefing for CRM contact ${leadId}.`,
    requestId: requestId(leadId, input.claim.revision, input.claim.claimToken, fingerprint),
    context: {
      feature: 'canonical_lead_briefing',
      leadId,
      promptVersion: LEAD_BRIEFING_PROMPT_VERSION,
      sourceRevision: input.claim.revision,
      triggerReason: input.claim.reason,
    },
  })
  const generationId = started.generationId

  try {
    let briefing: LeadBriefing
    if (!started.created) {
      const existing = await replayAssistantGeneration(actor.email, started.generationId)
      if (existing.status !== 'complete' || !existing.reply) throw new Error(`briefing_generation_${existing.status}`)
      briefing = normalizeLeadBriefing(JSON.parse(existing.reply), evidence)
    } else {
      const result = await generateBriefingModel(evidence)
      briefing = normalizeLeadBriefing(result.output, evidence)
      const sources = leadBriefingSources(briefing, evidence)
      await completeAssistantGeneration({
        generationId,
        actorEmail: actor.email,
        content: JSON.stringify(briefing),
        provider: result.provider,
        model: result.model,
        finishReason: result.finishReason,
        usage: result.usage,
        toolTrace: [{
          toolCallId: `canonical-lead-evidence:${leadId}`,
          toolName: 'getCanonicalLeadBriefingEvidence',
          input: { leadId },
          resultCount: evidence.length,
          sources,
        }],
        sources,
        metadata: {
          feature: 'canonical_lead_briefing',
          promptVersion: LEAD_BRIEFING_PROMPT_VERSION,
          leadId,
          sourceRevision: input.claim.revision,
          inputFingerprint: fingerprint,
          evidence: evidence.filter((item) => briefing.evidenceIds.includes(item.id)),
          confidence: briefing.confidence,
          providerPolicy: process.env.GROQ_API_KEY?.trim() ? 'configured_groq' : 'ai_gateway',
        },
      })
    }

    await saveBriefing({
      leadId,
      briefing,
      generationId,
      generatedBy: actor.email,
      fingerprint,
      sourceSnapshotAt: snapshotAt,
      sourceRevision: input.claim.revision,
      evidence,
    })
    return { generationId, briefing }
  } catch (error) {
    if (started.created) {
      await failAssistantGeneration({
        generationId,
        actorEmail: actor.email,
        code: 'canonical_briefing_generation_failed',
        message: error instanceof Error ? error.message : 'Canonical briefing generation failed',
      })
    }
    throw error
  }
}
