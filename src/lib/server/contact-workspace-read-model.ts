import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'

const RPC_BATCH_SIZE = 250

interface ContactWorkspaceDatabase {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: { message?: string } | null
  }>
}

export interface ContactWorkspaceActivitySummary {
  lead_id: string
  attention_state: 'needs_reply' | 'waiting_on_contact' | 'resolved' | null
  owner: string | null
  last_channel: string | null
  last_direction: string | null
  last_communication_id: string | null
  last_communication_type: string | null
  last_communication_description: string | null
  last_communication_agent: string | null
  last_communication_metadata: Record<string, unknown> | null
  last_communication_at: string | null
  last_activity_at: string | null
  primary_next_action_id: string | null
  primary_next_action_title: string | null
  primary_next_action_due_at: string | null
  primary_next_action_owner: string | null
  first_outbound_at: string | null
  has_outbound_attempt: boolean
  has_connected_call: boolean
  has_inbound_message: boolean
  pipeline_intent_activity_type: string | null
  pipeline_intent_metadata: Record<string, unknown> | null
}

function uniqueLeadIds(leadIds: string[]): string[] {
  return [...new Set(leadIds.filter(Boolean))]
}

export async function readContactWorkspaceActivitySummaries(
  leadIds: string[],
  db: ContactWorkspaceDatabase = supabaseAdmin(),
): Promise<Map<string, ContactWorkspaceActivitySummary>> {
  const ids = uniqueLeadIds(leadIds)
  if (ids.length === 0) return new Map()

  const batches: string[][] = []
  for (let offset = 0; offset < ids.length; offset += RPC_BATCH_SIZE) {
    batches.push(ids.slice(offset, offset + RPC_BATCH_SIZE))
  }

  const results = await Promise.all(batches.map(async (batch) => {
    const { data, error } = await db.rpc('contact_workspace_activity_summary_v1', {
      target_lead_ids: batch,
    })
    if (error) {
      console.error('Contact workspace summary query failed', { message: error.message })
      throw new Error('Contact activity summary could not be loaded')
    }
    return (Array.isArray(data) ? data : []) as ContactWorkspaceActivitySummary[]
  }))

  return new Map(results.flat().map((row) => [row.lead_id, row]))
}
