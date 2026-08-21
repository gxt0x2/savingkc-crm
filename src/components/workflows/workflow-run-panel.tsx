'use client'

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'

type RunStatus = 'awaiting_approval' | 'queued' | 'running' | 'retry_scheduled' | 'succeeded' | 'failed' | 'rejected' | 'cancelled'

type WorkflowRunSummary = {
  id: string
  workflow_id: string
  workflow_version: number
  status: RunStatus
  requested_by: string
  attempt_count: number
  max_attempts: number
  output: Record<string, unknown> | null
  error_message: string | null
  created_at: string
}

const STATUS_TONE: Record<RunStatus, string> = {
  awaiting_approval: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
  queued: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]',
  running: 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]',
  retry_scheduled: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
  succeeded: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
  failed: 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
  rejected: 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
  cancelled: 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]',
}

function readableStatus(status: RunStatus): string {
  return status.replaceAll('_', ' ')
}

function healthSummary(run: WorkflowRunSummary): string {
  if (run.status === 'failed') return run.error_message || 'Execution failed'
  if (run.status !== 'succeeded') return `Attempt ${run.attempt_count} of ${run.max_attempts}`
  const output = run.output ?? {}
  const definitions = typeof output.definitions === 'number' ? output.definitions : null
  const warnings = typeof output.warnings === 'number' ? output.warnings : null
  return definitions === null ? 'Completed with a durable audit record' : `${definitions} definitions checked · ${warnings ?? 0} warnings`
}

export function WorkflowRunPanel() {
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/workflows/runs?limit=8', { cache: 'no-store', signal })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Workflow run history is unavailable.')
    setRuns(Array.isArray(data.runs) ? data.runs : [])
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    refresh(controller.signal)
      .catch((cause) => {
        if (active && (cause as Error).name !== 'AbortError') setError(cause instanceof Error ? cause.message : 'Workflow run history is unavailable.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => {
      active = false
      controller.abort()
    }
  }, [refresh])

  async function runHealthCheck() {
    if (running) return
    setRunning(true)
    setError('')
    try {
      const response = await fetch('/api/workflows/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `workflow-registry-health:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ workflowId: 'workflow-registry-health', input: {} }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Workflow health check could not run.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Workflow health check could not run.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="crm-panel overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--crm-border)] p-5">
        <div>
          <p className="crm-eyebrow">Execution control</p>
          <h2 className="mt-1 font-black text-[var(--crm-ink)]">Versioned workflow runs</h2>
          <p className="mt-1 text-sm text-[var(--crm-text-muted)]">Durable attempts, approvals, retries, step outcomes, and definition provenance.</p>
        </div>
        <button type="button" onClick={runHealthCheck} disabled={running} className="crm-primary-button inline-flex h-10 items-center gap-2 rounded-lg px-4 text-xs font-black disabled:opacity-60">
          <Icon name={running ? 'progress_activity' : 'health_and_safety'} className={running ? 'animate-spin' : ''} />
          {running ? 'Checking…' : 'Run registry health'}
        </button>
      </div>

      {error ? (
        <div className="m-4 rounded-xl border border-[var(--crm-warning)]/25 bg-[var(--crm-warning-soft)] p-4 text-sm font-semibold text-[var(--crm-ink)]">
          <strong>Execution ledger unavailable.</strong> {error}
        </div>
      ) : null}
      {loading ? <div className="p-6 text-sm font-bold text-[var(--crm-text-muted)]">Loading workflow run history…</div> : null}
      {!loading && !error && runs.length === 0 ? (
        <div className="p-6 text-sm text-[var(--crm-text-muted)]">No governed runs yet. The registry health check is read-only and is the first approved executor.</div>
      ) : null}
      {!loading && runs.length > 0 ? (
        <div className="divide-y divide-[var(--crm-border)]">
          {runs.map((run) => (
            <article key={run.id} className="flex flex-col gap-2 bg-[var(--crm-surface)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm text-[var(--crm-ink)]">{run.workflow_id}</strong>
                  <span className="text-xs font-semibold text-[var(--crm-text-muted)]">v{run.workflow_version}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${STATUS_TONE[run.status]}`}>{readableStatus(run.status)}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--crm-text-muted)]">{healthSummary(run)}</p>
              </div>
              <div className="shrink-0 text-left text-xs text-[var(--crm-text-muted)] sm:text-right">
                <p className="font-bold text-[var(--crm-ink)]">{run.requested_by}</p>
                <time dateTime={run.created_at}>{new Date(run.created_at).toLocaleString()}</time>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
