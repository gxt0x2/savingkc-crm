import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

describe('GET /api/oauth/authorize', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('redirects to Supabase while removing the unsupported resource indicator', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co/')
    const request = new Request(
      'https://crm.savingkc.com/api/oauth/authorize?response_type=code&client_id=grok&scope=email%20offline_access&code_challenge=test&resource=https%3A%2F%2Fcrm.savingkc.com%2Fapi%2Fmcp',
    )

    const response = GET(request)
    const location = new URL(response.headers.get('location') || '')

    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(location.origin).toBe('https://project.supabase.co')
    expect(location.pathname).toBe('/auth/v1/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe('grok')
    expect(location.searchParams.get('scope')).toBe('email offline_access')
    expect(location.searchParams.get('code_challenge')).toBe('test')
    expect(location.searchParams.has('resource')).toBe(false)
  })
})
