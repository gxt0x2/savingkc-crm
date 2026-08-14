import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getClaims: mocks.getClaims } }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}))

import { getCurrentUserEmail, isCurrentUserAdmin } from './admin'

describe('server auth identity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads normalized email from proxy-verified session claims', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1', email: ' Casey@SavingKC.com ' } }, error: null })
    await expect(getCurrentUserEmail()).resolves.toBe('casey@savingkc.com')
  })

  it('returns null when claims are unavailable or invalid', async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error('invalid token') })
    await expect(getCurrentUserEmail()).resolves.toBeNull()
  })

  it('uses a supplied identity for admin review without repeating the claims lookup', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { is_admin: true } })

    await expect(isCurrentUserAdmin(' Ernest@SavingKC.com ')).resolves.toBe(true)
    expect(mocks.getClaims).not.toHaveBeenCalled()
  })
})
