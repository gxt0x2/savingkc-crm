import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  evaluateOutboundDialerCall: vi.fn(),
  recordBlockedDialerCall: vi.fn(),
  createDialerCallIntent: vi.fn(),
  authorizeDialerSessionAttempt: vi.fn(),
  getDialerSession: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.resolveAuthenticatedActor }))
vi.mock('@/lib/server/dialer-call-eligibility', () => ({
  evaluateOutboundDialerCall: mocks.evaluateOutboundDialerCall,
  recordBlockedDialerCall: mocks.recordBlockedDialerCall,
  isAllowedDialerCallerId: (value: string) => value === '+18167277667',
  dialerBlockStatus: (reason: string) => reason === 'policy_unavailable' ? 503 : 409,
}))
vi.mock('@/lib/telephony/dialer-call-intent', () => ({ createDialerCallIntent: mocks.createDialerCallIntent }))
vi.mock('@/lib/server/dialer-session-engine', () => ({
  authorizeDialerSessionAttempt: mocks.authorizeDialerSessionAttempt,
  getDialerSession: mocks.getDialerSession,
  DialerSessionError: class DialerSessionError extends Error {},
  isUuid: (value: unknown) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new Request('https://crm.savingkc.com/api/dialer/call-intents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const allowed = {
  allowed: true,
  normalizedPhone: '+19135550123',
  policyVersion: 'dialer_safety_v1',
  checkedAt: '2026-08-19T17:00:00.000Z',
  leadId: 'lead-1',
  prospectId: null,
  prospectPhoneId: null,
}

describe('web dialer call intent authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.evaluateOutboundDialerCall.mockResolvedValue(allowed)
    mocks.recordBlockedDialerCall.mockResolvedValue(undefined)
    mocks.createDialerCallIntent.mockReturnValue({
      token: 'signed-intent',
      claims: {
        to: '+19135550123',
        callerId: '+18167277667',
        kind: 'lead',
        leadId: 'lead-1',
        prospectId: null,
        prospectPhoneId: null,
        campaignMemberId: null,
        clientAttemptId: 'attempt-1',
        expiresAt: 123,
      },
    })
  })

  it('requires a verified CRM actor before parsing or policy work', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)
    const input = request({ phone: '+19135550123', kind: 'lead', leadId: 'lead-1' })
    const parse = vi.spyOn(input, 'json')

    const response = await POST(input)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.evaluateOutboundDialerCall).not.toHaveBeenCalled()
  })

  it('audits a policy denial and never signs an intent', async () => {
    mocks.evaluateOutboundDialerCall.mockResolvedValue({
      ...allowed,
      allowed: false,
      reason: 'do_not_call',
      message: 'This number is on the do-not-call list.',
      reasonSource: 'sms_opt_outs.reason',
    })

    const response = await POST(request({
      phone: '+19135550123',
      callerId: '+18167277667',
      kind: 'lead',
      leadId: 'lead-1',
      clientAttemptId: 'attempt-1',
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ allowed: false, reason: 'do_not_call' })
    expect(mocks.recordBlockedDialerCall).toHaveBeenCalledOnce()
    expect(mocks.createDialerCallIntent).not.toHaveBeenCalled()
  })

  it('signs only the server-resolved destination, identity, source, and context', async () => {
    const response = await POST(request({
      phone: '(913) 555-0123',
      callerId: '+18167277667',
      kind: 'lead',
      leadId: 'lead-1',
      clientAttemptId: 'attempt-1',
    }))

    expect(response.status).toBe(200)
    expect(mocks.createDialerCallIntent).toHaveBeenCalledWith({
      identity: 'casey',
      to: '+19135550123',
      callerId: '+18167277667',
      kind: 'lead',
      source: 'web_power_dialer',
      leadId: 'lead-1',
      prospectId: null,
      prospectPhoneId: null,
      campaignMemberId: null,
      clientAttemptId: 'attempt-1',
    })
    expect(await response.json()).toMatchObject({ allowed: true, intent: 'signed-intent' })
  })

  it('creates a durable attempt before returning a session-bound call intent', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000010'
    const leadId = '00000000-0000-4000-8000-000000000011'
    mocks.evaluateOutboundDialerCall.mockResolvedValue({ ...allowed, leadId })
    mocks.authorizeDialerSessionAttempt.mockResolvedValue({ id: 'attempt-row' })
    mocks.createDialerCallIntent.mockReturnValue({
      token: 'signed-intent',
      claims: { to: '+19135550123', callerId: '+18167277667', kind: 'lead', leadId, prospectId: null, prospectPhoneId: null, campaignMemberId: null, clientAttemptId: 'attempt-1', expiresAt: 123 },
    })
    mocks.getDialerSession.mockResolvedValue({ id: sessionId, currentSubjectKind: 'lead', currentSubjectId: leadId, currentCampaignMemberId: null, callerId: '+18167277667' })

    const response = await POST(request({
      phone: '(913) 555-0123',
      callerId: '+18167277667',
      kind: 'lead',
      leadId,
      sessionId,
      clientAttemptId: 'attempt-1',
    }))

    expect(response.status).toBe(200)
    expect(mocks.authorizeDialerSessionAttempt).toHaveBeenCalledWith({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      sessionId,
      clientAttemptId: 'attempt-1',
      subjectKind: 'lead',
      subjectId: leadId,
      campaignMemberId: null,
      leadId,
      prospectId: null,
      prospectPhoneId: null,
      phone: '+19135550123',
      callerId: '+18167277667',
    })
  })

  it('uses the server-owned session caller ID instead of a stale agent default', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000010'
    const leadId = '00000000-0000-4000-8000-000000000011'
    mocks.evaluateOutboundDialerCall.mockResolvedValue({ ...allowed, leadId })
    mocks.getDialerSession.mockResolvedValue({
      id: sessionId,
      currentSubjectKind: 'lead',
      currentSubjectId: leadId,
      currentCampaignMemberId: null,
      callerId: '+18167277667',
    })
    mocks.createDialerCallIntent.mockImplementation((input) => ({
      token: 'signed-intent',
      claims: { ...input, clientAttemptId: 'attempt-1', expiresAt: 123 },
    }))

    const response = await POST(request({
      phone: '(913) 555-0123',
      callerId: '+18166088588',
      kind: 'lead',
      leadId,
      sessionId,
      clientAttemptId: 'attempt-1',
    }))

    expect(response.status).toBe(200)
    expect(mocks.evaluateOutboundDialerCall).toHaveBeenCalledWith(expect.objectContaining({ callerId: '+18167277667' }))
    expect(mocks.createDialerCallIntent).toHaveBeenCalledWith(expect.objectContaining({ callerId: '+18167277667' }))
    expect(mocks.authorizeDialerSessionAttempt).toHaveBeenCalledWith(expect.objectContaining({ callerId: '+18167277667' }))
  })

  it('authorizes a session-bound source Prospect without inventing a Lead', async () => {
    const sessionId = '00000000-0000-4000-8000-000000000020'
    const prospectId = '00000000-0000-4000-8000-000000000021'
    const prospectPhoneId = '00000000-0000-4000-8000-000000000022'
    const campaignMemberId = '00000000-0000-4000-8000-000000000023'
    mocks.evaluateOutboundDialerCall.mockResolvedValue({
      ...allowed,
      leadId: null,
      prospectId,
      prospectPhoneId,
    })
    mocks.authorizeDialerSessionAttempt.mockResolvedValue({ id: 'attempt-row' })
    mocks.createDialerCallIntent.mockReturnValue({
      token: 'signed-prospect-intent',
      claims: {
        to: '+19135550123',
        callerId: '+18167277667',
        kind: 'prospect',
        leadId: null,
        prospectId,
        prospectPhoneId,
        campaignMemberId,
        clientAttemptId: 'attempt-prospect-1',
        expiresAt: 123,
      },
    })
    mocks.getDialerSession.mockResolvedValue({
      id: sessionId,
      currentSubjectKind: 'prospect',
      currentSubjectId: prospectId,
      currentCampaignMemberId: campaignMemberId,
      callerId: '+18167277667',
    })

    const response = await POST(request({
      phone: '(913) 555-0123',
      callerId: '+18167277667',
      kind: 'prospect',
      prospectId,
      prospectPhoneId,
      campaignMemberId,
      sessionId,
      clientAttemptId: 'attempt-prospect-1',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      allowed: true,
      leadId: null,
      prospectId,
      campaignMemberId,
    })
    expect(mocks.authorizeDialerSessionAttempt).toHaveBeenCalledWith(expect.objectContaining({
      subjectKind: 'prospect',
      subjectId: prospectId,
      leadId: null,
      prospectId,
      prospectPhoneId,
      campaignMemberId,
    }))
  })
})
