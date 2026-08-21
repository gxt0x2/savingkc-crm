'use client'

import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { campaignAudienceContactsHref } from '@/lib/prospecting/audience-handoff'
import type { ProspectingCampaignDetail } from '@/lib/prospecting/campaign-contract'

export function CampaignAudienceReview({ campaign, pendingCount, saving, onConfirm, onCancel }: {
  campaign: ProspectingCampaignDetail | null
  pendingCount: number
  saving: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const canEdit = Boolean(campaign && ['draft', 'paused'].includes(campaign.status))
  const chooseHref = campaign ? campaignAudienceContactsHref(campaign.id, campaign.name) : '/contacts?list=prospects'
  const campaignState = !campaign ? ['Checking campaign', 'Loading status'] : canEdit ? ['Ready to review', 'Draft or paused'] : ['Audience locked', 'Pause before editing']

  return <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--crm-canvas)] p-3 sm:p-5 lg:p-7">
    <div className="mx-auto max-w-5xl space-y-4">
      <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 text-xs font-black text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]"><Icon name="arrow_back" className="text-base" />Campaigns</button>
      <section className="crm-panel overflow-hidden rounded-2xl">
        <div className="relative overflow-hidden bg-[linear-gradient(125deg,var(--crm-brand),#3f5a36_55%,#17221a)] px-5 py-7 text-white sm:px-8 sm:py-9">
          <div className="absolute -right-16 -top-24 h-56 w-56 rounded-full border border-white/15" />
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/65">Audience review</p>
          <h1 className="mt-2 max-w-2xl text-2xl font-black tracking-tight sm:text-3xl">Add the right sellers—not just a list.</h1>
          <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-white/75">Selected contacts are checked again by the server before they enter {campaign?.name || 'this campaign'}. Nothing starts automatically.</p>
        </div>
        <div className="grid gap-px bg-[var(--crm-border)] sm:grid-cols-3">
          {[
            ['groups', pendingCount.toLocaleString(), 'Selected contacts'],
            ['campaign', campaign?.name || 'Loading campaign…', 'Target campaign'],
            ['verified_user', campaignState[0], campaignState[1]],
          ].map(([icon, value, label]) => <div key={label} className="bg-[var(--crm-surface)] p-5"><Icon name={icon} className="text-xl text-[var(--crm-brand)]" /><p className="mt-3 truncate text-lg font-black text-[var(--crm-ink)]">{value}</p><p className="mt-1 text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">{label}</p></div>)}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="crm-panel rounded-2xl p-5 sm:p-6">
          <p className="crm-eyebrow">Before enrollment</p>
          <h2 className="mt-1 text-xl font-black text-[var(--crm-ink)]">The safety pass runs on every contact</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              ['block', 'DNC and STOP', 'Opted-out sellers remain suppressed and visible.'],
              ['person_off', 'Dead and closed records', 'Terminal records cannot become executable work.'],
              ['phone_disabled', 'Missing or unusable phone', 'Invalid contact rows are reported, never queued.'],
              ['lock_clock', 'Human activation', 'Enrollment does not send messages or place calls.'],
            ].map(([icon, title, detail]) => <div key={title} className="rounded-xl border border-[var(--crm-border)] p-4"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]"><Icon name={icon} /></span><p className="mt-3 text-sm font-black text-[var(--crm-ink)]">{title}</p><p className="mt-1 text-xs leading-5 text-[var(--crm-text-muted)]">{detail}</p></div>)}
          </div>
        </section>

        <aside className="crm-panel h-fit rounded-2xl p-5">
          <p className="crm-eyebrow">Confirm audience</p>
          <h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">{pendingCount ? `${pendingCount} contact${pendingCount === 1 ? '' : 's'} selected` : 'Choose contacts first'}</h2>
          <p className="mt-2 text-xs leading-5 text-[var(--crm-text-muted)]">After the safety pass, you will see exactly how many are ready, suppressed, or missing a usable phone.</p>
          {pendingCount > 0 ? <button type="button" onClick={onConfirm} disabled={!canEdit || saving} className="crm-primary-button mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-black disabled:cursor-not-allowed disabled:opacity-45"><Icon name={saving ? 'progress_activity' : 'group_add'} className={saving ? 'animate-spin' : ''} />{saving ? 'Checking audience…' : `Add ${pendingCount} to campaign`}</button> : null}
          {campaign ? <Link href={chooseHref} className="crm-secondary-button mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-black"><Icon name="person_search" />{pendingCount ? 'Change selection' : 'Choose contacts'}</Link> : <button type="button" disabled className="crm-secondary-button mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-black opacity-50"><Icon name="progress_activity" className="animate-spin" />Loading campaign…</button>}
          {!canEdit && campaign ? <p role="alert" className="mt-3 rounded-lg bg-[var(--crm-warning-soft)] p-3 text-[11px] font-bold leading-4 text-[var(--crm-warning)]">Pause this campaign before changing its audience.</p> : null}
        </aside>
      </div>
    </div>
  </main>
}
