'use client'

import { useState } from 'react'
import type { DealStage } from '@/types/pipeline'

const STAGE_OPTIONS: { value: DealStage; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Leads' },
  { value: 'qualified', label: 'Opportunities' },
  { value: 'appointment_set', label: 'Appointment Set' },
  { value: 'offer_made', label: 'Offer Made' },
  { value: 'under_contract', label: 'In Closing' },
  { value: 'dead', label: 'Dead' },
]

interface StageSelectorProps {
  leadId: string
  station: string | null
  onChange?: (next: DealStage) => void
  size?: 'sm' | 'md'
}

/**
 * Inline stage dropdown — calls POST /api/admin/leads/[id]/station
 * (admin/session auth) and cascades through updateManifestAndCascade so
 * scoring + audit stay in sync.
 */
export function StageSelector({ leadId, station, onChange, size = 'md' }: StageSelectorProps) {
  const [value, setValue] = useState<string>(station || 'new')
  const [pending, setPending] = useState(false)

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    e.stopPropagation()
    const next = e.target.value as DealStage
    const prev = value
    setValue(next)
    setPending(true)
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/station`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ station: next, reason: 'manual change from lead page' }),
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

  const sizeClasses = size === 'sm'
    ? 'text-xs px-2 py-1'
    : 'text-sm px-3 py-1.5'

  return (
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
  )
}
