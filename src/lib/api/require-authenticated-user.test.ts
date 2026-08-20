import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getClaims: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { requireAuthenticatedUser } from './require-authenticated-user'

describe('requireAuthenticatedUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockResolvedValue({ auth: { getClaims: mocks.getClaims } })
  })

  it('accepts a locally verified session subject without a remote user lookup', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: 'user-123' } }, error: null })

    await expect(requireAuthenticatedUser()).resolves.toBeNull()
    expect(mocks.getClaims).toHaveBeenCalledOnce()
  })

  it('fails closed when claims are missing or invalid', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: {} }, error: new Error('invalid token') })

    const response = await requireAuthenticatedUser({ success: false, error: 'Unauthorized' })

    expect(response?.status).toBe(401)
    await expect(response?.json()).resolves.toEqual({ success: false, error: 'Unauthorized' })
    expect(response?.headers.get('cache-control')).toContain('no-store')
  })

  it('fails closed when local verification cannot run', async () => {
    mocks.createClient.mockRejectedValue(new Error('cookie client unavailable'))

    const response = await requireAuthenticatedUser()

    expect(response?.status).toBe(401)
  })
})
