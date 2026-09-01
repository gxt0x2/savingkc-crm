'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Icon } from '@/components/ui/icon'
import { stalePausedHardStopMessage, type StalePausedDialerHardStop } from '@/lib/dialer-stale-paused-session'

const FeedbackForm = dynamic(
  () => import('@/components/feedback/feedback-form').then((module) => module.FeedbackForm),
  { ssr: false },
)

export function StalePausedDialerHardStopBanner({
  hardStop,
  canClear,
  clearing = false,
  onClear,
}: {
  hardStop: StalePausedDialerHardStop
  canClear: boolean
  clearing?: boolean
  onClear?: () => void
}) {
  const [andonOpen, setAndonOpen] = useState(false)
  const [andonSubmitted, setAndonSubmitted] = useState(false)
  const reasons = hardStop.reasons.includes('zero_attempts_today')
    ? '0 attempts this calling day'
    : 'paused longer than the 15-minute SLA'

  return (
    <section role="alert" className="rounded-2xl border border-[var(--crm-danger)]/40 bg-[var(--crm-danger-soft)] p-4 text-[var(--crm-danger)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.16em]">Calling hard stop</p>
          <h2 className="mt-1 text-lg font-black text-[var(--crm-ink)]">Cannot start a new session until this pause is cleared</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-[var(--crm-text)]">{stalePausedHardStopMessage(hardStop)}</p>
          <p className="mt-1 text-xs font-semibold text-[var(--crm-text-muted)]">
            {hardStop.actorName} · {reasons} · Andon-capable. Clearing ends the paused row only and does not drain Mojo.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAndonOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--crm-danger)] bg-[var(--crm-surface)] px-4 text-xs font-black text-[var(--crm-danger)]"
          >
            <Icon name="warning_amber" />Raise Andon
          </button>
          {canClear && onClear ? (
            <button
              type="button"
              onClick={onClear}
              disabled={clearing}
              className="crm-primary-button inline-flex h-11 items-center gap-2 rounded-xl px-4 text-xs font-black disabled:opacity-50"
            >
              <Icon name={clearing ? 'progress_activity' : 'stop'} className={clearing ? 'animate-spin' : ''} />
              {clearing ? 'Clearing…' : 'Clear stuck session'}
            </button>
          ) : null}
        </div>
      </div>
      {andonOpen ? <FeedbackForm defaultSection="Prospecting" onClose={() => setAndonOpen(false)} onSubmit={() => { setAndonSubmitted(true); setAndonOpen(false) }} /> : null}
      {andonSubmitted ? <p role="status" className="mt-3 text-xs font-black text-[var(--crm-success)]">Andon received</p> : null}
    </section>
  )
}
