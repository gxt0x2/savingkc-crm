import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type FollowUpChannel = 'call' | 'sms' | 'email' | 'voicemail' | 'mail'
export type FollowUpTrigger = 'stage_change' | 'disposition' | 'manual'

export interface FollowUpStep {
  step_number: number
  channel: FollowUpChannel
  delay_days: number
  delay_hours: number
  template_content?: string
  template_name?: string
}

export interface FollowUpSequence {
  id: string
  name: string
  stage?: string // Which pipeline stage this applies to
  disposition?: string // Or which disposition triggers it
  steps: FollowUpStep[]
  created_at: string
}

/**
 * FUP-02: Default Follow-Up Sequences
 * Seeded sequences for each stage and disposition
 */
export const DEFAULT_SEQUENCES: Omit<FollowUpSequence, 'id' | 'created_at'>[] = [
  {
    name: 'New Lead Sequence',
    stage: 'not_contacted',
    steps: [
      { step_number: 1, channel: 'call', delay_days: 0, delay_hours: 0 },
      { step_number: 2, channel: 'sms', delay_days: 0, delay_hours: 2, template_name: 'intro' },
      { step_number: 3, channel: 'email', delay_days: 2, delay_hours: 0 },
      { step_number: 4, channel: 'call', delay_days: 3, delay_hours: 0 },
      { step_number: 5, channel: 'mail', delay_days: 5, delay_hours: 0 },
      { step_number: 6, channel: 'call', delay_days: 7, delay_hours: 0 },
    ],
  },
  {
    name: 'Offer Made Sequence',
    stage: 'negotiations',
    steps: [
      { step_number: 1, channel: 'call', delay_days: 1, delay_hours: 0 },
      { step_number: 2, channel: 'sms', delay_days: 2, delay_hours: 0 },
      { step_number: 3, channel: 'email', delay_days: 3, delay_hours: 0 },
      { step_number: 4, channel: 'call', delay_days: 5, delay_hours: 0 },
      { step_number: 5, channel: 'mail', delay_days: 5, delay_hours: 0 },
    ],
  },
  {
    name: 'Post-Disposition: No Answer',
    disposition: 'no_answer',
    steps: [
      { step_number: 1, channel: 'call', delay_days: 1, delay_hours: 0 },
      { step_number: 2, channel: 'sms', delay_days: 1, delay_hours: 0, template_name: 'follow_up_general' },
    ],
  },
  {
    name: 'Post-Disposition: Left Voicemail',
    disposition: 'left_voicemail',
    steps: [
      { step_number: 1, channel: 'call', delay_days: 2, delay_hours: 0 },
    ],
  },
  {
    name: 'Post-Disposition: Not Interested',
    disposition: 'not_interested',
    steps: [
      { step_number: 1, channel: 'sms', delay_days: 90, delay_hours: 0, template_content: '90-day nurture check-in', template_name: 'nurture_90d' },
    ],
  },
  {
    name: 'Appointment Set: Phone',
    disposition: 'appointment_set_phone',
    steps: [
      { step_number: 1, channel: 'sms', delay_days: 0, delay_hours: 0, template_name: 'appt_confirm_phone' },
      { step_number: 2, channel: 'sms', delay_days: 0, delay_hours: 0, template_name: 'appt_value_add_phone' }, // T-24h (handled by reminder worker)
      { step_number: 3, channel: 'sms', delay_days: 0, delay_hours: 0, template_name: 'appt_morning_confirm' }, // T-3h
      { step_number: 4, channel: 'sms', delay_days: 0, delay_hours: 0, template_name: 'appt_lockin_30min' }, // T-30min
    ],
  },
  {
    name: 'Appointment Set: In-Person',
    disposition: 'appointment_set_inperson',
    steps: [
      { step_number: 1, channel: 'sms', delay_days: 0, delay_hours: 0, template_name: 'appt_confirm_inperson' },
      { step_number: 2, channel: 'sms', delay_days: 0, delay_hours: 0, template_name: 'appt_value_add_inperson' }, // T-24h
      { step_number: 3, channel: 'call', delay_days: 0, delay_hours: 0 }, // T-16h evening call
      { step_number: 4, channel: 'sms', delay_days: 0, delay_hours: 0, template_name: 'appt_morning_confirm' }, // T-3h
      { step_number: 5, channel: 'sms', delay_days: 0, delay_hours: 0, template_name: 'appt_enroute_15min' }, // T-15min
    ],
  },
]

/**
 * FUP-01: Sequence Model - Stored in lead_activities
 * Sequences are stored as type='followup_sequence' with metadata
 */

/**
 * FUP-03: Follow-Up Task Creation
 * Creates tasks from a sequence for a given lead
 */
export async function enrollInFollowUpSequence(
  leadId: string,
  sequenceName: string,
  trigger: FollowUpTrigger,
  triggerValue?: string
): Promise<boolean> {
  try {
    // Find the matching sequence
    const sequence = DEFAULT_SEQUENCES.find(
      (s) =>
        s.name === sequenceName ||
        (triggerValue && (s.stage === triggerValue || s.disposition === triggerValue))
    )

    if (!sequence) {
      console.error(`Sequence ${sequenceName} not found`)
      return false
    }

    // Check if already enrolled in this sequence
    const { data: existing } = await supabase
      .from('lead_activities')
      .select('id')
      .eq('lead_id', leadId)
      .eq('type', 'followup_enrollment')
      .contains('metadata', { sequence_name: sequenceName, status: 'active' })

    if (existing && existing.length > 0) {
      console.log(`Lead ${leadId} already enrolled in ${sequenceName}`)
      return false
    }

    const now = new Date()

    // Create enrollment record
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      type: 'followup_enrollment',
      description: `Enrolled in ${sequenceName}`,
      agent: 'Ari',
      metadata: {
        sequence_name: sequenceName,
        trigger,
        status: 'active',
        enrolled_at: now.toISOString(),
        current_step: 0,
      },
    })

    // Create tasks for each step
    for (const step of sequence.steps) {
      const dueDate = new Date(now)
      dueDate.setDate(dueDate.getDate() + step.delay_days)
      dueDate.setHours(dueDate.getHours() + step.delay_hours)

      // Default to 10am if no specific hour set
      if (step.delay_hours === 0) {
        dueDate.setHours(10, 0, 0, 0)
      }

      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        type: step.channel,
        description: `${sequenceName} - Step ${step.step_number}: ${step.channel}`,
        agent: 'Ari',
        metadata: {
          title: `${step.channel.toUpperCase()}: ${sequenceName} Step ${step.step_number}`,
          task_type: step.channel,
          due_date: dueDate.toISOString(),
          assigned_to: 'ED',
          status: 'pending',
          channel: step.channel,
          sequence_name: sequenceName,
          step_number: step.step_number,
          template_content: step.template_content,
          ...(step.template_name ? { template_name: step.template_name } : {}),
        },
      })
    }

    return true
  } catch (err) {
    console.error('Error enrolling in follow-up sequence:', err)
    return false
  }
}

/**
 * Auto-enroll lead when stage changes
 */
export async function handleStageChange(leadId: string, newStage: string) {
  const sequenceMap: Record<string, string> = {
    not_contacted: 'New Lead Sequence',
    negotiations: 'Offer Made Sequence',
  }

  const sequenceName = sequenceMap[newStage]
  if (sequenceName) {
    await enrollInFollowUpSequence(leadId, sequenceName, 'stage_change', newStage)
  }
}

/**
 * Auto-enroll lead when disposition is logged
 */
export async function handleDisposition(leadId: string, disposition: string) {
  const sequenceMap: Record<string, string> = {
    no_answer: 'Post-Disposition: No Answer',
    left_voicemail: 'Post-Disposition: Left Voicemail',
    not_interested: 'Post-Disposition: Not Interested',
  }

  const sequenceName = sequenceMap[disposition]
  if (sequenceName) {
    await enrollInFollowUpSequence(leadId, sequenceName, 'disposition', disposition)
  }
}

/**
 * Cancel active follow-up sequence (e.g., when lead responds)
 */
export async function cancelFollowUpSequence(leadId: string, sequenceName: string) {
  try {
    // Find the enrollment
    const { data: enrollments } = await supabase
      .from('lead_activities')
      .select('id, metadata')
      .eq('lead_id', leadId)
      .eq('type', 'followup_enrollment')
      .contains('metadata', { sequence_name: sequenceName, status: 'active' })

    if (!enrollments || enrollments.length === 0) return

    // Mark enrollment as cancelled
    for (const enrollment of enrollments) {
      await supabase
        .from('lead_activities')
        .update({
          metadata: { ...enrollment.metadata, status: 'cancelled', cancelled_at: new Date().toISOString() },
        })
        .eq('id', enrollment.id)
    }

    // Cancel pending tasks from this sequence
    const { data: tasks } = await supabase
      .from('lead_activities')
      .select('id')
      .eq('lead_id', leadId)
      .contains('metadata', { sequence_name: sequenceName, status: 'pending' })

    if (tasks) {
      for (const task of tasks) {
        await supabase
          .from('lead_activities')
          .update({ metadata: { status: 'cancelled' } })
          .eq('id', task.id)
      }
    }
  } catch (err) {
    console.error('Error cancelling follow-up sequence:', err)
  }
}
