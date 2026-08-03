'use client'

import { createPortal } from 'react-dom'
import { useId, useRef, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'
import {
  DEAD_REASONS,
  canonicalDeadReason,
  deadReasonLabel,
  isNotLeadOutcome,
} from '@/lib/lead-outcomes'
import { cn } from '@/lib/utils'

export interface LeadStatusUpdate {
  classification: 'lead' | 'opportunity' | 'dead' | null
  station: string | null
  priority: string | null
  dead_reason: string | null
}

interface LeadStatusControlProps {
  leadId: string
  classification?: string | null
  station?: string | null
  priority?: string | null
  deadReason?: string | null
  agent?: string | null
  onChanged?: (update: LeadStatusUpdate) => void
  variant?: 'badge' | 'panel'
}

export function LeadStatusControl({
  leadId,
  classification,
  station,
  priority,
  deadReason,
  agent,
  onChanged,
  variant = 'badge',
}: LeadStatusControlProps) {
  const currentlyNotLead = isNotLeadOutcome(classification, station)
  const canonicalReason = canonicalDeadReason(deadReason)
  const [open, setOpen] = useState(false)
  const [selectedStatus, setSelectedStatus] = useState<'lead' | 'not_a_lead'>(currentlyNotLead ? 'not_a_lead' : 'lead')
  const [selectedReason, setSelectedReason] = useState(canonicalReason ?? '')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const leadButtonRef = useRef<HTMLButtonElement>(null)

  function closeDialog() {
    if (saving) return
    setOpen(false)
    setError(null)
    setSelectedStatus(currentlyNotLead ? 'not_a_lead' : 'lead')
    setSelectedReason(canonicalReason ?? '')
    setNotes('')
  }

  const dialogRef = useDialogAccessibility<HTMLDivElement>(open, closeDialog, leadButtonRef)
  const visibleReason = currentlyNotLead ? deadReasonLabel(deadReason) || 'Reason required' : null

  async function saveLeadStatus() {
    if (saving) return
    const markingNotLead = selectedStatus === 'not_a_lead'
    if (markingNotLead && !selectedReason) return
    if (markingNotLead && selectedReason === 'other' && !notes.trim()) {
      setError('Add a note when Other is selected.')
      return
    }

    if (!markingNotLead && !currentlyNotLead && classification) {
      closeDialog()
      return
    }

    setSaving(true)
    setError(null)
    try {
      const nextStation = markingNotLead
        ? 'dead'
        : currentlyNotLead
          ? 'contacted'
          : station || 'new'
      const response = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(markingNotLead ? {
          id: leadId,
          actor: agent || 'Ernest',
          classification: 'dead',
          station: 'dead',
          priority: 'cold',
          opportunity_score: 0,
          deadReason: selectedReason,
          deadReasonNotes: notes.trim() || null,
        } : {
          id: leadId,
          actor: agent || 'Ernest',
          classification: 'lead',
          station: nextStation,
          priority: currentlyNotLead || priority === 'cold' ? 'warm' : priority || 'warm',
          dead_reason: null,
          dead_at: null,
          dead_by: null,
        }),
      })
      const payload = await response.json().catch(() => ({})) as {
        success?: boolean
        error?: string
        lead?: Partial<LeadStatusUpdate>
      }
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Lead status could not be saved')

      onChanged?.({
        classification: payload.lead?.classification ?? (markingNotLead ? 'dead' : 'lead'),
        station: payload.lead?.station ?? nextStation,
        priority: payload.lead?.priority ?? (markingNotLead ? 'cold' : 'warm'),
        dead_reason: payload.lead?.dead_reason ?? (markingNotLead ? selectedReason : null),
      })
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Lead status could not be saved')
    } finally {
      setSaving(false)
    }
  }

  const control = (
    <button
      type="button"
      onClick={() => {
        setSelectedStatus(currentlyNotLead ? 'not_a_lead' : 'lead')
        setSelectedReason(canonicalReason ?? '')
        setOpen(true)
      }}
      aria-label={`Change lead status. Current: ${currentlyNotLead ? `Not a lead${visibleReason ? ` — ${visibleReason}` : ''}` : 'Lead'}`}
      className={cn(
        'group inline-flex min-w-0 items-center border font-bold transition-all hover:-translate-y-px hover:shadow-sm',
        variant === 'panel' ? 'w-full justify-between rounded-xl px-3 py-2.5 text-sm' : 'max-w-[360px] rounded-md px-2 py-0.5 text-[11px]',
        currentlyNotLead
          ? 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'
          : 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon name={currentlyNotLead ? 'person_off' : 'verified'} className={variant === 'panel' ? 'text-[18px]' : 'text-[14px]'} />
        <span className="truncate">{currentlyNotLead ? `Not a lead${visibleReason ? ` · ${visibleReason}` : ''}` : 'Lead'}</span>
      </span>
      {variant === 'panel' ? <Icon name="chevron_right" className="shrink-0 text-[18px] transition-transform group-hover:translate-x-0.5" /> : null}
    </button>
  )

  const dialog = open ? (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={closeDialog}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="crm-modal-surface max-h-[min(820px,calc(100vh-32px))] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]"><Icon name="fact_check" /></span>
            <div>
              <h2 id={titleId} className="text-lg font-black text-[var(--crm-ink)]">Lead status</h2>
              <p className="mt-0.5 text-xs text-[var(--crm-text-muted)]">Make the qualification explicit before the record leaves active work.</p>
            </div>
          </div>
          <button type="button" onClick={closeDialog} aria-label="Close lead status dialog" className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg"><Icon name="close" /></button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Choose lead status">
            <button
              ref={leadButtonRef}
              type="button"
              aria-label="Lead"
              onClick={() => setSelectedStatus('lead')}
              aria-pressed={selectedStatus === 'lead'}
              className={cn(
                'rounded-xl border-2 p-4 text-left transition-colors',
                selectedStatus === 'lead'
                  ? 'border-[var(--crm-success)] bg-[var(--crm-success-soft)]'
                  : 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] hover:border-[var(--crm-success)]/50',
              )}
            >
              <span className="flex items-center justify-between gap-2 font-black text-[var(--crm-success)]"><span className="flex items-center gap-2"><Icon name="verified" />Lead</span>{selectedStatus === 'lead' ? <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--crm-success)] text-white"><Icon name="check" className="text-[16px]" /></span> : null}</span>
              <span className="mt-1 block text-xs leading-5 text-[var(--crm-text-muted)]">A real seller relationship that should remain in the acquisition pipeline.</span>
            </button>
            <button
              type="button"
              aria-label="Not a lead"
              onClick={() => setSelectedStatus('not_a_lead')}
              aria-pressed={selectedStatus === 'not_a_lead'}
              className={cn(
                'rounded-xl border-2 p-4 text-left transition-colors',
                selectedStatus === 'not_a_lead'
                  ? 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)]'
                  : 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] hover:border-[var(--crm-brand)]/50',
              )}
            >
              <span className="flex items-center justify-between gap-2 font-black text-[var(--crm-brand)]"><span className="flex items-center gap-2"><Icon name="person_off" />Not a lead</span>{selectedStatus === 'not_a_lead' ? <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--crm-brand)] text-white"><Icon name="check" className="text-[16px]" /></span> : null}</span>
              <span className="mt-1 block text-xs leading-5 text-[var(--crm-text-muted)]">Remove it from active work and record the business reason.</span>
            </button>
          </div>

          {selectedStatus === 'not_a_lead' ? (
            <div>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-[var(--crm-ink)]">Why is this not a lead?</h3>
                  <p className="mt-1 text-xs text-[var(--crm-text-muted)]">Required for reporting, AI context, and future reactivation decisions.</p>
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-brand)]">Required</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {DEAD_REASONS.map((reason) => (
                  <label key={reason.id} className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors',
                    selectedReason === reason.id
                      ? 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'
                      : 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text)] hover:border-[var(--crm-border-strong)]',
                  )}>
                    <input type="radio" name={`${titleId}-reason`} value={reason.id} checked={selectedReason === reason.id} onChange={() => setSelectedReason(reason.id)} className="mt-0.5 accent-[var(--crm-brand)]" />
                    <span>{reason.label}</span>
                  </label>
                ))}
              </div>
              <label className="mt-4 block text-xs font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]">
                Notes {selectedReason === 'other' ? <span className="text-[var(--crm-brand)]">(required)</span> : <span className="font-semibold normal-case tracking-normal">(optional)</span>}
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  placeholder="Add context an agent or AI will need later…"
                  className="crm-field mt-2 w-full resize-none rounded-lg px-3 py-2 text-sm font-medium normal-case tracking-normal"
                />
              </label>
            </div>
          ) : null}

          {error ? <p role="alert" className="rounded-lg border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 py-2 text-sm font-semibold text-[var(--crm-brand)]">{error}</p> : null}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-6 py-4">
          <button type="button" onClick={closeDialog} disabled={saving} className="crm-secondary-button rounded-lg px-4 py-2 text-sm font-bold">Cancel</button>
          <button
            type="button"
            aria-label={saving ? 'Saving lead status' : selectedStatus === 'not_a_lead' ? 'Mark not a lead' : currentlyNotLead ? 'Restore as lead' : 'Confirm lead'}
            onClick={() => void saveLeadStatus()}
            disabled={saving || (selectedStatus === 'not_a_lead' && (!selectedReason || (selectedReason === 'other' && !notes.trim())))}
            className={cn(
              'flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50',
              selectedStatus === 'not_a_lead' ? 'bg-[var(--crm-brand)]' : 'bg-[var(--crm-success)]',
            )}
          >
            <Icon name={saving ? 'progress_activity' : selectedStatus === 'not_a_lead' ? 'person_off' : 'verified'} className={saving ? 'animate-spin' : ''} />
            {saving ? 'Saving…' : selectedStatus === 'not_a_lead' ? 'Mark not a lead' : currentlyNotLead ? 'Restore as lead' : 'Confirm lead'}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      {control}
      {typeof document !== 'undefined' && dialog ? createPortal(dialog, document.body) : null}
    </>
  )
}
