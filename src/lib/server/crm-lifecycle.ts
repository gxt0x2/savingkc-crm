import { supabaseAdmin } from '@/lib/supabase/admin'
import type { DealStage } from '@/types/pipeline'

export const CRM_LIFECYCLE_STAGES = [
  'new',
  'contacted',
  'qualified',
  'appointment_set',
  'offer_made',
  'under_contract',
  'closed_won',
  'closed_lost',
  'dead',
] as const satisfies readonly DealStage[]

export type CrmLifecycleStage = (typeof CRM_LIFECYCLE_STAGES)[number]
export type CrmLifecycleCommandType = 'transition' | 'assign'

export type CrmLifecycleResult = {
  eventId: string
  leadId: string
  stage: CrmLifecycleStage
  classification: 'lead' | 'opportunity' | 'dead' | null
  priority: 'hot' | 'warm' | 'cold' | null
  owner: string | null
  deadReason: string | null
  fromStage?: string | null
  fromDepartment?: string
  toDepartment?: string
  handoffCreated?: boolean
  replayed: boolean
}

export class CrmLifecycleError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'not_found' | 'conflict' | 'unavailable',
  ) {
    super(message)
  }
}

export function isCrmLifecycleStage(value: unknown): value is CrmLifecycleStage {
  return typeof value === 'string' && (CRM_LIFECYCLE_STAGES as readonly string[]).includes(value)
}

export function lifecycleFieldsForStage(stage: CrmLifecycleStage): {
  classification: 'lead' | 'opportunity' | 'dead' | null
  priority: 'hot' | 'warm' | 'cold'
} {
  if (stage === 'new') return { classification: null, priority: 'warm' }
  if (stage === 'contacted') return { classification: 'lead', priority: 'warm' }
  if (stage === 'dead') return { classification: 'dead', priority: 'cold' }
  if (stage === 'closed_lost') return { classification: 'opportunity', priority: 'cold' }
  return { classification: 'opportunity', priority: 'hot' }
}

export async function leadHasGovernedAppointment(leadId: string): Promise<boolean> {
  const db = supabaseAdmin()
  const [{ data: appointments }, { data: activities }] = await Promise.all([
    db
      .from('appointments')
      .select('id, scheduled_at, status')
      .eq('lead_id', leadId)
      .not('scheduled_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5),
    db
      .from('lead_activities')
      .select('id, metadata')
      .eq('lead_id', leadId)
      .eq('activity_type', 'appointment')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  if ((appointments ?? []).some((appointment) => {
    const status = typeof appointment.status === 'string' ? appointment.status.toLowerCase() : ''
    const scheduledAt = typeof appointment.scheduled_at === 'string' ? Date.parse(appointment.scheduled_at) : Number.NaN
    return !['cancelled', 'no_show'].includes(status) && Number.isFinite(scheduledAt)
  })) return true

  return (activities ?? []).some((activity) => {
    const metadata = activity.metadata && typeof activity.metadata === 'object' && !Array.isArray(activity.metadata)
      ? activity.metadata as Record<string, unknown>
      : {}
    const scheduledAt = typeof metadata.scheduled_at === 'string'
      ? metadata.scheduled_at
      : typeof metadata.due_date === 'string'
        ? metadata.due_date
        : ''
    return Number.isFinite(Date.parse(scheduledAt))
  })
}

export async function applyCrmLifecycleCommand(input: {
  leadId: string
  commandId: string
  commandType: CrmLifecycleCommandType
  stage: CrmLifecycleStage | null
  owner: string | null
  deadReason: string | null
  deadReasonNotes: string | null
  reason: string | null
  evidenceType: 'seller_contract_signed' | null
  evidenceReference: string | null
  actorEmail: string
  actorName: string
}): Promise<CrmLifecycleResult> {
  const fields = input.stage ? lifecycleFieldsForStage(input.stage) : { classification: null, priority: null }
  const { data, error } = await supabaseAdmin().rpc('crm_apply_lifecycle_command_v1', {
    target_lead_id: input.leadId,
    target_command_id: input.commandId,
    target_command_type: input.commandType,
    target_stage: input.stage,
    target_classification: fields.classification,
    target_priority: fields.priority,
    target_owner: input.owner,
    target_dead_reason: input.deadReason,
    target_dead_reason_notes: input.deadReasonNotes,
    target_reason: input.reason,
    target_evidence_type: input.evidenceType,
    target_evidence_reference: input.evidenceReference,
    target_actor_email: input.actorEmail,
    target_actor_name: input.actorName,
  })

  if (error) {
    const message = error.message ?? 'Lifecycle command failed'
    if (message.includes('lead_not_found')) throw new CrmLifecycleError('Contact not found', 'not_found')
    if (message.includes('stage_required') || message.includes('unsupported_command') || message.includes('actor_required')) {
      throw new CrmLifecycleError('Lifecycle command is invalid', 'invalid')
    }
    if (error.code === '23505') throw new CrmLifecycleError('Lifecycle command conflicted with another update', 'conflict')
    throw new CrmLifecycleError('Lifecycle service is unavailable', 'unavailable')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new CrmLifecycleError('Lifecycle service returned an invalid result', 'unavailable')
  }
  return data as CrmLifecycleResult
}
