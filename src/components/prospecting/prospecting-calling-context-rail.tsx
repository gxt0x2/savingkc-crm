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
} from '@/components/prospecting/prospecting-calling-types'
import { buildCommsTimeline, summarizeComms } from '@/lib/comms-timeline'
import { toProperCase } from '@/lib/format'
import type { DialerActivity } from '@/lib/dialer-lead-activity'

const DialerAiAssist = dynamic(() => import('@/components/dialer/dialer-ai-assist').then((module) => module.DialerAiAssist))
const SmsThreadPanel = dynamic(() => import('@/components/leads/sms-thread-panel').then((module) => module.SmsThreadPanel))

interface ProspectingCallingContextRailProps {
  fullWidth?: boolean
  leadId: string | null
  lead: ProspectingCallingLead | null
  prospect: ProspectingCallingProspect | null
  ownerName: string
  situsAddress: string
  coOwners: string[]
  occupancy: ProspectingOccupancy | null
  delinquentYears: string | null
  durableSessionId: string
  activities: DialerActivity[]
  activeTab: ProspectingCallingTab
  callerId: string
  readOnlyPreview?: boolean
  onTabChange: (tab: ProspectingCallingTab) => void
  onRefreshActivities: () => void
}

function compactDollars(value: number | null | undefined): string {
  if (!value || value <= 0) return '—'
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`
  return `$${value.toLocaleString()}`
}

function contactNoteLabel(activity: DialerActivity): string {
  const contactName = activity.metadata?.contact_name
  return typeof contactName === 'string' && contactName.trim() ? contactName.trim() : 'Associated contact'
}

function contactNoteTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  }).format(date)
}

export function ProspectingCallingContextRail(props: ProspectingCallingContextRailProps) {
  const commsEvents = useMemo(() => buildCommsTimeline(props.activities), [props.activities])
  const commsSummary = useMemo(() => summarizeComms(commsEvents), [commsEvents])
  const contactNotes = useMemo(() => props.activities.filter((activity) => (
    activity.activity_type === 'note'
    && activity.metadata?.source === 'prospecting_contact_note'
  )), [props.activities])
  const historyCount = commsEvents.length + contactNotes.length

  return <aside aria-label="Seller context" className={`order-2 col-span-12 space-y-3 lg:self-start ${props.fullWidth ? 'lg:col-span-12' : 'lg:sticky lg:top-[168px] lg:col-span-4 lg:max-h-[calc(100vh-184px)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1'}`}>
    <section className="ck-card p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Subject property</p>
          <h1 className="truncate text-xl font-black leading-tight text-[var(--ck-text)]">{props.prospect?.situs_street || props.lead?.property_address || '—'}</h1>
          <p className="mt-0.5 text-sm text-[var(--ck-text-muted)]">{[props.prospect?.situs_city || props.lead?.city, props.prospect?.situs_state || props.lead?.state].filter(Boolean).join(', ')}{(props.prospect?.situs_zip || props.lead?.zip) ? ` ${props.prospect?.situs_zip || props.lead?.zip}` : ''}</p>
        </div>
        {props.leadId ? <Link href={`/leads/${props.leadId}`} prefetch={false} target="_blank" title="Open full lead profile in a new tab" className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--ck-border)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]">Profile <Icon name="open_in_new" size="text-xs" /></Link>
          : <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-500">Source Prospect</span>}
      </div>

      <div className="mb-3 rounded-lg border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] p-3">
        <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-[#E32E2E]">Owner of record</p>
        <p className="text-sm font-bold text-[var(--ck-text)]">{props.ownerName}</p>
        <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--ck-text-dim)]">{props.prospect?.is_deceased === true ? 'Deceased owner · contact the associated people below' : 'Owner record · contact the associated people below'}</p>
        {props.coOwners.length > 0 ? <div className="mt-3 border-t border-[#E32E2E]/20 pt-3"><p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Co-owners on title</p><ul className="space-y-0.5">{props.coOwners.map((name) => <li key={name} className="flex items-center gap-1.5 text-xs text-[var(--ck-text)]"><Icon name="person" size="text-xs" className="text-[var(--ck-text-dim)]" />{toProperCase(name)}</li>)}</ul></div> : null}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {props.occupancy ? <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${props.occupancy.tone === 'warn' ? 'border-[#E32E2E]/40 bg-[#E32E2E]/15 text-[#E32E2E]' : props.occupancy.tone === 'amber' ? 'border-amber-500/30 bg-amber-500/15 text-amber-400' : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'}`}>{props.occupancy.label}</span> : null}
        {props.prospect?.county ? <span className="rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)]">{props.prospect.county} county</span> : null}
        {props.delinquentYears ? <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">{props.delinquentYears} delinquent</span> : null}
        {props.prospect?.earliest_delinquent_year ? <span className="rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)]">since {props.prospect.earliest_delinquent_year}</span> : null}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[['Taxes owed', compactDollars(props.prospect?.cumulative_due), 'text-[#E32E2E]'], ['Zestimate', compactDollars(props.prospect?.zestimate), 'text-[var(--ck-text)]'], ['Market', compactDollars(props.prospect?.total_market_value), 'text-[var(--ck-text)]']].map(([label, value, tone]) => <div key={label} className="ck-card-elev p-3"><p className="mb-1 text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">{label}</p><p className={`text-lg font-black tabular-nums ${tone}`}>{value}</p></div>)}
      </div>
    </section>

    {props.lead ? <DialerAiAssist key={`${props.durableSessionId || 'legacy'}:${props.lead.id}`} sessionId={props.durableSessionId} leadId={props.lead.id} /> : null}

    <section aria-label="Seller communication workspace" className="ck-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-0.5">{([['texts', 'Text Hub'], ['activity', 'History']] as const).map(([tab, label]) => <button key={tab} type="button" onClick={() => props.onTabChange(tab)} className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition-colors ${props.activeTab === tab ? 'bg-[var(--crm-brand)] text-white' : 'text-[var(--ck-text-dim)] hover:text-[var(--ck-text)]'}`}>{label}</button>)}</div>
        <span className="text-[10px] text-[var(--ck-text-dim)]">{props.activeTab === 'texts' ? `${commsSummary.sms} texts` : `${historyCount} items`}</span>
      </div>
      <div className="max-h-[360px] overflow-y-auto overscroll-contain pr-1">
        {props.activeTab === 'texts' ? props.readOnlyPreview
        ? <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-xs leading-5 text-[var(--ck-text-muted)]">Texting is visible for workflow review but disabled in read-only preview. Start a live calling session to send a message.</div>
        : props.leadId
        ? <SmsThreadPanel leadId={props.leadId} leadName={props.ownerName} phone={props.lead?.phone} propertyAddress={props.situsAddress} activities={props.activities} defaultFromPhone={props.callerId || null} onRefresh={props.onRefreshActivities} />
        : <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-xs leading-5 text-[var(--ck-text-muted)]">SMS stays locked until a reviewed recipient is selected from the campaign audience. Calling this source Prospect does not create a Lead.</div>
        : <div className="space-y-3">
          {contactNotes.length > 0 ? <section aria-label="Contact notes" className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--ck-text-dim)]">Contact notes</p>
            {contactNotes.map((activity) => <article key={activity.id} className="rounded-lg border border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-black text-[var(--ck-text)]">{contactNoteLabel(activity)}</p>
                <time dateTime={activity.created_at} className="shrink-0 text-[9px] font-bold text-[var(--ck-text-dim)]">{contactNoteTime(activity.created_at)}</time>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--ck-text-muted)]">{activity.description || 'Note saved without details.'}</p>
              {activity.agent ? <p className="mt-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--ck-text-dim)]">Saved by {activity.agent}</p> : null}
            </article>)}
          </section> : null}
          {commsEvents.length > 0 ? <>
            <CommsSummaryBar summary={commsSummary} />
            <div className="border-t border-[var(--ck-border)] pt-3"><CommsTimeline events={commsEvents} /></div>
          </> : contactNotes.length === 0 ? <p className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4 text-xs leading-5 text-[var(--ck-text-muted)]">No calls, texts, emails, or contact notes logged for this seller yet.</p> : null}
        </div>}
      </div>
      {props.leadId ? <Link href={`/conversations?lead=${encodeURIComponent(props.leadId)}`} prefetch={false} className="mt-3 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--crm-brand)] hover:underline">Open full conversation <Icon name="arrow_forward" size="text-xs" /></Link> : null}
    </section>

  </aside>
}
