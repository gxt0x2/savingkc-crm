'use client'

import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { formatCurrency } from '@/lib/utils'
import type { DispoDeal } from '@/types/dispo'

type CloseoutMode = 'funding' | 'debrief'

function localDateValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function parseMoney(value: string): number {
  const parsed = Number(value.replace(/[$,]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function RatingField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <fieldset>
      <legend className="text-xs font-bold text-[var(--crm-ink)]">{label}</legend>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            onClick={() => onChange(rating)}
            aria-pressed={value === rating}
            className={`h-9 rounded-lg border text-xs font-black transition-colors ${
              value === rating
                ? 'border-[var(--crm-brand)] bg-[var(--crm-brand)] text-white'
                : 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)] hover:border-[var(--crm-brand-border)] hover:text-[var(--crm-brand)]'
            }`}
          >
            {rating}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export function CloseoutDialog({
  deal,
  mode,
  onClose,
  onSaved,
}: {
  deal: DispoDeal
  mode: CloseoutMode
  onClose: () => void
  onSaved: () => void
}) {
  const funding = deal.closeout?.funding
  const [fundedDate, setFundedDate] = useState(() => funding?.fundedAt?.slice(0, 10) || localDateValue())
  const [finalAssignmentFee, setFinalAssignmentFee] = useState(() => String(funding?.finalAssignmentFee ?? deal.assignment_fee ?? ''))
  const [closingCosts, setClosingCosts] = useState(() => String(funding?.closingCosts ?? 0))
  const [sellerPurchasePrice, setSellerPurchasePrice] = useState(() => String(funding?.sellerPurchasePrice ?? deal.lead?.offer_amount ?? ''))
  const [buyerPurchasePrice, setBuyerPurchasePrice] = useState(() => String(funding?.buyerPurchasePrice ?? ''))
  const [fundingConfirmed, setFundingConfirmed] = useState(false)
  const [settlementVerified, setSettlementVerified] = useState(false)
  const [notes, setNotes] = useState(() => funding?.notes || '')
  const [outcomeRating, setOutcomeRating] = useState(0)
  const [buyerPerformance, setBuyerPerformance] = useState(0)
  const [sourceQuality, setSourceQuality] = useState(0)
  const [wentWell, setWentWell] = useState('')
  const [friction, setFriction] = useState('')
  const [lesson, setLesson] = useState('')
  const [processChange, setProcessChange] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const netRevenue = useMemo(
    () => parseMoney(finalAssignmentFee) - parseMoney(closingCosts),
    [closingCosts, finalAssignmentFee],
  )

  async function submitFunding() {
    setBusy(true)
    setError(null)
    try {
      const fundedAt = new Date(`${fundedDate}T12:00:00`).toISOString()
      const response = await fetch(`/api/dispo-deals/${deal.id}/closeout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'record_funding',
          fundedAt,
          finalAssignmentFee: parseMoney(finalAssignmentFee),
          closingCosts: parseMoney(closingCosts),
          sellerPurchasePrice: sellerPurchasePrice ? parseMoney(sellerPurchasePrice) : null,
          buyerPurchasePrice: buyerPurchasePrice ? parseMoney(buyerPurchasePrice) : null,
          settlementStatementVerified: settlementVerified,
          fundingConfirmed,
          notes,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not close the transaction')
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not close the transaction')
    } finally {
      setBusy(false)
    }
  }

  async function submitDebrief() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/dispo-deals/${deal.id}/closeout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'complete_debrief',
          outcomeRating,
          buyerPerformance,
          sourceQuality,
          wentWell,
          friction,
          lesson,
          processChange,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not complete the debrief')
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not complete the debrief')
    } finally {
      setBusy(false)
    }
  }

  const address = deal.lead?.property_address || 'Closed transaction'

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close transaction close-out"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-[3px]"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="closeout-title"
        className="relative z-10 max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-6 py-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--crm-brand)]">
              {mode === 'funding' ? 'Funding and close-out' : 'Post-close debrief'}
            </p>
            <h2 id="closeout-title" className="mt-1 text-2xl font-black tracking-tight text-[var(--crm-ink)]">
              {mode === 'funding' ? 'Close the transaction correctly' : 'Turn this close into a better next deal'}
            </h2>
            <p className="mt-1 text-sm text-[var(--crm-text-muted)]">{address}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close dialog" className="crm-icon-button flex h-10 w-10 items-center justify-center rounded-lg">
            <Icon name="close" className="text-xl" />
          </button>
        </header>

        {mode === 'funding' ? (
          <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_330px]">
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-bold text-[var(--crm-ink)]">Funding date</span>
                  <input type="date" value={fundedDate} onChange={(event) => setFundedDate(event.target.value)} className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2.5 text-sm font-semibold text-[var(--crm-ink)]" />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-[var(--crm-ink)]">Final assignment fee / gross revenue</span>
                  <input inputMode="decimal" value={finalAssignmentFee} onChange={(event) => setFinalAssignmentFee(event.target.value)} placeholder="$0" className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2.5 text-sm font-semibold text-[var(--crm-ink)]" />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-[var(--crm-ink)]">Company closing costs</span>
                  <input inputMode="decimal" value={closingCosts} onChange={(event) => setClosingCosts(event.target.value)} placeholder="$0" className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2.5 text-sm font-semibold text-[var(--crm-ink)]" />
                </label>
                <div className="rounded-xl border border-[var(--crm-success)]/30 bg-[var(--crm-success-soft)] p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[var(--crm-success)]">Net revenue</p>
                  <p className="mt-1 text-2xl font-black text-[var(--crm-success)]">{formatCurrency(netRevenue)}</p>
                </div>
                <label className="block">
                  <span className="text-xs font-bold text-[var(--crm-ink)]">Seller purchase price</span>
                  <input inputMode="decimal" value={sellerPurchasePrice} onChange={(event) => setSellerPurchasePrice(event.target.value)} placeholder="Optional" className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2.5 text-sm font-semibold text-[var(--crm-ink)]" />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-[var(--crm-ink)]">Buyer purchase price</span>
                  <input inputMode="decimal" value={buyerPurchasePrice} onChange={(event) => setBuyerPurchasePrice(event.target.value)} placeholder="Optional" className="mt-2 w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2.5 text-sm font-semibold text-[var(--crm-ink)]" />
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-bold text-[var(--crm-ink)]">Close-out notes</span>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Final title, funding, or exception notes" className="mt-2 w-full resize-y rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2.5 text-sm text-[var(--crm-ink)]" />
              </label>

              <div className="space-y-2 rounded-xl border border-[var(--crm-warning)]/35 bg-[var(--crm-warning-soft)] p-4">
                <label className="flex items-start gap-3 text-sm font-semibold text-[var(--crm-ink)]">
                  <input type="checkbox" checked={fundingConfirmed} onChange={(event) => setFundingConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--crm-brand)]" />
                  Funding has cleared—not merely been scheduled.
                </label>
                <label className="flex items-start gap-3 text-sm font-semibold text-[var(--crm-ink)]">
                  <input type="checkbox" checked={settlementVerified} onChange={(event) => setSettlementVerified(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--crm-brand)]" />
                  The final settlement statement has been reviewed and matches these numbers.
                </label>
              </div>
            </div>

            <aside className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-5">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]">What happens next</p>
              <ol className="mt-4 space-y-4">
                {[
                  ['1', 'Marketing stops', 'The public deal page is deactivated.'],
                  ['2', 'Operations close', 'TC is marked closed and outcome metrics are frozen.'],
                  ['3', 'Debrief is due', 'A required debrief task is due the next business day.'],
                  ['4', 'Follow-up is reviewed', 'A seven-day seller follow-up task is created; nothing sends automatically.'],
                  ['5', 'Archive after learning', 'The transaction archives only after the debrief is complete.'],
                ].map(([number, title, copy]) => (
                  <li key={number} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--crm-brand-soft)] text-[11px] font-black text-[var(--crm-brand)]">{number}</span>
                    <span><strong className="block text-sm text-[var(--crm-ink)]">{title}</strong><span className="mt-0.5 block text-xs leading-5 text-[var(--crm-text-muted)]">{copy}</span></span>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        ) : (
          <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <RatingField label="Overall outcome" value={outcomeRating} onChange={setOutcomeRating} />
                <RatingField label="Buyer performance" value={buyerPerformance} onChange={setBuyerPerformance} />
                <RatingField label="Lead-source quality" value={sourceQuality} onChange={setSourceQuality} />
              </div>
              {[
                ['What worked?', wentWell, setWentWell, 'The decisions, behaviors, or handoffs worth repeating'],
                ['Primary friction point', friction, setFriction, 'The bottleneck, delay, objection, or avoidable rework'],
                ['Main lesson', lesson, setLesson, 'What this deal taught the team'],
                ['Process change', processChange, setProcessChange, 'What changes now—or why no change is needed'],
              ].map(([label, value, setter, placeholder]) => (
                <label key={label as string} className="block">
                  <span className="text-xs font-bold text-[var(--crm-ink)]">{label as string}</span>
                  <textarea value={value as string} onChange={(event) => (setter as (next: string) => void)(event.target.value)} rows={2} placeholder={placeholder as string} className="mt-2 w-full resize-y rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2.5 text-sm text-[var(--crm-ink)]" />
                </label>
              ))}
            </div>
            <aside className="rounded-2xl border border-[var(--crm-violet)]/25 bg-[var(--crm-violet-soft)] p-5">
              <Icon name="psychology" className="text-3xl text-[var(--crm-violet)]" />
              <h3 className="mt-3 text-lg font-black text-[var(--crm-ink)]">Debrief timing</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--crm-text-muted)]">Complete within one business day of funding while the decisions and friction are still fresh.</p>
              <div className="mt-4 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3 text-xs leading-5 text-[var(--crm-text-muted)]">
                Submitting this debrief completes the internal debrief task, preserves the lesson with the deal, and moves the transaction into the archived closed record.
              </div>
            </aside>
          </div>
        )}

        {error ? <div className="mx-6 mb-4 rounded-lg border border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--crm-danger)]">{error}</div> : null}

        <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-[var(--crm-border)] bg-[var(--crm-surface)] px-6 py-4">
          <p className="hidden text-xs text-[var(--crm-text-muted)] sm:block">This action is recorded in the lead activity history.</p>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-[var(--crm-border)] px-4 py-2.5 text-sm font-bold text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-subtle)]">Cancel</button>
            <button type="button" onClick={mode === 'funding' ? submitFunding : submitDebrief} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[var(--crm-brand)] px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-[var(--crm-brand-hover)] disabled:opacity-50">
              <Icon name={mode === 'funding' ? 'verified' : 'archive'} className="text-lg" />
              {busy ? 'Saving…' : mode === 'funding' ? 'Confirm funding & close' : 'Complete debrief & archive'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
