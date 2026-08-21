'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { Icon } from '@/components/ui/icon'
import type { ProspectingCampaignDetail, ProspectingCampaignSummary } from '@/lib/prospecting/campaign-contract'
import { BROADCAST_TWILIO_NUMBERS, DIALER_CALLER_ID_NUMBERS } from '@/lib/twilio-numbers'

const AUDIENCE_KEY = 'savingkc-prospecting-audience-v1'

type CampaignPage = { items: ProspectingCampaignSummary[]; pageInfo: { hasMore: boolean; nextCursor: string | null } }
type CampaignForm = {
  name: string
  kind: 'dialer' | 'sms'
  callerId: string
  fromPhone: string
  perHour: number
  perDay: number
  steps: Array<{ delayMinutes: number; bodyTemplate: string }>
}

const EMPTY_FORM: CampaignForm = {
  name: '',
  kind: 'dialer',
  callerId: DIALER_CALLER_ID_NUMBERS[0]?.value || '',
  fromPhone: BROADCAST_TWILIO_NUMBERS[0]?.value || '',
  perHour: 75,
  perDay: 500,
  steps: [{ delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}, this is {{agent_name}} with SavingKC. Would you consider an offer on {{property_address}}?' }],
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || 'Request failed')
  return body
}

function campaignTone(status: ProspectingCampaignSummary['status']) {
  if (status === 'active') return 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]'
  if (status === 'paused') return 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]'
  if (status === 'archived') return 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'
  return 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'
}

export function ProspectingWorkspace({ openCreate = false }: { openCreate?: boolean }) {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<ProspectingCampaignSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProspectingCampaignDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(openCreate)
  const [pendingLeadIds, setPendingLeadIds] = useState<string[]>([])
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadCampaigns = useCallback(async () => {
    const page = await jsonRequest<CampaignPage>('/api/prospecting/campaigns?limit=50')
    setCampaigns(page.items)
    setSelectedId((current) => current || page.items[0]?.id || null)
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    try {
      const payload = await jsonRequest<{ campaign: ProspectingCampaignDetail }>(`/api/prospecting/campaigns/${id}`)
      setDetail(payload.campaign)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(AUDIENCE_KEY)
      const parsed = stored ? JSON.parse(stored) : []
      if (Array.isArray(parsed)) setPendingLeadIds(parsed.filter((value): value is string => typeof value === 'string'))
    } catch { /* a blocked session store simply means no preselected audience */ }
    void loadCampaigns().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Campaigns could not be loaded')).finally(() => setLoading(false))
  }, [loadCampaigns])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    void loadDetail(selectedId).catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Campaign details could not be loaded'))
  }, [loadDetail, selectedId])

  function updateStep(index: number, patch: Partial<CampaignForm['steps'][number]>) {
    setForm((current) => ({ ...current, steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) }))
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const created = await jsonRequest<{ campaign: ProspectingCampaignDetail }>('/api/prospecting/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          defaultTimezone: 'America/Chicago',
          steps: form.kind === 'sms' ? form.steps : [],
        }),
      })
      if (pendingLeadIds.length > 0) {
        const memberResult = await jsonRequest<{ enrollment: { eligible: number; suppressed: number; missing: number } }>(`/api/prospecting/campaigns/${created.campaign.id}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadIds: pendingLeadIds }),
        })
        setNotice(`${memberResult.enrollment.eligible} eligible; ${memberResult.enrollment.suppressed} safely suppressed; ${memberResult.enrollment.missing} missing a usable phone.`)
        window.sessionStorage.removeItem(AUDIENCE_KEY)
        setPendingLeadIds([])
      }
      setDialogOpen(false)
      setForm(EMPTY_FORM)
      setSelectedId(created.campaign.id)
      await loadCampaigns()
      await loadDetail(created.campaign.id)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Campaign could not be created')
    } finally {
      setSaving(false)
    }
  }

  async function transition(status: 'active' | 'paused' | 'archived') {
    if (!detail || actionPending) return
    setActionPending(true)
    setError(null)
    try {
      await jsonRequest(`/api/prospecting/campaigns/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await Promise.all([loadCampaigns(), loadDetail(detail.id)])
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : 'Campaign status could not be changed')
    } finally {
      setActionPending(false)
    }
  }

  async function enrollSelectedIntoCurrentCampaign() {
    if (!detail || pendingLeadIds.length < 1 || actionPending) return
    setActionPending(true)
    setError(null)
    try {
      const result = await jsonRequest<{ enrollment: { eligible: number; suppressed: number; missing: number } }>(`/api/prospecting/campaigns/${detail.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: pendingLeadIds }),
      })
      window.sessionStorage.removeItem(AUDIENCE_KEY)
      setPendingLeadIds([])
      setDialogOpen(false)
      setNotice(`${result.enrollment.eligible} eligible; ${result.enrollment.suppressed} safely suppressed; ${result.enrollment.missing} missing a usable phone.`)
      await loadDetail(detail.id)
    } catch (enrollmentError) {
      setError(enrollmentError instanceof Error ? enrollmentError.message : 'Audience could not be added')
    } finally {
      setActionPending(false)
    }
  }

  async function launchDialer() {
    if (!detail || actionPending) return
    setActionPending(true)
    setError(null)
    try {
      const result = await jsonRequest<{ session: { id: string } }>(`/api/prospecting/campaigns/${detail.id}/launch`, { method: 'POST' })
      router.push(`/dialer?session_id=${result.session.id}`)
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : 'Dialer session could not start')
      setActionPending(false)
    }
  }

  const commandBar = (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="min-w-0"><p className="crm-eyebrow">Prospecting</p><h1 className="truncate text-xl font-black text-[var(--crm-ink)]">Campaign command center</h1></div>
      <button type="button" onClick={() => { setError(null); setDialogOpen(true) }} className="crm-primary-button inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-black"><Icon name="add" />New campaign</button>
    </div>
  )

  return <>
    <WorkspaceChrome commandBar={commandBar} />
    <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--crm-canvas)] p-3 sm:p-5 lg:p-7">
      <div className="mx-auto grid max-w-[1440px] gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="crm-panel overflow-hidden rounded-2xl">
          <div className="border-b border-[var(--crm-border)] p-4"><p className="text-sm font-black text-[var(--crm-ink)]">Campaigns</p><p className="mt-1 text-xs text-[var(--crm-text-muted)]">One audience, one owner, one safe execution path.</p></div>
          {loading ? <p className="p-4 text-sm text-[var(--crm-text-muted)]">Loading campaigns…</p> : campaigns.length === 0 ? <div className="p-5 text-center"><Icon name="campaign" className="text-4xl text-[var(--crm-text-dim)]" /><p className="mt-2 text-sm font-black text-[var(--crm-ink)]">No campaigns yet</p><p className="mt-1 text-xs leading-5 text-[var(--crm-text-muted)]">Select contacts in Pipeline or start a clean campaign here.</p></div> : <div className="divide-y divide-[var(--crm-border)]">{campaigns.map((campaign) => <button key={campaign.id} type="button" onClick={() => setSelectedId(campaign.id)} className={`w-full p-4 text-left transition ${selectedId === campaign.id ? 'bg-[var(--crm-brand-soft)]' : 'hover:bg-[var(--crm-surface-subtle)]'}`}><div className="flex items-start justify-between gap-2"><span className="text-sm font-black text-[var(--crm-ink)]">{campaign.name}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${campaignTone(campaign.status)}`}>{campaign.status}</span></div><p className="mt-1 text-xs text-[var(--crm-text-muted)]">{campaign.kind === 'dialer' ? 'Single-line calls' : 'SMS sequence'} · {campaign.ownerName}</p></button>)}</div>}
        </aside>

        <section className="min-w-0">
          {error ? <div role="alert" className="mb-4 rounded-xl border border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)] px-4 py-3 text-sm font-bold text-[var(--crm-danger)]">{error}</div> : null}
          {notice ? <div role="status" className="mb-4 rounded-xl border border-[var(--crm-success)]/30 bg-[var(--crm-success-soft)] px-4 py-3 text-sm font-bold text-[var(--crm-success)]">{notice}</div> : null}
          {!detail || detailLoading ? <div className="crm-panel grid min-h-[28rem] place-items-center rounded-2xl"><p className="text-sm text-[var(--crm-text-muted)]">{detailLoading ? 'Loading campaign…' : 'Choose or create a campaign.'}</p></div> : <div className="space-y-4">
            <div className="crm-panel rounded-2xl p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${campaignTone(detail.status)}`}>{detail.status}</span><span className="text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">{detail.kind === 'dialer' ? 'Mojo-style single line' : 'SMS cadence'}</span></div><h2 className="mt-3 text-2xl font-black tracking-tight text-[var(--crm-ink)]">{detail.name}</h2><p className="mt-1 text-sm text-[var(--crm-text-muted)]">Owned by {detail.ownerName} · {detail.defaultTimezone.replace('_', ' ')}</p></div><div className="flex flex-wrap gap-2">{detail.status === 'draft' || detail.status === 'paused' ? <button type="button" onClick={() => void transition('active')} disabled={actionPending || detail.stats.active < 1} className="crm-primary-button rounded-lg px-4 py-2 text-xs font-black disabled:opacity-40">{detail.status === 'paused' ? 'Resume' : 'Activate'}</button> : null}{detail.status === 'active' ? <button type="button" onClick={() => void transition('paused')} disabled={actionPending} className="crm-secondary-button rounded-lg px-4 py-2 text-xs font-black">Pause</button> : null}{detail.kind === 'dialer' && detail.status === 'active' ? <button type="button" onClick={() => void launchDialer()} disabled={actionPending} className="crm-primary-button inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-black"><Icon name="phone_in_talk" className="text-base" />Start calling</button> : null}</div></div>
              <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">{Object.entries(detail.stats).map(([label, value]) => <div key={label} className="rounded-xl bg-[var(--crm-surface-subtle)] p-3"><p className="text-xl font-black text-[var(--crm-ink)]">{value}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">{label}</p></div>)}</div>
            </div>

            {detail.kind === 'sms' ? <div className="crm-panel rounded-2xl p-5"><div className="flex items-center justify-between"><div><h3 className="font-black text-[var(--crm-ink)]">Sequence</h3><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Stops automatically when the contact replies or opts out.</p></div><span className="text-xs font-bold text-[var(--crm-text-muted)]">{detail.perHour}/hr · {detail.perDay}/day</span></div><div className="mt-4 space-y-2">{detail.steps.map((step) => <div key={step.id} className="flex gap-3 rounded-xl border border-[var(--crm-border)] p-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--crm-brand-soft)] text-xs font-black text-[var(--crm-brand)]">{step.position}</span><div className="min-w-0"><p className="text-xs font-bold text-[var(--crm-text-muted)]">{step.delayMinutes === 0 ? 'Send when activated' : `${Math.round(step.delayMinutes / 60)} hours after prior step`}</p><p className="mt-1 whitespace-pre-wrap text-sm text-[var(--crm-ink)]">{step.bodyTemplate}</p></div></div>)}</div></div> : null}

            <div className="crm-panel rounded-2xl p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black text-[var(--crm-ink)]">Audience</h3><p className="mt-1 text-xs text-[var(--crm-text-muted)]">The first 100 contacts are shown. Suppressed contacts never enter execution.</p></div><Link href="/contacts?list=prospects" className="crm-secondary-button inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black"><Icon name="person_add" className="text-base" />Select contacts</Link></div>{detail.members.length === 0 ? <p className="mt-5 rounded-xl bg-[var(--crm-surface-subtle)] p-4 text-sm text-[var(--crm-text-muted)]">No audience yet. Select contacts in Pipeline, then start a campaign.</p> : <div className="mt-4 divide-y divide-[var(--crm-border)]">{detail.members.map((member) => <div key={member.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-[var(--crm-ink)]">{member.lead?.fullName || member.phone}</p><p className="truncate text-xs text-[var(--crm-text-muted)]">{member.lead?.propertyAddress || member.phone} · {member.timezone}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase ${member.status === 'active' ? 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : member.status === 'suppressed' ? 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'}`}>{member.suppressionReason || member.status}</span></div>)}</div>}</div>
          </div>}
        </section>
      </div>
    </main>

    {dialogOpen ? <div className="fixed inset-0 z-[90] grid place-items-center bg-black/45 p-3" role="dialog" aria-modal="true" aria-label="Create campaign"><form onSubmit={createCampaign} className="crm-panel max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-3"><div><p className="crm-eyebrow">New prospecting campaign</p><h2 className="mt-1 text-xl font-black text-[var(--crm-ink)]">Choose one execution path</h2><p className="mt-1 text-sm text-[var(--crm-text-muted)]">{pendingLeadIds.length ? `${pendingLeadIds.length} selected contact${pendingLeadIds.length === 1 ? '' : 's'} will be checked for eligibility.` : 'Create the campaign, then select its audience from Pipeline.'}</p></div><button type="button" onClick={() => setDialogOpen(false)} aria-label="Close" className="crm-icon-button grid h-9 w-9 place-items-center rounded-lg"><Icon name="close" /></button></div>
      <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-[var(--crm-surface-subtle)] p-1"><button type="button" onClick={() => setForm((current) => ({ ...current, kind: 'dialer' }))} className={`rounded-lg px-3 py-3 text-sm font-black ${form.kind === 'dialer' ? 'bg-[var(--crm-surface)] text-[var(--crm-brand)] shadow-sm' : 'text-[var(--crm-text-muted)]'}`}><Icon name="phone_in_talk" className="mr-2 align-middle" />Single-line dialer</button><button type="button" onClick={() => setForm((current) => ({ ...current, kind: 'sms' }))} className={`rounded-lg px-3 py-3 text-sm font-black ${form.kind === 'sms' ? 'bg-[var(--crm-surface)] text-[var(--crm-brand)] shadow-sm' : 'text-[var(--crm-text-muted)]'}`}><Icon name="sms" className="mr-2 align-middle" />SMS sequence</button></div>
      <label className="mt-5 block"><span className="text-xs font-black text-[var(--crm-ink)]">Campaign name</span><input required maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="August absentee owners" className="crm-field mt-1.5 h-11 w-full rounded-xl px-3 text-sm" /></label>
      {form.kind === 'dialer' ? <label className="mt-4 block"><span className="text-xs font-black text-[var(--crm-ink)]">Calling number</span><select value={form.callerId} onChange={(event) => setForm((current) => ({ ...current, callerId: event.target.value }))} className="crm-field mt-1.5 h-11 w-full rounded-xl px-3 text-sm">{DIALER_CALLER_ID_NUMBERS.map((number) => <option key={number.value} value={number.value}>{number.label}</option>)}</select><p className="mt-2 text-xs text-[var(--crm-text-muted)]">Calls stay single-line and require an outcome before advancing.</p></label> : <><div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="sm:col-span-1"><span className="text-xs font-black text-[var(--crm-ink)]">Texting number</span><select value={form.fromPhone} onChange={(event) => setForm((current) => ({ ...current, fromPhone: event.target.value }))} className="crm-field mt-1.5 h-11 w-full rounded-xl px-3 text-sm">{BROADCAST_TWILIO_NUMBERS.map((number) => <option key={number.value} value={number.value}>{number.label}</option>)}</select></label><label><span className="text-xs font-black text-[var(--crm-ink)]">Per hour</span><input type="number" min={1} max={5000} value={form.perHour} onChange={(event) => setForm((current) => ({ ...current, perHour: Number(event.target.value) }))} className="crm-field mt-1.5 h-11 w-full rounded-xl px-3 text-sm" /></label><label><span className="text-xs font-black text-[var(--crm-ink)]">Per day</span><input type="number" min={1} max={50000} value={form.perDay} onChange={(event) => setForm((current) => ({ ...current, perDay: Number(event.target.value) }))} className="crm-field mt-1.5 h-11 w-full rounded-xl px-3 text-sm" /></label></div><div className="mt-5"><div className="flex items-center justify-between"><span className="text-xs font-black text-[var(--crm-ink)]">Message steps</span><button type="button" disabled={form.steps.length >= 12} onClick={() => setForm((current) => ({ ...current, steps: [...current.steps, { delayMinutes: 1440, bodyTemplate: '' }] }))} className="text-xs font-black text-[var(--crm-brand)] disabled:opacity-40">+ Add step</button></div><div className="mt-2 space-y-3">{form.steps.map((step, index) => <div key={index} className="rounded-xl border border-[var(--crm-border)] p-3"><div className="flex items-center justify-between"><span className="text-xs font-black text-[var(--crm-ink)]">Step {index + 1}</span>{form.steps.length > 1 ? <button type="button" onClick={() => setForm((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) }))} className="text-xs font-bold text-[var(--crm-danger)]">Remove</button> : null}</div><label className="mt-2 block"><span className="text-[10px] font-bold uppercase text-[var(--crm-text-muted)]">Delay after prior step (hours)</span><input type="number" min={0} max={720} value={Math.round(step.delayMinutes / 60)} onChange={(event) => updateStep(index, { delayMinutes: Number(event.target.value) * 60 })} className="crm-field mt-1 h-10 w-32 rounded-lg px-3 text-sm" /></label><textarea required maxLength={1400} value={step.bodyTemplate} onChange={(event) => updateStep(index, { bodyTemplate: event.target.value })} rows={3} className="crm-field mt-2 w-full rounded-lg px-3 py-2 text-sm" placeholder="Hi {{first_name}}…" /><p className="mt-1 text-[10px] text-[var(--crm-text-muted)]">Variables: {'{{first_name}}'}, {'{{full_name}}'}, {'{{property_address}}'}, {'{{agent_name}}'}</p></div>)}</div></div></>}
      <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-[var(--crm-border)] pt-4">{pendingLeadIds.length > 0 && detail && ['draft', 'paused'].includes(detail.status) ? <button type="button" onClick={() => void enrollSelectedIntoCurrentCampaign()} disabled={actionPending} className="crm-secondary-button mr-auto rounded-lg px-4 py-2 text-sm font-black disabled:opacity-50">Add to {detail.name}</button> : null}<button type="button" onClick={() => setDialogOpen(false)} className="crm-secondary-button rounded-lg px-4 py-2 text-sm font-black">Cancel</button><button type="submit" disabled={saving} className="crm-primary-button rounded-lg px-5 py-2 text-sm font-black disabled:opacity-50">{saving ? 'Creating…' : 'Create draft'}</button></div>
    </form></div> : null}
  </>
}
