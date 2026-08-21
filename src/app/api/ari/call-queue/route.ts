import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { listWorkItems } from '@/lib/server/work-items'

export async function GET(request: Request) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const now = new Date().toISOString()

  try {
    // 1. Fetch leads with phone numbers that aren't dead
    const { data: leads } = await supabase
      .from('leads')
      .select('id, full_name, phone, property_address, city, station, priority, source, created_at, updated_at')
      .not('phone', 'is', null)
      .neq('station', 'dead')
      .neq('station', 'closed')
      .order('updated_at', { ascending: false })
      .limit(200)

    if (!leads?.length) {
      return NextResponse.json({ queue: [], targets: { dials: 50, contacts: 10, appointments: 2 }, counts: { dials: 0, contacts: 0, appointments: 0 } })
    }

    const leadIds = leads.map(l => l.id)

    // 2. Fetch today's activity counts
    const { data: todayActivities } = await supabase
      .from('lead_activities')
      .select('type, activity_type, lead_id, metadata')
      .gte('created_at', todayStart.toISOString())

    const dials = (todayActivities || []).filter(a =>
      a.type === 'call' || a.type === 'outbound_call' || a.activity_type === 'call'
    ).length
    const contacts = (todayActivities || []).filter(a =>
      (a.type === 'call' || a.activity_type === 'call') && a.metadata?.connected
    ).length
    const appointments = (todayActivities || []).filter(a =>
      a.type === 'appointment_set' || a.activity_type === 'appointment'
    ).length

    // 3. Fetch recent inbound activity (SMS replies, missed calls) to identify hot leads
    const { data: recentInbound } = await supabase
      .from('lead_activities')
      .select('lead_id, activity_type, type, created_at, description, metadata')
      .in('lead_id', leadIds)
      .or('activity_type.eq.sms,type.eq.sms_received,type.eq.sms_inbound,type.eq.missed_call')
      .order('created_at', { ascending: false })
      .limit(100)

    // Map: lead_id -> latest inbound activity
    const inboundMap = new Map<string, { created_at: string; description: string; type: string }>()
    for (const a of recentInbound || []) {
      if (a.lead_id && !inboundMap.has(a.lead_id)) {
        const metadata = a.metadata && typeof a.metadata === 'object'
          ? a.metadata as Record<string, unknown>
          : {}
        const isInbound = a.activity_type === 'sms' &&
          (a.type === 'sms_received' || a.type === 'sms_inbound' || metadata.direction === 'received')
        const isMissedCall = a.type === 'missed_call'
        if (isInbound || isMissedCall) {
          inboundMap.set(a.lead_id, {
            created_at: a.created_at,
            description: a.description || '',
            type: isMissedCall ? 'missed_call' : 'sms_reply',
          })
        }
      }
    }

    // 4. Fetch overdue callback tasks
    const callbackTasks = await listWorkItems({
      statuses: ['pending', 'blocked'],
      dueBefore: now,
      leadIds,
      limit: 500,
    })

    const callbackMap = new Map<string, { due_date: string; title: string }>()
    for (const t of callbackTasks || []) {
      if (t.leadId && t.dueAt) callbackMap.set(t.leadId, { due_date: t.dueAt, title: t.title })
    }

    // 5. Fetch last contact dates
    const { data: lastContacts } = await supabase
      .from('lead_activities')
      .select('lead_id, created_at')
      .in('lead_id', leadIds)
      .or('activity_type.eq.call,type.eq.call,type.eq.outbound_call,activity_type.eq.sms')
      .order('created_at', { ascending: false })

    const lastContactMap = new Map<string, string>()
    for (const a of lastContacts || []) {
      if (a.lead_id && !lastContactMap.has(a.lead_id)) {
        lastContactMap.set(a.lead_id, a.created_at)
      }
    }

    // 6. Score and sort leads
    const fortyEightHoursAgo = Date.now() - 48 * 60 * 60 * 1000
    const scored = leads.map(lead => {
      let score = 0
      let reason = ''

      // Priority 1: Hot leads with recent inbound
      const inbound = inboundMap.get(lead.id)
      if (inbound) {
        const age = Date.now() - new Date(inbound.created_at).getTime()
        if (age < 60 * 60 * 1000) { score = 1000; reason = `Replied ${Math.round(age / 60000)} min ago` }
        else if (age < 24 * 60 * 60 * 1000) { score = 800; reason = 'Replied today' }
        else { score = 600; reason = 'Has recent reply' }
      }

      // Priority 2: Overdue callbacks
      const callback = callbackMap.get(lead.id)
      if (callback && score < 700) {
        score = 700
        reason = `Callback due ${new Date(callback.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      }

      // Priority 3: Hot leads not contacted in 48+ hrs
      const lastContact = lastContactMap.get(lead.id)
      if (lead.priority === 'hot' && (!lastContact || new Date(lastContact).getTime() < fortyEightHoursAgo)) {
        if (score < 500) { score = 500; reason = lastContact ? 'Hot lead — no contact in 48+ hrs' : 'Hot lead — never contacted' }
      }

      // Priority 4: New leads never contacted
      if (!lastContact && score < 400) {
        score = 400
        reason = 'New lead — never contacted'
      }

      // Priority 5: Warm leads needing re-engagement
      if (lead.priority === 'warm' && lastContact && new Date(lastContact).getTime() < fortyEightHoursAgo) {
        if (score < 300) { score = 300; reason = 'Warm lead — needs follow-up' }
      }

      // Boost by priority
      if (lead.priority === 'hot') score += 50
      if (lead.priority === 'warm') score += 20

      if (!reason) reason = lead.source || 'In pipeline'

      return {
        id: lead.id,
        full_name: lead.full_name,
        phone: lead.phone,
        property_address: lead.property_address,
        city: lead.city,
        station: lead.station,
        priority: lead.priority,
        score,
        reason,
        last_contact: lastContact || null,
        inbound_activity: inbound || null,
      }
    })

    scored.sort((a, b) => b.score - a.score)
    const queue = scored.filter(l => l.score > 0).slice(0, 25)

    return NextResponse.json({
      queue,
      targets: { dials: 50, contacts: 10, appointments: 2 },
      counts: { dials, contacts, appointments },
    })
  } catch (err) {
    console.error('call-queue error:', err)
    return NextResponse.json({ queue: [], targets: { dials: 50, contacts: 10, appointments: 2 }, counts: { dials: 0, contacts: 0, appointments: 0 } })
  }
}
