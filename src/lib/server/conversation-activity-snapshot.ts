import 'server-only'

import { unstable_cache } from 'next/cache'
import type { ConversationHubActivity } from '@/lib/operating-model/conversation-hub'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const CONVERSATION_ACTIVITY_CACHE_TAG = 'conversation-activities'

const ACTIVITY_TYPES = [
  'call',
  'missed_call',
  'sms',
  'sms_sent',
  'sms_received',
  'sms_inbound',
  'sms_outbound',
  'email',
  'email_sent',
  'email_received',
  'voicemail',
  'task',
  'status_change',
] as const

const COMMUNICATION_ACTIVITY_TYPES = new Set([
  'call',
  'sms',
  'sms_sent',
  'sms_received',
  'sms_inbound',
  'sms_outbound',
  'email',
  'email_sent',
  'email_received',
  'voicemail',
])

const SUPPORTING_ACTIVITY_TYPES = new Set(['task', 'status_change'])
const PAGE_SIZE = 1000

export interface ConversationActivitySnapshotRow extends ConversationHubActivity {
  type?: string | null
}

export function isConversationCommunicationActivity(activity: ConversationActivitySnapshotRow): boolean {
  return COMMUNICATION_ACTIVITY_TYPES.has(activity.activity_type)
}

export function isConversationSupportingActivity(activity: ConversationActivitySnapshotRow): boolean {
  return SUPPORTING_ACTIVITY_TYPES.has(activity.activity_type)
}

async function fetchConversationActivitySnapshot(): Promise<ConversationActivitySnapshotRow[]> {
  const db = supabaseAdmin()
  const rows: ConversationActivitySnapshotRow[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db
      .from('lead_activities')
      .select('id, lead_id, activity_type, type, description, agent, metadata, created_at')
      .in('activity_type', [...ACTIVITY_TYPES])
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    rows.push(...((data ?? []) as ConversationActivitySnapshotRow[]))
    if ((data?.length ?? 0) < PAGE_SIZE) return rows
  }
}

/**
 * The three operating views consume the same activity history. A very short
 * shared snapshot prevents duplicate Supabase scans during navigation while
 * keeping externally-created calls and messages effectively live.
 */
export const readConversationActivitySnapshot = unstable_cache(
  fetchConversationActivitySnapshot,
  ['conversation-activity-snapshot-v1'],
  {
    revalidate: 5,
    tags: [CONVERSATION_ACTIVITY_CACHE_TAG],
  },
)
