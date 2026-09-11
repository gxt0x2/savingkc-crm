import { describe, expect, it, vi } from 'vitest'
import { microphoneFailureMessage, verifyMicrophoneInput } from './microphone-preflight'

function mediaDevicesWithStream(stream: MediaStream) {
  return { getUserMedia: vi.fn().mockResolvedValue(stream) } as unknown as Pick<MediaDevices, 'getUserMedia'>
}

describe('dialer microphone preflight', () => {
  it('accepts a live input track and releases the probe immediately', async () => {
    const stop = vi.fn()
    const track = { enabled: true, readyState: 'live', stop } as unknown as MediaStreamTrack
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream

    await expect(verifyMicrophoneInput(mediaDevicesWithStream(stream))).resolves.toBeUndefined()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('rejects an ended input track and still releases the probe', async () => {
    const stop = vi.fn()
    const track = { enabled: true, readyState: 'ended', stop } as unknown as MediaStreamTrack
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream

    await expect(verifyMicrophoneInput(mediaDevicesWithStream(stream))).rejects.toThrow('selected microphone is unavailable')
    expect(stop).toHaveBeenCalledOnce()
  })

  it('turns browser permission failures into an actionable CRM message', () => {
    expect(microphoneFailureMessage({ name: 'NotAllowedError' })).toContain('Allow it in Chrome site controls')
  })
})
