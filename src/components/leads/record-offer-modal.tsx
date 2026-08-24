'use client'

import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'
import { Icon } from '@/components/ui/icon'
import type { OfferMethod } from '@/lib/lead-offer'
import { cn } from '@/lib/utils'

interface RecordOfferModalProps {
  leadId: string
  leadName: string
  currentAmount: number | null
  onClose: () => void
  onSaved: () => void
}

const METHODS: Array<{ value: OfferMethod; label: string; detail: string; icon: string }> = [
  { value: 'verbal', label: 'Verbal', detail: 'Presented by phone or in person', icon: 'record_voice_over' },
  { value: 'written', label: 'Written', detail: 'Sent by text, email, or document', icon: 'description' },
]

export function RecordOfferModal({
  leadId,
  leadName,
  currentAmount,
  onClose,
  onSaved,
}: RecordOfferModalProps) {
  const titleId = useId()
  const amountId = useId()
  const notesId = useId()
  const dialogRef = useDialogAccessibility<HTMLDivElement>(true, onClose)
  const [method, setMethod] = useState<OfferMethod>('verbal')
  const [amount, setAmount] = useState(currentAmount ? String(Math.round(currentAmount)) : '')
  const [notes, setNotes] = useState('')
  const [commandId] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function saveOffer() {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/leads/${leadId}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId },
        body: JSON.stringify({ amount, method, notes }),
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) {
        throw new Error(result.error || 'The offer could not be recorded.')
      }
      onSaved()
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The offer could not be recorded.')
    } finally {
      setSaving(false)
    }
  }

  const modal = (
    <div className="crm-workspace-shell fixed inset-0 z-[110] flex items-center justify-center bg-black/65 p-3 text-[var(--crm-ink)] backdrop-blur-sm sm:p-6" data-theme={readActiveTheme()} onMouseDown={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="crm-panel-raised w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-[var(--crm-border)] px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--crm-success-soft)] text-[var(--crm-success)]">
            <Icon name="request_quote" className="text-[22px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="crm-eyebrow">Opportunity</p>
            <h2 id={titleId} className="text-lg font-black text-[var(--crm-ink)]">Record an offer</h2>
            <p className="mt-1 truncate text-sm text-[var(--crm-text-muted)]">{leadName}</p>
          </div>
          <button type="button" onClick={onClose} className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg" aria-label="Close offer form">
            <Icon name="close" />
          </button>
        </header>

        <div className="space-y-5 px-5 py-5">
          <fieldset>
            <legend className="text-xs font-black uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">How was the offer made?</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {METHODS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={method === option.value}
                  onClick={() => setMethod(option.value)}
                  className={cn(
                    'rounded-xl border p-3 text-left transition-colors',
                    method === option.value
                      ? 'border-[var(--crm-info)] bg-[var(--crm-info-soft)] text-[var(--crm-info)]'
                      : 'border-[var(--crm-border-strong)] bg-[var(--crm-surface)] text-[var(--crm-text)] hover:bg-[var(--crm-surface-subtle)]',
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-black"><Icon name={option.icon} className="text-[18px]" />{option.label}</span>
                  <span className="mt-1 block text-[11px] leading-4 text-[var(--crm-text-muted)]">{option.detail}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={amountId} className="text-xs font-black uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">Offer amount</label>
            <div className="mt-2 flex h-12 items-center rounded-xl border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-3 focus-within:border-[var(--crm-info)] focus-within:ring-2 focus-within:ring-[var(--crm-info-soft)]">
              <span className="text-lg font-black text-[var(--crm-text-muted)]">$</span>
              <input
                id={amountId}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder="112500"
                className="min-w-0 flex-1 bg-transparent px-2 text-lg font-black text-[var(--crm-ink)] outline-none placeholder:text-[var(--crm-text-dim)]"
              />
              {amount ? <span className="text-xs font-bold text-[var(--crm-text-muted)]">{Number(amount).toLocaleString()}</span> : null}
            </div>
          </div>

          <div>
            <label htmlFor={notesId} className="text-xs font-black uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">Note <span className="font-semibold normal-case tracking-normal">(optional)</span></label>
            <textarea
              id={notesId}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={1_000}
              placeholder="Terms, seller response, or follow-up needed..."
              className="mt-2 h-24 w-full resize-none rounded-xl border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-3 py-2.5 text-sm text-[var(--crm-text)] outline-none placeholder:text-[var(--crm-text-dim)] focus:border-[var(--crm-info)] focus:ring-2 focus:ring-[var(--crm-info-soft)]"
            />
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] px-3 py-2.5 text-xs leading-5 text-[var(--crm-success)]">
            <Icon name="check_circle" className="mt-0.5 shrink-0 text-[17px]" />
            Saving records the amount, method, agent, and timeline event, then advances active work to Offer.
          </div>

          {error ? <p role="alert" className="rounded-lg border border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)] px-3 py-2 text-sm font-semibold text-[var(--crm-danger)]">{error}</p> : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-5 py-4">
          <button type="button" onClick={onClose} className="crm-secondary-button h-10 rounded-lg px-4 text-sm font-bold">Cancel</button>
          <button type="button" onClick={saveOffer} disabled={saving || !amount} className="crm-primary-button flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">
            <Icon name={saving ? 'hourglass_empty' : 'check'} className="text-[17px]" />
            {saving ? 'Saving...' : currentAmount ? 'Update offer' : 'Record offer'}
          </button>
        </footer>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? modal : createPortal(modal, document.body)
}

function readActiveTheme(): 'light' | 'dark' {
  if (typeof document !== 'undefined') {
    const shellTheme = document.querySelector<HTMLElement>('.crm-workspace-shell')?.dataset.theme
    if (shellTheme === 'light' || shellTheme === 'dark') return shellTheme
  }
  if (typeof window !== 'undefined') return window.localStorage.getItem('crm-theme') === 'light' ? 'light' : 'dark'
  return 'dark'
}
