import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  twilio: vi.fn(),
  env: {} as Record<string, string>,
}))

vi.mock('@/lib/telephony/twiml-app', () => ({
  cleanTwilioEnv: (name: string) => mocks.env[name] || '',
}))

vi.mock('twilio', () => ({ default: mocks.twilio }))

import { hangupMobileVoiceCall, mobileVoiceHangupConfigured } from './mobile-voice-hangup'

const callSid = `CA${'a'.repeat(32)}`

describe('mobile Voice hangup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.env = {
      TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
      TWILIO_API_KEY: `SK${'b'.repeat(32)}`,
      TWILIO_API_SECRET: 'secret',
    }
    mocks.twilio.mockReturnValue({ calls: vi.fn(() => ({ update: mocks.update })) })
    mocks.update.mockResolvedValue({ sid: callSid, status: 'completed' })
  })

  it('completes the provider call when credentials are present', async () => {
    await expect(hangupMobileVoiceCall(callSid)).resolves.toBe('disconnected')
    expect(mocks.update).toHaveBeenCalledWith({ status: 'completed' })
    expect(mobileVoiceHangupConfigured()).toBe(true)
  })

  it('treats an already-ended provider call as success', async () => {
    mocks.update.mockRejectedValue({ code: 20404, status: 404 })
    await expect(hangupMobileVoiceCall(callSid)).resolves.toBe('already_ended')
  })

  it('fails closed without a SID or Twilio env', async () => {
    await expect(hangupMobileVoiceCall('not-a-sid')).rejects.toThrow(/valid Twilio call SID/)
    mocks.env = {}
    expect(mobileVoiceHangupConfigured()).toBe(false)
    await expect(hangupMobileVoiceCall(callSid)).rejects.toThrow('Calling is temporarily unavailable')
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
