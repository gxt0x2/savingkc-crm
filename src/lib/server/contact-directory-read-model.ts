import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface ContactDirectoryDatabase {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: { message?: string } | null
  }>
}

export interface ContactDirectoryCursor {
  id: string
  name: string
  lastActivityAt: string
  score: number
  attentionRank: number
}

export interface ContactDirectoryItem {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  source: string | null
  address: string | null
  city: string | null
  station: string
  classification: 'lead' | 'opportunity' | 'dead' | null
  dead_reason: string | null
  owner: string | null
  score: number
  is_favorite: boolean
  created_at: string | null
  updated_at: string | null
  pipeline_intent_source: string | null
  attention_state: 'needs_reply' | 'waiting_on_contact' | 'resolved'
  last_communication_id: string | null
  last_communication_type: string | null
  last_communication_description: string | null
  last_communication_agent: string | null
  last_communication_metadata: Record<string, unknown>
  last_communication_at: string | null
  last_activity_at: string
  primary_next_action_id: string | null
  primary_next_action_title: string | null
  primary_next_action_due_at: string | null
  primary_next_action_owner: string | null
  first_outbound_at: string | null
  outreach_status: 'unattempted' | 'attempted_no_response' | 'connected_unclassified'
  manifest: Record<string, unknown>
  entity_authority: 'canonical_entities' | 'lead_compatibility'
}

interface ContactDirectoryRpcRow {
  items?: unknown
  total_count?: unknown
  has_more?: unknown
  next_cursor?: unknown
  scope_counts?: unknown
  smart_list_counts?: unknown
  owners?: unknown
  sources?: unknown
  tags?: unknown
}

export interface ContactDirectoryPage {
  items: ContactDirectoryItem[]
  totalCount: number
  hasMore: boolean
  nextCursor: string | null
  scopeCounts: { active: number; prospects: number; not_leads: number }
  smartListCounts: Record<string, number>
  facets: { owners: string[]; sources: string[]; tags: string[] }
}

export interface ContactDirectoryQuery {
  smartList: string
  scope: string
  limit: number
  cursor: ContactDirectoryCursor | null
  sort: string
  search: string
  owner: string
  stage: string
  minimumStage: string
  source: string
  tag: string
  activity: string
  attention: string
  outreach: string
  dataGap: string
  referenceTime: string
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([key, count]) => [key, Number(count) || 0]))
}

export function encodeContactDirectoryCursor(cursor: ContactDirectoryCursor | null): string | null {
  return cursor ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : null
}

export function decodeContactDirectoryCursor(value: string | null): ContactDirectoryCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ContactDirectoryCursor>
    if (
      !decoded.id || !UUID_PATTERN.test(decoded.id)
      || typeof decoded.name !== 'string'
      || typeof decoded.lastActivityAt !== 'string' || Number.isNaN(Date.parse(decoded.lastActivityAt))
      || typeof decoded.score !== 'number' || !Number.isFinite(decoded.score)
      || typeof decoded.attentionRank !== 'number' || !Number.isInteger(decoded.attentionRank)
    ) return null
    return decoded as ContactDirectoryCursor
  } catch {
    return null
  }
}

export async function readContactDirectoryPage(
  query: ContactDirectoryQuery,
  db: ContactDirectoryDatabase = supabaseAdmin(),
): Promise<ContactDirectoryPage> {
  const { data, error } = await db.rpc('contact_workspace_page_v2', {
    target_smart_list: query.smartList,
    target_scope: query.scope,
    target_limit: query.limit,
    page_cursor: query.cursor,
    target_sort: query.sort,
    search_text: query.search,
    owner_filter: query.owner,
    stage_filter: query.stage,
    minimum_stage_filter: query.minimumStage,
    source_filter: query.source,
    tag_filter: query.tag,
    activity_filter: query.activity,
    attention_filter: query.attention,
    outreach_filter: query.outreach,
    data_gap_filter: query.dataGap,
    reference_time: query.referenceTime,
  })
  if (error) {
    console.error('Contact directory page query failed', { message: error.message })
    throw new Error('Contact directory could not be loaded')
  }

  const row = (Array.isArray(data) ? data[0] : data) as ContactDirectoryRpcRow | null
  const scopeCounts = numberRecord(row?.scope_counts)
  return {
    items: (Array.isArray(row?.items) ? row.items : []) as ContactDirectoryItem[],
    totalCount: Number(row?.total_count) || 0,
    hasMore: row?.has_more === true,
    nextCursor: encodeContactDirectoryCursor(
      row?.next_cursor && typeof row.next_cursor === 'object'
        ? row.next_cursor as ContactDirectoryCursor
        : null,
    ),
    scopeCounts: {
      active: scopeCounts.active ?? 0,
      prospects: scopeCounts.prospects ?? 0,
      not_leads: scopeCounts.not_leads ?? 0,
    },
    smartListCounts: numberRecord(row?.smart_list_counts),
    facets: {
      owners: stringArray(row?.owners),
      sources: stringArray(row?.sources),
      tags: stringArray(row?.tags),
    },
  }
}
