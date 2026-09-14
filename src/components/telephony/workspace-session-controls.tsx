'use client'

import { Icon } from '@/components/ui/icon'

export type WorkspaceSessionAction = 'redial' | 'hangup' | 'pause' | 'resume' | 'end'

type WorkspaceSessionControlsProps = {
  status: 'active' | 'paused' | 'completed' | 'stopped' | null
  callBusy: boolean
  outcomeRequired: boolean
  redialReady?: boolean
  previewOnly?: boolean
  controlUnavailable?: boolean
  onAction: (action: WorkspaceSessionAction) => void
}

export function WorkspaceSessionControls({
  status,
  callBusy,
  outcomeRequired,
  redialReady = true,
  previewOnly = false,
  controlUnavailable = false,
  onAction,
}: WorkspaceSessionControlsProps) {
  const finished = status === 'completed' || status === 'stopped'
  const paused = status === 'paused'
  const controlsLocked = previewOnly || controlUnavailable
  const lockedTitle = controlUnavailable
    ? 'Dialing control is active in another window'
    : previewOnly
      ? 'Available in a live calling session'
      : undefined
  const pauseLabel = paused ? 'Resume' : 'Pause'

  return (
    <section aria-label="Calling session controls" className="grid gap-1.5 border-t border-white/15 pt-3">
      <button
        type="button"
        onClick={() => onAction('redial')}
        disabled={controlsLocked || finished || paused || callBusy || outcomeRequired || !redialReady}
        title={lockedTitle}
        className="prospecting-dialer-secondary-button"
      >
        <Icon name="phone_callback" size="text-sm" className="text-[#8fce47]" /> Redial
      </button>
      <button
        type="button"
        onClick={() => onAction('hangup')}
        disabled={controlsLocked || !callBusy}
        title={lockedTitle}
        className="prospecting-dialer-secondary-button"
      >
        <Icon name="call_end" size="text-sm" /> Hang up
      </button>
      <button
        type="button"
        onClick={() => onAction(paused ? 'resume' : 'pause')}
        disabled={controlsLocked || finished || outcomeRequired || (paused && callBusy)}
        title={lockedTitle}
        className="prospecting-dialer-secondary-button"
      >
        <Icon name={paused ? 'play_arrow' : 'pause'} size="text-sm" /> {pauseLabel}
      </button>
      <button
        type="button"
        onClick={() => onAction('end')}
        disabled={controlsLocked || finished}
        title={lockedTitle}
        className="prospecting-dialer-secondary-button"
      >
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-[#ff183c]" /> Stop
      </button>
    </section>
  )
}
