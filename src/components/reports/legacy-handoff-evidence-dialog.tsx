'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { LifecycleEvidenceIssue } from '@/lib/server/lifecycle-reconciliation'

function localDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function LegacyHandoffEvidenceDialog({
  issue,
  onClose,
  onRecorded,
}: {
  issue: LifecycleEvidenceIssue
  onClose: () => void
  onRecorded: () => void
}) {
  const [reference, setReference] = useState('')
  const [occurredOn, setOccurredOn] = useState(localDate)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const assignment = issue.kind === 'assignment_handoff'

  async function submit() {
    if (!confirmed || reference.trim().length < 3 || !occurredOn) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/reports/lifecycle-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: issue.kind,
          leadId: issue.leadId,
          recordId: issue.recordId,
          candidateId: issue.candidateId,
          evidenceReference: reference.trim(),
          evidenceOccurredAt: new Date(`${occurredOn}T12:00:00`).toISOString(),
          confirmed: true,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Evidence could not be recorded')
      onRecorded()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Evidence could not be recorded')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="legacy-evidence-title" className="w-full max-w-xl rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--crm-border)] px-5 py-4">
          <div><p className="crm-eyebrow">Human-verified evidence</p><h2 id="legacy-evidence-title" className="mt-1 text-lg font-black">{assignment ? 'Verify an executed buyer assignment' : 'Verify a signed seller contract'}</h2><p className="mt-1 text-xs font-semibold text-[var(--crm-text-muted)]">{issue.title}</p></div>
          <button type="button" onClick={onClose} disabled={saving} className="crm-icon-button grid h-9 w-9 place-items-center rounded-lg" aria-label="Close evidence review"><Icon name="close" /></button>
        </header>
        <div className="space-y-4 px-5 py-5">
          <div className="rounded-xl border border-[var(--crm-action-border)] bg-[var(--crm-action-soft)] px-4 py-3 text-xs font-semibold text-[var(--crm-action)]">Only continue after opening the actual signed document, title record, or durable system record. A note that the deal existed is not sufficient evidence.</div>
          <label className="block text-xs font-black">Evidence reference<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Document URL, DocuSeal submission ID, title file, or signed contract reference" maxLength={500} className="crm-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-sm" /></label>
          <label className="block text-xs font-black">{assignment ? 'Assignment signed date' : 'Seller contract signed date'}<input type="date" value={occurredOn} max={localDate()} onChange={(event) => setOccurredOn(event.target.value)} className="crm-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-sm" /></label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--crm-border)] p-3 text-xs font-semibold"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4" /><span>I opened and verified the underlying signed evidence. The reference and date above are factual and should become part of the CRM audit trail.</span></label>
          {error ? <p role="alert" className="text-xs font-bold text-[var(--crm-danger)]">{error}</p> : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-[var(--crm-border)] px-5 py-4"><button type="button" onClick={onClose} disabled={saving} className="crm-secondary-button rounded-lg px-4 py-2.5 text-xs font-black">Cancel</button><button type="button" onClick={() => void submit()} disabled={saving || !confirmed || reference.trim().length < 3 || !occurredOn} className="crm-primary-button rounded-lg px-4 py-2.5 text-xs font-black">{saving ? 'Recording…' : 'Record verified evidence'}</button></footer>
      </section>
    </div>
  )
}
