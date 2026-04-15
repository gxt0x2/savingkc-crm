/**
 * Eager briefing regeneration helper.
 * Called server-side after high-value events to ensure briefings
 * are fresh before any agent views the lead.
 *
 * Includes a 60-second cooldown per lead to prevent thundering herd
 * when multiple updates happen in rapid succession.
 */

const COOLDOWN_MS = 60_000 // 60 seconds
const regenTimestamps = new Map<string, number>() // leadId → last regen epoch

// High-value events that trigger immediate briefing regeneration
export const EAGER_REGEN_EVENTS = new Set([
  'transcript_added',
  'appointment_set',
  'deal_potential',
  'offer_made',
  'not_interested',
  'dead',
])

/**
 * Regenerate the Ari briefing for a lead if cooldown has elapsed.
 * Fire-and-forget — errors are logged but never thrown to callers.
 *
 * @param leadId  - The lead UUID
 * @param reason  - Event that triggered regen (for audit trail)
 * @param force   - Skip cooldown check
 */
export async function regenerateBriefing(
  leadId: string,
  reason: string,
  force = false,
): Promise<boolean> {
  // Cooldown check
  const lastRegen = regenTimestamps.get(leadId) || 0
  const elapsed = Date.now() - lastRegen
  if (!force && elapsed < COOLDOWN_MS) {
    console.log(`[briefing-regen] Cooldown active for ${leadId} (${Math.round(elapsed / 1000)}s < 60s), skipping. trigger=${reason}`)
    return false
  }

  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Find the manifest for this lead
    const { data: manifestRow } = await supabase
      .from('manifests')
      .select('id')
      .eq('lead_id', leadId)
      .single()

    if (!manifestRow) {
      console.log(`[briefing-regen] No manifest for lead ${leadId}, skipping`)
      return false
    }

    // Set timestamp before call to prevent concurrent triggers
    regenTimestamps.set(leadId, Date.now())

    // Call the generate-briefing endpoint internally
    // Use the internal API to reuse all existing generation + caching logic
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'
    const res = await fetch(`${baseUrl}/api/ari/generate-briefing?manifestId=${manifestRow.id}`, {
      headers: { 'x-regen-reason': reason },
    })

    if (res.ok) {
      console.log(`[briefing-regen] Regenerated briefing for lead ${leadId} (trigger=${reason})`)
      return true
    } else {
      console.error(`[briefing-regen] Failed for lead ${leadId}: ${res.status}`)
      return false
    }
  } catch (err) {
    console.error(`[briefing-regen] Error for lead ${leadId}:`, err)
    return false
  }
}
