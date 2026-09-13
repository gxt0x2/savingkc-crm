import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkResendConnection } from '../connections/resend-check'
import { connectionMasterKey } from '../connections/service'
import { credentialKeyring, currentCredentialVersion } from '../secrets'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('Resend setup capability probe', () => {
  it('uses only fixed read endpoints and never treats them as a sending check', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const result = await checkResendConnection('re_fixture_key')
    expect(
      fetcher.mock.calls.map((c) => (c as unknown as [string])[0]),
    ).toEqual([
      'https://api.resend.com/domains?limit=1',
      'https://api.resend.com/emails/receiving?limit=1',
    ])
    for (const call of fetcher.mock.calls) {
      const init = (call as unknown as [string, RequestInit])[1]
      expect(init.redirect).toBe('error')
      expect(init.method).toBeUndefined()
    }
    expect(result.sendingVerified).toBe(false)
  })
  it.each([
    [401, 'SERVICE_KEY_INVALID'],
    [403, 'SERVICE_SCOPE_REQUIRED'],
    [429, 'SERVICE_RATE_LIMIT'],
    [500, 'SERVICE_CHECK_FAILED'],
  ])(
    'maps HTTP %s without exposing the response body',
    async (status, code) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response('private provider data', { status: status as number }),
        ),
      )
      await expect(
        checkResendConnection('re_fixture_key'),
      ).rejects.toMatchObject({ code })
    },
  )
  it('rejects redirects and network errors without exposing request details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Authorization: private')
      }),
    )
    await expect(checkResendConnection('re_fixture_key')).rejects.toMatchObject(
      { code: 'SERVICE_UNREACHABLE' },
    )
  })
  it('requires a complete server-only encryption key', () => {
    vi.stubEnv('EMAIL_CREDENTIALS_KEY_V1', 'short')
    expect(connectionMasterKey()).toBeNull()
    vi.stubEnv('EMAIL_CREDENTIALS_KEY_V1', 'ab'.repeat(32))
    expect(connectionMasterKey()?.length).toBe(32)
  })
  it('selects the newest configured credential version without dropping older keys', () => {
    vi.stubEnv('EMAIL_CREDENTIALS_KEY_V1', 'ab'.repeat(32))
    vi.stubEnv('EMAIL_CREDENTIALS_KEY_V2', 'cd'.repeat(32))
    const keys = credentialKeyring()
    expect(currentCredentialVersion(keys)).toBe(2)
    expect(keys.get(1)?.equals(Buffer.from('ab'.repeat(32), 'hex'))).toBe(true)
    expect(connectionMasterKey()?.equals(keys.get(2)!)).toBe(true)
  })
})
