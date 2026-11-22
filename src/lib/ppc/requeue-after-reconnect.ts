import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Google accepts an offline click conversion only within 90 days of the click.
 * Conversions parked in dead_letter because the Google Ads login expired are
 * put back in the queue when Google Ads is reconnected, if still inside that
 * window. Older rows stay parked: Google would reject them.
 */
export const GOOGLE_CLICK_CONVERSION_WINDOW_DAYS = 90

export function requeueCutoffIso(now = new Date()): string {
  return new Date(now.getTime() - GOOGLE_CLICK_CONVERSION_WINDOW_DAYS * 86_400_000).toISOString()
}

export async function requeueGoogleAdsDeadLetters(db: SupabaseClient, now = new Date()): Promise<number> {
  const { data, error } = await db
    .from('ppc_conversion_outbox')
    .update({
      status: 'pending',
      attempts: 0,
      locked_at: null,
      last_error: `Requeued after Google Ads reconnect on ${now.toISOString().slice(0, 10)}.`,
      updated_at: now.toISOString(),
    })
    .eq('status', 'dead_letter')
    .eq('destination', 'google_ads')
    .gte('event_time', requeueCutoffIso(now))
    .select('id')
  if (error) {
    console.error('[ppc-requeue] requeue after reconnect failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}
