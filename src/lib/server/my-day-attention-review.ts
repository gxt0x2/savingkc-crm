import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { isUniqueViolation, stableWebhookActivityId } from '@/lib/telephony/webhook-idempotency'

const REVIEWABLE_OUTCOMES = ['callback_scheduled', 'meaningful_conversation', 'appointment_set']

export async function recordMyDayMojoReview(input: {
  recordId: string
  reviewedBy: string
}): Promise<{ recordId: string; reviewedAt: string } | null> {
  const db = supabaseAdmin()
  const { data: event, error: eventError } = await db
    .from('crm_mojo_call_events')
    .select('id, record_id, lead_id, disposition_raw, outcome')
    .eq('record_id', input.recordId)
    .eq('agent_key', 'casey')
    .in('outcome', REVIEWABLE_OUTCOMES)
    .maybeSingle()

  if (eventError) throw new Error(`Mojo review lookup failed: ${eventError.message}`)
  if (!event?.lead_id) return null

  const reviewedAt = new Date().toISOString()
  const { error: activityError } = await db.from('lead_activities').insert({
    id: stableWebhookActivityId('my-day-mojo-review', event.record_id),
    lead_id: event.lead_id,
    activity_type: 'mojo_review',
    description: 'Reviewed Mojo activity on a terminal CRM record',
    agent: input.reviewedBy,
    metadata: {
      source: 'my_day_mojo_review',
      provider: 'mojo',
      record_id: event.record_id,
      event_id: event.id,
      disposition: event.disposition_raw,
      reviewed_at: reviewedAt,
    },
  })
  if (activityError && !isUniqueViolation(activityError)) {
    throw new Error(`Mojo review could not be recorded: ${activityError.message}`)
  }

  return { recordId: event.record_id, reviewedAt }
}
