import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ user: vi.fn(), actor: vi.fn(), admin: vi.fn(), profile: vi.fn(), assignment: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileUser: mocks.user,
}))
vi.mock('@/lib/assistant/auth', async (original) => ({
  ...await original<typeof import('@/lib/assistant/auth')>(),
  resolveAssistantActor: mocks.actor,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

import { requireAuthorizedMobileLead } from './authorized-lead'

describe('mobile lead authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ user: { email: 'casey@savingkc.com' } })
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', fullName: 'Casey Dodson', access: 'agent' })
    mocks.profile.mockResolvedValue({ data: { email: 'casey@savingkc.com', full_name: 'Casey Dodson' }, error: null })
    mocks.assignment.mockResolvedValue({ data: { id: 'lead-1', assigned_agent: 'Ernest' }, error: null })
    mocks.admin.mockReturnValue({ from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: () => table === 'agent_profiles'
      ? mocks.profile() : mocks.assignment() }) }) }) })
  })

  it('rejects an agent reading another operator’s lead', async () => {
    await expect(requireAuthorizedMobileLead(new Request('https://crm.savingkc.com', { headers: { Authorization: 'Bearer user' } }), 'lead-1'))
      .rejects.toMatchObject({ status: 403 })
  })

  it('allows a company-wide owner to read the lead', async () => {
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', fullName: 'Ernest', access: 'owner' })
    await expect(requireAuthorizedMobileLead(new Request('https://crm.savingkc.com', { headers: { Authorization: 'Bearer user' } }), 'lead-1'))
      .resolves.toMatchObject({ lead: { id: 'lead-1' } })
  })

  it('rejects a missing or blank registered agent profile', async () => {
    mocks.profile.mockResolvedValueOnce({ data: null, error: null })
    await expect(requireAuthorizedMobileLead(new Request('https://crm.savingkc.com'), 'lead-1'))
      .rejects.toMatchObject({ status: 403 })
    mocks.profile.mockResolvedValueOnce({ data: { email: 'casey@savingkc.com', full_name: ' ' }, error: null })
    await expect(requireAuthorizedMobileLead(new Request('https://crm.savingkc.com'), 'lead-1'))
      .rejects.toMatchObject({ status: 403 })
  })

  it('rejects a substring collision but accepts Casey’s exact trusted assignment alias', async () => {
    mocks.assignment.mockResolvedValueOnce({ data: { id: 'lead-1', assigned_agent: 'Casey-other' }, error: null })
    await expect(requireAuthorizedMobileLead(new Request('https://crm.savingkc.com'), 'lead-1'))
      .rejects.toMatchObject({ status: 403 })
    mocks.assignment.mockResolvedValueOnce({ data: { id: 'lead-1', assigned_agent: 'Casey' }, error: null })
    await expect(requireAuthorizedMobileLead(new Request('https://crm.savingkc.com'), 'lead-1'))
      .resolves.toMatchObject({ lead: { id: 'lead-1' } })
  })
})
