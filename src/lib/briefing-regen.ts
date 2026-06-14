/**
 * Eager briefing regeneration helper.
 * Called server-side after high-value events to ensure briefings
 * are fresh before any agent views the lead.
 *
 * Includes a 60-second cooldown per lead to prevent thundering herd
 * when multiple updates happen in rapid succession.
 */

import { getSupabaseAdminKey, getSupabaseUrl } from './supabase/env'

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

function getBriefingRegenBaseUrl(port: string): string {
  if (process.env.BRIEFING_REGEN_URL) return process.env.BRIEFING_REGEN_URL

  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''

  if (process.env.VERCEL === '1' || vercelUrl) {
    return publicAppUrl || vercelUrl
  }

  if (publicAppUrl && !publicAppUrl.includes('localhost')) {
    return `http://localhost:${port}`
  }

  return publicAppUrl || `http://localhost:${port}`
}

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
      getSupabaseUrl(),
      getSupabaseAdminKey(),
      { auth: { autoRefreshToken: false, persistSession: false } },
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

    // PM2 should call localhost to avoid Cloudflare loopbacks; Vercel must
    // call the public deployment URL because localhost is the function sandbox.
    const port = process.env.PORT || '3002'
    const baseUrl = getBriefingRegenBaseUrl(port)
    const authSecret =
      process.env.ADMIN_API_SECRET ||
      process.env.CRON_SECRET ||
      process.env.DEPLOY_SECRET ||
      ''

    const res = await fetch(`${baseUrl}/api/ari/generate-briefing?manifestId=${manifestRow.id}`, {
      headers: {
        'x-regen-reason': reason,
        ...(authSecret ? { authorization: `Bearer ${authSecret}` } : {}),
      },
    })

    if (res.ok) {
      // Only mark cooldown on success — failed attempts must be retryable
      // immediately, not blocked behind a 60s window the operator can't see.
      regenTimestamps.set(leadId, Date.now())
      console.log(`[briefing-regen] Regenerated briefing for lead ${leadId} (trigger=${reason})`)
      return true
    } else {
      const body = await res.text().catch(() => '')
      console.error(`[briefing-regen] Failed for lead ${leadId}: ${res.status} ${body.slice(0, 300)}`)
      return false
    }
  } catch (err) {
    console.error(`[briefing-regen] Error for lead ${leadId}:`, err)
    return false
  }
}
