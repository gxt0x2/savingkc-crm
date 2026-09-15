'use client'

import { useRef, useState, type RefObject } from 'react'
const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

function PlaybackGlyph({ name }: { name: 'play' | 'pause' | 'restart' }) {
  if (name === 'play') {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor"><path d="M8 5.5v13l10-6.5z" /></svg>
  }
  if (name === 'pause') {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor"><path d="M7 5h4v14H7zm6 0h4v14h-4z" /></svg>
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11a8 8 0 1 1 2.3 6" /><path d="M4 4v7h7" /></svg>
}

function DownloadGlyph() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
}

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
  inline = false,
  className = '',
  downloadName,
}: {
  src: string
  audioRef?: RefObject<HTMLAudioElement | null>
  knownDuration?: number
  label?: string
  onEnded?: () => void
  onPositionChange?: (seconds: number) => void
  onDurationChange?: (seconds: number) => void
  compact?: boolean
  inline?: boolean
  className?: string
  downloadName?: string
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
    if (internalAudio.paused) await internalAudio.play().catch(() => undefined)
    else internalAudio.pause()
  }

  function restart() {
    const internalAudio = internalAudioRef.current
    if (!internalAudio) return
    seek(0)
    void internalAudio.play().catch(() => undefined)
  }

  function changeSpeed(next: number) {
    setSpeed(next)
    if (internalAudioRef.current) internalAudioRef.current.playbackRate = next
  }

  return (
    <div className={`rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] ${compact ? inline ? 'p-2' : 'p-2.5' : 'p-4'} ${inline ? 'flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap' : ''} ${className}`}>
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
      <div className={`flex items-center gap-2 ${inline ? 'shrink-0' : 'flex-wrap'}`}>
        <button type="button" onClick={() => void togglePlayback()} aria-label={playing ? 'Pause original call' : 'Play original call'} className={`crm-primary-button inline-flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-black ${compact ? 'w-10 px-0' : 'px-4'}`}>
          <PlaybackGlyph name={playing ? 'pause' : 'play'} /><span className={compact ? 'sr-only' : undefined}>{playing ? 'Pause' : 'Play'}</span>
        </button>
        <button type="button" onClick={restart} aria-label="Restart" className={`crm-secondary-button inline-flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-black ${compact ? 'w-10 px-0' : 'px-3'}`}>
          <PlaybackGlyph name="restart" /><span className={compact ? 'sr-only' : undefined}>Restart</span>
        </button>
        {downloadName ? <a href={src} download={downloadName} aria-label="Download call recording" className="crm-secondary-button inline-flex h-10 w-10 items-center justify-center rounded-lg"><DownloadGlyph /></a> : null}
        <label className={`${inline ? '' : 'ml-auto'} flex items-center gap-2 text-[11px] font-black text-[var(--crm-text-muted)]`}>
          <span className={compact ? 'sr-only' : undefined}>Speed</span>
          <select aria-label="Playback speed" value={speed} onChange={(event) => changeSpeed(Number(event.target.value))} className="crm-field h-10 rounded-lg px-2 text-xs font-black">
            {PLAYBACK_SPEEDS.map((value) => <option key={value} value={value}>{value}x</option>)}
          </select>
        </label>
      </div>
      <div className={`${inline ? 'flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto sm:flex-1' : 'mt-3 flex items-center gap-3'}`}>
        <span className={`${compact ? inline ? 'min-w-[76px] text-[10px]' : 'min-w-[84px] text-[11px]' : 'min-w-[98px] text-xs'} font-mono font-black`} aria-label="Playback elapsed and total time">{formatPlaybackTime(position)} / {formatPlaybackTime(duration || knownDuration)}</span>
        <input aria-label="Original call position" type="range" min={0} max={Math.max(duration || finiteSeconds(knownDuration), 1)} step={0.1} value={position} onChange={(event) => seek(Number(event.target.value))} className="w-full" />
      </div>
    </div>
  )
}
