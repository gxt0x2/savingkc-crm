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
