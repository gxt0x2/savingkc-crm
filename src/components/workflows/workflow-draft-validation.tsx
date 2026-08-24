'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { WorkflowDraftValidationReport } from '@/lib/operating-model/workflow-store'

const CHECK_TONE = {
  pass: 'border-[var(--crm-success)]/25 bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
  warning: 'border-[var(--crm-warning)]/25 bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
  blocked: 'border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
} as const

export function WorkflowDraftValidation({ workflowId }: { workflowId: string }) {
  const [report, setReport] = useState<WorkflowDraftValidationReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function validate() {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/workflows/definitions/${encodeURIComponent(workflowId)}/validation`, {
        cache: 'no-store',
      })
      const data = await response.json() as { report?: WorkflowDraftValidationReport; error?: string }
      if (!response.ok || !data.report) throw new Error(data.error || 'Workflow validation is unavailable.')
      setReport(data.report)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Workflow validation is unavailable.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--crm-text-muted)]">Test before publish</p>
          <p className="mt-1 text-sm leading-6 text-[var(--crm-text-muted)]">Validate the contract, approval boundary, rollback plan, and action wiring without running the workflow.</p>
        </div>
        <button type="button" onClick={validate} disabled={loading} className="crm-secondary-button inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-black disabled:opacity-60">
          <Icon name="fact_check" className="text-[16px]" />
          {loading ? 'Validating…' : report ? 'Run again' : 'Validate draft'}
        </button>
      </div>

      {error ? <p role="alert" className="mt-3 rounded-xl border border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)] px-3 py-2 text-sm font-semibold text-[var(--crm-danger)]">{error}</p> : null}

      {report ? (
        <div className="mt-4 space-y-3">
          <div className={`rounded-xl border px-3 py-2 text-sm font-black ${report.readyForReview ? 'border-[var(--crm-warning)]/25 bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]' : 'border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]'}`}>
            {report.readyForReview ? 'Ready for executor design—not ready to publish.' : 'Draft corrections required before executor design.'}
          </div>
          <ul className="space-y-2">
            {report.checks.map((check) => (
              <li key={check.id} className={`rounded-xl border px-3 py-3 ${CHECK_TONE[check.status]}`}>
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.1em]"><Icon name={check.status === 'pass' ? 'check_circle' : check.status === 'warning' ? 'warning' : 'block'} className="text-[16px]" />{check.label}</div>
                <p className="mt-1 text-xs leading-5 text-[var(--crm-ink)]">{check.detail}</p>
              </li>
            ))}
          </ul>
          <details className="rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)]">
            <summary className="cursor-pointer px-3 py-2 text-xs font-black text-[var(--crm-text-muted)]">Planned effects · {report.plannedEffects.length}</summary>
            <ol className="space-y-2 border-t border-[var(--crm-border)] p-3">
              {report.plannedEffects.map((effect) => (
                <li key={effect.order} className="flex gap-2 text-xs leading-5 text-[var(--crm-ink)]"><strong>{effect.order}.</strong><span>{effect.label} <em className="text-[var(--crm-text-muted)]">({effect.effect === 'read_only' ? 'read only' : 'potential CRM write'}; executor not wired)</em></span></li>
              ))}
            </ol>
          </details>
          <p className="text-[11px] font-semibold text-[var(--crm-text-muted)]">Validation only. No workflow run, call, message, assignment, stage change, or CRM write occurred.</p>
        </div>
      ) : null}
    </section>
  )
}
