import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getClaims: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))

import { resolveAuthenticatedActor } from './authenticated-actor'

describe('resolveAuthenticatedActor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockResolvedValue({ auth: { getClaims: mocks.getClaims } })
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: 'user-123', email: 'CASEY@SAVINGKC.COM' } },
      error: null,
    })
    mocks.maybeSingle.mockResolvedValue({ data: { full_name: 'Casey' }, error: null })
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    })
  })

  it('uses locally verified claims and a server-owned profile name', async () => {
    await expect(resolveAuthenticatedActor()).resolves.toEqual({
      email: 'casey@savingkc.com',
      name: 'Casey',
    })
    expect(mocks.getClaims).toHaveBeenCalledOnce()
    expect(mocks.from).toHaveBeenCalledWith('agent_profiles')
  })

  it('rejects missing or unverifiable signed identity claims before profile access', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { email: 'casey@savingkc.com' } }, error: null })

    await expect(resolveAuthenticatedActor()).resolves.toBeNull()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('falls back to the verified email when no profile name is available', async () => {
    mocks.maybeSingle.mockRejectedValue(new Error('profile unavailable'))

    await expect(resolveAuthenticatedActor()).resolves.toEqual({
      email: 'casey@savingkc.com',
      name: 'casey@savingkc.com',
    })
  })
})
