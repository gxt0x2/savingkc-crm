export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isNonRealRecord } from '@/lib/real-data'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const db = supabaseAdmin()

    const { data: file, error: fileError } = await db
      .from('tc_files')
      .select('id, lead_id, dispo_deal_id, lead:lead_id(full_name, property_address)')
      .eq('id', id)
      .maybeSingle()

    if (fileError) return NextResponse.json({ error: fileError.message }, { status: 500 })
    if (!file?.lead_id || !file.dispo_deal_id) {
      return NextResponse.json({ communications: [], events: [] })
    }

    const lead = Array.isArray(file.lead) ? file.lead[0] : file.lead
    if (isNonRealRecord(lead?.full_name, lead?.property_address)) {
      return NextResponse.json({ communications: [], events: [] })
    }

    const [activitiesRes, eventsRes] = await Promise.all([
      db
        .from('lead_activities')
        .select('id, activity_type, description, agent, metadata, created_at')
        .eq('lead_id', file.lead_id)
        .in('activity_type', ['sms', 'email', 'call', 'note', 'appointment', 'task', 'follow_up'])
        .order('created_at', { ascending: false })
        .limit(100),
      db
        .from('tc_events')
        .select('id, tc_file_id, event_type, payload, actor, created_at')
        .eq('tc_file_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    if (activitiesRes.error) return NextResponse.json({ error: activitiesRes.error.message }, { status: 500 })
    if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 500 })

    const communications = (activitiesRes.data ?? []).map((activity) => ({
      ...activity,
      title: activity.metadata?.subject || activity.metadata?.direction || activity.activity_type,
    }))

    return NextResponse.json({
      communications,
      events: eventsRes.data ?? [],
    })
  } catch (err) {
    console.error('[tc/files/:id/communications GET] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
