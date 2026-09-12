'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  type ReactNode,
  useMemo,
  useState,
} from 'react'

import { CommsSummaryBar, CommsTimeline } from '@/components/leads/comms-timeline'
import { useWorkspaceCallRail } from '@/components/conversations/workspace-frame'
import { ProspectingNotesPanel } from '@/components/prospecting/prospecting-notes-panel'
import {
  ProspectingWrapUpActions,
  type ProspectingWrapUpAction,
} from '@/components/prospecting/prospecting-wrap-up-actions'
import type {
  ProspectingCallingLead,
  ProspectingCallingProspect,
  ProspectingOccupancy,
} from '@/components/prospecting/prospecting-calling-types'
import { Icon } from '@/components/ui/icon'
import { buildCommsTimeline, summarizeComms } from '@/lib/comms-timeline'
import type { DialerActivity } from '@/lib/dialer-lead-activity'
import { toProperCase } from '@/lib/format'
import { joinOwnerAddress, resolveMailingDisplay, resolveOwnerDisplay, resolveSitusDisplay } from '@/lib/owner-display'
import { withDialerSessionControlOperation } from '@/lib/telephony/dialer-control-operation-client'

const StreetViewPanel = dynamic(() => import('@/components/leads/google-map-panel').then((module) => module.StreetViewPanel), {
  ssr: false,
  loading: () => <div className="grid h-[150px] place-items-center bg-[var(--ck-surface-elev)] text-xs text-[var(--ck-text-muted)]">Loading Street View…</div>,
})

type InformationTab = 'notes' | 'details' | ProspectingWrapUpAction

interface ProspectingCallingContextRailProps {
  primaryWorkspace?: ReactNode
  campaignId?: string | null
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
  presentedPhone?: string | null
  activities: DialerActivity[]
  readOnlyPreview?: boolean
  onLeadPromoted?: (lead: ProspectingCallingLead) => void
  onRefreshActivities: () => void
}

const INFORMATION_TABS: Array<{ id: InformationTab; label: string; icon: string }> = [
  { id: 'notes', label: 'Notes', icon: 'edit_note' },
  { id: 'details', label: 'Details', icon: 'contact_page' },
  { id: 'follow_up', label: 'Follow-up', icon: 'event_repeat' },
  { id: 'appointment', label: 'Appointment', icon: 'calendar_month' },
  { id: 'mail', label: 'Mail', icon: 'mail' },
]

function compactDollars(value: number | null | undefined): string {
  if (!value || value <= 0) return '—'
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`
  return `$${value.toLocaleString()}`
}

function zillowPropertyUrl(address: string): string {
  const slug = address.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug ? `https://www.zillow.com/homes/${encodeURIComponent(slug)}_rb/` : 'https://www.zillow.com/'
}

function ColumnHeader({ label, tone }: { label: string; tone: 'contact' | 'information' | 'dialer' }) {
  const dot = tone === 'contact'
    ? 'bg-[var(--prospecting-success)]'
    : tone === 'information'
      ? 'bg-[var(--prospecting-info)]'
      : 'bg-[var(--prospecting-danger)]'
  return <div className="flex min-h-9 w-full items-center gap-2 border-b border-[var(--ck-border)] bg-[var(--prospecting-header)] px-3 text-[11px] font-semibold text-[var(--ck-text-muted)]">
    <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
    {label}
  </div>
}

export function ProspectingCallingContextRail(props: ProspectingCallingContextRailProps) {
  const callRail = useWorkspaceCallRail()
  const [activeInfoTab, setActiveInfoTab] = useState<InformationTab>('notes')
  const [propertyTab, setPropertyTab] = useState<'street' | 'zillow'>('street')
  const [leadState, setLeadState] = useState<'idle' | 'saving' | 'saved'>(() => props.leadId ? 'saved' : 'idle')
  const [leadError, setLeadError] = useState<string | null>(null)
  const commsEvents = useMemo(() => buildCommsTimeline(props.activities), [props.activities])
  const commsSummary = useMemo(() => summarizeComms(commsEvents), [commsEvents])
  const contactNotes = useMemo(() => props.activities.filter((activity) => (
    activity.activity_type === 'note' && activity.metadata?.source === 'prospecting_contact_note'
  )), [props.activities])
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
  const currentPhone = props.presentedPhone || props.lead?.phone || null
  const zillowUrl = zillowPropertyUrl(situsLine === 'Address unavailable' ? '' : situsLine)
  const campaignQuery = props.campaignId ? `?campaign=${encodeURIComponent(props.campaignId)}` : ''
  const reportsQuery = props.campaignId ? `?campaign=${encodeURIComponent(props.campaignId)}` : ''
  const recordingsQuery = props.campaignId ? `?campaign=${encodeURIComponent(props.campaignId)}&view=recordings` : '?view=recordings'
  const recordKey = props.prospect?.id || props.leadId || 'current'

  async function markAsLead() {
    if (props.readOnlyPreview || leadState === 'saving' || leadState === 'saved') return
    if (!props.prospect?.id) {
      setLeadError('This record is already connected to the CRM Lead workspace.')
      return
    }
    setLeadState('saving')
    setLeadError(null)
    try {
      const response = await withDialerSessionControlOperation(props.durableSessionId, 'Marking current record as Lead', (controlHeaders, signal) => fetch(`/api/prospecting/prospects/${encodeURIComponent(props.prospect!.id)}/promote`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', ...controlHeaders },
        body: JSON.stringify({
          dialerSessionId: props.durableSessionId,
          campaignMemberId: props.campaignMemberId || null,
          presentedPhone: currentPhone,
        }),
      }))
      const payload = await response.json().catch(() => null) as { error?: string; lead?: ProspectingCallingLead } | null
      if (!response.ok || !payload?.lead) throw new Error(payload?.error || 'The record could not be marked as a Lead')
      setLeadState('saved')
      props.onLeadPromoted?.(payload.lead)
      props.onRefreshActivities()
    } catch (error) {
      setLeadState('idle')
      setLeadError(error instanceof Error ? error.message : 'The record could not be marked as a Lead')
    }
  }

  const contactColumn = <main
    aria-label="Current Contact"
    className="min-w-0 self-start overflow-hidden rounded-xl border border-[var(--prospecting-border)] bg-[var(--prospecting-panel)] shadow-sm"
  >
    <ColumnHeader label="Current Contact" tone="contact" />
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-[-0.02em] text-[var(--ck-text)]">{owner.fullName || props.ownerName}</h1>
          <p className="mt-1 text-xs leading-5 text-[var(--ck-text-muted)]">{situsLine}</p>
        </div>
        <div className="grid shrink-0 gap-2">
          <button type="button" aria-pressed={leadState === 'saved'} disabled={Boolean(props.readOnlyPreview || leadState !== 'idle')} onClick={() => { void markAsLead() }} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--prospecting-primary)] bg-transparent px-3 text-xs font-semibold text-[var(--prospecting-primary)] transition-colors hover:bg-[var(--prospecting-primary-soft)] disabled:cursor-not-allowed"><Icon name={leadState === 'saving' ? 'progress_activity' : leadState === 'saved' ? 'verified' : 'person_add'} size="text-sm" className={leadState === 'saving' ? 'animate-spin' : ''} />{leadState === 'saving' ? 'Saving…' : leadState === 'saved' ? 'Marked as Lead' : 'Mark as Lead'}</button>
        </div>
      </header>
      {leadError ? <p role="alert" className="rounded-lg border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{leadError}</p> : null}

      {props.primaryWorkspace}

      <section aria-label="Property lookup" className="overflow-hidden rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)]">
        <div role="tablist" aria-label="Property lookup" className="grid grid-cols-2 border-b border-[var(--ck-border)] p-1">
          {(['street', 'zillow'] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={propertyTab === tab} onClick={() => setPropertyTab(tab)} className={`min-h-9 rounded-lg text-xs font-black ${propertyTab === tab ? 'bg-[var(--ck-surface)] text-[var(--ck-text)] shadow-sm' : 'text-[var(--ck-text-muted)]'}`}>{tab === 'street' ? 'Street View' : 'Zillow'}</button>)}
        </div>
        {propertyTab === 'street' ? <div role="tabpanel" aria-label="Street View" className="overflow-hidden"><StreetViewPanel address={situsLine} height={150} /></div>
          : <div role="tabpanel" aria-label="Zillow" className="space-y-3 p-4">
            <div className="flex items-end justify-between gap-3 rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-3">
              <div><p className="text-[9px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Quick Zestimate</p><p className="mt-1 text-2xl font-black text-[var(--ck-text)]">{compactDollars(props.prospect?.zestimate)}</p></div>
              <span className="text-[10px] font-bold text-[var(--ck-text-muted)]">Saved property estimate</span>
            </div>
            <a href={zillowUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open the live Zillow page for ${situsLine}`} className="flex min-h-20 items-center gap-3 rounded-xl border border-[var(--prospecting-info)]/35 bg-[var(--prospecting-info-soft)] p-4 text-[var(--ck-text)] transition-colors hover:border-[var(--prospecting-info)]">
              <Icon name="open_in_new" size="text-xl" className="text-[var(--prospecting-info)]" />
              <span className="min-w-0"><strong className="block text-sm font-black">Live Zillow property page</strong><span className="mt-1 block truncate text-xs text-[var(--ck-text-muted)]">{situsLine}</span></span>
            </a>
          </div>}
      </section>
    </div>
  </main>

  const informationColumn = <aside
    aria-label="Prospect information workspace"
    className="prospecting-information-panel min-w-0 self-start overflow-hidden rounded-xl border border-[var(--prospecting-border)] bg-[var(--prospecting-panel)] shadow-sm"
  >
    <ColumnHeader label="Information" tone="information" />
    <div role="tablist" aria-label="Contact tools" className="prospecting-tool-tabs w-full border-b border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-1">
      {INFORMATION_TABS.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeInfoTab === tab.id} onClick={() => setActiveInfoTab(tab.id)} className={`flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-lg px-1.5 text-[10px] font-bold whitespace-nowrap transition-colors ${activeInfoTab === tab.id ? 'bg-[var(--prospecting-primary-soft)] text-[var(--prospecting-primary)] shadow-sm ring-1 ring-inset ring-[var(--prospecting-primary)]/35' : 'text-[var(--ck-text-muted)] hover:bg-[var(--prospecting-hover)] hover:text-[var(--ck-text)]'}`}><Icon name={tab.icon} size="text-base" className="shrink-0" /><span className="min-w-0 truncate">{tab.label}</span></button>)}
    </div>
    <div className="p-4">
      {activeInfoTab === 'notes' ? <ProspectingNotesPanel
        key={`notes:${recordKey}`}
        leadId={props.leadId}
        prospectId={props.prospect?.id || null}
        campaignMemberId={props.campaignMemberId || null}
        dialerSessionId={props.durableSessionId}
        sellerName={props.ownerName}
        recordKind={props.leadId ? 'Lead' : 'Source Prospect'}
        notes={contactNotes}
        readOnly={Boolean(props.readOnlyPreview)}
        onSaved={props.onRefreshActivities}
      /> : null}

      {activeInfoTab === 'details' ? <section aria-label="Details" className="space-y-4">
        <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Reference</p><h2 className="mt-0.5 text-sm font-black text-[var(--ck-text)]">Details</h2></div><span className="rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-muted)]">{props.leadId ? 'Lead' : 'Source Prospect'}</span></div>
        <dl className="grid gap-2 sm:grid-cols-2">
          {[
            ['Subject property', situsLine],
            ['Owner of record', owner.fullName || props.ownerName],
            ['Mailing address', mailingLine || 'Not on file'],
            ['Taxes owed', compactDollars(props.prospect?.cumulative_due)],
            ['Market value', compactDollars(props.prospect?.total_market_value)],
            ['Occupancy', props.occupancy?.label || 'Unknown'],
          ].map(([label, value], index) => <div key={label} className={`rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3 ${index < 3 ? 'sm:col-span-2' : ''}`}><dt className="text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">{label}</dt><dd className="mt-1 text-xs font-bold leading-5 text-[var(--ck-text)]">{value}</dd></div>)}
        </dl>
        {props.coOwners.length > 0 ? <div className="flex flex-wrap gap-2">{props.coOwners.map((name) => <span key={name} className="rounded-full border border-[var(--ck-border)] px-2 py-1 text-[10px] font-bold">{toProperCase(name)}</span>)}</div> : null}
        <nav aria-label="Current record links" className="grid grid-cols-2 gap-2">
          <Link href={`/prospecting${campaignQuery}`} className="crm-secondary-button inline-flex min-h-10 items-center justify-center gap-1 text-xs font-black"><Icon name="view_list" size="text-sm" />List</Link>
          <Link href={`/prospecting/reports${reportsQuery}`} className="crm-secondary-button inline-flex min-h-10 items-center justify-center gap-1 text-xs font-black"><Icon name="analytics" size="text-sm" />Report</Link>
          <Link href={`/prospecting/reports${recordingsQuery}`} className="crm-secondary-button inline-flex min-h-10 items-center justify-center gap-1 text-xs font-black"><Icon name="graphic_eq" size="text-sm" />Recordings</Link>
          {props.leadId ? <Link href={`/leads/${props.leadId}`} target="_blank" className="crm-secondary-button inline-flex min-h-10 items-center justify-center gap-1 text-xs font-black"><Icon name="open_in_new" size="text-sm" />Lead profile</Link> : <span className="grid min-h-10 place-items-center rounded-lg border border-[var(--ck-border)] text-[10px] font-bold text-[var(--ck-text-muted)]">Profile after promotion</span>}
        </nav>
        {commsEvents.length > 0 ? <section aria-label="Recent communication history" className="space-y-3 border-t border-[var(--ck-border)] pt-4"><CommsSummaryBar summary={commsSummary} /><div className="max-h-72 overflow-y-auto"><CommsTimeline events={commsEvents} /></div></section> : <p className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-3 text-xs text-[var(--ck-text-muted)]">No communication history has been recorded for this seller yet.</p>}
      </section> : null}

      {activeInfoTab === 'follow_up' || activeInfoTab === 'appointment' || activeInfoTab === 'mail' ? <ProspectingWrapUpActions
        key={`${recordKey}:${activeInfoTab}`}
        variant="tab"
        action={activeInfoTab}
        leadId={props.leadId}
        prospectId={props.prospect?.id || null}
        campaignMemberId={props.campaignMemberId || null}
        dialerSessionId={props.durableSessionId}
        sellerName={props.ownerName}
        propertyAddress={props.situsAddress}
        activities={props.activities}
        readOnly={Boolean(props.readOnlyPreview)}
        onRefresh={props.onRefreshActivities}
      /> : null}
    </div>
  </aside>

  const dialerColumn = <aside
    aria-label="Persistent live dialer controls"
    className="prospecting-dialer-control-surface min-w-0 self-start overflow-hidden rounded-xl border border-[var(--prospecting-border)] bg-[var(--prospecting-panel)] shadow-sm lg:sticky lg:top-3"
  >
    <ColumnHeader label="Live Dialer" tone="dialer" />
    <div className="min-h-0">{callRail || <div className="grid min-h-40 place-items-center p-5 text-center text-xs text-[var(--ck-text-muted)]">Live dialer controls load with the calling session.</div>}</div>
  </aside>

  return <section aria-label="Seller answer workspace" className="min-w-0">
    <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(15rem,0.72fr)]">
      {contactColumn}
      {informationColumn}
      {dialerColumn}
    </div>
  </section>
}
