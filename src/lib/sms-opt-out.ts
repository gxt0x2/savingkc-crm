import { supabase } from '@/lib/supabase-lazy'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

/**
 * TCPA Opt-Out Compliance
 * Handles STOP/START keyword processing and opt-out state management
 */





const STOP_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'STOPALL']
const START_KEYWORDS = ['START', 'UNSTOP']

function canonicalPhone(phone: string): string {
  return normalizePhoneToE164(phone) ?? phone.trim()
}

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
  const { data, error } = await supabase
    .from('sms_opt_outs')
    .select('is_opted_out')
    .eq('phone', canonicalPhone(phone))
    .eq('is_opted_out', true)
    .maybeSingle()

  if (error) throw new Error('SMS suppression status could not be verified')

  return !!data
}

/**
 * Handle an opt-out request (STOP keyword)
 */
export async function handleOptOut(phone: string, keyword: string): Promise<void> {
  const { error } = await supabase
    .from('sms_opt_outs')
    .upsert(
      {
        phone: canonicalPhone(phone),
        is_opted_out: true,
        opted_out_at: new Date().toISOString(),
        reason: keyword.toUpperCase(),
      },
      { onConflict: 'phone' }
    )

  if (error) throw new Error('SMS opt-out could not be saved')
}

/**
 * Handle an opt-in request (START keyword)
 */
export async function handleOptIn(phone: string): Promise<void> {
  const { error } = await supabase
    .from('sms_opt_outs')
    .upsert(
      {
        phone: canonicalPhone(phone),
        is_opted_out: false,
        opted_in_at: new Date().toISOString(),
        reason: null,
      },
      { onConflict: 'phone' }
    )

  if (error) throw new Error('SMS opt-in could not be saved')
}
