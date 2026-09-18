export type MobileEmailSender = {
  email: string
  from: string
}

function configuredSenderMap(): Map<string, string> {
  const entries = (process.env.CRM_MOBILE_EMAIL_SENDERS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const separator = entry.indexOf('=')
      if (separator < 1) return []
      const actor = entry.slice(0, separator).trim().toLowerCase()
      const sender = entry.slice(separator + 1).trim().toLowerCase()
      return actor && sender ? [[actor, sender] as const] : []
    })
  return new Map(entries)
}

/** Resolve an authenticated actor to an explicitly approved provider mailbox. */
export function resolveMobileEmailSender(actorEmail: string, actorName: string): MobileEmailSender | null {
  const normalizedActor = actorEmail.trim().toLowerCase()
  const mapped = configuredSenderMap().get(normalizedActor)
  const legacyDefault = process.env.RESEND_FROM_EMAIL?.trim().toLowerCase()
  const email = mapped || (legacyDefault === normalizedActor ? legacyDefault : null)
  if (!email) return null
  const safeName = actorName.trim().replace(/[<>\r\n]/g, '') || normalizedActor
  return { email, from: `${safeName} at SavingKC <${email}>` }
}
