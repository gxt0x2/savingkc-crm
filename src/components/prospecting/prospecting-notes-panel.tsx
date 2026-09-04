'use client'

import { ContactNoteComposer } from '@/components/leads/contact-note-composer'
import type { DialerActivity } from '@/lib/dialer-lead-activity'
import { withDialerSessionControlOperation } from '@/lib/telephony/dialer-control-operation-client'

interface ProspectingNotesPanelProps {
  leadId: string | null
  prospectId: string | null
  campaignMemberId: string | null
  dialerSessionId: string
  sellerName: string
  notes: DialerActivity[]
  readOnly: boolean
  onSaved: () => void
}

function noteContact(activity: DialerActivity): string {
  const value = activity.metadata?.contact_name
  return typeof value === 'string' && value.trim() ? value.trim() : 'Seller note'
}

function noteTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  }).format(date)
}

export function ProspectingNotesPanel(props: ProspectingNotesPanelProps) {
  async function save(description: string) {
    const response = await withDialerSessionControlOperation(props.dialerSessionId, 'Saving seller note', (controlHeaders, signal) => fetch('/api/prospecting/contact-notes', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...controlHeaders,
      },
      body: JSON.stringify({
        leadId: props.leadId,
        prospectId: props.prospectId,
        campaignMemberId: props.campaignMemberId,
        dialerSessionId: props.dialerSessionId,
        contactKey: `seller:${props.prospectId || props.leadId || 'current'}`,
        contactName: props.sellerName || 'Current seller',
        relation: 'seller',
        description,
      }),
    }))
    const body = await response.json().catch(() => null) as { error?: string } | null
    if (!response.ok) throw new Error(body?.error || 'Could not save seller note')
    props.onSaved()
  }

  return <section aria-label="Notes" className="ck-card p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Notes</p>
        <h2 className="mt-0.5 text-sm font-black text-[var(--ck-text)]">Keep the seller context in view</h2>
      </div>
      <span className="rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-muted)]">{props.notes.length} saved</span>
    </div>

    <ContactNoteComposer contactName={props.sellerName || 'current seller'} onSave={save} readOnlyPreview={props.readOnly} />

    {props.notes.length > 0 ? <div className="mt-3 space-y-2 border-t border-[var(--ck-border)] pt-3">
      {props.notes.slice(0, 3).map((note) => <article key={note.id} className="rounded-lg border border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] p-3">
        <div className="flex items-start justify-between gap-3">
          <p className="truncate text-xs font-black text-[var(--ck-text)]">{noteContact(note)}</p>
          <time dateTime={note.created_at} className="shrink-0 text-[9px] font-bold text-[var(--ck-text-dim)]">{noteTime(note.created_at)}</time>
        </div>
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-[var(--ck-text-muted)]">{note.description || 'Note saved without details.'}</p>
      </article>)}
      {props.notes.length > 3 ? <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--ck-text-dim)]">{props.notes.length - 3} more in History</p> : null}
    </div> : <p className="mt-2 text-[10px] leading-4 text-[var(--ck-text-muted)]">Seller notes and notes saved on associated people stay here and in History.</p>}
  </section>
}
