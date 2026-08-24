import { describe, expect, it } from 'vitest'

import { POST } from './route'

describe('retired Manifest bootstrap API', () => {
  it('returns a permanent canonical replacement without reading request data', async () => {
    const response = await POST()
    expect(response.status).toBe(410)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(response.json()).resolves.toMatchObject({
      replacement: '/api/workers/property-enrichment',
    })
  })
})

