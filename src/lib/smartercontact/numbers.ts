/**
 * Number-pool management for SmarterContact deliverability.
 *
 * A pool of sending numbers spreads volume so no single number trips carrier
 * spam filters. We track per-number health (block rate, daily volume) and:
 *   - rotate sends across the healthiest, least-used active numbers,
 *   - keep replies "sticky" to the number a conversation already uses,
 *   - auto-pause numbers whose block rate crosses a threshold.
 */
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface SendingNumber {
  id: string
  phone: string
  label: string | null
  type: 'local' | 'toll_free'
  status: 'active' | 'paused' | 'warming' | 'released'
  sms_sent: number
  sms_delivered: number
  sms_blocked: number
  active_chats: number
  daily_sent: number
  daily_cap: number
  daily_reset_on: string | null
  last_used_at: string | null
}

/** Block rate = blocked / sent. Returns 0 with no volume. */
export function blockRate(n: Pick<SendingNumber, 'sms_sent' | 'sms_blocked'>): number {
  if (!n.sms_sent) return 0
  return n.sms_blocked / n.sms_sent
}

/** Numbers with at least this many sends and block rate above this are auto-paused. */
export const AUTO_PAUSE_MIN_SENT = 50
export const AUTO_PAUSE_BLOCK_RATE = 0.1 // 10%

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Fetch all sending numbers, optionally filtered by status. */
export async function listSendingNumbers(status?: SendingNumber['status']): Promise<SendingNumber[]> {
  const db = supabaseAdmin()
  let q = db.from('sc_sending_numbers').select('*').order('daily_sent', { ascending: true })
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw new Error(`listSendingNumbers: ${error.message}`)
  return (data || []) as SendingNumber[]
}

/**
 * Reset daily_sent counters for numbers whose daily_reset_on is not today.
 * Idempotent; call before a send batch.
 */
export async function resetDailyCountersIfNeeded(): Promise<void> {
  const db = supabaseAdmin()
  await db
    .from('sc_sending_numbers')
    .update({ daily_sent: 0, daily_reset_on: today() })
    .neq('daily_reset_on', today())
}

/**
 * Numbers eligible to send right now: active, under daily cap, not over the
 * block-rate threshold. Sorted by least-used (daily_sent asc, then oldest
 * last_used_at) for even rotation.
 */
export async function eligibleNumbers(poolIds?: string[]): Promise<SendingNumber[]> {
  const all = await listSendingNumbers('active')
  const filtered = all.filter((n) => {
    if (poolIds && poolIds.length && !poolIds.includes(n.id)) return false
    if (n.daily_sent >= n.daily_cap) return false
    if (n.sms_sent >= AUTO_PAUSE_MIN_SENT && blockRate(n) >= AUTO_PAUSE_BLOCK_RATE) return false
    return true
  })
  filtered.sort((a, b) => {
    if (a.daily_sent !== b.daily_sent) return a.daily_sent - b.daily_sent
    const at = a.last_used_at ? Date.parse(a.last_used_at) : 0
    const bt = b.last_used_at ? Date.parse(b.last_used_at) : 0
    return at - bt
  })
  return filtered
}

/**
 * Pick the next number to send from. `poolIds` restricts to a campaign's
 * chosen subset. Returns null if nothing is eligible (all capped/paused).
 */
export async function pickSendingNumber(poolIds?: string[]): Promise<SendingNumber | null> {
  const eligible = await eligibleNumbers(poolIds)
  return eligible[0] ?? null
}

/**
 * Record a send against a number: atomically bump sms_sent + daily_sent and
 * set last_used_at (daily counter resets on date rollover inside the RPC).
 */
export async function recordSendOnNumber(numberId: string): Promise<void> {
  const db = supabaseAdmin()
  const { error } = await db.rpc('sc_number_record_send', { p_number_id: numberId })
  if (error) throw new Error(`recordSendOnNumber: ${error.message}`)
}

/** Atomically record a send against a number identified by its phone. */
export async function recordSendByPhone(phone: string): Promise<void> {
  const db = supabaseAdmin()
  const { error } = await db.rpc('sc_number_record_send_by_phone', { p_phone: phone })
  if (error) throw new Error(`recordSendByPhone: ${error.message}`)
}

/**
 * Record a delivery result by sending phone: atomically bump delivered/blocked
 * counters and auto-pause the number if its block rate crosses the threshold.
 */
export async function recordDeliveryResult(
  fromPhone: string,
  outcome: 'delivered' | 'blocked',
): Promise<void> {
  const db = supabaseAdmin()
  const { error } = await db.rpc('sc_number_record_result', {
    p_from_phone: fromPhone,
    p_delivered: outcome === 'delivered',
  })
  if (error) throw new Error(`recordDeliveryResult: ${error.message}`)
}
