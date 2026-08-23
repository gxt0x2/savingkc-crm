import { randomUUID } from 'node:crypto'

import { upsertAppointmentFromCall } from '@/lib/appointments'
import { EAGER_REGEN_EVENTS, regenerateBriefing } from '@/lib/briefing-regen'
import { normalizeDisposition, type DispositionId } from '@/lib/dialer-dispositions'
import { ensureManifestExists, updateManifestAndCascade } from '@/lib/manifest-sync'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { supabase } from '@/lib/supabase-lazy'

export interface LeadDispositionCommand {
  disposition: DispositionId
  notes: string | null
  phone: string | null
  appointmentAt: string | null
}

export type LeadDispositionCommandResult =
  | { ok: true; command: LeadDispositionCommand }
  | { ok: false; error: string; code?: string }

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return cleaned ? cleaned.slice(0, maxLength) : null
}

export function buildLeadDispositionCommand(input: unknown, now = Date.now()): LeadDispositionCommandResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Disposition command required' }
  }
  const body = input as Record<string, unknown>
  const disposition = normalizeDisposition(typeof body.disposition === 'string' ? body.disposition : null)
  if (!disposition) return { ok: false, error: 'Choose a valid call outcome' }

  const appointmentAtText = cleanText(body.appointmentAt, 100)
  let appointmentAt: string | null = null
  if (disposition === 'appointment_set') {
    const appointmentMs = appointmentAtText ? new Date(appointmentAtText).getTime() : Number.NaN
    const latestAllowed = now + (2 * 365 * 24 * 60 * 60 * 1000)
    if (!Number.isFinite(appointmentMs) || appointmentMs <= now || appointmentMs > latestAllowed) {
      return {
        ok: false,
        error: 'Choose the real appointment date and time before saving Appointment Set.',
        code: 'appointment_details_required',
      }
    }
    appointmentAt = new Date(appointmentMs).toISOString()
  }

  return {
    ok: true,
    command: {
      disposition,
      notes: cleanText(body.notes, 5_000),
      phone: cleanText(body.phone, 100),
      appointmentAt,
    },
  }
}

export interface RecordedLeadDisposition {
  activityId: string | null
  appointmentId: string | null
  projectionSynced: boolean
}

export async function recordLeadDisposition(
  leadId: string,
  actorName: string,
  command: LeadDispositionCommand,
): Promise<RecordedLeadDisposition> {
  const { disposition, notes, phone, appointmentAt } = command
  const actorId = actorName.toLowerCase().includes('ernest') ? 'ernest' : 'casey'
  let appointmentId: string | null = null
  let appointmentActivityId: string | null = null

  if (disposition === 'appointment_set' && appointmentAt) {
    const appointment = await upsertAppointmentFromCall({
      leadId,
      scheduledAt: appointmentAt,
      type: 'phone_call',
      notes,
      source: 'crm_call',
      assignedTo: actorName,
    })
    if (!appointment) throw new Error('Appointment could not be saved')
    appointmentId = appointment.id

    const { data: appointmentActivity, error: appointmentActivityError } = await supabase
      .from('lead_activities')
      .insert({
        lead_id: leadId,
        activity_type: 'appointment',
        description: `Appointment scheduled from call for ${appointment.scheduled_at}${notes ? ` - ${notes}` : ''}`,
        agent: actorName,
        metadata: {
          appointment_id: appointment.id,
          type: appointment.type,
          scheduled_at: appointment.scheduled_at,
          due_date: appointment.scheduled_at,
          assigned_to: actorName,
          notes,
          status: 'scheduled',
          source: 'call_disposition',
        },
      })
      .select('id')
      .maybeSingle()
    if (appointmentActivityError) throw new Error('Appointment activity could not be saved')
    appointmentActivityId = appointmentActivity?.id ?? null
  }

  const { data: activity, error: activityError } = await supabase
    .from('lead_activities')
    .insert({
      lead_id: leadId,
      activity_type: 'call',
      description: `Call: ${disposition.replace(/_/g, ' ')}${notes ? ` - ${notes}` : ''}`,
      agent: actorName,
      metadata: {
        direction: 'outbound',
        disposition,
        phone,
        notes,
        source: 'telephony_bar',
        appointment_id: appointmentId,
        scheduled_at: appointmentAt,
      },
    })
    .select('id')
    .maybeSingle()
  if (activityError) throw new Error('Call outcome could not be saved')

  const leadPatch: Record<string, unknown> = {
    call_result: disposition,
    updated_at: new Date().toISOString(),
  }
  if (appointmentAt) {
    leadPatch.appointment_date = appointmentAt
    leadPatch.appointment_notes = notes
  }
  const { error: leadError } = await supabase.from('leads').update(leadPatch).eq('id', leadId)
  if (leadError) throw new Error('Contact outcome snapshot could not be saved')

  let projectionSynced = false
  try {
    await ensureManifestExists(leadId)
    projectionSynced = await updateManifestAndCascade(leadId, (manifest) => {
    if (notes) {
      manifest.agentNotes = manifest.agentNotes ?? []
      manifest.agentNotes.push({
        timestamp: new Date().toISOString(),
        author: actorName,
        source: 'disposition',
        content: notes,
        callRecordId: phone || undefined,
      })
    }
    manifest.communications = manifest.communications ?? { transcripts: [] }
    manifest.communications.lastDisposition = disposition
    manifest.communications.lastDispositionDate = new Date().toISOString()

    if (disposition === 'appointment_set' && appointmentAt) {
      manifest.pipeline.appointment = {
        appointmentId: appointmentId || randomUUID(),
        type: 'phone_call',
        scheduledAt: appointmentAt,
        createdAt: new Date().toISOString(),
        status: 'scheduled',
        confirmationCount: 0,
        lastSellerResponse: null,
        ghostRiskScore: 0,
        ghostProtocolActive: false,
        reminderAutomationEnabled: true,
        reminderAutomationEnabledAt: new Date().toISOString(),
        reminderAutomationSource: 'call_disposition',
        automationLog: [],
        assignedTo: actorId,
        address: null,
        notes,
      }
    } else if (disposition === 'callback_requested') {
      manifest.ariIntelligence = manifest.ariIntelligence ?? {}
      manifest.ariIntelligence.recommendedActions = manifest.ariIntelligence.recommendedActions ?? []
      manifest.ariIntelligence.recommendedActions.push({
        action: `Callback requested${notes ? `: ${notes}` : ''}`,
        reason: 'seller_requested',
      })
    } else if (disposition === 'deal_potential' || disposition === 'offer_made') {
      manifest.priority = 'hot'
    } else if (disposition === 'dnc' || disposition === 'wrong_number' || disposition === 'disconnected') {
      manifest.flags = manifest.flags ?? {}
      manifest.flags.redFlags = manifest.flags.redFlags ?? []
      const flag = disposition === 'dnc' ? 'do_not_contact' : 'bad_phone'
      if (!manifest.flags.redFlags.includes(flag)) manifest.flags.redFlags.push(flag)
    }

    manifest.ariIntelligence = manifest.ariIntelligence ?? {}
    manifest.ariIntelligence.briefingStale = true
    manifest.auditTrail = manifest.auditTrail ?? []
    manifest.auditTrail.push({
      timestamp: new Date().toISOString(),
      agent: actorName,
      action: 'call_disposition',
      details: { disposition, phone, activityId: activity?.id ?? null, appointmentId },
    })
    }, `disposition:${disposition}`)
  } catch (error) {
    console.error('[lead disposition] compatibility projection failed:', error)
  }

  if (disposition === 'appointment_set' && appointmentAt) {
    await checkAutoAdvance(leadId, 'appointment_set').catch((error) => {
      console.error('[lead disposition] appointment lifecycle advance failed:', error)
    })
    await queuePpcAppointmentBookedConversion({
      leadId,
      appointmentId,
      activityId: appointmentActivityId,
      scheduledAt: appointmentAt,
      appointmentType: 'phone_call',
      assignedTo: actorName,
      source: 'call_disposition',
    }).catch((error) => console.error('[lead disposition] appointment conversion queue failed:', error))
  }
  if (EAGER_REGEN_EVENTS.has(disposition)) regenerateBriefing(leadId, disposition).catch(() => {})

  return { activityId: activity?.id ?? null, appointmentId, projectionSynced }
}
