export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveTaskAssignee } from '@/lib/api/task-assignee'
import { DEAD_REASONS, cleanDeadReason } from '@/lib/lead-outcomes'
import { updateManifestAndCascade } from '@/lib/manifest-sync'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { queuePpcQualifiedLeadConversion } from '@/lib/ppc/qualified-lead-conversion'
import { getLeadQualificationStatus, qualificationError } from '@/lib/qualification-policy'
import {
  applyCrmLifecycleCommand,
  CrmLifecycleError,
  isCrmLifecycleStage,
  leadHasGovernedAppointment,
  lifecycleFieldsForStage,
  type CrmLifecycleCommandType,
} from '@/lib/server/crm-lifecycle'

type LifecycleBody = {
  action?: CrmLifecycleCommandType
  stage?: unknown
  owner?: unknown
  deadReason?: unknown
  deadReasonNotes?: unknown
  reason?: unknown
  idempotencyKey?: unknown
  evidence?: { type?: unknown; referenceId?: unknown }
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function statusForError(error: CrmLifecycleError): number {
  if (error.code === 'invalid') return 400
  if (error.code === 'not_found') return 404
  if (error.code === 'conflict') return 409
  return 503
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ success: false, error: 'Contact id is required' }, { status: 400 })

  let body: LifecycleBody
  try {
    body = await req.json() as LifecycleBody
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const action = body.action ?? 'transition'
  if (action !== 'transition' && action !== 'assign') {
    return NextResponse.json({ success: false, error: 'Unsupported lifecycle action' }, { status: 400 })
  }

  const stage = action === 'transition' && isCrmLifecycleStage(body.stage) ? body.stage : null
  if (action === 'transition' && !stage) {
    return NextResponse.json({ success: false, error: 'Choose a valid lifecycle stage' }, { status: 400 })
  }

  let owner = action === 'assign'
    ? body.owner === null ? null : cleanText(body.owner)
    : null
  if (action === 'assign' && body.owner !== null && !owner) {
    return NextResponse.json({ success: false, error: 'Choose an owner or Unassigned' }, { status: 400 })
  }
  if (action === 'assign') {
    const assignment = resolveTaskAssignee(owner, actor.name, { defaultToActor: false, allowUnassigned: true })
    if (!assignment.authorized || assignment.assignedTo === undefined) {
      return NextResponse.json({ success: false, error: 'Owner is not authorized' }, { status: 403 })
    }
    owner = assignment.assignedTo
  }

  const deadReason = stage === 'dead' ? cleanDeadReason(body.deadReason) : null
  const deadReasonNotes = cleanText(body.deadReasonNotes)
  if (stage === 'dead' && !deadReason) {
    return NextResponse.json({
      success: false,
      error: 'Dead reason required before marking this contact not a lead.',
      requiresDeadReason: true,
      allowedDeadReasons: DEAD_REASONS,
    }, { status: 400 })
  }
  if (stage === 'dead' && deadReason === 'other' && !deadReasonNotes) {
    return NextResponse.json({ success: false, error: 'Notes are required when Other is selected.' }, { status: 400 })
  }

  if (stage === 'qualified') {
    const qualification = await getLeadQualificationStatus(id)
    if (!qualification.qualified) {
      return NextResponse.json({
        success: false,
        error: qualificationError(qualification),
        code: 'qualification_incomplete',
        missingPillars: qualification.missing,
      }, { status: 409 })
    }
  }
  if (stage === 'appointment_set' && !(await leadHasGovernedAppointment(id))) {
    return NextResponse.json({
      success: false,
      error: 'Appointment details required before moving this contact to Appointment Set.',
      requiresAppointmentDetails: true,
      nextAction: 'schedule_appointment',
    }, { status: 409 })
  }
  const evidenceType = cleanText(body.evidence?.type)
  const evidenceReference = cleanText(body.evidence?.referenceId)
  if (stage === 'under_contract' && evidenceType !== 'seller_contract_signed') {
    return NextResponse.json({
      success: false,
      error: 'Confirm the fully executed seller purchase agreement before handing this opportunity to Dispositions.',
      code: 'seller_contract_evidence_required',
    }, { status: 409 })
  }

  const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    || cleanText(body.idempotencyKey)
    || crypto.randomUUID()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return NextResponse.json({ success: false, error: 'Idempotency key must be a UUID' }, { status: 400 })
  }

  try {
    const result = await applyCrmLifecycleCommand({
      leadId: id,
      commandId: idempotencyKey,
      commandType: action,
      stage,
      owner,
      deadReason,
      deadReasonNotes,
      reason: cleanText(body.reason),
      evidenceType: evidenceType === 'seller_contract_signed' ? evidenceType : null,
      evidenceReference,
      actorEmail: actor.email,
      actorName: actor.name,
    })

    let compatibilityWarning: string | null = null
    if (action === 'transition' && stage) {
      const fields = lifecycleFieldsForStage(stage)
      const manifestUpdated = await updateManifestAndCascade(id, (manifest) => {
        manifest.currentStation = stage
        manifest.priority = fields.priority
        if (fields.classification === null) {
          ;(manifest as { scoring?: unknown }).scoring = null
        } else if (manifest.scoring) {
          manifest.scoring.classification = fields.classification
          manifest.scoring.worth_enriching = fields.classification !== 'dead'
          manifest.scoring.scored_at = new Date().toISOString()
          manifest.scoring.scored_by = 'notes'
        }
      }, 'crm_lifecycle_command_v1').catch(() => false)
      if (!manifestUpdated) compatibilityWarning = 'Lifecycle saved; legacy manifest refresh is pending.'

      await queuePpcQualifiedLeadConversion({
        leadId: id,
        fromStation: result.fromStage ?? null,
        toStation: stage,
        changedBy: actor.name,
        reason: cleanText(body.reason) ?? 'governed lifecycle command',
      }).catch((error) => console.error('[lifecycle] qualified conversion queue failed:', error))

      if (stage === 'appointment_set') {
        await queuePpcAppointmentBookedConversion({
          leadId: id,
          bookedAt: new Date().toISOString(),
          appointmentType: 'governed_lifecycle_command',
          assignedTo: result.owner ?? actor.name,
          source: 'crm_lifecycle_command_v1',
        }).catch((error) => console.error('[lifecycle] appointment conversion queue failed:', error))
      }
    }

    return NextResponse.json({ success: true, result, compatibilityWarning })
  } catch (error) {
    if (error instanceof CrmLifecycleError) {
      return NextResponse.json({ success: false, error: error.message }, { status: statusForError(error) })
    }
    console.error('[lifecycle] command failed:', error)
    return NextResponse.json({ success: false, error: 'Lifecycle command failed' }, { status: 500 })
  }
}
