export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  buildConversationHubThreads,
  type ConversationHubActivity,
  type ConversationHubLead,
} from '@/lib/operating-model/conversation-hub'

const HUB_ACTIVITY_TYPES = [
  'call',
  'sms',
  'sms_sent',
  'sms_received',
  'sms_inbound',
  'sms_outbound',
  'email',
  'voicemail',
  'task',
  'status_change',
]

export async function GET() {
  const db = supabaseAdmin()
  const { data: leads, error: leadsError } = await db
    .from('leads')
    .select('id, full_name, phone, email, property_address, city, station, priority, assigned_agent, created_at')
    .not('station', 'eq', 'dead')
    .order('created_at', { ascending: false })
    .limit(100)

  if (leadsError) {
    return NextResponse.json({ error: leadsError.message }, { status: 500 })
  }

  const leadRows = (leads ?? []) as ConversationHubLead[]
  if (leadRows.length === 0) return NextResponse.json({ items: [] })

  const { data: activities, error: activitiesError } = await db
    .from('lead_activities')
    .select('id, lead_id, activity_type, description, agent, metadata, created_at')
    .in('lead_id', leadRows.map((lead) => lead.id))
    .in('activity_type', HUB_ACTIVITY_TYPES)
    .order('created_at', { ascending: false })
    .limit(3000)

  if (activitiesError) {
    return NextResponse.json({ error: activitiesError.message }, { status: 500 })
  }

  return NextResponse.json({
    items: buildConversationHubThreads(
      leadRows,
      (activities ?? []) as ConversationHubActivity[],
    ),
  })
}
