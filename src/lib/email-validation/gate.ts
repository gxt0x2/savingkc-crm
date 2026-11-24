import { supabaseAdmin } from '@/lib/supabase/admin'
import { isBadEmailStatus, storageKey, syntaxValid } from './status'

export type EmailStatusClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{
          data: { email_status?: string | null } | null
          error: { message?: string } | null
        }>
      }
    }
  }
}

/**
 * Known invalid and disposable addresses are blocked. A ledger outage does not
 * invent a bad status: the caller still has to send mail the ledger cannot read.
 * Syntax that cannot be stored is blocked without a lookup.
 */
export async function blockedEmailStatus(
  email: string,
  client?: EmailStatusClient,
): Promise<'invalid' | 'disposable' | null> {
  const key = storageKey(email)
  if (!key || !syntaxValid(key)) return 'invalid'
  try {
    const ledger = client ?? supabaseAdmin()
    const { data, error } = await ledger
      .from('email_address_validations')
      .select('email_status')
      .eq('normalized_email', key)
      .maybeSingle()
    if (error) {
      console.error('[email-validation] lookup failed', error.message)
      return null
    }
    const status = data?.email_status
    return isBadEmailStatus(status) ? status : null
  } catch (error) {
    console.error('[email-validation] lookup failed', error)
    return null
  }
}
