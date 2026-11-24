import { describe, expect, it, vi } from 'vitest'
import { LEDGER_REVIEW_REASON, ROLE_REVIEW_REASON, ledgerReadyForColdSend, coldLedgerReviewReasons } from './cold-send'
import { ProviderCheckError } from './provider'
import { isBadEmailStatus } from './status'
import { createZeroBounce, mapZeroBounceResult, zeroBounceFromEnv } from './zerobounce'

const now = new Date('2026-11-14T00:00:00.000Z')
const checkedAt = now.toISOString()

function outcome(body: Record<string, unknown>) {
  const mapped = mapZeroBounceResult(body)
  const ledger = { emailStatus: mapped.status, checkedAt, isRole: mapped.role }
  return {
    mapped,
    ready: ledgerReadyForColdSend(ledger, now),
    reasons: coldLedgerReviewReasons(ledger, now),
    blocked: isBadEmailStatus(mapped.status),
  }
}

describe('ZeroBounce mapping', () => {
  it('keeps a clean valid address Ready', () => {
    for (const sub_status of ['', 'alias_address', 'leading_period_removed', 'alternate', 'gold', 'accept_all', 'ai_agent_mailbox']) {
      const result = outcome({ status: 'valid', sub_status, catchall_domain: false, did_you_mean: 'other@example.com' })
      expect(result.mapped.status, sub_status).toBe('valid')
      expect(result.ready, sub_status).toBe(true)
      expect(result.reasons, sub_status).toEqual([])
      expect(result.mapped.raw.did_you_mean).toBe('other@example.com')
    }
  })

  it.each(['invalid', 'spamtrap', 'abuse', 'do_not_mail'])('hard-blocks %s', (status) => {
    const result = outcome({ status, sub_status: status === 'do_not_mail' ? 'possible_trap' : 'mailbox_not_found' })
    expect(result.mapped.status).toBe('invalid')
    expect(result.blocked).toBe(true)
    expect(result.ready).toBe(false)
  })

  it('hard-blocks do_not_mail even when the sub_status is disposable', () => {
    expect(mapZeroBounceResult({ status: 'do_not_mail', sub_status: 'disposable' })).toMatchObject({
      status: 'invalid',
      role: false,
    })
  })

  it.each([
    ['catch-all', '', 'catch_all'],
    ['unknown', 'greylisted', 'unknown'],
    ['valid', 'toxic', 'unknown'],
    ['valid', 'mx_forward', 'unknown'],
    ['valid', 'possible_typo', 'unknown'],
    ['valid', 'not_a_real_substatus', 'unknown'],
  ] as const)('sends %s/%s to review as %s', (status, sub_status, expected) => {
    const result = outcome({ status, sub_status, catchall_domain: false })
    expect(result.mapped.status).toBe(expected)
    expect(result.reasons).toContain(LEDGER_REVIEW_REASON)
    expect(result.ready).toBe(false)
    expect(result.blocked).toBe(false)
  })

  it('excludes role, disposable, possible_trap, and the catch-all flag when status is valid', () => {
    const role = outcome({ status: 'valid', sub_status: 'role_based', catchall_domain: false })
    expect(role.mapped).toMatchObject({ status: 'unknown', role: true })
    expect(role.reasons).toEqual(expect.arrayContaining([LEDGER_REVIEW_REASON, ROLE_REVIEW_REASON]))
    expect(role.ready).toBe(false)

    const roleCatchAll = outcome({ status: 'valid', sub_status: 'role_based_catch_all', catchall_domain: false })
    expect(roleCatchAll.mapped).toMatchObject({ status: 'catch_all', role: true })
    expect(roleCatchAll.ready).toBe(false)
    expect(outcome({ status: 'valid', sub_status: 'role_based_accept_all', catchall_domain: false }).mapped).toMatchObject({
      status: 'catch_all',
      role: true,
    })

    const disposable = outcome({ status: 'valid', sub_status: 'disposable', catchall_domain: false })
    expect(disposable.mapped.status).toBe('disposable')
    expect(disposable.blocked).toBe(true)
    expect(disposable.ready).toBe(false)

    const trap = outcome({ status: 'valid', sub_status: 'possible_trap', catchall_domain: false })
    expect(trap.mapped).toMatchObject({ status: 'unknown', role: false })
    expect(trap.reasons).toContain(LEDGER_REVIEW_REASON)
    expect(trap.ready).toBe(false)

    for (const catchall_domain of [true, 'true']) {
      const flagged = outcome({ status: 'valid', sub_status: '', catchall_domain })
      expect(flagged.mapped.status).toBe('catch_all')
      expect(flagged.ready).toBe(false)
    }
    expect(outcome({ status: 'valid', sub_status: 'accept_all', catchall_domain: true }).mapped.status).toBe('catch_all')
  })

  it('does not store demographic enrichment', () => {
    const mapped = mapZeroBounceResult({
      status: 'valid',
      sub_status: null,
      firstname: 'Ada',
      lastname: 'Lovelace',
      gender: 'female',
      city: 'Kansas City',
      region: 'MO',
      zipcode: '64105',
      country: 'US',
      active_in_days: '30',
    })
    expect(mapped.status).toBe('valid')
    expect(mapped.raw).not.toHaveProperty('firstname')
    expect(mapped.raw).not.toHaveProperty('lastname')
    expect(mapped.raw).not.toHaveProperty('gender')
    expect(mapped.raw).not.toHaveProperty('city')
    expect(mapped.raw).not.toHaveProperty('active_in_days')
  })

  it('rejects an unrecognized provider status instead of caching it', () => {
    expect(() => mapZeroBounceResult({ error: 'Invalid API Key' })).toThrow(ProviderCheckError)
    expect(() => mapZeroBounceResult({ status: 'error' })).toThrow(ProviderCheckError)
  })
})

describe('ZeroBounce adapter', () => {
  it('does not construct an adapter or call fetch when the key is unset', () => {
    const fetcher = vi.fn()
    expect(zeroBounceFromEnv({}, fetcher)).toBeNull()
    expect(zeroBounceFromEnv({ ZEROBOUNCE_API_KEY: '  ' }, fetcher)).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('posts only the key and email and never calls global fetch', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch')
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      address: 'seller@example.com',
      status: 'valid',
      sub_status: '',
      catchall_domain: false,
      did_you_mean: null,
    }))
    const result = await createZeroBounce('test-key', fetcher).verify('seller@example.com')
    expect(result).toMatchObject({ status: 'valid', role: false })
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0] ?? []
    expect(url).toBe('https://api.zerobounce.net/v2/validate')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded' })
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
    expect(form.get('api_key')).toBe('test-key')
    expect(form.get('email')).toBe('seller@example.com')
    expect([...form.keys()].sort()).toEqual(['api_key', 'email'])
    expect(String(url)).not.toContain('test-key')
    expect(globalFetch).not.toHaveBeenCalled()
    globalFetch.mockRestore()
  })

  it('hides the api key when the provider request fails', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network api_key=test-key')
    })
    await expect(createZeroBounce('test-key', fetcher).verify('seller@example.com')).rejects.toSatisfy((error: unknown) => {
      return error instanceof ProviderCheckError && !String(error.message).includes('test-key') && !JSON.stringify(error.raw).includes('test-key')
    })
  })

  it('does not persist an HTTP rejection as a completed status', async () => {
    const fetcher = vi.fn(async () => new Response('no', { status: 401 }))
    await expect(createZeroBounce('test-key', fetcher).verify('seller@example.com')).rejects.toBeInstanceOf(ProviderCheckError)
  })
})
