import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeTwilioDevice } from './initialize-twilio-device'
import { formatTwilioCallError } from './telephony-bar-support'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => void>(),
  options: vi.fn(),
  register: vi.fn(),
}))

vi.mock('@/lib/telephony/microphone-preflight', () => ({ verifyMicrophoneInput: vi.fn() }))
vi.mock('@twilio/voice-sdk', () => ({
  Device: class {
    constructor(_token: string, options: unknown) { mocks.options(options) }
    on(name: string, handler: (...args: unknown[]) => void) { mocks.handlers.set(name, handler) }
    register = mocks.register
    destroy = vi.fn()
  },
}))

describe('Twilio signaling error recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'test-token' }) }))
  })
  afterEach(() => vi.unstubAllGlobals())

  async function initialize() {
    const callbacks = { log: vi.fn(), onCallerId: vi.fn(), onError: vi.fn(), onIdentity: vi.fn(), onIncoming: vi.fn(), onStatus: vi.fn() }
    await initializeTwilioDevice(callbacks)
    return callbacks
  }

  it('keeps a call error visible without taking the registered phone offline', async () => {
    const callbacks = await initialize()
    mocks.handlers.get('registered')?.()
    mocks.handlers.get('error')?.({ code: 31000, message: 'General error' }, { parameters: { CallSid: 'test-call' } })
    expect(callbacks.onStatus.mock.calls).toEqual([['ready']])
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringMatching(/31000.*Save the call outcome/))
    expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ enableImprovedSignalingErrorPrecision: true }))
  })

  it('still marks a device-level failure offline', async () => {
    const callbacks = await initialize()
    mocks.handlers.get('error')?.({ code: 31205, message: 'Token expired' })
    expect(callbacks.onStatus).toHaveBeenCalledWith('offline')
    expect(callbacks.onError).toHaveBeenCalledWith('Token expired')
  })

  it('preserves specific call errors and their support code', () => {
    expect(formatTwilioCallError(Object.assign(new Error('Connection timed out'), { code: 31003 })))
      .toBe('Connection timed out (Twilio 31003)')
    expect(formatTwilioCallError(new Error('Microphone unavailable'))).toBe('Microphone unavailable')
  })
})
