/**
 * SMS 24-Hour Dedup Filter
 * Prevents sending the same message to the same number within 24 hours.
 * Uses SHA-256 hash of normalized body text.
 */

import { createHash } from 'crypto'
import { supabase } from '@/lib/supabase-lazy'



function hashBody(body: string): string {
  const normalized = body.trim().toLowerCase().replace(/\s+/g, ' ')
  return createHash('sha256').update(normalized).digest('hex')
}

/**
 * Check if an identical SMS was sent to this number in the last 24 hours
 */
export async function isDuplicateSms(toPhone: string, body: string): Promise<boolean> {
  const bodyHash = hashBody(body)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('sms_send_log')
    .select('id')
    .eq('to_phone', toPhone)
    .eq('body_hash', bodyHash)
    .gte('sent_at', twentyFourHoursAgo)
    .limit(1)

  return !!(data && data.length > 0)
}

/**
 * Log an SMS send for dedup tracking
 */
export async function logSmsSend(
  toPhone: string,
  body: string,
  fromPhone?: string,
  leadId?: string
): Promise<void> {
  const bodyHash = hashBody(body)
  await supabase.from('sms_send_log').insert({
    to_phone: toPhone,
    body_hash: bodyHash,
    from_phone: fromPhone || null,
    lead_id: leadId || null,
  })
}
