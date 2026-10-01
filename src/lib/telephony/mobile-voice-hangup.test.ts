import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), update: vi.fn(), env: {} as Record<string, string> }))
vi.mock('@/lib/telephony/twiml-app', () => ({ cleanTwilioEnv: (name: string) => mocks.env[name] || '' }))
vi.mock('twilio', () => ({ default: () => ({ calls: () => ({ fetch: mocks.fetch, update: mocks.update }) }) }))
import { hangupMobileVoiceCall } from './mobile-voice-hangup'

const SID = `CA${'a'.repeat(32)}`
describe('mobile hangup authorization and retry safety', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.env = { TWILIO_ACCOUNT_SID: `AC${'b'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'test' }
    mocks.fetch.mockResolvedValue({ from: 'client:ernest', to: '+18165550000', status: 'in-progress' })
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
  it('rejects malformed SIDs and missing credentials without a provider request', async () => {
    await expect(hangupMobileVoiceCall('bad', 'ernest')).rejects.toMatchObject({ status: 400 })
    mocks.env = {}
    await expect(hangupMobileVoiceCall(SID, 'ernest')).rejects.toMatchObject({ status: 503 })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
