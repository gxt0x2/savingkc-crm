import { supabaseAdmin } from '@/lib/supabase/admin'
import type { LocalEmailChecks } from './local-checks'
import type { EmailStatus, EmailValidationProviderName } from './status'
import type { EmailValidationStore, StoredEmailValidation } from './validate'

type ValidationRow = {
  normalized_email: string
  email_status: EmailStatus
  checked_at: string
  provider: EmailValidationProviderName | null
  raw_result: Record<string, unknown> | null
  is_role: boolean
  local_checks: LocalEmailChecks | Record<string, unknown>
}

function fromRow(row: ValidationRow): StoredEmailValidation {
  return {
    normalizedEmail: row.normalized_email,
    emailStatus: row.email_status,
    checkedAt: row.checked_at,
    provider: row.provider,
    rawResult: row.raw_result,
    isRole: row.is_role,
    localChecks: row.local_checks ?? {},
  }
}

export function supabaseEmailValidationStore(db = supabaseAdmin()): EmailValidationStore {
  return {
    async find(email) {
      const { data, error } = await db
        .from('email_address_validations')
        .select('normalized_email,email_status,checked_at,provider,raw_result,is_role,local_checks')
        .eq('normalized_email', email)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ? fromRow(data as ValidationRow) : null
    },
    async save(row) {
      const { error } = await db.from('email_address_validations').upsert({
        normalized_email: row.normalizedEmail,
        email_status: row.emailStatus,
        checked_at: row.checkedAt,
        provider: row.provider,
        raw_result: row.rawResult,
        is_role: row.isRole,
        local_checks: row.localChecks,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'normalized_email' })
      if (error) throw new Error(error.message)
    },
    async reserveProviderCheck(cap) {
      const { data, error } = await db.rpc('reserve_email_validation_check_v1', { p_cap: cap })
      if (error) throw new Error(error.message)
      return data === true
    },
    async releaseProviderCheck() {
      const { error } = await db.rpc('release_email_validation_check_v1')
      if (error) throw new Error(error.message)
    },
  }
}
