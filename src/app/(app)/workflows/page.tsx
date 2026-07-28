import { WORKFLOW_CATALOG, workflowCategoryLabel } from '@/lib/operating-model/workflow-catalog'
import type { WorkflowDefinition } from '@/lib/operating-model/types'

const STATUS_STYLES: Record<WorkflowDefinition['status'], string> = {
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  draft: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  paused: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  archived: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
}

const HEALTH_STYLES: Record<WorkflowDefinition['health'], string> = {
  healthy: 'bg-emerald-400',
  warning: 'bg-amber-400',
  error: 'bg-red-400',
  not_run: 'bg-slate-500',
}

function triggerLabel(trigger: WorkflowDefinition['trigger']): string {
  switch (trigger.type) {
    case 'inbound_call':
      return `Inbound call to ${trigger.phoneNumber}`
    case 'lead_form_submitted':
      return `Form submitted: ${trigger.formKey}`
    case 'appointment_status_changed':
      return `Appointment becomes ${trigger.toStatus}`
    case 'conversation_attention_changed':
      return `Conversation becomes ${trigger.toState.replaceAll('_', ' ')}`
    case 'opportunity_stage_changed':
      return `Opportunity enters ${trigger.toStage.replaceAll('_', ' ')}`
  }
}

export default function WorkflowsPage() {
  const activeCount = WORKFLOW_CATALOG.filter((workflow) => workflow.status === 'active').length
  const draftCount = WORKFLOW_CATALOG.filter((workflow) => workflow.status === 'draft').length

  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 border-b border-[var(--ck-border)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--ck-text-dim)]">Operations</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--ck-text)]">Workflows</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--ck-text-muted)]">
            The operating rules behind call routing, lead intake, appointments, communication, and pipeline movement.
          </p>
        </div>
        <button
          type="button"
          disabled
          title="Workflow editing will be enabled after versioning and dry-run safeguards are implemented."
          className="cursor-not-allowed rounded-lg bg-[var(--ck-accent)] px-4 py-2.5 text-sm font-bold text-white opacity-60"
        >
          New workflow
        </button>
      </div>

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ck-text-dim)]">Catalog</p>
          <p className="mt-1 text-2xl font-black text-[var(--ck-text)]">{WORKFLOW_CATALOG.length}</p>
        </div>
        <div className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ck-text-dim)]">Active</p>
          <p className="mt-1 text-2xl font-black text-emerald-400">{activeCount}</p>
        </div>
        <div className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ck-text-dim)]">Draft</p>
          <p className="mt-1 text-2xl font-black text-sky-300">{draftCount}</p>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead className="border-b border-[var(--ck-border)] bg-[var(--ck-surface-elev)]">
              <tr className="text-xs uppercase tracking-wider text-[var(--ck-text-dim)]">
                <th className="px-5 py-3 font-bold">Workflow</th>
                <th className="px-5 py-3 font-bold">Type</th>
                <th className="px-5 py-3 font-bold">Trigger</th>
                <th className="px-5 py-3 font-bold">Status</th>
                <th className="px-5 py-3 font-bold">Health</th>
                <th className="px-5 py-3 text-right font-bold">Version</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ck-border)]">
              {WORKFLOW_CATALOG.map((workflow) => (
                <tr key={workflow.id} className="transition-colors hover:bg-[var(--ck-surface-hi)]">
                  <td className="px-5 py-4">
                    <p className="font-bold text-[var(--ck-text)]">{workflow.name}</p>
                    <p className="mt-1 max-w-md text-xs leading-5 text-[var(--ck-text-muted)]">{workflow.description}</p>
                    {workflow.protectedResources?.length ? (
                      <p className="mt-2 text-[11px] font-bold text-amber-300">Protected resource</p>
                    ) : null}
                  </td>
                  <td className="px-5 py-4 text-sm text-[var(--ck-text-muted)]">
                    {workflowCategoryLabel(workflow.category)}
                  </td>
                  <td className="px-5 py-4 text-sm text-[var(--ck-text-muted)]">{triggerLabel(workflow.trigger)}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold capitalize ${STATUS_STYLES[workflow.status]}`}>
                      {workflow.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-2 text-sm capitalize text-[var(--ck-text-muted)]">
                      <span className={`h-2 w-2 rounded-full ${HEALTH_STYLES[workflow.health]}`} />
                      {workflow.health.replaceAll('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-sm text-[var(--ck-text-muted)]">v{workflow.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-4 text-xs leading-5 text-[var(--ck-text-dim)]">
        This first release is intentionally read-only. Publishing, editing, and execution remain disabled until dry-run,
        versioning, consent, rollback, and audit safeguards are connected.
      </p>
    </main>
  )
}
