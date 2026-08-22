'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { ProspectingCampaignDetail } from '@/lib/prospecting/campaign-contract'

type ReadinessItem = { label: string; detail: string; ready: boolean }

export function CampaignLaunchReadiness({ campaign, actionPending, onActivate }: { campaign: ProspectingCampaignDetail; actionPending: boolean; onActivate: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const isSms = campaign.kind === 'sms'
  const items: ReadinessItem[] = [
    { label: 'Eligible audience', detail: campaign.stats.active > 0 ? `${campaign.stats.active} seller${campaign.stats.active === 1 ? '' : 's'} ready` : 'Add at least one eligible seller', ready: campaign.stats.active > 0 },
    { label: isSms ? 'Approved texting number' : 'Approved caller ID', detail: (isSms ? campaign.fromPhone : campaign.callerId) || 'Choose an approved team number', ready: Boolean(isSms ? campaign.fromPhone : campaign.callerId) },
    { label: isSms ? 'Message sequence' : 'Human-owned calling floor', detail: isSms ? `${campaign.steps.length} reviewed step${campaign.steps.length === 1 ? '' : 's'}` : 'No calls are placed automatically', ready: !isSms || campaign.steps.length > 0 },
    { label: 'Safety exclusions', detail: `${campaign.stats.suppressed} suppressed; every action is rechecked`, ready: true },
  ]
  const blockers = items.filter((item) => !item.ready)
  const resume = campaign.status === 'paused'

  return (
    <article className="crm-panel rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="crm-eyebrow">Launch readiness</p><h2 className="mt-1 text-xl font-black text-[var(--crm-ink)]">{blockers.length === 0 ? `Ready to ${resume ? 'resume' : 'activate'}` : `${blockers.length} item${blockers.length === 1 ? '' : 's'} ${blockers.length === 1 ? 'needs' : 'need'} attention`}</h2><p className="mt-1 text-xs leading-5 text-[var(--crm-text-muted)]">Review the audience, identity, workflow, and safeguards before anything goes live.</p></div>
        <button type="button" onClick={() => setConfirmOpen(true)} disabled={actionPending || blockers.length > 0} className="crm-primary-button inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-black disabled:opacity-40"><Icon name="rocket_launch" />Review &amp; {resume ? 'resume' : 'activate'}</button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {items.map((item) => <div key={item.label} className="flex gap-3 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${item.ready ? 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]'}`}><Icon name={item.ready ? 'check_circle' : 'error'} className="text-lg" /></span><div><p className="text-sm font-black text-[var(--crm-ink)]">{item.label}</p><p className="mt-1 text-xs leading-5 text-[var(--crm-text-muted)]">{item.detail}</p></div></div>)}
      </div>
      {confirmOpen ? <div className="fixed inset-0 z-[80] grid place-items-center bg-[#101711]/60 p-4 backdrop-blur-sm" role="presentation" onKeyDown={(event) => { if (event.key === 'Escape') setConfirmOpen(false) }} onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmOpen(false) }}><section role="dialog" aria-modal="true" aria-labelledby="campaign-launch-title" className="crm-panel w-full max-w-lg rounded-2xl p-6 shadow-2xl"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]"><Icon name={isSms ? 'sms' : 'phone_in_talk'} className="text-2xl" /></span><p className="crm-eyebrow mt-5">Final confirmation</p><h2 id="campaign-launch-title" className="mt-1 text-2xl font-black text-[var(--crm-ink)]">{resume ? 'Resume' : 'Activate'} {campaign.name}?</h2><p className="mt-3 text-sm leading-6 text-[var(--crm-text-muted)]">{isSms ? `This can queue automated seller messages for ${campaign.stats.active} eligible contact${campaign.stats.active === 1 ? '' : 's'} inside the configured local-time windows. Replies and opt-outs stop automation.` : `This unlocks a human-owned calling session for ${campaign.stats.active} eligible contact${campaign.stats.active === 1 ? '' : 's'}. It does not place a call automatically.`}</p><div className="mt-6 rounded-xl bg-[var(--crm-surface-subtle)] p-4 text-xs leading-5 text-[var(--crm-text-muted)]"><strong className="text-[var(--crm-ink)]">Protected:</strong> {campaign.stats.suppressed} suppressed contact{campaign.stats.suppressed === 1 ? '' : 's'} stay out, and eligibility is checked again by the server.</div><div className="mt-6 flex justify-end gap-2"><button type="button" autoFocus onClick={() => setConfirmOpen(false)} className="crm-secondary-button h-10 rounded-lg px-4 text-xs font-black">Cancel</button><button type="button" onClick={() => { setConfirmOpen(false); onActivate() }} disabled={actionPending} className="crm-primary-button h-10 rounded-lg px-4 text-xs font-black disabled:opacity-50">Yes, {resume ? 'resume' : 'activate'} campaign</button></div></section></div> : null}
    </article>
  )
}
