import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveTaskAssignee } from '@/lib/api/task-assignee'
import { createWorkItem, type WorkItem } from '@/lib/server/work-items'
import { supabaseAdmin } from '@/lib/supabase/admin'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_FUTURE_DAYS = 366
const PAST_GRACE_MINUTES = 5

export const APPROVED_FOLLOW_UP_WORKFLOW_ID = 'approved-follow-up-task'

export type ApprovedFollowUpInput = {
  leadId: string
  title: string
  notes: string | null
  dueAt: string
  assignedTo: string
  kind: 'follow_up' | 'callback'
  department: 'acquisitions'
  role: 'setter'
  priority: 'normal'
  primaryNextAction: false
}

export type VerifiedNextActionProvenance = {
  aiGenerationId: string
  aiEvidenceIds: string[]
  aiSources: Array<{ name: string; url: string; detail: string | null }>
  aiModel: string | null
  aiPromptVersion: string
  aiRationale: string
  aiConfidence: 'high' | 'medium' | 'low'
}

export class WorkflowInputError extends Error {
  readonly code = 'invalid_workflow_input'
  readonly retryable = false
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function requiredText(value: unknown, label: string, minimum: number, maximum: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length < minimum || text.length > maximum) {
    throw new WorkflowInputError(`${label} must be between ${minimum} and ${maximum} characters.`)
  }
  return text
}

export function prepareApprovedFollowUpInput(
  value: unknown,
  actorName: string,
  now = new Date(),
  options: { enforceFuture?: boolean } = {},
): ApprovedFollowUpInput {
  const input = record(value)
  const leadId = typeof input.leadId === 'string' ? input.leadId.trim() : ''
  if (!UUID_PATTERN.test(leadId)) throw new WorkflowInputError('Select a valid CRM contact.')

  const title = requiredText(input.title, 'Title', 3, 160)
  const rawNotes = typeof input.notes === 'string' ? input.notes.trim() : ''
  if (rawNotes.length > 2_000) throw new WorkflowInputError('Notes must be 2,000 characters or fewer.')

  const dueAtText = requiredText(input.dueAt, 'Due date', 10, 80)
  const dueAt = new Date(dueAtText)
  if (!Number.isFinite(dueAt.getTime())) throw new WorkflowInputError('Enter a valid due date.')
  const latest = now.getTime() + MAX_FUTURE_DAYS * 24 * 60 * 60_000
  const tooOld = options.enforceFuture !== false && dueAt.getTime() < now.getTime() - PAST_GRACE_MINUTES * 60_000
  if (tooOld || dueAt.getTime() > latest) {
    throw new WorkflowInputError('Due date must be between now and one year from now.')
  }

  const assignee = resolveTaskAssignee(input.assignedTo, actorName, { defaultToActor: true })
  if (!assignee.authorized || !assignee.assignedTo) {
    throw new WorkflowInputError('Choose an approved task owner.')
  }

  const kind = input.kind === 'callback' ? 'callback' : 'follow_up'
  return {
    leadId: leadId.toLowerCase(),
    title,
    notes: rawNotes || null,
    dueAt: dueAt.toISOString(),
    assignedTo: assignee.assignedTo,
    kind,
    department: 'acquisitions',
    role: 'setter',
    priority: 'normal',
    primaryNextAction: false,
  }
}

export async function verifyNextActionGeneration(input: {
  generationId: unknown
  actorEmail: string
  leadId: string
}, db: SupabaseClient = supabaseAdmin()): Promise<VerifiedNextActionProvenance | null> {
  if (input.generationId === undefined || input.generationId === null || input.generationId === '') return null
  const generationId = typeof input.generationId === 'string' ? input.generationId.trim().toLowerCase() : ''
  if (!UUID_PATTERN.test(generationId)) throw new WorkflowInputError('AI proposal provenance is invalid.')

  const { data: generation, error: generationError } = await db
    .from('assistant_generations')
    .select('id,actor_email,status,model,response_message_id')
    .eq('id', generationId)
    .eq('actor_email', input.actorEmail.trim().toLowerCase())
    .eq('status', 'complete')
    .maybeSingle()
  if (generationError) throw new WorkflowInputError('AI proposal provenance could not be verified.')
  if (!generation?.response_message_id) throw new WorkflowInputError('AI proposal does not belong to this request.')

  const { data: message, error: messageError } = await db
    .from('assistant_messages')
    .select('metadata')
    .eq('id', generation.response_message_id)
    .eq('generation_id', generation.id)
    .maybeSingle()
  if (messageError) throw new WorkflowInputError('AI proposal provenance could not be verified.')
  const metadata = record(message?.metadata)
  if (metadata.feature !== 'next_action_proposal' || metadata.leadId !== input.leadId) {
    throw new WorkflowInputError('AI proposal does not match this contact.')
  }
  const evidenceIds = Array.isArray(metadata.evidence)
    ? metadata.evidence.flatMap((item) => {
        const id = typeof item === 'object' && item && 'id' in item && typeof item.id === 'string' ? item.id.trim() : ''
        return id ? [id.slice(0, 120)] : []
      }).slice(0, 6)
    : []
  const aiSources = Array.isArray(metadata.evidence)
    ? metadata.evidence.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const evidence = item as Record<string, unknown>
        const name = typeof evidence.label === 'string' ? evidence.label.trim().slice(0, 160) : ''
        const url = typeof evidence.url === 'string' ? evidence.url.trim().slice(0, 1_000) : ''
        const detail = typeof evidence.summary === 'string' ? evidence.summary.trim().slice(0, 500) : ''
        return name && /^https:\/\/crm\.savingkc\.com\//i.test(url) ? [{ name, url, detail: detail || null }] : []
      }).slice(0, 6)
    : []
  const proposal = record(metadata.proposal)
  const rationale = typeof proposal.rationale === 'string' ? proposal.rationale.trim().slice(0, 800) : ''
  const confidence = proposal.confidence === 'high' || proposal.confidence === 'medium' || proposal.confidence === 'low'
    ? proposal.confidence
    : null
  const promptVersion = typeof metadata.promptVersion === 'string' ? metadata.promptVersion.trim().slice(0, 120) : ''
  if (!promptVersion || evidenceIds.length === 0 || aiSources.length === 0 || !rationale || !confidence) {
    throw new WorkflowInputError('AI proposal provenance is incomplete.')
  }
  return {
    aiGenerationId: generation.id,
    aiEvidenceIds: evidenceIds,
    aiSources,
    aiModel: typeof generation.model === 'string' ? generation.model : null,
    aiPromptVersion: promptVersion,
    aiRationale: rationale,
    aiConfidence: confidence,
  }
}

export async function executeApprovedFollowUpTask(input: {
  runId: string
  workflowVersion: number
  definitionHash: string
  triggerKind: string
  requestedBy: string
  payload: Record<string, unknown>
}, db: SupabaseClient): Promise<{ created: boolean; workItem: WorkItem }> {
  const task = prepareApprovedFollowUpInput(input.payload, input.requestedBy, new Date(), { enforceFuture: false })
  const aiGenerationId = typeof input.payload.aiGenerationId === 'string' && UUID_PATTERN.test(input.payload.aiGenerationId)
    ? input.payload.aiGenerationId
    : null
  const aiEvidenceIds = Array.isArray(input.payload.aiEvidenceIds)
    ? input.payload.aiEvidenceIds.filter((value): value is string => typeof value === 'string').slice(0, 6)
    : []
  return createWorkItem({
    actor: input.requestedBy,
    idempotencyKey: `${input.runId}:create-follow-up-task`,
    leadId: task.leadId,
    kind: task.kind,
    title: task.title,
    notes: task.notes,
    dueAt: task.dueAt,
    assignedTo: task.assignedTo,
    department: task.department,
    role: task.role,
    priority: task.priority,
    primaryNextAction: task.primaryNextAction,
    provenance: {
      source: 'governed_workflow',
      workflow_id: APPROVED_FOLLOW_UP_WORKFLOW_ID,
      workflow_version: input.workflowVersion,
      workflow_run_id: input.runId,
      workflow_definition_hash: input.definitionHash,
      workflow_trigger_kind: input.triggerKind,
      ...(aiGenerationId ? {
        ai_assisted: true,
        ai_generation_id: aiGenerationId,
        ai_evidence_ids: aiEvidenceIds,
        ai_model: typeof input.payload.aiModel === 'string' ? input.payload.aiModel : null,
        ai_prompt_version: typeof input.payload.aiPromptVersion === 'string' ? input.payload.aiPromptVersion : null,
        ai_confidence: typeof input.payload.aiConfidence === 'string' ? input.payload.aiConfidence : null,
      } : {}),
    },
  }, db)
}
