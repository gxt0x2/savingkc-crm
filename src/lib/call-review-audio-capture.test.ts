/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { monitorMicrophoneSignal } from './call-review-audio-capture'

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
})
