/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { monitorMicrophoneSignal, primeCallReviewAudio, startPrimedCallReviewAudio } from './call-review-audio-capture'

describe('call review microphone signal validation', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rejects a seller-only recording with no reviewer microphone energy', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    const analyser = {
      fftSize: 0,
      getByteTimeDomainData: (samples: Uint8Array) => samples.fill(128),
    } as unknown as AnalyserNode

    const stop = monitorMicrophoneSignal(analyser, vi.fn())

    expect(stop()).toBe(false)
  })

  it('accepts a recording only after reviewer microphone energy is present', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    const analyser = {
      fftSize: 0,
      getByteTimeDomainData: (samples: Uint8Array) => samples.fill(136),
    } as unknown as AnalyserNode

    const stop = monitorMicrophoneSignal(analyser, vi.fn())

    expect(stop()).toBe(true)
  })

  it('primes seller audio before the asynchronous microphone permission prompt', async () => {
    const audio = document.createElement('audio')
    vi.spyOn(audio, 'play').mockResolvedValue()

    await primeCallReviewAudio(audio)
    expect(audio.muted).toBe(true)
    expect(audio.loop).toBe(true)

    startPrimedCallReviewAudio(audio)
    expect(audio.currentTime).toBe(0)
    expect(audio.muted).toBe(false)
    expect(audio.loop).toBe(false)
  })

  it('reports an unavailable seller recording before requesting microphone audio', async () => {
    const audio = document.createElement('audio')
    vi.spyOn(audio, 'play').mockRejectedValue(new DOMException('Not supported', 'NotSupportedError'))
    vi.spyOn(audio, 'pause').mockImplementation(() => {})

    await expect(primeCallReviewAudio(audio)).rejects.toThrow('Seller call audio could not be loaded.')
    expect(audio.muted).toBe(false)
    expect(audio.loop).toBe(false)
  })
})
