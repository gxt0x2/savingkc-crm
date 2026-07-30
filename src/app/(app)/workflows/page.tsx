'use client'

import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'
import { WORKFLOW_CATALOG, workflowCategoryLabel } from '@/lib/operating-model/workflow-catalog'
import type { WorkflowAction, WorkflowDefinition } from '@/lib/operating-model/types'

const STATUS_STYLES: Record<WorkflowDefinition['status'], string> = {
  active: 'border-[var(--crm-border-strong)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
  draft: 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]',
  paused: 'border-[var(--crm-border-strong)] bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
  archived: 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text-dim)]',
}

const HEALTH_STYLES: Record<WorkflowDefinition['health'], string> = {
  healthy: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  not_run: 'bg-slate-400',
}

function triggerLabel(trigger: WorkflowDefinition['trigger']): string {
  switch (trigger.type) {
    case 'inbound_call': return `Inbound call to ${trigger.phoneNumber}`
    case 'lead_form_submitted': return `Form submitted: ${trigger.formKey}`
    case 'appointment_status_changed': return `Appointment becomes ${trigger.toStatus}`
    case 'conversation_attention_changed': return `Conversation becomes ${trigger.toState.replaceAll('_', ' ')}`
    case 'opportunity_stage_changed': return `Opportunity enters ${trigger.toStage.replaceAll('_', ' ')}`
  }
}

function actionLabel(action: WorkflowAction): string {
  switch (action.type) {
    case 'ring_owner': return `Ring owner for ${action.timeoutSeconds}s`
    case 'ring_team': return `Ring ${action.teamId} team for ${action.timeoutSeconds}s`
    case 'record_voicemail': return 'Record voicemail'
    case 'send_sms': return `Send SMS: ${action.templateId.replaceAll('_', ' ')} (consent required)`
    case 'send_email': return `Send email: ${action.templateId.replaceAll('_', ' ')}`
    case 'create_next_action': return `Create ${action.actionType} action: ${action.title} (+${action.dueOffsetMinutes} min)`
    case 'notify_owner': return `Notify owner (${action.urgency})`
    case 'normalize_identity': return 'Normalize contact identity'
    case 'find_or_create_contact': return 'Find or create contact'
    case 'find_or_create_property': return 'Find or create property'
    case 'create_opportunity': return `Create opportunity in ${action.stage.replaceAll('_', ' ')}`
    case 'assign_owner': return `Assign owner using ${action.strategy.replaceAll('_', ' ')}`
    case 'create_calendar_event': return 'Create calendar event'
    case 'wait_until': return `Wait until ${Math.abs(action.offsetMinutes / 60)} hours before appointment`
    case 'stop_future_reminders': return 'Stop future reminders'
    case 'branch': return `Branch when ${action.condition}`
  }
}

export default function WorkflowsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [showSafety, setShowSafety] = useState(false)
  const selected = WORKFLOW_CATALOG.find((workflow) => workflow.id === selectedId) ?? null
  const workflowDetailsRef = useDialogAccessibility<HTMLElement>(
    Boolean(selected),
    () => setSelectedId(null),
  )
  const safetyDialogRef = useDialogAccessibility<HTMLElement>(
    showSafety,
    () => setShowSafety(false),
  )
  const activeCount = WORKFLOW_CATALOG.filter((workflow) => workflow.status === 'active').length
  const draftCount = WORKFLOW_CATALOG.filter((workflow) => workflow.status === 'draft').length
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return WORKFLOW_CATALOG.filter((workflow) =>
      (!category || workflow.category === category) &&
      (!needle || [workflow.name, workflow.description, triggerLabel(workflow.trigger)].some((value) => value.toLowerCase().includes(needle))),
    )
  }, [category, search])

  return (
    <main className="h-full overflow-y-auto bg-[var(--crm-canvas)] text-[var(--crm-ink)]">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4 border-b border-[var(--crm-border)] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="crm-eyebrow">Operations</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Workflows</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--crm-text-muted)]">The operating rules behind call routing, lead intake, appointments, communication, and pipeline movement.</p>
          </div>
          <button type="button" onClick={() => setShowSafety(true)} className="crm-secondary-button flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold">
            <Icon name="add" className="text-[18px]" />
            New workflow
          </button>
        </div>

        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          {[['Catalog', WORKFLOW_CATALOG.length, 'text-[var(--crm-ink)]'], ['Active', activeCount, 'text-[var(--crm-success)]'], ['Draft', draftCount, 'text-[var(--crm-text-muted)]']].map(([label, count, tone]) => (
            <div key={label} className="crm-panel rounded-xl p-4"><p className="text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">{label}</p><p className={`mt-1 text-2xl font-bold ${tone}`}>{count}</p></div>
          ))}
        </section>

        <section className="crm-panel mt-6 overflow-hidden rounded-xl">
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--crm-border)] p-4">
            <label className="relative min-w-64 flex-1"><Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--crm-text-muted)]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search workflows..." className="crm-field h-10 w-full rounded-lg pl-10 pr-3 text-sm outline-none" /></label>
            <select aria-label="Workflow type" value={category} onChange={(event) => setCategory(event.target.value)} className="crm-field h-10 rounded-lg px-3 text-sm font-semibold"><option value="">All workflow types</option><option value="phone_routing">Phone routing</option><option value="lead_intake">Lead intake</option><option value="appointment">Appointments</option><option value="communication">Communications</option><option value="pipeline">Pipeline</option><option value="nurture">Nurture</option></select>
            {search || category ? <button type="button" onClick={() => { setSearch(''); setCategory('') }} className="h-10 rounded-lg border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 text-sm font-bold text-[var(--crm-brand)]">Clear filters</button> : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead className="crm-table-header border-b"><tr className="text-xs uppercase tracking-wider"><th className="px-5 py-3 font-bold">Workflow</th><th className="px-5 py-3 font-bold">Type</th><th className="px-5 py-3 font-bold">Trigger</th><th className="px-5 py-3 font-bold">Status</th><th className="px-5 py-3 font-bold">Health</th><th className="px-5 py-3 text-right font-bold">Version</th></tr></thead>
              <tbody className="divide-y divide-[var(--crm-border)]">
                {visible.map((workflow) => (
                  <tr key={workflow.id} role="button" aria-label={`Open ${workflow.name} workflow details`} onClick={() => setSelectedId(workflow.id)} className="cursor-pointer transition-colors hover:bg-[var(--crm-surface-subtle)]" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(workflow.id) } }}>
                    <td className="px-5 py-4"><p className="font-bold">{workflow.name}</p><p className="mt-1 max-w-md text-xs leading-5 text-[var(--crm-text-muted)]">{workflow.description}</p>{workflow.protectedResources?.length ? <p className="mt-2 flex items-center gap-1 text-[11px] font-bold text-[var(--crm-warning)]"><Icon name="shield" className="text-[14px]" />Protected resource</p> : null}</td>
                    <td className="px-5 py-4 text-sm text-[var(--crm-text-muted)]">{workflowCategoryLabel(workflow.category)}</td>
                    <td className="px-5 py-4 text-sm text-[var(--crm-text-muted)]">{triggerLabel(workflow.trigger)}</td>
                    <td className="px-5 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold capitalize ${STATUS_STYLES[workflow.status]}`}>{workflow.status}</span></td>
                    <td className="px-5 py-4"><span className="inline-flex items-center gap-2 text-sm capitalize text-[var(--crm-text-muted)]"><span className={`h-2 w-2 rounded-full ${HEALTH_STYLES[workflow.health]}`} />{workflow.health.replaceAll('_', ' ')}</span></td>
                    <td className="px-5 py-4 text-right font-mono text-sm text-[var(--crm-text-muted)]">v{workflow.version} <Icon name="chevron_right" className="ml-2 text-[17px]" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visible.length ? <div className="p-12 text-center text-sm text-[var(--crm-text-muted)]">No workflows match your search.</div> : null}
        </section>
        <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-[var(--crm-text-muted)]"><Icon name="lock" className="mt-0.5 text-[15px] text-[var(--crm-brand)]" />The catalog is safely read-only. Publishing, editing, and execution stay locked until dry-run, versioning, consent, rollback, and audit safeguards are connected.</p>
      </div>

      {selected ? <div className="fixed inset-0 z-[70] bg-[#111827]/35" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null) }}>
        <aside ref={workflowDetailsRef} role="dialog" aria-modal="true" aria-label={`${selected.name} workflow details`} tabIndex={-1} className="crm-modal-surface ml-auto flex h-full w-full max-w-xl flex-col bg-[var(--ck-surface)] shadow-2xl">
          <header className="flex items-start justify-between border-b border-[var(--ck-border)] px-6 py-5"><div><p className="text-xs font-black uppercase tracking-[0.1em] text-[var(--ck-accent)]">{workflowCategoryLabel(selected.category)}</p><h2 className="mt-1 text-xl font-bold">{selected.name}</h2><p className="mt-2 text-sm leading-6 text-[var(--ck-text-muted)]">{selected.description}</p></div><button type="button" onClick={() => setSelectedId(null)} aria-label="Close workflow details" className="ml-4 text-[var(--ck-text-muted)] hover:text-[var(--ck-accent)]"><Icon name="close" /></button></header>
          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-2 gap-3"><WorkflowFact label="Status" value={selected.status} /><WorkflowFact label="Health" value={selected.health.replaceAll('_', ' ')} /><WorkflowFact label="Owner" value={selected.owner.displayName} /><WorkflowFact label="Version" value={`v${selected.version}`} /></div>
            <section className="mt-6"><h3 className="text-xs font-black uppercase tracking-[0.1em] text-[var(--ck-text-muted)]">Trigger</h3><div className="mt-3 flex items-center gap-3 rounded-lg border border-[var(--ck-border-strong)] bg-[var(--crm-violet-soft)] p-4"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--crm-violet)] text-white"><Icon name="bolt" /></span><p className="text-sm font-bold">{triggerLabel(selected.trigger)}</p></div></section>
            <section className="mt-6"><h3 className="text-xs font-black uppercase tracking-[0.1em] text-[var(--ck-text-muted)]">Actions</h3><ol className="mt-3 space-y-2">{selected.actions.map((action, index) => <li key={`${action.type}-${index}`} className="flex items-center gap-3 rounded-lg border border-[var(--ck-border)] p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ck-surface-elev)] text-xs font-black text-[var(--ck-text-muted)]">{index + 1}</span><span className="text-sm font-semibold text-[var(--ck-text)]">{actionLabel(action)}</span></li>)}</ol></section>
            {selected.protectedResources?.length ? <section className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4"><h3 className="flex items-center gap-2 text-sm font-black text-amber-900"><Icon name="shield" />Protected resources</h3>{selected.protectedResources.map((resource) => <p key={resource} className="mt-2 font-mono text-sm text-amber-800">{resource}</p>)}</section> : null}
          </div>
          <footer className="border-t border-[var(--ck-border)] p-5"><button type="button" onClick={() => { setSelectedId(null); setShowSafety(true) }} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--ck-accent)] text-sm font-bold text-[var(--ck-accent)] hover:bg-[var(--ck-surface-elev)]"><Icon name="lock" />Editing safeguards required</button></footer>
        </aside>
      </div> : null}

      {showSafety ? <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#111827]/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSafety(false) }}><section ref={safetyDialogRef} role="dialog" aria-modal="true" aria-label="Workflow safety requirements" tabIndex={-1} className="crm-modal-surface w-full max-w-lg rounded-xl bg-[var(--ck-surface)] p-6 shadow-2xl"><div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ck-surface-elev)] text-[var(--ck-accent)]"><Icon name="lock" /></span><div><h2 className="text-lg font-bold">Workflow editing is safely locked</h2><p className="mt-2 text-sm leading-6 text-[var(--ck-text-muted)]">Creating or changing automation can call, text, move stages, and alter ownership. The editor will unlock only after these controls are implemented:</p></div></div><ul className="mt-5 grid gap-2 sm:grid-cols-2">{['Version history', 'Dry-run preview', 'Consent enforcement', 'Rollback', 'Approval gates', 'Immutable audit log'].map((item) => <li key={item} className="flex items-center gap-2 rounded-md bg-[var(--ck-surface-elev)] px-3 py-2 text-sm font-semibold"><Icon name="check_circle" className="text-[17px] text-[var(--ck-accent)]" />{item}</li>)}</ul><button type="button" onClick={() => setShowSafety(false)} className="mt-6 h-10 w-full rounded-lg bg-[var(--ck-accent)] text-sm font-bold text-white hover:bg-[var(--ck-accent-bright)]">Understood</button></section></div> : null}
    </main>
  )
}

function WorkflowFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-[var(--ck-surface-elev)] p-3"><p className="text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-muted)]">{label}</p><p className="mt-1 text-sm font-bold capitalize">{value}</p></div>
}
