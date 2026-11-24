import { supabase } from '@/lib/supabase-lazy'

/**
 * Journey stitching. The website sends a per-tab session_id and a one-year
 * visitor_id (skc_vid) with every journey event and with form and booking
 * posts. Linking those events to the lead lets the lead record show every
 * visit before it, and lets qualified / appointment conversions find the ad
 * click (loadPpcLeadConversionContext reads ppc_tracking_events by lead_id).
 *
 * Only unclaimed events are linked; a lead never takes another lead's events.
 * Best-effort: intake must never fail because stitching failed.
 */

const ID_RE = /^[A-Za-z0-9-]{8,64}$/

export function cleanJourneyId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return ID_RE.test(trimmed) ? trimmed : null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** visitor_id from a form or booking body: top level, then touch, then attribution. */
export function visitorIdFromBody(body: unknown): string | null {
  const b = record(body)
  return (
    cleanJourneyId(b.visitor_id) ||
    cleanJourneyId(record(b.touch).visitor_id) ||
    cleanJourneyId(record(b.attribution).visitor_id)
  )
}

export async function linkJourneyToLead(input: {
  leadId: string
  sessionId?: string | null
  visitorId?: string | null
}): Promise<number> {
  const sessionId = cleanJourneyId(input.sessionId)
  const visitorId = cleanJourneyId(input.visitorId)
  if (!input.leadId || (!sessionId && !visitorId)) return 0
  try {
    const { data, error } = await supabase.rpc('link_journey_to_lead_v1', {
      p_lead_id: input.leadId,
      p_session_id: sessionId,
      p_visitor_id: visitorId,
    })
    if (error) {
      console.error('[journey-link] link failed:', error.message)
      return 0
    }
    return typeof data === 'number' ? data : 0
  } catch (err) {
    console.error('[journey-link] link threw:', err)
    return 0
  }
}
