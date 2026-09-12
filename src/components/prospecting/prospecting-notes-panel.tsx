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
  recordKind: 'Lead' | 'Source Prospect'
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

  return <section aria-label="Notes" className="flex h-full min-h-0 flex-col">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Default workspace</p>
        <h2 className="mt-0.5 text-sm font-black text-[var(--ck-text)]">Notes</h2>
      </div>
      <span className="rounded-full border border-[var(--prospecting-warning)]/35 bg-[var(--prospecting-warning-soft)] px-2.5 py-1 text-[9px] font-bold text-[var(--prospecting-warning-ink)]">{props.recordKind}</span>
    </div>

    <ContactNoteComposer contactName={props.sellerName || 'current seller'} onSave={save} readOnlyPreview={props.readOnly} rows={4} variant="workspace" fillAvailable />

    <div className="mt-3 space-y-2 border-t border-[var(--ck-border)] pt-3">
      <p className="text-[9px] font-black uppercase tracking-[0.14em] text-[var(--ck-text-dim)]">Recent notes</p>
      {props.notes.length > 0 ? props.notes.slice(0, 3).map((note) => <article key={note.id} className="rounded-lg border border-[var(--prospecting-border)] bg-[var(--prospecting-elevated)] p-3">
        <p className="truncate text-[11px] font-bold text-[var(--ck-text)]">{noteContact(note)} · <time dateTime={note.created_at}>{noteTime(note.created_at)}</time></p>
        <p className="mt-1 pl-5 line-clamp-3 whitespace-pre-wrap text-[11px] leading-4 text-[var(--ck-text-muted)]">{note.description || 'Note saved without details.'}</p>
      </article>) : <p className="rounded-lg border border-[var(--prospecting-border)] bg-[var(--prospecting-elevated)] px-3 py-3 text-[11px] text-[var(--ck-text-muted)]">No recent notes for this record.</p>}
      {props.notes.length > 3 ? <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--ck-text-dim)]">{props.notes.length - 3} more in History</p> : null}
    </div>
  </section>
}
