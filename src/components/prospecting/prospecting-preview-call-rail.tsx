'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { WorkspaceCallController } from '@/components/telephony/workspace-call-controller'
import { WorkspaceDispositionControls } from '@/components/telephony/workspace-disposition-controls'
import { FIRST_DIAL_COUNTDOWN_SECONDS } from '@/components/telephony/use-dialer-start-countdown'
import { normalizeDialerCallerPlan, parseCallerIdsCsv } from '@/lib/dialer-caller-plan'
import type { HeirDialerQueueItem } from '@/lib/heir-dialer-queue'

type ProspectingPreviewCallRailProps = {
  campaignId: string
  queueLabel: string
  callerId: string
  callerMode: string
  rotationNumbers: string
  startBehavior: string
  ringCount: string
  notDialedHours: string | null
  notContactedHours: string | null
}

function recencySummary(value: string | null) {
  if (!value) return 'No filter'
  const hours = Number(value)
  if (hours === 24) return '24 hours'
  if (hours % 24 === 0) return `${hours / 24} days`
  return `${hours} hours`
}

export function ProspectingPreviewCallRail({
  campaignId,
  queueLabel,
  callerId,
  callerMode,
  rotationNumbers,
  startBehavior,
  ringCount,
  notDialedHours,
  notContactedHours,
}: ProspectingPreviewCallRailProps) {
  const router = useRouter()
  const [queue, setQueue] = useState<HeirDialerQueueItem[]>([])
  const [remainingSeconds, setRemainingSeconds] = useState(FIRST_DIAL_COUNTDOWN_SECONDS)
  const [paused, setPaused] = useState(false)
  const queueItem = queue[0] ?? null
  const callerPlan = useMemo(() => normalizeDialerCallerPlan({
    mode: callerMode === 'rotation' ? 'rotation' : 'static',
    staticCallerId: callerId,
    rotationCallerIds: parseCallerIdsCsv(rotationNumbers),
    rotateEveryCalls: 1,
    redialCallerId: null,
  }, callerId), [callerId, callerMode, rotationNumbers])

  useEffect(() => {
    function onQueueReady(event: Event) {
      const nextQueue = ((event as CustomEvent).detail as { queue?: HeirDialerQueueItem[] } | null)?.queue
      if (!Array.isArray(nextQueue) || nextQueue.length === 0) return
      setQueue(nextQueue)
    }
    window.addEventListener('prospecting-preview-queue-ready', onQueueReady)
    return () => window.removeEventListener('prospecting-preview-queue-ready', onQueueReady)
  }, [])

  useEffect(() => {
    if (paused || remainingSeconds <= 0) return
    const timeout = window.setTimeout(() => setRemainingSeconds((current) => Math.max(0, current - 1)), 1_000)
    return () => window.clearTimeout(timeout)
  }, [paused, remainingSeconds])

  function pauseOrResume() {
    if (remainingSeconds === 0) {
      setRemainingSeconds(FIRST_DIAL_COUNTDOWN_SECONDS)
      setPaused(false)
      return
    }
    setPaused((current) => !current)
  }

  function endPreview() {
    router.push(`/prospecting?campaign=${encodeURIComponent(campaignId)}`)
  }

  const completed = remainingSeconds === 0
  const previewStatus = paused ? 'Paused' : completed ? 'Preview complete' : 'Ready'

  return (
    <section aria-label="Preview prospecting call controls" className="flex h-full min-h-0 flex-col bg-[var(--skc-surface-1)] text-[var(--skc-text-primary)]">
      <header className="border-b border-[var(--skc-separator)] px-5 py-4 text-center">
        <h2 className="text-lg font-black tracking-[-0.03em]">Call controls</h2>
        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-amber-300"><span className="h-1.5 w-1.5 rounded-full bg-amber-300" />Read-only preview</span>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="rounded-2xl border border-[var(--skc-separator)] bg-[var(--skc-surface-soft)] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#FF6868]">{queueLabel || 'Prospecting session'}</p>
          <p className="mt-1 text-sm font-black">{previewStatus}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--skc-text-tertiary)]">This rail mirrors the production workflow. Preview cannot connect Twilio, place calls, or save CRM changes.</p>
        </section>

        <WorkspaceCallController
          autoStartCountdownSeconds={remainingSeconds}
          callerPlan={callerPlan}
          countdownPaused={paused}
          dialDisplay={queueItem?.phone ?? ''}
          dialReady={false}
          effectiveCallerId={callerId}
          onCall={() => {}}
          onPauseAutoStart={pauseOrResume}
          previewOnly
          queueItem={queueItem}
          statusLabel={previewStatus}
        />

        <WorkspaceDispositionControls outcomeRequired previewOnly />

        <section aria-label="Preview session policy" className="rounded-2xl border border-[var(--skc-separator)] bg-[var(--skc-surface-soft)] p-4 text-xs">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--skc-text-tertiary)]">Session policy</p>
          <dl className="mt-3 space-y-2 text-[var(--skc-text-secondary)]">
            <div className="flex justify-between gap-3"><dt>Start</dt><dd className="text-right font-bold text-[var(--skc-text-primary)]">{startBehavior === 'first_unworked' ? 'First unworked seller' : 'Resume saved place'}</dd></div>
            <div className="flex justify-between gap-3"><dt>Caller ID</dt><dd className="text-right font-bold text-[var(--skc-text-primary)]">{callerPlan.mode === 'rotation' ? `${callerPlan.rotationCallerIds.length} rotating lines` : 'Static line'}</dd></div>
            <div className="flex justify-between gap-3"><dt>Rings before no answer</dt><dd className="text-right font-bold text-[var(--skc-text-primary)]">{ringCount || '7'} rings</dd></div>
            <div className="flex justify-between gap-3"><dt>Not dialed</dt><dd className="text-right font-bold text-[var(--skc-text-primary)]">{recencySummary(notDialedHours)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Not contacted</dt><dd className="text-right font-bold text-[var(--skc-text-primary)]">{recencySummary(notContactedHours)}</dd></div>
          </dl>
        </section>
      </div>

      <footer aria-label="Preview calling session controls" className="shrink-0 space-y-2 border-t border-[var(--skc-separator)] bg-[var(--skc-surface-1)] p-4">
        <button type="button" disabled className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--skc-surface-3)] px-4 text-sm font-black text-[var(--skc-text-tertiary)]"><Icon name="call_end" size="text-lg" />No live call to hang up</button>
        <button type="button" onClick={endPreview} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#7D2626] bg-[#E32E2E]/10 px-4 text-sm font-bold text-[#FF7A7A]"><Icon name="stop_circle" size="text-lg" />End preview</button>
      </footer>
    </section>
  )
}
