'use client'

import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { formatLeadSource, getAvatarLabel, getDisplayLeadName } from '@/lib/contact-display'
import { formatPhone } from '@/lib/format'
import { isNotLeadOutcome } from '@/lib/lead-outcomes'
import { contactPipelineStatusLabel } from '@/lib/contact-smart-lists'
import type { ContactWorkspaceRow } from '@/app/(app)/contacts/page'

function relativeDate(value: string | null) {
  if (!value) return 'No activity'
  const elapsed = Date.now() - new Date(value).getTime()
  const days = Math.floor(elapsed / 86_400_000)
  if (days > 0) return `${days}d ago`
  const hours = Math.floor(elapsed / 3_600_000)
  return hours > 0 ? `${hours}h ago` : 'Just now'
}

export function ContactsLoadingSkeleton({ mobile = false }: { mobile?: boolean }) {
  if (mobile) return <div className="crm-panel space-y-3 rounded-2xl p-4" aria-label="Loading contacts">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="animate-pulse"><div className="flex items-center gap-3"><span className="h-11 w-11 rounded-full bg-[var(--crm-surface-subtle)]" /><span className="h-4 w-2/3 rounded bg-[var(--crm-surface-subtle)]" /></div><div className="mt-3 h-16 rounded-xl bg-[var(--crm-surface-subtle)]" /></div>)}</div>
  return <>{Array.from({ length: 5 }).map((_, index) => <div key={index} className="grid min-w-[980px] animate-pulse grid-cols-[2rem_1.15fr_1.15fr_.75fr_1.2fr_.85fr_.85fr_.75fr] items-center border-b border-[var(--crm-border)] px-3 py-4"><span /><span className="h-4 w-28 rounded bg-[var(--crm-surface-subtle)]" /><span className="h-4 w-36 rounded bg-[var(--crm-surface-subtle)]" /><span className="h-5 w-16 rounded bg-[var(--crm-surface-subtle)]" /><span className="h-4 w-28 rounded bg-[var(--crm-surface-subtle)]" /><span className="h-4 w-16 rounded bg-[var(--crm-surface-subtle)]" /><span className="h-4 w-12 rounded bg-[var(--crm-surface-subtle)]" /><span className="h-4 w-16 rounded bg-[var(--crm-surface-subtle)]" /></div>)}</>
}

export function MobileContactsList({ items, selectedIds, onToggle, onOpen, onCall }: { items: ContactWorkspaceRow[]; selectedIds: Set<string>; onToggle: (id: string) => void; onOpen: (id: string) => void; onCall: (row: ContactWorkspaceRow) => void }) {
  return <div className="mt-3 space-y-2" aria-label="Contacts">{items.map((row) => {
    const name = getDisplayLeadName(row.fullName, row.phone)
    const property = row.address || 'No property linked'
    const nextAction = row.primaryNextAction?.title || row.nextActivity?.label || 'Define next action'
    const notLead = isNotLeadOutcome(row.classification, row.station)
    const avatarTone = row.isFavorite || row.attentionState === 'needs_reply' ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : row.station === 'qualified' || row.station === 'under_contract' ? 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'
    return <article key={row.id} className="crm-panel rounded-2xl p-3.5">
      <div className="flex items-start gap-3"><input type="checkbox" aria-label={`Select ${name}`} checked={selectedIds.has(row.id)} onChange={() => onToggle(row.id)} className="mt-3 h-5 w-5 shrink-0 accent-[var(--crm-brand)]" /><button type="button" onClick={() => onOpen(row.id)} className="min-w-0 flex-1 text-left"><span className="flex items-start gap-3"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold ${avatarTone}`}>{getAvatarLabel(row.fullName, row.phone, row.source)}</span><span className="min-w-0 flex-1"><strong className="block truncate text-base text-[var(--crm-ink)]">{name}</strong><span className="mt-0.5 block text-sm text-[var(--crm-text-muted)]">{formatPhone(row.phone) || 'No phone'}</span></span><Icon name="chevron_right" className="mt-2 shrink-0 text-[var(--crm-text-dim)]" /></span></button></div>
      <button type="button" onClick={() => onOpen(row.id)} className="mt-3 block w-full rounded-xl bg-[var(--crm-surface-subtle)] p-3 text-left"><span className="block truncate text-sm font-semibold text-[var(--crm-text)]">{property}</span><span className="mt-0.5 block text-xs text-[var(--crm-text-muted)]">{row.city || formatLeadSource(row.source)}</span></button>
      <div className="mt-3 flex items-center justify-between gap-2"><span className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-bold ${notLead ? 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : row.classification ? 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : 'border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] text-[var(--crm-info)]'}`}>{contactPipelineStatusLabel(row)}</span><span className="truncate text-xs text-[var(--crm-text-muted)]">{row.owner || 'Unassigned'} · {relativeDate(row.lastActivityAt)}</span></div>
      <button type="button" onClick={() => onOpen(row.id)} className={`mt-3 flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 text-left text-sm font-bold ${row.primaryNextAction?.overdue ? 'border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'border-[var(--crm-action-border)] bg-[var(--crm-action-soft)] text-[var(--crm-action)]'}`}><Icon name={row.primaryNextAction?.overdue ? 'error' : 'schedule'} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{nextAction}</span><Icon name="chevron_right" className="shrink-0" /></button>
      <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" disabled={!row.phone} onClick={() => onCall(row)} className="crm-secondary-button flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold disabled:opacity-40"><Icon name="call" />Call</button>{row.phone ? <Link href={`/conversations?lead=${row.id}&compose=sms`} className="crm-secondary-button flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold"><Icon name="sms" />Text</Link> : <button type="button" disabled className="crm-secondary-button flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold opacity-40"><Icon name="sms" />Text</button>}</div>
    </article>
  })}</div>
}
