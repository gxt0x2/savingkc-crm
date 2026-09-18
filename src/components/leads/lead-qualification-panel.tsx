'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

export const LEAD_QUALIFICATION_PILLARS = [
  { key: 'TIMELINE', label: 'Timeline', prompt: 'When does the seller need to sell?' },
  { key: 'CONDITION', label: 'Condition', prompt: 'What is the property condition?' },
  { key: 'MOTIVATION', label: 'Motivation', prompt: 'Why are they selling now?' },
  { key: 'PRICE', label: 'Price', prompt: 'What price or flexibility did they give?' },
] as const

export type LeadQualificationPillar = (typeof LEAD_QUALIFICATION_PILLARS)[number]['key']
export type LeadQualificationRow = {
  pillar: LeadQualificationPillar
  evidence: string
  status: 'missing' | 'needs_review' | 'verified'
  sourceType: 'operator' | 'legacy_manifest' | 'imported' | null
  verifiedBy: string | null
  verifiedAt: string | null
}

export type LeadQualificationResponse = {
  pillars: LeadQualificationRow[]
  complete: boolean
  verifiedCount: number
  error?: string
}

type LeadQualificationPanelProps = {
  leadId: string
  variant?: 'compact' | 'copilot'
  onQualificationChange?: (qualification: LeadQualificationResponse) => void
}

function emptyDraft(): Record<LeadQualificationPillar, string> {
  return { TIMELINE: '', CONDITION: '', MOTIVATION: '', PRICE: '' }
}

function statusLabel(row: LeadQualificationRow | undefined) {
  if (row?.status === 'verified') return 'Verified'
  if (row?.status === 'needs_review') return 'Confirm'
  return 'Missing'
}

export function LeadQualificationPanel({
  leadId,
  variant = 'compact',
  onQualificationChange,
}: LeadQualificationPanelProps) {
  const [qualification, setQualification] = useState<LeadQualificationResponse | null>(null)
  const [draft, setDraft] = useState<Record<LeadQualificationPillar, string>>(emptyDraft)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}/qualification`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as LeadQualificationResponse | null
      if (!response.ok || !payload) throw new Error(payload?.error || 'Qualification records are unavailable')
      setQualification(payload)
      onQualificationChange?.(payload)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Qualification records are unavailable')
    } finally {
      setLoading(false)
    }
  }, [leadId, onQualificationChange])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    function refresh(event: Event) {
      if (event instanceof CustomEvent && event.detail?.leadId && event.detail.leadId !== leadId) return
      void load()
    }
    window.addEventListener('crm:lead-refresh', refresh)
    window.addEventListener('crm:qualification-updated', refresh)
    return () => {
      window.removeEventListener('crm:lead-refresh', refresh)
      window.removeEventListener('crm:qualification-updated', refresh)
    }
  }, [leadId, load])

  const openEditor = () => {
    const next = emptyDraft()
    for (const row of qualification?.pillars ?? []) next[row.pillar] = row.evidence
    setDraft(next)
    setError(null)
    setEditing(true)
  }

  const saveablePillars = useMemo(() => LEAD_QUALIFICATION_PILLARS.filter((pillar) => {
    const value = draft[pillar.key].trim()
    if (!value) return false
    const original = qualification?.pillars.find((row) => row.pillar === pillar.key)
    return original?.status !== 'verified' || original.evidence.trim() !== value
  }), [draft, qualification])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const pillars = Object.fromEntries(saveablePillars.map((pillar) => [pillar.key, draft[pillar.key].trim()]))
      const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}/qualification`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pillars }),
      })
      const payload = await response.json().catch(() => null) as LeadQualificationResponse | null
      if (!response.ok || !payload) throw new Error(payload?.error || 'Qualification evidence could not be saved')
      setQualification(payload)
      onQualificationChange?.(payload)
      setEditing(false)
      window.dispatchEvent(new CustomEvent('crm:qualification-updated', { detail: { leadId } }))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Qualification evidence could not be saved')
    } finally {
      setSaving(false)
    }
  }

  const verifiedCount = qualification?.verifiedCount ?? 0
  const reviewCount = qualification?.pillars.filter((row) => row.status === 'needs_review').length ?? 0
  const missingCount = 4 - verifiedCount - reviewCount

  return (
    <>
      <section
        id="lead-qualification"
        className={cn(
          'scroll-mt-6 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4',
          variant === 'compact' && 'mt-3',
        )}
        aria-label="Seller qualification"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black text-[var(--crm-ink)]">Four-pillar qualification</p>
            <p className="mt-0.5 text-[10px] text-[var(--crm-text-muted)]">
              {verifiedCount}/4 verified{reviewCount ? ` · ${reviewCount} to confirm` : ''}{missingCount ? ` · ${missingCount} missing` : ''}
            </p>
          </div>
          <button type="button" onClick={openEditor} disabled={loading || Boolean(error && !qualification)} className="crm-secondary-button rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50">
            {verifiedCount > 0 || reviewCount > 0 ? 'Review' : 'Capture'}
          </button>
        </div>

        <ul className={cn('mt-3 overflow-hidden rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)]', variant === 'copilot' && 'sm:grid sm:grid-cols-2')}>
          {LEAD_QUALIFICATION_PILLARS.map((pillar) => {
            const row = qualification?.pillars.find((item) => item.pillar === pillar.key)
            const verified = row?.status === 'verified'
            const needsReview = row?.status === 'needs_review'
            const evidence = row?.evidence || 'Not captured yet.'
            return (
              <li key={pillar.key} className="border-b border-[var(--crm-border)] px-3 py-2.5 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[9px] font-black',
                      verified
                        ? 'border-[var(--crm-success)] bg-[var(--crm-success)] text-white'
                        : needsReview
                          ? 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'
                          : 'border-[var(--crm-border-strong)] bg-[var(--crm-surface)] text-transparent',
                    )}
                    aria-hidden="true"
                  >
                    {verified ? '✓' : needsReview ? '•' : ''}
                  </span>
                  <h3 className="text-[11px] font-black text-[var(--crm-ink)]">{pillar.label}</h3>
                  <span className={cn(
                    'ml-auto text-[8px] font-black uppercase tracking-[0.08em]',
                    verified ? 'text-[var(--crm-success)]' : needsReview ? 'text-[var(--crm-brand)]' : 'text-[var(--crm-text-dim)]',
                  )}>{statusLabel(row)}</span>
                </div>
                <p className={cn('mt-1 line-clamp-2 pl-[22px] text-[10px] leading-4', row?.evidence ? 'text-[var(--crm-text)]' : 'text-[var(--crm-text-muted)]')} title={evidence}>
                  {evidence}
                </p>
              </li>
            )
          })}
        </ul>

        {reviewCount > 0 ? <p className="mt-2 text-[10px] leading-4 text-[var(--crm-brand)]">Confirm suggestions before treating them as seller facts.</p> : null}
        {loading ? <p role="status" className="mt-2 text-[10px] text-[var(--crm-text-muted)]">Loading qualification…</p> : null}
        {error && !editing ? <p role="alert" className="mt-2 text-[10px] text-[var(--crm-danger)]">{error}</p> : null}
      </section>

      {editing ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) setEditing(false) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="qualification-title" className="crm-panel-raised max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl shadow-2xl">
            <header className="flex items-start gap-3 border-b border-[var(--crm-border)] p-5">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--crm-violet-soft)] text-xs font-black text-[var(--crm-violet)]">4P</span>
              <div className="min-w-0 flex-1">
                <p className="crm-eyebrow">Human-owned evidence</p>
                <h2 id="qualification-title" className="mt-1 text-lg font-black text-[var(--crm-ink)]">Verify four-pillar qualification</h2>
                <p className="mt-1 text-sm text-[var(--crm-text-muted)]">Save one pillar or all four. Suggested evidence is not a fact until you review it.</p>
              </div>
              <button type="button" onClick={() => setEditing(false)} aria-label="Close qualification editor" className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg text-lg font-bold" title="Close">×</button>
            </header>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {LEAD_QUALIFICATION_PILLARS.map((pillar) => {
                const original = qualification?.pillars.find((row) => row.pillar === pillar.key)
                return (
                  <label key={pillar.key} className="block">
                    <span className="flex items-center justify-between gap-2 text-xs font-black text-[var(--crm-ink)]">
                      {pillar.label}
                      {original?.status === 'verified' ? <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--crm-success)]">Verified</span> : null}
                      {original?.status === 'needs_review' ? <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--crm-brand)]">Confirm suggestion</span> : null}
                    </span>
                    <span className="mt-1 block text-[11px] text-[var(--crm-text-muted)]">{pillar.prompt}</span>
                    <textarea
                      value={draft[pillar.key]}
                      onChange={(event) => setDraft((current) => ({ ...current, [pillar.key]: event.target.value }))}
                      maxLength={2000}
                      rows={4}
                      className="mt-2 w-full resize-y rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-3 py-2 text-sm text-[var(--crm-ink)] outline-none focus:border-[var(--crm-brand)]"
                    />
                  </label>
                )
              })}
            </div>
            {error ? <p role="alert" className="mx-5 mb-3 text-sm text-[var(--crm-danger)]">{error}</p> : null}
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--crm-border)] p-4">
              <p className="text-xs text-[var(--crm-text-muted)]">Only non-empty reviewed fields will be saved.</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setEditing(false)} className="crm-secondary-button rounded-lg px-4 py-2 text-sm font-bold">Cancel</button>
                <button type="button" onClick={save} disabled={saving || saveablePillars.length === 0} className="crm-primary-button rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50">
                  {saving ? 'Saving…' : saveablePillars.length ? `Verify and save ${saveablePillars.length}` : 'No changes to save'}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )
}
