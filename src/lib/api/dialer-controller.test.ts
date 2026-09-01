import { describe, expect, it } from 'vitest'
import { dialerControllerFromRequest, invalidDialerControllerResponse } from './dialer-controller'

describe('dialer browser controller request identity', () => {
  it('accepts a UUID controller token and derives a non-secret device label', () => {
    const request = new Request('https://crm.savingkc.com/prospecting', {
      headers: {
        'X-Dialer-Controller': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/126.0.0.0 Safari/537.36',
      },
    })

    expect(dialerControllerFromRequest(request)).toEqual({
      token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      label: 'Chrome on Mac',
    })
  })

  it('rejects missing, malformed, and non-v4-compatible controller values', () => {
    expect(dialerControllerFromRequest(new Request('https://crm.savingkc.com/prospecting'))).toBeNull()
    expect(dialerControllerFromRequest(new Request('https://crm.savingkc.com/prospecting', {
      headers: { 'X-Dialer-Controller': 'shared-browser-name' },
    }))).toBeNull()
  })

  it('returns a private no-store recovery response without reflecting the token', async () => {
    const response = invalidDialerControllerResponse()

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ code: 'invalid_dialer_controller' })
  })
})
