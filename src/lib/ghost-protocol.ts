import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type GhostProtocolPhase = 1 | 2 | 3
export type GhostProtocolStatus = 'active' | 'paused' | 'completed' | 'cancelled'

export interface GhostProtocolEnrollment {
  id: string
  lead_id: string
  enrolled_date: string
  current_phase: GhostProtocolPhase
  last_action_date: string | null
  next_action_date: string | null
  status: GhostProtocolStatus
  pause_reason: string | null
  created_at: string
  updated_at: string
}

interface LeadForGhostCheck {
  id: string
  station: string
  created_at: string
  full_name: string
  phone: string
  property_address: string
}

interface LeadActivity {
  id: string
  lead_id: string
  type: string
  created_at: string
  metadata: any
}

/**
 * Identifies leads that qualify for Ghost Protocol enrollment
 *
 * Criteria:
 * - Lead is in Stage 2+ (contacted, qualifying, appt_set, negotiations)
 * - Had at least 1 successful conversation (type='call' with successful outcome or type='sms' with response)
 * - Has had 2+ contact attempts with no response in last 7+ days
 */
export async function detectGhostProtocolCandidates(): Promise<string[]> {
  try {
    // Get leads in Stage 2+ (excluding new, dead, contract_signed)
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, station, created_at, full_name, phone, property_address')
      .in('station', ['contacted', 'qualifying', 'appt_set', 'negotiations'])

    if (leadsError) {
      console.error('Error fetching leads for ghost detection:', leadsError)
      return []
    }

    if (!leads || leads.length === 0) return []

    const candidates: string[] = []
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    for (const lead of leads as LeadForGhostCheck[]) {
      // Get all activities for this lead
      const { data: activities, error: activitiesError } = await supabase
        .from('lead_activities')
        .select('id, lead_id, type, created_at, metadata')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })

      if (activitiesError || !activities) continue

      const acts = activities as LeadActivity[]

      // Check if they had at least one successful conversation
      const hadConversation = acts.some(
        (a) =>
          (a.type === 'call' && a.metadata?.outcome === 'spoke_with_owner') ||
          (a.type === 'sms' && a.metadata?.direction === 'inbound')
      )

      if (!hadConversation) continue

      // Get recent contact attempts (calls, SMS, emails in last 7 days)
      const recentAttempts = acts.filter((a) => {
        const attemptDate = new Date(a.created_at)
        return (
          attemptDate >= sevenDaysAgo &&
          (a.type === 'call' || a.type === 'sms' || a.type === 'email') &&
          a.metadata?.direction === 'outbound'
        )
      })

      // Check if they have 2+ attempts with no response
      if (recentAttempts.length >= 2) {
        // Check if any of those attempts got a response
        const gotResponse = acts.some((a) => {
          const responseDate = new Date(a.created_at)
          return (
            responseDate >= sevenDaysAgo &&
            ((a.type === 'call' && a.metadata?.outcome === 'spoke_with_owner') ||
              (a.type === 'sms' && a.metadata?.direction === 'inbound') ||
              (a.type === 'email' && a.metadata?.direction === 'inbound'))
          )
        })

        if (!gotResponse) {
          candidates.push(lead.id)
        }
      }
    }

    return candidates
  } catch (err) {
    console.error('Ghost protocol detection error:', err)
    return []
  }
}

/**
 * Enrolls a lead in Ghost Protocol Phase 1
 * Creates the enrollment record and queues Phase 1 tasks
 */
export async function enrollInGhostProtocol(leadId: string): Promise<boolean> {
  try {
    // Check if already enrolled
    const { data: existing } = await supabase
      .from('lead_activities')
      .select('id, metadata')
      .eq('lead_id', leadId)
      .eq('type', 'ghost_protocol_enrollment')
      .single()

    if (existing && existing.metadata?.status === 'active') {
      console.log(`Lead ${leadId} already enrolled in Ghost Protocol`)
      return false
    }

    const now = new Date()
    const enrollmentData = {
      lead_id: leadId,
      enrolled_date: now.toISOString(),
      current_phase: 1,
      last_action_date: null,
      next_action_date: now.toISOString(), // First task is immediate (Day 1)
      status: 'active',
      pause_reason: null,
    }

    // Create enrollment record in lead_activities
    const { error: enrollError } = await supabase
      .from('lead_activities')
      .insert({
        lead_id: leadId,
        type: 'ghost_protocol_enrollment',
        description: 'Enrolled in Ghost Protocol - Phase 1',
        agent: 'Ari',
        metadata: enrollmentData,
      })

    if (enrollError) {
      console.error('Error enrolling in ghost protocol:', enrollError)
      return false
    }

    // Create Phase 1 task sequence
    await createPhase1Tasks(leadId, now)

    return true
  } catch (err) {
    console.error('Ghost protocol enrollment error:', err)
    return false
  }
}

/**
 * Creates the Phase 1 task sequence for a ghost protocol lead
 * Phase 1: Days 1-7
 * - Day 1: SMS
 * - Day 3: Email
 * - Day 5: Voicemail
 * - Day 7: Handwritten note
 */
async function createPhase1Tasks(leadId: string, enrollmentDate: Date) {
  const tasks = [
    {
      day: 1,
      type: 'sms',
      title: 'Ghost Protocol SMS (Day 1)',
      description: 'Send re-engagement SMS per Ghost Protocol Phase 1',
    },
    {
      day: 3,
      type: 'email',
      title: 'Ghost Protocol Email (Day 3)',
      description: 'Send re-engagement email per Ghost Protocol Phase 1',
    },
    {
      day: 5,
      type: 'voicemail',
      title: 'Ghost Protocol Voicemail (Day 5)',
      description: 'Leave voicemail message per Ghost Protocol Phase 1',
    },
    {
      day: 7,
      type: 'task',
      title: 'Ghost Protocol Note (Day 7)',
      description: 'Queue handwritten note per Ghost Protocol Phase 1',
    },
  ]

  for (const task of tasks) {
    const dueDate = new Date(enrollmentDate)
    dueDate.setDate(dueDate.getDate() + task.day)
    dueDate.setHours(10, 0, 0, 0) // Default to 10am

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      type: task.type,
      description: task.description,
      agent: 'Ari',
      metadata: {
        title: task.title,
        task_type: task.type,
        due_date: dueDate.toISOString(),
        assigned_to: 'CA', // Casey
        status: 'pending',
        ghost_protocol_phase: 1,
        ghost_protocol_day: task.day,
      },
    })
  }
}

/**
 * Gets all active Ghost Protocol enrollments
 */
export async function getActiveGhostProtocolLeads(): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('lead_activities')
      .select('lead_id, metadata, created_at')
      .eq('type', 'ghost_protocol_enrollment')

    if (error) {
      console.error('Error fetching ghost protocol enrollments:', error)
      return []
    }

    return (data || []).filter((d) => d.metadata?.status === 'active')
  } catch (err) {
    console.error('Error getting ghost protocol leads:', err)
    return []
  }
}

/**
 * GHP-03: Creates Phase 2 task sequence (Days 8-21)
 * - Day 10: SMS (different angle)
 * - Day 14: Voicemail (strategic, mention comp)
 * - Day 18: Handwritten note
 * - Day 21: Final SMS
 */
async function createPhase2Tasks(leadId: string, enrollmentDate: Date) {
  const tasks = [
    {
      day: 10,
      type: 'sms',
      title: 'Ghost Protocol SMS (Day 10)',
      description: 'Send Phase 2 re-engagement SMS (different angle)',
    },
    {
      day: 14,
      type: 'voicemail',
      title: 'Ghost Protocol Voicemail (Day 14)',
      description: 'Leave strategic voicemail - mention comp sale or benefit',
    },
    {
      day: 18,
      type: 'task',
      title: 'Ghost Protocol Note (Day 18)',
      description: 'Queue second handwritten note',
    },
    {
      day: 21,
      type: 'sms',
      title: 'Ghost Protocol Final SMS (Day 21)',
      description: 'Send final Phase 2 SMS - door always open',
    },
  ]

  for (const task of tasks) {
    const dueDate = new Date(enrollmentDate)
    dueDate.setDate(dueDate.getDate() + task.day)
    dueDate.setHours(10, 0, 0, 0)

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      type: task.type,
      description: task.description,
      agent: 'Ari',
      metadata: {
        title: task.title,
        task_type: task.type,
        due_date: dueDate.toISOString(),
        assigned_to: 'CA',
        status: 'pending',
        ghost_protocol_phase: 2,
        ghost_protocol_day: task.day,
      },
    })
  }
}

/**
 * GHP-04: Advances ghost protocol to next phase
 */
export async function advanceGhostProtocolPhase(leadId: string, currentPhase: GhostProtocolPhase): Promise<boolean> {
  try {
    // Get enrollment record
    const { data: enrollment, error } = await supabase
      .from('lead_activities')
      .select('id, metadata, created_at')
      .eq('lead_id', leadId)
      .eq('type', 'ghost_protocol_enrollment')
      .single()

    if (error || !enrollment) return false

    const enrollmentDate = new Date(enrollment.created_at)

    if (currentPhase === 1) {
      // Advance to Phase 2
      await createPhase2Tasks(leadId, enrollmentDate)

      await supabase
        .from('lead_activities')
        .update({
          metadata: {
            ...enrollment.metadata,
            current_phase: 2,
            last_action_date: new Date().toISOString(),
          },
        })
        .eq('id', enrollment.id)

      return true
    } else if (currentPhase === 2) {
      // Advance to Phase 3 (long nurture)
      await enterPhase3LongNurture(leadId, enrollmentDate)

      await supabase
        .from('lead_activities')
        .update({
          metadata: {
            ...enrollment.metadata,
            current_phase: 3,
            last_action_date: new Date().toISOString(),
          },
        })
        .eq('id', enrollment.id)

      return true
    }

    return false
  } catch (err) {
    console.error('Error advancing ghost protocol phase:', err)
    return false
  }
}

/**
 * GHP-04: Phase 3 - Long Nurture (Day 22+)
 * Sets up quarterly touchpoints and monitors for trigger events
 */
async function enterPhase3LongNurture(leadId: string, enrollmentDate: Date) {
  const touchpoints = [
    { day: 52, type: 'sms', title: 'Long Nurture - 30 Day Check-in' },
    { day: 82, type: 'task', title: 'Long Nurture - 60 Day Note' },
    { day: 112, type: 'sms', title: 'Long Nurture - 90 Day Check-in' },
    { day: 202, type: 'task', title: 'Long Nurture - Quarterly Note' },
  ]

  for (const touchpoint of touchpoints) {
    const dueDate = new Date(enrollmentDate)
    dueDate.setDate(dueDate.getDate() + touchpoint.day)
    dueDate.setHours(10, 0, 0, 0)

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      type: touchpoint.type,
      description: `Ghost Protocol Phase 3: ${touchpoint.title}`,
      agent: 'Ari',
      metadata: {
        title: touchpoint.title,
        task_type: touchpoint.type,
        due_date: dueDate.toISOString(),
        assigned_to: 'CA',
        status: 'pending',
        ghost_protocol_phase: 3,
        ghost_protocol_day: touchpoint.day,
      },
    })
  }
}

/**
 * GHP-04: Checks for trigger events that should resurrect Phase 3 leads
 * Trigger events: tax delinquency, pre-foreclosure, ownership change, code violation
 */
export async function checkTriggerEventsForPhase3Leads(): Promise<string[]> {
  try {
    // Get all Phase 3 enrollments
    const { data: enrollments, error } = await supabase
      .from('lead_activities')
      .select('lead_id, metadata, leads!inner(county_data)')
      .eq('type', 'ghost_protocol_enrollment')

    if (error || !enrollments) return []

    const phase3Leads = enrollments.filter((e) => e.metadata?.current_phase === 3 && e.metadata?.status === 'active')

    const triggeredLeads: string[] = []

    for (const enrollment of phase3Leads) {
      const lead = (enrollment as any).leads
      const countyData = lead?.county_data || {}

      // Check for trigger events in county data
      const hasTrigger =
        countyData.tax_delinquent === true ||
        countyData.pre_foreclosure === true ||
        countyData.ownership_changed === true ||
        countyData.code_violations?.length > 0

      if (hasTrigger) {
        triggeredLeads.push(enrollment.lead_id)

        // Move lead back to Stage 1 (New) with "Recycled" source
        await supabase
          .from('leads')
          .update({
            station: 'new',
            source: 'Ghost Protocol - Trigger Event',
          })
          .eq('id', enrollment.lead_id)

        // Cancel ghost protocol
        await supabase
          .from('lead_activities')
          .update({
            metadata: {
              ...enrollment.metadata,
              status: 'completed',
              completion_reason: 'trigger_event_detected',
            },
          })
          .eq('lead_id', enrollment.lead_id)
          .eq('type', 'ghost_protocol_enrollment')

        // Create critical Ari briefing event
        await supabase.from('ari_briefing_events').insert({
          event_type: 'ghost_protocol_trigger',
          priority: 'critical',
          title: 'Ghost Protocol Trigger Event',
          description: `Lead ${lead.full_name} from Ghost Protocol has a new trigger event (${
            countyData.tax_delinquent ? 'tax delinquency' : countyData.pre_foreclosure ? 'pre-foreclosure' : 'ownership change/violation'
          }). Re-engage immediately.`,
          lead_id: enrollment.lead_id,
          action_url: `/leads/${enrollment.lead_id}`,
          metadata: { trigger_type: 'ghost_protocol_resurrection' },
        })
      }
    }

    return triggeredLeads
  } catch (err) {
    console.error('Error checking Phase 3 trigger events:', err)
    return []
  }
}

/**
 * GHP-06: Pause Ghost Protocol for a lead
 */
export async function pauseGhostProtocol(leadId: string, reason: string): Promise<boolean> {
  try {
    const { data: enrollment, error } = await supabase
      .from('lead_activities')
      .select('id, metadata')
      .eq('lead_id', leadId)
      .eq('type', 'ghost_protocol_enrollment')
      .single()

    if (error || !enrollment) return false

    await supabase
      .from('lead_activities')
      .update({
        metadata: {
          ...enrollment.metadata,
          status: 'paused',
          pause_reason: reason,
          paused_at: new Date().toISOString(),
        },
      })
      .eq('id', enrollment.id)

    // Log the pause action
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      type: 'status_change',
      description: `Ghost Protocol paused: ${reason}`,
      agent: 'System',
      metadata: { action: 'ghost_protocol_paused', reason },
    })

    return true
  } catch (err) {
    console.error('Error pausing ghost protocol:', err)
    return false
  }
}

/**
 * GHP-06: Resume Ghost Protocol for a lead
 */
export async function resumeGhostProtocol(leadId: string): Promise<boolean> {
  try {
    const { data: enrollment, error } = await supabase
      .from('lead_activities')
      .select('id, metadata')
      .eq('lead_id', leadId)
      .eq('type', 'ghost_protocol_enrollment')
      .single()

    if (error || !enrollment) return false

    await supabase
      .from('lead_activities')
      .update({
        metadata: {
          ...enrollment.metadata,
          status: 'active',
          pause_reason: null,
          resumed_at: new Date().toISOString(),
        },
      })
      .eq('id', enrollment.id)

    // Log the resume action
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      type: 'status_change',
      description: 'Ghost Protocol resumed',
      agent: 'System',
      metadata: { action: 'ghost_protocol_resumed' },
    })

    return true
  } catch (err) {
    console.error('Error resuming ghost protocol:', err)
    return false
  }
}

/**
 * GHP-06: Cancel Ghost Protocol for a lead
 */
export async function cancelGhostProtocol(leadId: string, reason: string): Promise<boolean> {
  try {
    const { data: enrollment, error } = await supabase
      .from('lead_activities')
      .select('id, metadata')
      .eq('lead_id', leadId)
      .eq('type', 'ghost_protocol_enrollment')
      .single()

    if (error || !enrollment) return false

    await supabase
      .from('lead_activities')
      .update({
        metadata: {
          ...enrollment.metadata,
          status: 'cancelled',
          cancel_reason: reason,
          cancelled_at: new Date().toISOString(),
        },
      })
      .eq('id', enrollment.id)

    // Log the cancellation
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      type: 'status_change',
      description: `Ghost Protocol cancelled: ${reason}`,
      agent: 'System',
      metadata: { action: 'ghost_protocol_cancelled', reason },
    })

    return true
  } catch (err) {
    console.error('Error cancelling ghost protocol:', err)
    return false
  }
}

/**
 * GHP-05: Get Ghost Protocol summary stats for dashboard
 */
export async function getGhostProtocolStats(): Promise<{
  phase1: number
  phase2: number
  phase3: number
  total: number
  recovery_rate: number
}> {
  try {
    const { data: enrollments } = await supabase
      .from('lead_activities')
      .select('metadata')
      .eq('type', 'ghost_protocol_enrollment')

    if (!enrollments) return { phase1: 0, phase2: 0, phase3: 0, total: 0, recovery_rate: 0 }

    const active = enrollments.filter((e) => e.metadata?.status === 'active')
    const phase1 = active.filter((e) => e.metadata?.current_phase === 1).length
    const phase2 = active.filter((e) => e.metadata?.current_phase === 2).length
    const phase3 = active.filter((e) => e.metadata?.current_phase === 3).length

    // Recovery rate: leads that completed (re-engaged) / total enrolled
    const completed = enrollments.filter((e) => e.metadata?.status === 'completed').length
    const total = enrollments.length
    const recoveryRate = total > 0 ? (completed / total) * 100 : 0

    return {
      phase1,
      phase2,
      phase3,
      total: active.length,
      recovery_rate: Math.round(recoveryRate),
    }
  } catch (err) {
    console.error('Error getting ghost protocol stats:', err)
    return { phase1: 0, phase2: 0, phase3: 0, total: 0, recovery_rate: 0 }
  }
}
