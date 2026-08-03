import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkflowCategory, WorkflowDefinition } from './types'
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

export async function saveWorkflowDraft(db: SupabaseClient, draft: StoredWorkflowDefinition): Promise<void> {
  const { error } = await db.from('system_config').upsert({
    key: `${KEY_PREFIX}${draft.definition.id}`,
    value: JSON.stringify(draft),
    updated_at: draft.governance.updatedAt,
  }, { onConflict: 'key' })
  if (error) throw new Error(`Workflow draft could not be saved: ${error.message}`)
}
