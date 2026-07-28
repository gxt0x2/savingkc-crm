import { createHash } from 'node:crypto'
import { supabase } from '@/lib/supabase-lazy'
import type { ConversationAttentionState, RecordOwner } from './types'

export const SELLER_INTAKE_WORKFLOW_ID = 'seller-form-intake'
export const SELLER_INTAKE_WORKFLOW_VERSION = 1

const ACQUISITIONS_OWNER: RecordOwner = {
  kind: 'team',
  id: 'acquisitions',
  displayName: 'Acquisitions',
}

export interface SellerIntakeInput {
  leadId: string
  formSource: string
  submissionKey?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  smsConsent: boolean
  submittedAt?: Date
}

export interface SellerIntakePlan {
  workflowId: typeof SELLER_INTAKE_WORKFLOW_ID
  workflowVersion: typeof SELLER_INTAKE_WORKFLOW_VERSION
  workflowRunId: string
  leadId: string
  identityKeys: string[]
  owner: RecordOwner
  opportunityStage: 'new'
  conversationAttention: ConversationAttentionState
  acknowledgement: {
    channel: 'sms'
    allowed: boolean
    reason: 'consent_granted' | 'consent_missing' | 'phone_missing'
    handledByExistingRoute: true
  }
  nextAction: {
    type: 'call'
    title: 'Make first contact'
    dueAt: string
    owner: RecordOwner
    primary: true
  }
}

function clean(value: string | null | undefined): string | null {
  const result = value?.trim()
  return result ? result : null
}

function normalizeEmail(value: string | null | undefined): string | null {
  return clean(value)?.toLowerCase() ?? null
}

function normalizeAddress(value: string | null | undefined): string | null {
  return clean(value)?.toLowerCase().replace(/\s+/g, ' ') ?? null
}

function identityKeys(input: SellerIntakeInput): string[] {
  return [
    clean(input.phone) ? `phone:${clean(input.phone)}` : null,
    normalizeEmail(input.email) ? `email:${normalizeEmail(input.email)}` : null,
    normalizeAddress(input.address) ? `address:${normalizeAddress(input.address)}` : null,
  ].filter((value): value is string => Boolean(value))
}

function workflowRunId(input: SellerIntakeInput, keys: string[]): string {
  const stableSubmissionKey = clean(input.submissionKey) || keys.join('|') || input.leadId
  const digest = createHash('sha256')
    .update(`${SELLER_INTAKE_WORKFLOW_ID}|${input.formSource}|${input.leadId}|${stableSubmissionKey}`)
    .digest('hex')
    .slice(0, 24)

  return `${SELLER_INTAKE_WORKFLOW_ID}:${digest}`
}

export function buildSellerIntakePlan(input: SellerIntakeInput): SellerIntakePlan {
  const submittedAt = input.submittedAt ?? new Date()
  const keys = identityKeys(input)
  const hasPhone = Boolean(clean(input.phone))

  return {
    workflowId: SELLER_INTAKE_WORKFLOW_ID,
    workflowVersion: SELLER_INTAKE_WORKFLOW_VERSION,
    workflowRunId: workflowRunId(input, keys),
    leadId: input.leadId,
    identityKeys: keys,
    owner: ACQUISITIONS_OWNER,
    opportunityStage: 'new',
    conversationAttention: 'needs_reply',
    acknowledgement: {
      channel: 'sms',
      allowed: hasPhone && input.smsConsent,
      reason: !hasPhone ? 'phone_missing' : input.smsConsent ? 'consent_granted' : 'consent_missing',
      handledByExistingRoute: true,
    },
    nextAction: {
      type: 'call',
      title: 'Make first contact',
      dueAt: new Date(submittedAt.getTime() + 5 * 60 * 1000).toISOString(),
      owner: ACQUISITIONS_OWNER,
      primary: true,
    },
  }
}

export async function recordSellerIntakeOperatingState(
  input: SellerIntakeInput,
): Promise<{ created: boolean; plan: SellerIntakePlan }> {
  const plan = buildSellerIntakePlan(input)

  const { data: existing, error: lookupError } = await supabase
    .from('lead_activities')
    .select('id')
    .eq('lead_id', plan.leadId)
    .eq('activity_type', 'status_change')
    .contains('metadata', { workflow_run_id: plan.workflowRunId })
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Seller intake workflow lookup failed: ${lookupError.message}`)
  }
  if (existing?.id) return { created: false, plan }

  const commonMetadata = {
    source: 'operating_model',
    workflow_id: plan.workflowId,
    workflow_version: plan.workflowVersion,
    workflow_run_id: plan.workflowRunId,
    form_source: input.formSource,
  }

  const { error: insertError } = await supabase.from('lead_activities').insert([
    {
      lead_id: plan.leadId,
      activity_type: 'status_change',
      description: 'Seller intake workflow established ownership and conversation state.',
      agent: 'System',
      metadata: {
        ...commonMetadata,
        record_kind: 'opportunity',
        opportunity_stage: plan.opportunityStage,
        owner_kind: plan.owner.kind,
        owner_id: plan.owner.id,
        owner_name: plan.owner.displayName,
        identity_keys: plan.identityKeys,
        conversation_attention: plan.conversationAttention,
        acknowledgement_channel: plan.acknowledgement.channel,
        acknowledgement_allowed: plan.acknowledgement.allowed,
        acknowledgement_reason: plan.acknowledgement.reason,
        acknowledgement_handler: 'existing_form_route',
      },
    },
    {
      lead_id: plan.leadId,
      activity_type: 'task',
      description: plan.nextAction.title,
      agent: plan.nextAction.owner.displayName,
      metadata: {
        ...commonMetadata,
        record_kind: 'task',
        task_type: plan.nextAction.type,
        due_date: plan.nextAction.dueAt,
        assigned_to: plan.nextAction.owner.displayName,
        owner_kind: plan.nextAction.owner.kind,
        owner_id: plan.nextAction.owner.id,
        status: 'pending',
        priority: 'urgent',
        primary_next_action: true,
      },
    },
  ])

  if (insertError) {
    throw new Error(`Seller intake workflow insert failed: ${insertError.message}`)
  }

  return { created: true, plan }
}
