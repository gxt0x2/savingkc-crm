import type { LocalEmailChecks, MxResolver } from './local-checks'
import { localFlags } from './local-checks'
import type { EmailValidationProvider } from './provider'
import { ProviderCheckError } from './provider'
import {
  EMAIL_VALIDATION_RECHECK_MS,
  emailDomain,
  storageKey,
  syntaxValid,
  type EmailStatus,
  type EmailValidationProviderName,
} from './status'

export type StoredEmailValidation = {
  normalizedEmail: string
  emailStatus: EmailStatus
  checkedAt: string
  provider: EmailValidationProviderName | null
  rawResult: Record<string, unknown> | null
  isRole: boolean
  localChecks: LocalEmailChecks | Record<string, unknown>
}

export interface EmailValidationStore {
  find(email: string): Promise<StoredEmailValidation | null>
  save(row: StoredEmailValidation): Promise<void>
  reserveProviderCheck(cap: number): Promise<boolean>
  releaseProviderCheck(): Promise<void>
}

export type ValidationSkip = 'syntax' | 'disposable' | 'mx' | 'bounce' | 'recent' | 'no_key' | 'daily_cap' | null

export type EmailValidationDecision = {
  normalizedEmail: string | null
  emailStatus: EmailStatus
  provider: EmailValidationProviderName | null
  isRole: boolean
  skippedProvider: ValidationSkip
}

export type ValidateEmailDeps = {
  now?: Date
  store: EmailValidationStore
  provider?: EmailValidationProvider | null
  lookupMx?: MxResolver
  dailyCap?: number
  recheckMs?: number
}

function decision(row: Pick<StoredEmailValidation, 'normalizedEmail' | 'emailStatus' | 'provider' | 'isRole'>, skippedProvider: ValidationSkip): EmailValidationDecision {
  return {
    normalizedEmail: row.normalizedEmail,
    emailStatus: row.emailStatus,
    provider: row.provider,
    isRole: row.isRole,
    skippedProvider,
  }
}

async function persist(
  deps: ValidateEmailDeps,
  row: StoredEmailValidation,
  skippedProvider: ValidationSkip,
): Promise<EmailValidationDecision> {
  await deps.store.save(row)
  return decision(row, skippedProvider)
}

function freshProviderResult(existing: StoredEmailValidation, now: Date, recheckMs: number): boolean {
  if (existing.provider !== 'millionverifier') return false
  const checked = new Date(existing.checkedAt).getTime()
  return Number.isFinite(checked) && now.getTime() - checked < recheckMs
}

export async function validateEmail(raw: string | null | undefined, deps: ValidateEmailDeps): Promise<EmailValidationDecision> {
  const now = deps.now ?? new Date()
  const key = storageKey(raw)
  if (!key) {
    return { normalizedEmail: null, emailStatus: 'invalid', provider: null, isRole: false, skippedProvider: 'syntax' }
  }
  const checkedAt = now.toISOString()
  if (!syntaxValid(key)) {
    return persist(deps, {
      normalizedEmail: key,
      emailStatus: 'invalid',
      checkedAt,
      provider: 'local',
      rawResult: { reason: 'syntax' },
      isRole: false,
      localChecks: { syntax: 'invalid', disposable: false, role: false, mx: 'inconclusive' },
    }, 'syntax')
  }

  const existing = await deps.store.find(key)
  if (existing?.provider === 'bounce' && existing.emailStatus === 'invalid') {
    return decision(existing, 'bounce')
  }

  const disposableFlags = localFlags(key, 'inconclusive')
  if (disposableFlags.disposable) {
    return persist(deps, {
      normalizedEmail: key,
      emailStatus: 'disposable',
      checkedAt,
      provider: 'local',
      rawResult: { reason: 'disposable_domain' },
      isRole: disposableFlags.role,
      localChecks: disposableFlags,
    }, 'disposable')
  }

  const mx = await (deps.lookupMx ?? (async () => 'inconclusive' as const))(emailDomain(key))
  const flags = localFlags(key, mx)
  const base = {
    normalizedEmail: key,
    checkedAt,
    isRole: flags.role,
    localChecks: flags,
  }

  if (mx === 'absent') {
    return persist(deps, { ...base, emailStatus: 'invalid', provider: 'local', rawResult: { reason: 'mx' } }, 'mx')
  }
  const recheckMs = deps.recheckMs ?? EMAIL_VALIDATION_RECHECK_MS
  if (existing && freshProviderResult(existing, now, recheckMs)) {
    return decision(existing, 'recent')
  }
  if (!deps.provider) {
    if (existing?.provider === 'millionverifier') return decision(existing, 'no_key')
    return persist(deps, { ...base, emailStatus: 'unverified', provider: null, rawResult: { skipped: 'no_key' } }, 'no_key')
  }

  const cap = deps.dailyCap ?? 2000
  const reserved = cap > 0 && await deps.store.reserveProviderCheck(cap)
  if (!reserved) {
    if (existing?.provider === 'millionverifier') return decision(existing, 'daily_cap')
    return persist(deps, { ...base, emailStatus: 'unverified', provider: null, rawResult: { skipped: 'daily_cap' } }, 'daily_cap')
  }

  try {
    const verified = await deps.provider.verify(key)
    return persist(deps, {
      ...base,
      emailStatus: verified.status,
      provider: 'millionverifier',
      isRole: flags.role || verified.role,
      rawResult: verified.raw,
    }, null)
  } catch (error) {
    await deps.store.releaseProviderCheck().catch(() => undefined)
    const raw = error instanceof ProviderCheckError ? error.raw : { error: 'provider_unavailable' }
    if (existing?.provider === 'millionverifier') return decision(existing, null)
    return persist(deps, { ...base, emailStatus: 'unknown', provider: null, rawResult: raw }, null)
  }
}
