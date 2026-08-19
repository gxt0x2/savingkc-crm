export const dynamic = 'force-dynamic'

import { unstable_cache } from 'next/cache'
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
import {
  isConversationCommunicationActivity,
  isConversationSupportingActivity,
  readConversationActivitySnapshot,
} from '@/lib/server/conversation-activity-snapshot'

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

const readConversationHub = unstable_cache(async () => {
  const db = supabaseAdmin()
  const activitySnapshot = await readConversationActivitySnapshot()
  const communicationActivities = activitySnapshot.filter(isConversationCommunicationActivity)
  const leadIds = [...new Set(communicationActivities.flatMap((activity) => activity.lead_id ? [activity.lead_id] : []))]
  const leadIdSet = new Set(leadIds)
  const supportingActivities = activitySnapshot.filter((activity) =>
    Boolean(activity.lead_id && leadIdSet.has(activity.lead_id)) && isConversationSupportingActivity(activity),
  )
  const [leadRows, manifests] = await Promise.all([
    fetchRowsByLeadIds<ConversationHubLead>(db, 'leads', 'id, full_name, phone, email, property_address, city, county, station, priority, assigned_agent, classification, dead_reason, source, motivation_score, arv, offer_amount, appointment_date, created_at', leadIds),
    fetchRowsByLeadIds<{ lead_id: string; manifest: ConversationManifestLike; created_at: string }>(db, 'manifests', 'lead_id, manifest, created_at', leadIds),
  ])

  const latestManifestByLead = new Map<string, ConversationManifestLike>()
  for (const row of manifests.sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (!latestManifestByLead.has(row.lead_id)) latestManifestByLead.set(row.lead_id, row.manifest ?? {})
  }

  const enrichedLeadRows = leadRows.map((lead) => ({
    ...lead,
    decision_tags: buildConversationDecisionTags(latestManifestByLead.get(lead.id), lead),
  }))

  return {
    items: buildConversationHubThreads(
      enrichedLeadRows,
      [...communicationActivities, ...supportingActivities] as ConversationHubActivity[],
    ),
    unmatchedActivities: communicationActivities.filter((activity) => !activity.lead_id),
  }
}, ['conversation-hub-v2'], { revalidate: 10, tags: ['conversation-hub'] })

export async function GET() {
  try {
    const snapshot = await readConversationHub()
    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Conversation hub could not be loaded' }, { status: 500 })
  }
}
