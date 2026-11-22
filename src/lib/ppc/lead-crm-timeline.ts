import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The CRM side of a lead's journey (G5): lead creation, calls, texts, notes,
 * stage changes, appointments, ad conversions and deal outcomes, read from
 * the lead_journey_timeline view. Web events come from lead-journey.ts.
 */
export type CrmStep = { at: string; kind: string; event: string; detail: string | null }

type TimelineRow = { occurred_at: string; kind: string; event: string | null; detail: string | null }

/** Bookkeeping rows that say nothing about the seller's path. */
const NOISE = new Set(['reprocess', 'sod_submission', 'eod_submission', 'profile_update', 'mojo_review'])

export function buildCrmTimeline(rows: TimelineRow[], limit = 80): CrmStep[] {
  return rows
    .filter((row) => row.kind !== 'web' && row.event && !NOISE.has(row.event))
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
    .slice(-limit)
    .map((row) => ({
      at: row.occurred_at,
      kind: row.kind,
      event: row.event as string,
      detail: row.detail ? row.detail.replace(/\s+/g, ' ').trim().slice(0, 140) || null : null,
    }))
}

export async function loadLeadCrmTimeline(db: SupabaseClient, leadId: string): Promise<CrmStep[]> {
  const { data, error } = await db
    .from('lead_journey_timeline')
    .select('occurred_at, kind, event, detail')
    .eq('lead_id', leadId)
    .neq('kind', 'web')
    .order('occurred_at', { ascending: false })
    .limit(300)
  if (error) {
    console.error('[lead-crm-timeline] load failed:', error.message)
    return []
  }
  return buildCrmTimeline((data ?? []) as TimelineRow[])
}
