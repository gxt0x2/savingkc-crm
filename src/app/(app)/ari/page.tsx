'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useAriPage, type FollowUp, type InboxItem, type PipelineAction, type CallQueueLead } from '@/hooks/use-ari-page'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { formatPhone, toProperCase } from '@/lib/format'

// ─── Business-day lookback helpers ────────────────────────────────

// Roll back N weekdays (Mon-Fri). On Sunday with N=2, returns start of Thursday.
function startOfBusinessDaysAgo(from: Date, biz: number): Date {
  const d = new Date(from)
  let counted = 0
  // Step back one day at a time until we've counted `biz` weekdays.
  while (counted < biz) {
    d.setDate(d.getDate() - 1)
    const dow = d.getDay() // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) counted++
  }
  d.setHours(0, 0, 0, 0)
  return d
}

interface RecentLead {
  id: string
  full_name: string | null
  phone: string | null
  property_address: string | null
  city: string | null
  source: string | null
  station: string | null
  priority: string | null
  created_at: string
  motivation_score: number | null
}

// Fetch leads created in the last 2 business days (weekends excluded).
// On Sunday, this returns Thursday + Friday leads; on Monday, Friday + Thursday; etc.
function useRecentLeads() {
  const [leads, setLeads] = useState<RecentLead[]>([])
  useEffect(() => {
    const cutoff = startOfBusinessDaysAgo(new Date(), 2).toISOString()
    const supabase = createClient()
    supabase
      .from('leads')
      .select('id, full_name, phone, property_address, city, source, station, priority, created_at, motivation_score')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setLeads((data as RecentLead[]) || []))
  }, [])
  return leads
}

// ─── Helpers ─────────────────────────────────────────────────────

function greetingFor(d: Date): string {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function startOfNextDay(d: Date): Date {
  const next = new Date(d)
  next.setHours(23, 59, 59, 999)
  return next
}

function humanTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function humanDue(iso: string, now: Date): string {
  const d = new Date(iso)
  if (isSameDay(d, now)) return humanTime(iso)
  if (d < now) {
    const days = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
    return days <= 0 ? 'Overdue' : `${days}d overdue`
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function timeAgo(iso: string, now: Date): string {
  const diffMs = now.getTime() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h`
  const diffD = Math.floor(diffH / 24)
  return `${diffD}d`
}

// ─── Page ────────────────────────────────────────────────────────

export default function AriPage() {
  const data = useAriPage()
  const recentLeads = useRecentLeads()
  const now = new Date()
  const greeting = greetingFor(now)
  const todayStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // Today's schedule = tasks due today + overdue, capped to 6
  const endToday = startOfNextDay(now)
  const todaysTasks = data.followUps
    .filter((t) => t.due_date && new Date(t.due_date) <= endToday)
    .sort((a, b) => {
      const ad = a.due_date ? new Date(a.due_date).getTime() : 0
      const bd = b.due_date ? new Date(b.due_date).getTime() : 0
      return ad - bd
    })
    .slice(0, 6)

  const attention = data.pipelineActions.slice(0, 5)
  const messages = data.inboxItems.slice(0, 6)
  const queue = data.callQueue.slice(0, 5)

  const dialsPct = data.callTargets.dials > 0 ? Math.min(100, Math.round((data.callCounts.dials / data.callTargets.dials) * 100)) : 0
  const tasksPct = data.followUpTotal > 0 ? Math.round((data.followUpCompleted / data.followUpTotal) * 100) : 0

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1440px] mx-auto w-full space-y-5 pb-32">
      {/* ═══ Header: greeting, date, progress chips ═══ */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-[10px] font-black text-[#E32E2E] uppercase tracking-[0.25em]">
            {greeting}
          </span>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-[var(--ck-text)] mt-1">
            {todayStr}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <ProgressChip label="Calls" value={data.callCounts.dials} target={data.callTargets.dials} pct={dialsPct} />
          <ProgressChip label="Tasks" value={data.followUpCompleted} target={data.followUpTotal} pct={tasksPct} />
          <ProgressChip
            label="Pipeline"
            value={data.pipelineHandled}
            target={data.pipelineTotal}
            pct={data.pipelineTotal > 0 ? Math.round((data.pipelineHandled / data.pipelineTotal) * 100) : 0}
          />
        </div>
      </div>

      {/* ═══ Ari's Brief ═══ */}
      <div className="ck-card p-5 border-l-2 border-[#E32E2E]">
        <div className="flex items-center gap-1.5 mb-2">
          <Icon name="auto_awesome" size="text-xs" className="text-[#E32E2E]" />
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[var(--ck-text-muted)]">
            Ari's Brief
          </span>
        </div>
        {data.loading && !data.coaching ? (
          <div className="space-y-2">
            <div className="h-3.5 bg-white/5 rounded w-3/4 animate-pulse" />
            <div className="h-3.5 bg-white/5 rounded w-1/2 animate-pulse" />
          </div>
        ) : data.coaching ? (
          <>
            <p className="text-sm text-[var(--ck-text)] leading-relaxed">
              {data.coaching.greeting}
            </p>
            {data.coaching.nudges && data.coaching.nudges.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {data.coaching.nudges.slice(0, 3).map((n, i) => (
                  <li key={i} className="text-xs text-[var(--ck-text-muted)] flex items-start gap-2 leading-relaxed">
                    <span className="text-[#E32E2E] mt-1.5 text-[10px]">●</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-[var(--ck-text-muted)]">Start the day — pick up the first call and momentum follows.</p>
        )}
      </div>

      {/* ═══ 4-column triage grid ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Tile
          icon="calendar_today"
          title="Today's Schedule"
          count={todaysTasks.length}
          emptyMsg="Nothing due today"
          emptyIcon="event_available"
        >
          {todaysTasks.map((t) => (
            <ScheduleRow key={t.id} task={t} now={now} />
          ))}
        </Tile>

        <Tile
          icon="priority_high"
          title="Needs Attention"
          count={attention.length}
          accent
          emptyMsg="Queues clear"
          emptyIcon="check_circle"
        >
          {attention.map((a) => (
            <AttentionRow key={a.id} item={a} />
          ))}
        </Tile>

        <Tile
          icon="forum"
          title="Messages"
          count={messages.length}
          emptyMsg="Inbox empty"
          emptyIcon="mark_email_read"
        >
          {messages.map((m) => (
            <MessageRow key={m.id} msg={m} now={now} />
          ))}
        </Tile>

        <Tile
          icon="fiber_new"
          title="Fresh Leads"
          subtitle="Last 2 biz days"
          count={recentLeads.length}
          emptyMsg="No new leads"
          emptyIcon="person_add"
        >
          {recentLeads.map((l) => (
            <FreshLeadRow key={l.id} lead={l} now={now} />
          ))}
        </Tile>
      </div>

      {/* ═══ Call Block — priority queue ═══ */}
      <div className="ck-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ck-border)]">
          <div className="flex items-center gap-2">
            <Icon name="call" size="text-sm" className="text-[#E32E2E]" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[var(--ck-text-muted)]">
              Call Block
            </span>
            <span className="text-[10px] text-[var(--ck-text-dim)]">
              {data.callCounts.dials} / {data.callTargets.dials} dials · {data.callCounts.contacts} contacts
            </span>
          </div>
          <Link
            href="/opportunities"
            className="text-[10px] font-bold text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] transition-colors uppercase tracking-wider"
          >
            View Hot Opps →
          </Link>
        </div>
        {queue.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--ck-text-dim)]">
            Queue empty — add leads via Hot Opps or Mojo sync
          </div>
        ) : (
          <div className="divide-y divide-[var(--ck-border)]">
            {queue.map((lead, i) => (
              <CallRow key={lead.id} lead={lead} rank={i + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Presentational ──────────────────────────────────────────────

function ProgressChip({ label, value, target, pct }: { label: string; value: number; target: number; pct: number }) {
  const ring = pct >= 100 ? 'text-emerald-400' : pct >= 50 ? 'text-[#E32E2E]' : 'text-[var(--ck-text-dim)]'
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full ck-card-elev">
      <span className="text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-muted)]">{label}</span>
      <span className="text-xs font-black tabular-nums text-[var(--ck-text)]">
        {value}
        <span className="text-[var(--ck-text-dim)]">/{target}</span>
      </span>
      <span className={`text-[10px] font-bold tabular-nums ${ring}`}>{pct}%</span>
    </div>
  )
}

function Tile({
  icon,
  title,
  subtitle,
  count,
  accent,
  emptyMsg,
  emptyIcon,
  children,
}: {
  icon: string
  title: string
  subtitle?: string
  count: number
  accent?: boolean
  emptyMsg: string
  emptyIcon: string
  children: React.ReactNode
}) {
  return (
    <div className={`ck-card overflow-hidden ${accent ? 'border-l-2 border-[#E32E2E]' : ''}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ck-border)]">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name={icon} size="text-sm" className={accent ? 'text-[#E32E2E]' : 'text-[var(--ck-text-muted)]'} />
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[var(--ck-text-muted)] truncate">
            {title}
          </span>
          {subtitle && (
            <span className="text-[9px] font-bold text-[var(--ck-text-dim)] truncate hidden sm:inline">· {subtitle}</span>
          )}
        </div>
        {count > 0 && (
          <span className={`text-[10px] font-black tabular-nums px-2 py-0.5 rounded-full flex-shrink-0 ${accent ? 'bg-[#E32E2E] text-white' : 'bg-white/5 text-[var(--ck-text)]'}`}>
            {count}
          </span>
        )}
      </div>
      {count === 0 ? (
        <div className="px-4 py-8 text-center">
          <Icon name={emptyIcon} size="text-2xl" className="text-[var(--ck-text-dim)] block mx-auto mb-2" />
          <p className="text-xs text-[var(--ck-text-dim)]">{emptyMsg}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--ck-border)]">{children}</ul>
      )}
    </div>
  )
}

function ScheduleRow({ task, now }: { task: FollowUp; now: Date }) {
  const overdue = task.is_overdue || (task.due_date && new Date(task.due_date) < now)
  const href = task.lead_id ? `/leads/${task.lead_id}` : '#'
  return (
    <li>
      <Link href={href} className="block px-4 py-3 hover:bg-white/5 transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[var(--ck-text)] truncate">{task.title}</p>
            {task.lead_name && (
              <p className="text-[11px] text-[var(--ck-text-muted)] truncate">
                {toProperCase(task.lead_name)}
              </p>
            )}
          </div>
          <span className={`text-[10px] font-black tabular-nums whitespace-nowrap ${overdue ? 'text-[#E32E2E]' : 'text-[var(--ck-text-muted)]'}`}>
            {task.due_date ? humanDue(task.due_date, now) : ''}
          </span>
        </div>
      </Link>
    </li>
  )
}

function AttentionRow({ item }: { item: PipelineAction }) {
  return (
    <li>
      <Link href={`/leads/${item.id}`} className="block px-4 py-3 hover:bg-white/5 transition-colors">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[var(--ck-text)] truncate">
              {toProperCase(item.full_name)}
            </p>
            <p className="text-[11px] text-[var(--ck-text-muted)] truncate leading-snug">
              {item.action_detail || item.action_label}
            </p>
          </div>
          <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#E32E2E]/15 text-[#E32E2E] whitespace-nowrap">
            {item.action_label}
          </span>
        </div>
      </Link>
    </li>
  )
}

function MessageRow({ msg, now }: { msg: InboxItem; now: Date }) {
  const isCall = msg.type === 'missed_call'
  return (
    <li>
      <Link href={`/leads/${msg.lead_id}`} className="block px-4 py-3 hover:bg-white/5 transition-colors">
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isCall ? 'bg-[#E32E2E]/15 text-[#E32E2E]' : 'bg-emerald-500/15 text-emerald-400'}`}>
            <Icon name={isCall ? 'missed_call_badge' : 'chat'} size="text-sm" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--ck-text)] truncate">
                {toProperCase(msg.lead_name)}
              </p>
              <span className="text-[9px] font-bold tabular-nums text-[var(--ck-text-dim)] whitespace-nowrap">
                {timeAgo(msg.created_at, now)}
              </span>
            </div>
            {msg.message ? (
              <p className="text-[11px] text-[var(--ck-text-muted)] truncate leading-snug mt-0.5">
                {msg.message}
              </p>
            ) : msg.phone ? (
              <p className="text-[11px] text-[var(--ck-text-muted)] truncate leading-snug mt-0.5">
                {formatPhone(msg.phone)}
              </p>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  )
}

function FreshLeadRow({ lead, now }: { lead: RecentLead; now: Date }) {
  const dateStr = new Date(lead.created_at).toLocaleDateString('en-US', { weekday: 'short' })
  const hot = lead.priority === 'hot' || (lead.motivation_score !== null && lead.motivation_score >= 7)
  return (
    <li>
      <Link href={`/leads/${lead.id}`} className="block px-4 py-3 hover:bg-white/5 transition-colors">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <p className="text-xs font-semibold text-[var(--ck-text)] truncate">
                {toProperCase(lead.full_name || 'Unknown')}
              </p>
              {hot && (
                <Icon name="local_fire_department" size="text-xs" className="text-[#E32E2E] flex-shrink-0" />
              )}
            </div>
            <p className="text-[11px] text-[var(--ck-text-muted)] truncate leading-snug">
              {lead.property_address || (lead.phone ? formatPhone(lead.phone) : lead.source || 'No details')}
            </p>
          </div>
          <span className="text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)] whitespace-nowrap tabular-nums">
            {dateStr}
          </span>
        </div>
      </Link>
    </li>
  )
}

function CallRow({ lead, rank }: { lead: CallQueueLead; rank: number }) {
  function handleCall(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!lead.phone) return
    window.dispatchEvent(new CustomEvent('open-dialer', {
      detail: { phone: lead.phone, leadId: lead.id, name: lead.full_name },
    }))
  }
  return (
    <div className="flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors">
      <div className="w-6 text-center text-[10px] font-black text-[var(--ck-text-dim)] tabular-nums">
        {rank}
      </div>
      <Link href={`/leads/${lead.id}`} className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-xs font-semibold text-[var(--ck-text)] truncate">
            {toProperCase(lead.full_name)}
          </p>
          {lead.priority === 'hot' && (
            <Icon name="local_fire_department" size="text-xs" className="text-[#E32E2E] flex-shrink-0" />
          )}
        </div>
        <p className="text-[11px] text-[var(--ck-text-muted)] truncate leading-snug">
          {lead.reason || lead.property_address || formatPhone(lead.phone)}
        </p>
      </Link>
      <div className="hidden sm:flex items-center gap-1 text-[10px] text-[var(--ck-text-dim)] whitespace-nowrap">
        <span className="tabular-nums font-black text-[var(--ck-text-muted)]">{lead.score}</span>
      </div>
      <button
        onClick={handleCall}
        disabled={!lead.phone}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#E32E2E] text-white font-bold text-[11px] hover:bg-[#C42626] transition-colors disabled:opacity-40"
      >
        <Icon name="call" size="text-xs" />
        Call
      </button>
    </div>
  )
}
