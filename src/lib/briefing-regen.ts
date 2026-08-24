import { queueCanonicalLeadBriefing } from '@/lib/server/canonical-lead-briefing'

const COOLDOWN_MS = 60_000
const regenTimestamps = new Map<string, number>()

export const EAGER_REGEN_EVENTS = new Set([
  'transcript_added',
  'appointment_set',
  'deal_potential',
  'offer_made',
  'not_interested',
  'dead',
])

/**
 * Coalesce high-value CRM changes into the durable canonical briefing queue.
 * Provider I/O never occurs in the request that saved the seller evidence.
 */
export async function regenerateBriefing(
  leadId: string,
  reason: string,
  force = false,
): Promise<boolean> {
  const lastQueued = regenTimestamps.get(leadId) || 0
  if (!force && Date.now() - lastQueued < COOLDOWN_MS) return false

  try {
    await queueCanonicalLeadBriefing({
      leadId,
      reason,
      requestedBy: 'system:event',
      delaySeconds: force ? 0 : 60,
    })
    regenTimestamps.set(leadId, Date.now())
    return true
  } catch (error) {
    console.error('[briefing-regen] queue failed', {
      reason,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
    return false
  }
}
