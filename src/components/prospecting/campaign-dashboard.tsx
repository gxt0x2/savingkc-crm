'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { ProspectingCampaignDetail, ProspectingCampaignSummary } from '@/lib/prospecting/campaign-contract'

function statusTone(status: ProspectingCampaignSummary['status']) {
  if (status === 'active') return 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]'
  if (status === 'paused') return 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]'
  if (status === 'archived') return 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'
  return 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'
}

function percent(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

function dateLabel(value: string | null) {
  if (!value) return 'Not started'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function delayLabel(delayMinutes: number) {
  if (delayMinutes === 0) return 'When activated'
  if (delayMinutes % 1440 === 0) return `${delayMinutes / 1440} day${delayMinutes === 1440 ? '' : 's'} after prior message`
  return `${Math.round(delayMinutes / 60)} hours after prior message`
}

type CampaignDashboardProps = {
  campaigns: ProspectingCampaignSummary[]
  selectedId: string | null
  detail: ProspectingCampaignDetail | null
  loading: boolean
  detailLoading: boolean
  actionPending: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onTransition: (status: 'active' | 'paused' | 'archived') => void
  onLaunchDialer: () => void
}

export function CampaignDashboard({
  campaigns,
  selectedId,
  detail,
  loading,
  detailLoading,
  actionPending,
  onSelect,
  onCreate,
  onTransition,
  onLaunchDialer,
}: CampaignDashboardProps) {
  const [query, setQuery] = useState('')
  const [campaignFilter, setCampaignFilter] = useState<'all' | 'active' | 'draft'>('all')
  const [memberQuery, setMemberQuery] = useState('')

  const filteredCampaigns = useMemo(() => campaigns.filter((campaign) => {
    const matchesQuery = campaign.name.toLowerCase().includes(query.trim().toLowerCase())
    const matchesStatus = campaignFilter === 'all'
      || (campaignFilter === 'active' && ['active', 'paused'].includes(campaign.status))
      || (campaignFilter === 'draft' && campaign.status === 'draft')
    return matchesQuery && matchesStatus
  }), [campaignFilter, campaigns, query])

  const filteredMembers = useMemo(() => {
    if (!detail) return []
    const normalized = memberQuery.trim().toLowerCase()
    if (!normalized) return detail.members
    return detail.members.filter((member) => [member.lead?.fullName, member.lead?.propertyAddress, member.phone, member.status, member.suppressionReason]
      .some((value) => value?.toLowerCase().includes(normalized)))
  }, [detail, memberQuery])

  const campaignMetrics = detail?.kind === 'dialer'
    ? [
        ['groups', detail.stats.total, 'Audience'],
        ['phone_in_talk', detail.stats.active, 'Ready to call'],
        ['block', detail.stats.suppressed, 'Suppressed'],
        ['verified_user', `${percent(detail.stats.active, detail.stats.total)}%`, 'Eligible'],
      ]
    : detail
      ? [
          ['groups', detail.stats.total, 'Audience'],
          ['send', detail.stats.sent, 'Messages sent'],
          ['forum', detail.stats.replied, `${percent(detail.stats.replied, detail.stats.sent)}% reply rate`],
          ['task_alt', detail.stats.completed, `${percent(detail.stats.completed, detail.stats.total)}% completed`],
        ]
      : []

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--crm-canvas)] p-3 sm:p-5 lg:p-7">
      <div className="mx-auto grid max-w-[1540px] gap-4 xl:grid-cols-[19rem_minmax(0,1fr)] 2xl:grid-cols-[19rem_minmax(0,1fr)_18rem]">
        <aside className="crm-panel h-fit overflow-hidden rounded-2xl xl:sticky xl:top-0">
          <div className="border-b border-[var(--crm-border)] p-4">
            <div className="flex items-center justify-between"><div><p className="crm-eyebrow">Your work</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">Campaigns</h2></div><span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--crm-brand-soft)] text-sm font-black text-[var(--crm-brand)]">{campaigns.length}</span></div>
            <label className="relative mt-4 block"><Icon name="search" className="pointer-events-none absolute left-3 top-2.5 text-lg text-[var(--crm-text-dim)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a campaign" aria-label="Find a campaign" className="crm-field h-10 w-full rounded-xl pl-10 pr-3 text-xs" /></label>
            <div className="mt-3 grid grid-cols-3 rounded-lg bg-[var(--crm-surface-subtle)] p-1" aria-label="Campaign filters">{(['all', 'active', 'draft'] as const).map((filter) => <button key={filter} type="button" onClick={() => setCampaignFilter(filter)} className={`rounded-md px-2 py-1.5 text-[10px] font-black capitalize ${campaignFilter === filter ? 'bg-[var(--crm-surface)] text-[var(--crm-brand)] shadow-sm' : 'text-[var(--crm-text-muted)]'}`}>{filter === 'active' ? 'Live' : filter}</button>)}</div>
          </div>
          <div className="max-h-[calc(100dvh-23rem)] overflow-y-auto p-2">
            {loading ? <div className="space-y-2 p-2">{[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-[var(--crm-surface-subtle)]" />)}</div> : filteredCampaigns.length === 0 ? <div className="p-6 text-center"><Icon name="campaign" className="text-4xl text-[var(--crm-text-dim)]" /><p className="mt-2 text-sm font-black text-[var(--crm-ink)]">No campaigns here</p><p className="mt-1 text-xs leading-5 text-[var(--crm-text-muted)]">Change the filter or build a clean campaign.</p></div> : filteredCampaigns.map((campaign) => <button key={campaign.id} type="button" onClick={() => onSelect(campaign.id)} className={`mb-1 w-full rounded-xl p-3 text-left transition ${selectedId === campaign.id ? 'bg-[var(--crm-brand-soft)] ring-1 ring-[var(--crm-brand)]/20' : 'hover:bg-[var(--crm-surface-subtle)]'}`}><div className="flex items-start gap-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${campaign.kind === 'sms' ? 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' : 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'}`}><Icon name={campaign.kind === 'sms' ? 'sms' : 'phone_in_talk'} className="text-lg" /></span><span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-2"><span className="truncate text-sm font-black text-[var(--crm-ink)]">{campaign.name}</span><span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase ${statusTone(campaign.status)}`}>{campaign.status}</span></span><span className="mt-1 block text-[10px] text-[var(--crm-text-muted)]">Updated {dateLabel(campaign.updatedAt)}</span></span></div></button>)}
          </div>
          <div className="border-t border-[var(--crm-border)] p-3"><button type="button" onClick={onCreate} className="crm-primary-button flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-black"><Icon name="add" className="text-base" />Build campaign</button></div>
        </aside>

        <section className="min-w-0">
          {!detail || detailLoading ? <div className="crm-panel grid min-h-[36rem] place-items-center rounded-2xl"><div className="text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--crm-surface-subtle)]"><Icon name={detailLoading ? 'progress_activity' : 'campaign'} className={`text-3xl text-[var(--crm-text-dim)] ${detailLoading ? 'animate-spin' : ''}`} /></span><p className="mt-4 text-sm font-black text-[var(--crm-ink)]">{detailLoading ? 'Loading campaign' : 'Choose a campaign'}</p><p className="mt-1 text-xs text-[var(--crm-text-muted)]">{detailLoading ? 'Bringing its audience and activity into view.' : 'Or build a new calling or SMS workflow.'}</p></div></div> : <div className="space-y-4">
            <article className="crm-panel overflow-hidden rounded-2xl">
              <div className="relative overflow-hidden bg-[linear-gradient(130deg,#17221a_0%,#344e30_58%,#607957_100%)] px-5 py-6 text-white sm:px-7 sm:py-7">
                <div className="absolute -right-14 -top-24 h-64 w-64 rounded-full border border-white/10" />
                <div className="absolute -right-2 -top-10 h-44 w-44 rounded-full border border-white/10" />
                <div className="relative flex flex-wrap items-start justify-between gap-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${detail.status === 'active' ? 'bg-[#bde2b1] text-[#17221a]' : 'bg-white/12 text-white'}`}>{detail.status}</span><span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/55">{detail.kind === 'dialer' ? 'Power dialer' : 'SMS cadence'}</span></div><h1 className="mt-4 max-w-2xl text-2xl font-black tracking-tight sm:text-3xl">{detail.name}</h1><p className="mt-2 text-sm font-medium text-white/65">Owned by {detail.ownerName} · {detail.defaultTimezone.replace('_', ' ')} · Updated {dateLabel(detail.updatedAt)}</p></div><div className="relative flex flex-wrap gap-2">{detail.status === 'draft' || detail.status === 'paused' ? <button type="button" onClick={() => onTransition('active')} disabled={actionPending || detail.stats.active < 1} className="rounded-xl bg-[#bde2b1] px-4 py-2.5 text-xs font-black text-[#17221a] shadow-lg disabled:opacity-40">{detail.status === 'paused' ? 'Resume campaign' : 'Activate campaign'}</button> : null}{detail.status === 'active' ? <button type="button" onClick={() => onTransition('paused')} disabled={actionPending} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-black text-white">Pause</button> : null}{detail.kind === 'dialer' && detail.status === 'active' ? <button type="button" onClick={onLaunchDialer} disabled={actionPending} className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-black text-[#17221a]"><Icon name="phone_in_talk" className="text-base" />Open calling floor</button> : null}</div></div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-y divide-[var(--crm-border)] sm:grid-cols-4 sm:divide-y-0">
                {campaignMetrics.map(([icon, value, label]) => <div key={String(label)} className="p-4 sm:p-5"><div className="flex items-center justify-between"><span className="text-2xl font-black text-[var(--crm-ink)]">{value}</span><Icon name={String(icon)} className="text-xl text-[var(--crm-text-dim)]" /></div><p className="mt-1 text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">{label}</p></div>)}
              </div>
            </article>

            {detail.kind === 'sms' ? <article className="crm-panel rounded-2xl p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="crm-eyebrow">Sequence journey</p><h2 className="mt-1 text-xl font-black text-[var(--crm-ink)]">The conversation sellers receive</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Stops immediately when a seller replies or opts out.</p></div><div className="rounded-xl bg-[var(--crm-surface-subtle)] px-3 py-2 text-right"><p className="text-xs font-black text-[var(--crm-ink)]">{detail.perHour}/hour · {detail.perDay}/day</p><p className="text-[9px] font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Pacing ceiling</p></div></div><div className="relative mt-6 space-y-4 before:absolute before:bottom-4 before:left-[1.15rem] before:top-4 before:w-px before:bg-[var(--crm-border)]">{detail.steps.map((step) => <div key={step.id} className="relative flex gap-4"><span className="z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--crm-brand)] text-xs font-black text-white ring-4 ring-[var(--crm-surface)]">{step.position}</span><div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4"><p className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-brand)]">{delayLabel(step.delayMinutes)}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--crm-ink)]">{step.bodyTemplate}</p></div></div>)}</div></article> : <article className="crm-panel rounded-2xl p-5 sm:p-6"><p className="crm-eyebrow">Calling floor</p><div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-black text-[var(--crm-ink)]">One focused seller at a time</h2><p className="mt-1 max-w-xl text-sm leading-6 text-[var(--crm-text-muted)]">The calling session handles eligibility, context, disposition, and safe queue advance. No fake line counter and no predictive claims.</p></div>{detail.status === 'active' ? <button type="button" onClick={onLaunchDialer} disabled={actionPending} className="crm-primary-button inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-black"><Icon name="phone_in_talk" />Start calling</button> : null}</div><div className="mt-6 grid gap-2 sm:grid-cols-4">{[['verified_user','Check'],['auto_awesome','Brief'],['phone_in_talk','Call'],['fact_check','Outcome']].map(([icon,label], index) => <div key={label} className="relative rounded-xl bg-[var(--crm-surface-subtle)] p-4"><p className="text-[9px] font-black text-[var(--crm-text-dim)]">0{index + 1}</p><Icon name={icon} className="mt-4 text-2xl text-[var(--crm-brand)]" /><p className="mt-2 text-sm font-black text-[var(--crm-ink)]">{label}</p>{index < 3 ? <Icon name="arrow_forward" className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-[var(--crm-text-dim)] sm:block" /> : null}</div>)}</div></article>}

            <article className="crm-panel rounded-2xl p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="crm-eyebrow">Audience</p><h2 className="mt-1 text-xl font-black text-[var(--crm-ink)]">Who is in this campaign</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Showing the first 100 contacts. Suppressed contacts never enter execution.</p></div><div className="flex gap-2"><label className="relative hidden sm:block"><Icon name="search" className="pointer-events-none absolute left-3 top-2.5 text-base text-[var(--crm-text-dim)]" /><input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Find in audience" aria-label="Find in audience" className="crm-field h-10 w-44 rounded-lg pl-9 pr-3 text-xs" /></label><Link href="/contacts?list=prospects" className="crm-secondary-button inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-black"><Icon name="person_add" className="text-base" />Add contacts</Link></div></div>
              {detail.members.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-[var(--crm-border)] p-8 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--crm-surface-subtle)]"><Icon name="group_add" className="text-2xl text-[var(--crm-text-dim)]" /></span><p className="mt-3 text-sm font-black text-[var(--crm-ink)]">This campaign needs an audience</p><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Choose contacts in Pipeline, then return here to enroll them safely.</p></div> : <div className="mt-5 overflow-hidden rounded-xl border border-[var(--crm-border)]"><div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_8rem_8rem] gap-3 bg-[var(--crm-surface-subtle)] px-4 py-2 text-[9px] font-black uppercase tracking-wider text-[var(--crm-text-muted)] sm:grid"><span>Seller</span><span>Property</span><span>Next action</span><span>Status</span></div>{filteredMembers.map((member) => <div key={member.id} className="grid gap-2 border-t border-[var(--crm-border)] px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_8rem_8rem] sm:items-center"><div className="min-w-0"><p className="truncate text-sm font-black text-[var(--crm-ink)]">{member.lead?.fullName || member.phone}</p><p className="mt-0.5 text-[10px] text-[var(--crm-text-muted)]">{member.phone}</p></div><p className="truncate text-xs text-[var(--crm-text-muted)]">{member.lead?.propertyAddress || 'Property not recorded'}</p><p className="text-[10px] font-bold text-[var(--crm-text-muted)]">{member.nextActionAt ? dateLabel(member.nextActionAt) : '—'}</p><span className={`w-fit rounded-full px-2 py-1 text-[9px] font-black uppercase ${member.status === 'active' ? 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : member.status === 'suppressed' ? 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'}`}>{member.suppressionReason || member.status}</span></div>)}</div>}
            </article>
          </div>}
        </section>

        <aside className="hidden space-y-4 2xl:block">
          {detail ? <><div className="crm-panel rounded-2xl p-5"><p className="crm-eyebrow">Audience health</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">{percent(detail.stats.active, detail.stats.total)}% ready</h2><div className="mt-4 flex h-2 overflow-hidden rounded-full bg-[var(--crm-surface-subtle)]"><span className="bg-[var(--crm-success)]" style={{ width: `${percent(detail.stats.active, detail.stats.total)}%` }} /><span className="bg-[var(--crm-warning)]" style={{ width: `${percent(detail.stats.suppressed, detail.stats.total)}%` }} /><span className="bg-[var(--crm-info)]" style={{ width: `${percent(detail.stats.replied + detail.stats.completed, detail.stats.total)}%` }} /></div><dl className="mt-5 space-y-3">{[['Ready',detail.stats.active,'var(--crm-success)'],['Suppressed',detail.stats.suppressed,'var(--crm-warning)'],['Replied',detail.stats.replied,'var(--crm-info)'],['Completed',detail.stats.completed,'var(--crm-brand)']].map(([label,value,color]) => <div key={String(label)} className="flex items-center justify-between"><dt className="flex items-center gap-2 text-xs font-bold text-[var(--crm-text-muted)]"><span className="h-2 w-2 rounded-full" style={{ background: String(color) }} />{label}</dt><dd className="text-sm font-black text-[var(--crm-ink)]">{value}</dd></div>)}</dl></div><div className="rounded-2xl bg-[#17221a] p-5 text-white"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">Safety rail</p><h2 className="mt-2 text-lg font-black">Protected at every action</h2><div className="mt-5 space-y-4">{[['block','DNC and STOP'],['schedule','Local-time windows'],['badge','Approved sender'],['reply','Reply cancellation']].map(([icon,label]) => <div key={label} className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white/8"><Icon name={icon} className="text-base text-[#bde2b1]" /></span><span className="text-xs font-bold text-white/75">{label}</span></div>)}</div><p className="mt-5 border-t border-white/10 pt-4 text-[10px] leading-4 text-white/45">These controls run on the server and cannot be bypassed by the campaign screen.</p></div></> : null}
        </aside>
      </div>
    </main>
  )
}
