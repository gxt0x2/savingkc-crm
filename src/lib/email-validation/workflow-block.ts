import type { Tx } from '@/lib/email/workflow/core'
import { isBadEmailStatus, storageKey } from './status'

/** Marketing enrollment and dispatch read the same ledger as list import. */
export async function emailBlockedInWorkflow(tx: Tx, email: string | null | undefined): Promise<boolean> {
  const key = storageKey(email)
  if (!key) return false
  const [row] = await tx<{ email_status: string }[]>`select email_status from email_address_validations where normalized_email=${key}`
  return isBadEmailStatus(row?.email_status)
}
