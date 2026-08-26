'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import {
  PROSPECTING_DIALER_ATTEMPT_LIMITS,
  PROSPECTING_DIALER_RECENCY_HOURS,
  defaultProspectingDialerSessionSetup,
  type ProspectingDialerSessionSetup,
} from '@/lib/prospecting/campaign-contract'
import { formatPhone } from '@/lib/format'
import { COLD_CALL_DIALER_NUMBERS, isColdCallDialerNumber } from '@/lib/twilio-numbers'

type ProspectingSessionSetupProps = {
  actionPending: boolean
  activeCount: number
  campaignCallerId: string | null
  writesEnabled: boolean
  onLaunch: (setup: ProspectingDialerSessionSetup) => void
}

function initialSetup(campaignCallerId: string | null): ProspectingDialerSessionSetup {
  const setup = defaultProspectingDialerSessionSetup()
  if (!campaignCallerId || !isColdCallDialerNumber(campaignCallerId)) return setup
  return { ...setup, callerIds: [campaignCallerId] }
}

function recencyLabel(hours: number | null) {
  if (hours === null) return 'Any time'
  if (hours === 24) return 'Last 24 hours'
  if (hours < 168) return `Last ${hours / 24} days`
  if (hours === 168) return 'Last 7 days'
  if (hours === 336) return 'Last 14 days'
  return 'Last 30 days'
}

function summary(setup: ProspectingDialerSessionSetup) {
  const identity = setup.callerMode === 'rotation'
    ? `Rotate ${setup.callerIds.length} lines`
    : formatPhone(setup.callerIds[0] || '')
  return `${identity} · stop after ${setup.maxAttemptsPerNumber}`
}

export function ProspectingSessionSetup({
  actionPending,
  activeCount,
  campaignCallerId,
  writesEnabled,
  onLaunch,
}: ProspectingSessionSetupProps) {
  const [applied, setApplied] = useState(() => initialSetup(campaignCallerId))
  const [draft, setDraft] = useState(applied)
  const [open, setOpen] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)

  function openSetup() {
    setDraft(applied)
    setSelectionError(null)
    setOpen(true)
  }

  function chooseCallerMode(callerMode: ProspectingDialerSessionSetup['callerMode']) {
    setSelectionError(null)
    setDraft((current) => ({
      ...current,
      callerMode,
      callerIds: current.callerIds.length > 0 ? current.callerIds : initialSetup(campaignCallerId).callerIds,
    }))
  }

  function chooseCallerId(callerId: string) {
    setSelectionError(null)
    if (draft.callerMode === 'static') {
      setDraft({ ...draft, callerIds: [callerId] })
      return
    }
    if (draft.callerIds.includes(callerId)) {
      if (draft.callerIds.length === 1) {
        setSelectionError('Rotation requires at least one cold-call number.')
        return
      }
      setDraft({ ...draft, callerIds: draft.callerIds.filter((value) => value !== callerId) })
      return
    }
    if (draft.callerIds.length >= 5) {
      setSelectionError('Choose no more than five rotation numbers.')
      return
    }
    setDraft({ ...draft, callerIds: [...draft.callerIds, callerId] })
  }

  function applySetup() {
    if (draft.callerIds.length < 1) {
      setSelectionError('Choose at least one cold-call number.')
      return
    }
    setApplied(draft)
    setOpen(false)
    setSelectionError(null)
  }

  return (
    <div className="min-w-0 space-y-3 text-left lg:w-[38rem]">
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" aria-expanded={open} onClick={open ? () => setOpen(false) : openSetup} className="inline-flex min-h-12 flex-1 items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/15 px-4 text-left text-xs font-black text-white hover:bg-white/10">
          <span className="min-w-0"><span className="block text-[9px] uppercase tracking-[0.15em] text-white/45">Session setup</span><span className="mt-1 block truncate">{summary(applied)}</span></span>
          <Icon name={open ? 'expand_less' : 'tune'} className="shrink-0 text-xl text-white/65" />
        </button>
        <button type="button" onClick={() => onLaunch(applied)} disabled={actionPending || activeCount === 0} className="crm-primary-button inline-flex min-h-12 min-w-48 items-center justify-center gap-2 rounded-xl px-6 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50"><Icon name={writesEnabled ? applied.startBehavior === 'resume' ? 'resume' : 'first_page' : 'preview'} className="text-xl" />{writesEnabled ? applied.startBehavior === 'resume' ? 'Resume calling' : 'Start calling' : 'Preview call session'}</button>
      </div>

      {!writesEnabled ? <p className="text-xs font-bold leading-5 text-white/60">Preview mode: setup changes stay in this browser. The calling floor and 15-second start sequence are interactive, but no call or CRM write can occur.</p> : null}

      {open ? <section aria-label="Calling session setup" className="rounded-2xl border border-white/15 bg-[#f8fafc] p-4 text-[#121a26] shadow-2xl sm:p-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <fieldset>
              <legend className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Start position</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {([
                  ['resume', 'Resume', 'Exact saved seller and number'],
                  ['first_unworked', 'First unworked', 'Rebuild remaining queue'],
                ] as const).map(([value, label, hint]) => <label key={value} className={`cursor-pointer rounded-xl border p-3 ${draft.startBehavior === value ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-white'}`}><span className="flex items-center gap-2"><input type="radio" name="dialer-start-behavior" checked={draft.startBehavior === value} onChange={() => setDraft((current) => ({ ...current, startBehavior: value }))} className="accent-[#E32E2E]" /><strong className="text-xs">{label}</strong></span><span className="mt-1 block pl-5 text-[10px] text-slate-500">{hint}</span></label>)}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Caller ID policy</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {([['static', 'Static number'], ['rotation', 'Rotate numbers']] as const).map(([value, label]) => <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-xs font-black ${draft.callerMode === value ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-white'}`}><input type="radio" name="dialer-caller-mode" checked={draft.callerMode === value} onChange={() => chooseCallerMode(value)} className="accent-[#E32E2E]" />{label}</label>)}
              </div>
            </fieldset>

            <fieldset>
              <legend className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><span>Cold-call numbers</span><span>{draft.callerIds.length}/{draft.callerMode === 'rotation' ? 5 : 1}</span></legend>
              <div className="mt-2 grid max-h-52 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {COLD_CALL_DIALER_NUMBERS.map((number) => <label key={number.value} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${draft.callerIds.includes(number.value) ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-white'}`}><input type={draft.callerMode === 'static' ? 'radio' : 'checkbox'} name={draft.callerMode === 'static' ? 'dialer-static-caller-id' : undefined} checked={draft.callerIds.includes(number.value)} onChange={() => chooseCallerId(number.value)} className="accent-[#E32E2E]" /><span>{formatPhone(number.value)}</span></label>)}
              </div>
              {selectionError ? <p role="alert" className="mt-2 text-xs font-bold text-red-600">{selectionError}</p> : null}
            </fieldset>
          </div>

          <div className="rounded-2xl bg-slate-100 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Calling eligibility</p>
            <label className="mt-4 block text-xs font-black">Maximum attempts per number<select aria-label="Maximum attempts per number" value={draft.maxAttemptsPerNumber} onChange={(event) => setDraft((current) => ({ ...current, maxAttemptsPerNumber: Number(event.target.value) as ProspectingDialerSessionSetup['maxAttemptsPerNumber'] }))} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold">{PROSPECTING_DIALER_ATTEMPT_LIMITS.map((limit) => <option key={limit} value={limit}>{limit} attempts</option>)}</select></label>
            <label className="mt-4 block text-xs font-black">Do not redial within<select aria-label="Not dialed time frame" value={draft.notDialedHours ?? ''} onChange={(event) => setDraft((current) => ({ ...current, notDialedHours: event.target.value ? Number(event.target.value) as ProspectingDialerSessionSetup['notDialedHours'] : null }))} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"><option value="">Any time</option>{PROSPECTING_DIALER_RECENCY_HOURS.map((hours) => <option key={hours} value={hours}>{recencyLabel(hours)}</option>)}</select><span className="mt-1 block text-[10px] font-normal leading-4 text-slate-500">Holds numbers dialed in the selected period.</span></label>
            <label className="mt-4 block text-xs font-black">Do not contact again within<select aria-label="Not contacted time frame" value={draft.notContactedHours ?? ''} onChange={(event) => setDraft((current) => ({ ...current, notContactedHours: event.target.value ? Number(event.target.value) as ProspectingDialerSessionSetup['notContactedHours'] : null }))} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold"><option value="">Any time</option>{PROSPECTING_DIALER_RECENCY_HOURS.map((hours) => <option key={hours} value={hours}>{recencyLabel(hours)}</option>)}</select><span className="mt-1 block text-[10px] font-normal leading-4 text-slate-500">Holds numbers with a recorded conversation.</span></label>
            <button type="button" onClick={applySetup} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#D9242E] px-4 text-sm font-black text-white hover:bg-[#bd1d27]"><Icon name="check" className="text-lg" />Apply setup</button>
          </div>
        </div>
      </section> : null}
    </div>
  )
}
