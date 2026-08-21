'use client'

import { useState } from 'react'
import type { AiChangeProposal } from '@/lib/ai-change-proposal'

function label(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function changeValue(field: string, value: string | number | null) {
  if (value == null || value === '') return 'Not set'
  if (field === 'asking_price' && typeof value === 'number') return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  return typeof value === 'string' ? label(value) : String(value)
}

export function AiChangeProposalCard({
  proposal,
  onDecision,
}: {
  proposal: AiChangeProposal
  onDecision: (decision: 'approved' | 'rejected') => Promise<AiChangeProposal>
}) {
  const [saving, setSaving] = useState<'approved' | 'rejected' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: 'approved' | 'rejected') {
    setSaving(decision)
    setError(null)
    try {
      await onDecision(decision)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the AI change decision.')
    } finally {
      setSaving(null)
    }
  }

  if (proposal.status === 'applied') {
    return <p role="status" className="rounded-lg bg-emerald-500/10 px-3 py-2 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">Reviewed and applied by {proposal.decidedBy || 'a team member'}.</p>
  }
  if (proposal.status === 'rejected') {
    return <p role="status" className="rounded-lg bg-[var(--crm-surface-subtle)] px-3 py-2 text-[11px] font-bold text-[var(--crm-text-muted)]">Reviewed and rejected. No CRM fields were changed.</p>
  }
  if (proposal.status === 'conflict') {
    return <p role="alert" className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-700 dark:text-amber-300">Not applied because the contact changed after the AI review. Review the contact manually.</p>
  }
  return (
    <div className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
      <p className="text-[11px] font-black text-[var(--crm-ink)]">AI-proposed CRM changes</p>
      <p className="mt-1 text-[10px] text-[var(--crm-text-muted)]">Nothing below changes until you approve it.</p>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--crm-text-muted)]">{proposal.summary}</p>
      <dl className="mt-2 space-y-1.5">
        {proposal.changes.map((change) => (
          <div key={change.field} className="grid gap-1 text-[11px] sm:grid-cols-[140px_minmax(0,1fr)]">
            <dt className="font-bold text-[var(--crm-text-muted)]">{change.label}</dt>
            <dd className="text-[var(--crm-ink)]"><span className="line-through opacity-60">{changeValue(change.field, change.before)}</span><span aria-hidden="true"> → </span><strong>{changeValue(change.field, change.proposed)}</strong></dd>
          </div>
        ))}
      </dl>
      {error ? <p role="alert" className="mt-2 text-[11px] font-bold text-red-600">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={saving !== null} onClick={() => void decide('approved')} className="rounded-lg bg-[var(--crm-brand)] px-3 py-2 text-[11px] font-black text-white disabled:opacity-50">{saving === 'approved' ? 'Applying…' : 'Approve & apply'}</button>
        <button type="button" disabled={saving !== null} onClick={() => void decide('rejected')} className="rounded-lg border border-[var(--crm-border-strong)] px-3 py-2 text-[11px] font-black text-[var(--crm-ink)] disabled:opacity-50">{saving === 'rejected' ? 'Rejecting…' : 'Reject changes'}</button>
      </div>
    </div>
  )
}
