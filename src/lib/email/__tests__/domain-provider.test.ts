import { afterEach, expect, it, vi } from 'vitest'
import { resendDomainProvider } from '../domains/provider'
afterEach(() => vi.unstubAllGlobals())
const domain = {
  id: '00000000-0000-4000-8000-000000000089',
  name: 'outreach-example.com',
  status: 'not_started',
  capabilities: { sending: 'enabled', receiving: 'enabled' },
  records: [
    {
      record: 'DKIM',
      name: 'resend._domainkey',
      type: 'TXT',
      value: 'provider-value',
      status: 'not_started',
    },
  ],
}
it('requests receiving explicitly and returns only validated provider DNS values', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ ...domain, untrusted_extra: 'ignored' }),
  )
  vi.stubGlobal('fetch', fetcher)
  const result = await resendDomainProvider.create(
    're_fixture_key',
    domain.name,
  )
  const [url, options] = fetcher.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ]
  expect(url).toBe('https://api.resend.com/domains')
  expect(options.method).toBe('POST')
  expect(options.redirect).toBe('error')
  expect(JSON.parse(String(options.body)).capabilities).toEqual({
    sending: 'enabled',
    receiving: 'enabled',
  })
  expect(result.records[0].value).toBe('provider-value')
  expect(result).not.toHaveProperty('untrusted_extra')
})
it('rejects a response for a different domain ID', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(domain)),
  )
  await expect(
    resendDomainProvider.get(
      're_fixture_key',
      '00000000-0000-4000-8000-000000000090',
    ),
  ).rejects.toMatchObject({ code: 'DOMAIN_RESPONSE_INVALID' })
})
it('does not interpret an incomplete listing as an absent domain', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      data: [{ id: domain.id, name: 'unrelated.com' }],
      has_more: true,
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  await expect(
    resendDomainProvider.find('re_fixture_key', domain.name),
  ).rejects.toMatchObject({ code: 'DOMAIN_LIST_INCOMPLETE' })
  expect(fetcher).toHaveBeenCalledTimes(3)
})
it('reports a timed-out creation as uncertain without retrying it', async () => {
  const fetcher = vi.fn(async () => {
    throw Error('private provider error')
  })
  vi.stubGlobal('fetch', fetcher)
  await expect(
    resendDomainProvider.create('re_fixture_key', domain.name),
  ).rejects.toMatchObject({ code: 'DOMAIN_CREATE_UNCERTAIN' })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
