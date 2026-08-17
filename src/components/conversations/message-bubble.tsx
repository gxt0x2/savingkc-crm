'use client'

import { useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'
import { getAgentProfile } from '@/lib/agent-profiles'
import type { CallOutcomePresentation } from '@/lib/operating-model/conversation-presentation'
import { CallReviewSubmitButton } from '@/components/call-review/call-review-submit-button'

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
  callOutcome?: CallOutcomePresentation
  fromPhone?: string
  toPhone?: string
  routingTeam?: string
}

const CALL_OUTCOME_STYLE = {
  positive: {
    border: 'border-[var(--crm-success)]/35',
    background: 'bg-[var(--crm-success-soft)]',
    text: 'text-[var(--crm-success)]',
  },
  attention: {
    border: 'border-[var(--crm-violet)]/35',
    background: 'bg-[var(--crm-violet-soft)]',
    text: 'text-[var(--crm-violet)]',
  },
  negative: {
    border: 'border-[var(--crm-brand-border)]',
    background: 'bg-[var(--crm-brand-soft)]',
    text: 'text-[var(--crm-brand)]',
  },
  neutral: {
    border: 'border-[var(--crm-border-strong)]',
    background: 'bg-[var(--crm-surface-subtle)]',
    text: 'text-[var(--crm-text-muted)]',
  },
} as const

function AgentAvatar({ agentName, fallbackInitials, size = 'w-8 h-8' }: { agentName?: string; fallbackInitials: string; size?: string }) {
  const profile = agentName ? getAgentProfile(agentName) : null
  const initials = profile?.initials || fallbackInitials
  const bg = profile?.color || 'bg-[var(--crm-charcoal)]'
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
          <div className="w-8 h-8 rounded-full bg-[var(--crm-charcoal)] text-white flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-1">
            {message.senderInitials}
          </div>
        )}
        <div className="flex-1">
          <div
            className={cn(
              'rounded-xl border p-3 text-sm leading-snug shadow-sm',
              isSent
                ? 'rounded-tr-none border-[var(--crm-border-strong)] bg-[var(--crm-info-soft)] text-[var(--crm-text)]'
                : 'rounded-tl-none border-[var(--crm-border)] bg-[var(--crm-surface)] text-[var(--crm-text)]'
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
      <div className="w-full max-w-2xl rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {isSent && message.agentName ? (
              <AgentAvatar agentName={message.agentName} fallbackInitials="ED" size="w-8 h-8" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--crm-info)]">
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
  const outcome = message.callOutcome ?? {
    key: 'pending',
    label: 'Outcome pending',
    icon: 'schedule',
    tone: 'neutral',
  }
  const outcomeStyle = CALL_OUTCOME_STYLE[outcome.tone]

  return (
    <div className={cn('flex', isSent ? 'justify-end' : 'justify-start')}>
      <div className="max-w-[480px] w-full">
        {/* Call header */}
        <div className="flex items-center gap-2 mb-2 px-1">
          {isSent ? (
            <AgentAvatar agentName={message.agentName} fallbackInitials={message.senderInitials} />
          ) : (
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--crm-charcoal)] text-[10px] font-bold text-white">
              {message.senderInitials}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--crm-text-muted)]">
            <Icon name={isSent ? 'call_made' : 'call_received'} className={cn('text-sm', outcomeStyle.text)} />
            <span>{isSent ? `Outgoing call${message.agentName ? ` by ${message.agentName}` : ''}` : 'Incoming call'}</span>
            <span className="text-on-surface-variant/40">·</span>
            <span>{message.timestamp}</span>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4 text-[var(--crm-text)] shadow-sm">
          <div className="flex items-start gap-3">
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full border', outcomeStyle.border, outcomeStyle.background)}>
              <Icon name={outcome.icon} className={cn('text-lg', outcomeStyle.text)} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide', outcomeStyle.border, outcomeStyle.background, outcomeStyle.text)}>
                  {outcome.label}
                </span>
                {message.routingTeam ? (
                  <span className="text-xs font-semibold text-[var(--crm-text-muted)]">Team · {message.routingTeam}</span>
                ) : null}
              </div>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-lg bg-[var(--crm-surface-subtle)] px-3 py-2">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--crm-text-dim)]">From</dt>
                  <dd className="mt-0.5 font-semibold text-[var(--crm-ink)]">{message.fromPhone || 'Unknown caller'}</dd>
                </div>
                <div className="rounded-lg bg-[var(--crm-surface-subtle)] px-3 py-2">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--crm-text-dim)]">To</dt>
                  <dd className="mt-0.5 font-semibold text-[var(--crm-ink)]">{message.toPhone || 'Team line unavailable'}</dd>
                </div>
              </dl>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--crm-text-dim)]">Duration</p>
              <p className="mt-1 text-sm font-bold text-[var(--crm-ink)]">{message.callDuration || '—'}</p>
            </div>
          </div>

          {message.recordingUrl ? (
            <div className="mt-4 border-t border-[var(--crm-border)] pt-4">
              <audio
                ref={audioRef}
                src={message.recordingUrl}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={handleEnded}
                preload="metadata"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={playing ? 'Pause call recording' : 'Play call recording'}
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all',
                    'bg-[var(--crm-brand)] hover:bg-[var(--crm-brand-hover)]'
                  )}
                >
                  <Icon
                    name={playing ? 'pause' : 'play_arrow'}
                    className="text-lg text-white"
                    filled
                  />
                </button>

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
                    className="h-1.5 w-full cursor-pointer accent-[var(--crm-brand)]"
                    style={{ backgroundSize: `${progress}% 100%` }}
                  />
                  <div className="flex justify-between text-[10px] text-[var(--crm-text-muted)]">
                    <span>{fmtTime(currentTime)}</span>
                    <span>{duration > 0 ? fmtTime(duration) : message.callDuration || '—'}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={cycleSpeed}
                    aria-label={`Playback speed ${speed} times`}
                    className="rounded px-1.5 py-0.5 text-[10px] font-bold text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]"
                  >
                    {speed}x
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    aria-label="Download call recording"
                    className="rounded p-1 text-[var(--crm-text-muted)] hover:bg-black/5 hover:text-[var(--crm-ink)]"
                    title="Download"
                  >
                    <Icon name="download" className="text-base" />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {message.recordingUrl ? <CallReviewSubmitButton activityId={message.id} recordingSid={message.recordingSid} recordingUrl={message.recordingUrl} durationSeconds={duration} /> : null}
        </div>

        {/* View Transcript link */}
        {message.transcript && (
          <>
            <button type="button" onClick={() => setShowTranscript((value) => !value)} aria-expanded={showTranscript} className="mt-1.5 px-1 text-xs font-bold text-[var(--crm-brand)] hover:underline">
              {showTranscript ? 'Hide transcript' : 'View transcript'}
            </button>
            {showTranscript ? <div className="mt-2 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3 text-xs leading-5 text-[var(--crm-text)]">{message.transcript}</div> : null}
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
