'use client'

import { Icon } from '@/components/ui/icon'
import type { DialerCallerPlan } from '@/lib/dialer-caller-plan'
import { formatPhone } from '@/lib/format'
import type { HeirDialerQueueItem } from '@/lib/heir-dialer-queue'
import { FIRST_DIAL_COUNTDOWN_SECONDS } from './use-dialer-start-countdown'

type WorkspaceCallControllerProps = {
  autoStartCountdownSeconds?: number | null
  callerPlan: DialerCallerPlan
  dialDisplay: string
  dialReady: boolean
  effectiveCallerId: string
  onCall: () => void
  onPauseAutoStart?: () => void
  queueItem: HeirDialerQueueItem | null
  statusLabel: string
}

export function WorkspaceCallController({
  autoStartCountdownSeconds = null,
  callerPlan,
  dialDisplay,
  dialReady,
  effectiveCallerId,
  onCall,
  onPauseAutoStart,
  queueItem,
  statusLabel,
}: WorkspaceCallControllerProps) {
  if (autoStartCountdownSeconds !== null) {
    const waitingForPhone = autoStartCountdownSeconds === 0 && statusLabel !== 'Ready'
    return (
      <section aria-label="First call countdown" className="mx-1 rounded-2xl border border-[#E32E2E]/30 bg-[var(--skc-surface-soft)] p-5 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#FF6868]">Calling session ready</p>
        <p aria-live="polite" className="mt-3 text-sm font-semibold text-[var(--skc-text-secondary)]">
          {autoStartCountdownSeconds > 0 ? 'First call starts in' : waitingForPhone ? 'Countdown complete' : 'Starting first call'}
        </p>
        <p className="mt-1 font-mono text-6xl font-black tabular-nums tracking-[-0.06em] text-[var(--skc-text-primary)]">
          {autoStartCountdownSeconds > 0 ? autoStartCountdownSeconds : waitingForPhone ? '—' : '0'}
        </p>
        {queueItem ? <div className="mt-3">
          <p className="truncate text-lg font-black text-[var(--skc-text-primary)]">{queueItem.heirName}</p>
          <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-[var(--skc-text-secondary)]">{dialDisplay}</p>
        </div> : <p className="mt-2 text-xs leading-5 text-[var(--skc-text-tertiary)]">Loading the first reviewed seller number</p>}
        {waitingForPhone ? <p className="mt-2 text-xs font-semibold text-[var(--skc-text-tertiary)]">Waiting for phone connection · {statusLabel}</p> : null}
        <div role="progressbar" aria-label="Time until first call" aria-valuemin={0} aria-valuemax={FIRST_DIAL_COUNTDOWN_SECONDS} aria-valuenow={FIRST_DIAL_COUNTDOWN_SECONDS - autoStartCountdownSeconds} className="mt-5 h-1.5 overflow-hidden rounded-full bg-[var(--skc-surface-3)]">
          <div className="h-full rounded-full bg-[#E32E2E] transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, ((FIRST_DIAL_COUNTDOWN_SECONDS - autoStartCountdownSeconds) / FIRST_DIAL_COUNTDOWN_SECONDS) * 100)}%` }} />
        </div>
        <button type="button" onClick={onPauseAutoStart} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--skc-separator)] bg-[var(--skc-surface-3)] px-4 text-sm font-bold text-[var(--skc-text-primary)] hover:bg-[var(--skc-surface-2)]">
          <Icon name="pause" size="text-lg" /> Pause before first call
        </button>
      </section>
    )
  }

  return (
    <div className="mx-1 rounded-2xl border border-[var(--skc-separator)] bg-[var(--skc-surface-soft)] p-5 text-center">
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
      <div className="mt-4 border-t border-[var(--skc-separator)] pt-4 text-left">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--skc-text-tertiary)]">Calling from</p>
          {queueItem ? <span className="rounded-full bg-[var(--skc-surface-3)] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-[var(--skc-text-tertiary)]">{callerPlan.mode === 'rotation' && callerPlan.rotationCallerIds.length > 1 ? 'Rotation' : 'Campaign line'}</span> : null}
        </div>
        <p className="mt-1.5 text-sm font-semibold text-[var(--skc-text-primary)]">
          {queueItem
            ? effectiveCallerId
              ? formatPhone(effectiveCallerId)
              : 'No approved line available'
            : 'Select a seller number'}
        </p>
        {queueItem && callerPlan.mode === 'rotation' && callerPlan.rotationCallerIds.length > 1 ? <p className="mt-1 text-[10px] font-semibold text-[var(--skc-text-tertiary)]">{callerPlan.rotationCallerIds.length} approved lines · rotates every {callerPlan.rotateEveryCalls} calls</p> : null}
      </div>
    </div>
  )
}
