'use client'

import { useRef, useState, type RefObject } from 'react'
import { Icon } from '@/components/ui/icon'

const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

export function finiteSeconds(value: number | null | undefined) {
  return Number.isFinite(value) && Number(value) >= 0 ? Math.floor(Number(value)) : 0
}

export function formatPlaybackTime(value: number | null | undefined) {
  const seconds = finiteSeconds(value)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remaining = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`
}

export function CallReviewAudioPlayer({
  src,
  audioRef,
  knownDuration = 0,
  label = 'Original call recording',
  onEnded,
  onPositionChange,
  onDurationChange,
  compact = false,
}: {
  src: string
  audioRef?: RefObject<HTMLAudioElement | null>
  knownDuration?: number
  label?: string
  onEnded?: () => void
  onPositionChange?: (seconds: number) => void
  onDurationChange?: (seconds: number) => void
  compact?: boolean
}) {
  const internalAudioRef = useRef<HTMLAudioElement | null>(null)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(finiteSeconds(knownDuration))
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  function bindAudio(node: HTMLAudioElement | null) {
    internalAudioRef.current = node
    if (audioRef) audioRef.current = node
  }

  function syncDuration(audio: HTMLAudioElement) {
    const next = finiteSeconds(audio.duration) || finiteSeconds(knownDuration)
    setDuration(next)
    onDurationChange?.(next)
  }

  function syncPosition(audio: HTMLAudioElement) {
    const next = finiteSeconds(audio.currentTime)
    setPosition(next)
    onPositionChange?.(next)
  }

  function seek(seconds: number) {
    const internalAudio = internalAudioRef.current
    if (!internalAudio) return
    const next = Math.max(0, Math.min(seconds, duration || finiteSeconds(knownDuration)))
    internalAudio.currentTime = next
    setPosition(next)
    onPositionChange?.(next)
  }

  async function togglePlayback() {
    const internalAudio = internalAudioRef.current
    if (!internalAudio) return
    if (internalAudio.paused) await internalAudio.play()
    else internalAudio.pause()
  }

  function restart() {
    const internalAudio = internalAudioRef.current
    if (!internalAudio) return
    seek(0)
    void internalAudio.play()
  }

  function changeSpeed(next: number) {
    setSpeed(next)
    if (internalAudioRef.current) internalAudioRef.current.playbackRate = next
  }

  return (
    <div className={`rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] ${compact ? 'p-3' : 'p-4'}`}>
      <audio
        ref={bindAudio}
        aria-label={label}
        preload="metadata"
        src={src}
        onLoadedMetadata={(event) => syncDuration(event.currentTarget)}
        onDurationChange={(event) => syncDuration(event.currentTarget)}
        onTimeUpdate={(event) => syncPosition(event.currentTarget)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); onEnded?.() }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void togglePlayback()} aria-label={playing ? 'Pause original call' : 'Play original call'} className="crm-primary-button inline-flex h-10 items-center gap-2 rounded-lg px-4 text-xs font-black">
          <Icon name={playing ? 'pause' : 'play_arrow'} />{playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={restart} className="crm-secondary-button inline-flex h-10 items-center gap-2 rounded-lg px-3 text-xs font-black">
          <Icon name="replay" />Restart
        </button>
        <label className="ml-auto flex items-center gap-2 text-[11px] font-black text-[var(--crm-text-muted)]">
          Speed
          <select aria-label="Playback speed" value={speed} onChange={(event) => changeSpeed(Number(event.target.value))} className="crm-field h-10 rounded-lg px-2 text-xs font-black">
            {PLAYBACK_SPEEDS.map((value) => <option key={value} value={value}>{value}x</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="min-w-[98px] font-mono text-xs font-black" aria-label="Playback elapsed and total time">{formatPlaybackTime(position)} / {formatPlaybackTime(duration || knownDuration)}</span>
        <input aria-label="Original call position" type="range" min={0} max={Math.max(duration || finiteSeconds(knownDuration), 1)} step={0.1} value={position} onChange={(event) => seek(Number(event.target.value))} className="w-full" />
      </div>
    </div>
  )
}
