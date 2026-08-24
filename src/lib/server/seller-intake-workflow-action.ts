import type { SupabaseClient } from '@supabase/supabase-js'
import {
  SELLER_INTAKE_WORKFLOW_ID,
  SELLER_INTAKE_WORKFLOW_VERSION,
} from '@/lib/operating-model/seller-intake'
import { createWorkItem, WorkItemError } from '@/lib/server/work-items'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TRIGGER_KEY_PATTERN = /^seller-form-intake:[a-f0-9]{24}$/
const DEFINITION_HASH_PATTERN = /^[a-f0-9]{64}$/i
const DEPARTMENT_NAMES = new Set(['acquisitions', 'dispositions', 'marketing', 'transaction coordination'])

type SellerIntakeWorkflowPayload = {
  leadId: string
  formSource: string
  workflowTriggerKey: string
  identityKeys: string[]
  dueAt: string
  acknowledgementAllowed: boolean
  acknowledgementReason: 'consent_granted' | 'consent_missing' | 'phone_missing'
}

export class SellerIntakeWorkflowError extends Error {
  readonly code = 'invalid_seller_intake_workflow'
  readonly retryable = false
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function requiredText(value: unknown, label: string, maximum: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > maximum) throw new SellerIntakeWorkflowError(`${label} is invalid.`)
  return text
}

export function prepareSellerIntakeWorkflowPayload(value: unknown): SellerIntakeWorkflowPayload {
  const input = object(value)
  const leadId = requiredText(input.leadId, 'Lead', 80).toLowerCase()
  if (!UUID_PATTERN.test(leadId)) throw new SellerIntakeWorkflowError('Lead is invalid.')

  const formSource = requiredText(input.formSource, 'Form source', 120)
  const workflowTriggerKey = requiredText(input.workflowTriggerKey, 'Workflow trigger', 200)
  if (!TRIGGER_KEY_PATTERN.test(workflowTriggerKey)) {
    throw new SellerIntakeWorkflowError('Workflow trigger is invalid.')
  }

  const dueAt = requiredText(input.dueAt, 'Due date', 80)
  const parsedDueAt = new Date(dueAt)
  if (!Number.isFinite(parsedDueAt.getTime())) throw new SellerIntakeWorkflowError('Due date is invalid.')

  const identityKeys = Array.isArray(input.identityKeys)
    ? [...new Set(input.identityKeys.flatMap((entry) => {
        const key = typeof entry === 'string' ? entry.trim() : ''
        return key && key.length <= 500 ? [key] : []
      }))].slice(0, 6)
    : []
  const acknowledgementReason = input.acknowledgementReason === 'consent_granted'
    || input.acknowledgementReason === 'consent_missing'
    || input.acknowledgementReason === 'phone_missing'
    ? input.acknowledgementReason
    : null
  if (!acknowledgementReason || typeof input.acknowledgementAllowed !== 'boolean') {
    throw new SellerIntakeWorkflowError('Acknowledgement evidence is invalid.')
  }
  if (input.acknowledgementAllowed !== (acknowledgementReason === 'consent_granted')) {
    throw new SellerIntakeWorkflowError('Acknowledgement evidence is inconsistent.')
  }

  return {
    leadId,
    formSource,
    workflowTriggerKey,
    identityKeys,
    dueAt: parsedDueAt.toISOString(),
    acknowledgementAllowed: input.acknowledgementAllowed,
    acknowledgementReason,
  }
}

async function findExistingPrimaryWorkItem(db: SupabaseClient, leadId: string): Promise<string | null> {
  const { data, error } = await db
    .from('work_items')
    .select('work_item_key')
    .eq('lead_id', leadId)
    .eq('primary_next_action', true)
    .eq('operational_lane', 'current')
    .in('status', ['pending', 'blocked'])
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Seller intake primary-action lookup failed: ${error.message}`)
  return typeof data?.work_item_key === 'string' ? data.work_item_key : null
}

async function findCurrentLeadOwner(db: SupabaseClient, leadId: string): Promise<string | null> {
  const { data, error } = await db
    .from('leads')
    .select('assigned_agent')
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw new Error(`Seller intake owner lookup failed: ${error.message}`)
  if (!data) throw new Error('Seller intake owner lookup failed: lead was not found')
  const owner = typeof data.assigned_agent === 'string' ? data.assigned_agent.trim() : ''
  return owner && !DEPARTMENT_NAMES.has(owner.toLowerCase()) ? owner : null
}

async function findExistingIntakeEvent(
  db: SupabaseClient,
  leadId: string,
  workflowRunId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('lead_activities')
    .select('id')
    .eq('lead_id', leadId)
    .eq('activity_type', 'status_change')
    .contains('metadata', {
      workflow_id: SELLER_INTAKE_WORKFLOW_ID,
      workflow_run_id: workflowRunId,
    })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Seller intake evidence lookup failed: ${error.message}`)
  return typeof data?.id === 'string' ? data.id : null
}

export async function executeSellerIntakeWorkflow(input: {
  runId: string
  workflowVersion: number
  definitionHash: string
  triggerKind: string
  requestedBy: string
  payload: Record<string, unknown>
}, db: SupabaseClient): Promise<Record<string, unknown>> {
  if (
    input.workflowVersion !== SELLER_INTAKE_WORKFLOW_VERSION
    || !DEFINITION_HASH_PATTERN.test(input.definitionHash)
    || input.triggerKind !== 'lead_form_submitted'
    || input.requestedBy.trim().toLowerCase() !== 'savingkc operations'
  ) {
    throw new SellerIntakeWorkflowError('Workflow execution envelope is invalid.')
  }
  const payload = prepareSellerIntakeWorkflowPayload(input.payload)

  const existingEventId = await findExistingIntakeEvent(db, payload.leadId, input.runId)
    ?? await findExistingIntakeEvent(db, payload.leadId, payload.workflowTriggerKey)
  if (existingEventId) {
    return {
      created: false,
      legacyCompatible: true,
      leadId: payload.leadId,
      statusActivityId: existingEventId,
    }
  }

  const owner = await findCurrentLeadOwner(db, payload.leadId)

  let workItemKey = await findExistingPrimaryWorkItem(db, payload.leadId)
  let workItemCreated = false
  if (!workItemKey) {
    try {
      const workItem = await createWorkItem({
        actor: input.requestedBy,
        idempotencyKey: `${input.runId}:seller-intake-primary`,
        leadId: payload.leadId,
        kind: 'task',
        title: 'Make first contact',
        notes: 'Respond to the new seller inquiry and record the factual outcome.',
        dueAt: payload.dueAt,
        assignedTo: owner,
        department: 'acquisitions',
        role: 'setter',
        priority: 'urgent',
        primaryNextAction: true,
        provenance: {
          source: 'governed_workflow',
          event_backed: true,
          event_type: 'lead_form_submitted',
          workflow_id: SELLER_INTAKE_WORKFLOW_ID,
          workflow_version: input.workflowVersion,
          workflow_run_id: input.runId,
          workflow_trigger_key: payload.workflowTriggerKey,
          workflow_definition_hash: input.definitionHash,
          workflow_trigger_kind: input.triggerKind,
          form_source: payload.formSource,
          task_type: 'call',
        },
      }, db)
      workItemKey = workItem.workItem.key
      workItemCreated = workItem.created
    } catch (error) {
      if (!(error instanceof WorkItemError) || error.code !== 'conflict') throw error
      workItemKey = await findExistingPrimaryWorkItem(db, payload.leadId)
      if (!workItemKey) throw error
    }
  }

  const { data: statusActivity, error: statusError } = await db
    .from('lead_activities')
    .insert({
      lead_id: payload.leadId,
      activity_type: 'status_change',
      description: 'Seller intake workflow established conversation state and a primary action.',
      agent: input.requestedBy,
      metadata: {
        source: 'governed_workflow',
        event_backed: true,
        event_type: 'lead_form_submitted',
        workflow_id: SELLER_INTAKE_WORKFLOW_ID,
        workflow_version: input.workflowVersion,
        workflow_run_id: input.runId,
        workflow_trigger_key: payload.workflowTriggerKey,
        workflow_definition_hash: input.definitionHash,
        workflow_trigger_kind: input.triggerKind,
        form_source: payload.formSource,
        record_kind: 'opportunity',
        opportunity_stage: 'new',
        owner_kind: owner ? 'agent' : 'team_queue',
        owner_name: owner,
        department: 'acquisitions',
        assignment_required: owner === null,
        identity_keys: payload.identityKeys,
        conversation_attention: 'needs_reply',
        acknowledgement_channel: 'sms',
        acknowledgement_allowed: payload.acknowledgementAllowed,
        acknowledgement_reason: payload.acknowledgementReason,
        acknowledgement_handler: 'existing_form_route',
      },
    })
    .select('id')
    .single()
  if (statusError || !statusActivity?.id) {
    throw new Error(`Seller intake evidence insert failed: ${statusError?.message || 'missing activity id'}`)
  }

  return {
    created: workItemCreated,
    leadId: payload.leadId,
    workItemKey,
    owner,
    assignmentRequired: owner === null,
    statusActivityId: statusActivity.id,
  }
}
