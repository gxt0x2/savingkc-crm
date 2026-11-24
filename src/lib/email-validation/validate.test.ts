import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { emailValidationProviderFromEnv } from './from-env'
import { createMillionVerifier, millionVerifierFromEnv } from './millionverifier'
import { ProviderCheckError } from './provider'
import type { EmailValidationProvider, PaidEmailValidationProviderName } from './provider'
import type { StoredEmailValidation } from './validate'
import { validateEmail, type EmailValidationStore } from './validate'
import { coldLedgerReviewReasons } from './cold-send'
import { createZeroBounce } from './zerobounce'
import { EMAIL_VALIDATION_RECHECK_MS, emailValidationDailyCap, isBadEmailStatus } from './status'

function memoryStore(seed: StoredEmailValidation[] = []) {
  const rows = new Map(seed.map((row) => [row.normalizedEmail, row]))
  let reserved = 0
  const store: EmailValidationStore = {
    async find(email) {
      return rows.get(email) ?? null
    },
    async save(row) {
      rows.set(row.normalizedEmail, row)
    },
    async reserveProviderCheck(cap) {
      if (reserved >= cap) return false
      reserved += 1
      return true
    },
    async releaseProviderCheck() {
      reserved = Math.max(0, reserved - 1)
    },
  }
  return { store, rows, reservations: () => reserved }
}

function provider(
  status: 'valid' | 'invalid' | 'catch_all' | 'unknown' | 'disposable' = 'valid',
  role = false,
  id: PaidEmailValidationProviderName = 'zerobounce',
): EmailValidationProvider {
  return {
    id,
    verify: vi.fn(async () => ({ status, role, raw: { result: status } })),
  }
}

const present = async () => 'present' as const
const absent = async () => 'absent' as const

describe('email validation on import', () => {
  it('rejects an address that cannot be normalized and does not store it', async () => {
    const { store, rows } = memoryStore()
    const result = await validateEmail('not-an-email', { store, lookupMx: present, provider: provider() })
    expect(result).toMatchObject({ normalizedEmail: null, emailStatus: 'invalid', skippedProvider: 'syntax' })
    expect(rows.size).toBe(0)
  })

  it('stores a syntax failure as invalid without a provider call', async () => {
    const paid = provider()
    const { store, rows } = memoryStore()
    const result = await validateEmail('Ada@bad', { store, lookupMx: present, provider: paid })
    expect(result).toMatchObject({ normalizedEmail: 'ada@bad', emailStatus: 'invalid', provider: 'local', skippedProvider: 'syntax' })
    expect(paid.verify).not.toHaveBeenCalled()
    expect(rows.get('ada@bad')?.emailStatus).toBe('invalid')
  })

  it('marks a disposable domain without MX or a provider call', async () => {
    const paid = provider()
    const lookupMx = vi.fn(present)
    const { store } = memoryStore()
    const result = await validateEmail('person@mailinator.com', { store, lookupMx, provider: paid })
    expect(result).toMatchObject({ emailStatus: 'disposable', provider: 'local', skippedProvider: 'disposable' })
    expect(lookupMx).not.toHaveBeenCalled()
    expect(paid.verify).not.toHaveBeenCalled()
    expect(isBadEmailStatus(result.emailStatus)).toBe(true)
  })

  it('marks a domain with no exchanger as invalid', async () => {
    const paid = provider()
    const { store } = memoryStore()
    const result = await validateEmail('seller@missing.test', { store, lookupMx: absent, provider: paid })
    expect(result).toMatchObject({ emailStatus: 'invalid', provider: 'local', skippedProvider: 'mx' })
    expect(paid.verify).not.toHaveBeenCalled()
  })

  it('records a role address for cold-send review instead of mailing it', async () => {
    const paid = provider('valid')
    const freshChecked = new Date()
    const { store, rows } = memoryStore()
    const result = await validateEmail('Info@Example.com', { store, lookupMx: present, provider: paid, dailyCap: 10 })
    expect(result).toMatchObject({ normalizedEmail: 'info@example.com', emailStatus: 'valid', isRole: true, skippedProvider: null })
    expect(paid.verify).toHaveBeenCalledOnce()
    expect(rows.get('info@example.com')?.isRole).toBe(true)
    expect(isBadEmailStatus(result.emailStatus)).toBe(false)
    expect(coldLedgerReviewReasons({ emailStatus: result.emailStatus, checkedAt: freshChecked, isRole: true }, freshChecked)).toContain('Role mailbox needs review')
  })

  it('stores unverified when no provider key is configured', async () => {
    const { store } = memoryStore()
    const result = await validateEmail('seller@example.com', { store, lookupMx: present, provider: null })
    expect(result).toMatchObject({ emailStatus: 'unverified', provider: null, skippedProvider: 'no_key' })
    expect(isBadEmailStatus(result.emailStatus)).toBe(false)
  })

  it.each([
    ['valid', false],
    ['invalid', true],
    ['catch_all', false],
    ['unknown', false],
    ['disposable', true],
  ] as const)('stores provider status %s', async (status, bad) => {
    const { store } = memoryStore()
    const result = await validateEmail('seller@example.com', {
      store,
      lookupMx: present,
      provider: provider(status),
      dailyCap: 5,
    })
    expect(result.emailStatus).toBe(status)
    expect(result.provider).toBe('zerobounce')
    expect(isBadEmailStatus(result.emailStatus)).toBe(bad)
  })

  it('stores the selected adapter id', async () => {
    const { store } = memoryStore()
    const result = await validateEmail('seller@example.com', {
      store,
      lookupMx: present,
      provider: provider('valid', false, 'millionverifier'),
      dailyCap: 5,
    })
    expect(result.provider).toBe('millionverifier')
  })

  it('reuses a completed provider result for 30 days', async () => {
    const now = new Date('2026-11-14T00:00:00.000Z')
    const { store } = memoryStore([{
      normalizedEmail: 'seller@example.com',
      emailStatus: 'valid',
      checkedAt: new Date(now.getTime() - EMAIL_VALIDATION_RECHECK_MS).toISOString(),
      provider: 'millionverifier',
      rawResult: { result: 'ok' },
      isRole: false,
      localChecks: {},
    }])
    const paid = provider('invalid')
    const result = await validateEmail('seller@example.com', {
      store,
      lookupMx: present,
      provider: paid,
      now,
      dailyCap: 5,
    })
    expect(EMAIL_VALIDATION_RECHECK_MS).toBe(30 * 24 * 60 * 60 * 1000)
    expect(result).toMatchObject({ emailStatus: 'valid', provider: 'millionverifier', skippedProvider: 'recent' })
    expect(paid.verify).not.toHaveBeenCalled()
  })

  it('calls the provider again after 30 days', async () => {
    const now = new Date('2026-11-14T00:00:00.000Z')
    const { store } = memoryStore([{
      normalizedEmail: 'seller@example.com',
      emailStatus: 'unknown',
      checkedAt: new Date(now.getTime() - EMAIL_VALIDATION_RECHECK_MS - 1).toISOString(),
      provider: 'zerobounce',
      rawResult: { status: 'unknown' },
      isRole: false,
      localChecks: {},
    }])
    const paid = provider('valid')
    const result = await validateEmail('seller@example.com', {
      store,
      lookupMx: present,
      provider: paid,
      now,
      dailyCap: 5,
    })
    expect(result).toMatchObject({ emailStatus: 'valid', provider: 'zerobounce' })
    expect(paid.verify).toHaveBeenCalledOnce()
  })

  it('keeps a completed result when the key or daily cap is missing', async () => {
    const row: StoredEmailValidation = {
      normalizedEmail: 'seller@example.com',
      emailStatus: 'valid',
      checkedAt: '2026-01-01T00:00:00.000Z',
      provider: 'zerobounce',
      rawResult: { status: 'valid' },
      isRole: false,
      localChecks: {},
    }
    const noKey = memoryStore([row])
    const capped = memoryStore([row])
    const now = new Date('2026-11-14T00:00:00.000Z')
    await expect(validateEmail('seller@example.com', {
      store: noKey.store,
      lookupMx: present,
      provider: null,
      now,
    })).resolves.toMatchObject({ emailStatus: 'valid', provider: 'zerobounce', skippedProvider: 'no_key' })
    const paid = provider('invalid')
    await expect(validateEmail('seller@example.com', {
      store: capped.store,
      lookupMx: present,
      provider: paid,
      now,
      dailyCap: 0,
    })).resolves.toMatchObject({ emailStatus: 'valid', provider: 'zerobounce', skippedProvider: 'daily_cap' })
    expect(paid.verify).not.toHaveBeenCalled()
  })

  it('stops at the daily cap and leaves the address unverified', async () => {
    const { store, reservations } = memoryStore()
    const paid = provider()
    const result = await validateEmail('seller@example.com', {
      store,
      lookupMx: present,
      provider: paid,
      dailyCap: 0,
    })
    expect(result).toMatchObject({ emailStatus: 'unverified', skippedProvider: 'daily_cap' })
    expect(paid.verify).not.toHaveBeenCalled()
    expect(reservations()).toBe(0)
  })

  it('releases a reserved check when the provider fails and does not lock the address', async () => {
    const { store, reservations } = memoryStore()
    const paid: EmailValidationProvider = {
      id: 'zerobounce',
      verify: vi.fn(async () => { throw new ProviderCheckError('down', { error: 'provider_unavailable' }) }),
    }
    const result = await validateEmail('seller@example.com', { store, lookupMx: present, provider: paid, dailyCap: 2 })
    expect(result).toMatchObject({ emailStatus: 'unknown', provider: null })
    expect(reservations()).toBe(0)
  })

  it('keeps a completed result when a later provider check fails', async () => {
    const { store, reservations } = memoryStore([{
      normalizedEmail: 'seller@example.com',
      emailStatus: 'valid',
      checkedAt: '2026-01-01T00:00:00.000Z',
      provider: 'zerobounce',
      rawResult: { status: 'valid' },
      isRole: false,
      localChecks: {},
    }])
    const paid: EmailValidationProvider = {
      id: 'zerobounce',
      verify: vi.fn(async () => { throw new ProviderCheckError('down', { error: 'provider_unavailable' }) }),
    }
    const result = await validateEmail('seller@example.com', {
      store,
      lookupMx: present,
      provider: paid,
      now: new Date('2026-11-14T00:00:00.000Z'),
      dailyCap: 2,
    })
    expect(result).toMatchObject({ emailStatus: 'valid', provider: 'zerobounce' })
    expect(reservations()).toBe(0)
  })

  it('keeps a hard-bounce invalid result instead of paying for another check', async () => {
    const { store } = memoryStore([{
      normalizedEmail: 'seller@example.com',
      emailStatus: 'invalid',
      checkedAt: '2026-11-01T00:00:00.000Z',
      provider: 'bounce',
      rawResult: { source: 'resend', bounceType: 'Permanent' },
      isRole: false,
      localChecks: {},
    }])
    const paid = provider('valid')
    const result = await validateEmail('seller@example.com', { store, lookupMx: present, provider: paid, dailyCap: 5 })
    expect(result).toMatchObject({ emailStatus: 'invalid', provider: 'bounce', skippedProvider: 'bounce' })
    expect(paid.verify).not.toHaveBeenCalled()
  })

  it('uses a 2000 check default cap', () => {
    expect(emailValidationDailyCap({})).toBe(2000)
    expect(emailValidationDailyCap({ EMAIL_VALIDATION_DAILY_CAP: '50' })).toBe(50)
    expect(emailValidationDailyCap({ EMAIL_VALIDATION_DAILY_CAP: 'nope' })).toBe(2000)
  })
})

describe('provider selection', () => {
  it('does not call a provider when ZeroBounce is unset', () => {
    const fetcher = vi.fn()
    expect(emailValidationProviderFromEnv({}, fetcher)).toBeNull()
    expect(emailValidationProviderFromEnv({ ZEROBOUNCE_API_KEY: '   ' }, fetcher)).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses ZeroBounce unless MillionVerifier is selected', () => {
    const fetcher = vi.fn()
    expect(emailValidationProviderFromEnv({ ZEROBOUNCE_API_KEY: 'zb', MILLIONVERIFIER_API_KEY: 'mv' }, fetcher)?.id).toBe('zerobounce')
    expect(emailValidationProviderFromEnv({ EMAIL_VALIDATION_PROVIDER: 'ZeroBounce', ZEROBOUNCE_API_KEY: 'zb' }, fetcher)?.id).toBe('zerobounce')
    expect(emailValidationProviderFromEnv({
      EMAIL_VALIDATION_PROVIDER: 'millionverifier',
      MILLIONVERIFIER_API_KEY: 'mv',
      ZEROBOUNCE_API_KEY: 'zb',
    }, fetcher)?.id).toBe('millionverifier')
    expect(emailValidationProviderFromEnv({ EMAIL_VALIDATION_PROVIDER: 'millionverifier', ZEROBOUNCE_API_KEY: 'zb' }, fetcher)).toBeNull()
    expect(emailValidationProviderFromEnv({ EMAIL_VALIDATION_PROVIDER: 'other', ZEROBOUNCE_API_KEY: 'zb' }, fetcher)).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('stores the submitted address and does not apply did_you_mean', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch')
    const fetcher = vi.fn(async () => Response.json({
      address: 'seler@example.com',
      status: 'invalid',
      sub_status: 'possible_typo',
      did_you_mean: 'seller@example.com',
      firstname: 'Ada',
      catchall_domain: false,
    }))
    const { store, rows } = memoryStore()
    const result = await validateEmail('seler@example.com', {
      store,
      lookupMx: present,
      provider: createZeroBounce('test-key', fetcher),
      dailyCap: 5,
    })
    expect(result).toMatchObject({ normalizedEmail: 'seler@example.com', emailStatus: 'invalid', provider: 'zerobounce' })
    expect(rows.get('seler@example.com')?.rawResult).toMatchObject({ did_you_mean: 'seller@example.com' })
    expect(rows.get('seler@example.com')?.rawResult).not.toHaveProperty('firstname')
    expect(globalFetch).not.toHaveBeenCalled()
    globalFetch.mockRestore()
  })
})

describe('MillionVerifier adapter', () => {
  it('does not construct an adapter or call fetch when the key is unset', () => {
    const fetcher = vi.fn()
    expect(millionVerifierFromEnv({}, fetcher)).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('maps a mocked provider response and never calls global fetch', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch')
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      void input
      return Response.json({
        email: 'seller@example.com',
        quality: 'good',
        result: 'ok',
        resultcode: 1,
        subresult: '',
        free: false,
        role: false,
        credits: 10,
        executiontime: 1,
        error: '',
        livemode: true,
      })
    })
    const result = await createMillionVerifier('test-key', fetcher).verify('seller@example.com')
    expect(result.status).toBe('valid')
    const input = fetcher.mock.calls[0]?.[0]
    expect(input).toBeInstanceOf(URL)
    if (!(input instanceof URL)) throw new Error('MillionVerifier was not called with a URL')
    expect(input.origin).toBe('https://api.millionverifier.com')
    expect(input.searchParams.get('email')).toBe('seller@example.com')
    expect(input.searchParams.get('api')).toBe('test-key')
    expect(globalFetch).not.toHaveBeenCalled()
    globalFetch.mockRestore()
  })

  it.each([
    ['catch_all', 2, 'catch_all'],
    ['unknown', 3, 'unknown'],
    ['disposable', 5, 'disposable'],
    ['invalid', 6, 'invalid'],
  ] as const)('maps result %s', async (result, code, status) => {
    const fetcher = vi.fn(async () => Response.json({ result, resultcode: code, role: false }))
    await expect(createMillionVerifier('test-key', fetcher).verify('seller@example.com')).resolves.toMatchObject({ status })
  })

  it('stores didyoumean and does not apply it', async () => {
    expect((await createMillionVerifier('test-key', vi.fn(async () => Response.json({ result: 'invalid', resultcode: 6, didyoumean: 'seller@example.com', role: false }))).verify('seler@example.com')).raw.didyoumean).toBe('seller@example.com')
  })

  it('hides the api key when the provider request fails', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network https://api.millionverifier.com/api/v3/?api=test-key')
    })
    await expect(createMillionVerifier('test-key', fetcher).verify('seller@example.com')).rejects.toSatisfy((error: unknown) => {
      return error instanceof ProviderCheckError && !String(error.message).includes('test-key') && !JSON.stringify(error.raw).includes('test-key')
    })
  })
})

describe('email validation migration', () => {
  const sql = readFileSync('supabase/migrations/20261203120300_email_address_validation.sql', 'utf8')

  it('adds the ledger and the daily cap without deleting data', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.email_address_validations')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.email_validation_usage')
    expect(sql).toContain("email_status IN ('valid', 'invalid', 'catch_all', 'unknown', 'unverified', 'disposable')")
    expect(sql).toContain("provider IN ('local', 'millionverifier', 'zerobounce', 'bounce')")
    expect(sql).toContain('checked_at')
    expect(sql).toContain('raw_result')
    expect(sql).toContain('reserve_email_validation_check_v1')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS bounce_type')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE public.email_address_validations TO service_role')
    expect(sql).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i)
  })
})
