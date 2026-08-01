export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  buildConversationHubThreads,
  type ConversationHubActivity,
  type ConversationHubLead,
} from '@/lib/operating-model/conversation-hub'
import {
  buildConversationDecisionTags,
  type ConversationManifestLike,
} from '@/lib/operating-model/conversation-tags'

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
    .select('id, full_name, phone, email, property_address, city, county, station, priority, assigned_agent, classification, dead_reason, source, motivation_score, arv, offer_amount, appointment_date, created_at')
    .not('station', 'eq', 'dead')
    .order('created_at', { ascending: false })
    .limit(100)

  if (leadsError) {
    return NextResponse.json({ error: leadsError.message }, { status: 500 })
  }

  const leadRows = (leads ?? []) as ConversationHubLead[]
  if (leadRows.length === 0) return NextResponse.json({ items: [] })

  const [activityResult, manifestResult] = await Promise.all([
    db
      .from('lead_activities')
      .select('id, lead_id, activity_type, description, agent, metadata, created_at')
      .in('lead_id', leadRows.map((lead) => lead.id))
      .in('activity_type', HUB_ACTIVITY_TYPES)
      .order('created_at', { ascending: false })
      .limit(3000),
    db
      .from('manifests')
      .select('lead_id, manifest, created_at')
      .in('lead_id', leadRows.map((lead) => lead.id))
      .order('created_at', { ascending: false }),
  ])

  const { data: activities, error: activitiesError } = activityResult

  if (activitiesError) {
    return NextResponse.json({ error: activitiesError.message }, { status: 500 })
  }

  const latestManifestByLead = new Map<string, ConversationManifestLike>()
  for (const row of manifestResult.data ?? []) {
    if (!latestManifestByLead.has(row.lead_id)) {
      latestManifestByLead.set(row.lead_id, (row.manifest ?? {}) as ConversationManifestLike)
    }
  }

  const enrichedLeadRows = leadRows.map((lead) => ({
    ...lead,
    decision_tags: buildConversationDecisionTags(latestManifestByLead.get(lead.id), lead),
  }))

  return NextResponse.json({
    items: buildConversationHubThreads(
      enrichedLeadRows,
      (activities ?? []) as ConversationHubActivity[],
    ),
  })
}
