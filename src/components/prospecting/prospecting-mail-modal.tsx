'use client'

import { useId, useRef, useState } from 'react'

import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'
import { withDialerSessionControlOperation } from '@/lib/telephony/dialer-control-operation-client'

interface ProspectingMailModalProps {
  leadId: string | null
  prospectId: string | null
  campaignMemberId: string | null
  dialerSessionId: string
  sellerName: string
  propertyAddress: string
  onClose: () => void
  onCreated: (message: string) => void
}

function toLocalDateTimeInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export function ProspectingMailModal(props: ProspectingMailModalProps) {
  const [pieceType, setPieceType] = useState('thank_you')
  const [mailState, setMailState] = useState<'needed' | 'sent'>('needed')
  const [dueAt, setDueAt] = useState(() => {
    const value = new Date()
    value.setDate(value.getDate() + 1)
    value.setHours(9, 0, 0, 0)
    return toLocalDateTimeInput(value)
  })
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pieceRef = useRef<HTMLSelectElement>(null)
  const idempotencyKey = useRef(crypto.randomUUID())
  const titleId = useId()
  const fieldId = useId()
  const close = () => { if (!saving) props.onClose() }
  const dialogRef = useDialogAccessibility<HTMLFormElement>(true, close, pieceRef)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const response = await withDialerSessionControlOperation(props.dialerSessionId, 'Saving mail action', (controlHeaders, signal) => fetch('/api/prospecting/mail-actions', {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey.current,
          ...controlHeaders,
        },
        body: JSON.stringify({
          leadId: props.leadId,
          prospectId: props.prospectId,
          campaignMemberId: props.campaignMemberId,
          dialerSessionId: props.dialerSessionId || null,
          sellerName: props.sellerName,
          propertyAddress: props.propertyAddress,
          pieceType,
          mailState,
          dueAt: mailState === 'needed' ? new Date(dueAt).toISOString() : null,
          notes,
        }),
      }))
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Mail action could not be saved. Your entries are still here.')
        return
      }
      props.onCreated(mailState === 'sent' ? 'Mail marked sent.' : 'Mail work added to the queue.')
    } catch (saveError) {
      console.error('Failed to save prospecting mail action:', saveError)
      setError('Mail action could not be saved. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={close}>
    <form ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit} onClick={(event) => event.stopPropagation()} className="crm-panel-raised flex max-h-[calc(100dvh-env(safe-area-inset-top)-.75rem)] w-full max-w-md flex-col overflow-hidden rounded-t-3xl sm:max-h-[min(90dvh,46rem)] sm:rounded-2xl">
      <div className="flex items-start border-b border-[var(--crm-border)] px-4 pb-3 pt-4 sm:px-6 sm:pt-6">
        <div className="min-w-0 flex-1"><p className="crm-eyebrow">Prospecting wrap-up</p><h2 id={titleId} className="mt-0.5 text-xl font-black text-[var(--crm-ink)]">Add mail action</h2><p className="mt-1 truncate text-xs text-[var(--crm-text-muted)]">{props.sellerName} · {props.propertyAddress || 'this property'}</p></div>
        <button type="button" onClick={close} disabled={saving} className="crm-icon-button grid h-11 w-11 place-items-center rounded-xl" aria-label="Close mail form">×</button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
        <div><label htmlFor={`${fieldId}-piece`} className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Mail piece</label><select ref={pieceRef} id={`${fieldId}-piece`} value={pieceType} onChange={(event) => setPieceType(event.target.value)} className="crm-field min-h-11 w-full rounded-lg px-3 py-2 text-base"><option value="thank_you">Thank-you letter</option><option value="letter">Letter</option><option value="postcard">Postcard</option></select></div>
        <fieldset><legend className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Status</legend><div className="grid grid-cols-2 gap-2">{([['needed', 'Needs mailing'], ['sent', 'Already sent']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mailState === value} onClick={() => setMailState(value)} className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-bold ${mailState === value ? 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'border-[var(--crm-border)] text-[var(--crm-text-muted)]'}`}>{label}</button>)}</div></fieldset>
        {mailState === 'needed' ? <div><label htmlFor={`${fieldId}-due`} className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Mail by</label><input id={`${fieldId}-due`} type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} required className="crm-field min-h-11 w-full rounded-lg px-3 py-2 text-base" /></div> : null}
        <div><label htmlFor={`${fieldId}-notes`} className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Instructions <span className="font-medium text-[var(--crm-text-dim)]">(optional)</span></label><textarea id={`${fieldId}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="What should be included?" className="crm-field w-full resize-none rounded-lg px-3 py-2 text-base" /></div>
        {error ? <p role="alert" className="rounded-xl border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-3 py-2 text-sm font-semibold text-[var(--crm-danger)]">{error}</p> : null}
      </div>
      <div className="flex gap-3 border-t border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-4 sm:px-6"><button type="button" onClick={props.onClose} disabled={saving} className="crm-secondary-button min-h-11 flex-1 rounded-xl px-4 py-2 text-sm font-bold">Cancel</button><button type="submit" disabled={saving || (mailState === 'needed' && !dueAt)} className="crm-primary-button min-h-11 flex-[1.35] rounded-xl px-5 py-2 text-sm font-bold disabled:opacity-40">{saving ? 'Saving…' : mailState === 'sent' ? 'Mark Sent' : 'Add Mail Work'}</button></div>
    </form>
  </div>
}
