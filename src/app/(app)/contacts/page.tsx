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
type DataGap = '' | 'missing_phone' | 'missing_email' | 'missing_next_action'
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

const STAGE_RANK: Record<DealStage, number> = {
  new: 0,
  contacted: 1,
  qualified: 2,
  appointment_set: 3,
  offer_made: 4,
  under_contract: 5,
  closed_won: 6,
  closed_lost: -1,
  dead: -1,
}

const SMART_LISTS = new Set<SmartList>(['all', 'needs_reply', 'overdue', 'unassigned', 'hot', 'new'])
const DATA_GAPS = new Set<DataGap>(['', 'missing_phone', 'missing_email', 'missing_next_action'])

const SMART_LIST_TONES: Record<SmartList, { active: string; count: string }> = {
  all: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' },
  new: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' },
  needs_reply: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' },
  overdue: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' },
  hot: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' },
  unassigned: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]' },
}

const STAGE_TONES: Record<DealStage, string> = {
  new: 'border-[var(--crm-border-strong)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]',
  contacted: 'border-[var(--crm-border-strong)] bg-[var(--crm-info-soft)] text-[var(--crm-info)]',
  qualified: 'border-[var(--crm-border-strong)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
  appointment_set: 'border-[var(--crm-border-strong)] bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]',
  offer_made: 'border-[var(--crm-border-strong)] bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
  under_contract: 'border-[var(--crm-border-strong)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
  closed_won: 'border-[var(--crm-border-strong)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
  closed_lost: 'border-[var(--crm-brand-border)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
  dead: 'border-[var(--crm-border-strong)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]',
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
  return <div className="space-y-2 p-4" aria-label="Loading contacts">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-[var(--crm-surface-subtle)]" />)}</div>
}

export default function ContactsPage() {
  const [smartList, setSmartList] = useState<SmartList>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [ownerFilter, setOwnerFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [minimumStageFilter, setMinimumStageFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [activityFilter, setActivityFilter] = useState('')
  const [attentionFilter, setAttentionFilter] = useState('')
  const [dataGapFilter, setDataGapFilter] = useState<DataGap>('')
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
    const params = new URLSearchParams(window.location.search)
    const requestedSearch = params.get('search')
    if (requestedSearch) setSearch(requestedSearch)
    const requestedList = params.get('list') as SmartList | null
    if (requestedList && SMART_LISTS.has(requestedList)) setSmartList(requestedList)
    const requestedStage = params.get('stage')
    if (requestedStage && requestedStage in STAGE_LABELS) setStageFilter(requestedStage)
    const requestedMinimumStage = params.get('min_stage')
    if (requestedMinimumStage && requestedMinimumStage in STAGE_LABELS) setMinimumStageFilter(requestedMinimumStage)
    const requestedActivity = params.get('activity')
    if (requestedActivity && ['day', 'week', 'stale', 'none'].includes(requestedActivity)) setActivityFilter(requestedActivity)
    const requestedGap = (params.get('gap') ?? '') as DataGap
    if (DATA_GAPS.has(requestedGap)) setDataGapFilter(requestedGap)
    if (params.get('owner') === 'unassigned') setOwnerFilter('__unassigned')
    const requestedSource = params.get('source')
    if (requestedSource) setSourceFilter(requestedSource)
    const requestedAttention = params.get('attention')
    if (requestedAttention && ['needs_reply', 'waiting_on_contact', 'resolved'].includes(requestedAttention)) setAttentionFilter(requestedAttention)
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
      if (ownerFilter === '__unassigned' ? item.owner : ownerFilter && item.owner !== ownerFilter) return false
      if (stageFilter && item.station !== stageFilter) return false
      if (minimumStageFilter && STAGE_RANK[item.station] < STAGE_RANK[minimumStageFilter as DealStage]) return false
      if (sourceFilter && item.source !== sourceFilter) return false
      if (tagFilter && !item.tags.includes(tagFilter)) return false
      if (attentionFilter && item.attentionState !== attentionFilter) return false
      if (dataGapFilter === 'missing_phone' && item.phone) return false
      if (dataGapFilter === 'missing_email' && item.email) return false
      if (dataGapFilter === 'missing_next_action' && item.primaryNextAction) return false
      if (activityFilter) {
        const timestamp = item.lastActivityAt ? new Date(item.lastActivityAt).getTime() : 0
        const age = Date.now() - timestamp
        if (activityFilter === 'day' && age > 86_400_000) return false
        if (activityFilter === 'week' && age > 604_800_000) return false
        if (activityFilter === 'stale' && (timestamp === 0 || age <= 604_800_000)) return false
        if (activityFilter === 'none' && timestamp !== 0) return false
      }
      if (!needle) return true
      return [item.fullName, item.phone, item.email, item.address, item.city, item.owner, item.source].some((value) => value?.toLowerCase().includes(needle))
    }).sort((a, b) => {
      if (sortBy === 'name') return getDisplayLeadName(a.fullName, a.phone).localeCompare(getDisplayLeadName(b.fullName, b.phone))
      if (sortBy === 'recent') return new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime()
      const attentionRank = (item: ContactWorkspaceRow) => item.attentionState === 'needs_reply' ? 0 : item.primaryNextAction?.overdue ? 1 : 2
      return attentionRank(a) - attentionRank(b) || b.score - a.score
    })
  }, [activityFilter, attentionFilter, dataGapFilter, items, minimumStageFilter, ownerFilter, search, smartList, sortBy, sourceFilter, stageFilter, tagFilter])

  useEffect(() => setPage(1), [activityFilter, attentionFilter, dataGapFilter, minimumStageFilter, ownerFilter, search, smartList, sortBy, sourceFilter, stageFilter, tagFilter])

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
    setMinimumStageFilter('')
    setSourceFilter('')
    setTagFilter('')
    setActivityFilter('')
    setAttentionFilter('')
    setDataGapFilter('')
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

  const hasFilters = smartList !== 'all' || ownerFilter || stageFilter || minimumStageFilter || sourceFilter || tagFilter || activityFilter || attentionFilter || dataGapFilter

  return (
    <WorkspaceFrame needsReply={counts.needs_reply}>
      <main className="flex h-full min-w-0 bg-[var(--crm-canvas)]">
        <section className="min-w-0 flex-1 overflow-y-auto">
          <header className="crm-page-header flex flex-wrap items-center justify-between gap-4 border-b px-8 py-6">
            <div><p className="crm-eyebrow mb-1">Relationship intelligence</p><h1 className="text-[26px] font-bold tracking-[-0.02em] text-[var(--crm-ink)]">Contacts</h1><p className="mt-1 text-sm text-[var(--crm-text-muted)]">People, property, ownership, and next action in one searchable workspace</p></div>
            <div className="flex gap-3">
              <button type="button" onClick={() => { setDialogError(null); setDialog('import') }} className="crm-secondary-button flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold"><Icon name="upload" />Import</button>
              <button type="button" onClick={() => { setDialogError(null); setDialog('add') }} className="crm-primary-button flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-semibold"><Icon name="add" />Add contact</button>
            </div>
          </header>

          <div className="overflow-x-auto border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-7">
            <nav className="flex min-w-max gap-7">
              {([
                ['all', 'All Contacts', counts.all],
                ['new', 'New Leads', counts.new],
                ['needs_reply', 'Needs Follow-up', counts.needs_reply],
                ['hot', 'Hot Opportunities', counts.hot],
                ['unassigned', 'Unassigned', counts.unassigned],
              ] as [SmartList, string, number][]).map(([id, label, count]) => (
                <button key={id} type="button" onClick={() => setSmartList(id)} className={`border-b-[3px] py-4 text-sm font-semibold transition-colors ${smartList === id ? SMART_LIST_TONES[id].active : 'border-transparent text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]'}`}>
                  {label} <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${smartList === id ? SMART_LIST_TONES[id].count : 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'}`}>{count}</span>
                </button>
              ))}
              {savedViews.map((view) => <button type="button" key={view.id} onClick={() => applyView(view)} className="border-b-2 border-transparent py-4 text-sm font-semibold text-[var(--crm-text)] hover:text-[var(--crm-brand)]">{view.label}</button>)}
              <button type="button" onClick={() => setDialog('view')} className="py-4 text-sm font-semibold text-[var(--crm-text)] hover:text-[var(--crm-brand)]">＋ New view</button>
            </nav>
          </div>

          <div className="px-7 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative w-52"><Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--crm-text-muted)]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contacts..." className="crm-field h-9 w-full rounded-lg pl-9 pr-3 text-xs outline-none" /></label>
              <FilterSelect label="Owner" value={ownerFilter} onChange={setOwnerFilter} options={[['__unassigned', 'Unassigned'], ...owners.map((value) => [value, value] as [string, string])]} />
              <FilterSelect label="Stage" value={stageFilter} onChange={setStageFilter} options={Object.entries(STAGE_LABELS)} />
              <FilterSelect label="Minimum stage" value={minimumStageFilter} onChange={setMinimumStageFilter} options={Object.entries(STAGE_LABELS).filter(([value]) => STAGE_RANK[value as DealStage] >= 0)} />
              <FilterSelect label="Source" value={sourceFilter} onChange={setSourceFilter} options={sources.map((value) => [value, formatLeadSource(value)])} />
              <FilterSelect label="Tags" value={tagFilter} onChange={setTagFilter} options={tags.map((value) => [value, value])} />
              <FilterSelect label="Last activity" value={activityFilter} onChange={setActivityFilter} options={[['day', 'Past 24 hours'], ['week', 'Past 7 days'], ['stale', 'More than 7 days'], ['none', 'No activity']]} />
              <FilterSelect label="Data quality" value={dataGapFilter} onChange={(value) => setDataGapFilter(value as DataGap)} options={[['missing_phone', 'Missing phone'], ['missing_email', 'Missing email'], ['missing_next_action', 'Missing next action']]} />
              <FilterSelect label="More filters" value={attentionFilter} onChange={setAttentionFilter} options={[['needs_reply', 'Needs reply'], ['waiting_on_contact', 'Waiting on contact'], ['resolved', 'Resolved']]} />
              <select aria-label="Sort contacts" value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} className="crm-field ml-auto h-9 rounded-lg px-3 text-xs font-semibold"><option value="priority">Priority first</option><option value="recent">Recently active</option><option value="name">Name A–Z</option></select>
              <button type="button" onClick={() => void refetch()} aria-label="Refresh contacts" className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg"><Icon name="refresh" className={isFetching ? 'animate-spin' : ''} /></button>
            </div>
            <div className="mt-4 flex items-center gap-3">
              {hasFilters ? <button type="button" onClick={clearFilters} className="rounded-lg border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--crm-brand)]">Clear filters ×</button> : null}
              <span className="text-sm text-[var(--crm-text-muted)]">{visible.length} results</span>
            </div>

            <div className="crm-panel mt-5 overflow-x-auto rounded-xl">
              <div className="crm-table-header grid min-w-[936px] grid-cols-[1.15fr_1.15fr_.75fr_1.2fr_.85fr_.85fr_.75fr] border-b px-3 py-3 text-[11px] font-bold uppercase tracking-[0.06em]">
                <span>Contact</span><span>Property</span><span>Stage</span><span>Next Action</span><span>Owner</span><span>Last Activity</span><span>Source</span>
              </div>
              {isLoading ? <ContactSkeleton /> : null}
              {error ? <div className="p-8 text-center text-sm text-red-600">Contacts could not be loaded. <button type="button" onClick={() => void refetch()} className="font-bold underline">Try again</button></div> : null}
              {!isLoading && !error && pageItems.length === 0 ? <div className="p-12 text-center text-sm text-[var(--crm-text-muted)]">No contacts match these filters.</div> : null}
              {!isLoading && !error ? pageItems.map((row) => {
                const displayName = getDisplayLeadName(row.fullName, row.phone)
                const property = [row.address, row.city].filter(Boolean).join(', ') || 'No property linked'
                const nextAction = row.primaryNextAction?.title || row.nextActivity?.label || 'Define next action'
                const selectedRow = detailsOpen && selected?.id === row.id
                const rowAttention = row.primaryNextAction?.overdue
                  ? 'border-l-[var(--crm-danger)]'
                  : row.attentionState === 'needs_reply'
                    ? 'border-l-[var(--crm-warning)]'
                    : 'border-l-transparent'
                const avatarTone = row.isFavorite || row.attentionState === 'needs_reply'
                  ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'
                  : row.station === 'qualified' || row.station === 'under_contract'
                    ? 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]'
                    : 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'
                return (
                  <button key={row.id} type="button" onClick={() => { setSelectedId(row.id); setDetailsOpen(true) }} aria-pressed={selectedRow} className={`grid min-w-[936px] w-full grid-cols-[1.15fr_1.15fr_.75fr_1.2fr_.85fr_.85fr_.75fr] items-center border-b border-l-4 border-b-[var(--crm-border)] px-3 py-4 text-left text-xs transition-colors last:border-b-0 ${selectedRow ? 'border-l-[var(--crm-brand)] bg-[var(--crm-surface-selected)]' : `${rowAttention} hover:bg-[var(--crm-surface-subtle)]`}`}>
                    <span className="flex min-w-0 items-center gap-2.5"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-bold ${avatarTone}`}>{getAvatarLabel(row.fullName, row.phone, row.source)}</span><span className="min-w-0"><strong className="block truncate text-[var(--crm-ink)]">{displayName}</strong><small className="text-[var(--crm-text-muted)]">{formatPhone(row.phone)}</small></span></span>
                    <span className="min-w-0"><strong className="block truncate font-medium text-[var(--crm-text)]">{property}</strong><small className="text-[var(--crm-text-dim)]">{row.city || ''}</small></span>
                    <span><span className={`rounded-md border px-2 py-1 font-semibold ${STAGE_TONES[row.station]}`}>{STAGE_LABELS[row.station]}</span></span>
                    <span className={`flex items-start gap-1.5 ${row.primaryNextAction?.overdue ? 'font-bold text-[var(--crm-danger)]' : 'font-semibold text-[var(--crm-warning)]'}`}><Icon name={row.primaryNextAction?.overdue ? 'error' : 'schedule'} className="mt-[-1px] shrink-0 text-[15px]" />{nextAction}</span>
                    <span>{row.owner || 'Unassigned'}</span><span className="text-[var(--crm-text-muted)]">{formatRelativeDate(row.lastActivityAt)}</span><span className="text-[var(--crm-text-muted)]">{formatLeadSource(row.source)}</span>
                  </button>
                )
              }) : null}
            </div>
            <div className="mt-7 flex items-center text-xs text-[var(--crm-text-muted)]">
              <span>Showing {visible.length ? (currentPage - 1) * pageSize + 1 : 0} to {Math.min(currentPage * pageSize, visible.length)} of {visible.length} results</span>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="h-8 min-w-8 rounded border border-[var(--crm-border)] px-2 disabled:opacity-40" aria-label="Previous page">‹</button>
                {paginationPages.map((pageNumber) => <button type="button" key={pageNumber} onClick={() => setPage(pageNumber)} aria-current={pageNumber === currentPage ? 'page' : undefined} aria-label={`Page ${pageNumber}`} className={`h-8 min-w-8 rounded border px-2 ${pageNumber === currentPage ? 'border-[var(--crm-brand)] text-[var(--crm-brand)]' : 'border-[var(--crm-border)]'}`}>{pageNumber}</button>)}
                <span className="sr-only">Page {currentPage} of {pageCount}</span>
                <button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="h-8 min-w-8 rounded border border-[var(--crm-border)] px-2 disabled:opacity-40" aria-label="Next page">›</button>
              </div>
            </div>
          </div>
        </section>

        {detailsOpen ? <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-[var(--crm-border)] bg-[var(--crm-surface)] p-6 xl:block">
          {selected ? <>
            <div className="flex items-start gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--crm-charcoal)] text-lg font-bold text-[var(--crm-surface)]">{getAvatarLabel(selected.fullName, selected.phone, selected.source)}</div>
              <div className="min-w-0"><h2 className="truncate text-xl font-bold">{getDisplayLeadName(selected.fullName, selected.phone)}</h2><p className="mt-1 text-sm text-[var(--crm-text-muted)]">{[selected.address, selected.city].filter(Boolean).join(', ') || 'No property linked'}</p></div>
              <button type="button" onClick={() => setDetailsOpen(false)} className="ml-auto text-[var(--crm-text-muted)] hover:text-[var(--crm-brand)]" aria-label="Close contact details"><Icon name="close" /></button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <button type="button" disabled={!selected.phone} onClick={() => openDialer(selected)} className="flex h-9 items-center justify-center gap-1 rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-success-soft)] text-xs font-semibold text-[var(--crm-success)] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"><Icon name="call" />Call</button>
              {selected.phone ? <Link href={`/conversations?lead=${selected.id}&compose=sms`} className="flex h-9 items-center justify-center gap-1 rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-info-soft)] text-xs font-semibold text-[var(--crm-info)] hover:brightness-95"><Icon name="sms" />Text</Link> : <button type="button" disabled aria-label="Text unavailable because this contact has no phone number" className="flex h-9 items-center justify-center gap-1 rounded-lg border border-[var(--crm-border)] text-xs font-semibold text-[var(--crm-info)] opacity-40"><Icon name="sms" />Text</button>}
              {selected.email ? <Link href={`/conversations?lead=${selected.id}&compose=email`} className="flex h-9 items-center justify-center gap-1 rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-violet-soft)] text-xs font-semibold text-[var(--crm-violet)] hover:brightness-95"><Icon name="mail" />Email</Link> : <button type="button" disabled aria-label="Email unavailable because this contact has no email address" className="flex h-9 items-center justify-center gap-1 rounded-lg border border-[var(--crm-border)] text-xs font-semibold text-[var(--crm-violet)] opacity-40"><Icon name="mail" />Email</button>}
            </div>
            <div className="crm-panel mt-6 rounded-xl p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><Icon name="trending_up" className="text-[18px] text-[var(--crm-success)]" />Opportunity</h3><dl className="mt-4 space-y-3 text-xs"><div className="flex justify-between"><dt>Stage</dt><dd className={`rounded-md border px-2 py-1 font-semibold ${STAGE_TONES[selected.station]}`}>{STAGE_LABELS[selected.station]}</dd></div><div className="flex justify-between"><dt>Motivation</dt><dd className="rounded-full bg-[var(--crm-violet-soft)] px-2 py-0.5 font-black text-[var(--crm-violet)]">{selected.score} / 100</dd></div></dl></div>
            <div className="mt-5 rounded-xl border border-[var(--crm-border-strong)] border-l-4 border-l-[var(--crm-warning)] bg-[var(--crm-warning-soft)] p-4"><h3 className="flex items-center gap-2 text-sm font-bold text-[var(--crm-warning)]"><Icon name="bolt" className="text-[18px]" />Next action</h3><p className="mt-3 flex items-start gap-2 text-xs font-semibold leading-5"><Icon name="schedule" className="mt-0.5" />{selected.primaryNextAction?.title || selected.nextActivity?.label || 'Define next action'}</p></div>
            <div className="mt-5 border-t border-[var(--crm-border)] pt-5"><h3 className="flex items-center gap-2 text-sm font-bold"><Icon name="forum" className="text-[18px] text-[var(--crm-info)]" />Recent conversation</h3><p className="mt-3 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-info-soft)] p-3 text-xs leading-5 text-[var(--crm-text)]">{selected.lastMessage || 'No recent message'}</p></div>
            <div className="mt-6 border-t border-[var(--crm-border)] pt-5"><h3 className="text-sm font-bold">Contact details</h3><p className="mt-3 text-sm text-[var(--crm-text-muted)]">{formatPhone(selected.phone)}</p><p className="mt-2 break-all text-sm text-[var(--crm-text-muted)]">{selected.email || 'No email'}</p><p className="mt-2 text-sm text-[var(--crm-text-muted)]">Owner: {selected.owner || 'Unassigned'}</p></div>
            <Link href={`/leads/${selected.id}`} className="crm-primary-button mt-7 flex h-11 items-center justify-center rounded-lg text-sm font-bold">Open full workspace →</Link>
          </> : <p className="text-sm text-[var(--crm-text-dim)]">Select a contact</p>}
        </aside> : null}
      </main>

      {dialog ? <ContactModal title={dialog === 'add' ? 'Add contact' : dialog === 'import' ? 'Import contacts' : 'Save current view'} onClose={() => { if (!saving) setDialog(null) }}>
        {dialog === 'add' ? <form onSubmit={submitAddContact} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">{Object.entries({ fullName: 'Full name', phone: 'Phone', email: 'Email', address: 'Property address', city: 'City', state: 'State', zip: 'ZIP', source: 'Source' }).map(([key, label]) => <label key={key} className={key === 'address' ? 'sm:col-span-2' : ''}><span className="mb-1 block text-xs font-bold text-[var(--ck-text-muted)]">{label}</span><input type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} value={contactForm[key as keyof typeof contactForm]} onChange={(event) => setContactForm((current) => ({ ...current, [key]: event.target.value }))} className="h-10 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-sm text-[var(--ck-text)] outline-none focus:border-[var(--ck-accent)]" /></label>)}</div>
          {dialogError ? <p className="text-sm font-semibold text-[var(--ck-accent)]">{dialogError}</p> : null}
          <ModalActions saving={saving} submitLabel="Create contact" onCancel={() => setDialog(null)} />
        </form> : null}
        {dialog === 'import' ? <div className="space-y-4">
          <p className="text-sm leading-6 text-[var(--ck-text-muted)]">Upload a CSV with any of these columns: name, phone, email, address, city, state, ZIP, or source.</p>
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[var(--ck-border-strong)] bg-[var(--ck-surface-elev)] text-sm font-semibold text-[var(--ck-text-muted)] hover:border-[var(--ck-accent)]"><Icon name="upload_file" className="mb-2 text-[28px] text-[var(--ck-accent)]" />Choose CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setCsvRows(parseCsv(await file.text())) }} /></label>
          {csvRows.length ? <p className="rounded-md bg-[var(--ck-surface-elev)] p-3 text-sm font-semibold text-[var(--ck-accent)]">{csvRows.length} contact{csvRows.length === 1 ? '' : 's'} ready to import.</p> : null}
          {dialogError ? <p className="text-sm font-semibold text-[var(--ck-accent)]">{dialogError}</p> : null}
          <div className="flex gap-3"><button type="button" disabled={saving} onClick={() => setDialog(null)} className="h-10 flex-1 rounded-lg border border-[var(--ck-border-strong)] text-sm font-bold">Cancel</button><button type="button" disabled={saving || !csvRows.length} onClick={() => void submitImport()} className="h-10 flex-1 rounded-lg bg-[var(--ck-accent)] text-sm font-bold text-white disabled:opacity-50">{saving ? 'Importing…' : 'Import contacts'}</button></div>
        </div> : null}
        {dialog === 'view' ? <form onSubmit={saveView} className="space-y-4"><p className="text-sm leading-6 text-[var(--ck-text-muted)]">Save the current owner, stage, source, tag, and attention filters as a reusable view.</p><label><span className="mb-1 block text-xs font-bold text-[var(--ck-text-muted)]">View name</span><input autoFocus value={viewName} onChange={(event) => setViewName(event.target.value)} className="h-10 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-sm text-[var(--ck-text)] outline-none focus:border-[var(--ck-accent)]" /></label><ModalActions saving={false} submitLabel="Save view" onCancel={() => setDialog(null)} /></form> : null}
      </ContactModal> : null}
    </WorkspaceFrame>
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={`h-9 rounded-lg border px-3 text-xs font-semibold ${value ? 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'crm-field'}`}><option value="">{label}</option>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>
}

function ContactModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#111827]/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section role="dialog" aria-modal="true" aria-label={title} className="crm-modal-surface max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] shadow-2xl"><header className="flex items-center justify-between border-b border-[var(--ck-border)] px-6 py-4"><h2 className="text-lg font-bold text-[var(--ck-text)]">{title}</h2><button type="button" onClick={onClose} aria-label="Close dialog" className="text-[var(--ck-text-muted)] hover:text-[var(--ck-accent)]"><Icon name="close" /></button></header><div className="p-6">{children}</div></section></div>
}

function ModalActions({ saving, submitLabel, onCancel }: { saving: boolean; submitLabel: string; onCancel: () => void }) {
  return <div className="flex gap-3 pt-2"><button type="button" disabled={saving} onClick={onCancel} className="h-10 flex-1 rounded-lg border border-[var(--ck-border-strong)] text-sm font-bold">Cancel</button><button type="submit" disabled={saving} className="h-10 flex-1 rounded-lg bg-[var(--ck-accent)] text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : submitLabel}</button></div>
}
