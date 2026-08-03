import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { getLeadQualificationStatuses } from '@/lib/qualification-policy'

export async function GET(request: Request) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    // Fetch active leads in pipeline stages that need action
    const { data: leads } = await supabase
      .from('leads')
      .select('id, full_name, phone, property_address, city, station, priority, motivation_score, offer_amount, updated_at, arv, repair_estimate')
      .in('station', ['qualified', 'appointment_set', 'offer_made'])
      .not('phone', 'is', null)
      .order('updated_at', { ascending: true })
      .limit(100)

    if (!leads?.length) {
      return NextResponse.json({ actions: [], handled: 0, total: 0 })
    }

    const leadIds = leads.map(l => l.id)

    // Get last activity for each lead
    const { data: activities } = await supabase
      .from('lead_activities')
      .select('lead_id, created_at, activity_type, type')
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false })

    const lastActivityMap = new Map<string, string>()
    for (const a of activities || []) {
      if (a.lead_id && !lastActivityMap.has(a.lead_id)) {
        lastActivityMap.set(a.lead_id, a.created_at)
      }
    }

    // Get tasks for these leads to count handled
    const { data: tasks } = await supabase
      .from('tasks')
      .select('lead_id, status')
      .in('lead_id', leadIds)
      .eq('status', 'completed')

    const completedTaskLeads = new Set((tasks || []).map(t => t.lead_id))
    const qualificationStatuses = await getLeadQualificationStatuses(
      leads.filter((lead) => lead.station === 'qualified').map((lead) => lead.id),
    )

    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000
    const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000

    const actions: any[] = []

    for (const lead of leads) {
      const lastActivity = lastActivityMap.get(lead.id)
      const lastActivityDate = lastActivity ? new Date(lastActivity).getTime() : 0
      const daysSinceActivity = lastActivity ? Math.floor((Date.now() - lastActivityDate) / (24 * 60 * 60 * 1000)) : 999

      let action_type = ''
      let action_label = ''
      let action_detail = ''

      if (lead.station === 'qualified') {
        const missing = qualificationStatuses.get(lead.id)?.missing ?? []

        if (missing.length > 0) {
          action_type = 'get_info'
          action_label = 'GET INFO'
          action_detail = `Missing: ${missing.join(', ')}`
        } else if (!lead.offer_amount) {
          action_type = 'send_offer'
          action_label = 'SEND OFFER'
          action_detail = `Qualified, pillars complete${lead.motivation_score ? `, motivation ${lead.motivation_score}/10` : ''}`
        } else if (daysSinceActivity > 5) {
          action_type = 'follow_up'
          action_label = 'FOLLOW UP'
          action_detail = `Stalled — no activity in ${daysSinceActivity} days`
        } else {
          continue // Nothing actionable
        }
      } else if (lead.station === 'appointment_set') {
        if (daysSinceActivity > 3) {
          action_type = 'confirm_appt'
          action_label = 'CONFIRM APPT'
          action_detail = `Set ${daysSinceActivity} days ago, no confirmation`
        } else {
          continue
        }
      } else if (lead.station === 'offer_made') {
        if (!lead.offer_amount) {
          action_type = 'send_offer'
          action_label = 'SEND OFFER'
          action_detail = `In negotiations, no offer on file${lead.motivation_score ? `, motivation ${lead.motivation_score}/10` : ''}`
        } else if (daysSinceActivity > 3) {
          action_type = 'follow_up'
          action_label = 'FOLLOW UP'
          action_detail = `Last activity ${daysSinceActivity} days ago`
        } else {
          continue
        }
      }

      actions.push({
        id: lead.id,
        full_name: lead.full_name,
        phone: lead.phone,
        property_address: lead.property_address,
        city: lead.city,
        station: lead.station,
        priority: lead.priority,
        motivation_score: lead.motivation_score,
        offer_amount: lead.offer_amount,
        action_type,
        action_label,
        action_detail,
      })
    }

    // Sort: send_offer first, then confirm_appt, then get_info, then follow_up
    const actionOrder: Record<string, number> = { send_offer: 0, confirm_appt: 1, get_info: 2, follow_up: 3 }
    actions.sort((a, b) => (actionOrder[a.action_type] ?? 99) - (actionOrder[b.action_type] ?? 99))

    const handled = actions.filter(a => completedTaskLeads.has(a.id)).length

    return NextResponse.json({
      actions: actions.slice(0, 15),
      handled,
      total: actions.length,
    })
  } catch (err) {
    console.error('pipeline-actions error:', err)
    return NextResponse.json({ actions: [], handled: 0, total: 0 })
  }
}
