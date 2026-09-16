'use client'

import { useState } from 'react'

import { Icon } from '@/components/ui/icon'
import {
  PROSPECTING_DIALER_DISPOSITIONS,
  type DispositionDef,
  type DispositionId,
} from '@/lib/dialer-dispositions'

type WorkspaceDispositionControlsProps = {
  outcomeRequired: boolean
  previewOnly?: boolean
  dispositions?: DispositionDef[]
  savingDisposition?: DispositionId | null
  onDisposition?: (disposition: DispositionId) => void
}

const WORKSPACE_OUTCOMES = [
  { key: 'contact', label: 'Contact', icon: 'person', disposition: 'spoke_with_owner' },
  { key: 'no_contact', label: 'No Contact', icon: 'person_off', disposition: 'no_answer' },
  { key: 'bad_number', label: 'Bad Number', icon: 'phone_disabled', disposition: 'disconnected' },
  { key: 'voicemail', label: 'Voicemail', icon: 'mail', disposition: 'left_voicemail' },
  { key: 'dnc_contact', label: 'DNC Contact', icon: 'person_off', disposition: 'dnc' },
  { key: 'dnc_number', label: 'DNC Number', icon: 'phone_disabled', disposition: 'dnc' },
] as const satisfies ReadonlyArray<{ key: string; label: string; icon: string; disposition: DispositionId }>

type WorkspaceOutcomeKey = typeof WORKSPACE_OUTCOMES[number]['key']

function emptyCounts(): Record<WorkspaceOutcomeKey, number> {
  return Object.fromEntries(WORKSPACE_OUTCOMES.map((item) => [item.key, 0])) as Record<WorkspaceOutcomeKey, number>
}

export function WorkspaceDispositionControls({
  outcomeRequired,
  previewOnly = false,
  dispositions = PROSPECTING_DIALER_DISPOSITIONS,
  savingDisposition = null,
  onDisposition,
}: WorkspaceDispositionControlsProps) {
  const [counts, setCounts] = useState<Record<WorkspaceOutcomeKey, number>>(emptyCounts)
  const available = new Set(dispositions.map((item) => item.id))
  const disabled = previewOnly || !outcomeRequired || Boolean(savingDisposition)
  const status = previewOnly
    ? 'Read-only preview'
    : outcomeRequired
      ? 'Choose one result to finish this call'
      : 'Available when a call ends'

  return <section aria-label="Call disposition controls" className="border-t border-[var(--prospecting-border)] pt-2">
    <p className="sr-only" aria-live="polite">{status}</p>
    <div className="grid gap-1">
      {WORKSPACE_OUTCOMES.map((item) => {
        const unavailable = !available.has(item.disposition)
        const saving = savingDisposition === item.disposition
        return <button
          key={item.key}
          type="button"
          aria-label={item.label}
          disabled={disabled || unavailable}
          onClick={() => {
            setCounts((current) => ({ ...current, [item.key]: current[item.key] + 1 }))
            onDisposition?.(item.disposition)
          }}
          className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-[var(--crm-brand)] bg-[var(--crm-brand)] px-3 py-1.5 text-left text-xs font-semibold leading-tight text-white transition-colors enabled:hover:border-[var(--crm-brand-hover)] enabled:hover:bg-[var(--crm-brand-hover)] disabled:cursor-not-allowed disabled:opacity-75"
        >
          <Icon name={saving ? 'progress_activity' : item.icon} size="text-sm" className={`shrink-0 text-white ${saving ? 'animate-spin' : ''}`} />
          <span className="min-w-0 flex-1 whitespace-normal break-words">{item.label}</span>
          <span aria-hidden="true" className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-white px-1 text-[10px] font-black tabular-nums text-[#222831]">{counts[item.key]}</span>
        </button>
      })}
    </div>
  </section>
}
