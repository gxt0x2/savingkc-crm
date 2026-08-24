import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkflowCategory, WorkflowDefinition, WorkflowImplementation } from './types'
import { validateWorkflowDefinition } from './workflow-catalog'

const KEY_PREFIX = 'workflow_definition:v1:'

export const WORKFLOW_CATEGORIES: readonly WorkflowCategory[] = [
  'phone_routing',
  'lead_intake',
  'appointment',
  'communication',
  'pipeline',
  'nurture',
  'dispositions',
  'data_sync',
  'reporting',
  'operating_rhythm',
  'ai',
]

export type StoredWorkflowDefinition = {
  definition: WorkflowDefinition
  governance: {
    createdBy: string
    createdAt: string
    updatedAt: string
    rollbackPlan: string
  }
}

export type WorkflowDraftValidationCheck = {
  id: 'definition_contract' | 'draft_state' | 'approval_boundary' | 'rollback_plan' | 'executor_mapping'
  label: string
  status: 'pass' | 'warning' | 'blocked'
  detail: string
}

export type WorkflowDraftValidationReport = {
  workflowId: string
  workflowVersion: number
  generatedAt: string
  mode: 'validation_only'
  readyForReview: boolean
  readyForPublish: false
  checks: WorkflowDraftValidationCheck[]
  plannedEffects: Array<{
    order: number
    label: string
    executor: 'not_wired'
    effect: 'read_only' | 'potential_crm_write'
  }>
  boundary: {
    mutatesData: boolean
    approvalPolicy: WorkflowImplementation['approvalPolicy']
    protectedResources: string[]
    execution: WorkflowImplementation['execution']
  }
}

export type WorkflowDraftInput = {
  name: string
  description: string
  category: WorkflowCategory
  owner: string
  trigger: string
  actions: string[]
  mutatesData: boolean
  approvalPolicy: 'user_confirmation' | 'admin_only'
  protectedResources?: string[]
  rollbackPlan: string
}

function clean(value: string, max: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, max)
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 56) || 'workflow'
}

export function buildWorkflowDraft(input: WorkflowDraftInput, actor: string, now = new Date()): StoredWorkflowDefinition {
  const name = clean(input.name, 100)
  const description = clean(input.description, 500)
  const owner = clean(input.owner, 100)
  const trigger = clean(input.trigger, 300)
  const actions = input.actions.map((action) => clean(action, 300)).filter(Boolean).slice(0, 20)
  const rollbackPlan = clean(input.rollbackPlan, 500)
  if (!name || !description || !owner || !trigger || !rollbackPlan || actions.length === 0) {
    throw new Error('Name, description, owner, trigger, at least one action, and rollback plan are required.')
  }
  if (!WORKFLOW_CATEGORIES.includes(input.category)) throw new Error('Invalid workflow category.')

  const createdAt = now.toISOString()
  const id = `${slug(name)}-${crypto.randomUUID().slice(0, 8)}`
  const definition: WorkflowDefinition = {
    id,
    name,
    description,
    category: input.category,
    status: 'draft',
    health: 'not_run',
    owner: { kind: 'user', id: slug(actor), displayName: owner },
    trigger: { type: 'manual', surface: trigger },
    actions: actions.map((label) => ({ type: 'execute' as const, label })),
    protectedResources: input.protectedResources?.map((resource) => clean(resource, 100)).filter(Boolean),
    implementation: {
      sourceFiles: [`configuration:${KEY_PREFIX}${id}`],
      execution: 'configuration',
      mutatesData: input.mutatesData,
      approvalPolicy: input.approvalPolicy,
    },
    version: 1,
    lastRunAt: null,
  }

  const errors = validateWorkflowDefinition(definition).filter((issue) => issue.severity === 'error')
  if (errors.length > 0) throw new Error(errors.map((issue) => issue.message).join(' '))

  return {
    definition,
    governance: { createdBy: actor, createdAt, updatedAt: createdAt, rollbackPlan },
  }
}

export async function readStoredWorkflowDefinitions(db: SupabaseClient): Promise<StoredWorkflowDefinition[]> {
  const { data, error } = await db.from('system_config').select('value').like('key', `${KEY_PREFIX}%`)
  if (error) throw new Error(`Workflow registry unavailable: ${error.message}`)
  return (data ?? []).flatMap((row) => {
    try {
      const parsed = JSON.parse(String(row.value)) as StoredWorkflowDefinition
      return parsed?.definition?.id && parsed?.governance?.createdAt ? [parsed] : []
    } catch {
      return []
    }
  }).sort((a, b) => b.governance.updatedAt.localeCompare(a.governance.updatedAt))
}

export async function readStoredWorkflowDefinition(db: SupabaseClient, workflowId: string): Promise<StoredWorkflowDefinition | null> {
  const { data, error } = await db
    .from('system_config')
    .select('value')
    .eq('key', `${KEY_PREFIX}${workflowId}`)
    .maybeSingle()
  if (error) throw new Error(`Workflow registry unavailable: ${error.message}`)
  if (!data?.value) return null
  try {
    const parsed = JSON.parse(String(data.value)) as StoredWorkflowDefinition
    return parsed?.definition?.id === workflowId && parsed?.governance?.createdAt ? parsed : null
  } catch {
    return null
  }
}

export function validateStoredWorkflowDraft(
  stored: StoredWorkflowDefinition,
  now = new Date(),
): WorkflowDraftValidationReport {
  const { definition, governance } = stored
  const contractIssues = validateWorkflowDefinition(definition)
  const contractErrors = contractIssues.filter((issue) => issue.severity === 'error')
  const contractWarnings = contractIssues.filter((issue) => issue.severity === 'warning')
  const approvalIsExplicit = definition.implementation.approvalPolicy === 'user_confirmation'
    || definition.implementation.approvalPolicy === 'admin_only'
  const rollbackPresent = governance.rollbackPlan.trim().length > 0
  const isDraft = definition.status === 'draft'
  const isStoredConfiguration = definition.implementation.execution === 'configuration'
  const everyActionIsDescriptive = definition.actions.every((action) => action.type === 'execute')

  const checks: WorkflowDraftValidationCheck[] = [
    {
      id: 'definition_contract',
      label: 'Definition contract',
      status: contractErrors.length > 0 ? 'blocked' : contractWarnings.length > 0 ? 'warning' : 'pass',
      detail: contractErrors.length > 0
        ? contractErrors.map((issue) => issue.message).join(' ')
        : contractWarnings.length > 0
          ? contractWarnings.map((issue) => issue.message).join(' ')
          : 'Required identity, trigger, ownership, and action fields are present.',
    },
    {
      id: 'draft_state',
      label: 'Draft isolation',
      status: isDraft ? 'pass' : 'blocked',
      detail: isDraft
        ? 'This definition is isolated from execution and cannot run by being viewed or validated.'
        : 'Only draft definitions may use this validation path.',
    },
    {
      id: 'approval_boundary',
      label: 'Approval boundary',
      status: approvalIsExplicit ? 'pass' : 'blocked',
      detail: approvalIsExplicit
        ? `Execution would require ${definition.implementation.approvalPolicy.replaceAll('_', ' ')} approval.`
        : 'A human approval boundary is required before publication.',
    },
    {
      id: 'rollback_plan',
      label: 'Rollback plan',
      status: rollbackPresent ? 'pass' : 'blocked',
      detail: rollbackPresent ? governance.rollbackPlan : 'A rollback plan is required before publication.',
    },
    {
      id: 'executor_mapping',
      label: 'Executable action mapping',
      status: 'blocked',
      detail: isStoredConfiguration && everyActionIsDescriptive
        ? 'The actions are descriptive only. Each step must be mapped to a governed executor and rehearsed before publication.'
        : 'This stored definition has no approved executable publication path.',
    },
  ]

  return {
    workflowId: definition.id,
    workflowVersion: definition.version,
    generatedAt: now.toISOString(),
    mode: 'validation_only',
    readyForReview: checks.every((check) => check.id === 'executor_mapping' || check.status !== 'blocked'),
    readyForPublish: false,
    checks,
    plannedEffects: definition.actions.map((action, index) => ({
      order: index + 1,
      label: action.type === 'execute' ? action.label : action.type.replaceAll('_', ' '),
      executor: 'not_wired',
      effect: definition.implementation.mutatesData ? 'potential_crm_write' : 'read_only',
    })),
    boundary: {
      mutatesData: definition.implementation.mutatesData,
      approvalPolicy: definition.implementation.approvalPolicy,
      protectedResources: [...(definition.protectedResources ?? [])],
      execution: definition.implementation.execution,
    },
  }
}

export async function saveWorkflowDraft(db: SupabaseClient, draft: StoredWorkflowDefinition): Promise<void> {
  const { error } = await db.from('system_config').upsert({
    key: `${KEY_PREFIX}${draft.definition.id}`,
    value: JSON.stringify(draft),
    updated_at: draft.governance.updatedAt,
  }, { onConflict: 'key' })
  if (error) throw new Error(`Workflow draft could not be saved: ${error.message}`)
}
