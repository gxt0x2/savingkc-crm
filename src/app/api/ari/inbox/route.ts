import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  try {
    // 1. Fetch inbound SMS today
    const { data: inboundSms } = await supabase
      .from('lead_activities')
      .select('id, lead_id, description, created_at, metadata, activity_type, type')
      .gte('created_at', todayStart.toISOString())
      .or('type.eq.sms_received,type.eq.sms_inbound')
      .order('created_at', { ascending: false })
      .limit(50)

    // 2. Fetch missed calls today
    const { data: missedCalls } = await supabase
      .from('lead_activities')
      .select('id, lead_id, description, created_at, metadata, activity_type, type')
      .gte('created_at', todayStart.toISOString())
      .eq('type', 'missed_call')
      .order('created_at', { ascending: false })
      .limit(20)

    // 3. Fetch all outbound SMS today to determine which inbound were replied to
    const { data: outboundSms } = await supabase
      .from('lead_activities')
      .select('lead_id, metadata, created_at')
      .gte('created_at', todayStart.toISOString())
      .or('type.eq.sms_sent,type.eq.sms_outbound')

    // Build set of lead_ids that have outbound after their last inbound
    const repliedLeadIds = new Set<string>()
    for (const inbound of inboundSms || []) {
      if (!inbound.lead_id) continue
      const hasReply = (outboundSms || []).some(o =>
        o.lead_id === inbound.lead_id &&
        new Date(o.created_at) > new Date(inbound.created_at)
      )
      if (hasReply) repliedLeadIds.add(inbound.lead_id)
    }

    // 4. Filter to unreplied inbound only
    const unrepliedInbound = (inboundSms || []).filter(s =>
      s.lead_id && !repliedLeadIds.has(s.lead_id)
    )

    // 5. Get unique lead IDs for lookups
    const allLeadIds = [...new Set([
      ...unrepliedInbound.map(s => s.lead_id!),
      ...(missedCalls || []).filter(c => c.lead_id).map(c => c.lead_id!),
    ])]

    let leadMap = new Map<string, { full_name: string; phone: string | null; station: string | null }>()
    if (allLeadIds.length) {
      const { data: leads } = await supabase
        .from('leads')
        .select('id, full_name, phone, station')
        .in('id', allLeadIds)

      for (const l of leads || []) {
        leadMap.set(l.id, l)
      }
    }

    // 6. Build inbox items - dedupe by lead_id (keep most recent)
    const seenLeads = new Set<string>()
    const inboxItems: any[] = []

    for (const sms of unrepliedInbound) {
      if (!sms.lead_id || seenLeads.has(sms.lead_id)) continue
      seenLeads.add(sms.lead_id)
      const lead = leadMap.get(sms.lead_id)
      inboxItems.push({
        id: sms.id,
        type: 'sms',
        lead_id: sms.lead_id,
        lead_name: lead?.full_name || 'Unknown',
        phone: (sms.metadata as any)?.from || lead?.phone || null,
        station: lead?.station || null,
        message: sms.description || '',
        created_at: sms.created_at,
      })
    }

    for (const call of missedCalls || []) {
      if (!call.lead_id || seenLeads.has(call.lead_id)) continue
      seenLeads.add(call.lead_id)
      const lead = leadMap.get(call.lead_id)
      inboxItems.push({
        id: call.id,
        type: 'missed_call',
        lead_id: call.lead_id,
        lead_name: lead?.full_name || 'Unknown',
        phone: (call.metadata as any)?.from || lead?.phone || null,
        station: lead?.station || null,
        message: null,
        created_at: call.created_at,
      })
    }

    // Sort by recency
    inboxItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json({ items: inboxItems, count: inboxItems.length })
  } catch (err) {
    console.error('inbox error:', err)
    return NextResponse.json({ items: [], count: 0 })
  }
}
