'use client'

import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { formatPhone, toProperCase } from '@/lib/format'

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
  owner?: string | null
  motivation_score?: number | null
  arv?: number | null
  offer_amount?: number | null
  source?: string | null
  appointment_date?: string | null
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

function initials(name?: string | null) {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (!parts.length) return '—'
  return (parts[0][0] + (parts.at(-1)?.[0] ?? '')).toUpperCase()
}

const stages = ['New', 'Contacted', 'Qualified', 'Offer']

export function ContactDetailsPanel({ contact }: { contact: ContactDetails | null }) {
  if (!contact) {
    return (
      <aside className="hidden w-[330px] shrink-0 items-center justify-center border-l border-[#dde2e8] bg-white p-8 text-sm text-slate-400 xl:flex">
        Select a conversation to view contact details.
      </aside>
    )
  }

  const name = toProperCase(contact.full_name) || formatPhone(contact.phone)
  const currentStage = Math.max(0, stages.findIndex((stage) => stage.toLowerCase() === contact.station?.toLowerCase()))
  const tags = [
    contact.priority === 'hot' ? 'Hot Lead' : null,
    contact.source ? toProperCase(contact.source.replace(/_/g, ' ')) : null,
    contact.county ? `${contact.county} County` : null,
  ].filter((tag): tag is string => Boolean(tag))

  return (
    <aside className="hidden w-[330px] shrink-0 overflow-y-auto border-l border-[#dde2e8] bg-white xl:block">
      <div className="flex h-[76px] items-center justify-between border-b border-[#e4e8ed] px-5">
        <h2 className="text-[17px] font-bold text-[#152033]">Contact details</h2>
        <Icon name="close" className="text-slate-400" />
      </div>

      <section className="border-b border-[#e4e8ed] p-5">
        <div className="flex gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#0a2138] text-sm font-black text-white">
            {initials(contact.full_name)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-xl font-bold text-[#111827]">{name}</h3>
              {contact.priority === 'hot' ? (
                <span className="rounded border border-[#df4a4f] px-1.5 py-0.5 text-[10px] font-bold text-[#c92c33]">Hot Lead</span>
              ) : null}
            </div>
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-600"><Icon name="call" className="text-[17px]" />{formatPhone(contact.phone)}</p>
            {contact.email ? <p className="mt-1 flex items-center gap-2 truncate text-sm text-slate-600"><Icon name="mail" className="text-[17px]" />{contact.email}</p> : null}
            <p className="mt-1 flex items-start gap-2 text-sm text-slate-600"><Icon name="location_on" className="mt-0.5 text-[17px]" />{[contact.property_address, contact.city].filter(Boolean).join(', ') || 'No property linked'}</p>
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-600"><Icon name="person" className="text-[17px]" />Owner: {contact.owner || contact.assigned_agent || 'Unassigned'}</p>
          </div>
        </div>
        <Link href={`/leads/${contact.id}`} className="mt-4 flex h-9 items-center justify-center rounded-md border border-[#138a42] text-sm font-bold text-[#0f7136] hover:bg-[#f3faf5]">
          Open contact
        </Link>
      </section>

      <section className="border-b border-[#e4e8ed] p-5">
        <h3 className="mb-3 text-sm font-bold text-[#152033]">Opportunity</h3>
        <div className="flex overflow-hidden rounded">
          {stages.map((stage, index) => (
            <div key={stage} className={`flex-1 py-2 text-center text-[10px] font-bold ${index === currentStage ? 'bg-[#138a42] text-white' : 'bg-[#edf0f3] text-slate-500'}`}>
              {stage}
            </div>
          ))}
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Motivation score</dt><dd className="font-bold text-[#0f7136]">{contact.motivation_score ?? '—'}{contact.motivation_score ? '/100' : ''}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Estimated value</dt><dd className="font-semibold">{money(contact.arv)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Target offer</dt><dd className="font-semibold">{money(contact.offer_amount)}</dd></div>
        </dl>
      </section>

      <section className="border-b border-[#e4e8ed] p-5">
        <h3 className="mb-3 text-sm font-bold text-[#152033]">Next action</h3>
        <div className={`rounded-lg border p-3 ${contact.primaryNextAction?.overdue ? 'border-[#df4a4f] bg-[#fff7f7]' : 'border-[#f0b34a] bg-[#fffbf2]'}`}>
          <div className="flex items-start gap-2">
            <Icon name="schedule" className="text-[#d89418]" />
            <div>
              <p className="text-sm font-semibold">{contact.primaryNextAction?.title || 'Define the next action'}</p>
              <p className="mt-1 text-xs text-slate-500">
                {contact.primaryNextAction?.dueAt ? new Date(contact.primaryNextAction.dueAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No due date'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {contact.appointment_date ? (
        <section className="border-b border-[#e4e8ed] p-5">
          <h3 className="mb-3 text-sm font-bold text-[#152033]">Upcoming</h3>
          <p className="flex gap-2 text-sm text-slate-600"><Icon name="event" />Appointment <span className="ml-auto font-semibold">{new Date(contact.appointment_date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></p>
        </section>
      ) : null}

      <section className="p-5">
        <h3 className="mb-3 text-sm font-bold text-[#152033]">Tags</h3>
        <div className="flex flex-wrap gap-2">
          {tags.length ? tags.map((tag) => <span key={tag} className="rounded border border-[#81bd91] bg-[#f3faf5] px-2 py-1 text-xs font-semibold text-[#0f7136]">{tag}</span>) : <span className="text-sm text-slate-400">No tags</span>}
        </div>
      </section>
    </aside>
  )
}
