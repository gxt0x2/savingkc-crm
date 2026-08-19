import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const webDialerSource = readFileSync('src/components/telephony/telephony-bar.tsx', 'utf8')
const mobileVoiceSource = readFileSync('apps/mobile/src/lib/twilio-voice-service.ts', 'utf8')
const mobileApiSource = readFileSync('apps/mobile/src/lib/api.ts', 'utf8')
const mobileAppSource = readFileSync('apps/mobile/App.tsx', 'utf8')

describe('outbound dialer client preflight', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('posts the full mobile call context through the bearer-authenticated API helper', () => {
    const helperStart = mobileApiSource.indexOf('export async function requestMobileCallIntent')
    const helper = mobileApiSource.slice(helperStart)

    expect(helperStart).toBeGreaterThan(-1)
    expect(helper).toContain("'/api/mobile/v1/twilio/call-intents'")
    expect(helper).toContain('accessToken: input.accessToken')
    expect(helper).toContain("method: 'POST'")
    for (const field of ['phone', 'callerId', 'kind', 'leadId', 'prospectPhoneId', 'clientAttemptId']) {
      expect(helper).toContain(`${field}: input.${field}`)
    }
    expect(mobileApiSource).toContain('Authorization: `Bearer ${options.accessToken}`')
    expect(helper).toContain("payload.error || payload.reason || 'This call is not allowed.'")
  })

  it('sends bearer auth and surfaces the mobile server denial message', async () => {
    vi.stubEnv('EXPO_PUBLIC_CRM_API_BASE_URL', 'https://crm.example')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ allowed: false, error: 'This number is suppressed.', reason: 'suppressed' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { requestMobileCallIntent } = await import('../../../apps/mobile/src/lib/api')

    await expect(requestMobileCallIntent({
      accessToken: 'mobile-access-token',
      phone: '+18165550100',
      callerId: '+18166088808',
      kind: 'lead',
      leadId: 'lead-123',
      clientAttemptId: 'attempt-123',
    })).rejects.toThrow('This number is suppressed.')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://crm.example/api/mobile/v1/twilio/call-intents',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer mobile-access-token' }),
        body: JSON.stringify({
          phone: '+18165550100',
          callerId: '+18166088808',
          kind: 'lead',
          leadId: 'lead-123',
          prospectPhoneId: null,
          clientAttemptId: 'attempt-123',
        }),
      }),
    )
  })

  it('authorizes web and mobile calls before connecting or entering calling state', () => {
    const webPreflight = webDialerSource.indexOf('const authorized = await requestDialerCallIntent({')
    const webCalling = webDialerSource.indexOf("setStatusLogged('calling')", webPreflight)
    const webConnect = webDialerSource.indexOf('deviceRef.current.connect({', webPreflight)
    const webStartedLog = webDialerSource.indexOf("event: 'started'", webPreflight)

    expect(webPreflight).toBeGreaterThan(-1)
    expect(webCalling).toBeGreaterThan(webPreflight)
    expect(webConnect).toBeGreaterThan(webPreflight)
    expect(webStartedLog).toBeGreaterThan(webPreflight)
    expect(webDialerSource).toContain('DialIntentToken: authorized.intent')

    const mobilePreflight = mobileVoiceSource.indexOf('const authorized = await requestMobileCallIntent({')
    const mobileConnecting = mobileVoiceSource.indexOf("input.onState('connecting')", mobilePreflight)
    const mobileConnect = mobileVoiceSource.indexOf('voice.connect(token, {', mobilePreflight)

    expect(mobilePreflight).toBeGreaterThan(-1)
    expect(mobileConnecting).toBeGreaterThan(mobilePreflight)
    expect(mobileConnect).toBeGreaterThan(mobilePreflight)
    expect(mobileVoiceSource).toContain('DialIntentToken: authorized.intent')
  })

  it('sends lead context from lead detail and no lead context from the manual phone', () => {
    const manualCall = mobileAppSource.match(/startTwilioVoiceCall\(\{ accessToken, phone, onState: setCurrentState \}\)/)
    expect(manualCall).not.toBeNull()
    expect(manualCall?.[0]).not.toContain('leadId')

    const leadCallStart = mobileAppSource.indexOf('const voiceCall = await startTwilioVoiceCall({')
    const leadCallEnd = mobileAppSource.indexOf('})', leadCallStart)
    const leadCall = mobileAppSource.slice(leadCallStart, leadCallEnd)
    expect(leadCall).toContain('leadId: lead.id')
    expect(leadCall).toContain('clientAttemptId: clientCallId')

    const startedLog = mobileAppSource.indexOf("event: 'started'", leadCallEnd)
    expect(startedLog).toBeGreaterThan(leadCallEnd)
  })

  it('checks persisted offline stop outcomes before a mobile lead call', () => {
    const leadStart = mobileAppSource.indexOf('async function startCall()')
    const preflight = mobileAppSource.indexOf('await startTwilioVoiceCall({', leadStart)
    const outboxCheck = mobileAppSource.indexOf('const queuedEvents = await getQueuedCallEvents()', leadStart)

    expect(outboxCheck).toBeGreaterThan(leadStart)
    expect(outboxCheck).toBeLessThan(preflight)
    expect(mobileAppSource.slice(outboxCheck, preflight)).toContain("event.outcome === 'bad_number'")
    expect(mobileAppSource.slice(outboxCheck, preflight)).toContain("'wrong_number', 'disconnected', 'dnc'")
  })

  it('clears stale lead and queue context for manual edits and recent-call redials', () => {
    expect(webDialerSource).toContain('onChange={(e) => setManualDialNumber(e.target.value)}')
    expect(webDialerSource).toContain('clearUnverifiedDialContext(normalizedInput)')

    const clearContextStart = webDialerSource.indexOf('function clearUnverifiedDialContext')
    const clearContextEnd = webDialerSource.indexOf('function setManualDialNumber', clearContextStart)
    const clearContext = webDialerSource.slice(clearContextStart, clearContextEnd)
    expect(clearContext).toContain('setSelectedLead(null)')
    expect(clearContext).toContain('setQueue(null)')
    expect(clearContext).toContain('activeQueueItemRef.current = null')

    const redialStart = webDialerSource.indexOf('function handleRedial')
    const redialEnd = webDialerSource.indexOf('const statusDotColor', redialStart)
    const redial = webDialerSource.slice(redialStart, redialEnd)
    expect(redial).toContain('clearUnverifiedDialContext()')
    expect(redial.indexOf('clearUnverifiedDialContext()')).toBeLessThan(redial.indexOf('setDialNumber(call.phone)'))
  })
})
