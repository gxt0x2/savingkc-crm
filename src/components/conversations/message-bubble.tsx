'use client'

import { useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'
import { getAgentProfile } from '@/lib/agent-profiles'

export type MessageType = 'sms' | 'email' | 'call'
export type MessageDirection = 'sent' | 'received'

export interface Message {
  id: string
  type: MessageType
  direction: MessageDirection
  content: string
  timestamp: string
  senderInitials: string
  agentName?: string     // Agent who performed the action (Ernest, Casey, System, etc.)
  // email-specific
  subject?: string
  emailMeta?: string
  // call-specific
  callDuration?: string
  recordingUrl?: string   // proxied URL like /api/recordings/RExxxxxxx
  recordingSid?: string
  transcript?: string
}

function AgentAvatar({ agentName, fallbackInitials, size = 'w-8 h-8' }: { agentName?: string; fallbackInitials: string; size?: string }) {
  const profile = agentName ? getAgentProfile(agentName) : null
  const initials = profile?.initials || fallbackInitials
  const bg = profile?.color || 'bg-slate-800'
  const text = profile?.textColor || 'text-white'

  return (
    <div className={cn(size, 'rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold', bg, text)} title={profile?.name || agentName}>
      {initials}
    </div>
  )
}

function SmsBubble({ message }: { message: Message }) {
  const isSent = message.direction === 'sent'

  return (
    <div className={cn('flex', isSent ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex gap-3 max-w-[70%]', isSent && 'justify-end')}>
        {!isSent && (
          <div className="w-8 h-8 rounded-full bg-slate-300 text-slate-800 flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-1">
            {message.senderInitials}
          </div>
        )}
        <div className="flex-1">
          <div
            className={cn(
              'rounded-xl border p-3 text-sm leading-snug shadow-sm',
              isSent
                ? 'rounded-tr-none border-[#7ab98d] bg-[#f3faf5] text-[#183326]'
                : 'rounded-tl-none border-[#d9dee5] bg-white text-[#253247]'
            )}
          >
            {message.content}
          </div>
          <span
            className={cn(
              'text-[10px] text-on-surface-variant/50 mt-1 block px-1',
              isSent && 'text-right'
            )}
          >
            {isSent ? `Sent by ${message.agentName || 'System'}` : 'Received'} &bull; {message.timestamp}
          </span>
        </div>
        {isSent && (
          <AgentAvatar agentName={message.agentName} fallbackInitials={message.senderInitials} size="w-8 h-8 mt-1" />
        )}
      </div>
    </div>
  )
}

function EmailCard({ message }: { message: Message }) {
  const isSent = message.direction === 'sent'
  return (
    <div className="flex justify-start">
      <div className="max-w-2xl w-full bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {isSent && message.agentName ? (
              <AgentAvatar agentName={message.agentName} fallbackInitials="ED" size="w-8 h-8" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center">
                <Icon name="mail" className="text-white text-sm" />
              </div>
            )}
            <div>
              <h4 className="text-sm font-bold">{message.subject}</h4>
              <p className="text-[10px] text-on-surface-variant/60">
                {isSent && message.agentName ? `Sent by ${message.agentName}` : message.emailMeta || 'Received'} &bull; {message.timestamp}
              </p>
            </div>
          </div>
          <Icon name="expand_more" className="text-on-surface-variant/40" />
        </div>
        <div className="text-sm text-on-surface-variant leading-relaxed">
          {message.content}
        </div>
      </div>
    </div>
  )
}

function CallCard({ message }: { message: Message }) {
  const isSent = message.direction === 'sent'
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [showTranscript, setShowTranscript] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (playing) { audio.pause(); setPlaying(false) }
    else { audio.play(); setPlaying(true) }
  }

  function handleTimeUpdate() {
    setCurrentTime(audioRef.current?.currentTime || 0)
  }

  function handleLoadedMetadata() {
    setDuration(audioRef.current?.duration || 0)
  }

  function handleEnded() {
    setPlaying(false)
    setCurrentTime(0)
  }

  function cycleSpeed() {
    const speeds = [1, 1.5, 2]
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length]
    setSpeed(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  function handleDownload() {
    if (!message.recordingUrl) return
    const a = document.createElement('a')
    a.href = message.recordingUrl
    a.download = `call-${message.id}.mp3`
    a.click()
  }

  function fmtTime(s: number) {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className={cn('flex', isSent ? 'justify-end' : 'justify-start')}>
      <div className="max-w-[480px] w-full">
        {/* Call header */}
        <div className="flex items-center gap-2 mb-2 px-1">
          {isSent ? (
            <AgentAvatar agentName={message.agentName} fallbackInitials={message.senderInitials} />
          ) : (
            <div className="w-8 h-8 rounded-full bg-slate-300 text-slate-800 flex-shrink-0 flex items-center justify-center text-[10px] font-bold">
              {message.senderInitials}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-on-surface-variant font-medium">
            <Icon name={isSent ? 'call_made' : 'call_received'} className="text-sm text-[#df3038]" />
            <span>{isSent ? `Outgoing call${message.agentName ? ` by ${message.agentName}` : ''}` : 'Incoming call'}</span>
            <span className="text-on-surface-variant/40">·</span>
            <span>{message.timestamp}</span>
          </div>
        </div>

        {/* Audio player card */}
        <div className={cn(
            'rounded-xl border p-4 shadow-sm',
            isSent
            ? 'border-[#cfd6dd] bg-white text-[#253247]'
            : 'border-[#d9dee5] bg-white text-[#253247]'
        )}>
          {message.recordingUrl ? (
            <>
              <audio
                ref={audioRef}
                src={message.recordingUrl}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={handleEnded}
                preload="metadata"
              />
              {/* Player row */}
              <div className="flex items-center gap-3">
                {/* Play/pause */}
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={playing ? 'Pause call recording' : 'Play call recording'}
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all',
                    'bg-[#df3038] hover:bg-[#c9232d]'
                  )}
                >
                  <Icon
                    name={playing ? 'pause' : 'play_arrow'}
                    className="text-lg text-white"
                    filled
                  />
                </button>

                {/* Waveform / progress bar */}
                <div className="flex-1 flex flex-col gap-1">
                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={Math.min(currentTime, duration || 0)}
                    onChange={(event) => {
                      const nextTime = Number(event.target.value)
                      setCurrentTime(nextTime)
                      if (audioRef.current) audioRef.current.currentTime = nextTime
                    }}
                    aria-label="Call recording position"
                    className="h-1.5 w-full cursor-pointer accent-[#df3038]"
                    style={{ backgroundSize: `${progress}% 100%` }}
                  />
                  <div className={cn('flex justify-between text-[10px]', isSent ? 'text-slate-500' : 'text-on-surface-variant/50')}>
                    <span>{fmtTime(currentTime)}</span>
                    <span>{duration > 0 ? fmtTime(duration) : message.callDuration || '—'}</span>
                  </div>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={cycleSpeed}
                    aria-label={`Playback speed ${speed} times`}
                    className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', isSent ? 'text-slate-600 hover:text-slate-900' : 'text-on-surface-variant hover:text-on-surface')}
                  >
                    {speed}x
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    aria-label="Download call recording"
                    className={cn('p-1 rounded hover:bg-black/5', isSent ? 'text-slate-600 hover:text-slate-900' : 'text-on-surface-variant')}
                    title="Download"
                  >
                    <Icon name="download" className="text-base" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* No recording — just show call info */
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-10 h-10 rounded-full flex items-center justify-center',
                isSent ? 'bg-[#e8f5ec]' : 'bg-slate-200'
              )}>
                <Icon name="missed_call_badge" className="text-lg" />
              </div>
              <div className="flex-1">
                <p className={cn('text-sm font-semibold', isSent ? 'text-[#203047]' : 'text-on-surface')}>
                  {message.content}
                </p>
                <p className={cn('text-xs mt-0.5', isSent ? 'text-slate-500' : 'text-on-surface-variant/60')}>
                  Duration: {message.callDuration || '—'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* View Transcript link */}
        {message.transcript && (
          <>
            <button type="button" onClick={() => setShowTranscript((value) => !value)} aria-expanded={showTranscript} className="mt-1.5 px-1 text-xs font-bold text-[#b91c26] hover:underline">
              {showTranscript ? 'Hide transcript' : 'View transcript'}
            </button>
            {showTranscript ? <div className="mt-2 rounded-lg border border-[#d9dee5] bg-white p-3 text-xs leading-5 text-[#475467]">{message.transcript}</div> : null}
          </>
        )}
      </div>
    </div>
  )
}

export function MessageBubble({ message }: { message: Message }) {
  switch (message.type) {
    case 'email':
      return <EmailCard message={message} />
    case 'call':
      return <CallCard message={message} />
    default:
      return <SmsBubble message={message} />
  }
}
