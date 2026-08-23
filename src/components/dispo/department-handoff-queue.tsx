'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'

type Handoff = {
  id: string
  lead_id: string
  from_department: string
  to_department: string
  status: 'pending' | 'accepted' | 'completed'
  reason: string | null
  evidence_type: string | null
  created_at: string
  accepted_by: string | null
  leads: {
    id: string
    full_name: string | null
    property_address: string | null
    city: string | null
    state: string | null
  } | null
}

function departmentLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

export function DepartmentHandoffQueue({
  department,
  status = 'pending',
  title,
  onAccepted,
}: {
  department: 'dispositions' | 'transaction_coordination'
  status?: 'pending' | 'accepted'
  title: string
  onAccepted?: () => void
}) {
  const [handoffs, setHandoffs] = useState<Handoff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/department-handoffs?department=${department}&status=${status}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Handoffs are unavailable')
      setHandoffs(payload.handoffs ?? [])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Handoffs are unavailable')
    } finally {
      setLoading(false)
    }
  }, [department, status])

  useEffect(() => { void load() }, [load])

  async function accept(handoffId: string) {
    setAccepting(handoffId)
    setError(null)
    try {
      const response = await fetch('/api/department-handoffs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoffId, action: 'accept' }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Handoff could not be accepted')
      setHandoffs((current) => current.filter((handoff) => handoff.id !== handoffId))
      onAccepted?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Handoff could not be accepted')
    } finally {
      setAccepting(null)
    }
  }

  if (!loading && !error && handoffs.length === 0) return null

  return (
    <section aria-label={title} className="mb-6 overflow-hidden rounded-xl border border-[var(--crm-info-border)] bg-[var(--crm-surface)] shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--crm-border)] bg-[var(--crm-info-soft)] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--crm-info)] text-white"><Icon name="move_to_inbox" size="text-lg" /></span>
          <div>
            <h2 className="text-sm font-black text-[var(--crm-ink)]">{title}</h2>
            <p className="text-xs font-semibold text-[var(--crm-text-muted)]">
              {loading ? 'Loading handoffs…' : `${handoffs.length} evidence-backed transfer${handoffs.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="crm-icon-button grid h-9 w-9 place-items-center rounded-lg" aria-label="Refresh handoffs"><Icon name="refresh" size="text-base" /></button>
      </div>
      {error ? <p className="px-4 py-3 text-sm font-semibold text-[var(--crm-danger)]">{error}</p> : null}
      <div className="divide-y divide-[var(--crm-border)]">
        {handoffs.slice(0, 5).map((handoff) => {
          const lead = handoff.leads
          return (
            <div key={handoff.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Link href={`/leads/${handoff.lead_id}`} className="truncate text-sm font-black text-[var(--crm-ink)] hover:text-[var(--crm-brand)]">
                  {lead?.property_address || lead?.full_name || 'Open contact'}
                </Link>
                <p className="mt-0.5 text-xs font-semibold text-[var(--crm-text-muted)]">
                  {departmentLabel(handoff.from_department)} → {departmentLabel(handoff.to_department)}
                  {handoff.evidence_type ? ` · ${handoff.evidence_type.replace(/_/g, ' ')}` : ''}
                </p>
                {handoff.reason ? <p className="mt-1 text-xs text-[var(--crm-text-muted)]">{handoff.reason}</p> : null}
              </div>
              {handoff.status === 'pending' ? (
                <button type="button" onClick={() => void accept(handoff.id)} disabled={accepting === handoff.id} className="crm-primary-button shrink-0 rounded-lg px-3 py-2 text-xs font-black">
                  {accepting === handoff.id ? 'Accepting…' : 'Accept handoff'}
                </button>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--crm-success-soft)] px-2.5 py-1 text-xs font-black text-[var(--crm-success)]"><Icon name="verified" size="text-sm" />Received</span>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
