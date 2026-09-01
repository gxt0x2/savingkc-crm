import { resolveTaskAssignee } from '@/lib/api/task-assignee'
import type { AssistantActor } from '@/lib/assistant/auth'
import { ASSISTANT_WRITE_SCOPE } from '@/lib/assistant/andon-write'
import { crmLeadUrl } from '@/lib/assistant/read-model'
import { upsertAppointmentFromCall } from '@/lib/appointments'
import { cleanDeadReason } from '@/lib/lead-outcomes'
import { getLeadQualificationStatus, qualificationError } from '@/lib/qualification-policy'
import { buildAppointmentCommand } from '@/lib/server/appointment-command'
import {
  applyCrmLifecycleCommand,
  CrmLifecycleError,
  isCrmLifecycleStage,
  leadHasGovernedAppointment,
  type CrmLifecycleStage,
} from '@/lib/server/crm-lifecycle'
import { buildLeadActivityInsert } from '@/lib/server/lead-activity-command'
import { createWorkItem, normalizeWorkItemKind, WorkItemError } from '@/lib/server/work-items'

type JsonRecord = Record<string, unknown>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any }

export const FORBIDDEN_MONEY_ACTIONS = [
  'update_assignment_fee',
  'write_assignment_fee',
  'post_ledger',
  'post_deal_ledger',
  'write_financial_summary',
  'write_revenue',
  'write_commission',
  'can_we_fund',
  'write_receipt',
  'write_visa',
  'write_bank_line',
  'write_treasury',
] as const

export const ASSISTANT_OPS_STAGES = [
  'new',
  'contacted',
  'qualified',
  'appointment_set',
  'offer_made',
  'dead',
] as const satisfies readonly CrmLifecycleStage[]

export const ASSISTANT_DEAL_STAGES = ['marketing', 'offer', 'under_contract', 'closing', 'dead'] as const
export const CLOSED_CASH_STAGES = ['closed_won', 'closed_lost', 'closed'] as const

export class AssistantWriteError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409) {
    super(message)
  }
}

export function isForbiddenMoneyAction(action: unknown): boolean {
  return typeof action === 'string' && (FORBIDDEN_MONEY_ACTIONS as readonly string[]).includes(action)
}

function throwQuery(error: { message?: string } | null, fallback: string) {
  if (!error) return
  throw new Error(error.message || fallback)
}

async function readLead(db: Db, leadId: string) {
  const { data, error } = await db
    .from('leads')
    .select('id, full_name, station, assigned_agent, notes, property_address')
    .eq('id', leadId)
    .maybeSingle()
  throwQuery(error, 'Lead lookup failed')
  if (!data) throw new AssistantWriteError('Contact not found', 404)
  return data as JsonRecord
}

export async function addLeadNote(db: Db, actor: AssistantActor, leadId: string, note: string) {
  await readLead(db, leadId)
  const command = buildLeadActivityInsert(leadId, actor.fullName, { kind: 'note', description: note })
  if (!command.ok) throw new AssistantWriteError(command.error, 400)
  const { data, error } = await db
    .from('lead_activities')
    .insert({ ...command.insert, metadata: { ...command.insert.metadata, source: 'assistant_write' } })
    .select('id, activity_type, description, agent, created_at')
    .single()
  throwQuery(error, 'Lead note write failed')
  return { action: 'add_lead_note' as const, writeScope: ASSISTANT_WRITE_SCOPE, leadId, note: data, crmUrl: crmLeadUrl(leadId) }
}

export async function setLeadOwner(actor: AssistantActor, leadId: string, owner: string | null, commandId: string) {
  const assignment = resolveTaskAssignee(owner, actor.fullName, { defaultToActor: false, allowUnassigned: true })
  if (!assignment.authorized || assignment.assignedTo === undefined) {
    throw new AssistantWriteError('Owner is not authorized', 403)
  }
  try {
    const result = await applyCrmLifecycleCommand({
      leadId,
      commandId,
      commandType: 'assign',
      stage: null,
      owner: assignment.assignedTo,
      deadReason: null,
      deadReasonNotes: null,
      reason: 'assistant_write',
      evidenceType: null,
      evidenceReference: null,
      actorEmail: actor.email,
      actorName: actor.fullName,
    })
    return { action: 'set_lead_owner' as const, writeScope: ASSISTANT_WRITE_SCOPE, result, crmUrl: crmLeadUrl(leadId) }
  } catch (error) {
    if (error instanceof CrmLifecycleError) {
      throw new AssistantWriteError(error.message, error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400)
    }
    throw error
  }
}

export async function updateLeadStage(actor: AssistantActor, leadId: string, stage: string, input: {
  commandId: string
  deadReason?: string | null
  deadReasonNotes?: string | null
}) {
  if ((CLOSED_CASH_STAGES as readonly string[]).includes(stage) || stage === 'under_contract') {
    throw new AssistantWriteError(
      stage === 'under_contract'
        ? 'Under contract stays on the governed seller-contract workflow. Assistant write cannot invent contract evidence.'
        : 'Closed-cash stages stay on funded closeout. Assistant write cannot mark Closed Won or Closed Lost.',
      409,
    )
  }
  if (!isCrmLifecycleStage(stage) || !(ASSISTANT_OPS_STAGES as readonly string[]).includes(stage)) {
    throw new AssistantWriteError('Choose a non-cash operational stage', 400)
  }
  if (stage === 'qualified') {
    const qualification = await getLeadQualificationStatus(leadId)
    if (!qualification.qualified) throw new AssistantWriteError(qualificationError(qualification), 409)
  }
  if (stage === 'appointment_set' && !(await leadHasGovernedAppointment(leadId))) {
    throw new AssistantWriteError('Appointment details required before Appointment Set', 409)
  }
  const deadReason = stage === 'dead' ? cleanDeadReason(input.deadReason) : null
  if (stage === 'dead' && !deadReason) throw new AssistantWriteError('Dead reason required', 400)
  try {
    const result = await applyCrmLifecycleCommand({
      leadId,
      commandId: input.commandId,
      commandType: 'transition',
      stage,
      owner: null,
      deadReason,
      deadReasonNotes: input.deadReasonNotes?.trim() || null,
      reason: 'assistant_write',
      evidenceType: null,
      evidenceReference: null,
      actorEmail: actor.email,
      actorName: actor.fullName,
    })
    return { action: 'update_lead_stage' as const, writeScope: ASSISTANT_WRITE_SCOPE, result, crmUrl: crmLeadUrl(leadId) }
  } catch (error) {
    if (error instanceof CrmLifecycleError) {
      throw new AssistantWriteError(error.message, error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400)
    }
    throw error
  }
}

export async function createLeadTask(actor: AssistantActor, input: {
  leadId: string
  title: string
  notes?: string | null
  dueAt?: string | null
  assignedTo?: string | null
  kind?: string
  primaryNextAction?: boolean
  commandId: string
}) {
  const assignment = resolveTaskAssignee(input.assignedTo, actor.fullName, { defaultToActor: true })
  if (!assignment.authorized || assignment.assignedTo === undefined) {
    throw new AssistantWriteError('Task assignee is not authorized', 403)
  }
  try {
    const created = await createWorkItem({
      actor: actor.fullName,
      idempotencyKey: input.commandId,
      leadId: input.leadId,
      kind: normalizeWorkItemKind(input.kind),
      title: input.title.trim().slice(0, 200),
      notes: input.notes?.trim().slice(0, 4000) || null,
      dueAt: input.dueAt || null,
      assignedTo: assignment.assignedTo,
      department: 'Acquisitions',
      primaryNextAction: input.primaryNextAction === true,
      provenance: { source: 'assistant_write', writeScope: ASSISTANT_WRITE_SCOPE },
    })
    return {
      action: input.primaryNextAction ? 'set_lead_next_action' as const : 'create_lead_task' as const,
      writeScope: ASSISTANT_WRITE_SCOPE,
      workItem: created.workItem,
      crmUrl: crmLeadUrl(input.leadId),
    }
  } catch (error) {
    if (error instanceof WorkItemError) {
      throw new AssistantWriteError(error.message, /exists|not_active|not_found/i.test(error.message) ? 409 : 400)
    }
    throw error
  }
}

export async function createLeadAppointment(actor: AssistantActor, input: {
  leadId: string
  scheduledAt: string
  type?: string
  assignedTo?: string | null
  notes?: string | null
}) {
  const parsed = buildAppointmentCommand({
    leadId: input.leadId,
    scheduledAt: input.scheduledAt,
    type: input.type,
    assignedTo: input.assignedTo,
    notes: input.notes,
    sendReminder: false,
  }, actor.fullName)
  if (!parsed.ok) throw new AssistantWriteError(parsed.error, parsed.status)
  const appointment = await upsertAppointmentFromCall({
    leadId: parsed.command.leadId,
    scheduledAt: parsed.command.scheduledAt,
    type: parsed.command.type,
    notes: parsed.command.notes,
    source: 'manual',
    assignedTo: parsed.command.assignedTo,
  })
  if (!appointment) throw new AssistantWriteError('Appointment could not be saved', 400)
  return {
    action: 'create_lead_appointment' as const,
    writeScope: ASSISTANT_WRITE_SCOPE,
    appointment: {
      id: appointment.id,
      leadId: appointment.lead_id,
      scheduledAt: appointment.scheduled_at,
      type: appointment.type,
      assignedTo: appointment.assigned_to,
    },
    crmUrl: crmLeadUrl(parsed.command.leadId),
  }
}

export async function updateDealFileOps(db: Db, input: {
  fileId: string
  nextAction?: string | null
  notes?: string | null
  stage?: string | null
}) {
  const { data: file, error } = await db
    .from('tc_files')
    .select('id, lead_id, next_action, notes, dispo_deal_id')
    .eq('id', input.fileId)
    .maybeSingle()
  throwQuery(error, 'Deal file lookup failed')
  if (!file) throw new AssistantWriteError('Deal file not found', 404)
  if (input.nextAction === undefined && input.notes === undefined && input.stage === undefined) {
    throw new AssistantWriteError('Deal file next action, notes, or stage is required', 400)
  }

  const filePatch: JsonRecord = {}
  if (input.nextAction !== undefined) filePatch.next_action = input.nextAction?.trim().slice(0, 500) || null
  if (input.notes !== undefined) filePatch.notes = input.notes?.trim().slice(0, 4000) || null
  if (Object.keys(filePatch).length > 0) {
    const { error: updateError } = await db.from('tc_files').update(filePatch).eq('id', input.fileId)
    throwQuery(updateError, 'Deal file update failed')
  }

  if (input.stage !== undefined && input.stage !== null) {
    if ((CLOSED_CASH_STAGES as readonly string[]).includes(input.stage)) {
      throw new AssistantWriteError('Closed-cash deal stages stay on funded closeout', 409)
    }
    if (!(ASSISTANT_DEAL_STAGES as readonly string[]).includes(input.stage)) {
      throw new AssistantWriteError('Choose a non-cash deal stage', 400)
    }
    if (file.dispo_deal_id) {
      const { error: dealError } = await db.from('dispo_deals').update({ stage: input.stage }).eq('id', file.dispo_deal_id)
      throwQuery(dealError, 'Deal stage update failed')
    }
  }

  return {
    action: 'update_deal_file' as const,
    writeScope: ASSISTANT_WRITE_SCOPE,
    fileId: input.fileId,
    leadId: file.lead_id,
    nextAction: input.nextAction === undefined ? file.next_action : filePatch.next_action ?? null,
    notes: input.notes === undefined ? file.notes : filePatch.notes ?? null,
    stage: input.stage ?? null,
  }
}
