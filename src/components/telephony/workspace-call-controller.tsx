'use client'

import { Icon } from '@/components/ui/icon'
import type { DialerCallerPlan } from '@/lib/dialer-caller-plan'
import { formatPhone } from '@/lib/format'
import type { HeirDialerQueueItem } from '@/lib/heir-dialer-queue'

type WorkspaceCallControllerProps = {
  callerPlan: DialerCallerPlan
  dialDisplay: string
  dialReady: boolean
  effectiveCallerId: string
  loadingSessionQueue?: boolean
  onCall: () => void
  outcomeRequired?: boolean
  queueItem: HeirDialerQueueItem | null
  statusLabel: string
}

export function WorkspaceCallController({
  callerPlan,
  dialDisplay,
  dialReady,
  effectiveCallerId,
  loadingSessionQueue = false,
  onCall,
  outcomeRequired = false,
  queueItem,
  statusLabel,
}: WorkspaceCallControllerProps) {
  const formattedDialDisplay = formatPhone(dialDisplay) || dialDisplay

  if (loadingSessionQueue) {
    return (
      <section role="status" aria-label="Loading calling session" className="border-b border-white/15 pb-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-white"><Icon name="progress_activity" className="animate-spin" size="text-base" />Loading call controls</p>
        <p className="mt-1 text-xs text-white/60">Restoring the current record and session.</p>
      </section>
    )
  }

  if (outcomeRequired) {
    return (
      <section aria-label="Current call summary" className="border-b border-white/15 pb-3">
        <h2 className="text-base font-semibold tracking-[-0.02em] text-white">Call outcome</h2>
        <p className="mt-1 text-xs font-medium text-[#f1bb55]">Call ended · outcome required</p>
        <p className="sr-only">{queueItem?.heirName || 'Current seller'} {formattedDialDisplay}</p>
      </section>
    )
  }

  return (
    <section aria-label="Next contact" className="border-b border-white/15 pb-3">
      <h2 className="text-base font-semibold tracking-[-0.02em] text-white">Call outcome</h2>
      <p className="mt-1 text-xs font-medium text-[#7ed3b4]">{queueItem ? 'Ready to dial · 00:00' : 'Choose a number from the current contact'}</p>
      <p className="sr-only">{queueItem ? `${queueItem.heirName} ${formattedDialDisplay}` : 'No number selected'}</p>
      <button
        type="button"
        onClick={onCall}
        disabled={!dialReady}
        className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[var(--prospecting-primary)] px-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--prospecting-primary-strong)] disabled:cursor-not-allowed disabled:opacity-45"
        title={dialReady ? 'Start dialing the reviewed queue' : 'Waiting for Twilio'}
      >
        <Icon name="play_arrow" size="text-xl" filled />
        {dialReady ? 'Start dialing' : statusLabel}
      </button>
      <p className="sr-only">Calling from {queueItem ? effectiveCallerId ? formatPhone(effectiveCallerId) : 'No approved line available' : 'Select a seller number'} via {callerPlan.mode === 'rotation' && callerPlan.rotationCallerIds.length > 1 ? `${callerPlan.rotationCallerIds.length} lines` : 'campaign line'}</p>
    </section>
  )
}
