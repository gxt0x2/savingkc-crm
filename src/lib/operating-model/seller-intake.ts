import { createHash } from 'node:crypto'
import type { ConversationAttentionState, RecordOwner } from './types'

export const SELLER_INTAKE_WORKFLOW_ID = 'seller-form-intake'
export const SELLER_INTAKE_WORKFLOW_VERSION = 2

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
  workflowTriggerKey: string
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

function workflowTriggerKey(input: SellerIntakeInput, keys: string[]): string {
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
    workflowTriggerKey: workflowTriggerKey(input, keys),
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
): Promise<{
  created: boolean
  queued: boolean
  workflowRunId: string
  plan: SellerIntakePlan
}> {
  const plan = buildSellerIntakePlan(input)
  const workflow = await import('@/lib/server/workflow-runs')
  const definition = workflow.findActiveWorkflowDefinition(plan.workflowId)
  if (!definition || definition.version !== plan.workflowVersion) {
    throw new Error('Seller intake workflow definition is unavailable.')
  }

  const run = await workflow.startWorkflowRun({
    definition,
    actor: 'SavingKC Operations',
    idempotencyKey: plan.workflowTriggerKey,
    verifiedServerEvent: 'seller_intake',
    triggerKind: 'lead_form_submitted',
    triggerKey: plan.workflowTriggerKey,
    payload: {
      leadId: plan.leadId,
      formSource: input.formSource,
      workflowTriggerKey: plan.workflowTriggerKey,
      identityKeys: plan.identityKeys,
      dueAt: plan.nextAction.dueAt,
      acknowledgementAllowed: plan.acknowledgement.allowed,
      acknowledgementReason: plan.acknowledgement.reason,
    },
  })

  const finished = run.status === 'queued' || run.status === 'retry_scheduled'
    ? await workflow.executeWorkflowRun(run.id)
    : run
  const current = finished ?? run
  if (current.status === 'failed' || current.status === 'rejected' || current.status === 'cancelled') {
    throw new Error(`Seller intake workflow ended in ${current.status}.`)
  }

  return {
    created: current.status === 'succeeded' && current.output?.created === true,
    queued: current.status !== 'succeeded',
    workflowRunId: current.id,
    plan,
  }
}
