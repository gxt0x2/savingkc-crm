'use client'

import { Icon } from '@/components/ui/icon'
import {
  PROSPECTING_DIALER_DISPOSITIONS,
  type DispositionDef,
  type DispositionGroup,
  type DispositionId,
} from '@/lib/dialer-dispositions'

type WorkspaceDispositionControlsProps = {
  outcomeRequired: boolean
  previewOnly?: boolean
  dispositions?: DispositionDef[]
  savingDisposition?: DispositionId | null
  onDisposition?: (disposition: DispositionId) => void
}

const GROUP_LABELS: Record<DispositionGroup, string> = {
  reached: 'Reached',
  no_contact: 'No contact',
  stop: 'Stop',
}

const GROUP_STYLES: Record<DispositionGroup, string> = {
  reached: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200 enabled:hover:bg-emerald-400/20',
  no_contact: 'border-sky-400/25 bg-sky-400/10 text-sky-200 enabled:hover:bg-sky-400/20',
  stop: 'border-rose-400/25 bg-rose-400/10 text-rose-200 enabled:hover:bg-rose-400/20',
}

export function WorkspaceDispositionControls({
  outcomeRequired,
  previewOnly = false,
  dispositions = PROSPECTING_DIALER_DISPOSITIONS,
  savingDisposition = null,
  onDisposition,
}: WorkspaceDispositionControlsProps) {
  const disabled = previewOnly || !outcomeRequired || Boolean(savingDisposition)
  const status = previewOnly
    ? 'Read-only preview'
    : outcomeRequired
      ? 'Choose one result to finish this call'
      : 'Available when a call ends'

  return <section aria-label="Call disposition controls" className="space-y-3 rounded-2xl border border-[var(--skc-separator)] bg-[var(--skc-surface-soft)] p-3">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#FF6868]">Call result</p>
        <p aria-live="polite" className="mt-1 text-xs text-[var(--skc-text-tertiary)]">{status}</p>
      </div>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${outcomeRequired && !previewOnly ? 'animate-pulse bg-amber-300' : 'bg-[var(--skc-surface-3)]'}`} />
    </div>

    {(['reached', 'no_contact', 'stop'] as const).map((group) => {
      const groupDispositions = dispositions.filter((item) => item.group === group)
      return <fieldset key={group}>
        <legend className="mb-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-[var(--skc-text-tertiary)]">{GROUP_LABELS[group]}</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {groupDispositions.map((item) => <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={() => onDisposition?.(item.id)}
            className={`flex min-h-10 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[11px] font-bold leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${GROUP_STYLES[group]}`}
          >
            <Icon name={savingDisposition === item.id ? 'progress_activity' : item.icon} size="text-sm" className={savingDisposition === item.id ? 'animate-spin' : ''} />
            <span>{item.label}</span>
          </button>)}
        </div>
      </fieldset>
    })}
  </section>
}
