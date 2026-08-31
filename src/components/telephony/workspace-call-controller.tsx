'use client'

import { Icon } from '@/components/ui/icon'
import type { DialerCallerPlan } from '@/lib/dialer-caller-plan'
import { formatPhone } from '@/lib/format'
import type { HeirDialerQueueItem } from '@/lib/heir-dialer-queue'
import { FIRST_DIAL_COUNTDOWN_SECONDS } from './use-dialer-start-countdown'

type WorkspaceCallControllerProps = {
  autoStartCountdownSeconds?: number | null
  callerPlan: DialerCallerPlan
  countdownPaused?: boolean
  dialDisplay: string
  dialReady: boolean
  effectiveCallerId: string
  loadingSessionQueue?: boolean
  onCall: () => void
  onPauseAutoStart?: () => void
  previewOnly?: boolean
  queueItem: HeirDialerQueueItem | null
  statusLabel: string
}

export function WorkspaceCallController({
  autoStartCountdownSeconds = null,
  callerPlan,
  countdownPaused = false,
  dialDisplay,
  dialReady,
  effectiveCallerId,
  loadingSessionQueue = false,
  onCall,
  onPauseAutoStart,
  previewOnly = false,
  queueItem,
  statusLabel,
}: WorkspaceCallControllerProps) {
  if (loadingSessionQueue) {
    return (
      <section role="status" aria-label="Loading calling session" className="mx-1 rounded-2xl border border-[var(--skc-separator)] bg-[var(--skc-surface-soft)] p-5 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[var(--skc-surface-3)]"><Icon name="progress_activity" className="animate-spin text-2xl text-[var(--skc-text-secondary)]" /></span>
        <p className="mt-4 text-sm font-black text-[var(--skc-text-primary)]">Loading call controls</p>
        <p className="mt-1 text-xs leading-5 text-[var(--skc-text-tertiary)]">Restoring the saved seller, number, and session policy.</p>
      </section>
    )
  }

  if (autoStartCountdownSeconds !== null) {
    const previewComplete = previewOnly && autoStartCountdownSeconds === 0
    const waitingForPhone = autoStartCountdownSeconds === 0 && statusLabel !== 'Ready'
    return (
      <section aria-label="First call countdown" className="mx-1 rounded-2xl border border-[#E32E2E]/30 bg-[var(--skc-surface-soft)] p-5 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#FF6868]">Calling session ready</p>
        <p aria-live="polite" className="mt-3 text-sm font-semibold text-[var(--skc-text-secondary)]">
          {autoStartCountdownSeconds > 0 ? 'First call starts in' : previewComplete ? 'Preview complete — no call placed' : waitingForPhone ? 'Countdown complete' : 'Starting first call'}
        </p>
        <p className="mt-1 font-mono text-6xl font-black tabular-nums tracking-[-0.06em] text-[var(--skc-text-primary)]">
          {autoStartCountdownSeconds > 0 ? autoStartCountdownSeconds : previewComplete ? '0' : waitingForPhone ? '—' : '0'}
        </p>
        {queueItem ? <div className="mt-3">
          <p className="truncate text-lg font-black text-[var(--skc-text-primary)]">{queueItem.heirName}</p>
          <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--skc-text-secondary)]">{dialDisplay}</p>
        </div> : <p className="mt-2 text-xs leading-5 text-[var(--skc-text-tertiary)]">Loading the first reviewed seller number</p>}
        {previewComplete ? <p className="mt-2 text-xs font-semibold text-[var(--skc-text-tertiary)]">Production would begin the first reviewed call now.</p> : waitingForPhone ? <p className="mt-2 text-xs font-semibold text-[var(--skc-text-tertiary)]">Waiting for phone connection · {statusLabel}</p> : null}
        <div role="progressbar" aria-label="Time until first call" aria-valuemin={0} aria-valuemax={FIRST_DIAL_COUNTDOWN_SECONDS} aria-valuenow={FIRST_DIAL_COUNTDOWN_SECONDS - autoStartCountdownSeconds} className="mt-5 h-1.5 overflow-hidden rounded-full bg-[var(--skc-surface-3)]">
          <div className="h-full rounded-full bg-[#E32E2E] transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, ((FIRST_DIAL_COUNTDOWN_SECONDS - autoStartCountdownSeconds) / FIRST_DIAL_COUNTDOWN_SECONDS) * 100)}%` }} />
        </div>
        {previewOnly ? <button type="button" onClick={onPauseAutoStart} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--skc-separator)] bg-[var(--skc-surface-3)] px-4 text-sm font-bold text-[var(--skc-text-primary)] hover:bg-[var(--skc-surface-2)]">
          <Icon name={previewComplete ? 'replay' : countdownPaused ? 'play_arrow' : 'pause_circle'} size="text-lg" /> {previewComplete ? 'Restart countdown' : countdownPaused ? 'Resume countdown' : 'Pause countdown preview'}
        </button> : <p className="mt-4 text-xs font-semibold text-[var(--skc-text-tertiary)]">Pause session below to stop the countdown.</p>}
      </section>
    )
  }

  return (
    <section aria-label="Next contact" className="mx-1 rounded-2xl border border-[var(--skc-separator)] bg-[var(--skc-surface-soft)] p-4 text-center">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--skc-text-tertiary)]">
        {queueItem ? 'Next contact' : 'Choose a number from the seller list'}
      </p>
      {queueItem ? (
        <div className="mt-3">
          <h2 className="truncate text-2xl font-black tracking-[-0.03em] text-[var(--skc-text-primary)]">{queueItem.heirName}</h2>
          <p className="mt-1 text-xs font-bold capitalize text-[var(--skc-text-tertiary)]">{queueItem.relation}</p>
          <p className="mt-3 font-mono text-lg font-semibold tabular-nums text-[var(--skc-text-secondary)]">{dialDisplay}</p>
        </div>
      ) : <p className="mt-3 font-mono text-[28px] font-semibold tabular-nums tracking-[-0.03em] text-[var(--skc-text-primary)]">—</p>}
      <button
        type="button"
        onClick={onCall}
        disabled={!dialReady}
        className="mx-auto mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#30D158] px-5 py-3 text-sm font-black text-white shadow-lg shadow-[#30D158]/20 transition-colors hover:bg-[#28B14B] disabled:cursor-not-allowed disabled:opacity-40"
        title={dialReady ? 'Call selected number' : 'Waiting for Twilio'}
      >
        <Icon name="call" size="text-xl" filled />
        {dialReady ? 'Call selected number' : statusLabel}
      </button>
      <div className="mt-4 flex items-start justify-between gap-3 border-t border-[var(--skc-separator)] pt-3 text-left">
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--skc-text-tertiary)]">Calling from</p>
          <p className="mt-1 truncate text-xs font-semibold text-[var(--skc-text-primary)]">
          {queueItem
            ? effectiveCallerId
              ? formatPhone(effectiveCallerId)
              : 'No approved line available'
            : 'Select a seller number'}
          </p>
        </div>
        {queueItem ? <span className="shrink-0 rounded-full bg-[var(--skc-surface-3)] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-[var(--skc-text-tertiary)]">{callerPlan.mode === 'rotation' && callerPlan.rotationCallerIds.length > 1 ? `${callerPlan.rotationCallerIds.length} lines` : 'Campaign'}</span> : null}
      </div>
    </section>
  )
}
