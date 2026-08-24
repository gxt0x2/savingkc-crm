'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useMemo } from 'react'

import { CommsSummaryBar, CommsTimeline } from '@/components/leads/comms-timeline'
import { Icon } from '@/components/ui/icon'
import type {
  ProspectingCallingLead,
  ProspectingCallingProspect,
  ProspectingCallingTab,
  ProspectingOccupancy,
  ProspectingRecentCall,
} from '@/components/prospecting/prospecting-calling-types'
import { buildCommsTimeline, summarizeComms } from '@/lib/comms-timeline'
import { formatPhone, toProperCase } from '@/lib/format'
import type { DialerActivity } from '@/lib/dialer-lead-activity'

const DialerAiAssist = dynamic(() => import('@/components/dialer/dialer-ai-assist').then((module) => module.DialerAiAssist))
const SmsThreadPanel = dynamic(() => import('@/components/leads/sms-thread-panel').then((module) => module.SmsThreadPanel))

interface ProspectingCallingContextRailProps {
  leadId: string
  lead: ProspectingCallingLead | null
  prospect: ProspectingCallingProspect | null
  ownerName: string
  situsAddress: string
  coOwners: string[]
  occupancy: ProspectingOccupancy | null
  delinquentYears: string | null
  durableSessionId: string
  activities: DialerActivity[]
  recentCalls: ProspectingRecentCall[]
  activeTab: ProspectingCallingTab
  callerId: string
  currentIndex: number
  queueSize: number
  onTabChange: (tab: ProspectingCallingTab) => void
  onRefreshActivities: () => void
}

function compactDollars(value: number | null | undefined): string {
  if (!value || value <= 0) return '—'
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`
  return `$${value.toLocaleString()}`
}

function formatActivityTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function callDirection(metadata: Record<string, unknown> | null): 'inbound' | 'outbound' | 'unknown' {
  const direction = (metadata as { direction?: string } | null)?.direction
  if (direction === 'inbound') return 'inbound'
  if (direction === 'outbound') return 'outbound'
  return 'unknown'
}

function callLegSummary(call: ProspectingRecentCall): string {
  const metadata = (call.metadata || {}) as { from?: string; to?: string }
  const direction = callDirection(call.metadata)
  const from = typeof metadata.from === 'string' ? metadata.from : null
  const to = typeof metadata.to === 'string' ? metadata.to : call.phone
  if (direction === 'outbound' && to) return `To ${formatPhone(to)}`
  if (direction === 'inbound' && from && to) return `From ${formatPhone(from)} → To ${formatPhone(to)}`
  if (direction === 'inbound' && from) return `From ${formatPhone(from)}`
  return to ? formatPhone(to) : 'Unknown number'
}

function RecentCalls({ calls }: { calls: ProspectingRecentCall[] }) {
  if (calls.length === 0) return <p className="py-4 text-center text-xs italic text-[var(--ck-text-dim)]">No recent calls logged yet.</p>

  return <ul className="space-y-2.5">{calls.map((call) => {
    const metadata = (call.metadata ?? {}) as {
      duration?: number
      disposition?: string
      outcome?: string
      status?: string
      callStatus?: string
      dialStatus?: string
    }
    const direction = callDirection(call.metadata)
    const noAnswer = metadata.disposition === 'no_answer' || metadata.outcome === 'missed' || ['no-answer', 'busy'].includes(metadata.callStatus || '') || ['no-answer', 'busy'].includes(metadata.dialStatus || '')
    const missedCall = metadata.outcome === 'missed' || metadata.callStatus === 'no-answer' || metadata.dialStatus === 'no-answer'
    const completed = metadata.status === 'completed' || (metadata.duration ?? 0) > 0 || metadata.disposition === 'answered' || metadata.outcome === 'connected'
    const pending = ['initiated', 'ringing', 'queued'].includes(metadata.status || '')
    const voicemail = ['voicemail_left', 'left_voicemail'].includes(metadata.disposition || '')
    const tone = direction === 'outbound'
      ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400'
      : direction === 'inbound'
        ? 'bg-cyan-500/15 border-cyan-500/25 text-cyan-300'
        : 'bg-[var(--ck-surface-elev)] border-[var(--ck-border)] text-[var(--ck-text-muted)]'
    const details = [callLegSummary(call), call.agent, metadata.disposition?.replace(/_/g, ' ')].filter(Boolean).join(' · ')
    const icon = direction === 'outbound' ? 'call_made' : direction === 'inbound' ? 'call_received' : 'call'

    return <li key={call.id} className="flex items-start gap-3">
      <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${tone}`}><Icon name={icon} size="text-xl" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2"><p className="truncate text-sm font-semibold text-[var(--ck-text)]">{call.lead_name || call.phone || 'Unknown'}</p><span className="shrink-0 text-[10px] text-[var(--ck-text-dim)]">{formatActivityTime(call.created_at)}</span></div>
        <p className="truncate text-[11px] text-[var(--ck-text-muted)]">{details}</p>
      </div>
      {noAnswer ? <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10"><Icon name={missedCall ? 'missed_call_badge' : 'no_answer_badge'} size="text-xl" /></span>
        : voicemail ? <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-300"><Icon name="support_agent" size="text-xl" /></span>
          : completed ? <span className="inline-flex min-w-[62px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-2 py-1.5 text-emerald-300"><Icon name="check_circle" size="text-base" /><span className="text-xs font-bold tabular-nums">{(metadata.duration ?? 0) > 0 ? `${Math.floor((metadata.duration ?? 0) / 60)}:${String((metadata.duration ?? 0) % 60).padStart(2, '0')}` : 'done'}</span></span>
            : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)]"><Icon name={pending ? 'more_horiz' : 'help'} size="text-xl" /></span>}
    </li>
  })}</ul>
}

export function ProspectingCallingContextRail(props: ProspectingCallingContextRailProps) {
  const commsEvents = useMemo(() => buildCommsTimeline(props.activities), [props.activities])
  const commsSummary = useMemo(() => summarizeComms(commsEvents), [commsEvents])

  return <aside className="order-2 col-span-12 space-y-4 lg:col-span-4">
    <section className="ck-card p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Subject property</p>
          <h1 className="truncate text-xl font-black leading-tight text-[var(--ck-text)]">{props.prospect?.situs_street || props.lead?.property_address || '—'}</h1>
          <p className="mt-0.5 text-sm text-[var(--ck-text-muted)]">{[props.prospect?.situs_city || props.lead?.city, props.prospect?.situs_state || props.lead?.state].filter(Boolean).join(', ')}{(props.prospect?.situs_zip || props.lead?.zip) ? ` ${props.prospect?.situs_zip || props.lead?.zip}` : ''}</p>
        </div>
        <Link href={`/leads/${props.leadId}`} prefetch={false} target="_blank" title="Open full lead profile in a new tab" className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--ck-border)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]">Profile <Icon name="open_in_new" size="text-xs" /></Link>
      </div>

      <div className="mb-4 rounded-lg border border-[#E32E2E]/30 bg-[#E32E2E]/10 p-3">
        <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-[#E32E2E]">Owner of record</p>
        <p className="text-sm font-bold text-[var(--ck-text)]">{props.ownerName}</p>
        <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--ck-text-dim)]">{props.prospect?.is_deceased === true ? 'Deceased owner · contact the associated people below' : 'Owner record · contact the associated people below'}</p>
        {props.coOwners.length > 0 ? <div className="mt-3 border-t border-[#E32E2E]/20 pt-3"><p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Co-owners on title</p><ul className="space-y-0.5">{props.coOwners.map((name) => <li key={name} className="flex items-center gap-1.5 text-xs text-[var(--ck-text)]"><Icon name="person" size="text-xs" className="text-[var(--ck-text-dim)]" />{toProperCase(name)}</li>)}</ul></div> : null}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {props.occupancy ? <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${props.occupancy.tone === 'warn' ? 'border-[#E32E2E]/40 bg-[#E32E2E]/15 text-[#E32E2E]' : props.occupancy.tone === 'amber' ? 'border-amber-500/30 bg-amber-500/15 text-amber-400' : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'}`}>{props.occupancy.label}</span> : null}
        {props.prospect?.county ? <span className="rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)]">{props.prospect.county} county</span> : null}
        {props.delinquentYears ? <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">{props.delinquentYears} delinquent</span> : null}
        {props.prospect?.earliest_delinquent_year ? <span className="rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)]">since {props.prospect.earliest_delinquent_year}</span> : null}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[['Taxes owed', compactDollars(props.prospect?.cumulative_due), 'text-[#E32E2E]'], ['Zestimate', compactDollars(props.prospect?.zestimate), 'text-[var(--ck-text)]'], ['Market', compactDollars(props.prospect?.total_market_value), 'text-[var(--ck-text)]']].map(([label, value, tone]) => <div key={label} className="ck-card-elev p-3"><p className="mb-1 text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">{label}</p><p className={`text-lg font-black tabular-nums ${tone}`}>{value}</p></div>)}
      </div>
    </section>

    {props.lead ? <DialerAiAssist key={`${props.durableSessionId || 'legacy'}:${props.lead.id}`} sessionId={props.durableSessionId} leadId={props.lead.id} /> : null}

    <section className="ck-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-0.5">{([['texts', 'Text Hub'], ['activity', 'Communications'], ['recent_calls', 'Recent Calls']] as const).map(([tab, label]) => <button key={tab} type="button" onClick={() => props.onTabChange(tab)} className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition-colors ${props.activeTab === tab ? 'bg-[#E32E2E] text-white' : 'text-[var(--ck-text-dim)] hover:text-[var(--ck-text)]'}`}>{label}</button>)}</div>
        <span className="text-[10px] text-[var(--ck-text-dim)]">{props.activeTab === 'texts' ? `${commsSummary.sms} texts` : props.activeTab === 'activity' ? `${commsEvents.length} touches` : `${props.recentCalls.length} recent`}</span>
      </div>
      {props.activeTab === 'texts' ? <SmsThreadPanel leadId={props.leadId} leadName={props.ownerName} phone={props.lead?.phone} propertyAddress={props.situsAddress} activities={props.activities} defaultFromPhone={props.callerId || null} onRefresh={props.onRefreshActivities} />
        : props.activeTab === 'activity' ? <div className="space-y-3"><CommsSummaryBar summary={commsSummary} /><div className="border-t border-[var(--ck-border)] pt-3"><CommsTimeline events={commsEvents} emptyHint="No calls, texts, or emails logged for this lead yet." /></div></div>
          : <RecentCalls calls={props.recentCalls} />}
    </section>

    <section className="ck-card p-4">
      <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Progress</p><p className="text-[10px] font-bold tabular-nums text-[var(--ck-text-muted)]">{props.currentIndex + 1} / {props.queueSize}</p></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ck-surface-hi)]"><div className="h-full bg-[#E32E2E] transition-all" style={{ width: `${Math.round(((props.currentIndex + 1) / props.queueSize) * 100)}%` }} /></div>
      <p className="mt-3 text-[10px] text-[var(--ck-text-dim)]"><kbd className="rounded border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-1 font-mono text-[9px]">J</kbd> next · <kbd className="ml-1 rounded border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-1 font-mono text-[9px]">K</kbd> prev</p>
    </section>
  </aside>
}
