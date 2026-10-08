import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  updatedSids: [] as string[],
  env: {} as Record<string, string>,
}))
vi.mock('@/lib/telephony/twiml-app', () => ({ cleanTwilioEnv: (name: string) => mocks.env[name] || '' }))
vi.mock('twilio', () => ({
  default: () => {
    const calls = (sid: string) => ({
      fetch: () => mocks.fetch(sid),
      update: (body: unknown) => {
        mocks.updatedSids.push(sid)
        return mocks.update(body)
      },
    })
    calls.list = mocks.list
    return { calls }
  },
}))
import { hangupActiveClientOutboundCalls, hangupMobileVoiceCall, parentMatchesMobileAttempt } from './mobile-voice-hangup'

const SID = `CA${'a'.repeat(32)}`
describe('mobile hangup authorization and retry safety', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.env = { TWILIO_ACCOUNT_SID: `AC${'b'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'test' }
    mocks.updatedSids = []
    mocks.fetch.mockResolvedValue({ from: 'client:ernest', to: '+18165550000', status: 'in-progress' })
    mocks.list.mockResolvedValue([])
  })
  it('ends the authenticated client leg', async () => {
    expect(await hangupMobileVoiceCall(SID, 'ernest')).toBe('disconnected')
    expect(mocks.update).toHaveBeenCalledWith({ status: 'completed' })
  })
  it('rejects another agent even if the supplied SID is valid', async () => {
    await expect(hangupMobileVoiceCall(SID, 'casey')).rejects.toMatchObject({ status: 404 })
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('allows an inbound SDK leg and cancels a queued call', async () => {
    mocks.fetch.mockResolvedValue({ from: '+18165550000', to: 'client:ernest', status: 'queued' })
    expect(await hangupMobileVoiceCall(SID, 'ernest')).toBe('disconnected')
    expect(mocks.update).toHaveBeenCalledWith({ status: 'canceled' })
  })
  it('verifies the provider parent before ending a child PSTN leg', async () => {
    mocks.fetch.mockResolvedValueOnce({ from: '+18165550000', to: '+18165550001', parentCallSid: `CA${'c'.repeat(32)}`, status: 'ringing' })
    mocks.fetch.mockResolvedValueOnce({ from: 'client:ernest', to: '+18165550001' })
    expect(await hangupMobileVoiceCall(SID, 'ernest')).toBe('disconnected')
  })
  it('replays terminal calls without a provider mutation', async () => {
    mocks.fetch.mockResolvedValue({ from: 'client:ernest', to: '+18165550000', status: 'completed' })
    expect(await hangupMobileVoiceCall(SID, 'ernest')).toBe('already_ended')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('does not call a missing SID a successfully ended call', async () => {
    mocks.fetch.mockRejectedValue({ code: 20404 })
    await expect(hangupMobileVoiceCall(SID, 'ernest')).rejects.toMatchObject({ status: 404 })
  })
  it('cancels a still-ringing parent and its PSTN child', async () => {
    const childSid = `CA${'d'.repeat(32)}`
    mocks.fetch.mockResolvedValue({ from: 'client:ernest', to: '+18165537559', status: 'ringing', sid: SID })
    mocks.list.mockResolvedValueOnce([{ sid: childSid, from: '+18166088588', to: '+18165537559', status: 'ringing', parentCallSid: SID }])
    expect(await hangupMobileVoiceCall(SID, 'ernest')).toBe('disconnected')
    expect(mocks.update).toHaveBeenNthCalledWith(1, { status: 'canceled' })
    expect(mocks.update).toHaveBeenNthCalledWith(2, { status: 'canceled' })
  })
  it('ends only the mobile attempt and leaves a concurrent web dialer leg up', async () => {
    const mobileParent = `CA${'e'.repeat(32)}`
    const mobileChild = `CA${'f'.repeat(32)}`
    const webParent = `CA${'9'.repeat(32)}`
    const webChild = `CA${'8'.repeat(32)}`
    mocks.list.mockImplementation(async (query: { from?: string; parentCallSid?: string }) => {
      if (query.parentCallSid === mobileParent) {
        return [{
          sid: mobileChild,
          from: '+18166088588',
          to: '+18165537559',
          status: 'ringing',
          parentCallSid: mobileParent,
          statusCallback: 'https://crm.savingkc.com/api/twilio-call-status?identity=ernest&clientAttemptId=mobile-attempt&source=mobile_manual',
        }]
      }
      if (query.parentCallSid === webParent) {
        return [{
          sid: webChild,
          from: '+18166088588',
          to: '+19135550100',
          status: 'in-progress',
          parentCallSid: webParent,
          statusCallback: 'https://crm.savingkc.com/api/twilio-call-status?identity=ernest&clientAttemptId=web-attempt&source=web_power_dialer',
        }]
      }
      return [
        { sid: webParent, from: 'client:ernest', to: '+19135550100', status: 'in-progress' },
        { sid: mobileParent, from: 'client:ernest', to: '+18165537559', status: 'ringing' },
        { sid: `CA${'1'.repeat(32)}`, from: 'client:casey', to: '+18165550000', status: 'in-progress' },
      ]
    })
    expect(await hangupActiveClientOutboundCalls('ernest', 'mobile-attempt', { attempts: 1 })).toBe('disconnected')
    expect(mocks.updatedSids.sort()).toEqual([mobileChild, mobileParent].sort())
    expect(mocks.updatedSids).not.toContain(webParent)
    expect(mocks.updatedSids).not.toContain(webChild)
    expect(mocks.update).toHaveBeenCalledWith({ status: 'canceled' })
  })
  it('retries a missing mobile leg and does not end the web dialer call', async () => {
    const webParent = `CA${'9'.repeat(32)}`
    const webChild = `CA${'8'.repeat(32)}`
    mocks.list.mockImplementation(async (query: { parentCallSid?: string }) => {
      if (query.parentCallSid === webParent) {
        return [{
          sid: webChild,
          from: '+18166088588',
          status: 'in-progress',
          statusCallback: 'https://crm.savingkc.com/api/twilio-call-status?identity=ernest&clientAttemptId=web-attempt&source=web_manual',
        }]
      }
      return [{ sid: webParent, from: 'client:ernest', status: 'in-progress' }]
    })
    const waits: number[] = []
    await expect(hangupActiveClientOutboundCalls('ernest', 'mobile-attempt', {
      attempts: 3,
      wait: async (ms) => { waits.push(ms) },
    })).rejects.toMatchObject({
      status: 404,
      message: 'That mobile call is not on Twilio yet. Retry End. Other calls were left connected.',
    })
    expect(waits).toEqual([350, 350])
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('reports an already ended mobile attempt without touching another live leg', async () => {
    const mobileParent = `CA${'e'.repeat(32)}`
    const webParent = `CA${'9'.repeat(32)}`
    mocks.list.mockImplementation(async (query: { parentCallSid?: string }) => {
      if (query.parentCallSid === mobileParent) {
        return [{
          sid: `CA${'f'.repeat(32)}`,
          status: 'completed',
          statusCallback: 'https://crm.savingkc.com/api/twilio-call-status?identity=ernest&clientAttemptId=mobile-attempt&source=mobile_lead',
        }]
      }
      if (query.parentCallSid === webParent) {
        return [{
          sid: `CA${'8'.repeat(32)}`,
          status: 'in-progress',
          statusCallback: 'https://crm.savingkc.com/api/twilio-call-status?identity=ernest&clientAttemptId=web-attempt&source=web_power_dialer',
        }]
      }
      return [
        { sid: mobileParent, from: 'client:ernest', status: 'completed' },
        { sid: webParent, from: 'client:ernest', status: 'in-progress' },
      ]
    })
    expect(await hangupActiveClientOutboundCalls('ernest', 'mobile-attempt', { attempts: 1 })).toBe('already_ended')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('does not treat a web status callback as the mobile attempt', () => {
    const webChild = {
      statusCallback: 'https://crm.savingkc.com/api/twilio-call-status?identity=ernest&clientAttemptId=web-attempt&source=web_power_dialer',
    }
    const mobileChild = {
      statusCallback: 'https://crm.savingkc.com/api/twilio-call-status?identity=ernest&clientAttemptId=mobile-attempt&source=mobile_manual',
    }
    expect(parentMatchesMobileAttempt({ sid: 'parent' }, [webChild], 'web-attempt')).toBe(false)
    expect(parentMatchesMobileAttempt({ sid: 'parent' }, [mobileChild], 'mobile-attempt')).toBe(true)
    expect(parentMatchesMobileAttempt({ sid: 'parent' }, [mobileChild], 'someone-else')).toBe(false)
  })
  it('rejects malformed SIDs and missing credentials without a provider request', async () => {
    await expect(hangupMobileVoiceCall('bad', 'ernest')).rejects.toMatchObject({ status: 400 })
    mocks.env = {}
    await expect(hangupMobileVoiceCall(SID, 'ernest')).rejects.toMatchObject({ status: 503 })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
