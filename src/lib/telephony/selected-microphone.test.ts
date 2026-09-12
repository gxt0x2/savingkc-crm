import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device, Call } from '@twilio/voice-sdk'
import { chooseMicrophone, monitorCallMicrophone, prepareCallMicrophone, releaseCallMicrophone, testSelectedMicrophone } from './selected-microphone'

function fixture() {
  const stream = { getAudioTracks: () => [{ enabled: true, muted: false, readyState: 'live', label: 'USB mic' }] } as unknown as MediaStream
  const device = { audio: { inputStream: stream, setInputDevice: vi.fn().mockResolvedValue(undefined), unsetInputDevice: vi.fn().mockResolvedValue(undefined) } } as unknown as Device
  return { device, stream }
}
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('SDK microphone selection', () => {
  it('pins the named device on the SDK itself rather than opening a separate probe', async () => {
    const { device, stream } = fixture()
    chooseMicrophone(device, 'usb-mic-1')
    await prepareCallMicrophone(device)
    expect(device.audio?.setInputDevice).toHaveBeenCalledWith('usb-mic-1')
    expect(device.audio?.inputStream).toBe(stream)
    expect(() => chooseMicrophone(device, 'other')).toThrow('Finish the call')
    await releaseCallMicrophone(device)
    expect(device.audio?.unsetInputDevice).toHaveBeenCalledOnce()
  })
  it('does not silently fall back if the selected microphone disappears', async () => {
    const { device } = fixture()
    chooseMicrophone(device, 'missing-mic')
    vi.mocked(device.audio!.setInputDevice).mockRejectedValue(new Error('Device not found'))
    await expect(prepareCallMicrophone(device)).rejects.toThrow('Device not found')
    expect(device.audio!.setInputDevice).toHaveBeenCalledExactlyOnceWith('missing-mic')
    expect(device.audio!.unsetInputDevice).toHaveBeenCalledOnce()
  })
  it('releases the selected stream when the call ends', async () => {
    const { device } = fixture()
    await prepareCallMicrophone(device)
    const handlers = new Map<string, () => void>()
    const call = { once: (event: string, handler: () => void) => { handlers.set(event, handler) } } as unknown as Call
    monitorCallMicrophone(device, call)
    handlers.get('disconnect')!()
    await Promise.resolve()
    expect(device.audio!.unsetInputDevice).toHaveBeenCalledOnce()
  })
  it('measures the SDK input and blocks dialing while that test owns the microphone', async () => {
    vi.useFakeTimers()
    const { device, stream } = fixture()
    const source = { connect: vi.fn(), disconnect: vi.fn() }
    const createMediaStreamSource = vi.fn().mockReturnValue(source)
    const close = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('AudioContext', class {
      resume = vi.fn().mockResolvedValue(undefined)
      close = close
      createMediaStreamSource = createMediaStreamSource
      createAnalyser = () => ({ fftSize: 2048, getFloatTimeDomainData: (values: Float32Array) => values.fill(0.02) })
    })
    const signal = new AbortController()
    const levels = vi.fn()
    const test = testSelectedMicrophone(device, levels, signal.signal)
    await expect(prepareCallMicrophone(device)).rejects.toThrow('Finish the microphone check')
    await vi.advanceTimersByTimeAsync(6000)
    await expect(test).resolves.toBeCloseTo(0.02)
    expect(createMediaStreamSource).toHaveBeenCalledWith(stream)
    expect(close).toHaveBeenCalledOnce()
    expect(device.audio!.unsetInputDevice).toHaveBeenCalledOnce()
    await expect(prepareCallMicrophone(device)).resolves.toBeUndefined()
  })
})
