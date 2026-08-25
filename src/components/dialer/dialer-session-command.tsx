'use client'

import { Icon } from '@/components/ui/icon'
import { formatPhone } from '@/lib/format'

type SessionStatus = 'active' | 'paused' | 'completed' | 'stopped'
type CallStatus = 'offline' | 'connecting' | 'ready' | 'calling' | 'on_call' | 'incoming'

interface SessionQueueState {
  queueItem: { phone: string; heirName: string; relation: string } | null
  queueIndex: number
  queueLength: number
  callDuration?: string | null
  status: CallStatus
}

interface DialerSessionCommandProps {
  queueLabel: string
  currentIndex: number
  queueSize: number
  callerId: string
  callerPolicyLabel?: string
  durableSessionId: string
  durableStatus?: SessionStatus
  dials: number
  contacts: number
  queueState: SessionQueueState | null
  actionPending: boolean
  currentLeadId: string | null
  error: string | null
  readOnlyPreview?: boolean
  onClose: () => void
  onResume: () => void
  onStop: () => void
  onMarkDead: () => void
  onPrevious: () => void
  onSkip: () => void
}

function HudStat({ icon, label, value, tone = 'neutral' }: { icon: string; label: string; value: number | string; tone?: 'neutral' | 'emerald' }) {
  return <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-2.5">
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone === 'emerald' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/10 text-white/70'}`}><Icon name={icon} size="text-sm" /></span>
    <div className="min-w-0 leading-none"><p className={`truncate text-base font-black tabular-nums ${tone === 'emerald' ? 'text-emerald-300' : 'text-white'}`}>{value}</p><p className="mt-1 text-[8px] font-black uppercase tracking-[0.14em] text-white/45">{label}</p></div>
  </div>
}

export function DialerSessionCommand(props: DialerSessionCommandProps) {
  const isCalling = Boolean(props.queueState?.queueItem && ['calling', 'on_call'].includes(props.queueState.status))
  const dialTime = props.queueState?.status === 'on_call'
    ? props.queueState.callDuration || '00:00'
    : props.queueState?.status === 'calling' ? 'Dialing' : 'Idle'
  const isDurable = Boolean(props.durableSessionId)
  const isPaused = props.durableStatus === 'paused'
  const progress = Math.round(((props.currentIndex + 1) / Math.max(props.queueSize, 1)) * 100)
  const statusLabel = props.readOnlyPreview
    ? 'Read-only'
    : props.queueState?.status === 'on_call'
    ? 'Connected now'
    : props.queueState?.status === 'calling'
      ? 'Dialing now'
      : isPaused ? 'Session paused' : 'Ready'

  return <>
    <section aria-label="Calling floor command center" className="relative mb-4 overflow-hidden rounded-2xl border border-slate-700/70 bg-[#101827] text-white shadow-[0_14px_40px_rgba(2,8,23,0.18)]">
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 h-56 w-56 rounded-full bg-[#E32E2E]/20 blur-3xl" />
      <div className="relative px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 lg:max-w-[360px]">
          <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${isCalling ? 'animate-pulse bg-emerald-300' : isPaused ? 'bg-amber-300' : 'bg-emerald-400/70'}`} /><p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-[#ff8d8d]">{props.queueLabel}</p></div>
          <div className="mt-1 flex items-baseline gap-2"><h1 className="truncate text-xl font-black tracking-[-0.03em]">{props.readOnlyPreview ? 'Calling workflow preview' : 'Calling session'}</h1><span className="text-[10px] font-black uppercase tracking-wider text-white/45">{statusLabel}</span></div>
          <p className="mt-1 truncate text-xs text-white/50">{props.callerPolicyLabel || (props.callerId ? `Assigned line ${formatPhone(props.callerId)}` : 'Caller ID unavailable')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:max-w-[560px] lg:justify-end">
          {!props.readOnlyPreview ? <button
            type="button"
            onClick={() => window.dispatchEvent(new Event('show-dialer-controls'))}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-xs font-black uppercase tracking-wider text-white/70 hover:bg-white/10 hover:text-white"
          >
            <Icon name="phone_in_talk" size="text-sm" /> Call controls
          </button> : null}
          {isPaused ? <button type="button" onClick={props.onResume} disabled={props.actionPending} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:bg-emerald-600 disabled:opacity-50"><Icon name="play_arrow" size="text-sm" />Resume</button> : null}
          {isDurable && props.durableStatus && ['active', 'paused'].includes(props.durableStatus) ? <button type="button" onClick={props.onStop} disabled={props.actionPending || isCalling} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-xs font-black uppercase tracking-wider text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40"><Icon name="stop_circle" size="text-sm" />Stop</button> : null}
          {!props.readOnlyPreview ? <button type="button" onClick={props.onMarkDead} disabled={!props.currentLeadId} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-300/20 bg-red-400/10 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-red-200 hover:bg-red-400/15 disabled:opacity-30" title="Mark this lead dead (records why)"><Icon name="cancel" size="text-sm" />Dead</button> : null}
          <button type="button" onClick={props.onPrevious} disabled={isDurable || props.currentIndex === 0} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30" title="Previous lead" aria-label="Previous lead"><Icon name="chevron_left" size="text-base" /></button>
          <button type="button" onClick={props.onSkip} disabled={props.actionPending || isCalling || isPaused || (!isDurable && props.currentIndex >= props.queueSize - 1)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#E32E2E] px-3 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:bg-[#C42626] disabled:cursor-not-allowed disabled:opacity-30" title={isDurable ? 'Skip this contact with an audited outcome' : 'Next seller'}>{isDurable ? 'Skip contact' : 'Next'}<Icon name="chevron_right" size="text-sm" /></button>
          <button type="button" onClick={props.onClose} disabled={props.actionPending} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40" title={props.durableStatus === 'active' ? 'Pause and exit session' : 'Exit session'} aria-label={props.durableStatus === 'active' ? 'Pause and exit session' : 'Exit session'}><Icon name="close" size="text-base" /></button>
        </div>
        </div>

        {props.readOnlyPreview ? <div role="status" className="mt-3 rounded-xl border border-amber-200/20 bg-amber-200/10 px-3 py-2 text-xs font-bold text-amber-100">Review sellers and every associated number. Calls, messages, verification changes, outcomes, and lifecycle changes are disabled.</div> : null}

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <HudStat icon="format_list_numbered" label="Position" value={`${props.currentIndex + 1}/${props.queueSize}`} />
          <HudStat icon="call" label="Dials" value={props.dials} />
          <HudStat icon="phone_in_talk" label="Contacts" value={props.contacts} tone="emerald" />
          <HudStat icon="schedule" label="Talk time" value={dialTime} tone={props.queueState?.status === 'on_call' ? 'emerald' : 'neutral'} />
        </div>
      </div>
      <div className="relative h-1.5 bg-white/10"><div className="h-full bg-gradient-to-r from-[#E32E2E] to-[#ff8a76] transition-all" style={{ width: `${progress}%` }} /><span className="sr-only">Session progress {progress}%</span></div>
    </section>
    {props.error ? <div role="alert" className="mb-4 rounded-xl border border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--crm-danger)]">{props.error}</div> : null}
  </>
}
