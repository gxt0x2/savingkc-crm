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

  useEffect(() => {
    async function fetchLeads() {
      const supabase = createClient()
      const { data } = await supabase
        .from('leads')
        .select('id, full_name, phone, email, property_address, city, station, priority, created_at')
        .not('station', 'eq', 'dead')
        .order('created_at', { ascending: false })
        .limit(100)
      const rows = (data as LeadRow[]) || []
      setLeads(rows)
      if (rows.length > 0) setActiveLeadId(rows[0].id)
      setLoading(false)
    }
    fetchLeads()
  }, [])

  useEffect(() => {
    if (!activeLeadId) return
    async function fetchActivities() {
      const supabase = createClient()
      const { data } = await supabase
        .from('lead_activities')
        .select('id, lead_id, type, description, agent, metadata, created_at')
        .eq('lead_id', activeLeadId)
        .in('type', ['sms', 'email', 'call'])
        .order('created_at', { ascending: true })
        .limit(100)
      setActivities((data as ActivityRow[]) || [])
    }
    fetchActivities()
  }, [activeLeadId])

  const activeLead = leads.find((l) => l.id === activeLeadId)

  const threads: ThreadPreview[] = leads.map((lead) => ({
    id: lead.id,
    name: lead.full_name || '(no name)',
    initials: getInitials(lead.full_name),
    avatarBg: lead.priority === 'hot' ? 'bg-red-900' : 'bg-slate-700',
    avatarText: 'text-white',
    address: [lead.property_address, lead.city].filter(Boolean).join(', ') || '—',
    personality: null,
    tags: lead.priority === 'hot' ? [{ label: 'Hot Lead', variant: 'hot' as const }] : [],
    lastMessage: lead.station ? `Stage: ${lead.station.replace(/_/g, ' ')}` : 'No activity yet',
    timestamp: new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    unread: false,
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
    <div className="flex h-[calc(100vh-4rem)]">
      {showNewMessage && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setShowNewMessage(false)}>
          <div className="bg-white rounded-xl p-6 shadow-2xl w-96 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">Start New Conversation</h2>
            <p className="text-sm text-slate-500 mb-4">Select a lead to open their conversation thread:</p>
            <div className="space-y-2">
              {leads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => { setActiveLeadId(lead.id); setShowNewMessage(false) }}
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
      <InboxSidebar
        threads={threads}
        activeThreadId={activeLeadId || ''}
        onSelectThread={setActiveLeadId}
        onNewMessage={() => setShowNewMessage(true)}
      />
      <ThreadView
        contact={contact}
        dateGroups={dateGroups.length > 0 ? dateGroups : [{ label: 'No messages yet', messages: [] }]}
        leadId={activeLeadId || undefined}
      />
    </div>
  )
}
