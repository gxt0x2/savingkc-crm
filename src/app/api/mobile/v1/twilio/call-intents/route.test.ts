import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireMobileUser: vi.fn(),
  evaluateOutboundDialerCall: vi.fn(),
  recordBlockedDialerCall: vi.fn(),
  createDialerCallIntent: vi.fn(),
}))

vi.mock('@/lib/mobile-api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mobile-api/auth')>()
  return { ...actual, requireMobileUser: mocks.requireMobileUser }
})
vi.mock('@/lib/server/dialer-call-eligibility', () => ({
  evaluateOutboundDialerCall: mocks.evaluateOutboundDialerCall,
  recordBlockedDialerCall: mocks.recordBlockedDialerCall,
  isAllowedDialerCallerId: (value: string) => value === '+18167277667',
  dialerBlockStatus: (reason: string) => reason === 'policy_unavailable' ? 503 : 409,
}))
vi.mock('@/lib/telephony/dialer-call-intent', () => ({ createDialerCallIntent: mocks.createDialerCallIntent }))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new Request('https://crm.savingkc.com/api/mobile/v1/twilio/call-intents', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const allowed = {
  allowed: true,
  normalizedPhone: '+19135550123',
  policyVersion: 'dialer_safety_v1',
  checkedAt: '2026-08-19T17:00:00.000Z',
  leadId: 'lead-1',
  prospectPhoneId: null,
}

describe('mobile dialer call intent authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMobileUser.mockResolvedValue({ user: { email: 'casey@savingkc.com' } })
    mocks.evaluateOutboundDialerCall.mockResolvedValue(allowed)
    mocks.recordBlockedDialerCall.mockResolvedValue(undefined)
    mocks.createDialerCallIntent.mockReturnValue({
      token: 'mobile-intent',
      claims: {
        to: '+19135550123',
        callerId: '+18167277667',
        kind: 'lead',
        leadId: 'lead-1',
        clientAttemptId: 'attempt-1',
        expiresAt: 123,
      },
    })
  })

  it('stops before policy work when bearer authentication fails', async () => {
    mocks.requireMobileUser.mockRejectedValue(new (await import('@/lib/mobile-api/auth')).MobileAuthError('Invalid bearer token'))

    const response = await POST(request({ phone: '+19135550123', leadId: 'lead-1' }) as never)

    expect(response.status).toBe(401)
    expect(mocks.evaluateOutboundDialerCall).not.toHaveBeenCalled()
  })

  it('signs the server-owned mobile source and authenticated identity', async () => {
    const response = await POST(request({
      phone: '+19135550123',
      callerId: '+18167277667',
      leadId: 'lead-1',
      clientAttemptId: 'attempt-1',
    }) as never)

    expect(response.status).toBe(200)
    expect(mocks.createDialerCallIntent).toHaveBeenCalledWith(expect.objectContaining({
      identity: 'casey',
      kind: 'lead',
      source: 'mobile_lead',
      leadId: 'lead-1',
    }))
  })
})
