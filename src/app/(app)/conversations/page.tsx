'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'

import { ContactDetailsPanel } from '@/components/conversations/contact-details-panel'
import { InboxSidebar, type ThreadPreview } from '@/components/conversations/inbox-sidebar'
import type { Message } from '@/components/conversations/message-bubble'
import { NextActionDialog } from '@/components/conversations/next-action-dialog'
import { ThreadView } from '@/components/conversations/thread-view'
import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { Icon } from '@/components/ui/icon'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'
import { getAvatarLabel, getDisplayLeadName } from '@/lib/contact-display'
import { formatPhone } from '@/lib/format'
import {
  getCallOutcomePresentation,
  getCallParties,
  getConversationDirection,
  getEligibleSmsReplySender,
  type CallOutcomePresentation,
} from '@/lib/operating-model/conversation-presentation'
import {
  conversationHubStaleTime,
  conversationTimelineStaleTime,
  conversationDeepLinkSearch,
  conversationHubInfiniteQueryKey,
  conversationMatchesDeepLink,
  conversationTimelineInfiniteQueryKey,
  mergeConversationThreads,
  fetchConversationHub,
  fetchConversationTimeline,
  type ConversationQueue,
} from '@/lib/queries/conversation-hub'

interface ConversationThread {
  id: string
  threadKey: string
  kind: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  station: string | null
  priority: string | null
  assigned_agent: string | null
  classification?: 'lead' | 'opportunity' | 'dead' | null
  dead_reason?: string | null
  county?: string | null
  source?: string | null
  motivation_score?: number | null
  arv?: number | null
  offer_amount?: number | null
  appointment_date?: string | null
  created_at: string
  attentionState: 'needs_reply' | 'waiting_on_contact' | 'resolved'
  owner: string | null
  lastMessage: string
  lastActivityAt: string
  lastChannel: 'call' | 'sms' | 'email' | 'voicemail' | null
  primaryNextAction: {
    id: string
    title: string
    dueAt: string | null
    owner: string | null
    overdue: boolean
  } | null
  lastCallOutcome?: CallOutcomePresentation | null
}

const EMPTY_CONVERSATION_THREADS: ConversationThread[] = []

type TimelineKind = 'message' | 'call' | 'note' | 'task' | 'status'

interface ConversationTimelineItem {
  id: string
  lead_id: string | null
  activity_type: string
  type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  // Compatibility aliases accepted during a projection rollout.
  kind?: TimelineKind
  createdAt?: string
  activityType?: string
  channel?: string | null
  direction?: string | null
  content?: string | null
  body?: string | null
  subject?: string | null
  agentName?: string | null
  owner?: string | null
  dueAt?: string | null
  status?: string | null
}

interface TimelineEntry {
  createdAt: string
  message: Message
}

interface Toast {
  id: number
  message: string
}

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function activityType(item: ConversationTimelineItem): string {
  const exactType = text(item.activityType, item.activity_type)
  if (exactType) return exactType
  if (item.kind === 'message') return item.channel === 'email' ? 'email' : 'sms'
  if (item.kind === 'status') return 'status_change'
  return item.kind || 'status_change'
}

function timelineKind(item: ConversationTimelineItem): TimelineKind {
  if (item.kind) return item.kind
  const type = activityType(item)
  if (type === 'call' || type === 'missed_call' || type === 'voicemail') return 'call'
  if (type === 'note' || type === 'agent_note') return 'note'
  if (type === 'task') return 'task'
  if (type === 'status_change' || type === 'letter_tracking') return 'status'
  return 'message'
}

function itemCreatedAt(item: ConversationTimelineItem) {
  return text(item.createdAt, item.created_at) || new Date(0).toISOString()
}

function itemContent(item: ConversationTimelineItem) {
  return text(item.content, item.body, item.description) || ''
}

function itemAgent(item: ConversationTimelineItem) {
  return text(item.agentName, item.agent) || undefined
}

function normalizedActivity(item: ConversationTimelineItem) {
  const metadata = { ...(item.metadata || {}) }
  if (item.direction && !metadata.direction) metadata.direction = item.direction
  return {
    activity_type: activityType(item),
    description: itemContent(item),
    metadata,
  }
}

function formatDuration(value: unknown): string | undefined {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

function timelineItemToEntry(item: ConversationTimelineItem, lead: ConversationThread, teamPhone: string | null): TimelineEntry {
  const activity = normalizedActivity(item)
  const metadata = activity.metadata || {}
  const createdAt = itemCreatedAt(item)
  const timestamp = new Date(createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const direction = getConversationDirection(activity) === 'inbound' ? 'received' : 'sent'
  const agentName = itemAgent(item)
  const senderInitials = direction === 'received' ? getAvatarLabel(lead.full_name, lead.phone, lead.source) : 'SKC'

  const kind = timelineKind(item)

  if (kind === 'call') {
    const recordingSid = text(metadata.recordingSid, metadata.recording_sid) || undefined
    const recordingUrl = text(metadata.recordingUrl, metadata.recording_url) || (recordingSid ? `/api/recordings/${recordingSid}` : undefined)
    const callOutcome = getCallOutcomePresentation(activity)
    const parties = getCallParties(activity, { leadPhone: lead.phone, teamPhone })
    return {
      createdAt,
      message: {
        id: item.id,
        type: 'call',
        direction,
        content: activity.description || '',
        timestamp,
        senderInitials,
        agentName: direction === 'sent' ? agentName : undefined,
        callDuration: formatDuration(metadata.duration ?? metadata.dialCallDuration ?? metadata.duration_seconds),
        recordingSid,
        recordingUrl,
        transcript: text(metadata.transcript) || undefined,
        callOutcome,
        fromPhone: parties.from ? formatPhone(parties.from) : undefined,
        toPhone: parties.to ? formatPhone(parties.to) : undefined,
        routingTeam: callOutcome.key === 'routing' ? 'Acquisitions' : undefined,
      },
    }
  }

  if (kind === 'note') {
    return { createdAt, message: { id: item.id, type: 'note', direction: 'sent', content: activity.description || '', timestamp, senderInitials: 'SKC', agentName } }
  }

  if (kind === 'task') {
    return {
      createdAt,
      message: {
        id: item.id,
        type: 'task',
        direction: 'sent',
        content: activity.description || 'Task updated',
        timestamp,
        senderInitials: 'SKC',
        agentName,
        owner: text(item.owner, metadata.assigned_to) || undefined,
        dueAt: text(item.dueAt, metadata.due_date) || undefined,
        taskStatus: text(item.status, metadata.status) || undefined,
      },
    }
  }

  if (kind === 'status') {
    return { createdAt, message: { id: item.id, type: 'status', direction: 'sent', content: activity.description || 'Conversation updated', timestamp, senderInitials: 'SKC', agentName } }
  }

  const channel = text(item.channel) || (activity.activity_type.includes('email') ? 'email' : 'sms')
  if (channel === 'email') {
    return {
      createdAt,
      message: {
        id: item.id,
        type: 'email',
        direction,
        content: activity.description || '',
        timestamp,
        senderInitials,
        agentName: direction === 'sent' ? agentName : undefined,
        subject: text(item.subject, metadata.subject) || 'Email',
        emailMeta: text(metadata.from) || undefined,
      },
    }
  }

  return {
    createdAt,
    message: {
      id: item.id,
      type: 'sms',
      direction,
      content: activity.description || '',
      timestamp,
      senderInitials,
      agentName: direction === 'sent' ? agentName : undefined,
    },
  }
}

function groupTimeline(entries: TimelineEntry[]) {
  const byDate = new Map<string, Message[]>()
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  for (const entry of entries) {
    const date = new Date(entry.createdAt)
    const label = date.toDateString() === today.toDateString()
      ? 'Today'
      : date.toDateString() === yesterday.toDateString()
        ? 'Yesterday'
        : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const group = byDate.get(label) ?? []
    group.push(entry.message)
    byDate.set(label, group)
  }

  return Array.from(byDate.entries()).map(([label, messages]) => ({ label, messages }))
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const value = key(item)
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

function pollVisible(): number | false {
  return typeof document !== 'undefined' && document.visibilityState === 'visible' ? 15_000 : false
}

function pollVisibleSinglePage(query: { state: { data: unknown } }): number | false {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return false
  const data = query.state.data
  if (!data || typeof data !== 'object' || !('pages' in data)) return 15_000
  const pages = (data as { pages?: unknown[] }).pages
  return (pages?.length ?? 0) <= 1 ? 15_000 : false
}

export default function ConversationsPage() {
  const queryClient = useQueryClient()
  const routeSearchParams = useSearchParams()
  const routeRequestedThread = routeSearchParams.get('lead')
  const routeComposeMode = routeSearchParams.get('compose')
  const toastCounter = useRef(0)
  const [requestedThreadId, setRequestedThreadId] = useState<string | null>(() => routeRequestedThread)
  const [activeQueue, setActiveQueue] = useState<ConversationQueue>(() => routeRequestedThread ? 'all' : 'needs_reply')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null)
  const [pinnedThread, setPinnedThread] = useState<ConversationThread | null>(null)
  const [mobilePane, setMobilePane] = useState<'inbox' | 'thread'>(() => routeRequestedThread ? 'thread' : 'inbox')
  const [contactDetailsOpen, setContactDetailsOpen] = useState(true)
  const [nextActionDialogOpen, setNextActionDialogOpen] = useState(false)
  const [showNewMessage, setShowNewMessage] = useState(false)
  const [newConversationSearch, setNewConversationSearch] = useState('')
  const [debouncedNewConversationSearch, setDebouncedNewConversationSearch] = useState('')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [initialComposeMode] = useState<'sms' | 'email' | 'note'>(() => routeComposeMode === 'email' || routeComposeMode === 'note' ? routeComposeMode : 'sms')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedNewConversationSearch(newConversationSearch), 250)
    return () => window.clearTimeout(timer)
  }, [newConversationSearch])

  const normalizedSearch = debouncedSearch.trim().length >= 3 ? debouncedSearch.trim() : ''
  const requestedThreadSearch = conversationDeepLinkSearch(requestedThreadId)
  const requestedLookupEnabled = requestedThreadSearch.length >= 3

  const hubQuery = useInfiniteQuery({
    queryKey: conversationHubInfiniteQueryKey(activeQueue, normalizedSearch),
    queryFn: ({ pageParam }) => fetchConversationHub<ConversationThread>({ queue: activeQueue, cursor: pageParam, search: normalizedSearch }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.pageInfo.hasMore ? lastPage.pageInfo.nextCursor ?? undefined : undefined,
    staleTime: conversationHubStaleTime,
    refetchInterval: pollVisibleSinglePage,
    refetchIntervalInBackground: false,
  })

  const requestedThreadQuery = useQuery({
    queryKey: ['conversation-hub', 'direct', requestedThreadSearch],
    queryFn: () => fetchConversationHub<ConversationThread>({ queue: 'all', search: requestedThreadSearch, limit: 1 }),
    enabled: requestedLookupEnabled,
    staleTime: conversationHubStaleTime,
    refetchInterval: pollVisible,
    refetchIntervalInBackground: false,
  })
  const requestedThread = requestedThreadId
    ? requestedThreadQuery.data?.items.find((thread) => conversationMatchesDeepLink(thread, requestedThreadId)) ?? null
    : null
  const selectedQueueThreadQuery = useQuery({
    queryKey: ['conversation-hub', 'selected-queue', activeQueue, requestedThreadSearch],
    queryFn: () => fetchConversationHub<ConversationThread>({ queue: activeQueue, search: requestedThreadSearch, limit: 1 }),
    enabled: requestedLookupEnabled && activeQueue !== 'all',
    staleTime: conversationHubStaleTime,
    refetchInterval: pollVisible,
    refetchIntervalInBackground: false,
  })
  const selectedQueueThread = requestedThreadId
    ? selectedQueueThreadQuery.data?.items.find((thread) => conversationMatchesDeepLink(thread, requestedThreadId)) ?? null
    : null
  const hubHasLoadedHistory = (hubQuery.data?.pages.length ?? 0) > 1
  const hubHeadQuery = useQuery({
    queryKey: ['conversation-hub-head', activeQueue, normalizedSearch],
    queryFn: () => fetchConversationHub<ConversationThread>({ queue: activeQueue, search: normalizedSearch, limit: 50 }),
    enabled: hubHasLoadedHistory,
    staleTime: conversationHubStaleTime,
    refetchInterval: pollVisible,
    refetchIntervalInBackground: false,
  })
  const loadedHubThreads = useMemo(() => uniqueBy(hubQuery.data?.pages.flatMap((page) => page.items) ?? [], (thread) => thread.threadKey), [hubQuery.data])
  const freshHubThreads = hubHeadQuery.data?.items ?? EMPTY_CONVERSATION_THREADS
  const selectedThreadKey = requestedThread?.threadKey ?? pinnedThread?.threadKey ?? null
  const selectedMembershipKnown = activeQueue === 'all' || selectedQueueThreadQuery.data !== undefined
  const selectedThreadForQueue = activeQueue === 'all' ? requestedThread ?? pinnedThread : selectedQueueThread
  const freshThreadsWithoutStaleSelection = useMemo(() => selectedMembershipKnown && selectedThreadKey
    ? freshHubThreads.filter((thread) => thread.threadKey !== selectedThreadKey)
    : freshHubThreads, [freshHubThreads, selectedMembershipKnown, selectedThreadKey])
  const loadedThreadsWithoutStaleSelection = useMemo(() => selectedMembershipKnown && selectedThreadKey
    ? loadedHubThreads.filter((thread) => thread.threadKey !== selectedThreadKey)
    : loadedHubThreads, [loadedHubThreads, selectedMembershipKnown, selectedThreadKey])
  const threads = useMemo(() => mergeConversationThreads(
    selectedThreadForQueue ? [selectedThreadForQueue, ...freshThreadsWithoutStaleSelection] : freshThreadsWithoutStaleSelection,
    loadedThreadsWithoutStaleSelection,
    null,
  ), [freshThreadsWithoutStaleSelection, loadedThreadsWithoutStaleSelection, selectedThreadForQueue])
  const resolvedActiveThreadKey = activeThreadKey
    ?? (requestedThreadId ? selectedThreadKey : threads[0]?.threadKey)
    ?? null
  const activeThread = threads.find((thread) => thread.threadKey === resolvedActiveThreadKey)
    ?? (selectedThreadKey === resolvedActiveThreadKey ? requestedThread ?? pinnedThread : null)
  const hubDegradedPage = (hubHeadQuery.data && (hubHeadQuery.data.degraded || hubHeadQuery.data.source === 'compatibility') ? hubHeadQuery.data : null)
    ?? hubQuery.data?.pages.find((page) => page.degraded || page.source === 'compatibility')

  const timelineQuery = useInfiniteQuery({
    queryKey: conversationTimelineInfiniteQueryKey(activeThread?.threadKey ?? ''),
    queryFn: ({ pageParam }) => fetchConversationTimeline<ConversationTimelineItem>({ threadId: activeThread!.id, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.pageInfo.hasMore ? lastPage.pageInfo.nextCursor ?? undefined : undefined,
    enabled: Boolean(activeThread?.threadKey),
    staleTime: conversationTimelineStaleTime,
    refetchInterval: pollVisibleSinglePage,
    refetchIntervalInBackground: false,
  })

  const timelineHasLoadedHistory = (timelineQuery.data?.pages.length ?? 0) > 1
  const timelineHeadQuery = useQuery({
    queryKey: ['conversation-timeline-head', activeThread?.threadKey],
    queryFn: () => fetchConversationTimeline<ConversationTimelineItem>({ threadId: activeThread!.id, limit: 50 }),
    enabled: Boolean(activeThread?.threadKey) && timelineHasLoadedHistory,
    staleTime: conversationTimelineStaleTime,
    refetchInterval: pollVisible,
    refetchIntervalInBackground: false,
  })

  const timelineItems = useMemo(() => uniqueBy(
    [
      ...(timelineHeadQuery.data?.items ?? []),
      ...(timelineQuery.data?.pages.flatMap((page) => page.items) ?? []),
    ],
    (item) => item.id,
  ), [timelineHeadQuery.data, timelineQuery.data])

  const teamPhone = useMemo(() => {
    for (const item of timelineItems) {
      const activity = normalizedActivity(item)
      const direction = getConversationDirection(activity)
      const candidate = direction === 'inbound'
        ? text(activity.metadata?.to, activity.metadata?.calledNumber)
        : text(activity.metadata?.from, activity.metadata?.fromPhone)
      if (candidate) return candidate
    }
    return null
  }, [timelineItems])

  const replyFromPhone = useMemo(() => timelineItems
    .map((item) => getEligibleSmsReplySender(normalizedActivity(item)))
    .find((sender): sender is string => Boolean(sender)), [timelineItems])

  const timelineEntries = useMemo(() => activeThread
    ? timelineItems
        .map((item) => timelineItemToEntry(item, activeThread, teamPhone))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    : [], [activeThread, teamPhone, timelineItems])
  const dateGroups = useMemo(() => groupTimeline(timelineEntries), [timelineEntries])
  const timelineDegradedPage = (timelineHeadQuery.data && (timelineHeadQuery.data.degraded || timelineHeadQuery.data.source === 'compatibility') ? timelineHeadQuery.data : null)
    ?? timelineQuery.data?.pages.find((page) => page.degraded || page.source === 'compatibility')
  const normalizedNewConversationSearch = debouncedNewConversationSearch.trim().length >= 3 ? debouncedNewConversationSearch.trim() : ''

  const newConversationQuery = useQuery({
    queryKey: ['conversation-hub', 'all', normalizedNewConversationSearch, 'new-conversation'],
    queryFn: () => fetchConversationHub<ConversationThread>({ queue: 'all', search: normalizedNewConversationSearch }),
    enabled: showNewMessage,
    staleTime: conversationHubStaleTime,
  })

  const closeNewConversation = useCallback(() => {
    setShowNewMessage(false)
    setNewConversationSearch('')
  }, [])
  const newConversationDialogRef = useDialogAccessibility<HTMLElement>(showNewMessage, closeNewConversation)

  function addToast(message: string) {
    const id = ++toastCounter.current
    setToasts((current) => [...current, { id, message }])
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3_000)
  }

  const selectConversation = useCallback((threadKey: string) => {
    setActiveThreadKey(threadKey)
    setMobilePane('thread')
    const thread = threads.find((item) => item.threadKey === threadKey)
    if (thread) {
      setPinnedThread(thread)
      setRequestedThreadId(thread.id)
    }
    const url = new URL(window.location.href)
    url.searchParams.set('lead', thread?.id || threadKey)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }, [threads])

  function selectNewConversation(thread: ConversationThread) {
    setActiveQueue('all')
    setPinnedThread(thread)
    setRequestedThreadId(thread.id)
    setActiveThreadKey(thread.threadKey)
    setMobilePane('thread')
    const url = new URL(window.location.href)
    url.searchParams.set('lead', thread.id)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
    closeNewConversation()
  }

  function changeQueue(queue: ConversationQueue) {
    setActiveQueue(queue)
    setActiveThreadKey(null)
    setPinnedThread(null)
    setMobilePane('inbox')
    setRequestedThreadId(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('lead')
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  const refreshConversation = useCallback(() => {
    void Promise.all([
      hubHasLoadedHistory ? hubHeadQuery.refetch() : hubQuery.refetch(),
      activeThread
        ? timelineHasLoadedHistory ? timelineHeadQuery.refetch() : timelineQuery.refetch()
        : Promise.resolve(),
      requestedThreadId ? requestedThreadQuery.refetch() : Promise.resolve(),
      requestedThreadId && activeQueue !== 'all' ? selectedQueueThreadQuery.refetch() : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ['conversation-attention-count'] }),
    ])
  }, [activeQueue, activeThread, hubHasLoadedHistory, hubHeadQuery, hubQuery, queryClient, requestedThreadId, requestedThreadQuery, selectedQueueThreadQuery, timelineHasLoadedHistory, timelineHeadQuery, timelineQuery])

  function openActiveDialer() {
    if (!activeThread?.phone) return
    window.dispatchEvent(new CustomEvent('open-dialer', {
      detail: {
        leadId: activeThread.kind === 'lead' ? activeThread.id : null,
        phone: activeThread.phone,
        name: activeThread.full_name || formatPhone(activeThread.phone),
      },
    }))
  }

  const previews: ThreadPreview[] = threads.map((thread) => ({
    id: thread.id,
    threadKey: thread.threadKey,
    name: getDisplayLeadName(thread.full_name, thread.phone),
    initials: getAvatarLabel(thread.full_name, thread.phone, thread.source),
    avatarBg: thread.priority === 'hot' ? 'bg-[var(--crm-brand)]' : 'bg-[var(--crm-charcoal)]',
    avatarText: 'text-white',
    address: [thread.property_address, thread.city].filter(Boolean).join(', ') || formatPhone(thread.phone) || 'No property linked',
    lastMessage: thread.lastMessage || 'No communication yet',
    lastChannel: thread.lastChannel,
    lastCallOutcome: thread.lastCallOutcome || null,
    activityAt: thread.lastActivityAt || thread.created_at,
    timestamp: new Date(thread.lastActivityAt || thread.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    hot: thread.priority === 'hot',
    attentionState: thread.attentionState,
    owner: thread.owner || thread.assigned_agent,
    nextAction: thread.primaryNextAction,
  }))

  const contact = activeThread ? {
    name: getDisplayLeadName(activeThread.full_name, activeThread.phone),
    initials: getAvatarLabel(activeThread.full_name, activeThread.phone, activeThread.source),
    verified: false,
    assignedAgent: activeThread.assigned_agent,
    team: 'Acquisitions',
    replyFromPhone,
    attentionState: activeThread.attentionState,
    owner: activeThread.owner || activeThread.assigned_agent,
    nextAction: activeThread.primaryNextAction,
  } : null

  return (
    <>
      <WorkspaceChrome />
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--crm-canvas)] text-[#152033]">
        {hubDegradedPage ? (
          <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-[var(--crm-warning)]/35 bg-[var(--crm-warning-soft)] px-4 py-2 text-xs font-semibold text-[var(--crm-text)]">
            <Icon name="warning_amber" className="mt-0.5 shrink-0 text-[var(--crm-warning)]" />
            <span><strong>Compatibility inbox.</strong> {hubDegradedPage.warning || 'The bounded fallback may not contain every conversation. Queue decisions should wait for the primary read model.'}</span>
          </div>
        ) : null}

        {showNewMessage ? (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4" onClick={closeNewConversation}>
            <section ref={newConversationDialogRef} role="dialog" aria-modal="true" aria-label="Start new conversation" tabIndex={-1} className="max-h-[75vh] w-full max-w-md overflow-hidden rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-[var(--crm-border)] px-5 py-4">
                <div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]">Conversation index</p><h2 className="mt-0.5 text-lg font-black text-[var(--crm-ink)]">Find a conversation</h2></div>
                <button type="button" onClick={closeNewConversation} aria-label="Close new conversation dialog" className="crm-icon-button grid h-9 w-9 place-items-center rounded-lg"><Icon name="close" /></button>
              </div>
              <div className="p-4">
                <label className="relative block"><span className="sr-only">Search existing conversations</span><Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--crm-text-muted)]" /><input autoFocus aria-label="Search existing conversations" type="search" value={newConversationSearch} onChange={(event) => setNewConversationSearch(event.target.value)} placeholder="Search name, phone, or property" className="crm-field h-10 w-full rounded-lg pl-9 pr-3 text-sm" /></label>
                {newConversationSearch.trim().length > 0 && newConversationSearch.trim().length < 3 ? <p role="status" className="mt-2 text-[10px] font-semibold text-[var(--crm-text-muted)]">Type at least 3 characters to search.</p> : null}
                <p className="mt-2 text-[10px] font-medium text-[var(--crm-text-muted)]">Only contacts with an existing communication thread appear here.</p>
              </div>
              <div className="max-h-[50vh] overflow-y-auto border-t border-[var(--crm-border)] p-3">
                {newConversationQuery.isPending ? <p role="status" className="p-6 text-center text-sm font-semibold text-[var(--crm-text-muted)]">Searching conversations…</p> : null}
                {newConversationQuery.isError ? <div role="alert" className="p-5 text-center text-sm font-semibold text-[var(--crm-danger)]">{newConversationQuery.error.message}<br /><button type="button" onClick={() => void newConversationQuery.refetch()} className="crm-secondary-button mt-3 rounded-lg px-3 py-2 text-xs">Retry search</button></div> : null}
                {!newConversationQuery.isPending && !newConversationQuery.isError && (newConversationQuery.data?.items.length ?? 0) === 0 ? <p role="status" className="p-6 text-center text-sm font-semibold text-[var(--crm-text-muted)]">No existing conversation threads match this search.</p> : null}
                {newConversationQuery.data && (newConversationQuery.data.degraded || newConversationQuery.data.source === 'compatibility') ? <p role="alert" className="mb-2 rounded-lg border border-[var(--crm-warning)]/35 bg-[var(--crm-warning-soft)] p-3 text-xs font-semibold">Compatibility results: {newConversationQuery.data.warning || 'Results may be incomplete.'}</p> : null}
                {newConversationQuery.data?.items.map((thread) => (
                  <button key={thread.threadKey} type="button" onClick={() => selectNewConversation(thread)} className="w-full rounded-xl border border-transparent p-3 text-left hover:border-[var(--crm-border)] hover:bg-[var(--crm-surface-subtle)]">
                    <span className="block text-sm font-black text-[var(--crm-ink)]">{getDisplayLeadName(thread.full_name, thread.phone)}</span>
                    <span className="mt-1 block text-xs font-medium text-[var(--crm-text-muted)]">{[thread.property_address || formatPhone(thread.phone), thread.owner || 'Unassigned'].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className={cnPane(mobilePane === 'inbox', 'w-full shrink-0 md:flex md:w-[340px]')}>
            <InboxSidebar
              threads={previews}
              activeThreadKey={resolvedActiveThreadKey || ''}
              activeQueue={activeQueue}
              search={search}
              loading={hubQuery.isPending}
              error={hubQuery.isError ? hubQuery.error.message : null}
              onRetry={() => void hubQuery.refetch()}
              onSelectThread={selectConversation}
              onQueueChange={changeQueue}
              onSearchChange={setSearch}
              hasMore={Boolean(hubQuery.hasNextPage)}
              loadingMore={hubQuery.isFetchingNextPage}
              onLoadMore={() => void hubQuery.fetchNextPage()}
              onNewMessage={() => setShowNewMessage(true)}
            />
          </div>

          <div className={cnPane(mobilePane === 'thread', 'min-h-0 min-w-0 flex-1 flex-col bg-[var(--crm-canvas)] md:flex')}>
            {activeThread && contact ? (
              <>
                <ThreadView
                  key={activeThread.threadKey}
                  threadKey={activeThread.threadKey}
                  contact={contact}
                  dateGroups={dateGroups}
                  leadId={activeThread.kind === 'lead' ? activeThread.id : undefined}
                  phone={activeThread.phone || undefined}
                  email={activeThread.email || undefined}
                  onCall={openActiveDialer}
                  onBack={() => setMobilePane('inbox')}
                  onSent={() => { addToast('Conversation updated'); refreshConversation() }}
                  onConversationChanged={refreshConversation}
                  contactDetailsOpen={contactDetailsOpen}
                  onToggleContactDetails={() => setContactDetailsOpen((value) => !value)}
                  initialComposeMode={initialComposeMode}
                  timelineLoading={timelineQuery.isPending}
                  timelineError={timelineQuery.isError ? timelineQuery.error.message : null}
                  onRetryTimeline={() => void timelineQuery.refetch()}
                  hasEarlierActivity={Boolean(timelineQuery.hasNextPage)}
                  loadingEarlierActivity={timelineQuery.isFetchingNextPage}
                  onLoadEarlierActivity={() => void timelineQuery.fetchNextPage()}
                  degradedWarning={timelineDegradedPage ? timelineDegradedPage.warning || 'Some older activity may be unavailable while the primary read model recovers.' : null}
                />
              </>
            ) : requestedThreadId && requestedLookupEnabled && requestedThreadQuery.isPending ? (
              <div role="status" className="grid min-h-0 flex-1 place-items-center p-6 text-center"><div><Icon name="progress_activity" className="mx-auto animate-spin text-2xl text-[var(--crm-text-muted)]" /><p className="mt-3 text-sm font-black text-[var(--crm-ink)]">Opening conversation…</p></div></div>
            ) : requestedThreadId && requestedThreadQuery.isError ? (
              <div role="alert" className="grid min-h-0 flex-1 place-items-center p-6 text-center"><div><Icon name="error" className="mx-auto text-2xl text-[var(--crm-danger)]" /><h2 className="mt-3 text-lg font-black text-[var(--crm-ink)]">Conversation could not be opened</h2><p className="mt-1 max-w-sm text-sm font-medium text-[var(--crm-text-muted)]">{requestedThreadQuery.error.message}</p><button type="button" onClick={() => void requestedThreadQuery.refetch()} className="crm-secondary-button mt-4 rounded-lg px-4 py-2 text-sm font-black">Retry conversation</button></div></div>
            ) : requestedThreadId && (!requestedLookupEnabled || requestedThreadQuery.data) ? (
              <div role="status" className="grid min-h-0 flex-1 place-items-center p-6 text-center"><div><Icon name="search_off" className="mx-auto text-2xl text-[var(--crm-text-muted)]" /><h2 className="mt-3 text-lg font-black text-[var(--crm-ink)]">Conversation not found</h2><p className="mt-1 max-w-sm text-sm font-medium text-[var(--crm-text-muted)]">The requested thread is not in the authoritative conversation index.</p><button type="button" onClick={() => { setRequestedThreadId(null); setMobilePane('inbox') }} className="crm-secondary-button mt-4 rounded-lg px-4 py-2 text-sm font-black">Back to inbox</button></div></div>
            ) : (
              <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
                <div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]"><Icon name="forum" className="text-[28px]" /></span><h2 className="mt-4 text-lg font-black text-[var(--crm-ink)]">Select a conversation</h2><p className="mt-1 max-w-sm text-sm font-medium leading-6 text-[var(--crm-text-muted)]">Choose a seller from the inbox to view their activity and reply.</p><button type="button" onClick={() => setMobilePane('inbox')} className="crm-secondary-button mt-4 rounded-lg px-4 py-2 text-sm font-black md:hidden">Back to inbox</button></div>
              </div>
            )}
          </div>

          {contactDetailsOpen && activeThread?.kind === 'lead' ? (
            <ContactDetailsPanel contact={activeThread} onClose={() => setContactDetailsOpen(false)} onNextAction={() => setNextActionDialogOpen(true)} onContactChanged={refreshConversation} />
          ) : null}
        </div>

        {nextActionDialogOpen && activeThread?.kind === 'lead' ? (
          <NextActionDialog leadId={activeThread.id} leadName={getDisplayLeadName(activeThread.full_name, activeThread.phone)} action={activeThread.primaryNextAction} defaultOwner={activeThread.assigned_agent || activeThread.owner} onClose={() => setNextActionDialogOpen(false)} onSaved={refreshConversation} />
        ) : null}

        <div aria-live="polite" className="pointer-events-none fixed bottom-20 right-4 z-[140] flex flex-col gap-2 md:bottom-6 md:right-6">
          {toasts.map((toast) => <div key={toast.id} className="rounded-xl bg-[var(--crm-ink)] px-4 py-3 text-sm font-bold text-white shadow-xl">{toast.message}</div>)}
        </div>
      </div>
    </>
  )
}

function cnPane(visibleOnMobile: boolean, classes: string) {
  return `${visibleOnMobile ? 'flex' : 'hidden'} ${classes}`
}
