'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Icon } from '@/components/ui/icon'
import { formatLeadSource, getAvatarLabel, getDisplayLeadName, outreachStatusLabel, type OutreachStatus } from '@/lib/contact-display'
import { formatPhone } from '@/lib/format'
import type { ContactSignal } from '@/lib/contact-display'
import type { DealStage } from '@/types/pipeline'
import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { LeadStatusControl, type LeadStatusUpdate } from '@/components/leads/lead-status-control'
import { PipelineFilterSelect, PipelineModal, PipelineModalActions } from '@/components/pipeline/pipeline-controls'
import { DEAD_REASONS, deadReasonLabel, isNotLeadOutcome } from '@/lib/lead-outcomes'
import { useAuth } from '@/hooks/use-auth'
import { conversationHubQueryKey, conversationHubStaleTime, fetchConversationHub } from '@/lib/queries/conversation-hub'
import {
  CONTACT_SMART_LIST_COPY,
  CONTACT_SMART_LIST_ORDER_STORAGE_KEY,
  CONTACT_SMART_LISTS,
  DEFAULT_CONTACT_SMART_LIST_ORDER,
  contactMatchesSmartList,
  contactPipelineStatusLabel,
  contactSmartListCounts,
  normalizeContactSmartListOrder,
  type ContactSmartList,
  type ContactSmartListNavigationId,
} from '@/lib/contact-smart-lists'

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

type DataGap = '' | 'missing_phone' | 'missing_email' | 'missing_next_action'
type ContactDialog = 'add' | 'import' | 'view' | null
type ToolbarMenu = 'filters' | 'sort' | null
type ContactScope = 'active' | 'not_leads'
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

const SMART_LISTS = new Set<ContactSmartList>(Object.keys(CONTACT_SMART_LIST_COPY) as ContactSmartList[])
const DATA_GAPS = new Set<DataGap>(['', 'missing_phone', 'missing_email', 'missing_next_action'])

const SMART_LIST_TONES: Record<ContactSmartList, { active: string; count: string }> = {
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
const CONTACT_QUERY_KEY = (scope: ContactScope) => ['contact-workspace', scope] as const
const BULK_STAGE_OPTIONS: DealStage[] = ['qualified', 'appointment_set', 'offer_made', 'under_contract']

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

function useContactWorkspace(scope: ContactScope, enabled = true) {
  const queryClient = useQueryClient()
  return useQuery<{ items: ContactWorkspaceRow[] }>({
    queryKey: CONTACT_QUERY_KEY(scope),
    queryFn: async () => {
      const [contactsResponse, hubResponse] = await Promise.all([
        fetch(`/api/contacts?scope=${scope}`, { cache: 'no-store' }),
        queryClient.fetchQuery({
          queryKey: conversationHubQueryKey,
          queryFn: () => fetchConversationHub<HubThread>(),
          staleTime: conversationHubStaleTime,
        }),
      ])
      if (!contactsResponse.ok) throw new Error('Contacts could not be loaded')
      const contactsPayload = await contactsResponse.json() as { items?: ContactRow[] }
      const hubByLead = new Map(hubResponse.items.map((thread) => [thread.id, thread]))
      return {
        items: (contactsPayload.items ?? []).map((contact) => {
          const thread = hubByLead.get(contact.id)
          return {
            ...contact,
            attentionState: thread?.attentionState ?? 'resolved',
            owner: thread?.owner ?? contact.owner ?? null,
            lastMessage: thread?.lastMessage ?? null,
            lastActivityAt: thread?.lastActivityAt ?? contact.lastContactAt,
            primaryNextAction: thread?.primaryNextAction ?? null,
          }
        }),
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled,
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
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [smartList, setSmartList] = useState<ContactSmartList>('contacted')
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
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState<ContactDialog>(null)
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT)
  const [viewName, setViewName] = useState('')
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])
  const [saving, setSaving] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [toolbarMenu, setToolbarMenu] = useState<ToolbarMenu>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkAction, setBulkAction] = useState<BulkAction>('')
  const [bulkDeadReason, setBulkDeadReason] = useState('')
  const [bulkNotes, setBulkNotes] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)
  const activeQuery = useContactWorkspace('active')
  const archiveQuery = useContactWorkspace('not_leads', smartList === 'not_leads')
  const currentQuery = smartList === 'not_leads' ? archiveQuery : activeQuery
  const items = useMemo(() => currentQuery.data?.items ?? [], [currentQuery.data])
  const allKnownItems = useMemo(
    () => [...(activeQuery.data?.items ?? []), ...(archiveQuery.data?.items ?? [])],
    [activeQuery.data, archiveQuery.data],
  )
  const { isLoading, error, refetch, isFetching } = currentQuery
  const smartListSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

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
    const requestedList = params.get('list') as ContactSmartList | null
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
    const requestedOutreach = params.get('outreach')
    if (requestedOutreach && ['unattempted', 'attempted_no_response', 'connected_unclassified'].includes(requestedOutreach)) setOutreachFilter(requestedOutreach)
  }, [])

  const counts = useMemo(() => contactSmartListCounts(allKnownItems), [allKnownItems])
  const orderedSmartLists = useMemo(() => {
    const smartListsById = new Map(CONTACT_SMART_LISTS.map((item) => [item.id, item]))
    return smartListOrder.map((id) => smartListsById.get(id)).filter((item): item is (typeof CONTACT_SMART_LISTS)[number] => Boolean(item))
  }, [smartListOrder])

  const owners = useMemo(() => [...new Set(items.map((item) => item.owner).filter((value): value is string => Boolean(value)))].sort(), [items])
  const sources = useMemo(() => [...new Set(items.map((item) => item.source).filter((value): value is string => Boolean(value)))].sort(), [items])
  const tags = useMemo(() => [...new Set(items.flatMap((item) => item.tags))].sort(), [items])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return items.filter((item) => {
      if (!contactMatchesSmartList(item, smartList)) return false
      if (ownerFilter === '__unassigned' ? item.owner : ownerFilter && item.owner !== ownerFilter) return false
      if (stageFilter && item.station !== stageFilter) return false
      if (minimumStageFilter && STAGE_RANK[item.station] < STAGE_RANK[minimumStageFilter as DealStage]) return false
      if (sourceFilter && item.source !== sourceFilter) return false
      if (tagFilter && !item.tags.includes(tagFilter)) return false
      if (attentionFilter && item.attentionState !== attentionFilter) return false
      if (outreachFilter && item.outreachStatus !== outreachFilter) return false
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
      return [item.fullName, item.phone, item.email, item.address, item.city, item.owner, item.source, deadReasonLabel(item.deadReason)].some((value) => value?.toLowerCase().includes(needle))
    }).sort((a, b) => {
      if (sortBy === 'name') return getDisplayLeadName(a.fullName, a.phone).localeCompare(getDisplayLeadName(b.fullName, b.phone))
      if (sortBy === 'recent') return new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime()
      const attentionRank = (item: ContactWorkspaceRow) => item.attentionState === 'needs_reply' ? 0 : item.primaryNextAction?.overdue ? 1 : 2
      return attentionRank(a) - attentionRank(b) || b.score - a.score
    })
  }, [activityFilter, attentionFilter, dataGapFilter, items, minimumStageFilter, outreachFilter, ownerFilter, search, smartList, sortBy, sourceFilter, stageFilter, tagFilter])

  useEffect(() => setPage(1), [activityFilter, attentionFilter, dataGapFilter, minimumStageFilter, outreachFilter, ownerFilter, search, smartList, sortBy, sourceFilter, stageFilter, tagFilter])

  useEffect(() => {
    setSelectedIds((current) => {
      const visibleIds = new Set(items.map((item) => item.id))
      const next = new Set([...current].filter((id) => visibleIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [items])

  const pageSize = 10
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageItems = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const paginationStart = Math.min(Math.max(1, currentPage - 2), Math.max(1, pageCount - 4))
  const paginationPages = Array.from({ length: Math.min(pageCount, 5) }, (_, index) => paginationStart + index)
  const selected = items.find((item) => item.id === selectedId) ?? pageItems[0] ?? null
  const pageItemsSelected = pageItems.length > 0 && pageItems.every((item) => selectedIds.has(item.id))

  function signedInAgent(): string {
    const email = user?.email?.toLowerCase() ?? ''
    if (email.includes('casey')) return 'Casey'
    if (email.includes('gertha')) return 'Gertha'
    if (email.includes('ernest')) return 'Ernest'
    return user?.email ?? 'CRM user'
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setBulkMessage(null)
  }

  function togglePageSelection() {
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
      queryClient.invalidateQueries({ queryKey: CONTACT_QUERY_KEY('active') }),
      queryClient.invalidateQueries({ queryKey: CONTACT_QUERY_KEY('not_leads') }),
      queryClient.invalidateQueries({ queryKey: conversationHubQueryKey }),
    ])
  }

  function handleLeadStatusChanged(id: string, update: LeadStatusUpdate) {
    const becameNotLead = isNotLeadOutcome(update.classification, update.station)
    queryClient.setQueryData<{ items: ContactWorkspaceRow[] }>(CONTACT_QUERY_KEY('active'), (current) => ({
      items: becameNotLead
        ? (current?.items ?? []).filter((item) => item.id !== id)
        : (current?.items ?? []).map((item) => item.id === id ? { ...item, classification: update.classification, station: (update.station as DealStage | null) ?? item.station, deadReason: update.dead_reason } : item),
    }))
    queryClient.setQueryData<{ items: ContactWorkspaceRow[] }>(CONTACT_QUERY_KEY('not_leads'), (current) => ({
      items: becameNotLead
        ? (current?.items ?? [])
        : (current?.items ?? []).filter((item) => item.id !== id),
    }))
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
        let fields: Record<string, unknown>
        if (bulkAction.startsWith('assign:')) {
          const owner = bulkAction.slice('assign:'.length)
          fields = { assigned_agent: owner === 'unassigned' ? null : owner }
        } else if (bulkAction === 'classify:lead') {
          fields = { classification: 'lead', station: 'contacted', priority: 'warm' }
        } else if (bulkAction === 'classify:new') {
          fields = { classification: null, station: 'new', priority: 'warm', opportunity_score: 0, dead_reason: null, dead_at: null, dead_by: null }
        } else if (bulkAction.startsWith('stage:')) {
          fields = { station: bulkAction.slice('stage:'.length) }
        } else {
          fields = {
            classification: 'dead',
            station: 'dead',
            priority: 'cold',
            opportunity_score: 0,
            deadReason: bulkDeadReason,
            deadReasonNotes: bulkNotes.trim() || null,
          }
        }
        const response = await fetch('/api/leads', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, actor, ...fields }),
        })
        const payload = await response.json().catch(() => ({})) as { success?: boolean; error?: string }
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Change failed')
        return id
      })

      const results = await Promise.allSettled(requests)
      const succeeded = results.filter((result) => result.status === 'fulfilled').length
      const failed = results.length - succeeded
      if (bulkAction === 'not_lead' && succeeded) {
        const succeededIds = new Set(results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []))
        queryClient.setQueryData<{ items: ContactWorkspaceRow[] }>(CONTACT_QUERY_KEY('active'), (current) => ({
          items: (current?.items ?? []).filter((item) => !succeededIds.has(item.id)),
        }))
      }
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

  function handleSmartListDragEnd(event: DragEndEvent) {
    const activeId = event.active.id as ContactSmartListNavigationId
    const overId = event.over?.id as ContactSmartListNavigationId | undefined
    if (!overId || activeId === overId) return

    const currentIndex = smartListOrder.indexOf(activeId)
    const nextIndex = smartListOrder.indexOf(overId)
    if (currentIndex === -1 || nextIndex === -1) return
    persistSmartListOrder(arrayMove(smartListOrder, currentIndex, nextIndex))
  }

  function resetSmartListOrder() {
    persistSmartListOrder([...DEFAULT_CONTACT_SMART_LIST_ORDER])
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
    const next = [...savedViews, { id: crypto.randomUUID(), label, owner: ownerFilter, stage: stageFilter, source: sourceFilter, tag: tagFilter, attention: attentionFilter, outreach: outreachFilter }]
    setSavedViews(next)
    window.localStorage.setItem('savingkc-contact-views', JSON.stringify(next))
    setViewName('')
    setDialog(null)
  }

  function applyView(view: SavedView) {
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
    <div data-testid="contacts-command-header" className="grid min-w-0 items-center gap-3 lg:grid-cols-[minmax(11rem,1fr)_minmax(13rem,26rem)_auto]">
      <div data-header-slot="context" className="min-w-0">
        <p className="crm-eyebrow">Pipeline</p>
        <div className="flex items-center gap-2">
          <h1 className="truncate text-xl font-bold tracking-[-0.02em] text-[var(--crm-ink)]">{smartListCopy.label}</h1>
          <span className="rounded-full bg-[var(--crm-info-soft)] px-2 py-0.5 text-xs font-bold text-[var(--crm-info)]">{counts[smartList]}</span>
        </div>
        <p className="truncate text-[11px] text-[var(--crm-text-muted)]" title={smartListCopy.description}>{smartListCopy.description}</p>
      </div>
      <label data-header-slot="search" className="relative min-w-0"><Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--crm-text-muted)]" /><input aria-label="Search contacts" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contacts..." className="crm-field h-10 w-full rounded-lg pl-9 pr-3 text-sm outline-none" /></label>
      <div data-header-slot="actions" className="flex justify-start gap-2 lg:justify-end">
        <button type="button" onClick={() => { setDialogError(null); setDialog('import') }} className="crm-secondary-button flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold"><Icon name="upload" />Import</button>
        <button type="button" onClick={() => { setDialogError(null); setDialog('add') }} className="crm-primary-button flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-semibold"><Icon name="add" />Add contact</button>
      </div>
    </div>
  )

  return (
    <>
      <WorkspaceChrome needsReply={counts.needs_reply} commandBar={contactsCommandBar} />
      <main className="flex h-full min-w-0 bg-[var(--crm-canvas)]">
        <section className="min-w-0 flex-1 overflow-y-auto">
          <div className="flex items-stretch border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-7">
            <DndContext sensors={smartListSensors} collisionDetection={closestCenter} onDragEnd={handleSmartListDragEnd}>
              <SortableContext items={smartListOrder} strategy={horizontalListSortingStrategy}>
                <nav className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto" aria-label="Pipeline smart lists">
                  {orderedSmartLists.map(({ id, label }) => (
                    <SortableSmartListTab
                      key={id}
                      id={id}
                      label={label}
                      count={counts[id]}
                      active={smartList === id}
                      tone={SMART_LIST_TONES[id]}
                      onSelect={() => selectSmartList(id)}
                    />
                  ))}
                </nav>
              </SortableContext>
            </DndContext>
            {hasCustomSmartListOrder ? <button type="button" onClick={resetSmartListOrder} className="ml-2 flex shrink-0 items-center gap-1 border-l border-[var(--crm-border)] px-3 text-xs font-semibold text-[var(--crm-text-muted)] hover:text-[var(--crm-brand)]" aria-label="Reset smart-list order"><Icon name="restart_alt" className="text-[16px]" />Reset order</button> : null}
          </div>

          <div className="px-7 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <button type="button" aria-label="Filters" onClick={() => setToolbarMenu((current) => current === 'filters' ? null : 'filters')} aria-expanded={toolbarMenu === 'filters'} aria-controls="contact-filter-panel" className={`crm-secondary-button flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${activeFilterCount ? 'border-[var(--crm-brand-border)] text-[var(--crm-brand)]' : ''}`}><Icon name="filter_alt" className="text-[16px]" />Filters{activeFilterCount ? <span className="rounded-full bg-[var(--crm-brand)] px-1.5 py-0.5 text-[10px] text-white">{activeFilterCount}</span> : null}</button>
                {toolbarMenu === 'filters' ? <div id="contact-filter-panel" role="dialog" aria-label="Contact filters" className="crm-panel absolute left-0 top-11 z-40 w-[min(30rem,calc(100vw-3rem))] rounded-xl p-4 shadow-xl">
                  <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-bold text-[var(--crm-ink)]">Filters</h2><p className="text-xs text-[var(--crm-text-muted)]">Narrow the active smart list without losing table space.</p></div><button type="button" onClick={() => setToolbarMenu(null)} aria-label="Close filters" className="crm-icon-button flex h-8 w-8 items-center justify-center rounded-lg"><Icon name="close" /></button></div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <PipelineFilterSelect label="Lead status" value={smartList === 'not_leads' ? 'not_leads' : ''} onChange={(value) => selectSmartList(value === 'not_leads' ? 'not_leads' : 'all')} options={[["not_leads", "Not a lead"]]} />
                    <PipelineFilterSelect label="Owner" value={ownerFilter} onChange={setOwnerFilter} options={[["__unassigned", "Unassigned"], ...owners.map((value) => [value, value] as [string, string])]} />
                    <PipelineFilterSelect label="Stage" value={stageFilter} onChange={setStageFilter} options={Object.entries(STAGE_LABELS)} />
                    <PipelineFilterSelect label="Minimum stage" value={minimumStageFilter} onChange={setMinimumStageFilter} options={Object.entries(STAGE_LABELS).filter(([value]) => STAGE_RANK[value as DealStage] >= 0)} />
                    <PipelineFilterSelect label="Source" value={sourceFilter} onChange={setSourceFilter} options={sources.map((value) => [value, formatLeadSource(value)])} />
                    <PipelineFilterSelect label="Tags" value={tagFilter} onChange={setTagFilter} options={tags.map((value) => [value, value])} />
                    <PipelineFilterSelect label="Last activity" value={activityFilter} onChange={setActivityFilter} options={[["day", "Past 24 hours"], ["week", "Past 7 days"], ["stale", "More than 7 days"], ["none", "No activity"]]} />
                    <PipelineFilterSelect label="Data quality" value={dataGapFilter} onChange={(value) => setDataGapFilter(value as DataGap)} options={[["missing_phone", "Missing phone"], ["missing_email", "Missing email"], ["missing_next_action", "Missing next action"]]} />
                    <PipelineFilterSelect label="Conversation state" value={attentionFilter} onChange={setAttentionFilter} options={[["needs_reply", "Needs reply"], ["waiting_on_contact", "Waiting on contact"], ["resolved", "Resolved"]]} />
                    <PipelineFilterSelect label="Outreach status" value={outreachFilter} onChange={setOutreachFilter} options={[["unattempted", "Unattempted"], ["attempted_no_response", "Attempted — no response"], ["connected_unclassified", "Connected — needs classification"]]} />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--crm-border)] pt-3">
                    {savedViews.map((view) => <button type="button" key={view.id} onClick={() => applyView(view)} className="rounded-full border border-[var(--crm-border)] px-3 py-1.5 text-xs font-semibold hover:border-[var(--crm-brand-border)] hover:text-[var(--crm-brand)]">{view.label}</button>)}
                    <button type="button" onClick={() => { setToolbarMenu(null); setDialog('view') }} className="rounded-full border border-dashed border-[var(--crm-border-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--crm-text-muted)] hover:text-[var(--crm-brand)]">+ Save current view</button>
                    {hasFilters ? <button type="button" onClick={clearFilters} className="ml-auto text-xs font-bold text-[var(--crm-brand)] hover:underline">Clear all</button> : null}
                  </div>
                </div> : null}
              </div>
              <div className="relative">
                <button type="button" aria-label="Sort" onClick={() => setToolbarMenu((current) => current === 'sort' ? null : 'sort')} aria-expanded={toolbarMenu === 'sort'} aria-controls="contact-sort-panel" className="crm-secondary-button flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold"><Icon name="swap_vert" className="text-[16px]" />Sort</button>
                {toolbarMenu === 'sort' ? <div id="contact-sort-panel" role="dialog" aria-label="Sort contacts" className="crm-panel absolute left-0 top-11 z-40 w-56 rounded-xl p-2 shadow-xl">
                  {([['priority', 'Priority first'], ['recent', 'Recently active'], ['name', 'Name A–Z']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => { setSortBy(value); setToolbarMenu(null) }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold ${sortBy === value ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'text-[var(--crm-text)] hover:bg-[var(--crm-surface-subtle)]'}`}>{label}{sortBy === value ? <Icon name="check" className="text-[16px]" /> : null}</button>)}
                </div> : null}
              </div>
              <button type="button" onClick={() => void refetch()} aria-label="Refresh contacts" className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-full"><Icon name="refresh" className={isFetching ? 'animate-spin' : ''} /></button>
              {hasFilters ? <button type="button" onClick={clearFilters} className="rounded-full border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--crm-brand)]">Clear ×</button> : null}
              <span className="ml-auto text-sm text-[var(--crm-text-muted)]">{visible.length} results</span>
            </div>

            {selectedIds.size > 0 ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] px-3 py-2.5" role="region" aria-label="Bulk contact changes">
              <span className="mr-1 text-sm font-black text-[var(--crm-info)]">{selectedIds.size} selected</span>
              {selectedIds.size < visible.length ? <button type="button" onClick={() => setSelectedIds(new Set(visible.map((item) => item.id)))} className="rounded-lg border border-[var(--crm-info-border)] bg-[var(--crm-surface)] px-3 py-2 text-xs font-bold text-[var(--crm-info)]">Select all {visible.length} results</button> : null}
              <select aria-label="Bulk action" value={bulkAction} onChange={(event) => { setBulkAction(event.target.value as BulkAction); setBulkMessage(null) }} className="crm-field h-9 min-w-52 rounded-lg px-3 text-xs font-semibold">
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
              <button type="button" onClick={() => { setSelectedIds(new Set()); setBulkAction(''); setBulkMessage(null) }} disabled={bulkSaving} className="crm-secondary-button h-9 rounded-lg px-3 text-xs font-bold">Clear selection</button>
            </div> : null}
            {bulkMessage ? <p role="status" className={`mt-2 text-xs font-bold ${bulkMessage.includes('failed') || bulkMessage.includes('Choose') || bulkMessage.includes('notes') ? 'text-[var(--crm-danger)]' : 'text-[var(--crm-success)]'}`}>{bulkMessage}</p> : null}

            <div className="crm-panel mt-3 overflow-x-auto rounded-xl">
              <div className="crm-table-header grid min-w-[980px] grid-cols-[2rem_1.15fr_1.15fr_.75fr_1.2fr_.85fr_.85fr_.75fr] items-center border-b px-3 py-3 text-[11px] font-bold uppercase tracking-[0.06em]">
                <input type="checkbox" aria-label="Select contacts on this page" checked={pageItemsSelected} onChange={togglePageSelection} className="h-4 w-4 accent-[var(--crm-brand)]" /><span>Contact</span><span>Property</span><span>Status</span><span>Next Action</span><span>Owner</span><span>Last Activity</span><span>Source</span>
              </div>
              {isLoading ? <ContactSkeleton /> : null}
              {error ? <div className="p-8 text-center text-sm text-red-600">Contacts could not be loaded. <button type="button" onClick={() => void refetch()} className="font-bold underline">Try again</button></div> : null}
              {!isLoading && !error && pageItems.length === 0 ? <div className="p-12 text-center text-sm text-[var(--crm-text-muted)]">No contacts match these filters.</div> : null}
              {!isLoading && !error ? pageItems.map((row) => {
                const displayName = getDisplayLeadName(row.fullName, row.phone)
                const property = row.address || 'No property linked'
                const nextAction = row.primaryNextAction?.title || row.nextActivity?.label || 'Define next action'
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
                    <span className={`flex items-start gap-1.5 ${row.primaryNextAction?.overdue ? 'font-bold text-[var(--crm-danger)]' : 'font-semibold text-[var(--crm-action)]'}`}><Icon name={row.primaryNextAction?.overdue ? 'error' : 'schedule'} className="mt-[-1px] shrink-0 text-[15px]" />{nextAction}</span>
                    <span>{row.owner || 'Unassigned'}</span><span className="text-[var(--crm-text-muted)]">{formatRelativeDate(row.lastActivityAt)}</span><span className="text-[var(--crm-text-muted)]">{formatLeadSource(row.source)}</span>
                  </div>
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
            <div className="mt-5">
              <LeadStatusControl
                leadId={selected.id}
                classification={selected.classification}
                station={selected.station}
                deadReason={selected.deadReason}
                agent={selected.owner}
                onChanged={(update) => handleLeadStatusChanged(selected.id, update)}
                variant="panel"
              />
            </div>
            <div className="crm-panel mt-6 rounded-xl p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><Icon name="trending_up" className="text-[18px] text-[var(--crm-success)]" />Opportunity</h3><dl className="mt-4 space-y-3 text-xs"><div className="flex justify-between"><dt>Stage</dt><dd className={`rounded-md border px-2 py-1 font-semibold ${STAGE_TONES[selected.station]}`}>{STAGE_LABELS[selected.station]}</dd></div><div className="flex justify-between"><dt>Motivation</dt><dd className="rounded-full bg-[var(--crm-violet-soft)] px-2 py-0.5 font-black text-[var(--crm-violet)]">{selected.score} / 100</dd></div></dl></div>
            <div className="mt-5 rounded-xl border border-[var(--crm-action-border)] border-l-4 border-l-[var(--crm-action)] bg-[var(--crm-action-soft)] p-4"><h3 className="flex items-center gap-2 text-sm font-bold text-[var(--crm-action)]"><Icon name="bolt" className="text-[18px]" />Next action</h3><p className="mt-3 flex items-start gap-2 text-xs font-semibold leading-5 text-[var(--crm-ink)]"><Icon name="schedule" className="mt-0.5 text-[var(--crm-action)]" />{selected.primaryNextAction?.title || selected.nextActivity?.label || 'Define next action'}</p></div>
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
    </>
  )
}

function SortableSmartListTab({
  id,
  label,
  count,
  active,
  tone,
  onSelect,
}: {
  id: ContactSmartListNavigationId
  label: string
  count: number
  active: boolean
  tone: { active: string; count: string }
  onSelect: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  }

  return <button
    ref={setNodeRef}
    style={style}
    type="button"
    {...attributes}
    {...listeners}
    onClick={onSelect}
    aria-label={`${label} ${count}`}
    aria-current={active ? 'page' : undefined}
    title={`Open ${label}. Drag the tab itself to reorder.`}
    className={`shrink-0 touch-none border-b-[3px] px-3 py-3 text-sm font-semibold transition-colors ${active ? tone.active : 'border-transparent text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]'} ${isDragging ? 'cursor-grabbing rounded-t-lg bg-[var(--crm-surface)] shadow-lg' : 'cursor-grab'}`}
  >
    {label} <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${active ? tone.count : 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'}`}>{count}</span>
  </button>
}
