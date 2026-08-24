import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  admin: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/supabase/env', () => ({
  getSupabaseUrl: () => 'https://project.supabase.co',
  getSupabasePublicKey: () => 'public-key',
}))

import { MobileAuthError, requireMobileActor } from './auth'

function request() {
  return new Request('https://crm.savingkc.com/api/mobile/v1/work', {
    headers: { Authorization: 'Bearer verified-token' },
  })
}

describe('mobile bearer actor resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockReturnValue({ auth: { getUser: mocks.getUser } })
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'CASEY@SAVINGKC.COM' } },
      error: null,
    })
    mocks.admin.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: mocks.maybeSingle }),
        }),
      }),
    })
    mocks.maybeSingle.mockResolvedValue({ data: { full_name: 'Casey Davis' }, error: null })
  })

  it('uses the verified bearer identity and server-owned profile label', async () => {
    await expect(requireMobileActor(request())).resolves.toMatchObject({
      actor: { email: 'casey@savingkc.com', name: 'Casey Davis' },
      user: { id: 'user-1' },
    })
    expect(mocks.getUser).toHaveBeenCalledWith('verified-token')
  })

  it('falls back to the server roster without trusting client actor fields', async () => {
    mocks.maybeSingle.mockRejectedValue(new Error('profile unavailable'))

    await expect(requireMobileActor(request())).resolves.toMatchObject({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
    })
  })

  it('rejects a bearer identity without a verified email', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: null } }, error: null })

    await expect(requireMobileActor(request())).rejects.toBeInstanceOf(MobileAuthError)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
