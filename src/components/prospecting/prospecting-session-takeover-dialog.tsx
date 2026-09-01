'use client'

import { Icon } from '@/components/ui/icon'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'
import type { DialerSessionControlSummary } from '@/lib/dialer-session-client'

function sessionPhase(summary: DialerSessionControlSummary): string {
  if (summary.attemptStatus === 'awaiting_disposition') return 'Outcome required'
  if (summary.attemptStatus && ['authorized', 'dialing', 'connected'].includes(summary.attemptStatus)) return 'Call in progress'
  if (summary.status === 'paused') return 'Paused'
  return 'Ready to call'
}

function lastActivity(summary: DialerSessionControlSummary): string {
  if (!summary.heartbeatAt) return 'Last activity unavailable'
  const timestamp = Date.parse(summary.heartbeatAt)
  if (!Number.isFinite(timestamp)) return 'Last activity unavailable'
  return `Last active ${new Date(timestamp).toLocaleString()}`
}

export function ProspectingSessionTakeoverDialog({
  summary,
  selectedCampaignId,
  selectedCampaignName,
  busy,
  error,
  onCancel,
  onContinue,
}: {
  summary: DialerSessionControlSummary
  selectedCampaignId?: string | null
  selectedCampaignName?: string | null
  busy: boolean
  error?: string | null
  onCancel: () => void
  onContinue: () => void
}) {
  const dialogRef = useDialogAccessibility<HTMLElement>(true, () => { if (!busy) onCancel() })
  const sameCampaign = summary.campaignId && selectedCampaignId
    ? summary.campaignId === selectedCampaignId
    : !selectedCampaignName || summary.campaignName === selectedCampaignName
  const interruptionNotice = summary.operationActive
    ? `${summary.operationLabel || 'The in-progress CRM change'} will be cancelled in the other window before calling starts here.`
    : summary.attemptStatus === 'awaiting_disposition'
      ? 'The unfinished call outcome will be recorded as interrupted so calling can continue here.'
      : summary.attemptStatus
        ? 'The live call will be disconnected and recorded as interrupted before calling continues here.'
        : null

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[#101711]/65 p-4 backdrop-blur-sm" role="presentation">
      <section ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="dialer-takeover-title" aria-describedby="dialer-takeover-description" tabIndex={-1} className="crm-panel-raised w-full max-w-xl rounded-2xl p-5 shadow-2xl sm:p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--crm-warning-soft)] text-[var(--crm-on-warning)]">
            <Icon name="devices" className="text-2xl" />
          </span>
          <div className="min-w-0">
            <p className="crm-eyebrow">Dialing session already open</p>
            <h2 id="dialer-takeover-title" className="mt-1 text-xl font-black text-[var(--crm-ink)]">Disconnect the other session and call here?</h2>
            <p id="dialer-takeover-description" className="mt-2 text-sm leading-6 text-[var(--crm-text-muted)]">
              One click removes dialing control from every other window, preserves this campaign and seller position, then starts a fresh 15-second countdown here.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-[var(--crm-ink)]">{summary.campaignName}</p>
              <p className="mt-1 text-xs text-[var(--crm-text-muted)]">Seller {summary.currentIndex + 1} of {summary.queueSize}</p>
            </div>
            <span className="rounded-full border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">{sessionPhase(summary)}</span>
          </div>
          <div className="mt-4 grid gap-2 text-xs text-[var(--crm-text-muted)] sm:grid-cols-2">
            <span className="inline-flex items-center gap-2"><Icon name="computer" className="text-base" />{summary.controllerLabel || 'Another browser'}</span>
            <span className="inline-flex items-center gap-2"><Icon name="schedule" className="text-base" />{lastActivity(summary)}</span>
          </div>
        </div>

        {!sameCampaign ? <div className="mt-4 rounded-xl border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-4 py-3 text-xs leading-5 text-[var(--crm-on-warning)]">The selected campaign will not start. Continue the already-open <strong>{summary.campaignName}</strong> session here first.</div> : null}
        {interruptionNotice ? <div className="mt-4 rounded-xl border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-4 py-3 text-xs font-bold text-[var(--crm-on-warning)]" role="status">{interruptionNotice}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-4 py-3 text-xs font-bold text-[var(--crm-danger)]" role="alert">{error}</div> : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" autoFocus onClick={onCancel} disabled={busy} className="crm-secondary-button h-11 rounded-xl px-5 text-sm font-black disabled:opacity-50">Cancel</button>
          <button type="button" onClick={onContinue} disabled={busy} className="crm-primary-button inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40"><Icon name={busy ? 'progress_activity' : 'power_settings_new'} className={busy ? 'animate-spin' : ''} />{busy ? 'Disconnecting…' : 'Disconnect & start here'}</button>
        </div>
      </section>
    </div>
  )
}
