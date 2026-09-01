'use client'

import { useEffect, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'
import { formatPhone } from '@/lib/format'
import type { DialerTodayMetrics } from '@/lib/dialer-session-client'

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
  currentIndex: number
  queueSize: number
  callerId: string
  callerPolicyLabel?: string
  durableSessionId: string
  durableStatus?: SessionStatus
  stopRequested?: boolean
  todayMetrics: DialerTodayMetrics | null
  queueState: SessionQueueState | null
  controlsDocked?: boolean
  actionPending: boolean
  currentLeadId: string | null
  error: string | null
  readOnlyPreview?: boolean
  onClose: () => void
  onPause: () => void
  onResume: () => void
  onEndSession: () => void
  onMarkDead: () => void
  onPrevious: () => void
  onSkip: () => void
}

function openCallControls() {
  window.dispatchEvent(new Event('show-dialer-controls'))
}

type SessionMetricTone = 'info' | 'brand' | 'success' | 'warning'

const SESSION_METRIC_TONES: Record<SessionMetricTone, { surface: string; icon: string }> = {
  info: { surface: 'border-[var(--crm-info-border)] bg-[var(--crm-info-soft)]', icon: 'text-[var(--crm-info)]' },
  brand: { surface: 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)]', icon: 'text-[var(--crm-brand)]' },
  success: { surface: 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)]', icon: 'text-[var(--crm-success)]' },
  warning: { surface: 'border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)]', icon: 'text-[var(--crm-warning)]' },
}

function SessionMetric({ icon, label, value, tone }: { icon: string; label: string; value: number | string; tone: SessionMetricTone }) {
  const colors = SESSION_METRIC_TONES[tone]
  return <article data-tone={tone} className={`min-w-0 rounded-xl border p-3 ${colors.surface}`}>
    <div className="flex items-center gap-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--crm-surface)]"><Icon name={icon} size="text-base" className={colors.icon} /></span>
      <div className="min-w-0">
        <p className="truncate text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-muted)]">{label}</p>
        <p className="mt-0.5 truncate text-lg font-black tabular-nums text-[var(--ck-text)]">{value}</p>
      </div>
    </div>
  </article>
}

function formatDialerTime(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  const seconds = Math.max(0, Math.floor(value))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function DialerSessionCommand(props: DialerSessionCommandProps) {
  const [confirmEndOpen, setConfirmEndOpen] = useState(false)
  const [previewStatus, setPreviewStatus] = useState('Ready')
  const {
    actionPending,
    onMarkDead,
    onPause,
    onResume,
    onSkip,
    readOnlyPreview,
  } = props
  const endSessionDialogRef = useDialogAccessibility<HTMLElement>(confirmEndOpen, () => setConfirmEndOpen(false))
  const isCalling = Boolean(props.queueState?.queueItem && ['calling', 'on_call'].includes(props.queueState.status))
  const isDurable = Boolean(props.durableSessionId)
  const isPaused = props.durableStatus === 'paused'
  const canEndSession = isDurable && !props.stopRequested && Boolean(props.durableStatus && ['active', 'paused'].includes(props.durableStatus))
  const pauseLabel = isCalling
    ? 'Pause & hang up'
    : props.queueState?.outcomeRequired
      ? 'Pause after outcome'
      : 'Pause session'
  const pausedActionLabel = isCalling
    ? 'Pausing call…'
    : props.queueState?.outcomeRequired
      ? 'Paused — save outcome'
      : 'Resume session'
  const progress = Math.round(((props.currentIndex + 1) / Math.max(props.queueSize, 1)) * 100)
  const statusLabel = props.readOnlyPreview
    ? previewStatus
    : props.queueState?.outcomeRequired
    ? 'Outcome required'
    : props.queueState?.status === 'on_call'
    ? 'Connected now'
      : props.queueState?.status === 'calling'
      ? 'Dialing now'
      : props.stopRequested ? 'Ending after outcome'
        : isPaused ? 'Session paused' : 'Ready'

  useEffect(() => {
    if (!readOnlyPreview) return
    function onPreviewStatus(event: Event) {
      const status = (event as CustomEvent).detail?.status
      if (status === 'Ready' || status === 'Paused' || status === 'Outcome required') setPreviewStatus(status)
    }
    window.addEventListener('prospecting-preview-status', onPreviewStatus)
    return () => window.removeEventListener('prospecting-preview-status', onPreviewStatus)
  }, [readOnlyPreview])

  useEffect(() => {
    function onSessionCommand(event: Event) {
      if (readOnlyPreview || actionPending) return
      const detail = (event as CustomEvent).detail as { action?: string } | null
      if (detail?.action === 'pause') onPause()
      if (detail?.action === 'resume') onResume()
      if (detail?.action === 'end') setConfirmEndOpen(true)
      if (detail?.action === 'skip') onSkip()
      if (detail?.action === 'dead') onMarkDead()
    }
    window.addEventListener('prospecting-session-command', onSessionCommand)
    return () => window.removeEventListener('prospecting-session-command', onSessionCommand)
  }, [actionPending, onMarkDead, onPause, onResume, onSkip, readOnlyPreview])

  return <>
    <section aria-label="Calling floor command center" className="sticky top-0 z-50 mb-4 overflow-hidden rounded-2xl border border-[var(--ck-border-strong)] bg-[var(--ck-surface)] text-[var(--ck-text)] shadow-[var(--crm-shadow-sm)]">
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 h-56 w-56 rounded-full bg-[var(--crm-brand-soft)] blur-3xl" />
      <div className="relative px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 xl:max-w-[390px]">
            <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${isCalling ? 'animate-pulse bg-[var(--crm-success)]' : isPaused ? 'bg-[var(--crm-warning)]' : 'bg-[var(--crm-success)]'}`} /><p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-[var(--crm-brand)]">{props.queueLabel}</p></div>
            <div className="mt-1 flex items-baseline gap-2"><h1 className="truncate text-xl font-black tracking-[-0.03em]">{props.readOnlyPreview ? 'Calling workflow preview' : 'Calling session'}</h1><span className="text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">{statusLabel}</span></div>
            {!props.controlsDocked ? <p className="mt-1 truncate text-xs text-[var(--ck-text-muted)]">{props.callerPolicyLabel || (props.callerId ? `Assigned line ${formatPhone(props.callerId)}` : 'Caller ID unavailable')}</p> : null}
          </div>

          <div aria-label="Session actions" className="flex flex-wrap items-center gap-2 xl:max-w-[860px] xl:justify-end">
            {!props.controlsDocked ? <>
              {!props.readOnlyPreview ? <button type="button" onClick={openCallControls} className="crm-secondary-button inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-black">
                <Icon name="phone_in_talk" size="text-sm" /> {isCalling ? 'Current call' : 'Call controls'}
              </button> : null}
              {isCalling ? <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'hangup' } }))} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[var(--crm-danger)] px-3 text-xs font-black text-white hover:opacity-90"><Icon name="call_end" size="text-sm" />Hang up</button> : null}
              {isPaused ? <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'resume' } }))} disabled={props.actionPending || isCalling || props.queueState?.outcomeRequired} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[var(--crm-success)] px-3 text-xs font-black text-white hover:opacity-90 disabled:opacity-50"><Icon name={isCalling || props.queueState?.outcomeRequired ? 'pause_circle' : 'play_arrow'} size="text-sm" />{pausedActionLabel}</button>
                : !props.readOnlyPreview ? <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'pause' } }))} disabled={props.actionPending || props.stopRequested} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-3 text-xs font-black text-[var(--crm-on-warning)] hover:opacity-90 disabled:opacity-40"><Icon name="pause_circle" size="text-sm" />{pauseLabel}</button> : null}
              {!props.readOnlyPreview ? <button type="button" onClick={props.onMarkDead} disabled={!props.currentLeadId || props.stopRequested} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-3 text-xs font-bold text-[var(--crm-danger)] hover:border-[var(--crm-danger)] disabled:opacity-30" title="Mark this lead dead and record why"><Icon name="cancel" size="text-sm" />Dead</button> : null}
              <button type="button" onClick={props.onPrevious} disabled={isDurable || props.currentIndex === 0} className="crm-secondary-button inline-flex h-10 w-10 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-30" title="Previous seller" aria-label="Previous seller"><Icon name="chevron_left" size="text-base" /></button>
              <button type="button" onClick={props.onSkip} disabled={props.actionPending || props.stopRequested || isCalling || isPaused || (!isDurable && props.currentIndex >= props.queueSize - 1)} className="crm-primary-button inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-30" title={isDurable ? 'Skip this seller with an audited outcome' : 'Next seller'}>{isDurable ? 'Skip seller' : 'Next'}<Icon name="chevron_right" size="text-sm" /></button>
              {canEndSession ? <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('prospecting-session-command', { detail: { action: 'end' } }))} disabled={props.actionPending} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-[var(--crm-danger-border)] bg-[var(--ck-surface)] px-3 text-xs font-black text-[var(--crm-danger)] hover:bg-[var(--crm-danger-soft)] disabled:opacity-40"><Icon name="stop_circle" size="text-sm" />End session</button> : null}
            </> : null}
            <button type="button" onClick={props.onClose} disabled={props.actionPending || props.stopRequested} className="crm-secondary-button inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-black disabled:opacity-40" title="Return to campaigns; an active session is saved and paused"><Icon name="arrow_back" size="text-sm" />Back to campaigns</button>
          </div>
        </div>

        {props.readOnlyPreview ? <div role="status" className="mt-3 rounded-xl border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-on-warning)]">Preview only — calling controls are shown but disabled. In production, Resume calling restores the saved seller and loads every ready number.</div> : null}

        <section aria-label="Today’s acquisition metrics" className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
          <SessionMetric icon="timer" label="Dialer time" value={formatDialerTime(props.todayMetrics?.dialing_seconds)} tone="info" />
          <SessionMetric icon="call" label="Calls" value={props.todayMetrics?.calls ?? '—'} tone="brand" />
          <SessionMetric icon="phone_in_talk" label="Contacts" value={props.todayMetrics?.contacts ?? '—'} tone="success" />
          <SessionMetric icon="person_add" label="Leads" value={props.todayMetrics?.leads ?? '—'} tone="brand" />
          <SessionMetric icon="format_list_numbered" label="Seller progress" value={`${props.currentIndex + 1}/${props.queueSize}`} tone="warning" />
        </section>
      </div>
      <div className="relative h-1.5 bg-[var(--ck-surface-hi)]"><div className="h-full bg-[var(--crm-brand)] transition-all" style={{ width: `${progress}%` }} /><span className="sr-only">Session progress {progress}%</span></div>
    </section>
    {props.error ? <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--crm-danger)]"><span>{props.error}</span>{props.error.toLowerCase().includes('current call') ? <button type="button" onClick={openCallControls} className="shrink-0 rounded-lg bg-[var(--crm-danger)] px-3 py-2 text-xs font-black text-white">Open call controls</button> : null}</div> : null}

    {confirmEndOpen ? <div className="crm-modal-surface fixed inset-0 z-[100] grid place-items-center bg-black/45 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !props.actionPending) setConfirmEndOpen(false) }}>
      <section ref={endSessionDialogRef} role="dialog" aria-modal="true" aria-labelledby="end-session-title" tabIndex={-1} className="w-full max-w-md rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-6 text-[var(--crm-ink)] shadow-2xl">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]"><Icon name="stop_circle" className="text-2xl" /></span>
        <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-[var(--crm-danger)]">End calling session</p>
        <h2 id="end-session-title" className="mt-1 text-xl font-black">Stop this session?</h2>
        {isCalling ? <p className="mt-3 text-sm leading-6 text-[var(--crm-text-muted)]">The current call will hang up now. Save its outcome once, and the session will close without dialing the next number.</p>
          : <p className="mt-3 text-sm leading-6 text-[var(--crm-text-muted)]">Saved calls and outcomes are preserved. This session closes now; remaining sellers stay available for a future session.</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmEndOpen(false)} disabled={props.actionPending} className="crm-secondary-button h-10 rounded-lg px-4 text-xs font-black">Keep calling</button>
          <button type="button" onClick={() => { setConfirmEndOpen(false); props.onEndSession() }} disabled={props.actionPending} className="h-10 rounded-lg bg-[var(--crm-danger)] px-4 text-xs font-black text-white hover:opacity-90 disabled:opacity-50">{props.actionPending ? 'Ending…' : isCalling ? 'End call & session' : 'End session'}</button>
        </div>
      </section>
    </div> : null}
  </>
}
