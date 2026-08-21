import { describe, expect, it } from 'vitest'

import { GET, POST } from './route'

describe('retired hot opportunities API', () => {
  it.each([
    ['GET', GET],
    ['POST', POST],
  ])('returns a no-store 410 for %s without running ranking work', async (_method, handler) => {
    const response = await handler()

    expect(response.status).toBe(410)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    await expect(response.json()).resolves.toEqual({
      error: 'HOT_OPPORTUNITIES_SURFACE_RETIRED',
      message: 'Hot Opps is now part of the Contacts workspace.',
      replacement: '/contacts?list=hot',
    })
  })
})
