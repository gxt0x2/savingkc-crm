'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { DispoDeal } from '@/types/dispo'

const REASONS = [
  ['seller_cancelled', 'Seller cancelled'],
  ['buyer_default', 'Buyer defaulted'],
  ['title_issue', 'Title issue'],
  ['inspection_issue', 'Inspection issue'],
  ['financing_failed', 'Financing failed'],
  ['other', 'Other verified reason'],
] as const

export function FalloutDialog({ deal, onClose, onSaved }: { deal: DispoDeal; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [evidenceReference, setEvidenceReference] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/dispo-deals/${deal.id}/closeout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'record_fallout', reason, notes, evidenceReference }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not record verified fallout')
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record verified fallout')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <button type="button" aria-label="Close verified fallout" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" />
      <section role="dialog" aria-modal="true" aria-labelledby="fallout-title" className="relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--crm-danger-border)] bg-[var(--crm-surface)] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--crm-border)] px-6 py-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--crm-danger)]">Verified fallout</p>
            <h2 id="fallout-title" className="mt-1 text-xl font-black text-[var(--crm-ink)]">Close a transaction that did not fund</h2>
            <p className="mt-1 text-sm text-[var(--crm-text-muted)]">{deal.lead?.property_address || deal.lead?.full_name || 'Disposition deal'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="crm-icon-button grid h-9 w-9 place-items-center rounded-lg" aria-label="Close dialog"><Icon name="close" size="text-lg" /></button>
        </header>
        <div className="space-y-4 p-6">
          <div className="rounded-xl border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] p-4 text-sm font-semibold text-[var(--crm-ink)]">
            This removes the deal from active Dispositions and TC work and reports a verified zero-revenue outcome to Marketing. It cannot be used for an uncertain or temporarily delayed deal.
          </div>
          <label className="block"><span className="text-xs font-black text-[var(--crm-ink)]">What definitively ended the transaction?</span><select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2.5 text-sm text-[var(--crm-ink)]"><option value="">Choose a verified reason</option>{REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="block"><span className="text-xs font-black text-[var(--crm-ink)]">Evidence reference</span><input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} placeholder="Cancellation email, signed release, title note, message date…" className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2.5 text-sm text-[var(--crm-ink)]" /></label>
          <label className="block"><span className="text-xs font-black text-[var(--crm-ink)]">What happened?</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="Record the facts another operator would need to verify this outcome." className="mt-2 w-full resize-y rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2.5 text-sm text-[var(--crm-ink)]" /></label>
          <label className="flex items-start gap-3 rounded-xl border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] p-4 text-sm font-semibold text-[var(--crm-ink)]"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--crm-danger)]" />I verified this transaction has ended and the evidence reference above is accurate.</label>
          {error ? <p className="text-sm font-semibold text-[var(--crm-danger)]">{error}</p> : null}
          <div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="crm-secondary-button rounded-lg px-4 py-2 text-sm font-black">Keep active</button><button type="button" onClick={() => void submit()} disabled={busy || !confirmed || !reason || !notes.trim() || !evidenceReference.trim()} className="rounded-lg bg-[var(--crm-danger)] px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-45">{busy ? 'Recording…' : 'Confirm verified fallout'}</button></div>
        </div>
      </section>
    </div>
  )
}
