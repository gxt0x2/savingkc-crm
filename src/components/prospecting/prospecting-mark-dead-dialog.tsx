'use client'

import { Icon } from '@/components/ui/icon'
import { DEAD_REASONS } from '@/lib/dialer-dispositions'

interface ProspectingMarkDeadDialogProps {
  ownerName: string
  propertyAddress: string
  reason: string
  notes: string
  error: string | null
  busy: boolean
  onReasonChange: (reason: string) => void
  onNotesChange: (notes: string) => void
  onClose: () => void
  onSubmit: () => void
}

export function ProspectingMarkDeadDialog(props: ProspectingMarkDeadDialogProps) {
  return <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="prospecting-mark-dead-title">
    <button type="button" aria-label="Close" onClick={() => { if (!props.busy) props.onClose() }} className="absolute inset-0 bg-black/55 backdrop-blur-[6px]" />
    <div className="relative z-[1] w-full max-w-[440px] rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)] shadow-2xl">
      <div className="flex items-center gap-3 border-b border-[var(--ck-border)] px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E32E2E]/15 text-[#ff7777]"><Icon name="cancel" size="text-lg" /></span>
        <div className="min-w-0"><p id="prospecting-mark-dead-title" className="text-sm font-black leading-tight text-[var(--ck-text)]">Mark lead dead</p><p className="truncate text-xs text-[var(--ck-text-muted)]">{props.ownerName} · {props.propertyAddress || 'this property'}</p></div>
      </div>
      <div className="p-5">
        <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Why is it dead? <span className="text-[#ff7777]">Required</span></p>
        <div className="grid max-h-[280px] grid-cols-1 gap-1.5 overflow-auto pr-1">{DEAD_REASONS.map((reason) => {
          const selected = props.reason === reason.id
          return <button key={reason.id} type="button" onClick={() => props.onReasonChange(reason.id)} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${selected ? 'border-[#E32E2E]/45 bg-[#E32E2E]/15 font-semibold text-[var(--ck-text)]' : 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)] hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]'}`}><Icon name={selected ? 'radio_button_checked' : 'radio_button_unchecked'} size="text-base" className={selected ? 'text-[#E32E2E]' : 'text-[var(--ck-text-dim)]'} />{reason.label}</button>
        })}</div>
        <label className="mt-4 block text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Notes {props.reason === 'other' ? <span className="text-[#ff7777]">Required</span> : <span className="normal-case tracking-normal">Optional</span>}
          <textarea value={props.notes} onChange={(event) => props.onNotesChange(event.target.value)} rows={3} placeholder="Add context an agent or AI will need later…" className="mt-2 w-full resize-none rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold normal-case tracking-normal text-[var(--ck-text)] outline-none focus:border-[#E32E2E]" />
        </label>
        {props.error ? <p className="mt-3 text-xs font-bold text-[#ff7777]">{props.error}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-[var(--ck-border)] px-5 py-4">
        <button type="button" onClick={props.onClose} disabled={props.busy} className="rounded-lg border border-[var(--ck-border)] px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)] disabled:opacity-40">Cancel</button>
        <button type="button" onClick={props.onSubmit} disabled={!props.reason || (props.reason === 'other' && !props.notes.trim()) || props.busy} className="rounded-lg bg-[#E32E2E] px-3 py-2.5 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-[#C42626] disabled:cursor-not-allowed disabled:opacity-40">{props.busy ? 'Saving…' : 'Mark dead & next'}</button>
      </div>
    </div>
  </div>
}
