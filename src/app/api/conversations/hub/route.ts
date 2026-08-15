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

const COMMUNICATION_ACTIVITY_TYPES = [
  'call',
  'sms',
  'sms_sent',
  'sms_received',
  'sms_inbound',
  'sms_outbound',
  'email',
  'voicemail',
]
const SUPPORTING_ACTIVITY_TYPES = ['task', 'status_change']

const PAGE_SIZE = 1000

async function fetchAllCommunicationActivities(db: ReturnType<typeof supabaseAdmin>) {
  const rows: ConversationHubActivity[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db
      .from('lead_activities')
      .select('id, lead_id, activity_type, description, agent, metadata, created_at')
      .in('activity_type', COMMUNICATION_ACTIVITY_TYPES)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...((data ?? []) as ConversationHubActivity[]))
    if ((data?.length ?? 0) < PAGE_SIZE) return rows
  }
}

async function fetchSupportingActivities(db: ReturnType<typeof supabaseAdmin>, leadIds: string[]) {
  const rows: ConversationHubActivity[] = []
  for (let offset = 0; offset < leadIds.length; offset += 200) {
    const { data, error } = await db
      .from('lead_activities')
      .select('id, lead_id, activity_type, description, agent, metadata, created_at')
      .in('lead_id', leadIds.slice(offset, offset + 200))
      .in('activity_type', SUPPORTING_ACTIVITY_TYPES)
      .order('created_at', { ascending: false })
    if (error) throw error
    rows.push(...((data ?? []) as ConversationHubActivity[]))
  }
  return rows
}

async function fetchRowsByLeadIds<T>(
  db: ReturnType<typeof supabaseAdmin>,
  table: 'leads' | 'manifests',
  select: string,
  leadIds: string[],
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; offset < leadIds.length; offset += 200) {
    const ids = leadIds.slice(offset, offset + 200)
    const query = db.from(table).select(select)
    const { data, error } = table === 'leads' ? await query.in('id', ids) : await query.in('lead_id', ids)
    if (error) throw error
    rows.push(...((data ?? []) as T[]))
  }
  return rows
}

export async function GET() {
  const db = supabaseAdmin()
  try {
    const communicationActivities = await fetchAllCommunicationActivities(db)
    const leadIds = [...new Set(communicationActivities.flatMap((activity) => activity.lead_id ? [activity.lead_id] : []))]
    const [leadRows, manifests, supportingActivities] = await Promise.all([
      fetchRowsByLeadIds<ConversationHubLead>(db, 'leads', 'id, full_name, phone, email, property_address, city, county, station, priority, assigned_agent, classification, dead_reason, source, motivation_score, arv, offer_amount, appointment_date, created_at', leadIds),
      fetchRowsByLeadIds<{ lead_id: string; manifest: ConversationManifestLike; created_at: string }>(db, 'manifests', 'lead_id, manifest, created_at', leadIds),
      fetchSupportingActivities(db, leadIds),
    ])

    const latestManifestByLead = new Map<string, ConversationManifestLike>()
    for (const row of manifests.sort((a, b) => b.created_at.localeCompare(a.created_at))) {
      if (!latestManifestByLead.has(row.lead_id)) latestManifestByLead.set(row.lead_id, row.manifest ?? {})
    }

    const enrichedLeadRows = leadRows.map((lead) => ({
      ...lead,
      decision_tags: buildConversationDecisionTags(latestManifestByLead.get(lead.id), lead),
    }))

    return NextResponse.json({
      items: buildConversationHubThreads(enrichedLeadRows, [...communicationActivities, ...supportingActivities]),
      unmatchedActivities: communicationActivities.filter((activity) => !activity.lead_id),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Conversation hub could not be loaded' }, { status: 500 })
  }
}
