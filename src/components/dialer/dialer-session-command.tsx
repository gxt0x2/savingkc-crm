'use client'

import { useEffect, useEffectEvent, useState } from 'react'

import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'

type SessionStatus = 'active' | 'paused' | 'completed' | 'stopped'
type CallStatus = 'offline' | 'connecting' | 'ready' | 'calling' | 'on_call' | 'incoming'

interface SessionQueueState {
  queueItem: { phone: string; heirName: string; relation: string } | null
  queueIndex: number
  queueLength: number
  callDuration?: string | null
  outcomeRequired?: boolean
  status: CallStatus
}

interface DialerSessionCommandProps {
  queueLabel: string
  currentLabel: string
  currentIndex: number
  queueSize: number
  durableStatus?: SessionStatus
  stopRequested?: boolean
  queueState: SessionQueueState | null
  actionPending: boolean
  error: string | null
  readOnlyPreview?: boolean
  controlUnavailable?: boolean
  onPause: () => void
  onResume: () => void
  onEndSession: () => void
  onMarkDead: () => void
  onSkip: () => void
}

export function DialerSessionCommand(props: DialerSessionCommandProps) {
  const [confirmEndOpen, setConfirmEndOpen] = useState(false)
  const [previewStatus, setPreviewStatus] = useState('Ready')
  const endSessionDialogRef = useDialogAccessibility<HTMLElement>(confirmEndOpen, () => setConfirmEndOpen(false))
  const mutationControlsLocked = Boolean(props.readOnlyPreview || props.controlUnavailable)
  const isCalling = Boolean(props.queueState?.queueItem && ['calling', 'on_call'].includes(props.queueState.status))
  const isPaused = props.durableStatus === 'paused'
  const statusLabel = props.controlUnavailable
    ? 'Open elsewhere'
    : props.readOnlyPreview
      ? previewStatus
      : props.queueState?.outcomeRequired
        ? 'Outcome required'
        : props.queueState?.status === 'on_call'
          ? 'Connected'
          : props.queueState?.status === 'calling'
            ? 'Dialing'
            : props.stopRequested
              ? 'Ending after outcome'
              : isPaused
                ? 'Paused'
                : 'Ready'
  const statusValue = props.readOnlyPreview && previewStatus !== 'Live'
    ? previewStatus
    : props.queueState?.status === 'on_call'
    ? `Live${props.queueState.callDuration ? ` · ${props.queueState.callDuration}` : ''}`
    : props.queueState?.callDuration && statusLabel === 'Dialing'
      ? `${statusLabel} · ${props.queueState.callDuration}`
      : statusLabel
  const statusTone = props.controlUnavailable || props.stopRequested || props.queueState?.outcomeRequired
    ? 'bg-[var(--prospecting-warning)] text-[var(--prospecting-on-warning)]'
    : statusLabel === 'Connected' || statusLabel === 'Dialing' || previewStatus === 'Live'
      ? 'bg-[var(--prospecting-success-strong)] text-white'
      : statusLabel === 'Paused' || previewStatus === 'Paused'
        ? 'bg-[var(--prospecting-warning)] text-[var(--prospecting-on-warning)]'
        : previewStatus === 'Stopped'
          ? 'bg-[var(--prospecting-danger-soft)] text-[var(--prospecting-danger)]'
          : 'bg-[var(--prospecting-elevated)] text-[var(--ck-text)]'

  useEffect(() => {
    if (!props.readOnlyPreview) return
    function onPreviewStatus(event: Event) {
      const status = (event as CustomEvent).detail?.status
      if (status === 'Ready' || status === 'Paused' || status === 'Outcome required' || status === 'Live' || status === 'Stopped') setPreviewStatus(status)
    }
    window.addEventListener('prospecting-preview-status', onPreviewStatus)
    return () => window.removeEventListener('prospecting-preview-status', onPreviewStatus)
  }, [props.readOnlyPreview])

  const onSessionCommand = useEffectEvent((event: Event) => {
    if (mutationControlsLocked || props.actionPending) return
    const detail = (event as CustomEvent).detail as { action?: string } | null
    if (detail?.action === 'pause') props.onPause()
    if (detail?.action === 'resume') props.onResume()
    if (detail?.action === 'end') setConfirmEndOpen(true)
    if (detail?.action === 'skip') props.onSkip()
    if (detail?.action === 'dead') props.onMarkDead()
  })

  useEffect(() => {
    window.addEventListener('prospecting-session-command', onSessionCommand)
    return () => window.removeEventListener('prospecting-session-command', onSessionCommand)
  }, [])

  return <>
    <section aria-label="Calling session summary" className="sticky top-0 z-50 grid min-h-[54px] grid-cols-2 overflow-hidden border-b border-[var(--prospecting-border-strong)] bg-[var(--prospecting-header)] sm:grid-cols-4">
      {[
        ['Status', statusValue, statusTone],
        ['List', props.queueLabel, 'bg-[var(--prospecting-header)] text-[var(--ck-text)]'],
        ['Current', props.currentLabel, 'bg-[var(--prospecting-header)] text-[var(--ck-text)]'],
        ['Progress', `${props.currentIndex + 1} / ${props.queueSize}`, 'bg-[var(--prospecting-header)] text-[var(--ck-text)]'],
      ].map(([label, value, tone]) => <div key={label} className={`min-w-0 border-b border-r border-[var(--prospecting-border)] px-3 py-2.5 last:border-r-0 sm:border-b-0 ${tone}`}>
        <span className="block text-[10px] font-medium uppercase tracking-[0.12em] opacity-70">{label}</span>
        <strong className="mt-0.5 block truncate text-sm font-semibold" title={value}>{value}</strong>
      </div>)}
    </section>

    {props.controlUnavailable ? <div role="status" className="mb-4 rounded-xl border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-on-warning)]">Dialing control moved to another window. The current record remains visible here, but calls and CRM changes are locked.</div> : null}
    {props.error ? <div role="alert" className="mb-4 rounded-xl border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--crm-danger)]">{props.error}</div> : null}

    {confirmEndOpen ? <div className="crm-modal-surface fixed inset-0 z-[100] grid place-items-center bg-black/45 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !props.actionPending) setConfirmEndOpen(false) }}>
      <section ref={endSessionDialogRef} role="dialog" aria-modal="true" aria-labelledby="end-session-title" tabIndex={-1} className="w-full max-w-md rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-6 text-[var(--crm-ink)] shadow-2xl">
        <p className="text-[10px] font-black uppercase tracking-widest text-[var(--crm-danger)]">End calling session</p>
        <h2 id="end-session-title" className="mt-1 text-xl font-black">Stop this session?</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--crm-text-muted)]">{isCalling ? 'The current call will hang up now. Save its outcome once, and the session will close without dialing the next number.' : 'Saved calls and outcomes are preserved. Remaining sellers stay available for a future session.'}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmEndOpen(false)} disabled={props.actionPending} className="crm-secondary-button h-10 rounded-lg px-4 text-xs font-black">Keep calling</button>
          <button type="button" onClick={() => { setConfirmEndOpen(false); props.onEndSession() }} disabled={props.actionPending} className="h-10 rounded-lg bg-[var(--crm-danger)] px-3 text-xs font-black text-white disabled:opacity-50">{props.actionPending ? 'Ending…' : isCalling ? 'End call & session' : 'End session'}</button>
        </div>
      </section>
    </div> : null}
  </>
}
