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
    <div className="flex items-center gap-2 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2.5 py-1.5">
      <Icon name={icon} size="text-sm" className={tone === 'emerald' ? 'text-emerald-400' : 'text-[var(--ck-text-dim)]'} />
      <div className="leading-none">
        <p className={`text-sm font-black tabular-nums ${tone === 'emerald' ? 'text-emerald-400' : 'text-[var(--ck-text)]'}`}>{value}</p>
        <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--ck-text-dim)]">{label}</p>
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

  return (
    <>
      <div className="sticky top-0 z-30 -mx-4 mb-4 border-b border-[var(--ck-border)] bg-[var(--ck-surface)]/90 backdrop-blur supports-[backdrop-filter]:bg-[var(--ck-surface)]/75 sm:-mx-6 lg:-mx-8">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={props.onClose}
            disabled={props.actionPending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] disabled:opacity-40"
            title={props.durableStatus === 'active' ? 'Pause and exit session' : 'Exit session'}
            aria-label={props.durableStatus === 'active' ? 'Pause and exit session' : 'Exit session'}
          >
            <Icon name="close" size="text-xl" />
          </button>

          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase leading-none tracking-widest text-[#E32E2E]">{props.queueLabel}</p>
            <p className="mt-1 text-sm font-black leading-none text-[var(--ck-text)]">
              Lead {props.currentIndex + 1}<span className="font-bold text-[var(--ck-text-dim)]"> / {props.queueSize}</span>
              {props.callerId ? <span className="ml-2 text-[11px] font-semibold text-[var(--ck-text-muted)]">from {formatPhone(props.callerId)}</span> : null}
              {props.durableStatus ? <span className="ml-2 text-[11px] font-semibold capitalize text-[var(--ck-text-muted)]">{props.durableStatus}</span> : null}
            </p>
          </div>

          <div className="ml-1 hidden items-center gap-2 md:flex">
            <HudStat icon="call" label="Dials" value={props.dials} />
            <HudStat icon="phone_in_talk" label="Contacts" value={props.contacts} tone="emerald" />
            {props.queueState?.queueLength ? <HudStat icon="diversity_3" label="Heir" value={`${props.queueState.queueIndex + 1}/${props.queueState.queueLength}`} /> : null}
          </div>

          <div className="flex-1" />
          <div className={`hidden items-center gap-2 rounded-lg border px-3 py-1.5 sm:flex ${isCalling ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)]'}`}>
            <span className={`h-2 w-2 rounded-full ${isCalling ? 'animate-pulse bg-emerald-400' : 'bg-[var(--ck-text-dim)]'}`} />
            <span className={`text-[10px] font-black uppercase tracking-wider ${isCalling ? 'text-emerald-400' : 'text-[var(--ck-text-dim)]'}`}>
              {props.queueState?.status === 'on_call' ? 'On call' : props.queueState?.status === 'calling' ? 'Dialing' : 'Idle'}
            </span>
            <span className="font-mono text-xs tabular-nums text-[var(--ck-text)]">{dialTime}</span>
          </div>

          {isPaused ? (
            <button type="button" onClick={props.onResume} disabled={props.actionPending} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
              <Icon name="play_arrow" size="text-sm" /> Resume
            </button>
          ) : null}
          {isDurable && props.durableStatus && ['active', 'paused'].includes(props.durableStatus) ? (
            <button type="button" onClick={props.onStop} disabled={props.actionPending || isCalling} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-black uppercase tracking-wider text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)] disabled:opacity-40">
              <Icon name="stop_circle" size="text-sm" /> Stop
            </button>
          ) : null}
          <button type="button" onClick={props.onMarkDead} disabled={!props.currentLeadId} className="inline-flex items-center gap-1.5 rounded-lg border border-[#E32E2E]/40 px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#ff7777] transition-colors hover:bg-[#E32E2E]/10 disabled:opacity-30" title="Mark this lead dead (records why)">
            <Icon name="cancel" size="text-sm" /> <span className="hidden lg:inline">Mark dead</span>
          </button>

          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={props.onPrevious} disabled={isDurable || props.currentIndex === 0} className="inline-flex h-9 w-10 items-center justify-center rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text)] transition-colors hover:border-[var(--ck-border-strong)] disabled:cursor-not-allowed disabled:opacity-30" title="Previous lead (K / ←)" aria-label="Previous lead">
              <Icon name="chevron_left" size="text-base" />
            </button>
            <button type="button" onClick={props.onSkip} disabled={props.actionPending || isCalling || isPaused || (!isDurable && props.currentIndex >= props.queueSize - 1)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#E32E2E] px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-[#C42626] disabled:cursor-not-allowed disabled:opacity-30" title={isDurable ? 'Skip this contact with an audited outcome (J / →)' : 'Next lead (J / →)'}>
              {isDurable ? 'Skip' : 'Next'} <Icon name="chevron_right" size="text-sm" />
            </button>
          </div>
        </div>
        <div className="h-1 bg-[var(--ck-surface-hi)]"><div className="h-full bg-[#E32E2E] transition-all" style={{ width: `${Math.round(((props.currentIndex + 1) / Math.max(props.queueSize, 1)) * 100)}%` }} /></div>
      </div>

      {props.error ? <div role="alert" className="mb-4 rounded-xl border border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--crm-danger)]">{props.error}</div> : null}

      {props.queueState?.queueItem ? (
        <div className={`mb-5 flex items-center justify-between gap-4 rounded-2xl border p-5 sm:p-6 ${isCalling ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-[#E32E2E]/30 bg-[#E32E2E]/10'}`}>
          <div className="flex min-w-0 items-center gap-4">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${isCalling ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[#E32E2E]/20 text-[#ff7777]'}`}>
              <Icon name={props.queueState.status === 'on_call' ? 'phone_in_talk' : 'call'} size="text-2xl" className={isCalling ? 'animate-pulse' : ''} filled />
            </span>
            <div className="min-w-0">
              <p className={`text-[10px] font-black uppercase tracking-widest ${isCalling ? 'text-emerald-400' : 'text-[#ff7777]'}`}>{isCalling ? (props.queueState.status === 'on_call' ? 'On call now' : 'Dialing now') : 'Up next'}</p>
              <p className="truncate text-xl font-black leading-tight text-[var(--ck-text)]">{props.queueState.queueItem.heirName}<span className="text-base font-semibold capitalize text-[var(--ck-text-muted)]"> · {props.queueState.queueItem.relation}</span></p>
              <p className="font-mono text-sm text-[var(--ck-text-muted)]">{formatPhone(props.queueState.queueItem.phone)}</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Talk time</p>
            <p className="font-mono text-2xl font-black leading-tight tabular-nums text-[var(--ck-text)]">{dialTime}</p>
            <p className="mt-0.5 text-[11px] font-bold text-[var(--ck-text-muted)]">Heir {props.queueState.queueIndex + 1} of {props.queueState.queueLength}</p>
          </div>
        </div>
      ) : null}
    </>
  )
}
