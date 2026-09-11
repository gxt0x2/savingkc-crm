'use client'

import { useCallback, useRef } from 'react'
import { extractTwilioErrorMessage } from './telephony-bar-support'

function createRingbackAudio() {
  const audio = new Audio('/api/audio/us-ringback.wav')
  audio.loop = true
  return audio
}

export function useDialerRingback() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stop = useCallback(() => {
    if (!audioRef.current) return
    audioRef.current.pause()
    audioRef.current.currentTime = 0
  }, [])
  const play = useCallback(async () => {
    const audio = audioRef.current ?? createRingbackAudio()
    audioRef.current = audio
    try {
      await audio.play()
    } catch (error) {
      console.warn(`[DialerPanel] ringback playback failed: ${extractTwilioErrorMessage(error)}`)
    }
  }, [])
  return { play, stop }
}
