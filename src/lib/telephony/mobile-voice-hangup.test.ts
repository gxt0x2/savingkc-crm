import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  fetchedSids: [] as string[],
  updatedSids: [] as string[],
  env: {} as Record<string, string>,
}))
vi.mock('@/lib/telephony/twiml-app', () => ({ cleanTwilioEnv: (name: string) => mocks.env[name] || '' }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('tests pass the ledger explicitly') } }))
vi.mock('twilio', () => ({
  default: () => {
    const calls = (sid: string) => ({
      fetch: () => {
        mocks.fetchedSids.push(sid)
        return mocks.fetch(sid)
      },
      update: (body: unknown) => {
        mocks.updatedSids.push(sid)
        return mocks.update(body)
      },
    })
    calls.list = mocks.list
    return { calls }
  },
}))
import {
  hangupMobileVoiceAttempt,
  hangupMobileVoiceCall,
  isMobileVoiceSource,
  trackMobileVoiceAttemptLeg,
} from './mobile-voice-hangup'

const SID = `CA${'a'.repeat(32)}`
const MOBILE_PARENT = `CA${'e'.repeat(32)}`
const MOBILE_CHILD = `CA${'f'.repeat(32)}`
const WEB_PARENT = `CA${'9'.repeat(32)}`

function ledger(result: { data?: unknown; error?: unknown } = {}) {
  return { rpc: vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null })) }
}

function mobileCallOnTwilio(parentStatus = 'ringing') {
  mocks.fetch.mockImplementation(async (sid: string) => (
    sid === MOBILE_PARENT
      ? { sid, from: 'client:ernest', to: '+18165537559', status: parentStatus }
      : { sid, from: 'client:ernest', to: '+19135550100', status: 'in-progress' }
  ))
  mocks.list.mockImplementation(async (query: { parentCallSid?: string }) => (
    query.parentCallSid === MOBILE_PARENT
      ? [{ sid: MOBILE_CHILD, from: '+18166088588', to: '+18165537559', status: 'ringing', parentCallSid: MOBILE_PARENT }]
      : []
  ))
}

const leg = (overrides: Partial<Parameters<typeof trackMobileVoiceAttemptLeg>[1]> = {}) => ({
  identity: 'ernest',
  clientAttemptId: 'mobile-attempt',
  source: 'mobile_manual',
  parentCallSid: MOBILE_PARENT,
  callSid: MOBILE_CHILD,
  callStatus: 'initiated',
  ...overrides,
})

describe('mobile hangup authorization and retry safety', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.env = { TWILIO_ACCOUNT_SID: `AC${'b'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'test' }
    mocks.fetchedSids = []
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
  it('rejects malformed SIDs and missing credentials without a provider request', async () => {
    await expect(hangupMobileVoiceCall('bad', 'ernest')).rejects.toMatchObject({ status: 400 })
    mocks.env = {}
    await expect(hangupMobileVoiceCall(SID, 'ernest')).rejects.toMatchObject({ status: 503 })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

describe('mobile End before the phone has a call SID', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.env = { TWILIO_ACCOUNT_SID: `AC${'b'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'test' }
    mocks.fetchedSids = []
    mocks.updatedSids = []
    mobileCallOnTwilio()
  })
  it('stores End and touches no provider call while Twilio has not reported the attempt', async () => {
    const db = ledger({ data: { parent_call_sid: null, end_requested: true } })
    expect(await hangupMobileVoiceAttempt('ernest', ' mobile-attempt ', db)).toBe('end_requested')
    expect(db.rpc).toHaveBeenCalledWith('request_mobile_voice_attempt_end_v1', {
      p_identity: 'ernest',
      p_client_attempt_id: 'mobile-attempt',
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('ends only the recorded mobile parent and its child, never the live web dialer call', async () => {
    const db = ledger({ data: { parent_call_sid: MOBILE_PARENT, end_requested: true } })
    expect(await hangupMobileVoiceAttempt('ernest', 'mobile-attempt', db)).toBe('disconnected')
    expect(mocks.updatedSids).toEqual([MOBILE_PARENT, MOBILE_CHILD])
    expect(mocks.fetchedSids).not.toContain(WEB_PARENT)
    expect(mocks.update).toHaveBeenCalledWith({ status: 'canceled' })
    expect(mocks.list).not.toHaveBeenCalledWith(expect.objectContaining({ from: 'client:ernest' }))
  })
  it('reports an attempt that already ended without a provider mutation', async () => {
    mobileCallOnTwilio('completed')
    const db = ledger({ data: { parent_call_sid: MOBILE_PARENT, end_requested: true } })
    expect(await hangupMobileVoiceAttempt('ernest', 'mobile-attempt', db)).toBe('already_ended')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('keys the attempt by the bearer identity and still proves ownership on Twilio', async () => {
    const db = ledger({ data: { parent_call_sid: MOBILE_PARENT, end_requested: true } })
    await expect(hangupMobileVoiceAttempt('casey', 'mobile-attempt', db)).rejects.toMatchObject({ status: 404 })
    expect(db.rpc).toHaveBeenCalledWith('request_mobile_voice_attempt_end_v1', {
      p_identity: 'casey',
      p_client_attempt_id: 'mobile-attempt',
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('asks for a retry when End cannot be stored', async () => {
    const db = ledger({ error: { message: 'function does not exist' } })
    await expect(hangupMobileVoiceAttempt('ernest', 'mobile-attempt', db)).rejects.toMatchObject({
      status: 503,
      message: 'Could not confirm that the call ended. Retry End.',
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('rejects a missing or oversized attempt id before touching the ledger', async () => {
    const db = ledger()
    await expect(hangupMobileVoiceAttempt('ernest', '  ', db)).rejects.toMatchObject({ status: 400 })
    await expect(hangupMobileVoiceAttempt('ernest', 'x'.repeat(201), db)).rejects.toMatchObject({ status: 400 })
    await expect(hangupMobileVoiceAttempt('', 'mobile-attempt', db)).rejects.toMatchObject({ status: 403 })
    expect(db.rpc).not.toHaveBeenCalled()
  })
})

describe('mobile attempt status-callback tracking', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.env = { TWILIO_ACCOUNT_SID: `AC${'b'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'test' }
    mocks.fetchedSids = []
    mocks.updatedSids = []
    mobileCallOnTwilio()
  })
  it('records the provider parent for a mobile attempt', async () => {
    const db = ledger({ data: { parent_call_sid: MOBILE_PARENT, end_requested: false } })
    expect(await trackMobileVoiceAttemptLeg(db, leg())).toBe('recorded')
    expect(db.rpc).toHaveBeenCalledWith('record_mobile_voice_attempt_leg_v1', {
      p_identity: 'ernest',
      p_client_attempt_id: 'mobile-attempt',
      p_source: 'mobile_manual',
      p_parent_call_sid: MOBILE_PARENT,
      p_call_sid: MOBILE_CHILD,
      p_status: 'initiated',
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('ends the call when End was stored before Twilio reported the attempt', async () => {
    const db = ledger({ data: { parent_call_sid: MOBILE_PARENT, end_requested: true } })
    expect(await trackMobileVoiceAttemptLeg(db, leg({ callStatus: 'ringing' }))).toBe('end_enforced')
    expect(mocks.updatedSids).toEqual([MOBILE_PARENT, MOBILE_CHILD])
    expect(mocks.fetchedSids).not.toContain(WEB_PARENT)
  })
  it('does not end anything for a terminal leg', async () => {
    const db = ledger({ data: { parent_call_sid: MOBILE_PARENT, end_requested: true } })
    expect(await trackMobileVoiceAttemptLeg(db, leg({ callStatus: 'canceled' }))).toBe('recorded')
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('never records a web dialer leg on the same identity', async () => {
    const db = ledger()
    for (const source of ['web_power_dialer', 'web_manual', 'web_click_to_call', 'legacy_sdk', '']) {
      expect(await trackMobileVoiceAttemptLeg(db, leg({ source, parentCallSid: WEB_PARENT }))).toBeNull()
    }
    expect(db.rpc).not.toHaveBeenCalled()
    expect(isMobileVoiceSource('mobile_lead')).toBe(true)
    expect(isMobileVoiceSource('web_power_dialer')).toBe(false)
  })
  it('ignores a callback without a valid attempt, identity, or call SID', async () => {
    const db = ledger()
    expect(await trackMobileVoiceAttemptLeg(db, leg({ identity: ' ' }))).toBeNull()
    expect(await trackMobileVoiceAttemptLeg(db, leg({ clientAttemptId: '' }))).toBeNull()
    expect(await trackMobileVoiceAttemptLeg(db, leg({ clientAttemptId: 'x'.repeat(201) }))).toBeNull()
    expect(await trackMobileVoiceAttemptLeg(db, leg({ callSid: 'not-a-sid' }))).toBeNull()
    expect(db.rpc).not.toHaveBeenCalled()
  })
  it('stores no parent when Twilio omits a valid ParentCallSid', async () => {
    const db = ledger({ data: { parent_call_sid: null, end_requested: true } })
    expect(await trackMobileVoiceAttemptLeg(db, leg({ parentCallSid: 'bogus' }))).toBe('recorded')
    expect(db.rpc).toHaveBeenCalledWith('record_mobile_voice_attempt_leg_v1', expect.objectContaining({ p_parent_call_sid: null }))
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('keeps the status callback alive when the ledger is unavailable', async () => {
    const db = ledger({ error: { message: 'relation does not exist' } })
    expect(await trackMobileVoiceAttemptLeg(db, leg())).toBe('unrecorded')
    const throwing = { rpc: vi.fn(async () => { throw new Error('network') }) }
    expect(await trackMobileVoiceAttemptLeg(throwing, leg())).toBe('unrecorded')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('reports a stored End that Twilio did not accept so a later callback can retry', async () => {
    mocks.fetch.mockRejectedValue({ status: 500 })
    const db = ledger({ data: { parent_call_sid: MOBILE_PARENT, end_requested: true } })
    expect(await trackMobileVoiceAttemptLeg(db, leg())).toBe('end_failed')
  })
})
