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
  durableSessionId: string
  durableStatus?: SessionStatus
  dials: number
  contacts: number
  queueState: SessionQueueState | null
  actionPending: boolean
  currentLeadId: string | null
  error: string | null
  onClose: () => void
  onResume: () => void
  onStop: () => void
  onMarkDead: () => void
  onPrevious: () => void
  onSkip: () => void
}

function HudStat({ icon, label, value, tone = 'neutral' }: { icon: string; label: string; value: number | string; tone?: 'neutral' | 'emerald' }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-black/15 px-3 py-3 backdrop-blur-sm">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone === 'emerald' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/10 text-white/70'}`}>
        <Icon name={icon} size="text-base" />
      </span>
      <div className="min-w-0 leading-none">
        <p className={`truncate text-lg font-black tabular-nums ${tone === 'emerald' ? 'text-emerald-300' : 'text-white'}`}>{value}</p>
        <p className="mt-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/45">{label}</p>
      </div>
    </div>
  )
}

export function DialerSessionCommand(props: DialerSessionCommandProps) {
  const isCalling = Boolean(props.queueState?.queueItem && ['calling', 'on_call'].includes(props.queueState.status))
  const dialTime = props.queueState?.status === 'on_call'
    ? props.queueState.callDuration || '00:00'
    : props.queueState?.status === 'calling'
      ? 'Dialing'
      : 'Idle'
  const isDurable = Boolean(props.durableSessionId)
  const isPaused = props.durableStatus === 'paused'
  const progress = Math.round(((props.currentIndex + 1) / Math.max(props.queueSize, 1)) * 100)
  const currentPerson = props.queueState?.queueItem
  const statusLabel = props.queueState?.status === 'on_call'
    ? 'Connected now'
    : props.queueState?.status === 'calling'
      ? 'Dialing now'
      : isPaused
        ? 'Session paused'
        : 'Ready for next call'

  return (
    <>
      <section aria-label="Calling floor command center" className="relative mb-6 overflow-hidden rounded-[28px] border border-slate-700/70 bg-[#101827] text-white shadow-[0_24px_70px_rgba(2,8,23,0.25)]">
        <div aria-hidden="true" className="pointer-events-none absolute -right-28 -top-36 h-80 w-80 rounded-full bg-[#E32E2E]/20 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 left-1/3 h-72 w-72 rounded-full bg-blue-500/10 blur-3xl" />

        <div className="relative border-b border-white/10 px-5 py-4 sm:px-7">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">
              <span className={`h-2 w-2 rounded-full ${isCalling ? 'animate-pulse bg-emerald-300' : 'bg-emerald-400/60'}`} /> Live calling floor
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
              <Icon name="shield" size="text-sm" /> Verified single-line session
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={props.onClose}
              disabled={props.actionPending}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
              title={props.durableStatus === 'active' ? 'Pause and exit session' : 'Exit session'}
              aria-label={props.durableStatus === 'active' ? 'Pause and exit session' : 'Exit session'}
            >
              <Icon name="close" size="text-base" /> Exit floor
            </button>
          </div>
        </div>

        <div className="relative grid gap-6 px-5 py-6 sm:px-7 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-stretch">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#ff8d8d]">{props.queueLabel}</p>
            <h1 className="mt-2 max-w-2xl text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">Stay in rhythm. One seller at a time.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">Review the context, call one eligible number, save the outcome, then advance. The system will not launch parallel calls.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {props.callerId ? <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold text-white/60">Calling from {formatPhone(props.callerId)}</span> : null}
              {props.durableStatus ? <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/50">{props.durableStatus} session</span> : null}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <HudStat icon="format_list_numbered" label="Queue position" value={`${props.currentIndex + 1}/${props.queueSize}`} />
              <HudStat icon="call" label="Dials" value={props.dials} />
              <HudStat icon="phone_in_talk" label="Contacts" value={props.contacts} tone="emerald" />
              <HudStat icon="schedule" label="Talk time" value={dialTime} tone={props.queueState?.status === 'on_call' ? 'emerald' : 'neutral'} />
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.14em] text-white/45">
                <span>Session progress</span><span>{progress}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-[#E32E2E] to-[#ff8a76] transition-all" style={{ width: `${progress}%` }} /></div>
            </div>
          </div>

          <div className={`flex min-h-[220px] flex-col rounded-3xl border p-5 ${isCalling ? 'border-emerald-400/30 bg-emerald-400/10' : 'border-white/10 bg-white/[0.06]'}`}>
            <div className="flex items-center justify-between gap-3">
              <span className={`inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] ${isCalling ? 'text-emerald-300' : 'text-white/50'}`}>
                <span className={`h-2 w-2 rounded-full ${isCalling ? 'animate-pulse bg-emerald-300' : isPaused ? 'bg-amber-300' : 'bg-white/35'}`} /> {statusLabel}
              </span>
              {props.queueState?.queueLength ? <span className="text-[10px] font-bold text-white/40">Number {props.queueState.queueIndex + 1} of {props.queueState.queueLength}</span> : null}
            </div>

            <div className="my-auto py-5">
              <p className="truncate text-2xl font-black tracking-[-0.03em] text-white">{currentPerson?.heirName || 'Choose a callable heir'}</p>
              <p className="mt-1 text-sm font-semibold capitalize text-white/50">{currentPerson?.relation || 'The verified phone queue is below'}</p>
              <p className={`mt-4 font-mono text-xl font-black tabular-nums ${isCalling ? 'text-emerald-300' : 'text-white/80'}`}>{currentPerson ? formatPhone(currentPerson.phone) : '—'}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
              {isPaused ? (
                <button type="button" onClick={props.onResume} disabled={props.actionPending} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2.5 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-emerald-600 disabled:opacity-50">
                  <Icon name="play_arrow" size="text-sm" /> Resume
                </button>
              ) : null}
              {isDurable && props.durableStatus && ['active', 'paused'].includes(props.durableStatus) ? (
                <button type="button" onClick={props.onStop} disabled={props.actionPending || isCalling} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-xs font-black uppercase tracking-wider text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40">
                  <Icon name="stop_circle" size="text-sm" /> Stop
                </button>
              ) : null}
              <button type="button" onClick={props.onMarkDead} disabled={!props.currentLeadId} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-300/20 bg-red-400/10 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-red-200 transition-colors hover:bg-red-400/15 disabled:opacity-30" title="Mark this lead dead (records why)">
                <Icon name="cancel" size="text-sm" /> Dead
              </button>
              <button type="button" onClick={props.onPrevious} disabled={isDurable || props.currentIndex === 0} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30" title="Previous lead (K / ←)" aria-label="Previous lead">
                <Icon name="chevron_left" size="text-base" />
              </button>
              <button type="button" onClick={props.onSkip} disabled={props.actionPending || isCalling || isPaused || (!isDurable && props.currentIndex >= props.queueSize - 1)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#E32E2E] px-3 py-2.5 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-[#C42626] disabled:cursor-not-allowed disabled:opacity-30" title={isDurable ? 'Skip this contact with an audited outcome (J / →)' : 'Next lead (J / →)'}>
                {isDurable ? 'Skip contact' : 'Next'} <Icon name="chevron_right" size="text-sm" />
              </button>
            </div>
          </div>
        </div>

        <div className="relative grid border-t border-white/10 bg-black/10 sm:grid-cols-3">
          {[
            ['1', 'Review', 'AI brief and seller context'],
            ['2', 'Call', 'One eligible number at a time'],
            ['3', 'Save outcome', 'Required before advancing'],
          ].map(([step, label, detail], index) => (
            <div key={step} className={`flex items-center gap-3 px-5 py-3.5 sm:px-7 ${index ? 'border-t border-white/10 sm:border-l sm:border-t-0' : ''}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-black text-white">{step}</span>
              <div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/80">{label}</p><p className="mt-0.5 text-[10px] text-white/40">{detail}</p></div>
            </div>
          ))}
        </div>
      </section>

      {props.error ? <div role="alert" className="mb-4 rounded-xl border border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--crm-danger)]">{props.error}</div> : null}
    </>
  )
}
