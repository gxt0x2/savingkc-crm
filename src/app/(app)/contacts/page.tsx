'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { formatLeadSource, getAvatarLabel, getDisplayLeadName, outreachStatusLabel, type OutreachStatus } from '@/lib/contact-display'
import { formatPhone } from '@/lib/format'
import type { ContactSignal } from '@/lib/contact-display'
import type { DealStage } from '@/types/pipeline'
import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { ProspectsWorkspaceTab } from '@/components/contacts/prospects-workspace-tab'
import { ContactsLoadingSkeleton, MobileContactsList } from '@/components/contacts/mobile-contacts-list'
import { PrimaryNextActionReviewDialog } from '@/components/contacts/primary-next-action-review'
import type { SortableSmartListTabsProps } from '@/components/contacts/sortable-smart-list-tabs'
import { LeadStatusControl, type LeadStatusUpdate } from '@/components/leads/lead-status-control'
import { PipelineFilterSelect, PipelineModal, PipelineModalActions } from '@/components/pipeline/pipeline-controls'
import { DEAD_REASONS, deadReasonLabel, isNotLeadOutcome } from '@/lib/lead-outcomes'
import { useAuth } from '@/hooks/use-auth'
import { useMobileViewport } from '@/hooks/use-mobile-viewport'
import { conversationHubQueryKey } from '@/lib/queries/conversation-hub'
import { CONTACT_SMART_LIST_COPY, CONTACT_SMART_LIST_ORDER_STORAGE_KEY, CONTACT_SMART_LISTS, DEFAULT_CONTACT_SMART_LIST_ORDER, canonicalContactSmartList, contactPipelineStatusLabel, normalizeContactSmartListOrder, type ContactSmartList, type ContactSmartListNavigationId } from '@/lib/contact-smart-lists'
import { parseCsv } from '@/lib/parse-csv'
import { campaignAudienceReturnHref, MAX_PROSPECTING_QUERY_AUDIENCE, prospectingCampaignId, PROSPECTING_AUDIENCE_STORAGE_KEY, serializeProspectingAudienceSelection, type ProspectingAudienceQuery } from '@/lib/prospecting/audience-handoff'

interface ContactRow {
  id: string
  fullName: string | null
  phone: string | null
  email: string | null
  source: string | null
  address: string | null
  city: string | null
  station: DealStage
  classification: 'lead' | 'opportunity' | 'dead' | null
  deadReason: string | null
  owner: string | null
  score: number
  isFavorite: boolean
  nextActivity: { when: string | null; label: string; kind: 'appointment' | 'recommended' | null } | null
  tags: string[]
  lastContactAt: string | null
  createdAt: string | null
  firstOutboundAt: string | null
  contactSignal: ContactSignal | null
  outreachStatus: OutreachStatus
  updatedAt: string | null
  pipelineIntentSource: string | null
  attentionState: 'needs_reply' | 'waiting_on_contact' | 'resolved'
  lastMessage: string
  lastActivityAt: string
  primaryNextAction: { id: string; title: string; dueAt: string | null; owner: string | null; overdue: boolean } | null
}

export interface ContactWorkspaceRow extends ContactRow {
  hubEnriched: boolean
}

type DataGap = '' | 'missing_phone' | 'missing_email' | 'missing_next_action'
type ContactDialog = 'add' | 'import' | 'view' | null
type ToolbarMenu = 'filters' | 'sort' | null
type BulkAction = '' | 'assign:Ernest' | 'assign:Casey' | 'assign:Gertha' | 'assign:unassigned' | 'classify:new' | 'classify:lead' | `stage:${DealStage}` | 'not_lead'

interface SavedView {
  id: string
  label: string
  owner: string
  stage: string
  source: string
  tag: string
  attention: string
  outreach: string
}

const STAGE_LABELS: Record<DealStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Opportunity',
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

const DATA_GAPS = new Set<DataGap>(['', 'missing_phone', 'missing_email', 'missing_next_action'])

const SMART_LIST_TONES: Record<ContactSmartList, { active: string; count: string }> = {
  new: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' },
  all: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' },
  contacted: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' },
  qualified: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' },
  appointment_set: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]' },
  offer_made: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]' },
  in_closing: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' },
  needs_reply: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' },
  overdue: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' },
  hot: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' },
  unassigned: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]' },
  prospects: { active: 'border-[var(--crm-info)] text-[var(--crm-info)]', count: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' },
  not_leads: { active: 'border-[var(--crm-brand)] text-[var(--crm-brand)]', count: 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' },
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
const CONTACT_QUERY_ROOT = ['contact-workspace'] as const
const CONTACT_PAGE_SIZE = 10
const BULK_STAGE_OPTIONS: DealStage[] = ['qualified', 'appointment_set', 'offer_made']

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

type ContactScopeCounts = { active: number; prospects: number; not_leads: number }
type ContactWorkspacePayload = {
  items: ContactWorkspaceRow[]
  scopeCounts: ContactScopeCounts
  counts: Record<ContactSmartList, number>
  facets: { owners: string[]; sources: string[]; tags: string[] }
  pageInfo: { limit: number; total: number; hasMore: boolean; nextCursor: string | null }
}

interface ContactWorkspaceQuery {
  smartList: ContactSmartList
  cursor: string | null
  sort: 'priority' | 'recent' | 'name'
  search: string
  owner: string
  stage: string
  minimumStage: string
  source: string
  tag: string
  activity: string
  attention: string
  outreach: string
  dataGap: DataGap
}

function useContactWorkspace(query: ContactWorkspaceQuery) {
  return useQuery<ContactWorkspacePayload>({
    queryKey: [...CONTACT_QUERY_ROOT, query],
    queryFn: async () => {
      const params = new URLSearchParams({
        mode: 'page',
        list: query.smartList,
        limit: String(CONTACT_PAGE_SIZE),
        sort: query.sort,
      })
      if (query.cursor) params.set('cursor', query.cursor)
      if (query.search.trim()) params.set('q', query.search.trim())
      if (query.owner) params.set('owner', query.owner)
      if (query.stage) params.set('stage', query.stage)
      if (query.minimumStage) params.set('min_stage', query.minimumStage)
      if (query.source) params.set('source', query.source)
      if (query.tag) params.set('tag', query.tag)
      if (query.activity) params.set('activity', query.activity)
      if (query.attention) params.set('attention', query.attention)
      if (query.outreach) params.set('outreach', query.outreach)
      if (query.dataGap) params.set('gap', query.dataGap)
      const contactsResponse = await fetch(`/api/contacts?${params}`, { cache: 'no-store' })
      if (!contactsResponse.ok) throw new Error('Contacts could not be loaded')
      const contactsPayload = await contactsResponse.json() as Partial<ContactWorkspacePayload> & { items?: ContactRow[] }
      return {
        items: (contactsPayload.items ?? []).map((item) => ({ ...item, hubEnriched: true })),
        scopeCounts: contactsPayload.scopeCounts ?? { active: 0, prospects: 0, not_leads: 0 },
        counts: contactsPayload.counts ?? Object.fromEntries(Object.keys(CONTACT_SMART_LIST_COPY).map((key) => [key, 0])) as Record<ContactSmartList, number>,
        facets: contactsPayload.facets ?? { owners: [], sources: [], tags: [] },
        pageInfo: contactsPayload.pageInfo ?? { limit: CONTACT_PAGE_SIZE, total: 0, hasMore: false, nextCursor: null },
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  })
}

export default function ContactsPage() {
  const isMobile = useMobileViewport()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const requestedInitialList = searchParams.get('list') as ContactSmartList | null
  const requestedCampaignId = prospectingCampaignId(searchParams.get('campaign'))
  const requestedCampaignName = (searchParams.get('campaign_name') || '').trim().slice(0, 120)
  const [smartList, setSmartList] = useState<ContactSmartList>(canonicalContactSmartList(requestedInitialList))
  const [smartListOrder, setSmartListOrder] = useState<ContactSmartListNavigationId[]>([...DEFAULT_CONTACT_SMART_LIST_ORDER])
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
  const [outreachFilter, setOutreachFilter] = useState('')
  const [dataGapFilter, setDataGapFilter] = useState<DataGap>('')
  const [sortBy, setSortBy] = useState<'priority' | 'recent' | 'name'>('priority')
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null])
  const [pageIndex, setPageIndex] = useState(0)
  const [dialog, setDialog] = useState<ContactDialog>(null)
  const [primaryReviewContact, setPrimaryReviewContact] = useState<ContactWorkspaceRow | null>(null)
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT)
  const [viewName, setViewName] = useState('')
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])
  const [saving, setSaving] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [toolbarMenu, setToolbarMenu] = useState<ToolbarMenu>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [allMatchingSelection, setAllMatchingSelection] = useState<{ query: ProspectingAudienceQuery; count: number } | null>(null)
  const [bulkAction, setBulkAction] = useState<BulkAction>('')
  const [bulkDeadReason, setBulkDeadReason] = useState('')
  const [bulkNotes, setBulkNotes] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)
  const [SortableSmartListTabs, setSortableSmartListTabs] = useState<ComponentType<SortableSmartListTabsProps> | null>(null)
  const sortableSmartListTabsPromise = useRef<Promise<ComponentType<SortableSmartListTabsProps>> | null>(null)
  const deferredSearch = useDeferredValue(search)
  const audienceQuery = useMemo(() => ({ smartList, sort: sortBy, search: deferredSearch, owner: ownerFilter, stage: stageFilter, minimumStage: minimumStageFilter,
    source: sourceFilter, tag: tagFilter, activity: activityFilter, attention: attentionFilter, outreach: outreachFilter, dataGap: dataGapFilter,
  } satisfies ProspectingAudienceQuery), [activityFilter, attentionFilter, dataGapFilter, deferredSearch, minimumStageFilter, outreachFilter, ownerFilter, smartList, sortBy, sourceFilter, stageFilter, tagFilter])
  const currentQuery = useContactWorkspace({
    ...audienceQuery,
    cursor: cursorHistory[pageIndex] ?? null,
  })
  const items = useMemo(() => currentQuery.data?.items ?? [], [currentQuery.data])
  const { isLoading, error, refetch, isFetching } = currentQuery
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('savingkc-contact-views')
      if (stored) setSavedViews(JSON.parse(stored) as SavedView[])
      const storedSmartListOrder = window.localStorage.getItem(CONTACT_SMART_LIST_ORDER_STORAGE_KEY)
      if (storedSmartListOrder) setSmartListOrder(normalizeContactSmartListOrder(JSON.parse(storedSmartListOrder)))
    } catch { /* storage may be unavailable */ }
    const params = new URLSearchParams(window.location.search)
    const requestedSearch = params.get('search')
    if (requestedSearch) setSearch(requestedSearch)
    const requestedList = params.get('list')
    if (requestedList) {
      const canonicalList = canonicalContactSmartList(requestedList)
      setSmartList(canonicalList)
      if (canonicalList !== requestedList) {
        params.set('list', canonicalList)
        window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
      }
    }
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
    const requestedOutreach = params.get('outreach')
    if (requestedOutreach && ['unattempted', 'attempted_no_response', 'connected_unclassified'].includes(requestedOutreach)) setOutreachFilter(requestedOutreach)
  }, [])

  const loadSortableSmartListTabs = useCallback(() => {
    if (!sortableSmartListTabsPromise.current) {
      sortableSmartListTabsPromise.current = import('@/components/contacts/sortable-smart-list-tabs')
        .then((module) => module.SortableSmartListTabs)
    }
    void sortableSmartListTabsPromise.current
      .then((component) => setSortableSmartListTabs(() => component))
      .catch(() => { /* static tabs remain fully usable if the enhancement fails */ })
  }, [])

  useEffect(() => {
    let idleId: number | null = null
    const timeoutId = window.setTimeout(() => {
      if ('requestIdleCallback' in window) {
        idleId = window.requestIdleCallback(loadSortableSmartListTabs, { timeout: 5_000 })
      } else {
        loadSortableSmartListTabs()
      }
    }, 5_000)

    return () => {
      window.clearTimeout(timeoutId)
      if (idleId !== null) window.cancelIdleCallback(idleId)
    }
  }, [loadSortableSmartListTabs])

  const counts = currentQuery.data?.counts
    ?? Object.fromEntries(Object.keys(CONTACT_SMART_LIST_COPY).map((key) => [key, 0])) as Record<ContactSmartList, number>
  const orderedSmartLists = useMemo(() => {
    const smartListsById = new Map(CONTACT_SMART_LISTS.map((item) => [item.id, item]))
    return smartListOrder.map((id) => smartListsById.get(id)).filter((item): item is (typeof CONTACT_SMART_LISTS)[number] => Boolean(item))
  }, [smartListOrder])

  const owners = currentQuery.data?.facets.owners ?? []
  const sources = currentQuery.data?.facets.sources ?? []
  const tags = currentQuery.data?.facets.tags ?? []

  useEffect(() => {
    setSelectedIds((current) => {
      const visibleIds = new Set(items.map((item) => item.id))
      const next = new Set([...current].filter((id) => visibleIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [items])

  const activeAllMatchingSelection = allMatchingSelection && JSON.stringify(allMatchingSelection.query) === JSON.stringify(audienceQuery) ? allMatchingSelection : null

  const totalResults = currentQuery.data?.pageInfo.total ?? 0
  const pageCount = Math.max(1, Math.ceil(totalResults / CONTACT_PAGE_SIZE))
  const currentPage = pageIndex + 1
  const pageItems = items
  const selected = items.find((item) => item.id === selectedId) ?? pageItems[0] ?? null
  const pageItemsSelected = pageItems.length > 0 && pageItems.every((item) => selectedIds.has(item.id))

  const resetPagination = useCallback(() => {
    setCursorHistory([null])
    setPageIndex(0)
  }, [])

  function goToNextPage() {
    const cursor = currentQuery.data?.pageInfo.nextCursor
    if (!cursor) return
    setCursorHistory((current) => [...current.slice(0, pageIndex + 1), cursor])
    setPageIndex((current) => current + 1)
    setSelectedIds(new Set())
  }

  function goToPreviousPage() {
    setPageIndex((current) => Math.max(0, current - 1))
    setSelectedIds(new Set())
  }

  function signedInAgent(): string {
    const email = user?.email?.toLowerCase() ?? ''
    if (email.includes('casey')) return 'Casey'
    if (email.includes('gertha')) return 'Gertha'
    if (email.includes('ernest')) return 'Ernest'
    return user?.email ?? 'CRM user'
  }

  function toggleSelected(id: string) {
    setAllMatchingSelection(null)
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setBulkMessage(null)
  }

  function togglePageSelection() {
    setAllMatchingSelection(null)
    setSelectedIds((current) => {
      const next = new Set(current)
      if (pageItemsSelected) pageItems.forEach((item) => next.delete(item.id))
      else pageItems.forEach((item) => next.add(item.id))
      return next
    })
    setBulkMessage(null)
  }

  async function refreshContactScopes() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CONTACT_QUERY_ROOT }),
      queryClient.invalidateQueries({ queryKey: conversationHubQueryKey }),
    ])
  }

  async function handlePrimaryActionResolved() {
    setBulkMessage('Primary next action saved. The opportunity has left this review queue.')
    await refreshContactScopes()
  }

  function handleLeadStatusChanged(update: LeadStatusUpdate) {
    const becameNotLead = isNotLeadOutcome(update.classification, update.station)
    if (becameNotLead) {
      setSelectedId(null)
      setDetailsOpen(false)
    }
    void refreshContactScopes()
  }

  async function applyBulkAction() {
    if (!bulkAction || selectedIds.size === 0 || bulkSaving) return
    if (bulkAction === 'not_lead' && !bulkDeadReason) {
      setBulkMessage('Choose a Not a lead reason before applying the change.')
      return
    }
    if (bulkAction === 'not_lead' && bulkDeadReason === 'other' && !bulkNotes.trim()) {
      setBulkMessage('Add notes when Other is selected.')
      return
    }

    setBulkSaving(true)
    setBulkMessage(null)
    try {
      const actor = signedInAgent()
      const ids = [...selectedIds]
      const requests = ids.map(async (id) => {
        let command: Record<string, unknown>
        if (bulkAction.startsWith('assign:')) {
          const owner = bulkAction.slice('assign:'.length)
          command = { action: 'assign', owner: owner === 'unassigned' ? null : owner }
        } else if (bulkAction === 'classify:lead') {
          command = { action: 'transition', stage: 'contacted' }
        } else if (bulkAction === 'classify:new') {
          command = { action: 'transition', stage: 'new' }
        } else if (bulkAction.startsWith('stage:')) {
          command = { action: 'transition', stage: bulkAction.slice('stage:'.length) }
        } else {
          command = {
            action: 'transition',
            stage: 'dead',
            deadReason: bulkDeadReason,
            deadReasonNotes: bulkNotes.trim() || null,
          }
        }
        const response = await fetch(`/api/leads/${id}/lifecycle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...command, reason: `Bulk change by ${actor}` }),
        })
        const payload = await response.json().catch(() => ({})) as { success?: boolean; error?: string }
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Change failed')
        return id
      })

      const results = await Promise.allSettled(requests)
      const succeeded = results.filter((result) => result.status === 'fulfilled').length
      const failed = results.length - succeeded
      setSelectedIds(new Set())
      setBulkAction('')
      setBulkDeadReason('')
      setBulkNotes('')
      setBulkMessage(failed ? `${succeeded} updated; ${failed} failed. Review the records that remain.` : `${succeeded} contact${succeeded === 1 ? '' : 's'} updated.`)
      await refreshContactScopes()
    } catch (error) {
      setBulkMessage(error instanceof Error ? error.message : 'Bulk changes could not be completed.')
    } finally {
      setBulkSaving(false)
    }
  }

  function clearFilters() {
    resetPagination()
    selectSmartList('all')
    setOwnerFilter('')
    setStageFilter('')
    setMinimumStageFilter('')
    setSourceFilter('')
    setTagFilter('')
    setActivityFilter('')
    setAttentionFilter('')
    setOutreachFilter('')
    setDataGapFilter('')
  }

  function selectSmartList(nextSmartList: ContactSmartList) {
    resetPagination()
    setSmartList(nextSmartList)
    setToolbarMenu(null)
    setSelectedIds(new Set())
    setBulkAction('')
    setBulkMessage(null)
    const params = new URLSearchParams(window.location.search)
    if (nextSmartList === 'all') params.delete('list')
    else params.set('list', nextSmartList)
    const query = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  }

  function persistSmartListOrder(nextOrder: ContactSmartListNavigationId[]) {
    setSmartListOrder(nextOrder)
    try {
      window.localStorage.setItem(CONTACT_SMART_LIST_ORDER_STORAGE_KEY, JSON.stringify(nextOrder))
    } catch { /* storage may be unavailable */ }
  }

  function resetSmartListOrder() {
    persistSmartListOrder([...DEFAULT_CONTACT_SMART_LIST_ORDER])
  }

  function openDialer(contact: ContactWorkspaceRow) {
    if (!contact.phone) return
    window.dispatchEvent(new CustomEvent('open-dialer', { detail: { leadId: contact.id, phone: contact.phone, name: getDisplayLeadName(contact.fullName, contact.phone) } }))
  }

  function openCampaignBuilder() {
    if (!activeAllMatchingSelection && selectedIds.size < 1) return
    const selection = activeAllMatchingSelection ? { mode: 'query' as const, query: activeAllMatchingSelection.query, count: activeAllMatchingSelection.count }
      : { mode: 'ids' as const, leadIds: [...selectedIds], count: selectedIds.size }
    window.sessionStorage.setItem(PROSPECTING_AUDIENCE_STORAGE_KEY, serializeProspectingAudienceSelection(selection))
    router.push(requestedCampaignId ? campaignAudienceReturnHref(requestedCampaignId) : '/prospecting?new=1')
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
    const next = [...savedViews, { id: crypto.randomUUID(), label, owner: ownerFilter, stage: stageFilter, source: sourceFilter, tag: tagFilter, attention: attentionFilter, outreach: outreachFilter }]
    setSavedViews(next)
    window.localStorage.setItem('savingkc-contact-views', JSON.stringify(next))
    setViewName('')
    setDialog(null)
  }

  function applyView(view: SavedView) {
    resetPagination()
    selectSmartList('all')
    setOwnerFilter(view.owner)
    setStageFilter(view.stage)
    setSourceFilter(view.source)
    setTagFilter(view.tag)
    setAttentionFilter(view.attention)
    setOutreachFilter(view.outreach ?? '')
  }

  const hasFilters = Boolean(ownerFilter || stageFilter || minimumStageFilter || sourceFilter || tagFilter || activityFilter || attentionFilter || outreachFilter || dataGapFilter)
    || ['needs_reply', 'overdue', 'unassigned', 'not_leads'].includes(smartList)
  const activeFilterCount = [ownerFilter, stageFilter, minimumStageFilter, sourceFilter, tagFilter, activityFilter, attentionFilter, outreachFilter, dataGapFilter].filter(Boolean).length
    + (['needs_reply', 'overdue', 'unassigned', 'not_leads'].includes(smartList) ? 1 : 0)
  const smartListCopy = CONTACT_SMART_LIST_COPY[smartList]
  const hasCustomSmartListOrder = smartListOrder.some((id, index) => id !== DEFAULT_CONTACT_SMART_LIST_ORDER[index])

  const contactsCommandBar = (
    <div data-testid="contacts-command-header" className="grid min-w-0 grid-cols-[1fr_auto] items-end gap-2 md:grid-cols-[minmax(11rem,1fr)_minmax(13rem,26rem)_auto] md:items-center md:gap-3">
      <div data-header-slot="context" className="min-w-0">
        <p className="crm-eyebrow hidden md:block">{smartList === 'prospects' ? 'Prospecting' : 'Pipeline'}</p>
        <div className="flex items-center gap-2">
          <h1 className="truncate text-xl font-bold tracking-[-0.02em] text-[var(--crm-ink)]">{smartListCopy.label}</h1>
          <span className="rounded-full bg-[var(--crm-info-soft)] px-2 py-0.5 text-xs font-bold text-[var(--crm-info)]">{counts[smartList]}</span>
        </div>
        <p className="hidden truncate text-[11px] text-[var(--crm-text-muted)] sm:block" title={smartListCopy.description}>{smartListCopy.description}</p>
      </div>
      <label data-header-slot="search" className="relative col-span-2 min-w-0 md:col-span-1"><Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--crm-text-muted)]" /><input aria-label="Search contacts" value={search} onChange={(event) => { setSearch(event.target.value); resetPagination() }} placeholder="Search contacts..." className="crm-field h-11 w-full rounded-xl pl-9 pr-3 text-base outline-none md:h-10 md:rounded-lg md:text-sm" /></label>
      <div data-header-slot="actions" className="col-start-2 row-start-1 flex justify-end gap-2 md:col-auto md:row-auto md:justify-start lg:justify-end">
        <button type="button" onClick={() => { setDialogError(null); setDialog('import') }} className="crm-secondary-button hidden h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold sm:flex"><Icon name="upload" />Import</button>
        <button type="button" onClick={() => { setDialogError(null); setDialog('add') }} className="crm-primary-button flex h-11 w-11 items-center justify-center rounded-xl text-sm font-semibold md:h-10 md:w-auto md:gap-2 md:rounded-lg md:px-5"><Icon name="add" /><span className="sr-only md:not-sr-only">Add contact</span></button>
      </div>
    </div>
  )

  return (
    <>
      <WorkspaceChrome needsReply={currentQuery.data ? counts.needs_reply : undefined} commandBar={contactsCommandBar} />
      <main className="flex h-full min-w-0 bg-[var(--crm-canvas)]">
        <section className="min-w-0 flex-1 overflow-y-auto">
          {!isMobile ? <div className="flex items-stretch border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-7">
            {SortableSmartListTabs ? (
              <SortableSmartListTabs
                items={orderedSmartLists}
                order={smartListOrder}
                counts={counts}
                activeId={smartList}
                tones={SMART_LIST_TONES}
                onSelect={selectSmartList}
                onOrderChange={persistSmartListOrder}
              />
            ) : (
              <StaticSmartListTabs
                items={orderedSmartLists}
                counts={counts}
                activeId={smartList}
                tones={SMART_LIST_TONES}
                onSelect={selectSmartList}
                onLoadDragAndDrop={loadSortableSmartListTabs}
              />
            )}
            {hasCustomSmartListOrder ? <button type="button" onClick={resetSmartListOrder} className="ml-2 flex shrink-0 items-center gap-1 border-l border-[var(--crm-border)] px-3 text-xs font-semibold text-[var(--crm-text-muted)] hover:text-[var(--crm-brand)]" aria-label="Reset smart-list order"><Icon name="restart_alt" className="text-[16px]" />Reset order</button> : null}
            <ProspectsWorkspaceTab count={counts.prospects} active={smartList === 'prospects'} onSelect={() => selectSmartList('prospects')} />
          </div> : null}

          {isMobile ? <label className="flex items-center gap-3 border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-2"><span className="text-xs font-bold text-[var(--crm-text-muted)]">View</span><select aria-label="Pipeline view" value={smartList} onChange={(event) => selectSmartList(event.target.value as ContactSmartListNavigationId)} className="crm-field h-10 min-w-0 flex-1 rounded-xl px-3 text-base font-bold">{[...orderedSmartLists, { id: 'prospects' as const, label: 'Prospects' }].map(({ id, label }) => <option key={id} value={id}>{label} ({counts[id]})</option>)}</select></label> : null}

          <div className="px-3 py-3 sm:px-5 lg:px-7">
            {requestedCampaignId ? <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-4 py-3" role="status"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--crm-brand)] text-white"><Icon name="group_add" /></span><div className="min-w-0 flex-1"><p className="text-sm font-black text-[var(--crm-ink)]">Building the audience for {requestedCampaignName || 'your campaign'}</p><p className="mt-0.5 text-xs text-[var(--crm-text-muted)]">Select sellers below. The server will check DNC, phone quality, and lifecycle status before enrollment.</p></div><Link href={`/prospecting?campaign=${encodeURIComponent(requestedCampaignId)}`} className="crm-secondary-button inline-flex h-9 items-center rounded-lg px-3 text-xs font-black">Cancel</Link></div> : null}
            <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
                <button type="button" aria-label="Filters" onClick={() => setToolbarMenu((current) => current === 'filters' ? null : 'filters')} aria-expanded={toolbarMenu === 'filters'} aria-controls="contact-filter-panel" className={`crm-secondary-button flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${activeFilterCount ? 'border-[var(--crm-brand-border)] text-[var(--crm-brand)]' : ''}`}><Icon name="filter_alt" className="text-[16px]" />Filters{activeFilterCount ? <span className="rounded-full bg-[var(--crm-brand)] px-1.5 py-0.5 text-[10px] text-white">{activeFilterCount}</span> : null}</button>
                {toolbarMenu === 'filters' ? <div id="contact-filter-panel" role="dialog" aria-label="Contact filters" className="crm-panel fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 max-h-[70dvh] overflow-y-auto rounded-2xl p-4 shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-11 sm:w-[min(30rem,calc(100vw-3rem))] sm:max-h-none sm:rounded-xl">
                  <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-bold text-[var(--crm-ink)]">Filters</h2><p className="text-xs text-[var(--crm-text-muted)]">Narrow the active smart list without losing table space.</p></div><button type="button" onClick={() => setToolbarMenu(null)} aria-label="Close filters" className="crm-icon-button flex h-8 w-8 items-center justify-center rounded-lg"><Icon name="close" /></button></div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <PipelineFilterSelect label="Lead status" value={smartList === 'not_leads' ? 'not_leads' : ''} onChange={(value) => selectSmartList(value === 'not_leads' ? 'not_leads' : 'all')} options={[["not_leads", "Not a lead"]]} />
                    <PipelineFilterSelect label="Owner" value={ownerFilter} onChange={(value) => { setOwnerFilter(value); resetPagination() }} options={[["__unassigned", "Unassigned"], ...owners.map((value) => [value, value] as [string, string])]} />
                    <PipelineFilterSelect label="Stage" value={stageFilter} onChange={(value) => { setStageFilter(value); resetPagination() }} options={Object.entries(STAGE_LABELS)} />
                    <PipelineFilterSelect label="Minimum stage" value={minimumStageFilter} onChange={(value) => { setMinimumStageFilter(value); resetPagination() }} options={Object.entries(STAGE_LABELS).filter(([value]) => STAGE_RANK[value as DealStage] >= 0)} />
                    <PipelineFilterSelect label="Source" value={sourceFilter} onChange={(value) => { setSourceFilter(value); resetPagination() }} options={sources.map((value) => [value, formatLeadSource(value)])} />
                    <PipelineFilterSelect label="Tags" value={tagFilter} onChange={(value) => { setTagFilter(value); resetPagination() }} options={tags.map((value) => [value, value])} />
                    <PipelineFilterSelect label="Last activity" value={activityFilter} onChange={(value) => { setActivityFilter(value); resetPagination() }} options={[["day", "Past 24 hours"], ["week", "Past 7 days"], ["stale", "More than 7 days"], ["none", "No activity"]]} />
                    <PipelineFilterSelect label="Data quality" value={dataGapFilter} onChange={(value) => { setDataGapFilter(value as DataGap); resetPagination() }} options={[["missing_phone", "Missing phone"], ["missing_email", "Missing email"], ["missing_next_action", "Missing next action"]]} />
                    <PipelineFilterSelect label="Conversation state" value={attentionFilter} onChange={(value) => { setAttentionFilter(value); resetPagination() }} options={[["needs_reply", "Needs reply"], ["waiting_on_contact", "Waiting on contact"], ["resolved", "Resolved"]]} />
                    <PipelineFilterSelect label="Outreach status" value={outreachFilter} onChange={(value) => { setOutreachFilter(value); resetPagination() }} options={[["unattempted", "Unattempted"], ["attempted_no_response", "Attempted — no response"], ["connected_unclassified", "Connected — needs classification"]]} />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--crm-border)] pt-3">
                    {savedViews.map((view) => <button type="button" key={view.id} onClick={() => applyView(view)} className="rounded-full border border-[var(--crm-border)] px-3 py-1.5 text-xs font-semibold hover:border-[var(--crm-brand-border)] hover:text-[var(--crm-brand)]">{view.label}</button>)}
                    <button type="button" onClick={() => { setToolbarMenu(null); setDialog('view') }} className="rounded-full border border-dashed border-[var(--crm-border-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--crm-text-muted)] hover:text-[var(--crm-brand)]">+ Save current view</button>
                    {hasFilters ? <button type="button" onClick={clearFilters} className="ml-auto text-xs font-bold text-[var(--crm-brand)] hover:underline">Clear all</button> : null}
                  </div>
                </div> : null}
              </div>
              <div className="relative hidden sm:block">
                <button type="button" aria-label="Sort" onClick={() => setToolbarMenu((current) => current === 'sort' ? null : 'sort')} aria-expanded={toolbarMenu === 'sort'} aria-controls="contact-sort-panel" className="crm-secondary-button flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold"><Icon name="swap_vert" className="text-[16px]" />Sort</button>
                {toolbarMenu === 'sort' ? <div id="contact-sort-panel" role="dialog" aria-label="Sort contacts" className="crm-panel fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 rounded-2xl p-2 shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-11 sm:w-56 sm:rounded-xl">
                  {([['priority', 'Priority first'], ['recent', 'Recently active'], ['name', 'Name A–Z']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => { setSortBy(value); resetPagination(); setToolbarMenu(null) }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold ${sortBy === value ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'text-[var(--crm-text)] hover:bg-[var(--crm-surface-subtle)]'}`}>{label}{sortBy === value ? <Icon name="check" className="text-[16px]" /> : null}</button>)}
                </div> : null}
              </div>
            <button type="button" onClick={() => void refetch()} aria-label="Refresh contacts" className="crm-icon-button hidden h-9 w-9 items-center justify-center rounded-full sm:flex"><Icon name="refresh" className={isFetching ? 'animate-spin' : ''} /></button>
              {hasFilters ? <button type="button" onClick={clearFilters} className="rounded-full border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--crm-brand)]">Clear ×</button> : null}
              <span className="ml-auto text-sm text-[var(--crm-text-muted)]">{totalResults} results</span>
            </div>

            {dataGapFilter === 'missing_next_action' ? <div className="mt-3 flex flex-col gap-3 rounded-xl border border-[var(--crm-action-border)] bg-[var(--crm-action-soft)] p-4 sm:flex-row sm:items-center" role="status">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--crm-surface)] text-[var(--crm-action)]"><Icon name="rule" /></span>
              <span className="min-w-0"><strong className="block text-sm text-[var(--crm-ink)]">Human next-action review</strong><span className="mt-0.5 block text-xs leading-5 text-[var(--crm-text-muted)]">Resolve each opportunity by choosing a trustworthy operator task or creating one clear, owned, dated action. AI and manifest suggestions stay advisory.</span></span>
            </div> : null}

            {pageItemsSelected && !activeAllMatchingSelection && totalResults > pageItems.length ? <div className="mt-3 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-4 py-2.5 text-xs font-bold text-[var(--crm-ink)]" role="status"><span>All {pageItems.length} contacts on this page are selected.</span>{totalResults <= MAX_PROSPECTING_QUERY_AUDIENCE ? <button type="button" onClick={() => { setSelectedIds(new Set()); setAllMatchingSelection({ query: audienceQuery, count: totalResults }) }} className="font-black text-[var(--crm-brand)] underline underline-offset-2">Select all {totalResults.toLocaleString()} matching contacts</button> : <span className="text-[var(--crm-text-muted)]">Narrow the list to {MAX_PROSPECTING_QUERY_AUDIENCE.toLocaleString()} or fewer to select every match.</span>}</div> : null}

            {activeAllMatchingSelection ? <div className="mt-3 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-[var(--crm-success)]/30 bg-[var(--crm-success-soft)] px-4 py-2.5 text-xs font-bold text-[var(--crm-success)]" role="status"><Icon name="select_all" className="text-base" />All {activeAllMatchingSelection.count.toLocaleString()} matching contacts are selected for this campaign audience.<button type="button" onClick={() => setAllMatchingSelection(null)} className="font-black underline underline-offset-2">Clear</button></div> : null}

            {selectedIds.size > 0 || activeAllMatchingSelection ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] px-3 py-2.5" role="region" aria-label="Bulk contact changes">
              <span className="mr-1 text-sm font-black text-[var(--crm-info)]">{(activeAllMatchingSelection?.count ?? selectedIds.size).toLocaleString()} selected</span>
              <button type="button" onClick={openCampaignBuilder} disabled={bulkSaving} className="crm-primary-button inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-xs font-black"><Icon name="campaign" className="text-[16px]" />{requestedCampaignId ? `Review for ${requestedCampaignName || 'campaign'}` : 'Start campaign'}</button>
              {!activeAllMatchingSelection ? <><select aria-label="Bulk action" value={bulkAction} onChange={(event) => { setBulkAction(event.target.value as BulkAction); setBulkMessage(null) }} className="crm-field h-9 min-w-52 rounded-lg px-3 text-xs font-semibold">
                <option value="">Choose bulk change…</option>
                <optgroup label="Assign owner">
                  <option value="assign:Ernest">Assign to Ernest</option>
                  <option value="assign:Casey">Assign to Casey</option>
                  <option value="assign:Gertha">Assign to Gertha</option>
                  <option value="assign:unassigned">Set unassigned</option>
                </optgroup>
                <optgroup label="Classify intake">
                  {smartList === 'contacted' ? <option value="classify:new">Remove from Pipeline</option> : null}
                  <option value="classify:lead">Add to Leads</option>
                </optgroup>
                <optgroup label="Move stage">
                  {BULK_STAGE_OPTIONS.map((stage) => <option key={stage} value={`stage:${stage}`}>{STAGE_LABELS[stage]}</option>)}
                </optgroup>
                <option value="not_lead">Mark Not a lead…</option>
              </select>
              {bulkAction === 'not_lead' ? <>
                <select aria-label="Not a lead reason" value={bulkDeadReason} onChange={(event) => setBulkDeadReason(event.target.value)} className="crm-field h-9 min-w-60 rounded-lg px-3 text-xs font-semibold"><option value="">Required reason…</option>{DEAD_REASONS.map((reason) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}</select>
                {bulkDeadReason === 'other' ? <input aria-label="Not a lead notes" value={bulkNotes} onChange={(event) => setBulkNotes(event.target.value)} placeholder="Required notes…" className="crm-field h-9 min-w-60 rounded-lg px-3 text-xs" /> : null}
              </> : null}
              <button type="button" onClick={() => void applyBulkAction()} disabled={!bulkAction || bulkSaving || (bulkAction === 'not_lead' && !bulkDeadReason)} className="crm-primary-button h-9 rounded-lg px-4 text-xs font-black disabled:cursor-not-allowed disabled:opacity-45">{bulkSaving ? 'Applying…' : 'Apply'}</button>
              </> : <span className="text-xs font-semibold text-[var(--crm-info)]">Full-result selection is limited to campaign enrollment; CRM bulk edits remain page-scoped.</span>}
              <button type="button" onClick={() => { setSelectedIds(new Set()); setAllMatchingSelection(null); setBulkAction(''); setBulkMessage(null) }} disabled={bulkSaving} className="crm-secondary-button h-9 rounded-lg px-3 text-xs font-bold">Clear selection</button>
            </div> : null}
            {bulkMessage ? <p role="status" className={`mt-2 text-xs font-bold ${bulkMessage.includes('failed') || bulkMessage.includes('Choose') || bulkMessage.includes('notes') ? 'text-[var(--crm-danger)]' : 'text-[var(--crm-success)]'}`}>{bulkMessage}</p> : null}

            {!isMobile ? <div className="crm-panel mt-3 overflow-x-auto rounded-xl">
              <div className="crm-table-header grid min-w-[980px] grid-cols-[2rem_1.15fr_1.15fr_.75fr_1.2fr_.85fr_.85fr_.75fr] items-center border-b px-3 py-3 text-[11px] font-bold uppercase tracking-[0.06em]">
                <input type="checkbox" aria-label="Select contacts on this page" checked={pageItemsSelected} onChange={togglePageSelection} className="h-4 w-4 accent-[var(--crm-brand)]" /><span>Contact</span><span>Property</span><span>Status</span><span>Next Action</span><span>Owner</span><span>Last Activity</span><span>Source</span>
              </div>
              {isLoading ? <ContactsLoadingSkeleton /> : null}
              {error ? <div className="p-8 text-center text-sm text-red-600">Contacts could not be loaded. <button type="button" onClick={() => void refetch()} className="font-bold underline">Try again</button></div> : null}
              {!isLoading && !error && pageItems.length === 0 ? <div className="p-12 text-center text-sm text-[var(--crm-text-muted)]">No contacts match these filters.</div> : null}
              {!isLoading && !error ? pageItems.map((row) => {
                const displayName = getDisplayLeadName(row.fullName, row.phone)
                const property = row.address || 'No property linked'
                const nextAction = dataGapFilter === 'missing_next_action'
                  ? 'Primary action required'
                  : row.primaryNextAction?.title || row.nextActivity?.label || (row.hubEnriched ? 'Define next action' : 'Loading next action…')
                const selectedRow = detailsOpen && selected?.id === row.id
                const notLead = isNotLeadOutcome(row.classification, row.station)
                const pipelineStatus = contactPipelineStatusLabel(row)
                const rowAttention = row.primaryNextAction?.overdue
                  ? 'border-l-[var(--crm-danger)]'
                  : row.attentionState === 'needs_reply'
                    ? 'border-l-[var(--crm-brand)]'
                    : 'border-l-transparent'
                const avatarTone = row.isFavorite || row.attentionState === 'needs_reply'
                  ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'
                  : row.station === 'qualified' || row.station === 'under_contract'
                    ? 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]'
                    : 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'
                return (
                  <div key={row.id} onClick={() => { setSelectedId(row.id); setDetailsOpen(true) }} onDoubleClick={() => router.push(`/leads/${row.id}`)} className={`grid min-w-[980px] w-full cursor-pointer grid-cols-[2rem_1.15fr_1.15fr_.75fr_1.2fr_.85fr_.85fr_.75fr] items-center border-b border-l-4 border-b-[var(--crm-border)] px-3 py-4 text-left text-xs transition-colors last:border-b-0 ${selectedRow ? 'border-l-[var(--crm-action)] bg-[var(--crm-action-soft)]' : `${rowAttention} hover:bg-[var(--crm-surface-subtle)]`}`}>
                    <input type="checkbox" aria-label={`Select ${displayName}`} checked={selectedIds.has(row.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleSelected(row.id)} className="h-4 w-4 accent-[var(--crm-brand)]" />
                    <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(row.id); setDetailsOpen(true) }} onDoubleClick={(event) => { event.stopPropagation(); router.push(`/leads/${row.id}`) }} title="Double-click to open the full lead workspace" className="flex min-w-0 items-center gap-2.5 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--crm-info)]"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-bold ${avatarTone}`}>{getAvatarLabel(row.fullName, row.phone, row.source)}</span><span className="min-w-0"><strong className="block truncate text-[var(--crm-ink)]">{displayName}</strong><small className="text-[var(--crm-text-muted)]">{formatPhone(row.phone) || 'No phone'}</small></span></button>
                    <span className="min-w-0"><strong className="block truncate font-medium text-[var(--crm-text)]">{property}</strong><small className="text-[var(--crm-text-dim)]">{row.city || ''}</small></span>
                    <span className="min-w-0">
                      <span className={`inline-flex rounded-md border px-2 py-1 font-semibold ${notLead ? 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : row.classification ? 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : 'border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] text-[var(--crm-info)]'}`}>{pipelineStatus}</span>
                      <small className={`mt-1 block truncate text-[10px] ${notLead && !row.deadReason ? 'font-bold text-[var(--crm-danger)]' : 'text-[var(--crm-text-muted)]'}`}>{notLead ? deadReasonLabel(row.deadReason) || 'Reason required' : row.classification === null ? outreachStatusLabel(row.outreachStatus) : STAGE_LABELS[row.station]}</small>
                    </span>
                    {dataGapFilter === 'missing_next_action' ? <button type="button" onClick={(event) => { event.stopPropagation(); setPrimaryReviewContact(row) }} className="flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--crm-action-border)] bg-[var(--crm-surface)] px-2 text-left font-black text-[var(--crm-action)] hover:brightness-95"><Icon name="rule" className="shrink-0 text-[15px]" /><span>{nextAction}</span></button> : <span className={`flex items-start gap-1.5 ${row.primaryNextAction?.overdue ? 'font-bold text-[var(--crm-danger)]' : 'font-semibold text-[var(--crm-action)]'}`}><Icon name={row.primaryNextAction?.overdue ? 'error' : 'schedule'} className="mt-[-1px] shrink-0 text-[15px]" />{nextAction}</span>}
                    <span>{row.owner || 'Unassigned'}</span><span className="text-[var(--crm-text-muted)]">{formatRelativeDate(row.lastActivityAt)}</span><span className="text-[var(--crm-text-muted)]">{formatLeadSource(row.source)}</span>
                  </div>
                )
              }) : null}
            </div> : null}
            {isMobile ? <>
              {isLoading ? <ContactsLoadingSkeleton mobile /> : null}
              {error ? <div className="crm-panel rounded-xl p-6 text-center text-sm text-[var(--crm-danger)]">Contacts could not be loaded. <button type="button" onClick={() => void refetch()} className="font-bold underline">Try again</button></div> : null}
              {!isLoading && !error && pageItems.length === 0 ? <div className="crm-panel rounded-xl p-8 text-center text-sm text-[var(--crm-text-muted)]">No contacts match these filters.</div> : null}
              {!isLoading && !error ? <MobileContactsList items={pageItems} selectedIds={selectedIds} onToggle={toggleSelected} onOpen={(id) => router.push(`/leads/${id}`)} onCall={openDialer} onReviewPrimary={dataGapFilter === 'missing_next_action' ? setPrimaryReviewContact : undefined} /> : null}
            </> : null}
            <div className="mt-5 flex flex-col gap-3 text-xs text-[var(--crm-text-muted)] sm:flex-row sm:items-center md:mt-7">
              <span>Showing {pageItems.length ? pageIndex * CONTACT_PAGE_SIZE + 1 : 0} to {Math.min(pageIndex * CONTACT_PAGE_SIZE + pageItems.length, totalResults)} of {totalResults} results</span>
              <div className="flex items-center gap-2 sm:ml-auto">
                <button type="button" disabled={pageIndex === 0 || isFetching} onClick={goToPreviousPage} className="h-8 rounded border border-[var(--crm-border)] px-3 font-semibold disabled:opacity-40" aria-label="Previous page">Previous</button>
                <span aria-live="polite">Page {currentPage} of {pageCount}</span>
                <button type="button" disabled={!currentQuery.data?.pageInfo.hasMore || isFetching} onClick={goToNextPage} className="h-8 rounded border border-[var(--crm-border)] px-3 font-semibold disabled:opacity-40" aria-label="Next page">Next</button>
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
            <div className="mt-5">
              <LeadStatusControl
                leadId={selected.id}
                classification={selected.classification}
                station={selected.station}
                deadReason={selected.deadReason}
                agent={selected.owner}
                onChanged={handleLeadStatusChanged}
                variant="panel"
              />
            </div>
            <div className="crm-panel mt-6 rounded-xl p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><Icon name="trending_up" className="text-[18px] text-[var(--crm-success)]" />Opportunity</h3><dl className="mt-4 space-y-3 text-xs"><div className="flex justify-between"><dt>Stage</dt><dd className={`rounded-md border px-2 py-1 font-semibold ${STAGE_TONES[selected.station]}`}>{STAGE_LABELS[selected.station]}</dd></div><div className="flex justify-between"><dt>Motivation</dt><dd className="rounded-full bg-[var(--crm-violet-soft)] px-2 py-0.5 font-black text-[var(--crm-violet)]">{selected.score} / 100</dd></div></dl></div>
            <div className="mt-5 rounded-xl border border-[var(--crm-action-border)] border-l-4 border-l-[var(--crm-action)] bg-[var(--crm-action-soft)] p-4"><h3 className="flex items-center gap-2 text-sm font-bold text-[var(--crm-action)]"><Icon name="bolt" className="text-[18px]" />Next action</h3><p className="mt-3 flex items-start gap-2 text-xs font-semibold leading-5 text-[var(--crm-ink)]"><Icon name="schedule" className="mt-0.5 text-[var(--crm-action)]" />{dataGapFilter === 'missing_next_action' ? 'Primary action required' : selected.primaryNextAction?.title || selected.nextActivity?.label || (selected.hubEnriched ? 'Define next action' : 'Loading next action…')}</p>{dataGapFilter === 'missing_next_action' ? <button type="button" onClick={() => setPrimaryReviewContact(selected)} className="crm-primary-button mt-3 h-9 w-full rounded-lg text-xs font-black">Review and resolve</button> : null}</div>
            <div className="mt-5 border-t border-[var(--crm-border)] pt-5"><h3 className="flex items-center gap-2 text-sm font-bold"><Icon name="forum" className="text-[18px] text-[var(--crm-info)]" />Recent conversation</h3><p className="mt-3 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-info-soft)] p-3 text-xs leading-5 text-[var(--crm-text)]">{selected.lastMessage || 'No recent message'}</p></div>
            <div className="mt-6 border-t border-[var(--crm-border)] pt-5"><h3 className="text-sm font-bold">Contact details</h3><p className="mt-3 text-sm text-[var(--crm-text-muted)]">{formatPhone(selected.phone) || 'No phone'}</p><p className="mt-2 break-all text-sm text-[var(--crm-text-muted)]">{selected.email || 'No email'}</p><p className="mt-2 text-sm text-[var(--crm-text-muted)]">Owner: {selected.owner || 'Unassigned'}</p></div>
            <Link href={`/leads/${selected.id}`} className="crm-primary-button mt-7 flex h-11 items-center justify-center rounded-lg text-sm font-bold">Open full workspace →</Link>
          </> : <p className="text-sm text-[var(--crm-text-dim)]">Select a contact</p>}
        </aside> : null}
      </main>

      {dialog ? <PipelineModal title={dialog === 'add' ? 'Add contact' : dialog === 'import' ? 'Import contacts' : 'Save current view'} onClose={() => { if (!saving) setDialog(null) }}>
        {dialog === 'add' ? <form onSubmit={submitAddContact} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">{Object.entries({ fullName: 'Full name', phone: 'Phone', email: 'Email', address: 'Property address', city: 'City', state: 'State', zip: 'ZIP', source: 'Source' }).map(([key, label]) => <label key={key} className={key === 'address' ? 'sm:col-span-2' : ''}><span className="mb-1 block text-xs font-bold text-[var(--ck-text-muted)]">{label}</span><input type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} value={contactForm[key as keyof typeof contactForm]} onChange={(event) => setContactForm((current) => ({ ...current, [key]: event.target.value }))} className="h-10 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-sm text-[var(--ck-text)] outline-none focus:border-[var(--ck-accent)]" /></label>)}</div>
          {dialogError ? <p className="text-sm font-semibold text-[var(--ck-accent)]">{dialogError}</p> : null}
          <PipelineModalActions saving={saving} submitLabel="Create contact" onCancel={() => setDialog(null)} />
        </form> : null}
        {dialog === 'import' ? <div className="space-y-4">
          <p className="text-sm leading-6 text-[var(--ck-text-muted)]">Upload a CSV with any of these columns: name, phone, email, address, city, state, ZIP, or source.</p>
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[var(--ck-border-strong)] bg-[var(--ck-surface-elev)] text-sm font-semibold text-[var(--ck-text-muted)] hover:border-[var(--ck-accent)]"><Icon name="upload_file" className="mb-2 text-[28px] text-[var(--ck-accent)]" />Choose CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setCsvRows(parseCsv(await file.text())) }} /></label>
          {csvRows.length ? <p className="rounded-md bg-[var(--ck-surface-elev)] p-3 text-sm font-semibold text-[var(--ck-accent)]">{csvRows.length} contact{csvRows.length === 1 ? '' : 's'} ready to import.</p> : null}
          {dialogError ? <p className="text-sm font-semibold text-[var(--ck-accent)]">{dialogError}</p> : null}
          <div className="flex gap-3"><button type="button" disabled={saving} onClick={() => setDialog(null)} className="h-10 flex-1 rounded-lg border border-[var(--ck-border-strong)] text-sm font-bold">Cancel</button><button type="button" disabled={saving || !csvRows.length} onClick={() => void submitImport()} className="h-10 flex-1 rounded-lg bg-[var(--ck-accent)] text-sm font-bold text-white disabled:opacity-50">{saving ? 'Importing…' : 'Import contacts'}</button></div>
        </div> : null}
        {dialog === 'view' ? <form onSubmit={saveView} className="space-y-4"><p className="text-sm leading-6 text-[var(--ck-text-muted)]">Save the current owner, stage, source, tag, and attention filters as a reusable view.</p><label><span className="mb-1 block text-xs font-bold text-[var(--ck-text-muted)]">View name</span><input autoFocus value={viewName} onChange={(event) => setViewName(event.target.value)} className="h-10 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-sm text-[var(--ck-text)] outline-none focus:border-[var(--ck-accent)]" /></label><PipelineModalActions saving={false} submitLabel="Save view" onCancel={() => setDialog(null)} /></form> : null}
      </PipelineModal> : null}
      {primaryReviewContact ? <PrimaryNextActionReviewDialog leadId={primaryReviewContact.id} contactName={getDisplayLeadName(primaryReviewContact.fullName, primaryReviewContact.phone)} onClose={() => setPrimaryReviewContact(null)} onResolved={handlePrimaryActionResolved} /> : null}
    </>
  )
}

function StaticSmartListTabs({
  items,
  counts,
  activeId,
  tones,
  onSelect,
  onLoadDragAndDrop,
}: Omit<SortableSmartListTabsProps, 'order' | 'onOrderChange'> & { onLoadDragAndDrop: () => void }) {
  return (
    <nav
      className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto"
      aria-label="Pipeline smart lists"
      onPointerEnter={onLoadDragAndDrop}
      onFocusCapture={onLoadDragAndDrop}
      onTouchStart={onLoadDragAndDrop}
    >
      {items.map(({ id, label }) => {
        const active = activeId === id
        const tone = tones[id]
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-label={`${label} ${counts[id]}`}
            aria-current={active ? 'page' : undefined}
            title={`Open ${label}. Drag the tab itself to reorder.`}
            className={`shrink-0 touch-none border-b-[3px] px-3 py-3 text-sm font-semibold transition-colors ${active ? tone.active : 'border-transparent text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]'} cursor-grab`}
          >
            {label}{' '}
            <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${active ? tone.count : 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'}`}>
              {counts[id]}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
