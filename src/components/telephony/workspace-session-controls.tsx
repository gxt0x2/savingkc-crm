'use client'

import { Icon } from '@/components/ui/icon'

export type WorkspaceSessionAction = 'hangup' | 'pause' | 'resume' | 'skip' | 'end'

type WorkspaceSessionControlsProps = {
  status: 'active' | 'paused' | 'completed' | 'stopped' | null
  callBusy: boolean
  outcomeRequired: boolean
  previewOnly?: boolean
  onAction: (action: WorkspaceSessionAction) => void
}

export function WorkspaceSessionControls({
  status,
  callBusy,
  outcomeRequired,
  previewOnly = false,
  onAction,
}: WorkspaceSessionControlsProps) {
  const finished = status === 'completed' || status === 'stopped'
  const paused = status === 'paused'
  const previewTitle = previewOnly ? 'Available in a live calling session' : undefined
  const pauseLabel = callBusy
    ? 'Pause & hang up'
    : outcomeRequired
      ? 'Pause after outcome'
      : 'Pause session'
  const pausedActionLabel = callBusy
    ? 'Pausing call…'
    : outcomeRequired
      ? 'Paused — save outcome'
      : 'Resume session'

  return (
    <section aria-label="Calling session controls" className="mx-1 space-y-2 border-t border-[var(--skc-separator)] pt-4">
      <button
        type="button"
        onClick={() => onAction('hangup')}
        disabled={previewOnly || !callBusy}
        title={previewTitle}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#E32E2E] px-4 text-sm font-black text-white hover:bg-[#C42626] disabled:cursor-not-allowed disabled:bg-[var(--skc-surface-3)] disabled:text-[var(--skc-text-tertiary)]"
      >
        <Icon name="call_end" size="text-lg" /> Hang up current call
      </button>
      <button
        type="button"
        onClick={() => onAction(paused ? 'resume' : 'pause')}
        disabled={previewOnly || finished || (paused && (callBusy || outcomeRequired))}
        title={previewTitle}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-4 text-sm font-black text-[var(--crm-on-warning)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name={paused && !callBusy && !outcomeRequired ? 'play_arrow' : 'pause_circle'} size="text-lg" />
        {paused ? pausedActionLabel : pauseLabel}
      </button>
      <button
        type="button"
        onClick={() => onAction('skip')}
        disabled={previewOnly || callBusy || outcomeRequired || status !== 'active'}
        title={previewTitle}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--skc-separator)] bg-[var(--skc-surface-3)] px-4 text-sm font-bold text-[var(--skc-text-primary)] hover:bg-[var(--skc-surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="skip_next" size="text-lg" /> Skip seller
      </button>
      <button
        type="button"
        onClick={() => onAction('end')}
        disabled={previewOnly || finished}
        title={previewTitle}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#7D2626] bg-[#E32E2E]/10 px-4 text-sm font-bold text-[#FF7A7A] hover:bg-[#E32E2E]/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="stop_circle" size="text-lg" /> End session
      </button>
    </section>
  )
}
