import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  evaluateOutboundDialerCall: vi.fn(),
  isGoogleAdsPhoneNumber: vi.fn(),
  recordBlockedDialerCall: vi.fn(),
  validateTwilioWebhook: vi.fn(),
  verifyDialerCallIntent: vi.fn(),
}))

vi.mock('@/lib/call-quality-events', () => ({
  isGoogleAdsPhoneNumber: mocks.isGoogleAdsPhoneNumber,
}))

vi.mock('@/lib/twilio-validate', () => ({
  validateTwilioWebhook: mocks.validateTwilioWebhook,
}))

vi.mock('@/lib/telephony/dialer-call-intent', () => ({
  verifyDialerCallIntent: mocks.verifyDialerCallIntent,
}))

vi.mock('@/lib/server/dialer-call-eligibility', () => ({
  evaluateOutboundDialerCall: mocks.evaluateOutboundDialerCall,
  recordBlockedDialerCall: mocks.recordBlockedDialerCall,
}))

import { POST } from './route'

const CHECKED_AT = '2026-08-19T15:00:00.000Z'
const DESTINATION = '+19135550123'
const ERNEST_CALLER_ID = '+18166088588'

const allowedDecision = {
  allowed: true as const,
  normalizedPhone: DESTINATION,
  policyVersion: 'dialer_safety_v1' as const,
  checkedAt: CHECKED_AT,
  leadId: null,
  prospectPhoneId: null,
}

const blockedDecision = {
  allowed: false as const,
  normalizedPhone: DESTINATION,
  reason: 'do_not_call' as const,
  message: 'This number is on the do-not-call list.',
  policyVersion: 'dialer_safety_v1' as const,
  checkedAt: CHECKED_AT,
  leadId: 'lead-1',
  prospectPhoneId: null,
  reasonSource: 'contact_policy_records',
}

const validLeadClaims = {
  version: 1 as const,
  identity: 'ernest',
  to: DESTINATION,
  callerId: ERNEST_CALLER_ID,
  kind: 'lead' as const,
  source: 'web_click_to_call' as const,
  leadId: 'lead-1',
  prospectPhoneId: null,
  clientAttemptId: 'attempt-1',
  issuedAt: 1_787_151_970,
  expiresAt: 1_787_152_060,
  nonce: 'nonce-1',
}

function twilioRequest(
  values: Record<string, string>,
  options: { signed?: boolean } = {},
) {
  const body = new FormData()
  for (const [key, value] of Object.entries(values)) body.set(key, value)
  return new Request('https://crm.savingkc.com/api/twiml-voice', {
    method: 'POST',
    headers: options.signed === false ? undefined : { 'x-twilio-signature': 'valid-test-signature' },
    body,
  })
}

function inboundRequest(to: string) {
  return twilioRequest({
    CallSid: 'CA_test_inbound',
    From: '+18165550199',
    To: to,
  })
}

function outboundRequest(overrides: Record<string, string> = {}, options: { signed?: boolean } = {}) {
  return twilioRequest({
    CallSid: 'CA_test_outbound',
    From: 'client:ernest',
    To: DESTINATION,
    CallerId: ERNEST_CALLER_ID,
    ...overrides,
  }, options)
}

async function responseText(request: Request) {
  const response = await POST(request)
  return { response, text: await response.text() }
}

function expectNoDialableVerbs(twiml: string) {
  expect(twiml).not.toMatch(/<(?:Dial|Number|Redirect)\b/i)
}

function expectBlockedTwiml(twiml: string) {
  expect(twiml).toContain('<Say>Call blocked by contact policy. Review the contact record.</Say>')
  expect(twiml).toContain('<Hangup/>')
  expectNoDialableVerbs(twiml)
}

describe('TwiML request containment', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.verifyDialerCallIntent.mockReturnValue({ valid: false, reason: 'invalid_signature' })
    mocks.evaluateOutboundDialerCall.mockResolvedValue(allowedDecision)
    mocks.recordBlockedDialerCall.mockResolvedValue(undefined)
    mocks.isGoogleAdsPhoneNumber.mockReturnValue(false)
  })

  it('rejects an unsigned request before form parsing or policy access', async () => {
    const request = outboundRequest({}, { signed: false })
    const formData = vi.spyOn(request, 'formData')

    const { response, text } = await responseText(request)

    expect(response.status).toBe(403)
    expect(formData).not.toHaveBeenCalled()
    expect(mocks.validateTwilioWebhook).not.toHaveBeenCalled()
    expect(mocks.evaluateOutboundDialerCall).not.toHaveBeenCalled()
    expect(mocks.recordBlockedDialerCall).not.toHaveBeenCalled()
    expectNoDialableVerbs(text)
  })

  it('rejects a forged signature before route form parsing or policy access', async () => {
    mocks.validateTwilioWebhook.mockResolvedValue(false)
    const request = outboundRequest()
    const formData = vi.spyOn(request, 'formData')

    const { response, text } = await responseText(request)

    expect(response.status).toBe(403)
    expect(formData).not.toHaveBeenCalled()
    expect(mocks.evaluateOutboundDialerCall).not.toHaveBeenCalled()
    expect(mocks.recordBlockedDialerCall).not.toHaveBeenCalled()
    expectNoDialableVerbs(text)
  })

  it('treats a signature-validation exception as a forbidden request', async () => {
    mocks.validateTwilioWebhook.mockRejectedValue(new Error('validator unavailable'))
    const request = outboundRequest()
    const formData = vi.spyOn(request, 'formData')

    const { response, text } = await responseText(request)

    expect(response.status).toBe(403)
    expect(formData).not.toHaveBeenCalled()
    expect(mocks.evaluateOutboundDialerCall).not.toHaveBeenCalled()
    expectNoDialableVerbs(text)
  })

  it('blocks a signed SDK request when its call intent is missing', async () => {
    const { response, text } = await responseText(outboundRequest())

    expect(response.status).toBe(200)
    expect(mocks.verifyDialerCallIntent).not.toHaveBeenCalled()
    expect(mocks.evaluateOutboundDialerCall).not.toHaveBeenCalled()
    expectBlockedTwiml(text)
    expect(mocks.recordBlockedDialerCall).toHaveBeenCalledWith(
      expect.objectContaining({ phone: DESTINATION, source: 'legacy_sdk' }),
      expect.objectContaining({ reason: 'policy_unavailable', reasonSource: 'intent.missing' }),
    )
  })

  it('keeps a time-bounded, explicitly enabled legacy compatibility path on the live policy', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-19T18:00:00.000Z'))
    vi.stubEnv('DIALER_ALLOW_LEGACY_UNSIGNED_INTENTS', 'true')

    const { response, text } = await responseText(outboundRequest())

    expect(response.status).toBe(200)
    expect(mocks.evaluateOutboundDialerCall).toHaveBeenCalledWith({
      phone: DESTINATION,
      leadId: null,
      prospectPhoneId: null,
      source: 'legacy_sdk',
      identity: 'ernest',
      callerId: ERNEST_CALLER_ID,
      callSid: 'CA_test_outbound',
      clientAttemptId: null,
    })
    expect(text.match(/<Dial\b/g)).toHaveLength(1)
    expect(text.match(/<Number\b/g)).toHaveLength(1)
    expect(text).toContain(`>${DESTINATION}</Number>`)
  })

  it('expires the legacy compatibility path even when its flag remains enabled', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T05:00:00.000Z'))
    vi.stubEnv('DIALER_ALLOW_LEGACY_UNSIGNED_INTENTS', 'true')

    const { text } = await responseText(outboundRequest())

    expectBlockedTwiml(text)
    expect(mocks.evaluateOutboundDialerCall).not.toHaveBeenCalled()
  })

  it('binds a valid DialIntentToken to identity, destination, caller ID, and contact IDs before the live policy', async () => {
    mocks.verifyDialerCallIntent.mockReturnValue({ valid: true, claims: validLeadClaims })
    mocks.evaluateOutboundDialerCall.mockResolvedValue({
      ...allowedDecision,
      leadId: 'lead-1',
    })

    const { response, text } = await responseText(outboundRequest({
      DialIntentToken: 'signed-intent',
      LeadId: 'lead-1',
    }))

    expect(response.status).toBe(200)
    expect(mocks.verifyDialerCallIntent).toHaveBeenCalledWith('signed-intent')
    expect(mocks.evaluateOutboundDialerCall).toHaveBeenCalledWith({
      phone: DESTINATION,
      leadId: 'lead-1',
      prospectPhoneId: null,
      source: 'web_click_to_call',
      identity: 'ernest',
      callerId: ERNEST_CALLER_ID,
      callSid: 'CA_test_outbound',
      clientAttemptId: 'attempt-1',
    })
    expect(text.match(/<Dial\b/g)).toHaveLength(1)
  })

  it('fails closed when a present intent is invalid or expired', async () => {
    mocks.verifyDialerCallIntent.mockReturnValue({ valid: false, reason: 'expired' })

    const { response, text } = await responseText(outboundRequest({ CallIntent: 'expired-intent' }))

    expect(response.status).toBe(200)
    expectBlockedTwiml(text)
    expect(mocks.evaluateOutboundDialerCall).not.toHaveBeenCalled()
    expect(mocks.recordBlockedDialerCall).toHaveBeenCalledWith(
      expect.objectContaining({ phone: DESTINATION, source: 'legacy_sdk' }),
      expect.objectContaining({ allowed: false, reason: 'policy_unavailable', reasonSource: 'intent.expired' }),
    )
  })

  it('does not treat an explicitly empty intent parameter as a legacy client', async () => {
    mocks.verifyDialerCallIntent.mockReturnValue({ valid: false, reason: 'missing' })

    const { response, text } = await responseText(outboundRequest({ DialIntentToken: ' ' }))

    expect(response.status).toBe(200)
    expectBlockedTwiml(text)
    expect(mocks.verifyDialerCallIntent).toHaveBeenCalledWith(null)
    expect(mocks.evaluateOutboundDialerCall).not.toHaveBeenCalled()
  })

  it.each([
    ['identity', { ...validLeadClaims, identity: 'casey' }, {}],
    ['destination', { ...validLeadClaims, to: '+19135550124' }, {}],
    ['caller ID', { ...validLeadClaims, callerId: '+18167277667' }, {}],
    ['lead ID', validLeadClaims, { LeadId: 'lead-2' }],
  ])('blocks a valid intent with a mismatched %s claim', async (_label, claims, requestOverrides) => {
    mocks.verifyDialerCallIntent.mockReturnValue({ valid: true, claims })

    const { response, text } = await responseText(outboundRequest({
      DialIntentToken: 'signed-intent',
      ...requestOverrides,
    }))

    expect(response.status).toBe(200)
    expectBlockedTwiml(text)
    expect(mocks.evaluateOutboundDialerCall).not.toHaveBeenCalled()
    expect(mocks.recordBlockedDialerCall).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: DESTINATION,
        source: 'web_click_to_call',
        clientAttemptId: 'attempt-1',
      }),
      expect.objectContaining({ reason: 'destination_mismatch', reasonSource: 'intent.claim_mismatch' }),
    )
  })

  it('rejects an explicitly selected caller ID that is not dialer-approved', async () => {
    const { response, text } = await responseText(outboundRequest({
      CallerId: '+18166088808',
    }))

    expect(response.status).toBe(200)
    expectBlockedTwiml(text)
    expect(mocks.verifyDialerCallIntent).not.toHaveBeenCalled()
    expect(mocks.evaluateOutboundDialerCall).not.toHaveBeenCalled()
    expect(mocks.recordBlockedDialerCall).toHaveBeenCalledWith(
      expect.objectContaining({ callerId: '+18166088808', source: 'legacy_sdk' }),
      expect.objectContaining({ reason: 'blocked_number', reasonSource: 'caller_id.unapproved' }),
    )
  })

  it('returns safe TwiML and records the same final policy input when policy denies', async () => {
    mocks.verifyDialerCallIntent.mockReturnValue({ valid: true, claims: validLeadClaims })
    mocks.evaluateOutboundDialerCall.mockResolvedValue(blockedDecision)

    const { response, text } = await responseText(outboundRequest({ DialIntentToken: 'signed-intent' }))

    expect(response.status).toBe(200)
    expectBlockedTwiml(text)
    const policyInput = mocks.evaluateOutboundDialerCall.mock.calls[0]?.[0]
    expect(mocks.recordBlockedDialerCall).toHaveBeenCalledWith(policyInput, blockedDecision)
  })

  it('never creates an emergency call when the outbound policy throws', async () => {
    mocks.verifyDialerCallIntent.mockReturnValue({ valid: true, claims: validLeadClaims })
    mocks.evaluateOutboundDialerCall.mockRejectedValue(new Error('policy exploded'))

    const { response, text } = await responseText(outboundRequest({ DialIntentToken: 'signed-intent' }))

    expect(response.status).toBe(200)
    expectBlockedTwiml(text)
    expect(text).not.toContain('+18162262552')
    expect(mocks.recordBlockedDialerCall).toHaveBeenCalledWith(
      expect.objectContaining({ phone: DESTINATION, source: 'web_click_to_call' }),
      expect.objectContaining({ reason: 'policy_unavailable', reasonSource: 'policy.unexpected_error' }),
    )
  })

  it('keeps the denial contained even if blocked-call recording throws', async () => {
    mocks.verifyDialerCallIntent.mockReturnValue({ valid: true, claims: validLeadClaims })
    mocks.evaluateOutboundDialerCall.mockResolvedValue(blockedDecision)
    mocks.recordBlockedDialerCall.mockRejectedValue(new Error('audit unavailable'))

    const { response, text } = await responseText(outboundRequest({ DialIntentToken: 'signed-intent' }))

    expect(response.status).toBe(200)
    expectBlockedTwiml(text)
  })

  it('returns a non-dialing response when parsing fails before classification', async () => {
    const request = outboundRequest()
    vi.spyOn(request, 'formData').mockRejectedValue(new Error('malformed body'))

    const { response, text } = await responseText(request)

    expect(response.status).toBe(200)
    expect(text).toContain('<Hangup/>')
    expectNoDialableVerbs(text)
    expect(mocks.recordBlockedDialerCall).not.toHaveBeenCalled()
  })
})

describe('verified inbound TwiML routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateTwilioWebhook.mockResolvedValue(true)
    mocks.recordBlockedDialerCall.mockResolvedValue(undefined)
    mocks.isGoogleAdsPhoneNumber.mockReturnValue(false)
  })

  it('routes the dispositions number directly to Ernest without the seller IVR', async () => {
    const { text } = await responseText(inboundRequest('+18166088858'))

    expect(text).toContain('<Dial')
    expect(text).toContain('callerId="+18166088858"')
    expect(text).toContain('+18162262552')
    expect(text).toContain('type=direct')
    expect(text).not.toContain('<Gather')
  })

  it('routes Casey Legacy directly to Casey without the seller IVR', async () => {
    const { text } = await responseText(inboundRequest('+18163754666'))

    expect(text).toContain('<Dial')
    expect(text).toContain('callerId="+18163754666"')
    expect(text).toContain('+18167564943')
    expect(text).toContain('type=direct')
    expect(text).not.toContain('<Gather')
  })

  it('keeps standard acquisition numbers on the seller IVR', async () => {
    const { text } = await responseText(inboundRequest('+18163077835'))

    expect(text).toContain('<Gather')
    expect(text).toContain('/api/ivr/handle-input')
  })

  it('preserves emergency dialing only after a verified request is classified inbound', async () => {
    mocks.isGoogleAdsPhoneNumber.mockImplementationOnce(() => {
      throw new Error('inbound routing unavailable')
    })

    const { response, text } = await responseText(inboundRequest('+18163077835'))

    expect(response.status).toBe(200)
    expect(text.match(/<Dial\b/g)).toHaveLength(1)
    expect(text.match(/<Number\b/g)).toHaveLength(1)
    expect(text).toContain('<Number>+18162262552</Number>')
  })
})
