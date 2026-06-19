'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { CONVERSATION_TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { formatPhone, toProperCase } from '@/lib/format'

type HubFilter = 'recents' | 'unread' | 'starred' | 'all'
type ComposeMode = 'sms' | 'email'

interface HubLead {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  station: string | null
  priority: string | null
  assigned_agent: string | null
  created_at: string
  updated_at: string | null
}

interface HubActivity {
  id: string
  lead_id: string | null
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface HubThread {
  id: string
  lead: HubLead | null
  phone: string | null
  name: string
  initials: string
  lastActivity: HubActivity | null
  unread: boolean
  starred: boolean
  activities: HubActivity[]
}

const COMM_TYPES = ['sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound', 'email', 'call', 'voicemail']
const SMS_TYPES = new Set(['sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound'])
const DEFAULT_FROM_PHONE = CONVERSATION_TWILIO_NUMBERS[0]?.value || '+18163077835'

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function activityMetadata(activity: HubActivity): Record<string, unknown> {
  return activity.metadata || {}
}

function activityDirection(activity: HubActivity): 'inbound' | 'outbound' {
  const direction = textValue(activityMetadata(activity).direction)?.toLowerCase()
  if (direction === 'inbound' || direction === 'received' || direction === 'in') return 'inbound'
  if (activity.activity_type === 'sms_received' || activity.activity_type === 'sms_inbound') return 'inbound'
  return 'outbound'
}

function isSmsActivity(activity: HubActivity): boolean {
  return SMS_TYPES.has(activity.activity_type)
}

function activityBody(activity: HubActivity): string {
  const meta = activityMetadata(activity)
  return textValue(meta.body) || textValue(meta.message) || activity.description || ''
}

function activityPhone(activity: HubActivity, fallback: string | null): string | null {
  const meta = activityMetadata(activity)
  return textValue(meta.from) || textValue(meta.to) || fallback
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '??'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function displayName(lead: HubLead | null, phone: string | null): string {
  if (lead?.full_name && lead.full_name !== lead.phone) return toProperCase(lead.full_name)
  return formatPhone(phone || lead?.phone || '') || 'Unknown Seller'
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fullTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function dayLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function durationLabel(value: unknown): string {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function threadSnippet(activity: HubActivity | null): string {
  if (!activity) return 'No conversation yet'
  if (activity.activity_type === 'call') return activityDirection(activity) === 'inbound' ? 'Inbound call' : 'Outbound call'
  if (activity.activity_type === 'voicemail') return 'Voicemail'
  if (activity.activity_type === 'email') return activityBody(activity) || 'Email'
  return activityBody(activity) || 'Text message'
}

function groupByDay(activities: HubActivity[]): Array<{ day: string; items: HubActivity[] }> {
  const groups: Array<{ day: string; items: HubActivity[] }> = []
  for (const activity of activities) {
    const day = dayLabel(activity.created_at)
    const last = groups[groups.length - 1]
    if (last?.day === day) last.items.push(activity)
    else groups.push({ day, items: [activity] })
  }
  return groups
}

function buildThreadForLead(lead: HubLead, activities: HubActivity[]): HubThread {
  const sorted = activities.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const lastActivity = sorted[0] || null
  return {
    id: lead.id,
    lead,
    phone: lead.phone,
    name: displayName(lead, lead.phone),
    initials: getInitials(lead.full_name || lead.phone),
    lastActivity,
    unread: Boolean(lastActivity && activityDirection(lastActivity) === 'inbound'),
    starred: lead.priority === 'hot' || lead.priority === 'high',
    activities: sorted,
  }
}

function buildUnmatchedThread(phone: string, activities: HubActivity[]): HubThread {
  const sorted = activities.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  return {
    id: `unmatched:${phone}`,
    lead: null,
    phone,
    name: formatPhone(phone) || phone,
    initials: getInitials(phone),
    lastActivity: sorted[0] || null,
    unread: true,
    starred: false,
    activities: sorted,
  }
}

export function DialerConversationHub({
  agent = 'Ernest',
  defaultFromPhone,
}: {
  agent?: string
  defaultFromPhone?: string | null
}) {
  const router = useRouter()
  const [threads, setThreads] = useState<HubThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [activeActivities, setActiveActivities] = useState<HubActivity[]>([])
  const [filter, setFilter] = useState<HubFilter>('recents')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [composeMode, setComposeMode] = useState<ComposeMode>('sms')
  const [message, setMessage] = useState('')
  const [fromPhone, setFromPhone] = useState(defaultFromPhone || DEFAULT_FROM_PHONE)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const activeThread = useMemo(() => {
    return threads.find((thread) => thread.id === activeThreadId) || threads[0] || null
  }, [activeThreadId, threads])

  const loadThreads = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: activityError } = await supabase
        .from('lead_activities')
        .select('id, lead_id, activity_type, description, agent, metadata, created_at')
        .in('activity_type', COMM_TYPES)
        .order('created_at', { ascending: false })
        .limit(900)
      if (activityError) throw new Error(activityError.message)

      const activityRows = (data || []) as HubActivity[]
      const leadIds = Array.from(new Set(activityRows.map((activity) => activity.lead_id).filter(Boolean) as string[]))
      let leads: HubLead[] = []
      if (leadIds.length > 0) {
        const { data: leadRows, error: leadError } = await supabase
          .from('leads')
          .select('id, full_name, phone, email, property_address, city, state, zip, county, station, priority, assigned_agent, created_at, updated_at')
          .in('id', leadIds)
        if (leadError) throw new Error(leadError.message)
        leads = (leadRows || []) as HubLead[]
      }

      const leadById = new Map(leads.map((lead) => [lead.id, lead]))

      const activitiesByLead = new Map<string, HubActivity[]>()
      for (const activity of activityRows) {
        if (!activity.lead_id) continue
        activitiesByLead.set(activity.lead_id, [...(activitiesByLead.get(activity.lead_id) || []), activity])
      }

      const unmatchedByPhone = new Map<string, HubActivity[]>()
      for (const activity of activityRows) {
        if (activity.lead_id && leadById.has(activity.lead_id)) continue
        const phone = activityPhone(activity, null)
        if (!phone) continue
        unmatchedByPhone.set(phone, [...(unmatchedByPhone.get(phone) || []), activity])
      }

      const nextThreads = [
        ...Array.from(unmatchedByPhone.entries()).map(([phone, activities]) => buildUnmatchedThread(phone, activities)),
        ...leads.map((lead) => buildThreadForLead(lead, activitiesByLead.get(lead.id) || [])),
      ].sort((a, b) => {
        const aTime = new Date(a.lastActivity?.created_at || a.lead?.updated_at || a.lead?.created_at || 0).getTime()
        const bTime = new Date(b.lastActivity?.created_at || b.lead?.updated_at || b.lead?.created_at || 0).getTime()
        return bTime - aTime
      })

      setThreads(nextThreads)
      setActiveThreadId((current) => current && nextThreads.some((thread) => thread.id === current)
        ? current
        : nextThreads[0]?.id || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load conversations.')
      setThreads([])
      setActiveThreadId(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadActiveActivities = useCallback(async () => {
    if (!activeThread) {
      setActiveActivities([])
      return
    }

    const supabase = createClient()
    if (activeThread.id.startsWith('unmatched:')) {
      const orphanLeadId = activeThread.activities.find((activity) => activity.lead_id)?.lead_id
      if (orphanLeadId) {
        const { data } = await supabase
          .from('lead_activities')
          .select('id, lead_id, activity_type, description, agent, metadata, created_at')
          .eq('lead_id', orphanLeadId)
          .in('activity_type', COMM_TYPES)
          .order('created_at', { ascending: true })
          .limit(120)
        setActiveActivities((data || []) as HubActivity[])
        return
      }

      const phone = activeThread.phone
      const { data } = await supabase
        .from('lead_activities')
        .select('id, lead_id, activity_type, description, agent, metadata, created_at')
        .is('lead_id', null)
        .in('activity_type', COMM_TYPES)
        .order('created_at', { ascending: true })
        .limit(120)
      const filtered = ((data || []) as HubActivity[]).filter((activity) => {
        const meta = activityMetadata(activity)
        return meta.from === phone || meta.to === phone
      })
      setActiveActivities(filtered)
      return
    }

    const { data } = await supabase
      .from('lead_activities')
      .select('id, lead_id, activity_type, description, agent, metadata, created_at')
      .eq('lead_id', activeThread.id)
      .in('activity_type', COMM_TYPES)
      .order('created_at', { ascending: true })
      .limit(120)
    setActiveActivities((data || []) as HubActivity[])
  }, [activeThread])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  useEffect(() => {
    void loadActiveActivities()
  }, [loadActiveActivities])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [activeThreadId, activeActivities.length])

  useEffect(() => {
    if (!activeThread) return
    const supabase = createClient()
    const channel = supabase
      .channel(`dialer-home-conversation-${activeThread.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'lead_activities',
          ...(activeThread.id.startsWith('unmatched:') ? {} : { filter: `lead_id=eq.${activeThread.id}` }),
        },
        () => {
          void loadActiveActivities()
          void loadThreads()
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeThread, loadActiveActivities, loadThreads])

  useEffect(() => {
    setMessage('')
    setSendError(null)
    setComposeMode('sms')
    setFromPhone(defaultFromPhone || DEFAULT_FROM_PHONE)
  }, [activeThreadId, defaultFromPhone])

  const filteredThreads = useMemo(() => {
    const query = search.trim().toLowerCase()
    return threads.filter((thread) => {
      if (filter === 'unread' && !thread.unread) return false
      if (filter === 'starred' && !thread.starred) return false
      if (query) {
        const haystack = [
          thread.name,
          thread.phone,
          thread.lead?.email,
          thread.lead?.property_address,
          thread.lead?.city,
          thread.lead?.county,
          threadSnippet(thread.lastActivity),
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [filter, search, threads])

  const replyFromPhone = useMemo(() => {
    const lastInbound = activeActivities.slice().reverse().find((activity) => (
      isSmsActivity(activity) &&
      activityDirection(activity) === 'inbound' &&
      textValue(activityMetadata(activity).to)
    ))
    return textValue(lastInbound ? activityMetadata(lastInbound).to : null) || defaultFromPhone || DEFAULT_FROM_PHONE
  }, [activeActivities, defaultFromPhone])

  useEffect(() => {
    setFromPhone(replyFromPhone)
  }, [replyFromPhone])

  const fromPhoneOptions = useMemo(() => {
    const options: Array<{ label: string; value: string }> = CONVERSATION_TWILIO_NUMBERS.map(({ label, value }) => ({ label, value }))
    const extras = [replyFromPhone, defaultFromPhone].filter(Boolean) as string[]
    for (const value of extras.reverse()) {
      if (!options.some((option) => option.value === value)) {
        options.unshift({
          value,
          label: `${formatPhone(value) || value} - active conversation line`,
        })
      }
    }
    return options
  }, [defaultFromPhone, replyFromPhone])

  const groupedActivities = useMemo(() => groupByDay(activeActivities), [activeActivities])
  const threadPhone = activeThread?.phone || activeThread?.lead?.phone || null
  const activeLeadId = activeThread?.id.startsWith('unmatched:') ? null : activeThread?.id || null

  async function handleSend() {
    const body = message.trim()
    if (!activeThread || !body || sending) return
    if (composeMode === 'sms' && !threadPhone) {
      setSendError('No seller phone number is attached.')
      return
    }
    if (composeMode === 'email' && !activeThread.lead?.email) {
      setSendError('No seller email is attached.')
      return
    }

    setSending(true)
    setSendError(null)
    try {
      const response = await fetch('/api/conversations/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(composeMode === 'sms'
          ? {
              leadId: activeLeadId,
              phone: threadPhone,
              body,
              mode: 'sms',
              fromPhone,
              agent,
            }
          : {
              leadId: activeLeadId,
              to: activeThread.lead?.email,
              body,
              mode: 'email',
              subject: 'Message from Saving KC',
              agent,
            }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Send failed')

      setMessage('')
      await loadActiveActivities()
      await loadThreads()
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void handleSend()
    }
  }

  const tabs: Array<{ id: HubFilter; label: string; count?: number }> = [
    { id: 'unread', label: 'Unread', count: threads.filter((thread) => thread.unread).length },
    { id: 'recents', label: 'Recents' },
    { id: 'starred', label: 'Starred', count: threads.filter((thread) => thread.starred).length },
    { id: 'all', label: 'All', count: threads.length },
  ]

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)]">
      <div className="border-b border-[var(--ck-border)] px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-full overflow-hidden rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-1 sm:w-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wider transition-colors sm:flex-none ${
                  filter === tab.id
                    ? 'bg-[#E32E2E] text-white'
                    : 'text-[var(--ck-text-dim)] hover:text-[var(--ck-text)]'
                }`}
              >
                {tab.label}{typeof tab.count === 'number' ? ` ${tab.count}` : ''}
              </button>
            ))}
          </div>
          <div className="relative w-full lg:max-w-[320px]">
            <Icon name="search" size="text-base" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ck-text-dim)]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations"
              className="h-10 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] pl-9 pr-3 text-sm text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
            />
          </div>
        </div>
      </div>

      <div className="grid min-h-[720px] lg:grid-cols-[330px_minmax(0,1fr)_290px]">
        <aside className="border-b border-[var(--ck-border)] lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-[var(--ck-border)] px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">{filteredThreads.length} Results</p>
            <button
              type="button"
              onClick={() => void loadThreads()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ck-border)] text-[var(--ck-text-muted)] transition-colors hover:text-[var(--ck-text)]"
              title="Refresh"
              aria-label="Refresh conversations"
            >
              <Icon name="refresh" size="text-base" />
            </button>
          </div>
          <div className="max-h-[656px] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-sm text-[var(--ck-text-muted)]">Loading...</div>
            ) : error ? (
              <div className="p-5 text-sm font-semibold text-[#ff7777]">{error}</div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--ck-text-muted)]">No conversations match.</div>
            ) : (
              filteredThreads.map((thread) => {
                const active = thread.id === activeThread?.id
                return (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => setActiveThreadId(thread.id)}
                    className={`grid w-full grid-cols-[38px_minmax(0,1fr)_42px] gap-3 border-b border-[var(--ck-border)] px-4 py-3 text-left transition-colors ${
                      active ? 'bg-[#E32E2E]/12 ring-1 ring-inset ring-[#E32E2E]/35' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-black ${
                      thread.unread ? 'bg-cyan-500/20 text-cyan-200' : 'bg-[var(--ck-surface-hi)] text-[var(--ck-text-muted)]'
                    }`}>
                      {thread.initials}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-black text-[var(--ck-text)]">{thread.name}</span>
                        {thread.starred && <Icon name="star" size="text-xs" className="text-amber-300" filled />}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-[var(--ck-text-muted)]">{threadSnippet(thread.lastActivity)}</span>
                      <span className="mt-1 block truncate text-[10px] text-[var(--ck-text-dim)]">
                        {thread.lead?.property_address || formatPhone(thread.phone || '') || 'Unmatched conversation'}
                      </span>
                    </span>
                    <span className="pt-0.5 text-right text-[10px] font-bold text-[var(--ck-text-dim)]">{timeAgo(thread.lastActivity?.created_at || thread.lead?.updated_at || thread.lead?.created_at)}</span>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <main className="flex min-h-[720px] min-w-0 flex-col border-b border-[var(--ck-border)] lg:border-b-0 lg:border-r">
          {activeThread ? (
            <>
              <header className="flex flex-col gap-3 border-b border-[var(--ck-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-lg font-black text-[var(--ck-text)]">{activeThread.name}</p>
                  <p className="mt-1 truncate text-xs text-[var(--ck-text-muted)]">
                    {formatPhone(threadPhone || '') || 'No phone'}{activeThread.lead?.property_address ? ` - ${activeThread.lead.property_address}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {activeLeadId && (
                    <button
                      type="button"
                      onClick={() => router.push(`/leads/${activeLeadId}`)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]"
                    >
                      <Icon name="open_in_new" size="text-sm" /> Lead
                    </button>
                  )}
                  {activeLeadId && (
                    <button
                      type="button"
                      onClick={() => router.push(`/dialer?lead_ids=${activeLeadId}&return_to=/dialer`)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#E32E2E] px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-[#C42626]"
                    >
                      <Icon name="call" size="text-sm" /> Dial
                    </button>
                  )}
                </div>
              </header>

              <div ref={scrollRef} className="flex-1 overflow-y-auto bg-black/15 px-5 py-5">
                {groupedActivities.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-[var(--ck-text-dim)]">No messages yet.</div>
                ) : (
                  <div className="space-y-6">
                    {groupedActivities.map((group) => (
                      <div key={group.day} className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1 bg-[var(--ck-border)]" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">{group.day}</span>
                          <div className="h-px flex-1 bg-[var(--ck-border)]" />
                        </div>
                        {group.items.map((activity) => (
                          <ConversationEvent key={activity.id} activity={activity} initials={activeThread.initials} phone={threadPhone} />
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <footer className="border-t border-[var(--ck-border)] bg-[var(--ck-surface)]">
                <div className="flex items-center gap-1 px-5 pt-3">
                  {(['sms', 'email'] as ComposeMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setComposeMode(mode)
                        setSendError(null)
                      }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                        composeMode === mode
                          ? 'bg-[#E32E2E] text-white'
                          : 'text-[var(--ck-text-muted)] hover:bg-white/[0.04] hover:text-[var(--ck-text)]'
                      }`}
                    >
                      Send {mode.toUpperCase()}
                    </button>
                  ))}
                  {composeMode === 'sms' && (
                    <select
                      value={fromPhone}
                      onChange={(event) => setFromPhone(event.target.value)}
                      className="ml-auto max-w-[230px] rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1.5 text-xs font-semibold text-[var(--ck-text)]"
                    >
                      {fromPhoneOptions.map((number) => (
                        <option key={number.value} value={number.value}>{number.label}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="flex items-end gap-3 px-5 py-3">
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    rows={3}
                    placeholder={composeMode === 'sms' ? 'Type a text...' : 'Write an email...'}
                    className="min-h-[82px] flex-1 resize-none rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2.5 text-sm text-[var(--ck-text)] placeholder:text-[var(--ck-text-dim)] outline-none focus:border-[#E32E2E]"
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || !message.trim()}
                    className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#E32E2E] text-white transition-colors hover:bg-[#C42626] disabled:cursor-not-allowed disabled:opacity-35"
                    title="Send"
                    aria-label="Send"
                  >
                    {sending ? <Icon name="progress_activity" size="text-lg" className="animate-spin" /> : <Icon name="send" size="text-lg" />}
                  </button>
                </div>
                {sendError && <p className="px-5 pb-3 text-xs font-bold text-[#ff7777]">{sendError}</p>}
              </footer>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--ck-text-muted)]">Select a conversation.</div>
          )}
        </main>

        <aside className="min-h-[360px] bg-[var(--ck-surface)] px-5 py-5">
          {activeThread ? (
            <SellerRail thread={activeThread} onOpenLead={() => activeLeadId && router.push(`/leads/${activeLeadId}`)} />
          ) : (
            <p className="text-sm text-[var(--ck-text-muted)]">No seller selected.</p>
          )}
        </aside>
      </div>
    </section>
  )
}

function ConversationEvent({ activity, initials, phone }: { activity: HubActivity; initials: string; phone: string | null }) {
  const inbound = activityDirection(activity) === 'inbound'
  const body = activityBody(activity)
  const meta = activityMetadata(activity)

  if (activity.activity_type === 'call' || activity.activity_type === 'voicemail') {
    return (
      <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
        <div className="max-w-[520px] rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className={`flex h-9 w-9 items-center justify-center rounded-full ${inbound ? 'bg-cyan-500/20 text-cyan-200' : 'bg-[#E32E2E]/15 text-[#ff7777]'}`}>
              <Icon name={activity.activity_type === 'voicemail' ? 'voicemail' : inbound ? 'call_received' : 'call_made'} size="text-lg" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-[var(--ck-text)]">{inbound ? 'Inbound Call' : 'Outbound Call'}</p>
              <p className="mt-0.5 text-xs text-[var(--ck-text-muted)]">
                {formatPhone(activityPhone(activity, phone) || '') || 'Unknown number'} - {fullTime(activity.created_at)}
              </p>
            </div>
            <div className="w-36 rounded-lg bg-[var(--ck-surface)] px-3 py-2">
              <div className="h-1.5 rounded-full bg-[var(--ck-border)]">
                <div className="h-full w-1/3 rounded-full bg-[#E32E2E]" />
              </div>
              <p className="mt-1 text-center font-mono text-[10px] text-[var(--ck-text-dim)]">{durationLabel(meta.duration || meta.duration_seconds)}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (activity.activity_type === 'email') {
    return (
      <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
        <div className="max-w-[560px] rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-4 py-3">
          <p className="text-xs font-black uppercase tracking-wider text-[var(--ck-text-dim)]">{inbound ? 'Email received' : 'Email sent'}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--ck-text)]">{body || 'Email'}</p>
          <p className="mt-2 text-[10px] text-[var(--ck-text-dim)]">{fullTime(activity.created_at)}{activity.agent ? ` - ${activity.agent}` : ''}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
      <div className={`flex max-w-[74%] gap-2 ${inbound ? '' : 'flex-row-reverse'}`}>
        <span className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${inbound ? 'bg-cyan-500/20 text-cyan-100' : 'bg-emerald-500/20 text-emerald-100'}`}>
          {inbound ? initials : 'SK'}
        </span>
        <div>
          <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${inbound ? 'rounded-bl-md bg-[var(--ck-surface-elev)] text-[var(--ck-text)]' : 'rounded-br-md bg-[#2787ff] text-white'}`}>
            <p className="whitespace-pre-wrap break-words">{body || '[empty message]'}</p>
          </div>
          <p className={`mt-1 px-1 text-[10px] text-[var(--ck-text-dim)] ${inbound ? 'text-left' : 'text-right'}`}>
            {inbound ? 'Seller' : activity.agent || 'Saving KC'} - {fullTime(activity.created_at)}
          </p>
        </div>
      </div>
    </div>
  )
}

function SellerRail({ thread, onOpenLead }: { thread: HubThread; onOpenLead: () => void }) {
  const lead = thread.lead
  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-cyan-500/20 text-2xl font-black text-cyan-100">
          {thread.initials}
        </div>
        <p className="mt-3 truncate text-lg font-black text-[var(--ck-text)]">{thread.name}</p>
        <p className="mt-1 text-xs font-semibold text-[var(--ck-text-muted)]">{lead?.assigned_agent || 'Unassigned'}</p>
      </div>

      <div className="space-y-2 border-t border-[var(--ck-border)] pt-4">
        <RailLine icon="call" value={formatPhone(thread.phone || lead?.phone || '') || 'No phone'} />
        <RailLine icon="mail" value={lead?.email || 'No email'} />
        <RailLine icon="location_on" value={[lead?.property_address, lead?.city, lead?.state].filter(Boolean).join(', ') || 'No property'} />
        <RailLine icon="sell" value={lead?.station ? lead.station.replace(/_/g, ' ') : 'No stage'} />
      </div>

      <div className="grid gap-2 border-t border-[var(--ck-border)] pt-4">
        {lead && (
          <button
            type="button"
            onClick={onOpenLead}
            className="rounded-xl bg-[#2787ff] px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-[#126fe5]"
          >
            Open Lead
          </button>
        )}
        {lead && (
          <a
            href={`/dialer?lead_ids=${lead.id}&return_to=/dialer`}
            className="rounded-xl bg-[#E32E2E] px-4 py-2.5 text-center text-sm font-black text-white transition-colors hover:bg-[#C42626]"
          >
            Start Dialer
          </a>
        )}
      </div>
    </div>
  )
}

function RailLine({ icon, value }: { icon: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg px-1 py-2 text-sm text-[var(--ck-text-muted)]">
      <Icon name={icon} size="text-base" className="mt-0.5 text-[var(--ck-text-dim)]" />
      <span className="min-w-0 break-words">{value}</span>
    </div>
  )
}
