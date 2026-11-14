export const EMAIL_STATUSES = [
  'valid',
  'invalid',
  'catch_all',
  'unknown',
  'unverified',
  'disposable',
] as const

export type EmailStatus = (typeof EMAIL_STATUSES)[number]

export type EmailValidationProviderName = 'local' | 'millionverifier' | 'zerobounce' | 'bounce'

/** Invalid, disposable, and hard-bounced addresses (stored as invalid) are not mailable. */
export function isBadEmailStatus(status: string | null | undefined): status is 'invalid' | 'disposable' {
  return status === 'invalid' || status === 'disposable'
}

export function enrollmentBlockReason(status: string | null | undefined): string | null {
  if (!isBadEmailStatus(status)) return null
  return 'Email address cannot be mailed'
}

const LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Lowercase key safe to store. Null when the value cannot be an address key. */
export function storageKey(raw: string | null | undefined): string | null {
  if (!raw) return null
  let value = raw.trim().toLowerCase()
  if (value.startsWith('mailto:')) value = value.slice('mailto:'.length).trim()
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1).trim()
  if (value.length < 3 || value.length > 320) return null
  if (/\s/.test(value)) return null
  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@')) return null
  return value
}

export function syntaxValid(email: string): boolean {
  const at = email.lastIndexOf('@')
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (!local || !domain || local.length > 64 || domain.length > 255) return false
  return LOCAL.test(local) && DOMAIN.test(domain)
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1)
}

export function emailLocalPart(email: string): string {
  return email.slice(0, email.lastIndexOf('@')).split('+')[0] ?? ''
}

export const EMAIL_VALIDATION_RECHECK_MS = 90 * 24 * 60 * 60 * 1000
export const DEFAULT_EMAIL_VALIDATION_DAILY_CAP = 2000

export function emailValidationDailyCap(env: NodeJS.ProcessEnv | { EMAIL_VALIDATION_DAILY_CAP?: string } = process.env): number {
  const raw = (env as { EMAIL_VALIDATION_DAILY_CAP?: string }).EMAIL_VALIDATION_DAILY_CAP?.trim()
  if (!raw) return DEFAULT_EMAIL_VALIDATION_DAILY_CAP
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) return DEFAULT_EMAIL_VALIDATION_DAILY_CAP
  return value
}
