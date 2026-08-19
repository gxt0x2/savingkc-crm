import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOCUSEAL_UNAVAILABLE_MESSAGE } from '@/lib/docuseal-availability'
import { GET } from './route'

describe('DocuSeal status route', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reports disabled by default without caching the result', async () => {
    vi.stubEnv('DOCUSEAL_ENABLED', '')

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    await expect(response.json()).resolves.toEqual({
      enabled: false,
      message: DOCUSEAL_UNAVAILABLE_MESSAGE,
    })
  })

  it('reports enabled only for the explicit server flag', async () => {
    vi.stubEnv('DOCUSEAL_ENABLED', 'true')
    vi.stubEnv('DOCUSEAL_TOKEN', 'configured-token')
    vi.stubEnv('DOCUSEAL_WEBHOOK_SECRET', 'configured-secret')

    const response = await GET()

    await expect(response.json()).resolves.toEqual({ enabled: true, message: null })
  })

  it('stays disabled when the flag is true but required credentials are incomplete', async () => {
    vi.stubEnv('DOCUSEAL_ENABLED', 'true')
    vi.stubEnv('DOCUSEAL_TOKEN', 'configured-token')
    vi.stubEnv('DOCUSEAL_WEBHOOK_SECRET', '')

    const response = await GET()

    await expect(response.json()).resolves.toEqual({
      enabled: false,
      message: DOCUSEAL_UNAVAILABLE_MESSAGE,
    })
  })
})
