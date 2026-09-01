'use client'

import { Icon } from '@/components/ui/icon'

export type WorkspaceSessionAction = 'pause' | 'resume' | 'skip' | 'end'

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
    <section aria-label="Calling session controls" className="mx-1 space-y-2 border-t border-[var(--skc-separator)] pt-3">
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
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onAction('skip')}
          disabled={previewOnly || callBusy || outcomeRequired || status !== 'active'}
          title={previewTitle}
          className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-[var(--skc-separator)] bg-[var(--skc-surface-3)] px-2 text-xs font-bold text-[var(--skc-text-primary)] hover:bg-[var(--skc-surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="skip_next" size="text-base" /> Skip seller
        </button>
        <button
          type="button"
          onClick={() => onAction('end')}
          disabled={previewOnly || finished}
          title={previewTitle}
          className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-[#7D2626] bg-[#E32E2E]/10 px-2 text-xs font-bold text-[#FF7A7A] hover:bg-[#E32E2E]/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="stop_circle" size="text-base" /> End session
        </button>
      </div>
    </section>
  )
}
