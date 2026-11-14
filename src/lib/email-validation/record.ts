import { lookupMailExchange } from './local-checks'
import { millionVerifierFromEnv } from './millionverifier'
import { emailValidationDailyCap, storageKey } from './status'
import { supabaseEmailValidationStore } from './store'
import { validateEmail, type EmailValidationStore } from './validate'

function uniqueKeys(emails: Array<string | null | undefined>): string[] {
  const keys = new Set<string>()
  const rejected: string[] = []
  for (const email of emails) {
    const key = storageKey(email)
    if (key) keys.add(key)
    else if (email?.trim()) rejected.push(email)
  }
  return [...keys, ...rejected]
}

/** Check every address a write is about to store. A ledger or provider failure is logged and does not discard the import. */
export async function recordWrittenEmails(
  emails: Array<string | null | undefined>,
  store?: EmailValidationStore,
): Promise<void> {
  const pending = uniqueKeys(emails)
  if (pending.length === 0) return
  let ledger: EmailValidationStore
  try {
    ledger = store ?? supabaseEmailValidationStore()
  } catch (error) {
    console.error('[email-validation] ledger unavailable', error)
    return
  }
  const provider = millionVerifierFromEnv()
  const dailyCap = emailValidationDailyCap()
  const workers = Array.from({ length: Math.min(8, pending.length) }, async () => {
    for (;;) {
      const email = pending.shift()
      if (!email) return
      try {
        await validateEmail(email, { store: ledger, provider, lookupMx: lookupMailExchange, dailyCap })
      } catch (error) {
        console.error('[email-validation] address was not recorded', error)
      }
    }
  })
  await Promise.all(workers)
}
