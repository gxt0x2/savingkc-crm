'use client'

import { Icon } from '@/components/ui/icon'
import { formatPhone } from '@/lib/format'
import type { HeirDialerQueueItem } from '@/lib/heir-dialer-queue'

type DialerQueueHeaderProps = {
  item: HeirDialerQueueItem
  index: number
  length: number
  callBusy: boolean
  workspace: boolean
  onEnd: () => void
  onPrevious: () => void
  onSkip: () => void
}
export function DialerQueueHeader({ item, index, length, callBusy, workspace, onEnd, onPrevious, onSkip }: DialerQueueHeaderProps) {
  if (workspace) {
    return (
      <div aria-label="Number progress" className="flex items-center justify-between gap-3 border-b border-[var(--skc-separator)] bg-[var(--skc-surface-soft)] px-4 py-2.5">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--skc-text-tertiary)]">Number progress</p>
        <p className="text-xs font-black tabular-nums text-[var(--skc-text-primary)]">{index + 1} of {length}</p>
      </div>
    )
  }

  return (
    <div className="border-b border-[#2B2B31] bg-[#17171D] px-5 py-3" style={{ borderLeft: '3px solid #E32E2E' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-0.5 text-[10px] font-black uppercase tracking-widest text-[#E32E2E]">Heir queue · {index + 1} of {length}</p>
          <p className="truncate text-sm font-bold text-white">{item.deceasedOwnerName} <span className="font-normal text-white/40">(deceased)</span></p>
          {item.propertyAddress ? <p className="truncate text-[11px] text-white/50">{item.propertyAddress}</p> : null}
        </div>
        <button onClick={onEnd} className="flex-shrink-0 rounded-[8px] border border-[#31313A] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/50 transition-colors hover:border-white/40 hover:text-white" title="End heir queue — back to normal dialer">End</button>
      </div>
      <div className="mt-2 flex items-center gap-2 border-t border-white/5 pt-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-white">{item.heirName}<span className="font-normal capitalize text-white/40"> · {item.relation}</span></p>
          <p className="font-mono text-[10px] text-white/50">{formatPhone(item.phone)}</p>
        </div>
        <button onClick={onPrevious} disabled={index === 0 || callBusy} className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] border border-[#31313A] bg-[#1E1E25] text-white/70 transition-colors hover:bg-[#26262F] disabled:cursor-not-allowed disabled:opacity-30" title="Previous heir"><Icon name="skip_previous" size="text-sm" /></button>
        <button onClick={onSkip} disabled={callBusy} className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] border border-[#31313A] bg-[#1E1E25] text-white/70 transition-colors hover:bg-[#26262F] disabled:cursor-not-allowed disabled:opacity-30" title="Skip without logging"><Icon name="skip_next" size="text-sm" /></button>
      </div>
    </div>
  )
}
