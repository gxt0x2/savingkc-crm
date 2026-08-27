'use client'

export const REVIEW_AUDIO_BITS_PER_SECOND = 96_000
export const REVIEW_CALL_GAIN = 0.55
export const REVIEW_MICROPHONE_GAIN = 1.8
export const REVIEW_MICROPHONE_CONSTRAINTS: MediaTrackConstraints = {
  autoGainControl: false,
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
}

export async function primeCallReviewAudio(audio: HTMLAudioElement) {
  audio.currentTime = 0
  audio.loop = true
  audio.muted = true
  try {
    await audio.play()
  } catch {
    resetPrimedCallReviewAudio(audio)
    throw new Error('Seller call audio could not be loaded.')
  }
}

export function startPrimedCallReviewAudio(audio: HTMLAudioElement) {
  audio.currentTime = 0
  audio.loop = false
  audio.muted = false
}

export function resetPrimedCallReviewAudio(audio: HTMLAudioElement) {
  audio.pause()
  audio.loop = false
  audio.muted = false
}

const MINIMUM_MICROPHONE_RMS = 0.006

export function monitorMicrophoneSignal(analyser: AnalyserNode, onLevel: (level: number) => void) {
  analyser.fftSize = 512
  const samples = new Uint8Array(analyser.fftSize)
  let detected = false
  const sample = () => {
    analyser.getByteTimeDomainData(samples)
    let energy = 0
    for (const value of samples) {
      const centered = (value - 128) / 128
      energy += centered * centered
    }
    const rms = Math.sqrt(energy / samples.length)
    if (rms >= MINIMUM_MICROPHONE_RMS) detected = true
    onLevel(Math.min(1, rms * 10))
  }
  sample()
  let frame = 0
  const update = () => {
    sample()
    frame = window.requestAnimationFrame(update)
  }
  frame = window.requestAnimationFrame(update)
  return () => {
    window.cancelAnimationFrame(frame)
    onLevel(0)
    return detected
  }
}
