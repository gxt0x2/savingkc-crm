import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ actor: vi.fn(), token: vi.fn(), configured: vi.fn() }))
vi.mock('@/lib/mobile-api/mobile-command-access', () => ({ requireMobileCommandActor: mocks.actor, MobileCommandAccessError: class extends Error {} }))
vi.mock('@/lib/gmail-send', () => ({ loadActorGoogleOAuthToken: mocks.token }))
vi.mock('@/lib/gmail-sync', () => ({ hasGoogleOAuthConfig: mocks.configured }))
import { GET } from './route'
import { NextRequest } from 'next/server'
import { CALENDAR_SCOPE } from '@/lib/google-oauth-scopes'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.actor.mockResolvedValue({ actor: { email: 'actor@example.test', name: 'Ernest' } })
  mocks.configured.mockReturnValue(true)
})
it('offers only the authenticated actor mapped mailbox primary without claiming provider verification', async () => {
  mocks.token.mockResolvedValue({ user_email: 'connected@example.test', scope: CALENDAR_SCOPE })
  const result = await GET(new NextRequest('https://example.test/api/mobile/v1/calendar/accounts'))
  expect(await result.json()).toMatchObject({ accounts: [{ ownerEmail: 'actor@example.test', accountEmail: 'connected@example.test', calendarId: 'primary' }], status: 'connected', providerVerified: false })
  expect(mocks.token).toHaveBeenCalledWith('actor@example.test')
})
it('does not offer a mailbox that lacks existing calendar authorization', async () => {
  mocks.token.mockResolvedValue({ user_email: 'connected@example.test', scope: 'openid email' })
  expect(await (await GET(new NextRequest('https://example.test/api/mobile/v1/calendar/accounts'))).json()).toEqual({ accounts: [], status: 'not_configured', providerVerified: false })
})
