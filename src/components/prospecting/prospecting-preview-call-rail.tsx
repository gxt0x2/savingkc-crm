'use client'

import { useEffect, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { formatPhone } from '@/lib/format'
import type { HeirDialerQueueItem } from '@/lib/heir-dialer-queue'

type ProspectingPreviewCallRailProps = {
  campaignId: string
  callerId: string
  callerMode: string
  rotationNumbers: string
}

type PreviewCallState = 'ready' | 'live' | 'paused' | 'stopped'

const PREVIEW_OUTCOMES = [
  ['contact', 'Contact', 'person'],
  ['no_contact', 'No Contact', 'person_off'],
  ['bad_number', 'Bad Number', 'phone_disabled'],
  ['voicemail', 'Voicemail', 'mail'],
  ['dnc_contact', 'DNC Contact', 'person_off'],
  ['dnc_number', 'DNC Number', 'phone_disabled'],
] as const

type PreviewOutcomeId = typeof PREVIEW_OUTCOMES[number][0]

function emptyOutcomeCounts(): Record<PreviewOutcomeId, number> {
  return Object.fromEntries(PREVIEW_OUTCOMES.map(([id]) => [id, 0])) as Record<PreviewOutcomeId, number>
}

function callDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function ProspectingPreviewCallRail(props: ProspectingPreviewCallRailProps) {
  const [queue, setQueue] = useState<HeirDialerQueueItem[]>([])
  const [callState, setCallState] = useState<PreviewCallState>('ready')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [selectedOutcome, setSelectedOutcome] = useState<PreviewOutcomeId | null>(null)
  const [outcomeCounts, setOutcomeCounts] = useState<Record<PreviewOutcomeId, number>>(emptyOutcomeCounts)
  const queueItem = queue[0] ?? null
  const duration = callDuration(elapsedSeconds)

  useEffect(() => {
    function onQueueReady(event: Event) {
      const nextQueue = ((event as CustomEvent).detail as { queue?: HeirDialerQueueItem[] } | null)?.queue
      if (Array.isArray(nextQueue) && nextQueue.length > 0) setQueue(nextQueue)
    }
    window.addEventListener('prospecting-preview-queue-ready', onQueueReady)
    return () => window.removeEventListener('prospecting-preview-queue-ready', onQueueReady)
  }, [])

  useEffect(() => {
    if (callState !== 'live') return
    const interval = window.setInterval(() => setElapsedSeconds((current) => current + 1), 1_000)
    return () => window.clearInterval(interval)
  }, [callState])

  useEffect(() => {
    const status = callState === 'ready' ? 'Ready' : callState === 'live' ? 'Live' : callState === 'paused' ? 'Paused' : 'Stopped'
    window.dispatchEvent(new CustomEvent('prospecting-preview-status', { detail: { status } }))
    window.dispatchEvent(new CustomEvent('heir-queue-state', {
      detail: {
        queueItem,
        queueIndex: 0,
        queueLength: queue.length,
        callDuration: duration,
        outcomeRequired: callState === 'stopped',
        status: callState === 'live' ? 'on_call' : 'ready',
      },
    }))
  }, [callState, duration, queue.length, queueItem])

  function startDialing() {
    setSelectedOutcome(null)
    setElapsedSeconds(0)
    setCallState('live')
  }

  function recordOutcome(id: PreviewOutcomeId) {
    setSelectedOutcome(id)
    setOutcomeCounts((current) => ({ ...current, [id]: current[id] + 1 }))
    setCallState('stopped')
  }

  return <section aria-label="Preview prospecting call controls" className="prospecting-dialer-control-surface flex h-full min-h-0 flex-col bg-[var(--prospecting-panel)] text-[var(--ck-text)]">
    <p className="sr-only">Read-only review for campaign {props.campaignId}, calling from {formatPhone(props.callerId) || props.callerId}. No phone call or CRM write will be made.</p>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <header className="flex items-start justify-between gap-2 border-b border-[var(--prospecting-border)] pb-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em]">Call outcome</h2>
          <p className={`mt-1 text-xs font-medium ${callState === 'ready' ? 'text-[var(--prospecting-primary)]' : callState === 'live' ? 'text-[var(--prospecting-success)]' : callState === 'paused' ? 'text-[var(--prospecting-warning-ink)]' : 'text-[var(--prospecting-danger)]'}`}>
            {callState === 'ready' ? 'Ready to dial' : callState === 'live' ? 'Connected' : callState === 'paused' ? 'Paused' : 'Call ended'} · {duration}
          </p>
        </div>
        <span title="No call or CRM changes are made from this review" className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[9px] font-semibold text-white/70">Preview only</span>
      </header>

      {callState === 'ready' ? <button type="button" onClick={startDialing} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[var(--prospecting-primary)] px-3 text-sm font-semibold text-[var(--prospecting-on-primary)] transition-colors hover:bg-[var(--prospecting-primary-strong)]"><Icon name="play_arrow" size="text-lg" filled />Start dialing</button> : null}

      <div className="mt-3 space-y-2" aria-label="Preview dispositions">
        {PREVIEW_OUTCOMES.map(([id, label, icon]) => <button
          key={id}
          type="button"
          aria-label={label}
          aria-pressed={selectedOutcome === id}
          disabled={callState !== 'live' && callState !== 'paused'}
          onClick={() => recordOutcome(id)}
          className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${selectedOutcome === id ? 'border-white bg-[#b9132b] ring-2 ring-white/40' : 'border-[#df3349] bg-[#c91934] enabled:hover:border-[#f46a7c] enabled:hover:bg-[#b9132b]'}`}
        >
          <Icon name={icon} size="text-sm" className="shrink-0 text-white" />
          <span className="min-w-0 flex-1">{label}</span>
          <span aria-hidden="true" className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-white px-1 text-[10px] font-black tabular-nums text-[#222831]">{outcomeCounts[id]}</span>
        </button>)}
      </div>

      <div className="mt-3 grid gap-1.5 border-t border-white/15 pt-3">
        <button type="button" onClick={startDialing} disabled={callState !== 'stopped'} className="prospecting-dialer-secondary-button"><Icon name="phone_callback" size="text-sm" className="text-[#8fce47]" />Redial</button>
        <button type="button" onClick={() => setCallState('stopped')} disabled={callState !== 'live' && callState !== 'paused'} className="prospecting-dialer-secondary-button"><Icon name="call_end" size="text-sm" />Hang up</button>
        <button type="button" onClick={() => setCallState((current) => current === 'paused' ? 'live' : 'paused')} disabled={callState !== 'live' && callState !== 'paused'} className="prospecting-dialer-secondary-button"><Icon name={callState === 'paused' ? 'play_arrow' : 'pause'} size="text-sm" />{callState === 'paused' ? 'Resume' : 'Pause'}</button>
        <button type="button" onClick={() => setCallState('stopped')} disabled={callState === 'ready' || callState === 'stopped'} className="prospecting-dialer-secondary-button"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-[#ff183c]" />Stop</button>
      </div>
    </div>
  </section>
}
