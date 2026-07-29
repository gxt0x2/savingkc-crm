'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import {
  formatLeadSource,
  getAvatarLabel,
  getDisplayLeadName,
} from '@/lib/contact-display'
import type { ContactSignal } from '@/lib/contact-display'
import type { DealStage } from '@/types/pipeline'
import { WorkspaceFrame } from '@/components/conversations/workspace-frame'

interface ContactRow {
  id: string
  fullName: string | null
  phone: string | null
  source: string | null
  address: string | null
  city: string | null
  station: DealStage
  score: number
  isFavorite: boolean
  nextActivity: {
    when: string | null
    label: string
    kind: 'appointment' | 'recommended' | null
  } | null
  tags: string[]
  lastContactAt: string | null
  createdAt: string | null
  firstOutboundAt: string | null
  contactSignal: ContactSignal | null
  updatedAt: string | null
}

interface HubThread {
  id: string
  attentionState: 'needs_reply' | 'waiting_on_contact' | 'resolved'
  owner: string | null
  lastMessage: string
  lastActivityAt: string
  primaryNextAction: {
    id: string
    title: string
    dueAt: string | null
    owner: string | null
    overdue: boolean
  } | null
}

interface ContactWorkspaceRow extends ContactRow {
  attentionState: HubThread['attentionState']
  owner: string | null
  lastMessage: string | null
  lastActivityAt: string | null
  primaryNextAction: HubThread['primaryNextAction']
}

type SmartList = 'all' | 'needs_reply' | 'overdue' | 'unassigned' | 'hot' | 'new'

const STAGE_LABELS: Record<DealStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  appointment_set: 'Appointment set',
  offer_made: 'Offer made',
  under_contract: 'Under contract',
  closed_won: 'Closed won',
  closed_lost: 'Closed lost',
  dead: 'Dead',
}

function formatPhone(phone: string | null): string {
  if (!phone) return 'No phone'
  const digits = phone.replace(/\D/g, '')
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (local.length !== 10) return phone
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
}

function formatRelativeDate(value: string | null): string {
  if (!value) return 'No activity'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No activity'
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 30 ? `${days}d ago` : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function useContactWorkspace() {
  return useQuery<{ items: ContactWorkspaceRow[] }>({
    queryKey: ['contact-workspace'],
    queryFn: async () => {
      const [contactsResponse, hubResponse] = await Promise.all([
        fetch('/api/contacts', { cache: 'no-store' }),
        fetch('/api/conversations/hub', { cache: 'no-store' }),
      ])
      if (!contactsResponse.ok) throw new Error('Contacts could not be loaded')
      if (!hubResponse.ok) throw new Error('Conversation state could not be loaded')

      const contactsPayload = await contactsResponse.json() as { items?: ContactRow[] }
      const hubPayload = await hubResponse.json() as { items?: HubThread[] }
      const hubByLead = new Map((hubPayload.items ?? []).map((thread) => [thread.id, thread]))

      return {
        items: (contactsPayload.items ?? []).map((contact) => {
          const thread = hubByLead.get(contact.id)
          return {
            ...contact,
            attentionState: thread?.attentionState ?? 'resolved',
            owner: thread?.owner ?? null,
            lastMessage: thread?.lastMessage ?? null,
            lastActivityAt: thread?.lastActivityAt ?? contact.lastContactAt,
            primaryNextAction: thread?.primaryNextAction ?? null,
          }
        }),
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

function ContactSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading contacts">
      {[0, 1, 2, 3, 4].map((item) => (
        <div key={item} className="h-20 animate-pulse rounded-xl border border-white/5 bg-white/[0.035]" />
      ))}
    </div>
  )
}

export default function ContactsPage() {
  const [smartList, setSmartList] = useState<SmartList>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data, isLoading, error, refetch, isFetching } = useContactWorkspace()
  const items = useMemo(() => data?.items ?? [], [data])

  const counts = useMemo<Record<SmartList, number>>(() => ({
    all: items.length,
    needs_reply: items.filter((item) => item.attentionState === 'needs_reply').length,
    overdue: items.filter((item) => item.primaryNextAction?.overdue).length,
    unassigned: items.filter((item) => !item.owner).length,
    hot: items.filter((item) => item.score >= 75 || item.isFavorite).length,
    new: items.filter((item) => item.station === 'new').length,
  }), [items])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return items
      .filter((item) => {
        if (smartList === 'needs_reply' && item.attentionState !== 'needs_reply') return false
        if (smartList === 'overdue' && !item.primaryNextAction?.overdue) return false
        if (smartList === 'unassigned' && item.owner) return false
        if (smartList === 'hot' && item.score < 75 && !item.isFavorite) return false
        if (smartList === 'new' && item.station !== 'new') return false
        if (!needle) return true
        return [
          item.fullName,
          item.phone,
          item.address,
          item.city,
          item.owner,
          item.source,
        ].some((value) => value?.toLowerCase().includes(needle))
      })
      .sort((a, b) => {
        const attentionRank = (item: ContactWorkspaceRow) =>
          item.attentionState === 'needs_reply' ? 0 : item.primaryNextAction?.overdue ? 1 : 2
        return attentionRank(a) - attentionRank(b) || b.score - a.score
      })
  }, [items, search, smartList])

  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null

  return (
    <WorkspaceFrame needsReply={counts.needs_reply}>
      <main className="flex h-full min-w-0 bg-white">
        <section className="min-w-0 flex-1 overflow-y-auto">
          <header className="flex items-center justify-between border-b border-[#e0e5ea] px-8 py-6">
            <div>
              <h1 className="text-[26px] font-bold text-[#132238]">Contacts</h1>
              <p className="mt-1 text-sm text-[#66758a]">People and properties in one searchable workspace</p>
            </div>
            <div className="flex gap-3">
              <button className="flex h-10 items-center gap-2 rounded-md border border-[#cbd3dc] px-4 text-sm font-semibold"><Icon name="upload" />Import</button>
              <button className="flex h-10 items-center gap-2 rounded-md bg-[#138a42] px-5 text-sm font-semibold text-white"><Icon name="add" />Add contact</button>
            </div>
          </header>

          <div className="border-b border-[#e0e5ea] px-7">
            <nav className="flex gap-7">
              {[
                ['all', 'All Contacts', counts.all],
                ['new', 'New Leads', counts.new],
                ['needs_reply', 'Needs Follow-up', counts.needs_reply],
                ['hot', 'Hot Opportunities', counts.hot],
                ['unassigned', 'Unassigned', counts.unassigned],
              ].map(([id, label, count]) => (
                <button key={id} onClick={() => setSmartList(id as SmartList)} className={`border-b-2 py-4 text-sm font-semibold ${smartList === id ? 'border-[#138a42] text-[#0f7136]' : 'border-transparent text-[#24354a]'}`}>
                  {label} <span className="ml-1 rounded-full bg-[#eef1f4] px-2 py-0.5 text-[11px]">{count}</span>
                </button>
              ))}
              <button className="py-4 text-sm font-semibold text-[#24354a]">＋ New view</button>
            </nav>
          </div>

          <div className="px-7 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative w-52">
                <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[#65748a]" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contacts..." className="h-9 w-full rounded-md border border-[#ccd4dd] pl-9 pr-3 text-xs outline-none focus:border-[#138a42]" />
              </label>
              {['Owner', 'Stage', 'Source', 'Tags', 'Last activity', 'More filters'].map((filter) => <button key={filter} className="flex h-9 items-center gap-1.5 rounded-md border border-[#ccd4dd] px-3 text-xs font-semibold text-[#34445a]">{filter}<Icon name="expand_more" /></button>)}
              <button onClick={() => void refetch()} className="ml-auto flex h-9 items-center gap-1.5 rounded-md border border-[#ccd4dd] px-3 text-xs font-semibold text-[#34445a]"><Icon name="refresh" className={isFetching ? 'animate-spin' : ''} />Recently active</button>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span className="rounded-md border border-[#79b98b] bg-[#f3faf5] px-3 py-1.5 text-xs font-semibold text-[#0f7136]">Active leads ×</span>
              <span className="text-sm text-[#536277]">{visible.length} results</span>
            </div>

            <div className="mt-5 overflow-hidden rounded-md border border-[#d9e0e6]">
              <div className="grid grid-cols-[34px_1.15fr_1.15fr_.75fr_1.2fr_.85fr_.85fr_.75fr] border-b border-[#d9e0e6] bg-[#fbfcfd] px-3 py-3 text-[11px] font-bold text-[#425269]">
                <span>□</span><span>Contact</span><span>Property</span><span>Stage</span><span>Next Action</span><span>Owner</span><span>Last Activity</span><span>Source</span>
              </div>
              {isLoading ? <div className="p-4"><ContactSkeleton /></div> : null}
              {error ? <div className="p-8 text-center text-sm text-red-600">Contacts could not be loaded. <button onClick={() => void refetch()} className="font-bold underline">Try again</button></div> : null}
              {!isLoading && !error ? visible.slice(0, 10).map((row) => {
                const displayName = getDisplayLeadName(row.fullName, row.phone)
                const property = [row.address, row.city].filter(Boolean).join(', ') || 'No property linked'
                const nextAction = row.primaryNextAction?.title || row.nextActivity?.label || 'Define next action'
                return (
                  <button key={row.id} onClick={() => setSelectedId(row.id)} className={`grid w-full grid-cols-[34px_1.15fr_1.15fr_.75fr_1.2fr_.85fr_.85fr_.75fr] items-center border-b border-[#e3e7eb] px-3 py-4 text-left text-xs last:border-0 ${selected?.id === row.id ? 'bg-[#f6fbf7]' : 'hover:bg-[#fafbfc]'}`}>
                    <span className="text-[#9aa5b2]">□</span>
                    <span className="flex min-w-0 items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dcefe1] font-bold text-[#235c35]">{getAvatarLabel(row.fullName, row.phone, row.source)}</span><span className="min-w-0"><strong className="block truncate text-[#1d2c40]">{displayName}</strong><small className="text-[#627087]">{formatPhone(row.phone)}</small></span></span>
                    <span className="min-w-0"><strong className="block truncate font-medium text-[#2d3d52]">{property}</strong><small className="text-[#7b8796]">{row.city || ''}</small></span>
                    <span><span className="rounded border border-[#acd6b6] bg-[#eff8f1] px-2 py-1 font-semibold text-[#17733a]">{STAGE_LABELS[row.station]}</span></span>
                    <span className={row.primaryNextAction?.overdue ? 'font-semibold text-red-600' : 'text-[#28394f]'}>{nextAction}</span>
                    <span>{row.owner || 'Unassigned'}</span>
                    <span className="text-[#68768a]">{formatRelativeDate(row.lastActivityAt)}</span>
                    <span className="text-[#526177]">{formatLeadSource(row.source)}</span>
                  </button>
                )
              }) : null}
            </div>
            <div className="mt-7 flex items-center text-xs text-[#69778a]"><span>Showing 1 to {Math.min(10, visible.length)} of {visible.length} results</span><div className="ml-auto flex gap-2">{['‹', '1', '2', '3', '…', '›'].map((page) => <button key={page} className={`h-8 min-w-8 rounded border px-2 ${page === '1' ? 'border-[#138a42] text-[#0f7136]' : 'border-[#d6dde4]'}`}>{page}</button>)}</div></div>
          </div>
        </section>

        <aside className="hidden w-[350px] shrink-0 overflow-y-auto border-l border-[#dde3e9] bg-white p-6 xl:block">
          {selected ? (
            <>
              <div className="flex items-start gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#dcefe1] text-lg font-bold text-[#235c35]">{getAvatarLabel(selected.fullName, selected.phone, selected.source)}</div>
                <div className="min-w-0"><h2 className="truncate text-xl font-bold">{getDisplayLeadName(selected.fullName, selected.phone)}</h2><p className="mt-1 text-sm text-[#58677c]">{[selected.address, selected.city].filter(Boolean).join(', ') || 'No property linked'}</p></div>
                <Icon name="close" className="ml-auto text-[#6c798b]" />
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2">{['Call', 'Text', 'Email'].map((action) => <Link key={action} href={action === 'Text' ? `/conversations?lead=${selected.id}` : '#'} className="flex h-9 items-center justify-center gap-1 rounded-md border border-[#cbd4dc] text-xs font-semibold text-[#0f7136]"><Icon name={action === 'Call' ? 'call' : action === 'Text' ? 'sms' : 'mail'} />{action}</Link>)}</div>
              <div className="mt-6 border-t border-[#e0e5ea] pt-5"><h3 className="text-sm font-bold">Opportunity</h3><dl className="mt-4 space-y-3 text-xs"><div className="flex justify-between"><dt>Stage</dt><dd className="rounded bg-[#eef8f1] px-2 py-1 font-semibold text-[#0f7136]">{STAGE_LABELS[selected.station]}</dd></div><div className="flex justify-between"><dt>Motivation</dt><dd className="font-semibold text-[#0f7136]">{selected.score} / 100</dd></div></dl></div>
              <div className="mt-6 border-t border-[#e0e5ea] pt-5"><h3 className="text-sm font-bold">Next action</h3><p className="mt-3 flex items-center gap-2 text-xs text-[#b16e00]"><Icon name="schedule" />{selected.primaryNextAction?.title || selected.nextActivity?.label || 'Define next action'}</p></div>
              <div className="mt-6 border-t border-[#e0e5ea] pt-5"><h3 className="text-sm font-bold">Recent conversation</h3><p className="mt-3 rounded bg-[#f5f7f9] p-3 text-xs leading-5 text-[#44536a]">{selected.lastMessage || 'No recent message'}</p></div>
              <div className="mt-6 border-t border-[#e0e5ea] pt-5"><h3 className="text-sm font-bold">Contact details</h3><p className="mt-3 text-sm text-[#526177]">{formatPhone(selected.phone)}</p><p className="mt-2 text-sm text-[#526177]">Owner: {selected.owner || 'Unassigned'}</p></div>
              <Link href={`/leads/${selected.id}`} className="mt-7 flex h-11 items-center justify-center rounded-md border border-[#138a42] text-sm font-bold text-[#0f7136]">Open full workspace →</Link>
            </>
          ) : <p className="text-sm text-[#728094]">Select a contact</p>}
        </aside>
      </main>
    </WorkspaceFrame>
  )
}
