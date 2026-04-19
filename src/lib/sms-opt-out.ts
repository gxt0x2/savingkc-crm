import { supabase } from '@/lib/supabase-lazy'

/**
 * TCPA Opt-Out Compliance
 * Handles STOP/START keyword processing and opt-out state management
 */





const STOP_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'STOPALL']
const START_KEYWORDS = ['START', 'UNSTOP']

export function isStopKeyword(text: string): boolean {
  return STOP_KEYWORDS.includes(text.trim().toUpperCase())
}

export function isStartKeyword(text: string): boolean {
  return START_KEYWORDS.includes(text.trim().toUpperCase())
}

/**
 * Check if a phone number is opted out
 */
export async function isOptedOut(phone: string): Promise<boolean> {
  const { data } = await supabase
    .from('sms_opt_outs')
    .select('is_opted_out')
    .eq('phone', phone)
    .eq('is_opted_out', true)
    .single()

  return !!data
}

/**
 * Handle an opt-out request (STOP keyword)
 */
export async function handleOptOut(phone: string, keyword: string): Promise<void> {
  await supabase
    .from('sms_opt_outs')
    .upsert(
      {
        phone,
        is_opted_out: true,
        opted_out_at: new Date().toISOString(),
        reason: keyword.toUpperCase(),
      },
      { onConflict: 'phone' }
    )
}

/**
 * Handle an opt-in request (START keyword)
 */
export async function handleOptIn(phone: string): Promise<void> {
  await supabase
    .from('sms_opt_outs')
    .upsert(
      {
        phone,
        is_opted_out: false,
        opted_in_at: new Date().toISOString(),
        reason: null,
      },
      { onConflict: 'phone' }
    )
}
