'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import {
  formatLeadSource,
  getAvatarLabel,
  getDisplayLeadName,
  isGoogleAdsSource,
} from '@/lib/contact-display'
import type { ContactSignal } from '@/lib/contact-display'
import type { DealStage } from '@/types/pipeline'

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

const SMART_LISTS: Array<{ id: SmartList; label: string; icon: string; description: string }> = [
  { id: 'all', label: 'All contacts', icon: 'group', description: 'Every active acquisition contact' },
  { id: 'needs_reply', label: 'Needs reply', icon: 'mark_chat_unread', description: 'Inbound contact awaiting response' },
  { id: 'overdue', label: 'Overdue actions', icon: 'notification_important', description: 'Primary action is past due' },
  { id: 'unassigned', label: 'Unassigned', icon: 'person_off', description: 'No accountable owner' },
  { id: 'hot', label: 'Hot opportunities', icon: 'local_fire_department', description: 'Score 75+ or manually prioritized' },
  { id: 'new', label: 'New intake', icon: 'fiber_new', description: 'Seller intake not yet progressed' },
]

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

function formatDueDate(value: string | null): string {
  if (!value) return 'No due date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No due date'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
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

  const activeList = SMART_LISTS.find((list) => list.id === smartList) ?? SMART_LISTS[0]

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#080808] text-white">
      <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8">
        <section className="mb-5 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#191313] via-[#111] to-[#0d0d0d] p-5 shadow-2xl shadow-black/20 sm:p-7">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-[#ef4444]">
                <span className="h-2 w-2 rounded-full bg-[#ef4444] shadow-[0_0_14px_rgba(239,68,68,0.8)]" />
                Acquisition workspace
              </div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Contacts</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                One working list for identity, property, opportunity, ownership, communication, and the next required action.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Active', value: counts.all },
                { label: 'Needs reply', value: counts.needs_reply },
                { label: 'Overdue', value: counts.overdue },
                { label: 'Unassigned', value: counts.unassigned },
              ].map((metric) => (
                <div key={metric.label} className="min-w-28 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                  <p className="text-2xl font-black">{metric.value}</p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{metric.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-white/10 bg-[#111] p-3">
            <div className="px-3 pb-3 pt-2">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">Smart lists</p>
            </div>
            <nav aria-label="Contact smart lists" className="space-y-1">
              {SMART_LISTS.map((list) => {
                const active = list.id === smartList
                return (
                  <button
                    key={list.id}
                    type="button"
                    onClick={() => setSmartList(list.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`w-full rounded-xl px-3 py-3 text-left transition ${
                      active
                        ? 'border border-[#ef4444]/30 bg-[#ef4444]/12 text-white'
                        : 'border border-transparent text-zinc-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon name={list.icon} className={active ? 'text-[#ef4444]' : 'text-zinc-600'} />
                      <span className="flex-1 text-sm font-bold">{list.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-black ${active ? 'bg-[#ef4444] text-white' : 'bg-white/5 text-zinc-500'}`}>
                        {counts[list.id]}
                      </span>
                    </div>
                    <p className="ml-8 mt-1 text-[11px] font-normal leading-4 text-zinc-600">{list.description}</p>
                  </button>
                )
              })}
            </nav>

            <div className="mt-4 border-t border-white/10 px-3 pt-4">
              <Link href="/workflows" className="flex items-center gap-2 text-xs font-bold text-zinc-400 hover:text-white">
                <Icon name="account_tree" className="text-[#ef4444]" />
                Manage contact workflows
              </Link>
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#101010]">
            <header className="border-b border-white/10 p-4 sm:p-5">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black">{activeList.label}</h2>
                    <span className="rounded-full bg-white/5 px-2 py-1 text-xs font-bold text-zinc-400">{visible.length}</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{activeList.description}</p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="relative min-w-0 sm:w-80">
                    <span className="sr-only">Search contacts</span>
                    <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search name, phone, property, owner…"
                      className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-[#ef4444]/60"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    disabled={isFetching}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:bg-white/10 disabled:opacity-50"
                  >
                    <Icon name="refresh" className={isFetching ? 'animate-spin' : ''} />
                    Refresh
                  </button>
                </div>
              </div>
            </header>

            <div className="hidden grid-cols-[minmax(220px,1.35fr)_minmax(220px,1.2fr)_150px_160px_minmax(220px,1.3fr)_90px] gap-4 border-b border-white/10 bg-white/[0.025] px-5 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-600 xl:grid">
              <span>Contact & property</span>
              <span>Opportunity</span>
              <span>Owner</span>
              <span>Last touch</span>
              <span>Primary next action</span>
              <span className="text-right">Score</span>
            </div>

            <div className="p-3 sm:p-4">
              {isLoading ? <ContactSkeleton /> : null}

              {error ? (
                <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-6 text-center">
                  <Icon name="error" className="text-3xl text-red-400" />
                  <p className="mt-3 font-bold">Contacts could not be loaded</p>
                  <p className="mt-1 text-sm text-red-200/60">{error instanceof Error ? error.message : 'Unknown error'}</p>
                  <button type="button" onClick={() => void refetch()} className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-bold text-black">
                    Try again
                  </button>
                </div>
              ) : null}

              {!isLoading && !error && visible.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-6 py-16 text-center">
                  <Icon name="filter_alt_off" className="text-4xl text-zinc-700" />
                  <p className="mt-3 font-bold">No contacts match this working list</p>
                  <p className="mt-1 text-sm text-zinc-600">Choose another smart list or clear the search.</p>
                  {search ? (
                    <button type="button" onClick={() => setSearch('')} className="mt-4 text-sm font-bold text-[#ef4444]">
                      Clear search
                    </button>
                  ) : null}
                </div>
              ) : null}

              {!isLoading && !error ? (
                <div className="space-y-2">
                  {visible.map((row) => {
                    const displayName = getDisplayLeadName(row.fullName, row.phone)
                    const property = [row.address, row.city].filter(Boolean).join(', ') || 'No property linked'
                    const nextAction = row.primaryNextAction ?? (
                      row.nextActivity
                        ? {
                            id: `manifest-${row.id}`,
                            title: row.nextActivity.label,
                            dueAt: row.nextActivity.when,
                            owner: row.owner,
                            overdue: Boolean(row.nextActivity.when && new Date(row.nextActivity.when) < new Date()),
                          }
                        : null
                    )
                    const needsReply = row.attentionState === 'needs_reply'
                    return (
                      <article
                        key={row.id}
                        className="grid gap-4 rounded-xl border border-white/[0.07] bg-[#151515] p-4 transition hover:border-white/15 hover:bg-[#181818] xl:grid-cols-[minmax(220px,1.35fr)_minmax(220px,1.2fr)_150px_160px_minmax(220px,1.3fr)_90px] xl:items-center"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-black text-white ${
                            isGoogleAdsSource(row.source) ? 'bg-[#ef4444]' : 'bg-zinc-700'
                          }`}>
                            {getAvatarLabel(row.fullName, row.phone, row.source)}
                          </div>
                          <div className="min-w-0">
                            <Link href={`/leads/${row.id}`} className="block truncate text-sm font-black text-white hover:text-[#ef4444]">
                              {displayName}
                            </Link>
                            <p className="mt-1 truncate text-xs text-zinc-500">{formatPhone(row.phone)}</p>
                            <p className="mt-1 truncate text-xs text-zinc-600" title={property}>{property}</p>
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-zinc-300">
                              {STAGE_LABELS[row.station]}
                            </span>
                            {needsReply ? (
                              <span className="rounded-md bg-red-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-red-400">
                                Needs reply
                              </span>
                            ) : null}
                          </div>
                          <p className={`mt-2 truncate text-xs ${row.lastMessage ? 'text-zinc-400' : 'text-zinc-600'}`}>
                            {row.lastMessage || formatLeadSource(row.source)}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {row.tags.slice(0, 2).map((tag) => (
                              <span key={tag} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500">
                                {tag.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="text-[10px] font-black uppercase tracking-wide text-zinc-600 xl:hidden">Owner</p>
                          <p className={`mt-1 text-sm font-bold ${row.owner ? 'text-zinc-300' : 'text-amber-400'}`}>
                            {row.owner || 'Unassigned'}
                          </p>
                        </div>

                        <div>
                          <p className="text-[10px] font-black uppercase tracking-wide text-zinc-600 xl:hidden">Last touch</p>
                          <p className="mt-1 text-sm font-bold text-zinc-300">{formatRelativeDate(row.lastActivityAt)}</p>
                          <p className="mt-1 text-xs capitalize text-zinc-600">{row.attentionState.replace(/_/g, ' ')}</p>
                        </div>

                        <div className={`rounded-lg border px-3 py-2.5 ${
                          nextAction?.overdue
                            ? 'border-red-500/25 bg-red-500/10'
                            : nextAction
                              ? 'border-white/10 bg-black/20'
                              : 'border-dashed border-white/10'
                        }`}>
                          <p className={`truncate text-xs font-bold ${nextAction?.overdue ? 'text-red-300' : 'text-zinc-300'}`}>
                            {nextAction?.title || 'No primary action'}
                          </p>
                          <p className={`mt-1 text-[10px] ${nextAction?.overdue ? 'font-bold text-red-500' : 'text-zinc-600'}`}>
                            {nextAction ? `${nextAction.overdue ? 'Overdue · ' : ''}${formatDueDate(nextAction.dueAt)}` : 'Action required before this can progress'}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-3 xl:block xl:text-right">
                          <p className="text-[10px] font-black uppercase tracking-wide text-zinc-600 xl:hidden">Score</p>
                          <p className={`text-xl font-black ${row.score >= 75 ? 'text-[#ef4444]' : 'text-zinc-300'}`}>{row.score}</p>
                          <div className="mt-1 flex justify-end gap-1">
                            <Link
                              href={`/conversations?lead=${row.id}`}
                              aria-label={`Open conversation with ${displayName}`}
                              className="rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white"
                            >
                              <Icon name="forum" />
                            </Link>
                            <Link
                              href={`/leads/${row.id}`}
                              aria-label={`Open ${displayName} workspace`}
                              className="rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white"
                            >
                              <Icon name="arrow_forward" />
                            </Link>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
