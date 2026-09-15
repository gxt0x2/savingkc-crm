import type { SupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { externalSideEffectsDisabled } from '@/lib/preview-safety'
import { sendLeadSms } from '@/lib/send-lead-sms'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'
import { appointmentCopy, type AppointmentTouch } from './appointment-sequence-templates'

type Step = { id: string; appointment_id: string; version: number; touch: AppointmentTouch; due_at: string }

/** Drained by the existing workflow worker. Each claim permits only one provider attempt. */
export async function processAppointmentSequence(limit = 10, db: SupabaseClient = supabaseAdmin()) {
  if (externalSideEffectsDisabled()) return { processed: 0, disabled: true }
  let processed = 0
  const startedAt = Date.now()
  for (; processed < limit && Date.now() - startedAt < 15_000; processed++) {
    const { data, error } = await db.rpc('claim_appointment_sequence_step_v1')
    if (error) throw new Error(`Appointment workflow unavailable: ${error.message}`)
    const step = (Array.isArray(data) ? data[0] : data) as Step | undefined
    if (!step) break
    let status = 'failed', reason: string | null = null, providerId: string | null = null
    try {
      const { data: a, error: loadError } = await db.from('appointments').select('*').eq('id', step.appointment_id).single()
      if (loadError) throw loadError
      if (!a.sequence_enabled || a.sequence_version !== step.version || !['scheduled', 'confirmed'].includes(a.status) || a.reschedule_requested_at || new Date(a.scheduled_at).getTime() <= Date.now()) {
        status = 'skipped'; reason = 'appointment_changed'
      } else if (step.touch === 'silence' || step.touch === 'escalate') {
        const result = await db.rpc('appointment_sequence_escalate_v1', { p_step_id: step.id })
        if (result.error) throw result.error
        status = 'sent'; reason = typeof result.data === 'string' ? result.data : 'task_reviewed'
      } else if (step.touch === 'confirm_sms' && a.confirmation_status === 'confirmed') {
        status = 'skipped'; reason = 'already_confirmed'
      } else if (step.touch === 'arrival_sms' && !['in_person', 'onsite'].includes(a.type)) {
        status = 'skipped'; reason = 'not_in_person'
      } else if (['confirm_sms', 'morning_sms', 'arrival_sms'].includes(step.touch) && Date.now() - new Date(step.due_at).getTime() > 15 * 60_000) {
        status = 'skipped'; reason = 'reminder_window_missed'
      } else {
        const { data: lead, error: leadError } = await db.from('leads').select('full_name,phone,email').eq('id', a.lead_id).single()
        if (leadError) throw leadError
        if (!a.assigned_to) throw new Error('Appointment needs an assigned rep')
        const rep = resolveAgentTelephonyProfile(a.assigned_to)
        const { data: profile } = await db.from('agent_profiles').select('profile_photo_url').ilike('email', `${rep.identity}@savingkc.com`).maybeSingle()
        const copy = appointmentCopy({ touch: step.touch, firstName: lead.full_name || 'there', repName: rep.displayName, repPhone: rep.defaultCallerId, scheduledAt: a.scheduled_at, bookedAt: a.sequence_booked_at, type: a.type, photoUrl: profile?.profile_photo_url })
        if (step.touch === 'booking_email') {
          if (!lead.email) { status = 'skipped'; reason = 'missing_email' }
          else {
            if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) throw new Error('Transactional appointment email sender is not configured')
            // Network ambiguity must not cause a second submission on another worker tick.
            status = 'uncertain'
            const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
              from: `Saving KC <${process.env.RESEND_FROM_EMAIL}>`, to: [lead.email], subject: copy.subject, text: copy.body, html: copy.html,
            }, { idempotencyKey: `appointment:${step.id}` })
            if (result.error || !result.data?.id) { status = 'failed'; reason = result.error?.message || 'Provider did not accept email' }
            else { status = 'sent'; providerId = result.data.id }
          }
        } else if (!lead.phone) { status = 'skipped'; reason = 'missing_phone' }
        else {
          status = 'uncertain'
          const result = await sendLeadSms({ leadId: a.lead_id, phone: lead.phone, fromPhone: rep.defaultCallerId, body: copy.body, agent: a.assigned_to, source: 'appointment-ghost-protocol', metadata: { appointment_id: a.id, step_id: step.id, touch: step.touch, sequence_version: step.version } })
          if (result.status === 'sent') { status = 'sent'; providerId = result.sid || null }
          else if (result.status === 'skipped') { status = 'skipped'; reason = result.reason }
          else { status = result.deliveryState === 'delivery_unknown' ? 'uncertain' : 'failed'; reason = result.error }
        }
        if (status === 'sent' && step.touch === 'booking_email') {
          const audit = await db.from('lead_activities').insert({ lead_id: a.lead_id, activity_type: 'email', description: copy.body, agent: a.assigned_to, metadata: { direction: 'outbound', appointment_id: a.id, step_id: step.id, subject: copy.subject, provider_id: providerId, status: 'provider_accepted', source: 'appointment-ghost-protocol' } })
          if (audit.error) reason = 'provider_accepted_timeline_pending'
        }
      }
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
    }
    const saved = await db.from('appointment_sequence_steps').update({ status, reason, provider_id: providerId, finished_at: new Date().toISOString() }).eq('id', step.id).eq('status', 'dispatching')
    if (saved.error) throw new Error(`Appointment delivery receipt could not be saved: ${saved.error.message}`)
  }
  return { processed }
}
