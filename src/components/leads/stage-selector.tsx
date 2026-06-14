'use client'

import { useState } from 'react'
import type { DealStage } from '@/types/pipeline'
import { DEAD_REASONS } from '@/lib/lead-outcomes'

const STAGE_OPTIONS: { value: DealStage; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Leads' },
  { value: 'qualified', label: 'Opportunities' },
  { value: 'appointment_set', label: 'Appointment Set' },
  { value: 'offer_made', label: 'Offer Made' },
  { value: 'under_contract', label: 'In Closing' },
  { value: 'dead', label: 'Dead' },
]

const APPOINTMENT_STAGES = new Set(['appointment_set'])

interface StageSelectorProps {
  leadId: string
  station: string | null
  onChange?: (next: DealStage) => void
  onAppointmentRequired?: () => void
  size?: 'sm' | 'md'
}

/**
 * Inline stage dropdown — calls POST /api/admin/leads/[id]/station
 * (admin/session auth) and cascades through updateManifestAndCascade so
 * scoring + audit stay in sync.
 */
export function StageSelector({ leadId, station, onChange, onAppointmentRequired, size = 'md' }: StageSelectorProps) {
  const [value, setValue] = useState<string>(station || 'new')
  const [pending, setPending] = useState(false)
  const [deadDialogOpen, setDeadDialogOpen] = useState(false)
  const [deadReason, setDeadReason] = useState('')

  async function submitStage(next: DealStage, reason = 'manual change from lead page', selectedDeadReason?: string) {
    const prev = value
    setValue(next)
    setPending(true)
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/station`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          station: next,
          reason,
          ...(next === 'dead' ? { deadReason: selectedDeadReason } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      onChange?.(next)
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
    await submitStage(next)
  }

  const sizeClasses = size === 'sm'
    ? 'text-xs px-2 py-1'
    : 'text-sm px-3 py-1.5'

  return (
    <>
      <select
        value={value}
        onChange={handleChange}
        onClick={(e) => e.stopPropagation()}
        disabled={pending}
        className={`bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[#E32E2E]/40 text-[var(--ck-text)] rounded cursor-pointer focus:outline-none focus:border-[#E32E2E] disabled:opacity-50 font-medium ${sizeClasses}`}
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
          <div className="w-full max-w-md rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-5 shadow-2xl">
            <div className="mb-4">
              <p className="text-sm font-black uppercase tracking-wider text-[color:var(--ck-accent-bright)]">Mark Lead Dead</p>
              <h3 className="mt-1 text-xl font-black text-[var(--ck-text)]">Choose the reason</h3>
              <p className="mt-1 text-sm font-semibold text-[var(--ck-text-muted)]">
                This reason is used for lead-source reporting and future campaign decisions.
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
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeadDialogOpen(false)
                  setDeadReason('')
                }}
                className="rounded-lg border border-[var(--ck-border)] px-3 py-2 text-sm font-black text-[var(--ck-text)] hover:bg-[var(--ck-surface-elev)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!deadReason || pending}
                onClick={async () => {
                  const selected = deadReason
                  setDeadDialogOpen(false)
                  setDeadReason('')
                  await submitStage('dead', 'manual dead outcome from lead page', selected)
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
