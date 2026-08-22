'use client'

import { FormEvent, useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { BROADCAST_TWILIO_NUMBERS, DIALER_CALLER_ID_NUMBERS } from '@/lib/twilio-numbers'

export type CampaignForm = {
  name: string
  kind: 'dialer' | 'sms'
  callerId: string
  fromPhone: string
  perHour: number
  perDay: number
  steps: Array<{ delayMinutes: number; bodyTemplate: string }>
}

export const EMPTY_CAMPAIGN_FORM: CampaignForm = {
  name: '',
  kind: 'dialer',
  callerId: DIALER_CALLER_ID_NUMBERS[0]?.value || '',
  fromPhone: BROADCAST_TWILIO_NUMBERS[0]?.value || '',
  perHour: 75,
  perDay: 500,
  steps: [{ delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}, this is {{agent_name}} with SavingKC. Would you consider an offer on {{property_address}}?' }],
}

const SMS_STARTERS = [
  {
    name: 'Absentee owner',
    detail: 'A respectful three-touch property conversation.',
    steps: [
      { delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}, this is {{agent_name}} with SavingKC. Would you consider an offer on {{property_address}}?' },
      { delayMinutes: 1440, bodyTemplate: 'Hi {{first_name}}, just following up about {{property_address}}. Is selling something you would consider this year?' },
      { delayMinutes: 4320, bodyTemplate: 'I will close the loop for now, {{first_name}}. If you ever want to discuss {{property_address}}, I am happy to help. — {{agent_name}}' },
    ],
  },
  {
    name: 'Warm follow-up',
    detail: 'Reconnect after a prior conversation.',
    steps: [
      { delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}, {{agent_name}} here with SavingKC. I wanted to reconnect about {{property_address}}. Is now a better time to talk?' },
      { delayMinutes: 2880, bodyTemplate: 'Checking back once more, {{first_name}}. I can work around your timing if you are still considering options for {{property_address}}.' },
    ],
  },
] as const

const STUDIO_STEPS = [
  { id: 1, label: 'Setup', detail: 'Name and channel' },
  { id: 2, label: 'Build', detail: 'Calling flow or cadence' },
  { id: 3, label: 'Review', detail: 'Audience and safeguards' },
] as const

function sampleMessage(template: string) {
  return template
    .replaceAll('{{first_name}}', 'Helen')
    .replaceAll('{{full_name}}', 'Helen Seller')
    .replaceAll('{{property_address}}', '123 Main Street')
    .replaceAll('{{agent_name}}', 'Your name')
}

function delayLabel(delayMinutes: number) {
  if (delayMinutes === 0) return 'Immediately'
  if (delayMinutes % 1440 === 0) return `${delayMinutes / 1440} day${delayMinutes === 1440 ? '' : 's'} later`
  return `${Math.round(delayMinutes / 60)} hours later`
}

function phoneLabel(phone: string, options: ReadonlyArray<{ value: string; label: string }>) {
  return options.find((option) => option.value === phone)?.label || phone
}

type CampaignStudioProps = {
  form: CampaignForm
  pendingLeadIds: string[]
  saving: boolean
  sourceCampaignName?: string | null
  editingCampaignName?: string | null
  editingAudienceCount?: number
  existingCampaignName?: string | null
  canAddToExisting?: boolean
  onChange: (updater: (current: CampaignForm) => CampaignForm) => void
  onCancel: () => void
  onCreate: (event: FormEvent) => void
  onAddToExisting: () => void
}

export function CampaignStudio({
  form,
  pendingLeadIds,
  saving,
  sourceCampaignName,
  editingCampaignName,
  editingAudienceCount = 0,
  existingCampaignName,
  canAddToExisting = false,
  onChange,
  onCancel,
  onCreate,
  onAddToExisting,
}: CampaignStudioProps) {
  const [studioStep, setStudioStep] = useState(1)
  const [activeMessage, setActiveMessage] = useState(0)
  const stepIsValid = useMemo(() => {
    if (studioStep === 1) return form.name.trim().length > 0
    if (studioStep === 2 && form.kind === 'sms') {
      return form.steps.length > 0 && form.steps.every((step) => step.bodyTemplate.trim().length > 0)
    }
    return true
  }, [form.kind, form.name, form.steps, studioStep])

  function updateStep(index: number, patch: Partial<CampaignForm['steps'][number]>) {
    onChange((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step),
    }))
  }

  function insertVariable(variable: string) {
    updateStep(activeMessage, { bodyTemplate: `${form.steps[activeMessage]?.bodyTemplate || ''}${variable}` })
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--crm-canvas)] p-3 sm:p-5 lg:p-7">
      <form onSubmit={onCreate} className="mx-auto grid max-w-[1480px] gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="crm-panel h-fit overflow-hidden rounded-2xl xl:sticky xl:top-0">
          <div className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-5">
            <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 text-xs font-black text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]">
              <Icon name="arrow_back" className="text-base" /> Campaigns
            </button>
            <p className="crm-eyebrow mt-5">Campaign studio</p>
            <h2 className="mt-1 text-xl font-black tracking-tight text-[var(--crm-ink)]">{editingCampaignName ? 'Correct this draft' : 'Build a clean launch'}</h2>
            <p className="mt-2 text-xs leading-5 text-[var(--crm-text-muted)]">{editingCampaignName ? 'Update setup without replacing its audience or history.' : 'One audience, one channel, and a review before anything runs.'}</p>
          </div>
          <ol className="p-3">
            {STUDIO_STEPS.map((step) => {
              const active = studioStep === step.id
              const complete = studioStep > step.id
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => complete && setStudioStep(step.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${active ? 'bg-[var(--crm-brand-soft)]' : ''}`}
                    aria-current={active ? 'step' : undefined}
                  >
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black ${active || complete ? 'bg-[var(--crm-brand)] text-white' : 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'}`}>
                      {complete ? <Icon name="check" className="text-base" /> : step.id}
                    </span>
                    <span><span className="block text-sm font-black text-[var(--crm-ink)]">{step.label}</span><span className="block text-[11px] text-[var(--crm-text-muted)]">{step.detail}</span></span>
                  </button>
                </li>
              )
            })}
          </ol>
          <div className="border-t border-[var(--crm-border)] p-4">
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--crm-success)]"><Icon name="verified_user" className="text-lg" /> Safety checks stay on</div>
            <p className="mt-1 text-[10px] leading-4 text-[var(--crm-text-muted)]">DNC, dead records, sender identity, reply stops, and calling policy are enforced by the server.</p>
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          <header className="crm-panel overflow-hidden rounded-2xl">
            <div className="relative overflow-hidden bg-[linear-gradient(125deg,var(--crm-brand),#3f5a36_55%,#17221a)] px-5 py-6 text-white sm:px-7">
              <div className="absolute -right-16 -top-24 h-56 w-56 rounded-full border border-white/15" />
              <div className="absolute -right-6 -top-14 h-40 w-40 rounded-full border border-white/10" />
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/70">Step {studioStep} of 3</p>
              <h1 className="mt-2 max-w-2xl text-2xl font-black tracking-tight sm:text-3xl">
                {studioStep === 1 ? 'What are we launching?' : studioStep === 2 ? (form.kind === 'sms' ? 'Build the conversation.' : 'Set up the calling lane.') : 'Review before you activate.'}
              </h1>
              <p className="mt-2 max-w-xl text-sm font-medium leading-6 text-white/75">
                {studioStep === 1 ? 'Choose the workflow that matches the work—not a pretend predictive mode.' : studioStep === 2 ? 'Keep the flow simple enough for the team to operate consistently.' : 'The campaign will remain a draft until you explicitly activate it.'}
              </p>
            </div>
          </header>

          {sourceCampaignName ? <div className="rounded-xl border border-[var(--crm-info)]/25 bg-[var(--crm-info-soft)] px-4 py-3 text-sm text-[var(--crm-info)]" role="status"><strong>Setup copied from {sourceCampaignName}.</strong> Audience and activity were intentionally left behind so this starts as a clean draft.</div> : null}
          {editingCampaignName ? <div className="rounded-xl border border-[var(--crm-info)]/25 bg-[var(--crm-info-soft)] px-4 py-3 text-sm text-[var(--crm-info)]" role="status"><strong>Editing {editingCampaignName}.</strong> Its current audience and activity will stay attached. Saving does not activate it.</div> : null}

          {studioStep === 1 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <label className="crm-panel rounded-2xl p-5 lg:col-span-2">
                <span className="text-xs font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Campaign name</span>
                <input required maxLength={120} value={form.name} onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))} placeholder="September absentee owners" className="crm-field mt-2 h-12 w-full rounded-xl px-4 text-base font-bold" autoFocus />
                <span className="mt-2 block text-xs text-[var(--crm-text-muted)]">Use a name the team will recognize in history and reporting.</span>
              </label>
              <button type="button" onClick={() => onChange((current) => ({ ...current, kind: 'dialer' }))} className={`crm-panel group rounded-2xl border-2 p-5 text-left transition ${form.kind === 'dialer' ? 'border-[var(--crm-brand)] shadow-[0_10px_30px_rgba(52,78,48,0.12)]' : 'border-transparent hover:border-[var(--crm-border)]'}`}>
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]"><Icon name="phone_in_talk" className="text-2xl" /></span>
                <span className="mt-5 flex items-center justify-between"><span className="text-lg font-black text-[var(--crm-ink)]">Power dialer</span>{form.kind === 'dialer' ? <Icon name="check_circle" className="text-xl text-[var(--crm-brand)]" /> : null}</span>
                <span className="mt-2 block text-sm leading-6 text-[var(--crm-text-muted)]">Work one seller at a time with a pre-call brief, required outcome, and automatic advance.</span>
                <span className="mt-4 block text-[10px] font-black uppercase tracking-widest text-[var(--crm-brand)]">Mojo-inspired · honest single line</span>
              </button>
              <button type="button" onClick={() => onChange((current) => ({ ...current, kind: 'sms' }))} className={`crm-panel group rounded-2xl border-2 p-5 text-left transition ${form.kind === 'sms' ? 'border-[var(--crm-brand)] shadow-[0_10px_30px_rgba(52,78,48,0.12)]' : 'border-transparent hover:border-[var(--crm-border)]'}`}>
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--crm-info-soft)] text-[var(--crm-info)]"><Icon name="sms" className="text-2xl" /></span>
                <span className="mt-5 flex items-center justify-between"><span className="text-lg font-black text-[var(--crm-ink)]">SMS cadence</span>{form.kind === 'sms' ? <Icon name="check_circle" className="text-xl text-[var(--crm-brand)]" /> : null}</span>
                <span className="mt-2 block text-sm leading-6 text-[var(--crm-text-muted)]">Create a paced sequence that stops when a seller replies or opts out.</span>
                <span className="mt-4 block text-[10px] font-black uppercase tracking-widest text-[var(--crm-brand)]">Launch Control-inspired · human owned</span>
              </button>
            </div>
          ) : null}

          {studioStep === 2 && form.kind === 'dialer' ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="crm-panel rounded-2xl p-5 sm:p-6">
                <p className="crm-eyebrow">Calling identity</p>
                <h2 className="mt-1 text-xl font-black text-[var(--crm-ink)]">Choose the line sellers will see</h2>
                <label className="mt-5 block"><span className="text-xs font-black text-[var(--crm-ink)]">Calling number</span><select value={form.callerId} onChange={(event) => onChange((current) => ({ ...current, callerId: event.target.value }))} className="crm-field mt-2 h-12 w-full rounded-xl px-4 text-sm font-bold">{DIALER_CALLER_ID_NUMBERS.map((number) => <option key={number.value} value={number.value}>{number.label}</option>)}</select></label>
                <div className="mt-6 space-y-2">
                  {[
                    ['shield', 'Eligibility check', 'DNC, dead, bad-number, and quiet-hours policy'],
                    ['auto_awesome', 'Seller brief', 'Property and conversation context before the call'],
                    ['phone_in_talk', 'One live call', 'One seller, one line, no fake predictive claims'],
                    ['fact_check', 'Required outcome', 'Disposition before the queue advances'],
                  ].map(([icon, title, detail], index) => <div key={title} className="flex gap-3 rounded-xl border border-[var(--crm-border)] p-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--crm-surface-subtle)] text-[var(--crm-brand)]"><Icon name={icon} /></span><div><p className="text-sm font-black text-[var(--crm-ink)]"><span className="mr-2 text-[10px] text-[var(--crm-text-dim)]">0{index + 1}</span>{title}</p><p className="mt-0.5 text-xs leading-5 text-[var(--crm-text-muted)]">{detail}</p></div></div>)}
                </div>
              </div>
              <aside className="rounded-2xl bg-[#17221a] p-5 text-white shadow-xl">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/50">Operator preview</p>
                <div className="mt-6 grid h-16 w-16 place-items-center rounded-full bg-white/10"><Icon name="person" className="text-3xl text-white/80" /></div>
                <h3 className="mt-4 text-xl font-black">Helen Seller</h3>
                <p className="mt-1 text-xs text-white/55">123 Main Street · Kansas City</p>
                <div className="mt-6 rounded-xl bg-white/8 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-white/50">Calling from</p><p className="mt-1 text-sm font-bold">{phoneLabel(form.callerId, DIALER_CALLER_ID_NUMBERS)}</p></div>
                <button type="button" disabled className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#9bc78e] text-sm font-black text-[#17221a]"><Icon name="phone" /> Ready after activation</button>
              </aside>
            </div>
          ) : null}

          {studioStep === 2 && form.kind === 'sms' ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
              <div className="space-y-4">
                <div className="crm-panel rounded-2xl p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="crm-eyebrow">Start from a proven shape</p><h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">Cadence starters</h2></div><p className="text-xs text-[var(--crm-text-muted)]">Editable before creation</p></div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">{SMS_STARTERS.map((starter) => <button key={starter.name} type="button" onClick={() => { onChange((current) => ({ ...current, steps: starter.steps.map((step) => ({ ...step })) })); setActiveMessage(0) }} className="rounded-xl border border-[var(--crm-border)] p-3 text-left hover:border-[var(--crm-brand)] hover:bg-[var(--crm-brand-soft)]"><span className="text-sm font-black text-[var(--crm-ink)]">{starter.name}</span><span className="mt-1 block text-xs leading-5 text-[var(--crm-text-muted)]">{starter.detail}</span></button>)}</div>
                </div>
                <div className="crm-panel rounded-2xl p-5 sm:p-6">
                  <div className="flex items-center justify-between"><div><p className="crm-eyebrow">Sequence builder</p><h2 className="mt-1 text-xl font-black text-[var(--crm-ink)]">{form.steps.length} message{form.steps.length === 1 ? '' : 's'}</h2></div><button type="button" disabled={form.steps.length >= 12} onClick={() => { onChange((current) => ({ ...current, steps: [...current.steps, { delayMinutes: 1440, bodyTemplate: '' }] })); setActiveMessage(form.steps.length) }} className="crm-secondary-button rounded-lg px-3 py-2 text-xs font-black disabled:opacity-40"><Icon name="add" className="mr-1 align-middle text-base" />Add message</button></div>
                  <div className="mt-5 space-y-4">{form.steps.map((step, index) => <article key={index} className={`rounded-2xl border p-4 transition ${activeMessage === index ? 'border-[var(--crm-brand)] shadow-[0_8px_24px_rgba(52,78,48,0.1)]' : 'border-[var(--crm-border)]'}`} onFocus={() => setActiveMessage(index)}><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--crm-brand)] text-xs font-black text-white">{index + 1}</span><div><p className="text-sm font-black text-[var(--crm-ink)]">Message {index + 1}</p><p className="text-[11px] text-[var(--crm-text-muted)]">{delayLabel(step.delayMinutes)}</p></div></div>{form.steps.length > 1 ? <button type="button" onClick={() => { onChange((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) })); setActiveMessage(0) }} aria-label={`Remove message ${index + 1}`} className="crm-icon-button grid h-8 w-8 place-items-center rounded-lg text-[var(--crm-danger)]"><Icon name="delete" className="text-lg" /></button> : null}</div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]"><label><span className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Wait after prior</span><select value={step.delayMinutes} onChange={(event) => updateStep(index, { delayMinutes: Number(event.target.value) })} className="crm-field mt-1.5 h-10 w-full rounded-lg px-2 text-xs"><option value={0}>Immediately</option><option value={60}>1 hour</option><option value={240}>4 hours</option><option value={1440}>1 day</option><option value={2880}>2 days</option><option value={4320}>3 days</option><option value={10080}>7 days</option></select></label><label><span className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">Message</span><textarea required maxLength={1400} value={step.bodyTemplate} onChange={(event) => updateStep(index, { bodyTemplate: event.target.value })} rows={4} className="crm-field mt-1.5 w-full rounded-lg px-3 py-2 text-sm leading-6" placeholder="Write a clear, human message…" /></label></div>
                    {activeMessage === index ? <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Message variables">{['{{first_name}}', '{{full_name}}', '{{property_address}}', '{{agent_name}}'].map((variable) => <button key={variable} type="button" onClick={() => insertVariable(variable)} className="rounded-full bg-[var(--crm-surface-subtle)] px-2.5 py-1 text-[10px] font-bold text-[var(--crm-text-muted)] hover:text-[var(--crm-brand)]">+ {variable.replaceAll(/[{}]/g, '')}</button>)}</div> : null}
                  </article>)}</div>
                </div>
              </div>
              <aside className="space-y-4 xl:sticky xl:top-0 xl:h-fit">
                <div className="rounded-[2rem] bg-[#17221a] p-3 shadow-xl"><div className="rounded-[1.45rem] border border-white/10 bg-[#f5f2e9] p-4 text-[#17221a]"><div className="flex items-center justify-between border-b border-black/8 pb-3"><div><p className="text-[10px] font-black uppercase tracking-wider text-black/45">Preview</p><p className="text-sm font-black">Helen Seller</p></div><span className="grid h-8 w-8 place-items-center rounded-full bg-[#dbe8d6]"><Icon name="sms" className="text-base text-[#344e30]" /></span></div><div className="mt-7 rounded-2xl rounded-bl-sm bg-white p-3 text-sm leading-5 shadow-sm">{sampleMessage(form.steps[activeMessage]?.bodyTemplate || 'Your message preview appears here.')}</div><p className="mt-2 text-right text-[9px] font-bold text-black/35">Draft preview · not sent</p><div className="mt-20 h-9 rounded-full border border-black/10 bg-white/70" /></div></div>
                <div className="crm-panel rounded-2xl p-4"><p className="text-xs font-black text-[var(--crm-ink)]">Sending identity</p><select value={form.fromPhone} onChange={(event) => onChange((current) => ({ ...current, fromPhone: event.target.value }))} className="crm-field mt-2 h-10 w-full rounded-lg px-2 text-xs">{BROADCAST_TWILIO_NUMBERS.map((number) => <option key={number.value} value={number.value}>{number.label}</option>)}</select><div className="mt-3 grid grid-cols-2 gap-2"><label><span className="text-[10px] font-bold text-[var(--crm-text-muted)]">Per hour</span><input type="number" min={1} max={5000} value={form.perHour} onChange={(event) => onChange((current) => ({ ...current, perHour: Number(event.target.value) }))} className="crm-field mt-1 h-9 w-full rounded-lg px-2 text-xs" /></label><label><span className="text-[10px] font-bold text-[var(--crm-text-muted)]">Per day</span><input type="number" min={1} max={50000} value={form.perDay} onChange={(event) => onChange((current) => ({ ...current, perDay: Number(event.target.value) }))} className="crm-field mt-1 h-9 w-full rounded-lg px-2 text-xs" /></label></div></div>
              </aside>
            </div>
          ) : null}

          {studioStep === 3 ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="space-y-4">
                <div className="crm-panel rounded-2xl p-5 sm:p-6"><div className="flex items-start gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]"><Icon name={form.kind === 'sms' ? 'sms' : 'phone_in_talk'} className="text-2xl" /></span><div><p className="text-[10px] font-black uppercase tracking-widest text-[var(--crm-text-muted)]">Draft campaign</p><h2 className="mt-1 text-2xl font-black text-[var(--crm-ink)]">{form.name || 'Untitled campaign'}</h2><p className="mt-1 text-sm text-[var(--crm-text-muted)]">{form.kind === 'sms' ? `${form.steps.length} message cadence · ${form.perHour}/hour · ${form.perDay}/day` : `Single-line calls · ${phoneLabel(form.callerId, DIALER_CALLER_ID_NUMBERS)}`}</p></div></div></div>
                <div className="crm-panel rounded-2xl p-5"><div className="flex items-center justify-between"><div><p className="crm-eyebrow">Audience</p><h3 className="mt-1 text-lg font-black text-[var(--crm-ink)]">{editingCampaignName ? `${editingAudienceCount} contact${editingAudienceCount === 1 ? '' : 's'} stay attached` : pendingLeadIds.length ? `${pendingLeadIds.length} selected contact${pendingLeadIds.length === 1 ? '' : 's'}` : 'Add contacts after creation'}</h3></div><span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--crm-info-soft)] text-[var(--crm-info)]"><Icon name="groups" className="text-2xl" /></span></div><p className="mt-3 text-sm leading-6 text-[var(--crm-text-muted)]">{editingCampaignName ? 'This setup edit does not add, remove, or restart contacts. Audience changes stay in the campaign workbench.' : 'Every selected contact is checked before enrollment. Suppressed or unusable numbers remain visible in campaign health but never enter execution.'}</p></div>
                {form.kind === 'sms' ? <div className="crm-panel rounded-2xl p-5"><p className="crm-eyebrow">Cadence summary</p><div className="mt-4 space-y-3">{form.steps.map((step, index) => <div key={index} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--crm-brand)] text-[10px] font-black text-white">{index + 1}</span><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">{delayLabel(step.delayMinutes)}</p><p className="mt-1 line-clamp-2 text-sm text-[var(--crm-ink)]">{step.bodyTemplate}</p></div></div>)}</div></div> : null}
              </div>
              <aside className="crm-panel h-fit rounded-2xl p-5"><p className="crm-eyebrow">Launch guardrails</p><h3 className="mt-1 text-lg font-black text-[var(--crm-ink)]">Ready for a safe draft</h3><div className="mt-5 space-y-3">{[
                ['verified_user', 'Suppression checked', 'DNC, STOP, dead, and bad numbers'],
                ['schedule', 'Local-time windows', 'Campaign timezone: America/Chicago'],
                ['reply', 'Replies stop automation', 'The seller returns to the Inbox'],
                ['lock', 'Human activation', 'Creation does not start sending or calling'],
              ].map(([icon, title, detail]) => <div key={title} className="flex gap-3"><Icon name={icon} className="mt-0.5 text-lg text-[var(--crm-success)]" /><div><p className="text-xs font-black text-[var(--crm-ink)]">{title}</p><p className="mt-0.5 text-[10px] leading-4 text-[var(--crm-text-muted)]">{detail}</p></div></div>)}</div></aside>
            </div>
          ) : null}

          <footer className="crm-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
            <div>{canAddToExisting && existingCampaignName && pendingLeadIds.length > 0 ? <button type="button" onClick={onAddToExisting} className="crm-secondary-button rounded-lg px-4 py-2 text-xs font-black">Add {pendingLeadIds.length} to {existingCampaignName}</button> : <p className="text-xs text-[var(--crm-text-muted)]">{editingCampaignName ? 'Saving keeps this campaign in draft.' : 'Nothing runs until you activate the finished draft.'}</p>}</div>
            <div className="flex gap-2">
              {studioStep > 1 ? <button type="button" onClick={() => setStudioStep((current) => current - 1)} className="crm-secondary-button rounded-lg px-4 py-2 text-sm font-black">Back</button> : <button type="button" onClick={onCancel} className="crm-secondary-button rounded-lg px-4 py-2 text-sm font-black">Cancel</button>}
              {studioStep < 3 ? <button type="button" disabled={!stepIsValid} onClick={() => setStudioStep((current) => current + 1)} className="crm-primary-button inline-flex items-center gap-1 rounded-lg px-5 py-2 text-sm font-black disabled:opacity-40">Continue <Icon name="arrow_forward" className="text-base" /></button> : <button type="submit" disabled={saving || !stepIsValid} className="crm-primary-button inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-sm font-black disabled:opacity-50">{saving ? (editingCampaignName ? 'Saving draft…' : 'Creating draft…') : (editingCampaignName ? 'Save draft setup' : 'Create safe draft')}<Icon name="check" className="text-base" /></button>}
            </div>
          </footer>
        </section>
      </form>
    </main>
  )
}
