'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CampaignActivityFeed } from '@/components/prospecting/campaign-activity-feed'
import { CampaignAudienceWorkbench } from '@/components/prospecting/campaign-audience-workbench'
import { CampaignDeliveryPulse } from '@/components/prospecting/campaign-delivery-pulse'
import { CampaignLaunchReadiness } from '@/components/prospecting/campaign-launch-readiness'
import { ProspectingSessionSetup } from '@/components/prospecting/prospecting-session-setup'
import { Icon } from '@/components/ui/icon'
import { isProspectingDialerPickerCampaign, prospectingDialerPickerLabel, type ProspectingCampaignDetail, type ProspectingCampaignSummary, type ProspectingDialerSessionSetup } from '@/lib/prospecting/campaign-contract'

function percent(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

function timeLabel(value: string | null) {
  if (!value) return 'Connecting'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? `Synced ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }).format(date)}`
    : 'Sync time unavailable'
}

function delayLabel(delayMinutes: number) {
  if (delayMinutes === 0) return 'When activated'
  if (delayMinutes % 1440 === 0) return `${delayMinutes / 1440} day${delayMinutes === 1440 ? '' : 's'} after prior message`
  return `${Math.round(delayMinutes / 60)} hours after prior message`
}

function sendDayLabel(days: number[]) {
  const key = [...days].sort((left, right) => left - right).join(',')
  if (key === '1,2,3,4,5') return 'Weekdays'
  if (key === '1,2,3,4,5,6') return 'Monday–Saturday'
  if (key === '0,1,2,3,4,5,6') return 'Every day'
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return days.map((day) => names[day]).filter(Boolean).join(', ')
}

type CampaignDashboardProps = {
  campaigns: ProspectingCampaignSummary[]
  selectedId: string | null
  detail: ProspectingCampaignDetail | null
  loading: boolean
  detailLoading: boolean
  actionPending: boolean
  writesEnabled?: boolean
  lastRefreshedAt?: string | null
  liveRefreshDelayed?: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onDuplicate: (campaign: ProspectingCampaignDetail) => void
  onEdit?: (campaign: ProspectingCampaignDetail) => void
  onTransition: (status: 'active' | 'paused' | 'archived') => void
  onLaunchDialer: (setup: ProspectingDialerSessionSetup) => void
  onRerun?: () => void
  onAudienceChanged?: () => void | Promise<void>
}

export function CampaignDashboard({
  campaigns,
  selectedId,
  detail,
  loading,
  detailLoading,
  actionPending,
  writesEnabled = true,
  lastRefreshedAt = null,
  liveRefreshDelayed = false,
  onSelect,
  onCreate,
  onDuplicate,
  onEdit,
  onTransition,
  onLaunchDialer,
  onRerun,
  onAudienceChanged,
}: CampaignDashboardProps) {
  const [managementOpen, setManagementOpen] = useState(false)
  const [rerunConfirmOpen, setRerunConfirmOpen] = useState(false)

  const campaignMetrics = detail?.kind === 'dialer'
    ? [
        ['groups', detail.stats.total, 'Audience'],
        ['phone_in_talk', detail.stats.active, 'Ready to call'],
        ['task_alt', detail.stats.completed, 'Calls worked'],
        ['block', detail.stats.suppressed, 'Suppressed'],
      ]
    : detail
      ? [
          ['groups', detail.stats.total, 'Audience'],
          ['fact_check', detail.stats.needsReview, 'Needs recipient review'],
          ['send', detail.stats.sent, 'Provider accepted'],
          ['forum', detail.stats.replied, `${percent(detail.stats.replied, detail.stats.sent)}% reply rate`],
        ]
      : []
  const canEditAudience = Boolean(detail && ['draft', 'paused'].includes(detail.status))
  const pickerCampaigns = campaigns.filter((campaign) => campaign.id === selectedId || isProspectingDialerPickerCampaign(campaign))

  function selectCampaign(id: string) {
    setManagementOpen(false)
    setRerunConfirmOpen(false)
    onSelect(id)
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--crm-canvas)] p-3 sm:p-5 lg:p-7">
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="crm-panel rounded-2xl p-4 sm:p-5" aria-labelledby="campaign-picker-label">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p id="campaign-picker-label" className="crm-eyebrow">Choose campaign</p>
              <p className="mt-1 text-sm text-[var(--crm-text-muted)]">Pick the prospecting work you want to continue. Your place is saved automatically.</p>
            </div>
            <select
              aria-label="Choose campaign"
              className="crm-field h-11 min-w-0 rounded-xl px-3 text-sm font-black sm:min-w-80"
              disabled={loading || pickerCampaigns.length === 0}
              value={selectedId ?? ''}
              onChange={(event) => selectCampaign(event.target.value)}
            >
              {pickerCampaigns.length === 0 ? <option value="">No campaigns available</option> : null}
              {pickerCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{prospectingDialerPickerLabel(campaign)}</option>)}
            </select>
          </div>
        </section>

        {!detail || detailLoading ? <div className="crm-panel grid min-h-[24rem] place-items-center rounded-2xl"><div className="text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--crm-surface-subtle)]"><Icon name={detailLoading ? 'progress_activity' : 'campaign'} className={`text-3xl text-[var(--crm-text-dim)] ${detailLoading ? 'animate-spin' : ''}`} /></span><p className="mt-4 text-sm font-black text-[var(--crm-ink)]">{detailLoading ? 'Loading your campaign' : 'No campaign selected'}</p><p className="mt-1 text-xs text-[var(--crm-text-muted)]">{detailLoading ? 'Checking its ready contacts and saved progress.' : 'Open campaign details to build your first campaign.'}</p>{!detailLoading ? <button type="button" onClick={onCreate} className="crm-primary-button mt-5 inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-black"><Icon name="add" />Build a campaign</button> : null}</div></div> : <>
          <article className="overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#121a26_0%,#16243a_58%,#3a202b_100%)] text-white shadow-[0_24px_70px_rgba(5,13,25,0.24)]">
            <div className="relative px-5 py-7 sm:px-8 sm:py-9">
              <div className="absolute -right-16 -top-28 h-72 w-72 rounded-full border border-white/8" />
              <div className="absolute -right-4 -top-10 h-48 w-48 rounded-full border border-white/8" />
              <div className="relative">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${detail.status === 'active' ? 'bg-[#bde2b1] text-[#17221a]' : 'bg-white/12 text-white'}`}>{detail.status}</span>
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/55">{detail.kind === 'dialer' ? 'Calling campaign' : 'SMS campaign'}</span>
                  {detail.status === 'active' ? <span role="status" className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${liveRefreshDelayed ? 'bg-amber-300/20 text-amber-100' : 'bg-white/10 text-white/70'}`}>{liveRefreshDelayed ? 'Updates delayed' : `Live · ${timeLabel(lastRefreshedAt)}`}</span> : null}
                </div>
                <h1 className="mt-4 max-w-3xl text-3xl font-black tracking-tight sm:text-4xl">{detail.name}</h1>

                {detail.kind === 'dialer' ? <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <div>
                    <p className="text-5xl font-black tracking-tight sm:text-6xl">{detail.stats.active}</p>
                    <p className="mt-1 text-sm font-black uppercase tracking-[0.14em] text-white/60">ready to call</p>
                    <p className="mt-5 max-w-2xl text-sm leading-6 text-white/70">{detail.status === 'completed'
                      ? 'This run is complete. Every prior phone attempt and result remains available in the call report. Start another run only when you are ready to work the callable numbers again.'
                      : 'Review one seller, see every associated person and phone number, place a call, then save the outcome before moving to the next seller. Your progress is preserved if you stop.'}</p>
                  </div>
                  <div className="space-y-3">
                    {detail.status === 'active' ? <ProspectingSessionSetup key={detail.id} actionPending={actionPending} activeCount={detail.stats.active} campaignId={detail.id} campaignCallerId={detail.callerId} initialPreset={detail.dialerPreset} writesEnabled={writesEnabled} onLaunch={onLaunchDialer} /> : null}
                    <div className="flex flex-wrap justify-end gap-2">
                      <Link href={`/prospecting/reports?campaign=${encodeURIComponent(detail.id)}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-black text-white hover:bg-white/15"><Icon name="analytics" className="text-lg" />View call report</Link>
                      {detail.status === 'completed' && writesEnabled && onRerun ? <button type="button" onClick={() => setRerunConfirmOpen(true)} disabled={actionPending} className="crm-primary-button inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-xs font-black disabled:opacity-50"><Icon name="refresh" className="text-lg" />Run list again</button> : null}
                    </div>
                  </div>
                </div> : <div className="mt-7"><p className="text-sm font-bold text-white/70">Sends {sendDayLabel(detail.sendDays)} · {detail.sendWindowStart}–{detail.sendWindowEnd} in each seller&apos;s local time</p><p className="mt-2 text-xs text-white/50">Replies and opt-outs stop the sequence automatically.</p></div>}

                <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 border-t border-white/10 pt-5 text-xs font-bold text-white/65">
                  <span className="inline-flex items-center gap-2"><Icon name="verified_user" className="text-[#bde2b1]" />Safety checked before every call</span>
                  {detail.kind === 'dialer' ? <span className="inline-flex items-center gap-2"><Icon name="groups" className="text-white/60" />All associated contacts stay visible</span> : null}
                  <span className="inline-flex items-center gap-2"><Icon name="block" className="text-white/60" />{detail.stats.suppressed} suppressed</span>
                </div>
              </div>
            </div>
          </article>

          {rerunConfirmOpen && detail.kind === 'dialer' && detail.status === 'completed' ? <section role="dialog" aria-modal="true" aria-labelledby="rerun-campaign-title" className="crm-panel rounded-2xl border border-[var(--crm-brand-border)] p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]"><Icon name="refresh" className="text-2xl" /></span>
              <div className="min-w-0 flex-1">
                <h2 id="rerun-campaign-title" className="text-lg font-black text-[var(--crm-ink)]">Run this list again?</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--crm-text-muted)]">This starts a new campaign run and reopens only completed sellers that still have a callable number. Prior attempts, results, DNCs, disconnected numbers, and suppressions stay unchanged in reporting.</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button type="button" onClick={() => { setRerunConfirmOpen(false); onRerun?.() }} disabled={actionPending} className="crm-primary-button inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-black disabled:opacity-50"><Icon name="refresh" />Confirm new run</button>
                  <button type="button" onClick={() => setRerunConfirmOpen(false)} disabled={actionPending} className="crm-secondary-button min-h-11 rounded-xl px-5 text-sm font-black">Cancel</button>
                </div>
              </div>
            </div>
          </section> : null}

          {detail.status === 'draft' || detail.status === 'paused' ? <CampaignLaunchReadiness key={`launch:${detail.id}`} campaign={detail} actionPending={actionPending} onActivate={() => onTransition('active')} /> : null}

          <section className="crm-panel overflow-hidden rounded-2xl">
            <button type="button" aria-expanded={managementOpen} onClick={() => setManagementOpen((open) => !open)} className="flex w-full items-center justify-between gap-4 p-5 text-left sm:px-6">
              <span><span className="block text-sm font-black text-[var(--crm-ink)]">Campaign details</span><span className="mt-1 block text-xs text-[var(--crm-text-muted)]">Setup, audience, safeguards, and activity history</span></span>
              <Icon name={managementOpen ? 'expand_less' : 'expand_more'} className="text-2xl text-[var(--crm-text-muted)]" />
            </button>

            {managementOpen ? <div className="space-y-5 border-t border-[var(--crm-border)] p-5 sm:p-6">
              <div className="flex flex-wrap gap-2">
                {detail.status === 'draft' && onEdit ? <button type="button" onClick={() => onEdit(detail)} disabled={actionPending} className="crm-secondary-button inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-black"><Icon name="edit" />Edit setup</button> : null}
                <button type="button" onClick={() => onDuplicate(detail)} disabled={actionPending} className="crm-secondary-button inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-black"><Icon name="content_copy" />Duplicate setup</button>
                {detail.status === 'active' ? <button type="button" onClick={() => onTransition('paused')} disabled={actionPending} className="crm-secondary-button inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-black"><Icon name="pause" />Pause campaign</button> : null}
                <button type="button" onClick={onCreate} className="crm-secondary-button inline-flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-black"><Icon name="add" />Build another campaign</button>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {campaignMetrics.map(([icon, value, label]) => <div key={String(label)} className="rounded-xl bg-[var(--crm-surface-subtle)] p-4"><div className="flex items-center justify-between"><span className="text-2xl font-black text-[var(--crm-ink)]">{value}</span><Icon name={String(icon)} className="text-xl text-[var(--crm-text-dim)]" /></div><p className="mt-1 text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">{label}</p></div>)}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-[var(--crm-border)] p-5"><p className="crm-eyebrow">Audience health</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">{percent(detail.stats.active, detail.stats.total)}% ready</h2><dl className="mt-4 grid grid-cols-2 gap-3 text-xs">{[['Ready',detail.stats.active],['Needs review',detail.stats.needsReview],['Suppressed',detail.stats.suppressed],['Completed',detail.stats.completed]].map(([label,value]) => <div key={String(label)} className="rounded-xl bg-[var(--crm-surface-subtle)] p-3"><dt className="font-bold text-[var(--crm-text-muted)]">{label}</dt><dd className="mt-1 text-lg font-black text-[var(--crm-ink)]">{value}</dd></div>)}</dl></div>
                <div className="rounded-2xl bg-[#17221a] p-5 text-white"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">Server safeguards</p><h2 className="mt-1 text-lg font-black">Protected at every action</h2><div className="mt-4 grid grid-cols-2 gap-3">{[['block','DNC and STOP'],['schedule','Local-time windows'],['badge','Approved sender'],['reply','Reply cancellation']].map(([icon,label]) => <div key={label} className="flex items-center gap-2 text-xs font-bold text-white/70"><Icon name={icon} className="text-[#bde2b1]" />{label}</div>)}</div></div>
              </div>

              {detail.kind === 'sms' ? <article className="rounded-2xl border border-[var(--crm-border)] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="crm-eyebrow">Sequence</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">Messages sellers receive</h2></div><p className="text-xs font-black text-[var(--crm-ink)]">{detail.perHour}/hour · {detail.perDay}/day</p></div><div className="mt-4 space-y-3">{detail.steps.map((step) => <div key={step.id} className="rounded-xl bg-[var(--crm-surface-subtle)] p-4"><p className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-brand)]">{delayLabel(step.delayMinutes)}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--crm-ink)]">{step.bodyTemplate}</p></div>)}</div></article> : null}
              {detail.kind === 'sms' && detail.status !== 'draft' ? <CampaignDeliveryPulse campaign={detail} /> : null}
              <CampaignActivityFeed key={detail.id} campaignId={detail.id} />
              <CampaignAudienceWorkbench key={`audience:${detail.id}`} campaignId={detail.id} campaignName={detail.name} campaignKind={detail.kind} total={detail.stats.total} canEditAudience={canEditAudience} onAudienceChanged={onAudienceChanged} />
            </div> : null}
          </section>
        </>}
      </div>
    </main>
  )
}
