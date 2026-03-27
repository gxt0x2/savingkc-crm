'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { InboxSidebar, type ThreadPreview } from '@/components/conversations/inbox-sidebar'
import { ThreadView } from '@/components/conversations/thread-view'
import type { Message } from '@/components/conversations/message-bubble'

interface LeadRow {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  station: string | null
  priority: string | null
  created_at: string
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

function getInitials(name: string | null): string {
  if (!name) return '??'
  const parts = name.trim().split(' ')
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function activityToMessage(activity: ActivityRow, lead: LeadRow): Message | null {
  const type = activity.type
  if (type !== 'sms' && type !== 'email' && type !== 'call') return null

  const meta = activity.metadata || {}
  const direction = (meta.direction as string) === 'received' ? 'received' : 'sent'
  const timestamp = new Date(activity.created_at).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (type === 'call') {
    return {
      id: activity.id,
      type: 'call',
      direction,
      content: activity.description || '',
      callDuration: (meta.duration as string) || '—',
      timestamp,
      senderInitials: direction === 'received' ? getInitials(lead.full_name) : 'ED',
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
    }
  }

  return {
    id: activity.id,
    type: 'sms',
    direction,
    content: activity.description || '',
    timestamp,
    senderInitials: direction === 'received' ? getInitials(lead.full_name) : 'ED',
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

  useEffect(() => {
    async function fetchLeads() {
      const supabase = createClient()
      // Fetch leads with comms
      const { data } = await supabase
        .from('leads')
        .select('id, full_name, phone, email, property_address, city, station, priority, created_at')
        .not('station', 'eq', 'dead')
        .order('created_at', { ascending: false })
        .limit(100)
      const rows = (data as LeadRow[]) || []

      // Also fetch unmatched conversations (lead_id is null)
      const { data: unmatchedData } = await supabase
        .from('lead_activities')
        .select('id, lead_id, activity_type, description, agent, metadata, created_at')
        .is('lead_id', null)
        .in('activity_type', ['call', 'sms'])
        .order('created_at', { ascending: false })
        .limit(50)
      const unmatched = (unmatchedData || []) as unknown as ActivityRow[]

      // Group unmatched by phone number to create virtual threads
      const phoneMap = new Map<string, ActivityRow[]>()
      for (const act of unmatched) {
        const phone = (act.metadata?.from as string) || (act.metadata?.to as string) || 'unknown'
        if (!phoneMap.has(phone)) phoneMap.set(phone, [])
        phoneMap.get(phone)!.push(act)
      }

      // Create virtual lead entries for unmatched numbers
      const virtualLeads: LeadRow[] = Array.from(phoneMap.entries()).map(([phone, acts]) => ({
        id: `unmatched:${phone}`,
        full_name: phone,
        phone,
        email: null,
        property_address: null,
        city: null,
        station: 'unmatched',
        priority: 'normal',
        created_at: acts[0].created_at,
      }))

      const allLeads = [...virtualLeads, ...rows]
      setLeads(allLeads)
      if (allLeads.length > 0) setActiveLeadId(allLeads[0].id)
      setLoading(false)
    }
    fetchLeads()
  }, [])

  useEffect(() => {
    if (!activeLeadId) return
    async function fetchActivities() {
      const supabase = createClient()

      if (activeLeadId!.startsWith('unmatched:')) {
        // Fetch unmatched activities by phone number
        const phone = activeLeadId!.replace('unmatched:', '')
        const { data } = await supabase
          .from('lead_activities')
          .select('id, lead_id, activity_type, description, agent, metadata, created_at')
          .is('lead_id', null)
          .in('activity_type', ['sms', 'email', 'call'])
          .order('created_at', { ascending: true })
          .limit(100)
        // Filter by phone in metadata
        const filtered = (data || []).filter((a: any) => {
          const meta = a.metadata || {}
          return meta.from === phone || meta.to === phone
        })
        // Map activity_type to type for compatibility
        setActivities(filtered.map((a: any) => ({ ...a, type: a.activity_type })) as unknown as ActivityRow[])
      } else {
        const { data } = await supabase
          .from('lead_activities')
          .select('id, lead_id, activity_type, description, agent, metadata, created_at')
          .eq('lead_id', activeLeadId)
          .in('activity_type', ['sms', 'email', 'call'])
          .order('created_at', { ascending: true })
          .limit(100)
        setActivities((data || []).map((a: any) => ({ ...a, type: a.activity_type })) as unknown as ActivityRow[])
      }
    }
    fetchActivities()
  }, [activeLeadId])

  const activeLead = leads.find((l) => l.id === activeLeadId)

  const threads: ThreadPreview[] = leads.map((lead) => ({
    id: lead.id,
    name: lead.full_name || '(no name)',
    initials: lead.station === 'unmatched' ? '📞' : getInitials(lead.full_name),
    avatarBg: lead.priority === 'hot' ? 'bg-red-900' : lead.station === 'unmatched' ? 'bg-amber-700' : 'bg-slate-700',
    avatarText: 'text-white',
    address: [lead.property_address, lead.city].filter(Boolean).join(', ') || (lead.station === 'unmatched' ? 'Unassigned — needs review' : '—'),
    personality: null,
    tags: lead.priority === 'hot' ? [{ label: 'Hot Lead', variant: 'hot' as const }] : lead.station === 'unmatched' ? [{ label: 'New Call', variant: 'hot' as const }] : [],
    lastMessage: lead.station === 'unmatched' ? 'Inbound call — not yet a lead' : lead.station ? `Stage: ${lead.station.replace(/_/g, ' ')}` : 'No activity yet',
    timestamp: new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    unread: lead.station === 'unmatched',
    starred: lead.priority === 'hot',
  }))

  const commActivities = activities.filter((a) => a.type === 'sms' || a.type === 'email' || a.type === 'call')
  const messages: Message[] = commActivities
    .map((act) => activeLead ? activityToMessage(act, activeLead) : null)
    .filter((m): m is Message => m !== null)
  const dateGroups = groupMessagesByDate(messages, commActivities)

  const contact = activeLead
    ? {
        name: activeLead.full_name || '(no name)',
        initials: getInitials(activeLead.full_name),
        address: [activeLead.property_address, activeLead.city].filter(Boolean).join(', ') || '—',
        county: '—',
        tags: activeLead.priority === 'hot' ? ['Hot Lead'] : [],
        verified: false,
      }
    : { name: 'Select a contact', initials: '—', address: '—', county: '—', tags: [], verified: false }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)] text-slate-400">
        Loading conversations...
      </div>
    )
  }

  return (
    <div className="relative flex h-[calc(100vh-4rem)]">
      {showNewMessage && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setShowNewMessage(false)}>
          <div className="bg-white rounded-xl p-6 shadow-2xl w-96 max-w-[90vw] max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">Start New Conversation</h2>
            <p className="text-sm text-slate-500 mb-4">Select a lead to open their conversation thread:</p>
            <div className="space-y-2">
              {leads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => { setActiveLeadId(lead.id); setShowNewMessage(false); setSidebarOpen(false) }}
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
          onSelectThread={(id) => { setActiveLeadId(id); setSidebarOpen(false) }}
          onNewMessage={() => setShowNewMessage(true)}
        />
      </div>

      {/* Thread view - full width on mobile, flex-1 on desktop */}
      <div className="flex-1 flex flex-col min-w-0">
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
        />
      </div>
    </div>
  )
}
