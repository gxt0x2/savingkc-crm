'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InboxSidebar, type ThreadPreview } from '@/components/conversations/inbox-sidebar'
import { ThreadView } from '@/components/conversations/thread-view'
import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { Icon } from '@/components/ui/icon'
import { conversationHubQueryKey, conversationHubStaleTime, fetchConversationHub } from '@/lib/queries/conversation-hub'
import { ContactDetailsPanel } from '@/components/conversations/contact-details-panel'
import { NextActionDialog } from '@/components/conversations/next-action-dialog'
import type { Message } from '@/components/conversations/message-bubble'
import { toProperCase, formatPhone } from '@/lib/format'
import { getAvatarLabel, getDisplayLeadName } from '@/lib/contact-display'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'
import {
  buildConversationHubThread,
  type ConversationHubActivity,
  type ConversationHubLead,
} from '@/lib/operating-model/conversation-hub'
import {
  getCallOutcomePresentation,
  getCallParties,
  getConversationDirection,
  getEligibleSmsReplySender,
  isSmsConversationActivityType,
  type CallOutcomePresentation,
} from '@/lib/operating-model/conversation-presentation'
import type { ConversationDecisionTag } from '@/lib/operating-model/conversation-tags'

interface LeadRow {
  id: string
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
  attentionState?: 'needs_reply' | 'waiting_on_contact' | 'resolved'
  owner?: string | null
  unread?: boolean
  lastMessage?: string
  lastActivityAt?: string
  lastChannel?: 'call' | 'sms' | 'email' | 'voicemail' | null
  primaryNextAction?: {
    id: string
    title: string
    dueAt: string | null
    owner: string | null
    overdue: boolean
  } | null
  decision_tags?: ConversationDecisionTag[]
  lastCallOutcome?: CallOutcomePresentation | null
}

interface ActivityRow {
  id: string
  lead_id: string | null
  type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface DatabaseActivityRow extends Omit<ActivityRow, 'type'> {
  activity_type: string
}

// Simple toast type
interface Toast {
  id: number
  message: string
}

function formatDuration(value: unknown): string | undefined {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function activityToMessage(activity: ActivityRow, lead: LeadRow, teamPhone: string): Message | null {
  const type = activity.type

  const meta = activity.metadata || {}
  const direction = getConversationDirection({ activity_type: type, description: activity.description, metadata: meta }) === 'inbound' ? 'received' : 'sent'
  const timestamp = new Date(activity.created_at).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const agentName = activity.agent || undefined

  if (type === 'call') {
    const recordingSid = (meta.recordingSid as string) || undefined
    const recordingUrl = recordingSid ? `/api/recordings/${recordingSid}` : undefined
    const transcript = (meta.transcript as string) || undefined

    const presentationActivity = { activity_type: type, description: activity.description, metadata: meta }
    const callOutcome = getCallOutcomePresentation(presentationActivity)
    const parties = getCallParties(presentationActivity, { leadPhone: lead.phone, teamPhone })
    const duration = meta.duration ?? meta.dialCallDuration ?? meta.duration_seconds

    return {
      id: activity.id,
      type: 'call',
      direction,
      content: activity.description || '',
      callDuration: formatDuration(duration),
      timestamp,
      senderInitials: direction === 'received' ? getAvatarLabel(lead.full_name, lead.phone, lead.source) : 'ED',
      agentName: direction === 'sent' ? agentName : undefined,
      recordingUrl,
      recordingSid,
      transcript,
      callOutcome,
      fromPhone: parties.from ? formatPhone(parties.from) : undefined,
      toPhone: parties.to ? formatPhone(parties.to) : undefined,
      routingTeam: callOutcome.key === 'routing' ? 'Acquisitions' : undefined,
    }
  }

  if (type === 'email') {
    return {
      id: activity.id,
      type: 'email',
      direction,
      subject: (meta.subject as string) || 'Email',
      emailMeta: (meta.from as string) || undefined,
      content: activity.description || '',
      timestamp,
      senderInitials: direction === 'received' ? getAvatarLabel(lead.full_name, lead.phone, lead.source) : 'ED',
      agentName: direction === 'sent' ? agentName : undefined,
    }
  }

  if (isSmsConversationActivityType(type)) {
    return {
      id: activity.id,
      type: 'sms',
      direction,
      content: activity.description || '',
      timestamp,
      senderInitials: direction === 'received' ? getAvatarLabel(lead.full_name, lead.phone, lead.source) : 'ED',
      agentName: direction === 'sent' ? agentName : undefined,
    }
  }

  // All other types (task, voicemail, status_change, etc.) — show as system message
  return {
    id: activity.id,
    type: 'sms',
    direction: 'sent' as const,
    content: `[${type.replace(/_/g, ' ').toUpperCase()}] ${activity.description || ''}`,
    timestamp,
    senderInitials: 'Ari',
    agentName: agentName || 'System',
  }
}

function groupMessagesByDate(messages: Message[], activities: ActivityRow[]): { label: string; messages: Message[] }[] {
  const byDate = new Map<string, Message[]>()
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  activities.forEach((act, idx) => {
    const msg = messages[idx]
    if (!msg) return
    const d = new Date(act.created_at)
    let label: string
    if (d.toDateString() === today.toDateString()) label = 'Today'
    else if (d.toDateString() === yesterday.toDateString()) label = 'Yesterday'
    else label = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    if (!byDate.has(label)) byDate.set(label, [])
    byDate.get(label)!.push(msg)
  })

  return Array.from(byDate.entries()).map(([label, msgs]) => ({ label, messages: msgs }))
}

export default function ConversationsPage() {
  const queryClient = useQueryClient()
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null)
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [showNewMessage, setShowNewMessage] = useState(false)
  const [newConversationSearch, setNewConversationSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const initialThreadsLoaded = useRef(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [contactDetailsOpen, setContactDetailsOpen] = useState(true)
  const [nextActionDialogOpen, setNextActionDialogOpen] = useState(false)
  const [initialComposeMode] = useState<'sms' | 'email' | 'note'>(() => {
    if (typeof window === 'undefined') return 'sms'
    const requestedMode = new URLSearchParams(window.location.search).get('compose')
    return requestedMode === 'email' || requestedMode === 'note' || requestedMode === 'sms'
      ? requestedMode
      : 'sms'
  })
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastCounter = useRef(0)
  const closeNewConversation = useCallback(() => {
    setShowNewMessage(false)
    setNewConversationSearch('')
  }, [])
  const newConversationDialogRef = useDialogAccessibility<HTMLElement>(
    showNewMessage,
    closeNewConversation,
  )

  function addToast(msg: string) {
    const id = ++toastCounter.current
    setToasts((prev) => [...prev, { id, message: msg }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  const selectConversation = useCallback((id: string) => {
    setActiveLeadId(id)
    const url = new URL(window.location.href)
    url.searchParams.set('lead', id)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }, [])
  const handleSelectConversation = useCallback((id: string) => {
    selectConversation(id)
    setSidebarOpen(false)
  }, [selectConversation])

  function openActiveDialer() {
    if (!activeLead?.phone) return
    window.dispatchEvent(new CustomEvent('open-dialer', {
      detail: {
        leadId: activeLead.id.startsWith('unmatched:') ? null : activeLead.id,
        phone: activeLead.phone,
        name: activeLead.full_name || formatPhone(activeLead.phone),
      },
    }))
  }

  const fetchActivities = useCallback(async () => {
    const currentLeadId = activeLeadId
    if (!currentLeadId) return
    const supabase = createClient()

    if (currentLeadId.startsWith('unmatched:')) {
      const phone = currentLeadId.replace('unmatched:', '')
      const rows: DatabaseActivityRow[] = []
      for (let offset = 0; ; offset += 1000) {
        const { data } = await supabase
          .from('lead_activities')
          .select('id, lead_id, activity_type, description, agent, metadata, created_at')
          .is('lead_id', null)
          .in('activity_type', ['sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound', 'email', 'call', 'voicemail', 'letter_tracking'])
          .order('created_at', { ascending: true })
          .range(offset, offset + 999)
        rows.push(...((data || []) as DatabaseActivityRow[]))
        if ((data?.length ?? 0) < 1000) break
      }
      const filtered = rows.filter((a) => {
        const meta = a.metadata || {}
        return meta.from === phone || meta.to === phone
      })
      setActivities(filtered.map((a) => ({ ...a, type: a.activity_type })))
    } else {
      const rows: DatabaseActivityRow[] = []
      for (let offset = 0; ; offset += 1000) {
        const { data } = await supabase
          .from('lead_activities')
          .select('id, lead_id, activity_type, description, agent, metadata, created_at')
          .eq('lead_id', currentLeadId)
          .in('activity_type', ['sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound', 'email', 'call', 'voicemail', 'letter_tracking'])
          .order('created_at', { ascending: true })
          .range(offset, offset + 999)
        rows.push(...((data || []) as DatabaseActivityRow[]))
        if ((data?.length ?? 0) < 1000) break
      }
      setActivities(rows.map((a) => ({ ...a, type: a.activity_type })))
    }
  }, [activeLeadId])

  const fetchThreads = useCallback(async (force = false) => {
    const payload = await queryClient.fetchQuery({
      queryKey: conversationHubQueryKey,
      queryFn: () => fetchConversationHub<LeadRow, ConversationHubActivity>(),
      staleTime: force ? 0 : conversationHubStaleTime,
    }).catch(() => ({ items: [] as LeadRow[], unmatchedActivities: [] as ConversationHubActivity[] }))
    const rows = payload.items
    const requestedLeadId = new URLSearchParams(window.location.search).get('lead')

    if (!initialThreadsLoaded.current) {
      setLeads(rows)
      setActiveLeadId((current) =>
        current && rows.some((lead) => lead.id === current)
          ? current
          : requestedLeadId && rows.some((lead) => lead.id === requestedLeadId)
            ? requestedLeadId
            : rows[0]?.id ?? null,
      )
      setLoading(false)
      initialThreadsLoaded.current = true
    }

    const unmatched = payload.unmatchedActivities.map((activity) => ({ ...activity, type: activity.activity_type }))

    const phoneMap = new Map<string, ActivityRow[]>()
    for (const act of unmatched) {
      const rawDirection = String(act.metadata?.direction ?? '').toLowerCase()
      const phone = rawDirection === 'outbound' || rawDirection === 'sent'
        ? String(act.metadata?.to ?? act.metadata?.from ?? 'unknown')
        : String(act.metadata?.from ?? act.metadata?.to ?? 'unknown')
      const items = phoneMap.get(phone) ?? []
      items.push(act)
      phoneMap.set(phone, items)
    }

    const virtualLeads: LeadRow[] = Array.from(phoneMap.entries()).map(([phone, acts]) => {
      const virtualLead: ConversationHubLead = {
        id: `unmatched:${phone}`,
        full_name: phone,
        phone,
        email: null,
        property_address: null,
        city: null,
        station: 'unmatched',
        priority: 'normal',
        assigned_agent: null,
        created_at: acts[0].created_at,
      }
      const activities: ConversationHubActivity[] = acts.map((activity) => ({
        id: activity.id,
        lead_id: activity.lead_id,
        activity_type: activity.type,
        description: activity.description,
        agent: activity.agent,
        metadata: activity.metadata,
        created_at: activity.created_at,
      }))
      return buildConversationHubThread(virtualLead, activities)
    })

    // Open the workspace on a fully identified seller so the operator lands in
    // a useful thread with property, ownership, and opportunity context. Keep
    // unmatched callers in the same inbox, immediately after known contacts.
    const allLeads = [...rows, ...virtualLeads]
    setLeads(allLeads)
    setActiveLeadId((current) =>
      current && allLeads.some((lead) => lead.id === current)
        ? current
        : requestedLeadId && allLeads.some((lead) => lead.id === requestedLeadId)
          ? requestedLeadId
          : allLeads[0]?.id ?? null,
    )
    setLoading(false)
  }, [queryClient])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchThreads()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchThreads])

  useEffect(() => {
    if (!activeLeadId) return
    const supabase = createClient()

    const refreshTimer = window.setTimeout(() => {
      void fetchActivities()
    }, 0)

    // Realtime subscription — new activities appear without refresh
    const channel = supabase
      .channel(`lead-activities-${activeLeadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'lead_activities',
          ...(activeLeadId.startsWith('unmatched:') ? {} : { filter: `lead_id=eq.${activeLeadId}` }),
        },
        (payload) => {
          void Promise.all([fetchActivities(), fetchThreads(true)])

          // Toast notification for inbound messages
          const meta = payload.new?.metadata || {}
          const direction = (meta.direction as string) || ''
          const isInbound = direction === 'inbound' || direction === 'received'
          if (isInbound) {
            const lead = leads.find((l) => l.id === activeLeadId)
            const name = lead?.full_name && lead.full_name !== lead.phone
              ? toProperCase(lead.full_name)
              : formatPhone(lead?.phone)
            addToast(`New message from ${name}`)
          }
        }
      )
      .subscribe()

    return () => {
      window.clearTimeout(refreshTimer)
      supabase.removeChannel(channel)
    }
  }, [activeLeadId, fetchActivities, fetchThreads, leads])

  const refreshConversation = useCallback(() => {
    void Promise.all([fetchActivities(), fetchThreads(true)])
  }, [fetchActivities, fetchThreads])

  const activeLead = leads.find((l) => l.id === activeLeadId)
  const normalizedNewConversationSearch = newConversationSearch.trim().toLowerCase()
  const newConversationLeads = normalizedNewConversationSearch
    ? leads.filter((lead) =>
        [
          lead.full_name,
          lead.phone,
          lead.property_address,
          lead.city,
          lead.owner,
          lead.assigned_agent,
        ].some((value) => value?.toLowerCase().includes(normalizedNewConversationSearch)),
      )
    : leads

  // The team line is the inbound destination or outbound origin used in call
  // details. Reply identity is derived separately from eligible SMS history.
  const teamPhoneActivity = [...activities].reverse().find((activity) => {
    const direction = getConversationDirection({ activity_type: activity.type, description: activity.description, metadata: activity.metadata })
    return direction === 'inbound'
      ? Boolean(activity.metadata?.to || activity.metadata?.calledNumber)
      : Boolean(activity.metadata?.from || activity.metadata?.fromPhone)
  })
  const teamPhoneDirection = teamPhoneActivity
    ? getConversationDirection({ activity_type: teamPhoneActivity.type, description: teamPhoneActivity.description, metadata: teamPhoneActivity.metadata })
    : null
  const toPhone = teamPhoneActivity
    ? String(teamPhoneDirection === 'inbound'
      ? teamPhoneActivity.metadata?.to || teamPhoneActivity.metadata?.calledNumber
      : teamPhoneActivity.metadata?.from || teamPhoneActivity.metadata?.fromPhone)
    : '+18163077835'
  const replyFromPhone = [...activities]
    .reverse()
    .map((activity) => getEligibleSmsReplySender({
      activity_type: activity.type,
      description: activity.description,
      metadata: activity.metadata,
    }))
    .find((sender): sender is string => Boolean(sender))

  const threads: ThreadPreview[] = leads.map((lead) => ({
    id: lead.id,
    name: getDisplayLeadName(lead.full_name, lead.phone),
    initials: getAvatarLabel(lead.full_name, lead.phone, lead.source),
    avatarBg: lead.priority === 'hot' ? 'bg-[var(--crm-brand)]' : 'bg-[var(--crm-charcoal)]',
    avatarText: 'text-white',
    address: [lead.property_address, lead.city].filter(Boolean).join(', ') || (lead.station === 'unmatched' ? formatPhone(lead.phone) : '—'),
    personality: null,
    tags: (lead.decision_tags || []).slice(0, 2),
    lastMessage: lead.lastMessage || (lead.station === 'unmatched' ? 'Inbound call — not yet a contact' : 'No communication yet'),
    lastChannel: lead.lastChannel || null,
    lastCallOutcome: lead.lastCallOutcome || null,
    activityAt: lead.lastActivityAt || lead.created_at,
    timestamp: new Date(lead.lastActivityAt || lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    unread: lead.unread ?? lead.station === 'unmatched',
    hot: lead.priority === 'hot',
    attentionState: lead.attentionState || (lead.station === 'unmatched' ? 'needs_reply' : 'resolved'),
    owner: lead.owner || lead.assigned_agent,
    nextAction: lead.primaryNextAction || null,
  }))

  const commActivities = activities
  const messages: Message[] = commActivities
    .map((act) => activeLead ? activityToMessage(act, activeLead, toPhone) : null)
    .filter((m): m is Message => m !== null)
  const dateGroups = groupMessagesByDate(messages, commActivities)

  const contact = activeLead
    ? {
        name: getDisplayLeadName(activeLead.full_name, activeLead.phone),
        initials: getAvatarLabel(activeLead.full_name, activeLead.phone, activeLead.source),
        verified: false,
        assignedAgent: activeLead.assigned_agent,
        team: 'Acquisitions',
        replyFromPhone,
        attentionState: activeLead.attentionState || 'resolved',
        owner: activeLead.owner || activeLead.assigned_agent,
        nextAction: activeLead.primaryNextAction || null,
      }
    : { name: 'Select a contact', initials: '—', verified: false, assignedAgent: null, team: 'Acquisitions', replyFromPhone: undefined, attentionState: 'resolved' as const, owner: null, nextAction: null }

  return (
    <>
      <WorkspaceChrome needsReply={threads.filter((thread) => thread.attentionState === 'needs_reply').length} />
      <div aria-busy={loading} className="relative flex h-full overflow-hidden bg-[var(--crm-canvas)] text-[#152033]">
      {loading ? (
        <div role="status" aria-label="Loading conversations" className="absolute inset-x-0 top-0 z-[60] h-1 overflow-hidden bg-[var(--crm-info-soft)]">
          <span className="block h-full w-1/3 animate-pulse rounded-full bg-[var(--crm-info)]" />
        </div>
      ) : null}
      {showNewMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeNewConversation}>
          <section ref={newConversationDialogRef} role="dialog" aria-modal="true" aria-label="Start new conversation" tabIndex={-1} className="max-h-[70vh] w-96 max-w-[90vw] overflow-y-auto rounded-2xl border border-[#ded9d1] bg-white p-6 shadow-[0_22px_60px_rgba(11,41,66,0.22)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Start New Conversation</h2>
              <button type="button" onClick={closeNewConversation} aria-label="Close new conversation dialog" className="flex h-9 w-9 items-center justify-center rounded-md text-[#667085] hover:bg-[#fff7f7] hover:text-[#b91c26]">✕</button>
            </div>
            <p className="mb-3 text-sm text-slate-500">Select a lead to open their conversation thread:</p>
            <label htmlFor="new-conversation-search" className="sr-only">Search contacts for a new conversation</label>
            <div className="relative mb-4">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true">⌕</span>
              <input
                id="new-conversation-search"
                autoFocus
                type="search"
                value={newConversationSearch}
                onChange={(event) => setNewConversationSearch(event.target.value)}
                placeholder="Search name, phone, address, or owner"
                className="h-10 w-full rounded-lg border border-[#d9dee5] bg-white pl-9 pr-3 text-sm text-[#172033] outline-none focus:border-[#df3038] focus:ring-2 focus:ring-[#df3038]/10"
              />
            </div>
            <div className="space-y-2">
              {newConversationLeads.length === 0 ? (
                <p role="status" className="rounded-lg border border-dashed border-[#ccd4dd] px-4 py-6 text-center text-sm text-slate-500">
                  No contacts match “{newConversationSearch}”.
                </p>
              ) : newConversationLeads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => {
                    selectConversation(lead.id)
                    setShowNewMessage(false)
                    setNewConversationSearch('')
                    setSidebarOpen(false)
                  }}
                  className="w-full rounded-lg border border-[#e1ddd7] p-3 text-left transition-colors hover:border-[#a9c5f4] hover:bg-[#edf4ff]"
                >
                  <div className="text-sm font-semibold">{lead.full_name || formatPhone(lead.phone) || '(no name)'}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {[lead.property_address || formatPhone(lead.phone), lead.owner || lead.assigned_agent ? `Owner: ${lead.owner || lead.assigned_agent}` : 'Unassigned'].filter(Boolean).join(' · ')}
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - hidden on mobile unless sidebarOpen, always visible on desktop */}
      <div className={`${sidebarOpen ? 'absolute inset-0 z-50 [&>*]:w-full' : 'hidden'} md:static md:block`}>
        <InboxSidebar
          threads={threads}
          activeThreadId={activeLeadId || ''}
          onSelectThread={handleSelectConversation}
          onNewMessage={() => setShowNewMessage(true)}
        />
      </div>

      {/* Thread view - full width on mobile, flex-1 on desktop */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--crm-canvas)]">
        {/* Mobile header with menu button */}
        <div className="flex h-12 items-center gap-2 border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open conversation inbox"
            className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-[var(--crm-ink)]">{contact.name}</h2>
          <button type="button" onClick={openActiveDialer} disabled={!activeLead?.phone} aria-label="Call contact" className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--crm-success-soft)] text-[var(--crm-success)] disabled:opacity-40"><Icon name="call" /></button>
        </div>

        <ThreadView
          key={activeLeadId || activeLead?.phone || 'unmatched-conversation'}
          contact={contact}
          dateGroups={dateGroups.length > 0 ? dateGroups : [{ label: 'No messages yet', messages: [] }]}
          leadId={activeLeadId || undefined}
          phone={activeLead?.phone || undefined}
          email={activeLead?.email || undefined}
          onCall={openActiveDialer}
          onSent={refreshConversation}
          onConversationChanged={refreshConversation}
          contactDetailsOpen={contactDetailsOpen}
          onToggleContactDetails={() => setContactDetailsOpen((value) => !value)}
          initialComposeMode={initialComposeMode}
        />
      </div>

      {contactDetailsOpen ? (
        <ContactDetailsPanel
          contact={activeLead || null}
          onClose={() => setContactDetailsOpen(false)}
          onNextAction={activeLead && !activeLead.id.startsWith('unmatched:') ? () => setNextActionDialogOpen(true) : undefined}
          onContactChanged={refreshConversation}
        />
      ) : null}

      {nextActionDialogOpen && activeLead && !activeLead.id.startsWith('unmatched:') ? (
        <NextActionDialog
          leadId={activeLead.id}
          leadName={getDisplayLeadName(activeLead.full_name, activeLead.phone)}
          action={activeLead.primaryNextAction || null}
          defaultOwner={activeLead.assigned_agent || activeLead.owner || null}
          onClose={() => setNextActionDialogOpen(false)}
          onSaved={refreshConversation}
        />
      ) : null}

      {/* Toast notifications */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="flex items-center gap-3 bg-[#df3038] text-white px-4 py-3 rounded-xl shadow-xl text-sm font-semibold pointer-events-auto"
          >
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
              className="ml-1 text-white/80 hover:text-white leading-none"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      </div>
    </>
  )
}
