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
  onCall: () => void
  queueItem: HeirDialerQueueItem | null
  statusLabel: string
}

export function WorkspaceCallController({
  callerPlan,
  dialDisplay,
  dialReady,
  effectiveCallerId,
  onCall,
  queueItem,
  statusLabel,
}: WorkspaceCallControllerProps) {
  return (
    <div className="mx-1 rounded-2xl border border-[var(--skc-separator)] bg-[var(--skc-surface-soft)] p-5 text-center">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--skc-text-tertiary)]">
        {queueItem ? 'Next ready number' : 'Choose a number from the seller list'}
      </p>
      <p className="mt-3 font-mono text-[28px] font-semibold tabular-nums tracking-[-0.03em] text-[var(--skc-text-primary)]">
        {dialDisplay || '—'}
      </p>
      {queueItem ? (
        <p className="mt-1 text-sm font-semibold text-[var(--skc-text-secondary)]">
          {queueItem.heirName} · <span className="capitalize">{queueItem.relation}</span>
        </p>
      ) : null}
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
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--skc-text-tertiary)]">Caller ID policy</p>
        <p className="mt-1 text-sm font-semibold text-[var(--skc-text-primary)]">
          {queueItem
            ? effectiveCallerId
              ? formatPhone(effectiveCallerId)
              : 'No approved line available'
            : 'Select a seller number'}
        </p>
        <p className="mt-1 text-[11px] leading-5 text-[var(--skc-text-tertiary)]">
          {!queueItem
            ? 'The reviewed campaign caller ID loads before the call can start.'
            : callerPlan.mode === 'rotation' && callerPlan.rotationCallerIds.length > 1
            ? `Automatic rotation · ${callerPlan.rotationCallerIds.length} approved lines · changes every ${callerPlan.rotateEveryCalls} calls`
            : 'Assigned campaign line · rechecked before every call'}
        </p>
      </div>
    </div>
  )
}
