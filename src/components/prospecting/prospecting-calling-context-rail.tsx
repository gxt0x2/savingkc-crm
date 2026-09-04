'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { type ReactNode, useMemo } from 'react'

import { CommsSummaryBar, CommsTimeline } from '@/components/leads/comms-timeline'
import { Icon } from '@/components/ui/icon'
import type {
  ProspectingCallingLead,
  ProspectingCallingProspect,
  ProspectingCallingTab,
  ProspectingOccupancy,
} from '@/components/prospecting/prospecting-calling-types'
import { ProspectingNotesPanel } from '@/components/prospecting/prospecting-notes-panel'
import { ProspectingWrapUpActions } from '@/components/prospecting/prospecting-wrap-up-actions'
import { buildCommsTimeline, summarizeComms } from '@/lib/comms-timeline'
import { toProperCase } from '@/lib/format'
import type { DialerActivity } from '@/lib/dialer-lead-activity'
import { joinOwnerAddress, resolveMailingDisplay, resolveOwnerDisplay, resolveSitusDisplay } from '@/lib/owner-display'

const DialerAiAssist = dynamic(() => import('@/components/dialer/dialer-ai-assist').then((module) => module.DialerAiAssist))
const SmsThreadPanel = dynamic(() => import('@/components/leads/sms-thread-panel').then((module) => module.SmsThreadPanel))

interface ProspectingCallingContextRailProps {
  primaryWorkspace?: ReactNode
  campaignId?: string | null
  queueLabel?: string
  leadId: string | null
  lead: ProspectingCallingLead | null
  prospect: ProspectingCallingProspect | null
  ownerName: string
  situsAddress: string
  coOwners: string[]
  occupancy: ProspectingOccupancy | null
  delinquentYears: string | null
  durableSessionId: string
  campaignMemberId?: string | null
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
  const owner = useMemo(() => resolveOwnerDisplay(props.prospect, props.lead?.full_name), [props.prospect, props.lead])
  const situs = useMemo(() => resolveSitusDisplay(props.prospect, {
    street: props.lead?.property_address,
    city: props.lead?.city,
    state: props.lead?.state,
    zip: props.lead?.zip,
  }), [props.prospect, props.lead])
  const mailing = useMemo(() => resolveMailingDisplay(props.prospect), [props.prospect])
  const situsLine = useMemo(() => joinOwnerAddress(situs) || props.situsAddress || 'Address unavailable', [situs, props.situsAddress])
  const mailingLine = useMemo(() => joinOwnerAddress(mailing), [mailing])
  const campaignQuery = props.campaignId ? `?campaign=${encodeURIComponent(props.campaignId)}` : ''
  const reportsQuery = props.campaignId ? `?campaign=${encodeURIComponent(props.campaignId)}` : ''
  const recordingsQuery = props.campaignId ? `?campaign=${encodeURIComponent(props.campaignId)}&view=recordings` : '?view=recordings'

  const communicationWorkspace = <section aria-label="Seller communication workspace" className="ck-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-0.5">{([['texts', 'Text Hub'], ['activity', 'History']] as const).map(([tab, label]) => <button key={tab} type="button" onClick={() => props.onTabChange(tab)} className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition-colors ${props.activeTab === tab ? 'bg-[var(--crm-brand)] text-white' : 'text-[var(--ck-text-dim)] hover:text-[var(--ck-text)]'}`}>{label}</button>)}</div>
        <span className="text-[10px] text-[var(--ck-text-dim)]">{props.activeTab === 'texts' ? `${commsSummary.sms} texts` : `${historyCount} items`}</span>
      </div>
      <div className="max-h-[360px] overflow-y-auto overscroll-contain pr-1">
        {props.activeTab === 'texts' ? props.readOnlyPreview
        ? <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-xs leading-5 text-[var(--ck-text-muted)]">Texting is visible for workflow review but disabled in read-only preview. Start a live calling session to send a message.</div>
        : props.leadId
        ? <SmsThreadPanel key={props.leadId} leadId={props.leadId} leadName={props.ownerName} phone={props.lead?.phone} propertyAddress={props.situsAddress} activities={props.activities} defaultFromPhone={props.callerId || null} dialerSessionId={props.durableSessionId || null} onRefresh={props.onRefreshActivities} />
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
          </> : contactNotes.length === 0 ? <p className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4 text-xs leading-5 text-[var(--ck-text-muted)]">No calls, texts, emails, notes, or next actions logged for this seller yet.</p> : null}
        </div>}
      </div>
      {props.leadId ? <Link href={`/conversations?lead=${encodeURIComponent(props.leadId)}`} prefetch={false} className="mt-3 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-[var(--crm-brand)] hover:underline">Open full conversation <Icon name="arrow_forward" size="text-xs" /></Link> : null}
    </section>

  return <section aria-label="Seller answer workspace" className="order-2 col-span-12 min-w-0 overflow-hidden rounded-[26px] border border-[var(--ck-border-strong)] bg-[var(--ck-surface)] shadow-[0_24px_80px_rgba(0,0,0,0.24)] lg:self-start">
    <header className="relative overflow-hidden border-b border-[var(--ck-border)] bg-[linear-gradient(115deg,var(--ck-surface-elev),var(--ck-surface))] px-4 py-4 sm:px-5">
      <div aria-hidden="true" className="pointer-events-none absolute -left-16 -top-24 h-48 w-48 rounded-full bg-[var(--crm-brand-soft)] blur-3xl" />
      <div className="relative grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(32rem,0.9fr)] xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-[var(--crm-success)]"><span className="h-1.5 w-1.5 rounded-full bg-current" />Answer workspace</span>
            <span className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${commsSummary.lastReachedAt ? 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : 'border-[var(--ck-border)] bg-[var(--ck-surface)] text-[var(--ck-text-muted)]'}`}>{commsSummary.lastReachedAt ? 'Reached seller' : 'Not reached yet'}</span>
          </div>
          <h1 className="mt-2 truncate text-2xl font-black tracking-[-0.035em] text-[var(--ck-text)]">{owner.fullName || props.ownerName}</h1>
          <p className="mt-1 truncate text-xs font-semibold text-[var(--ck-text-muted)]">{situsLine}</p>
          <p className="mt-2 truncate text-[9px] font-black uppercase tracking-[0.14em] text-[var(--ck-text-dim)]">{props.queueLabel || 'Prospecting campaign'}</p>
          <nav aria-label="Seller workspace links" className="mt-3 flex flex-wrap gap-2">
            <Link href={`/prospecting${campaignQuery}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-2.5 text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-muted)] hover:border-[var(--crm-brand)] hover:text-[var(--ck-text)]"><Icon name="view_list" size="text-sm" />Review list</Link>
            <Link href={`/prospecting/reports${reportsQuery}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-2.5 text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-muted)] hover:border-[var(--crm-brand)] hover:text-[var(--ck-text)]"><Icon name="analytics" size="text-sm" />Call report</Link>
            <Link href={`/prospecting/reports${recordingsQuery}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-2.5 text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-muted)] hover:border-[var(--crm-brand)] hover:text-[var(--ck-text)]"><Icon name="graphic_eq" size="text-sm" />Recordings</Link>
          </nav>
        </div>
        <ProspectingWrapUpActions
          variant="toolbar"
          leadId={props.leadId}
          prospectId={props.prospect?.id || null}
          campaignMemberId={props.campaignMemberId || null}
          dialerSessionId={props.durableSessionId}
          sellerName={props.ownerName}
          propertyAddress={props.situsAddress}
          activities={props.activities}
          readOnly={Boolean(props.readOnlyPreview)}
          onRefresh={props.onRefreshActivities}
        />
      </div>
    </header>

    <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.48fr)_minmax(22rem,0.82fr)]">
      <main className="min-w-0 space-y-4 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 px-1">
          <div><p className="text-[9px] font-black uppercase tracking-[0.16em] text-[var(--crm-brand)]">Contact deck</p><h2 className="mt-0.5 text-sm font-black text-[var(--ck-text)]">People, phones and conversation</h2></div>
          <span className="rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-muted)]">Seller {props.leadId ? 'lead' : 'prospect'}</span>
        </div>
        {props.primaryWorkspace}
        {props.lead ? <DialerAiAssist key={`${props.durableSessionId || 'legacy'}:${props.lead.id}`} sessionId={props.durableSessionId} leadId={props.lead.id} /> : null}
        {communicationWorkspace}
      </main>

      <aside aria-label="Seller intelligence" className="min-w-0 space-y-4 border-t border-[var(--ck-border)] bg-[color-mix(in_srgb,var(--ck-surface-elev)_68%,transparent)] p-4 sm:p-5 lg:border-l lg:border-t-0">
        <ProspectingNotesPanel
          key={`notes:${props.prospect?.id || props.leadId || 'current'}`}
          leadId={props.leadId}
          prospectId={props.prospect?.id || null}
          campaignMemberId={props.campaignMemberId || null}
          dialerSessionId={props.durableSessionId}
          sellerName={props.ownerName}
          notes={contactNotes}
          readOnly={Boolean(props.readOnlyPreview)}
          onSaved={props.onRefreshActivities}
        />

        <section aria-label="Subject property" className="ck-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Subject property</p>
            <h1 className="mt-1 text-lg font-black leading-tight text-[var(--ck-text)]">{situs.street || 'Address unavailable'}</h1>
            <p aria-label="Situs address" className="mt-1 text-xs leading-5 text-[var(--ck-text-muted)]">{situsLine}</p>
          </div>
          {props.leadId ? <Link href={`/leads/${props.leadId}`} prefetch={false} target="_blank" title="Open full lead profile in a new tab" className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--ck-border)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]">Profile <Icon name="open_in_new" size="text-xs" /></Link>
            : <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-500">Source Prospect</span>}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#E32E2E]">Owner of record</p>
            <p aria-label="Owner of record" className="mt-1 text-sm font-black text-[var(--ck-text)]">{owner.fullName || props.ownerName}</p>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--ck-text-dim)]">{props.prospect?.is_deceased === true ? 'Deceased owner' : 'County owner record'}</p>
          </div>
          <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Mailing address</p>
            <p aria-label="Mailing address" className="mt-1 text-xs font-bold leading-5 text-[var(--ck-text)]">{mailingLine || 'Not on file'}</p>
          </div>
        </div>

        {props.coOwners.length > 0 ? <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-[9px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Co-owners</span>{props.coOwners.map((name) => <span key={name} className="inline-flex items-center gap-1 rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1 text-[10px] font-bold text-[var(--ck-text)]"><Icon name="person" size="text-xs" className="text-[var(--ck-text-dim)]" />{toProperCase(name)}</span>)}</div> : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {props.occupancy ? <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${props.occupancy.tone === 'warn' ? 'border-[#E32E2E]/40 bg-[#E32E2E]/15 text-[#E32E2E]' : props.occupancy.tone === 'amber' ? 'border-amber-500/30 bg-amber-500/15 text-amber-400' : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'}`}>{props.occupancy.label}</span> : null}
          {props.prospect?.county ? <span className="rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)]">{props.prospect.county} county</span> : null}
          {props.delinquentYears ? <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">{props.delinquentYears} delinquent</span> : null}
          {props.prospect?.earliest_delinquent_year ? <span className="rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-muted)]">since {props.prospect.earliest_delinquent_year}</span> : null}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {[['Taxes owed', compactDollars(props.prospect?.cumulative_due), 'text-[#E32E2E]'], ['Zestimate', compactDollars(props.prospect?.zestimate), 'text-[var(--ck-text)]'], ['Market', compactDollars(props.prospect?.total_market_value), 'text-[var(--ck-text)]']].map(([label, value, tone]) => <div key={label} className="ck-card-elev p-2.5"><p className="text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">{label}</p><p className={`mt-1 text-base font-black tabular-nums ${tone}`}>{value}</p></div>)}
        </div>
      </section>

      </aside>
    </div>
  </section>
}
