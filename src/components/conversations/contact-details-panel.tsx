'use client'

import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { formatPhone } from '@/lib/format'
import { formatLeadSource, getAvatarLabel, getDisplayLeadName } from '@/lib/contact-display'
import type { ConversationDecisionTag } from '@/lib/operating-model/conversation-tags'
import { LeadStatusControl } from '@/components/leads/lead-status-control'

interface ContactDetails {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  county?: string | null
  station: string | null
  priority: string | null
  assigned_agent: string | null
  classification?: 'lead' | 'opportunity' | 'dead' | null
  dead_reason?: string | null
  owner?: string | null
  motivation_score?: number | null
  arv?: number | null
  offer_amount?: number | null
  source?: string | null
  appointment_date?: string | null
  decision_tags?: ConversationDecisionTag[]
  primaryNextAction?: {
    id: string
    title: string
    dueAt: string | null
    owner: string | null
    overdue: boolean
  } | null
}

function money(value?: number | null) {
  return value ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value) : '—'
}

const stages = ['New', 'Contacted', 'Qualified', 'Offer']

const TAG_TONE = {
  brand: 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]',
  info: 'border-[var(--crm-info)]/30 bg-[var(--crm-info-soft)] text-[var(--crm-info)]',
  success: 'border-[var(--crm-success)]/30 bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
  violet: 'border-[var(--crm-violet)]/30 bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]',
  neutral: 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]',
} as const

export function ContactDetailsPanel({
  contact,
  onClose,
  onNextAction,
  onContactChanged,
}: {
  contact: ContactDetails | null
  onClose?: () => void
  onNextAction?: () => void
  onContactChanged?: () => void
}) {
  if (!contact) {
    return (
      <aside className="hidden w-[360px] shrink-0 items-center justify-center border-l border-[var(--crm-border)] bg-[var(--crm-surface)] p-8 text-sm text-[var(--crm-text-dim)] xl:flex">
        Select a conversation to view contact details.
      </aside>
    )
  }

  const name = getDisplayLeadName(contact.full_name, contact.phone)
  const currentStage = Math.max(0, stages.findIndex((stage) => stage.toLowerCase() === contact.station?.toLowerCase()))
  const tags = contact.decision_tags ?? []

  return (
    <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-[var(--crm-border)] bg-[var(--crm-surface)] xl:block">
      <div className="flex h-[76px] items-center justify-between border-b border-[var(--crm-border)] px-5">
        <h2 className="flex items-center gap-2 text-[17px] font-bold text-[var(--crm-ink)]"><Icon name="contact_page" className="text-[20px] text-[var(--crm-brand)]" />Contact details</h2>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Close contact details" className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg">
            <Icon name="close" />
          </button>
        ) : null}
      </div>

      <section className="border-b border-[var(--crm-border)] p-5">
        <div className="flex gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--crm-charcoal)] text-sm font-bold text-[var(--crm-surface)]">
            {getAvatarLabel(contact.full_name, contact.phone, contact.source)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-xl font-bold text-[var(--crm-ink)]">{name}</h3>
              {contact.priority === 'hot' ? (
                <span className="rounded border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--crm-brand)]">Hot Lead</span>
              ) : null}
            </div>
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-600"><Icon name="call" className="text-[17px]" />{formatPhone(contact.phone)}</p>
            {contact.email ? <p className="mt-1 flex items-center gap-2 truncate text-sm text-slate-600"><Icon name="mail" className="text-[17px]" />{contact.email}</p> : null}
            <p className="mt-1 flex items-start gap-2 text-sm text-slate-600"><Icon name="location_on" className="mt-0.5 text-[17px]" />{[contact.property_address, contact.city].filter(Boolean).join(', ') || 'No property linked'}</p>
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-600"><Icon name="person" className="text-[17px]" />Owner: {contact.owner || contact.assigned_agent || 'Unassigned'}</p>
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-600"><Icon name="campaign" className="text-[17px]" />Source: {formatLeadSource(contact.source)}</p>
          </div>
        </div>
        {!contact.id.startsWith('unmatched:') ? <div className="mt-4">
          <LeadStatusControl
            leadId={contact.id}
            classification={contact.classification}
            station={contact.station}
            priority={contact.priority}
            deadReason={contact.dead_reason}
            agent={contact.owner || contact.assigned_agent}
            onChanged={() => onContactChanged?.()}
            variant="panel"
          />
        </div> : null}
        <Link href={`/leads/${contact.id}`} className="crm-primary-button mt-4 flex h-9 items-center justify-center rounded-lg text-sm font-bold">
          Open contact
        </Link>
      </section>

      <section className="border-b border-[var(--crm-border)] p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[var(--crm-ink)]"><Icon name="trending_up" className="text-[18px] text-[var(--crm-success)]" />Opportunity</h3>
        <div className="flex overflow-hidden rounded">
          {stages.map((stage, index) => (
            <div key={stage} className={`flex-1 py-2 text-center text-[10px] font-bold ${index === currentStage ? 'bg-[var(--crm-success)] text-white' : index < currentStage ? 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'}`}>
              {stage}
            </div>
          ))}
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Motivation score</dt><dd className="rounded-full bg-[var(--crm-violet-soft)] px-2 py-0.5 font-black text-[var(--crm-violet)]">{contact.motivation_score ?? '—'}{contact.motivation_score ? '/100' : ''}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Estimated value</dt><dd className="font-semibold">{money(contact.arv)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Target offer</dt><dd className="font-semibold">{money(contact.offer_amount)}</dd></div>
        </dl>
      </section>

      <section className="border-b border-[var(--crm-border)] p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[var(--crm-ink)]"><Icon name="bolt" className="text-[18px] text-[var(--crm-action)]" />Next action</h3>
        <button
          type="button"
          onClick={onNextAction}
          disabled={!onNextAction}
          aria-label={contact.primaryNextAction ? `Edit next action: ${contact.primaryNextAction.title}` : 'Define the next action'}
          className={`group w-full rounded-xl border-l-4 p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none ${contact.primaryNextAction?.overdue ? 'border border-[var(--crm-brand-border)] border-l-[var(--crm-danger)] bg-[var(--crm-danger-soft)]' : 'border border-[var(--crm-action-border)] border-l-[var(--crm-action)] bg-[var(--crm-action-soft)]'}`}
        >
          <div className="flex items-start gap-2">
            <Icon name="schedule" className={contact.primaryNextAction?.overdue ? 'text-[var(--crm-danger)]' : 'text-[var(--crm-action)]'} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{contact.primaryNextAction?.title || 'Define the next action'}</p>
              <p className="mt-1 text-xs text-slate-500">
                {contact.primaryNextAction?.dueAt ? new Date(contact.primaryNextAction.dueAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No due date'}
              </p>
            </div>
            <Icon name="chevron_right" className="mt-0.5 text-[18px] text-[var(--crm-text-muted)] transition-transform group-hover:translate-x-0.5" />
          </div>
        </button>
      </section>

      {contact.appointment_date ? (
        <section className="border-b border-[var(--crm-border)] p-5">
          <h3 className="mb-3 text-sm font-bold text-[var(--crm-ink)]">Upcoming</h3>
          <p className="flex gap-2 text-sm text-slate-600"><Icon name="event" />Appointment <span className="ml-auto font-semibold">{new Date(contact.appointment_date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></p>
        </section>
      ) : null}

      <section className="p-5">
        <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--crm-ink)]"><Icon name="sell" className="text-[18px] text-[var(--crm-info)]" />Decision signals</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--crm-text-muted)]">Durable facts Ari and agents can use for routing, follow-up, and offer strategy.</p>
        <div className="flex flex-wrap gap-2">
          {tags.length ? tags.map((tag) => (
            <span key={tag.id} className={`mt-3 rounded border px-2 py-1 text-xs font-semibold ${TAG_TONE[tag.tone]}`}>
              <span className="opacity-70">{tag.category} · </span>{tag.label}
            </span>
          )) : (
            <div className="mt-3 rounded-lg border border-dashed border-[var(--crm-border-strong)] bg-[var(--crm-surface-subtle)] px-3 py-3 text-xs leading-5 text-[var(--crm-text-muted)]">
              No decision signals captured. Add motivation, seller situation, property condition, or a blocker when it becomes known.
            </div>
          )}
        </div>
      </section>
    </aside>
  )
}
