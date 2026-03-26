import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * MCF-06: No Response Follow-Up
 *
 * Checks for missed calls that got an auto-response SMS but no reply within 2 hours.
 * Creates a callback task scheduled during office hours.
 *
 * This function should be called on a schedule (e.g., every 30 minutes via cron).
 */
export async function checkMissedCallFollowUps() {
  try {
    const twoHoursAgo = new Date()
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2)

    // Find missed calls from 2+ hours ago that sent an auto-response
    const { data: missedCalls, error } = await supabase
      .from('lead_activities')
      .select('id, lead_id, created_at, metadata')
      .eq('type', 'call')
      .eq('metadata->>outcome', 'missed')
      .gte('created_at', twoHoursAgo.toISOString())
      .not('lead_id', 'is', null)

    if (error || !missedCalls) {
      console.error('Error fetching missed calls for follow-up:', error)
      return
    }

    for (const call of missedCalls) {
      const leadId = call.lead_id
      if (!leadId) continue

      // Check if they responded (inbound SMS or call)
      const { data: responses } = await supabase
        .from('lead_activities')
        .select('id')
        .eq('lead_id', leadId)
        .in('type', ['sms', 'call'])
        .eq('metadata->>direction', 'inbound')
        .gte('created_at', call.created_at)

      if (responses && responses.length > 0) {
        // They responded, skip follow-up
        continue
      }

      // Check if a callback task was already created for this missed call
      const { data: existingCallback } = await supabase
        .from('lead_activities')
        .select('id')
        .eq('lead_id', leadId)
        .eq('type', 'callback')
        .eq('metadata->>trigger', 'missed_call_no_response')
        .gte('created_at', call.created_at)

      if (existingCallback && existingCallback.length > 0) {
        // Callback already created, skip
        continue
      }

      // Get lead info
      const { data: lead } = await supabase
        .from('leads')
        .select('full_name')
        .eq('id', leadId)
        .single()

      const leadName = lead?.full_name || 'Unknown'

      // Schedule callback during office hours
      const now = new Date()
      let callbackTime = new Date(now)

      // Default office hours: 9am-5pm CT
      const currentHour = now.getHours()

      if (currentHour < 9) {
        // Before 9am, schedule for 9am today
        callbackTime.setHours(9, 0, 0, 0)
      } else if (currentHour >= 17) {
        // After 5pm, schedule for 9am tomorrow
        callbackTime.setDate(callbackTime.getDate() + 1)
        callbackTime.setHours(9, 0, 0, 0)
      } else {
        // During office hours, schedule for 30 minutes from now
        callbackTime.setMinutes(callbackTime.getMinutes() + 30)
      }

      // Create callback task
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        type: 'callback',
        description: `Callback: No response to missed call text-back`,
        agent: 'Ari',
        metadata: {
          title: `Callback: ${leadName} (No SMS response)`,
          task_type: 'callback',
          due_date: callbackTime.toISOString(),
          assigned_to: 'ED',
          status: 'pending',
          trigger: 'missed_call_no_response',
        },
      })

      console.log(`Created no-response callback for lead ${leadId} at ${callbackTime.toISOString()}`)
    }
  } catch (err) {
    console.error('Error checking missed call follow-ups:', err)
  }
}
