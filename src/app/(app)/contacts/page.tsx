'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { formatLeadSource, getAvatarLabel, getDisplayLeadName } from '@/lib/contact-display'
import type { ContactSignal } from '@/lib/contact-display'
import type { DealStage } from '@/types/pipeline'
import { WorkspaceFrame } from '@/components/conversations/workspace-frame'

interface ContactRow {
  id: string
  fullName: string | null
  phone: string | null
  email: string | null
  source: string | null
  address: string | null
  city: string | null
  station: DealStage
  score: number
  isFavorite: boolean
  nextActivity: { when: string | null; label: string; kind: 'appointment' | 'recommended' | null } | null
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
  primaryNextAction: { id: string; title: string; dueAt: string | null; owner: string | null; overdue: boolean } | null
}

interface ContactWorkspaceRow extends ContactRow {
  attentionState: HubThread['attentionState']
  owner: string | null
  lastMessage: string | null
  lastActivityAt: string | null
  primaryNextAction: HubThread['primaryNextAction']
}

type SmartList = 'all' | 'needs_reply' | 'overdue' | 'unassigned' | 'hot' | 'new'
type ContactDialog = 'add' | 'import' | 'view' | null

interface SavedView {
  id: string
  label: string
  owner: string
  stage: string
  source: string
  tag: string
  attention: string
}

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

const EMPTY_CONTACT = { fullName: '', phone: '', email: '', address: '', city: '', state: '', zip: '', source: 'manual_crm' }

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

function parseCsv(value: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        cell += '"'
        index += 1
      } else quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(cell.trim())
      cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && value[index + 1] === '\n') index += 1
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
    } else cell += character
  }
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  const headers = (rows.shift() ?? []).map((header) => header.trim().toLowerCase().replace(/\s+/g, '_'))
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])))
}

function ContactSkeleton() {
  return <div className="space-y-2 p-4" aria-label="Loading contacts">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-[#f2f4f7]" />)}</div>
}

export default function ContactsPage() {
  const [smartList, setSmartList] = useState<SmartList>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [ownerFilter, setOwnerFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [activityFilter, setActivityFilter] = useState('')
  const [attentionFilter, setAttentionFilter] = useState('')
  const [sortBy, setSortBy] = useState<'priority' | 'recent' | 'name'>('priority')
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState<ContactDialog>(null)
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT)
  const [viewName, setViewName] = useState('')
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])
  const [saving, setSaving] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const { data, isLoading, error, refetch, isFetching } = useContactWorkspace()
  const items = useMemo(() => data?.items ?? [], [data])

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('savingkc-contact-views')
      if (stored) setSavedViews(JSON.parse(stored) as SavedView[])
    } catch { /* storage may be unavailable */ }
    const requestedSearch = new URLSearchParams(window.location.search).get('search')
    if (requestedSearch) setSearch(requestedSearch)
  }, [])

  const counts = useMemo<Record<SmartList, number>>(() => ({
    all: items.length,
    needs_reply: items.filter((item) => item.attentionState === 'needs_reply').length,
    overdue: items.filter((item) => item.primaryNextAction?.overdue).length,
    unassigned: items.filter((item) => !item.owner).length,
    hot: items.filter((item) => item.score >= 75 || item.isFavorite).length,
    new: items.filter((item) => item.station === 'new').length,
  }), [items])

  const owners = useMemo(() => [...new Set(items.map((item) => item.owner).filter((value): value is string => Boolean(value)))].sort(), [items])
  const sources = useMemo(() => [...new Set(items.map((item) => item.source).filter((value): value is string => Boolean(value)))].sort(), [items])
  const tags = useMemo(() => [...new Set(items.flatMap((item) => item.tags))].sort(), [items])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return items.filter((item) => {
      if (smartList === 'needs_reply' && item.attentionState !== 'needs_reply') return false
      if (smartList === 'overdue' && !item.primaryNextAction?.overdue) return false
      if (smartList === 'unassigned' && item.owner) return false
      if (smartList === 'hot' && item.score < 75 && !item.isFavorite) return false
      if (smartList === 'new' && item.station !== 'new') return false
      if (ownerFilter === '__unassigned' ? item.owner : ownerFilter && item.owner !== ownerFilter) return false
      if (stageFilter && item.station !== stageFilter) return false
      if (sourceFilter && item.source !== sourceFilter) return false
      if (tagFilter && !item.tags.includes(tagFilter)) return false
      if (attentionFilter && item.attentionState !== attentionFilter) return false
      if (activityFilter) {
        const timestamp = item.lastActivityAt ? new Date(item.lastActivityAt).getTime() : 0
        const age = Date.now() - timestamp
        if (activityFilter === 'day' && age > 86_400_000) return false
        if (activityFilter === 'week' && age > 604_800_000) return false
        if (activityFilter === 'stale' && age <= 604_800_000) return false
      }
      if (!needle) return true
      return [item.fullName, item.phone, item.email, item.address, item.city, item.owner, item.source].some((value) => value?.toLowerCase().includes(needle))
    }).sort((a, b) => {
      if (sortBy === 'name') return getDisplayLeadName(a.fullName, a.phone).localeCompare(getDisplayLeadName(b.fullName, b.phone))
      if (sortBy === 'recent') return new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime()
      const attentionRank = (item: ContactWorkspaceRow) => item.attentionState === 'needs_reply' ? 0 : item.primaryNextAction?.overdue ? 1 : 2
      return attentionRank(a) - attentionRank(b) || b.score - a.score
    })
  }, [activityFilter, attentionFilter, items, ownerFilter, search, smartList, sortBy, sourceFilter, stageFilter, tagFilter])

  useEffect(() => setPage(1), [activityFilter, attentionFilter, ownerFilter, search, smartList, sortBy, sourceFilter, stageFilter, tagFilter])

  const pageSize = 10
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageItems = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const paginationStart = Math.min(Math.max(1, currentPage - 2), Math.max(1, pageCount - 4))
  const paginationPages = Array.from({ length: Math.min(pageCount, 5) }, (_, index) => paginationStart + index)
  const selected = items.find((item) => item.id === selectedId) ?? pageItems[0] ?? null

  function clearFilters() {
    setSmartList('all')
    setOwnerFilter('')
    setStageFilter('')
    setSourceFilter('')
    setTagFilter('')
    setActivityFilter('')
    setAttentionFilter('')
  }

  function openDialer(contact: ContactWorkspaceRow) {
    if (!contact.phone) return
    window.dispatchEvent(new CustomEvent('open-dialer', { detail: { leadId: contact.id, phone: contact.phone, name: getDisplayLeadName(contact.fullName, contact.phone) } }))
  }

  async function createContact(payload: typeof EMPTY_CONTACT) {
    const response = await fetch('/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Contact could not be created')
  }

  async function submitAddContact(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setDialogError(null)
    try {
      await createContact(contactForm)
      setContactForm(EMPTY_CONTACT)
      setDialog(null)
      await refetch()
    } catch (submitError) {
      setDialogError(submitError instanceof Error ? submitError.message : 'Contact could not be created')
    } finally {
      setSaving(false)
    }
  }

  async function submitImport() {
    if (!csvRows.length) return
    setSaving(true)
    setDialogError(null)
    let imported = 0
    try {
      for (const row of csvRows) {
        await createContact({
          fullName: row.full_name || row.name || [row.first_name, row.last_name].filter(Boolean).join(' '),
          phone: row.phone || row.phone_number || '',
          email: row.email || '',
          address: row.property_address || row.address || '',
          city: row.city || '',
          state: row.state || '',
          zip: row.zip || row.postal_code || '',
          source: row.source || 'csv_import',
        })
        imported += 1
      }
      setCsvRows([])
      setDialog(null)
      await refetch()
    } catch (importError) {
      setDialogError(`${imported} imported. ${importError instanceof Error ? importError.message : 'Import stopped.'}`)
    } finally {
      setSaving(false)
    }
  }

  function saveView(event: FormEvent) {
    event.preventDefault()
    const label = viewName.trim()
    if (!label) return
    const next = [...savedViews, { id: crypto.randomUUID(), label, owner: ownerFilter, stage: stageFilter, source: sourceFilter, tag: tagFilter, attention: attentionFilter }]
    setSavedViews(next)
    window.localStorage.setItem('savingkc-contact-views', JSON.stringify(next))
    setViewName('')
    setDialog(null)
  }

  function applyView(view: SavedView) {
    setSmartList('all')
    setOwnerFilter(view.owner)
    setStageFilter(view.stage)
    setSourceFilter(view.source)
    setTagFilter(view.tag)
    setAttentionFilter(view.attention)
  }

  const hasFilters = smartList !== 'all' || ownerFilter || stageFilter || sourceFilter || tagFilter || activityFilter || attentionFilter

  return (
    <WorkspaceFrame needsReply={counts.needs_reply}>
      <main className="flex h-full min-w-0 bg-white">
        <section className="min-w-0 flex-1 overflow-y-auto">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e0e5ea] px-8 py-6">
            <div><h1 className="text-[26px] font-bold text-[#132238]">Contacts</h1><p className="mt-1 text-sm text-[#66758a]">People and properties in one searchable workspace</p></div>
            <div className="flex gap-3">
              <button type="button" onClick={() => { setDialogError(null); setDialog('import') }} className="flex h-10 items-center gap-2 rounded-md border border-[#cbd3dc] px-4 text-sm font-semibold hover:bg-[#f8fafb]"><Icon name="upload" />Import</button>
              <button type="button" onClick={() => { setDialogError(null); setDialog('add') }} className="flex h-10 items-center gap-2 rounded-md bg-[#df3038] px-5 text-sm font-semibold text-white hover:bg-[#c9232d]"><Icon name="add" />Add contact</button>
            </div>
          </header>

          <div className="overflow-x-auto border-b border-[#e0e5ea] px-7">
            <nav className="flex min-w-max gap-7">
              {([
                ['all', 'All Contacts', counts.all],
                ['new', 'New Leads', counts.new],
                ['needs_reply', 'Needs Follow-up', counts.needs_reply],
                ['hot', 'Hot Opportunities', counts.hot],
                ['unassigned', 'Unassigned', counts.unassigned],
              ] as [SmartList, string, number][]).map(([id, label, count]) => (
                <button key={id} type="button" onClick={() => setSmartList(id)} className={`border-b-2 py-4 text-sm font-semibold ${smartList === id ? 'border-[#df3038] text-[#b91c26]' : 'border-transparent text-[#24354a]'}`}>
                  {label} <span className="ml-1 rounded-full bg-[#eef1f4] px-2 py-0.5 text-[11px]">{count}</span>
                </button>
              ))}
              {savedViews.map((view) => <button type="button" key={view.id} onClick={() => applyView(view)} className="border-b-2 border-transparent py-4 text-sm font-semibold text-[#24354a] hover:text-[#b91c26]">{view.label}</button>)}
              <button type="button" onClick={() => setDialog('view')} className="py-4 text-sm font-semibold text-[#24354a] hover:text-[#b91c26]">＋ New view</button>
            </nav>
          </div>

          <div className="px-7 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative w-52"><Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[#65748a]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contacts..." className="h-9 w-full rounded-md border border-[#ccd4dd] pl-9 pr-3 text-xs outline-none focus:border-[#df3038]" /></label>
              <FilterSelect label="Owner" value={ownerFilter} onChange={setOwnerFilter} options={[['__unassigned', 'Unassigned'], ...owners.map((value) => [value, value] as [string, string])]} />
              <FilterSelect label="Stage" value={stageFilter} onChange={setStageFilter} options={Object.entries(STAGE_LABELS)} />
              <FilterSelect label="Source" value={sourceFilter} onChange={setSourceFilter} options={sources.map((value) => [value, formatLeadSource(value)])} />
              <FilterSelect label="Tags" value={tagFilter} onChange={setTagFilter} options={tags.map((value) => [value, value])} />
              <FilterSelect label="Last activity" value={activityFilter} onChange={setActivityFilter} options={[['day', 'Past 24 hours'], ['week', 'Past 7 days'], ['stale', 'More than 7 days']]} />
              <FilterSelect label="More filters" value={attentionFilter} onChange={setAttentionFilter} options={[['needs_reply', 'Needs reply'], ['waiting_on_contact', 'Waiting on contact'], ['resolved', 'Resolved']]} />
              <select aria-label="Sort contacts" value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} className="ml-auto h-9 rounded-md border border-[#ccd4dd] px-3 text-xs font-semibold text-[#34445a]"><option value="priority">Priority first</option><option value="recent">Recently active</option><option value="name">Name A–Z</option></select>
              <button type="button" onClick={() => void refetch()} aria-label="Refresh contacts" className="flex h-9 w-9 items-center justify-center rounded-md border border-[#ccd4dd] text-[#34445a]"><Icon name="refresh" className={isFetching ? 'animate-spin' : ''} /></button>
            </div>
            <div className="mt-4 flex items-center gap-3">
              {hasFilters ? <button type="button" onClick={clearFilters} className="rounded-md border border-[#efb4b8] bg-[#fff7f7] px-3 py-1.5 text-xs font-semibold text-[#b91c26]">Clear filters ×</button> : null}
              <span className="text-sm text-[#536277]">{visible.length} results</span>
            </div>

            <div className="mt-5 overflow-x-auto rounded-md border border-[#d9e0e6]">
              <div className="grid min-w-[936px] grid-cols-[1.15fr_1.15fr_.75fr_1.2fr_.85fr_.85fr_.75fr] border-b border-[#d9e0e6] bg-[#fbfcfd] px-3 py-3 text-[11px] font-bold text-[#425269]">
                <span>Contact</span><span>Property</span><span>Stage</span><span>Next Action</span><span>Owner</span><span>Last Activity</span><span>Source</span>
              </div>
              {isLoading ? <ContactSkeleton /> : null}
              {error ? <div className="p-8 text-center text-sm text-red-600">Contacts could not be loaded. <button type="button" onClick={() => void refetch()} className="font-bold underline">Try again</button></div> : null}
              {!isLoading && !error && pageItems.length === 0 ? <div className="p-12 text-center text-sm text-[#66758a]">No contacts match these filters.</div> : null}
              {!isLoading && !error ? pageItems.map((row) => {
                const displayName = getDisplayLeadName(row.fullName, row.phone)
                const property = [row.address, row.city].filter(Boolean).join(', ') || 'No property linked'
                const nextAction = row.primaryNextAction?.title || row.nextActivity?.label || 'Define next action'
                return (
                  <button key={row.id} type="button" onClick={() => { setSelectedId(row.id); setDetailsOpen(true) }} aria-pressed={detailsOpen && selected?.id === row.id} className={`grid min-w-[936px] w-full grid-cols-[1.15fr_1.15fr_.75fr_1.2fr_.85fr_.85fr_.75fr] items-center border-b border-[#e3e7eb] px-3 py-4 text-left text-xs last:border-0 ${detailsOpen && selected?.id === row.id ? 'bg-[#fff8f8]' : 'hover:bg-[#fafbfc]'}`}>
                    <span className="flex min-w-0 items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#feecef] font-bold text-[#9f1d27]">{getAvatarLabel(row.fullName, row.phone, row.source)}</span><span className="min-w-0"><strong className="block truncate text-[#1d2c40]">{displayName}</strong><small className="text-[#627087]">{formatPhone(row.phone)}</small></span></span>
                    <span className="min-w-0"><strong className="block truncate font-medium text-[#2d3d52]">{property}</strong><small className="text-[#7b8796]">{row.city || ''}</small></span>
                    <span><span className="rounded border border-[#efb4b8] bg-[#fff1f2] px-2 py-1 font-semibold text-[#b91c26]">{STAGE_LABELS[row.station]}</span></span>
                    <span className={row.primaryNextAction?.overdue ? 'font-semibold text-red-600' : 'text-[#28394f]'}>{nextAction}</span>
                    <span>{row.owner || 'Unassigned'}</span><span className="text-[#68768a]">{formatRelativeDate(row.lastActivityAt)}</span><span className="text-[#526177]">{formatLeadSource(row.source)}</span>
                  </button>
                )
              }) : null}
            </div>
            <div className="mt-7 flex items-center text-xs text-[#69778a]">
              <span>Showing {visible.length ? (currentPage - 1) * pageSize + 1 : 0} to {Math.min(currentPage * pageSize, visible.length)} of {visible.length} results</span>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="h-8 min-w-8 rounded border border-[#d6dde4] px-2 disabled:opacity-40" aria-label="Previous page">‹</button>
                {paginationPages.map((pageNumber) => <button type="button" key={pageNumber} onClick={() => setPage(pageNumber)} aria-current={pageNumber === currentPage ? 'page' : undefined} aria-label={`Page ${pageNumber}`} className={`h-8 min-w-8 rounded border px-2 ${pageNumber === currentPage ? 'border-[#df3038] text-[#b91c26]' : 'border-[#d6dde4]'}`}>{pageNumber}</button>)}
                <span className="sr-only">Page {currentPage} of {pageCount}</span>
                <button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="h-8 min-w-8 rounded border border-[#d6dde4] px-2 disabled:opacity-40" aria-label="Next page">›</button>
              </div>
            </div>
          </div>
        </section>

        {detailsOpen ? <aside className="hidden w-[350px] shrink-0 overflow-y-auto border-l border-[#dde3e9] bg-white p-6 xl:block">
          {selected ? <>
            <div className="flex items-start gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#feecef] text-lg font-bold text-[#9f1d27]">{getAvatarLabel(selected.fullName, selected.phone, selected.source)}</div>
              <div className="min-w-0"><h2 className="truncate text-xl font-bold">{getDisplayLeadName(selected.fullName, selected.phone)}</h2><p className="mt-1 text-sm text-[#58677c]">{[selected.address, selected.city].filter(Boolean).join(', ') || 'No property linked'}</p></div>
              <button type="button" onClick={() => setDetailsOpen(false)} className="ml-auto text-[#6c798b] hover:text-[#b91c26]" aria-label="Close contact details"><Icon name="close" /></button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <button type="button" disabled={!selected.phone} onClick={() => openDialer(selected)} className="flex h-9 items-center justify-center gap-1 rounded-md border border-[#cbd4dc] text-xs font-semibold text-[#b91c26] hover:bg-[#fff7f7] disabled:cursor-not-allowed disabled:opacity-40"><Icon name="call" />Call</button>
              {selected.phone ? <Link href={`/conversations?lead=${selected.id}&compose=sms`} className="flex h-9 items-center justify-center gap-1 rounded-md border border-[#cbd4dc] text-xs font-semibold text-[#b91c26] hover:bg-[#fff7f7]"><Icon name="sms" />Text</Link> : <button type="button" disabled aria-label="Text unavailable because this contact has no phone number" className="flex h-9 items-center justify-center gap-1 rounded-md border border-[#cbd4dc] text-xs font-semibold text-[#b91c26] opacity-40"><Icon name="sms" />Text</button>}
              {selected.email ? <Link href={`/conversations?lead=${selected.id}&compose=email`} className="flex h-9 items-center justify-center gap-1 rounded-md border border-[#cbd4dc] text-xs font-semibold text-[#b91c26] hover:bg-[#fff7f7]"><Icon name="mail" />Email</Link> : <button type="button" disabled aria-label="Email unavailable because this contact has no email address" className="flex h-9 items-center justify-center gap-1 rounded-md border border-[#cbd4dc] text-xs font-semibold text-[#b91c26] opacity-40"><Icon name="mail" />Email</button>}
            </div>
            <div className="mt-6 border-t border-[#e0e5ea] pt-5"><h3 className="text-sm font-bold">Opportunity</h3><dl className="mt-4 space-y-3 text-xs"><div className="flex justify-between"><dt>Stage</dt><dd className="rounded bg-[#fff1f2] px-2 py-1 font-semibold text-[#b91c26]">{STAGE_LABELS[selected.station]}</dd></div><div className="flex justify-between"><dt>Motivation</dt><dd className="font-semibold text-[#b91c26]">{selected.score} / 100</dd></div></dl></div>
            <div className="mt-6 border-t border-[#e0e5ea] pt-5"><h3 className="text-sm font-bold">Next action</h3><p className="mt-3 flex items-center gap-2 text-xs text-[#b16e00]"><Icon name="schedule" />{selected.primaryNextAction?.title || selected.nextActivity?.label || 'Define next action'}</p></div>
            <div className="mt-6 border-t border-[#e0e5ea] pt-5"><h3 className="text-sm font-bold">Recent conversation</h3><p className="mt-3 rounded bg-[#f5f7f9] p-3 text-xs leading-5 text-[#44536a]">{selected.lastMessage || 'No recent message'}</p></div>
            <div className="mt-6 border-t border-[#e0e5ea] pt-5"><h3 className="text-sm font-bold">Contact details</h3><p className="mt-3 text-sm text-[#526177]">{formatPhone(selected.phone)}</p><p className="mt-2 break-all text-sm text-[#526177]">{selected.email || 'No email'}</p><p className="mt-2 text-sm text-[#526177]">Owner: {selected.owner || 'Unassigned'}</p></div>
            <Link href={`/leads/${selected.id}`} className="mt-7 flex h-11 items-center justify-center rounded-md border border-[#df3038] text-sm font-bold text-[#b91c26] hover:bg-[#fff7f7]">Open full workspace →</Link>
          </> : <p className="text-sm text-[#728094]">Select a contact</p>}
        </aside> : null}
      </main>

      {dialog ? <ContactModal title={dialog === 'add' ? 'Add contact' : dialog === 'import' ? 'Import contacts' : 'Save current view'} onClose={() => { if (!saving) setDialog(null) }}>
        {dialog === 'add' ? <form onSubmit={submitAddContact} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">{Object.entries({ fullName: 'Full name', phone: 'Phone', email: 'Email', address: 'Property address', city: 'City', state: 'State', zip: 'ZIP', source: 'Source' }).map(([key, label]) => <label key={key} className={key === 'address' ? 'sm:col-span-2' : ''}><span className="mb-1 block text-xs font-bold text-[#475467]">{label}</span><input type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} value={contactForm[key as keyof typeof contactForm]} onChange={(event) => setContactForm((current) => ({ ...current, [key]: event.target.value }))} className="h-10 w-full rounded-md border border-[#ccd4dd] px-3 text-sm outline-none focus:border-[#df3038]" /></label>)}</div>
          {dialogError ? <p className="text-sm font-semibold text-[#c9232d]">{dialogError}</p> : null}
          <ModalActions saving={saving} submitLabel="Create contact" onCancel={() => setDialog(null)} />
        </form> : null}
        {dialog === 'import' ? <div className="space-y-4">
          <p className="text-sm leading-6 text-[#667085]">Upload a CSV with any of these columns: name, phone, email, address, city, state, ZIP, or source.</p>
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#cbd3dc] bg-[#fafbfc] text-sm font-semibold text-[#475467] hover:border-[#df3038]"><Icon name="upload_file" className="mb-2 text-[28px] text-[#df3038]" />Choose CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setCsvRows(parseCsv(await file.text())) }} /></label>
          {csvRows.length ? <p className="rounded-md bg-[#fff1f2] p-3 text-sm font-semibold text-[#b91c26]">{csvRows.length} contact{csvRows.length === 1 ? '' : 's'} ready to import.</p> : null}
          {dialogError ? <p className="text-sm font-semibold text-[#c9232d]">{dialogError}</p> : null}
          <div className="flex gap-3"><button type="button" disabled={saving} onClick={() => setDialog(null)} className="h-10 flex-1 rounded-md border border-[#cbd3dc] text-sm font-bold">Cancel</button><button type="button" disabled={saving || !csvRows.length} onClick={() => void submitImport()} className="h-10 flex-1 rounded-md bg-[#df3038] text-sm font-bold text-white disabled:opacity-50">{saving ? 'Importing…' : 'Import contacts'}</button></div>
        </div> : null}
        {dialog === 'view' ? <form onSubmit={saveView} className="space-y-4"><p className="text-sm leading-6 text-[#667085]">Save the current owner, stage, source, tag, and attention filters as a reusable view.</p><label><span className="mb-1 block text-xs font-bold text-[#475467]">View name</span><input autoFocus value={viewName} onChange={(event) => setViewName(event.target.value)} className="h-10 w-full rounded-md border border-[#ccd4dd] px-3 text-sm outline-none focus:border-[#df3038]" /></label><ModalActions saving={false} submitLabel="Save view" onCancel={() => setDialog(null)} /></form> : null}
      </ContactModal> : null}
    </WorkspaceFrame>
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={`h-9 rounded-md border px-3 text-xs font-semibold ${value ? 'border-[#efb4b8] bg-[#fff7f7] text-[#b91c26]' : 'border-[#ccd4dd] text-[#34445a]'}`}><option value="">{label}</option>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>
}

function ContactModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#111827]/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[#d9dfe6] bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-[#e4e7ec] px-6 py-4"><h2 className="text-lg font-black text-[#172033]">{title}</h2><button type="button" onClick={onClose} aria-label="Close dialog" className="text-[#667085] hover:text-[#b91c26]"><Icon name="close" /></button></header><div className="p-6">{children}</div></section></div>
}

function ModalActions({ saving, submitLabel, onCancel }: { saving: boolean; submitLabel: string; onCancel: () => void }) {
  return <div className="flex gap-3 pt-2"><button type="button" disabled={saving} onClick={onCancel} className="h-10 flex-1 rounded-md border border-[#cbd3dc] text-sm font-bold">Cancel</button><button type="submit" disabled={saving} className="h-10 flex-1 rounded-md bg-[#df3038] text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : submitLabel}</button></div>
}
