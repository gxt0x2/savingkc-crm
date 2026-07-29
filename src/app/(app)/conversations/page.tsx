'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { InboxSidebar, type ThreadPreview } from '@/components/conversations/inbox-sidebar'
import { ThreadView } from '@/components/conversations/thread-view'
import { WorkspaceFrame } from '@/components/conversations/workspace-frame'
import { ContactDetailsPanel } from '@/components/conversations/contact-details-panel'
import type { Message } from '@/components/conversations/message-bubble'
import { toProperCase, formatPhone } from '@/lib/format'

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

function getInitials(name: string | null): string {
  if (!name) return '??'
  const parts = name.trim().split(' ')
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatDuration(seconds: number): string {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function activityToMessage(activity: ActivityRow, lead: LeadRow): Message | null {
  const type = activity.type

  const meta = activity.metadata || {}
  const direction = (meta.direction as string) === 'inbound' || (meta.direction as string) === 'received' ? 'received' : 'sent'
  const timestamp = new Date(activity.created_at).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const agentName = activity.agent || undefined

  if (type === 'call') {
    const recordingSid = (meta.recordingSid as string) || undefined
    const recordingUrl = recordingSid ? `/api/recordings/${recordingSid}` : undefined
    const transcript = (meta.transcript as string) || undefined

    // Format phone numbers in call descriptions
    let formattedContent = activity.description || ''
    const phoneMatch = formattedContent.match(/\+1?(\d{10})/)
    if (phoneMatch) {
      const rawPhone = phoneMatch[0]
      const formatted = formatPhone(rawPhone)
      formattedContent = formattedContent.replace(rawPhone, formatted)
    }

    return {
      id: activity.id,
      type: 'call',
      direction,
      content: formattedContent,
      callDuration: formatDuration((meta.duration as number) || 0),
      timestamp,
      senderInitials: direction === 'received' ? getInitials(lead.full_name) : 'ED',
      agentName: direction === 'sent' ? agentName : undefined,
      recordingUrl,
      recordingSid,
      transcript,
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
      senderInitials: direction === 'received' ? getInitials(lead.full_name) : 'ED',
      agentName: direction === 'sent' ? agentName : undefined,
    }
  }

  if (type === 'sms') {
    return {
      id: activity.id,
      type: 'sms',
      direction,
      content: activity.description || '',
      timestamp,
      senderInitials: direction === 'received' ? getInitials(lead.full_name) : 'ED',
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
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null)
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [showNewMessage, setShowNewMessage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastCounter = useRef(0)

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

  function selectConversation(id: string) {
    setActiveLeadId(id)
    const url = new URL(window.location.href)
    url.searchParams.set('lead', id)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

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
      const { data } = await supabase
        .from('lead_activities')
        .select('id, lead_id, activity_type, description, agent, metadata, created_at')
        .is('lead_id', null)
        .in('activity_type', ['sms', 'email', 'call', 'voicemail', 'letter_tracking'])
        .order('created_at', { ascending: true })
        .limit(100)
      const filtered = ((data || []) as DatabaseActivityRow[]).filter((a) => {
        const meta = a.metadata || {}
        return meta.from === phone || meta.to === phone
      })
      setActivities(filtered.map((a) => ({ ...a, type: a.activity_type })))
    } else {
      const { data } = await supabase
        .from('lead_activities')
        .select('id, lead_id, activity_type, description, agent, metadata, created_at')
        .eq('lead_id', currentLeadId)
        .in('activity_type', ['sms', 'email', 'call', 'voicemail', 'letter_tracking'])
        .order('created_at', { ascending: true })
        .limit(100)
      setActivities(((data || []) as DatabaseActivityRow[]).map((a) => ({ ...a, type: a.activity_type })))
    }
  }, [activeLeadId])

  const fetchThreads = useCallback(async () => {
    const supabase = createClient()
    const [response, unmatchedResult] = await Promise.all([
      fetch('/api/conversations/hub', { cache: 'no-store' }),
      supabase
        .from('lead_activities')
        .select('id, lead_id, activity_type, description, agent, metadata, created_at')
        .is('lead_id', null)
        .in('activity_type', ['call', 'sms', 'voicemail'])
        .order('created_at', { ascending: false })
        .limit(50),
    ])
    const payload = response.ok ? await response.json() as { items?: LeadRow[] } : { items: [] }
    const rows = payload.items || []
    const unmatched = (unmatchedResult.data || []) as unknown as ActivityRow[]

    const phoneMap = new Map<string, ActivityRow[]>()
    for (const act of unmatched) {
      const phone = (act.metadata?.from as string) || (act.metadata?.to as string) || 'unknown'
      const items = phoneMap.get(phone) ?? []
      items.push(act)
      phoneMap.set(phone, items)
    }

    const virtualLeads: LeadRow[] = Array.from(phoneMap.entries()).map(([phone, acts]) => ({
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
      attentionState: 'needs_reply',
      owner: null,
      unread: true,
      lastMessage: acts[0].description || 'Inbound call — not yet a contact',
      lastActivityAt: acts[0].created_at,
      lastChannel: acts[0].type === 'voicemail' ? 'voicemail' : acts[0].type === 'sms' ? 'sms' : 'call',
      primaryNextAction: null,
    }))

    // Open the workspace on a fully identified seller so the operator lands in
    // a useful thread with property, ownership, and opportunity context. Keep
    // unmatched callers in the same inbox, immediately after known contacts.
    const allLeads = [...rows, ...virtualLeads]
    const requestedLeadId = new URLSearchParams(window.location.search).get('lead')
    setLeads(allLeads)
    setActiveLeadId((current) =>
      current && allLeads.some((lead) => lead.id === current)
        ? current
        : requestedLeadId && allLeads.some((lead) => lead.id === requestedLeadId)
          ? requestedLeadId
          : allLeads[0]?.id ?? null,
    )
    setLoading(false)
  }, [])

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
          void Promise.all([fetchActivities(), fetchThreads()])

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
    void Promise.all([fetchActivities(), fetchThreads()])
  }, [fetchActivities, fetchThreads])

  const activeLead = leads.find((l) => l.id === activeLeadId)

  // Derive toPhone from last activity metadata.to, fallback to default
  const lastActivityWithTo = [...activities].reverse().find((a) => a.metadata?.to)
  const toPhone = (lastActivityWithTo?.metadata?.to as string) || '+18163077835'

  const threads: ThreadPreview[] = leads.map((lead) => ({
    id: lead.id,
    name: lead.full_name && lead.full_name !== lead.phone ? toProperCase(lead.full_name) : formatPhone(lead.phone),
    initials: lead.station === 'unmatched' ? '?' : getInitials(lead.full_name),
    avatarBg: lead.priority === 'hot' ? 'bg-red-900' : lead.station === 'unmatched' ? 'bg-amber-700' : 'bg-slate-700',
    avatarText: 'text-white',
    address: [lead.property_address, lead.city].filter(Boolean).join(', ') || (lead.station === 'unmatched' ? formatPhone(lead.phone) : '—'),
    personality: null,
    tags: lead.priority === 'hot' ? [{ label: 'Hot Lead', variant: 'hot' as const }] : lead.station === 'unmatched' ? [{ label: 'New Call', variant: 'hot' as const }] : [],
    lastMessage: lead.lastMessage || (lead.station === 'unmatched' ? 'Inbound call — not yet a contact' : 'No communication yet'),
    lastChannel: lead.lastChannel || null,
    timestamp: new Date(lead.lastActivityAt || lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    unread: lead.unread ?? lead.station === 'unmatched',
    starred: lead.priority === 'hot',
    attentionState: lead.attentionState || (lead.station === 'unmatched' ? 'needs_reply' : 'resolved'),
    owner: lead.owner || lead.assigned_agent,
    nextAction: lead.primaryNextAction || null,
  }))

  const commActivities = activities
  const messages: Message[] = commActivities
    .map((act) => activeLead ? activityToMessage(act, activeLead) : null)
    .filter((m): m is Message => m !== null)
  const dateGroups = groupMessagesByDate(messages, commActivities)

  const contact = activeLead
    ? {
        name: activeLead.full_name && activeLead.full_name !== activeLead.phone
          ? activeLead.full_name
          : formatPhone(activeLead.phone),
        initials: getInitials(activeLead.full_name),
        address: [activeLead.property_address, activeLead.city].filter(Boolean).join(', ') || formatPhone(activeLead.phone),
        county: activeLead.phone ? formatPhone(activeLead.phone) : '—',
        tags: activeLead.priority === 'hot' ? ['Hot Lead'] : [],
        verified: false,
        assignedAgent: activeLead.assigned_agent,
        toPhone,
        attentionState: activeLead.attentionState || 'resolved',
        owner: activeLead.owner || activeLead.assigned_agent,
        nextAction: activeLead.primaryNextAction || null,
      }
    : { name: 'Select a contact', initials: '—', address: '—', county: '—', tags: [], verified: false, assignedAgent: null, toPhone: '+18163077835', attentionState: 'resolved' as const, owner: null, nextAction: null }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] text-slate-400">
        Loading conversations...
      </div>
    )
  }

  return (
    <WorkspaceFrame needsReply={threads.filter((thread) => thread.attentionState === 'needs_reply').length}>
    <div className="relative flex h-full overflow-hidden bg-white text-[#152033]">
      {showNewMessage && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setShowNewMessage(false)}>
          <div className="bg-white rounded-xl p-6 shadow-2xl w-96 max-w-[90vw] max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">Start New Conversation</h2>
            <p className="text-sm text-slate-500 mb-4">Select a lead to open their conversation thread:</p>
            <div className="space-y-2">
              {leads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => { selectConversation(lead.id); setShowNewMessage(false); setSidebarOpen(false) }}
                  className="w-full text-left p-3 rounded-lg hover:bg-slate-50 border border-slate-100 transition-colors"
                >
                  <div className="font-semibold text-sm">{lead.full_name || '(no name)'}</div>
                  <div className="text-xs text-slate-400">{lead.property_address || '—'}</div>
                </button>
              ))}
            </div>
          </div>
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
      <div className={`${sidebarOpen ? 'fixed inset-y-0 left-0 z-50' : 'hidden'} md:block`}>
        <InboxSidebar
          threads={threads}
          activeThreadId={activeLeadId || ''}
          onSelectThread={(id) => { selectConversation(id); setSidebarOpen(false) }}
          onNewMessage={() => setShowNewMessage(true)}
        />
      </div>

      {/* Thread view - full width on mobile, flex-1 on desktop */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
        {/* Mobile header with menu button */}
        <div className="md:hidden flex items-center gap-3 p-4 border-b border-slate-200 bg-white">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-slate-50 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h2 className="font-bold text-lg">{contact.name}</h2>
        </div>

        <ThreadView
          contact={contact}
          dateGroups={dateGroups.length > 0 ? dateGroups : [{ label: 'No messages yet', messages: [] }]}
          leadId={activeLeadId || undefined}
          phone={activeLead?.phone || undefined}
          email={activeLead?.email || undefined}
          onCall={openActiveDialer}
          onSent={refreshConversation}
          onConversationChanged={refreshConversation}
        />
      </div>

      <ContactDetailsPanel contact={activeLead || null} />

      {/* Toast notifications */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="flex items-center gap-3 bg-[#df3038] text-white px-4 py-3 rounded-xl shadow-xl text-sm font-semibold pointer-events-auto"
          >
            <span>{toast.message}</span>
            <button
              onClick={() => dismissToast(toast.id)}
              className="ml-1 text-white/80 hover:text-white leading-none"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
    </WorkspaceFrame>
  )
}
