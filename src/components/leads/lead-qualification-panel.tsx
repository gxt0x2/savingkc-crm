'use client'

import { useCallback, useEffect, useState } from 'react'

import { Icon } from '@/components/ui/icon'

const PILLARS = [
  { key: 'TIMELINE', label: 'Timeline', prompt: 'When does the seller need to sell?' },
  { key: 'CONDITION', label: 'Condition', prompt: 'What is the property condition?' },
  { key: 'MOTIVATION', label: 'Motivation', prompt: 'Why are they selling now?' },
  { key: 'PRICE', label: 'Price', prompt: 'What price or flexibility did they give?' },
] as const

type Pillar = (typeof PILLARS)[number]['key']
type PillarRow = {
  pillar: Pillar
  evidence: string
  status: 'missing' | 'needs_review' | 'verified'
  sourceType: 'operator' | 'legacy_manifest' | 'imported' | null
  verifiedBy: string | null
  verifiedAt: string | null
}

type QualificationResponse = {
  pillars: PillarRow[]
  complete: boolean
  verifiedCount: number
  error?: string
}

function emptyDraft(): Record<Pillar, string> {
  return { TIMELINE: '', CONDITION: '', MOTIVATION: '', PRICE: '' }
}

export function LeadQualificationPanel({ leadId }: { leadId: string }) {
  const [qualification, setQualification] = useState<QualificationResponse | null>(null)
  const [draft, setDraft] = useState<Record<Pillar, string>>(emptyDraft)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}/qualification`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as QualificationResponse | null
      if (!response.ok || !payload) throw new Error(payload?.error || 'Qualification records are unavailable')
      setQualification(payload)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Qualification records are unavailable')
    } finally {
      setLoading(false)
    }
  }, [leadId])

  useEffect(() => {
    void load()
  }, [load])

  const openEditor = () => {
    const next = emptyDraft()
    for (const row of qualification?.pillars ?? []) next[row.pillar] = row.evidence
    setDraft(next)
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}/qualification`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pillars: draft }),
      })
      const payload = await response.json().catch(() => null) as QualificationResponse | null
      if (!response.ok || !payload) throw new Error(payload?.error || 'Qualification evidence could not be saved')
      setQualification(payload)
      setEditing(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Qualification evidence could not be saved')
    } finally {
      setSaving(false)
    }
  }

  const verifiedCount = qualification?.verifiedCount ?? 0
  const reviewCount = qualification?.pillars.filter((row) => row.status === 'needs_review').length ?? 0
  const allEvidencePresent = PILLARS.every((pillar) => draft[pillar.key].trim())

  return (
    <>
      <section id="lead-qualification" className="mt-6 scroll-mt-6 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4" aria-label="Seller qualification">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]">
            <Icon name="fact_check" className="text-[19px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black text-[var(--crm-ink)]">Four-pillar qualification</p>
                <p className="mt-0.5 text-[11px] text-[var(--crm-text-muted)]">{verifiedCount}/4 human verified</p>
              </div>
              <button type="button" onClick={openEditor} disabled={loading || Boolean(error && !qualification)} className="crm-secondary-button rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50">
                {verifiedCount > 0 ? 'Review' : 'Capture'}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {PILLARS.map((pillar) => {
                const row = qualification?.pillars.find((item) => item.pillar === pillar.key)
                const verified = row?.status === 'verified'
                return (
                  <div key={pillar.key} className="flex items-center gap-2 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] px-2.5 py-2 text-[11px] font-bold text-[var(--crm-text)]">
                    <Icon name={verified ? 'check_circle' : row?.status === 'needs_review' ? 'rate_review' : 'radio_button_unchecked'} className={verified ? 'text-[15px] text-[var(--crm-success)]' : 'text-[15px] text-[var(--crm-warning)]'} />
                    {pillar.label}
                  </div>
                )
              })}
            </div>
            {reviewCount > 0 ? <p className="mt-3 text-[11px] leading-5 text-[var(--crm-warning)]">{reviewCount} legacy suggestion{reviewCount === 1 ? '' : 's'} need human review.</p> : null}
            {loading ? <p className="mt-3 text-[11px] text-[var(--crm-text-muted)]">Loading qualification…</p> : null}
            {error && !editing ? <p className="mt-3 text-[11px] text-[var(--crm-danger)]">{error}</p> : null}
          </div>
        </div>
      </section>

      {editing ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) setEditing(false) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="qualification-title" className="crm-panel-raised max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl shadow-2xl">
            <header className="flex items-start gap-3 border-b border-[var(--crm-border)] p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]"><Icon name="fact_check" /></span>
              <div className="min-w-0 flex-1">
                <p className="crm-eyebrow">Human-owned evidence</p>
                <h2 id="qualification-title" className="mt-1 text-lg font-black text-[var(--crm-ink)]">Verify four-pillar qualification</h2>
                <p className="mt-1 text-sm text-[var(--crm-text-muted)]">Imported suggestions are not facts until you review and save them.</p>
              </div>
              <button type="button" onClick={() => setEditing(false)} aria-label="Close qualification editor" className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg"><Icon name="close" /></button>
            </header>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {PILLARS.map((pillar) => {
                const original = qualification?.pillars.find((row) => row.pillar === pillar.key)
                return (
                  <label key={pillar.key} className="block">
                    <span className="flex items-center justify-between gap-2 text-xs font-black text-[var(--crm-ink)]">
                      {pillar.label}
                      {original?.status === 'needs_review' ? <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--crm-warning)]">Legacy hint</span> : null}
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
            {error ? <p className="mx-5 mb-3 text-sm text-[var(--crm-danger)]">{error}</p> : null}
            <footer className="flex items-center justify-end gap-2 border-t border-[var(--crm-border)] p-4">
              <button type="button" onClick={() => setEditing(false)} className="crm-secondary-button rounded-lg px-4 py-2 text-sm font-bold">Cancel</button>
              <button type="button" onClick={save} disabled={saving || !allEvidencePresent} className="crm-primary-button rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50">
                {saving ? 'Saving…' : 'Verify and save all four'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )
}
