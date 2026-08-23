'use client'

import { useState } from 'react'
import type { DealStage } from '@/types/pipeline'
import { DEAD_REASONS } from '@/lib/lead-outcomes'

const STAGE_OPTIONS: { value: DealStage; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Leads' },
  { value: 'qualified', label: 'Opportunity' },
  { value: 'appointment_set', label: 'Appointment Set' },
  { value: 'offer_made', label: 'Offer Made' },
  { value: 'under_contract', label: 'In Closing' },
  { value: 'dead', label: 'Dead' },
]

const APPOINTMENT_STAGES = new Set(['appointment_set'])

interface StageSelectorProps {
  leadId: string
  station: string | null
  onChange?: (next: DealStage, outcome?: { deadReason: string | null }) => void
  onAppointmentRequired?: () => void
  size?: 'sm' | 'md'
  variant?: 'cockpit' | 'workspace'
}

/**
 * Inline stage dropdown — calls the authenticated, idempotent lifecycle
 * command. The server owns actor identity, audit, and department handoffs.
 */
export function StageSelector({
  leadId,
  station,
  onChange,
  onAppointmentRequired,
  size = 'md',
  variant = 'cockpit',
}: StageSelectorProps) {
  const [value, setValue] = useState<string>(station || 'new')
  const [pending, setPending] = useState(false)
  const [deadDialogOpen, setDeadDialogOpen] = useState(false)
  const [deadReason, setDeadReason] = useState('')
  const [deadReasonNotes, setDeadReasonNotes] = useState('')

  async function submitStage(next: DealStage, reason = 'manual change from lead page', selectedDeadReason?: string, selectedDeadReasonNotes?: string, evidence?: { type: 'seller_contract_signed' }) {
    const prev = value
    setValue(next)
    setPending(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'transition',
          stage: next,
          reason,
          evidence,
          ...(next === 'dead' ? { deadReason: selectedDeadReason, deadReasonNotes: selectedDeadReasonNotes } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      onChange?.(next, { deadReason: next === 'dead' ? selectedDeadReason ?? null : null })
    } catch (err) {
      setValue(prev)
      console.error('Failed to update station:', err)
      alert(`Failed to update stage: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setPending(false)
    }
  }

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    e.stopPropagation()
    const next = e.target.value as DealStage
    const prev = value
    if (APPOINTMENT_STAGES.has(next) && onAppointmentRequired) {
      setValue(prev)
      onAppointmentRequired()
      return
    }
    if (next === 'dead') {
      setValue(prev)
      setDeadDialogOpen(true)
      return
    }
    if (next === 'under_contract') {
      const confirmed = window.confirm('Confirm the seller purchase agreement is fully executed. This hands the opportunity to Dispositions and creates an audit record.')
      if (!confirmed) {
        setValue(prev)
        return
      }
      await submitStage(next, 'Fully executed seller purchase agreement confirmed', undefined, undefined, { type: 'seller_contract_signed' })
      return
    }
    await submitStage(next)
  }

  const sizeClasses = size === 'sm'
    ? 'text-xs px-2 py-1'
    : 'text-sm px-3 py-1.5'
  const variantClasses = variant === 'workspace'
    ? 'border-[#efb4b8] bg-[#fff7f7] text-[#b91c26] hover:border-[#df3038] focus:border-[#df3038]'
    : 'bg-[var(--ck-surface-elev)] border-[var(--ck-border)] hover:border-[#E32E2E]/40 text-[var(--ck-text)] focus:border-[#E32E2E]'

  return (
    <>
      <select
        value={value}
        onChange={handleChange}
        onClick={(e) => e.stopPropagation()}
        disabled={pending}
        className={`rounded border cursor-pointer focus:outline-none disabled:opacity-50 font-semibold ${variantClasses} ${sizeClasses}`}
        aria-label="Change lead stage"
        title="Change stage"
      >
        {STAGE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {deadDialogOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="stage-dead-reason-title" className="w-full max-w-md rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-5 shadow-2xl">
            <div className="mb-4">
              <p className="text-sm font-black uppercase tracking-wider text-[color:var(--ck-accent-bright)]">Mark Lead Dead</p>
              <h3 id="stage-dead-reason-title" className="mt-1 text-xl font-black text-[var(--ck-text)]">Why is this not a lead?</h3>
              <p className="mt-1 text-sm font-semibold text-[var(--ck-text-muted)]">
                Required for lead-source reporting, AI context, and future reactivation decisions.
              </p>
            </div>
            <select
              value={deadReason}
              onChange={(e) => setDeadReason(e.target.value)}
              className="w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold text-[var(--ck-text)] focus:border-[#E32E2E] focus:outline-none"
              aria-label="Dead reason"
            >
              <option value="">Select reason...</option>
              {DEAD_REASONS.map((reason) => (
                <option key={reason.id} value={reason.id}>{reason.label}</option>
              ))}
            </select>
            <label className="mt-4 block text-xs font-black uppercase tracking-[0.12em] text-[var(--ck-text-muted)]">
              Notes {deadReason === 'other' ? <span className="text-[var(--ck-accent)]">(required)</span> : <span className="font-semibold normal-case tracking-normal">(optional)</span>}
              <textarea
                value={deadReasonNotes}
                onChange={(event) => setDeadReasonNotes(event.target.value)}
                rows={3}
                placeholder="Add context an agent or AI will need later…"
                className="mt-2 w-full resize-none rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold normal-case tracking-normal text-[var(--ck-text)] focus:border-[#E32E2E] focus:outline-none"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeadDialogOpen(false)
                  setDeadReason('')
                  setDeadReasonNotes('')
                }}
                className="rounded-lg border border-[var(--ck-border)] px-3 py-2 text-sm font-black text-[var(--ck-text)] hover:bg-[var(--ck-surface-elev)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!deadReason || (deadReason === 'other' && !deadReasonNotes.trim()) || pending}
                onClick={async () => {
                  const selected = deadReason
                  const selectedNotes = deadReasonNotes.trim()
                  setDeadDialogOpen(false)
                  setDeadReason('')
                  setDeadReasonNotes('')
                  await submitStage('dead', 'manual dead outcome from lead page', selected, selectedNotes)
                }}
                className="rounded-lg bg-[color:var(--ck-accent)] px-3 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Mark Dead
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
