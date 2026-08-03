'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'
import { PHONE_SYSTEM, PHONE_SYSTEM_ATTENTION, type PhoneSystemRecord } from '@/lib/operating-model/phone-system'
import { WORKFLOW_CATALOG, workflowCategoryLabel } from '@/lib/operating-model/workflow-catalog'
import type { WorkflowAction, WorkflowDefinition } from '@/lib/operating-model/types'

const STATUS_STYLES: Record<WorkflowDefinition['status'], string> = {
  active: 'border-[var(--crm-success)]/25 bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
  draft: 'border-[var(--crm-info)]/25 bg-[var(--crm-info-soft)] text-[var(--crm-info)]',
  paused: 'border-[var(--crm-warning)]/25 bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
  archived: 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]',
}

const HEALTH_LABELS: Record<WorkflowDefinition['health'], string> = {
  healthy: 'Configured',
  warning: 'Needs attention',
  error: 'Blocked',
  not_run: 'Not run',
}

const HEALTH_STYLES: Record<WorkflowDefinition['health'], string> = {
  healthy: 'bg-[var(--crm-success)]',
  warning: 'bg-[var(--crm-warning)]',
  error: 'bg-[var(--crm-danger)]',
  not_run: 'bg-[var(--crm-text-dim)]',
}

function triggerLabel(trigger: WorkflowDefinition['trigger']): string {
  switch (trigger.type) {
    case 'inbound_call': return `Inbound call · ${trigger.phoneNumber}`
    case 'inbound_sms': return 'Inbound SMS · every owned number'
    case 'lead_form_submitted': return `Form submitted · ${trigger.formKey}`
    case 'appointment_status_changed': return `Appointment becomes ${trigger.toStatus.replaceAll('_', ' ')}`
    case 'conversation_attention_changed': return `Conversation becomes ${trigger.toState.replaceAll('_', ' ')}`
    case 'opportunity_stage_changed': return `Opportunity enters ${trigger.toStage.replaceAll('_', ' ')}`
    case 'scheduled': return trigger.schedule
    case 'webhook': return trigger.event
    case 'record_changed': return `${trigger.record} · ${trigger.event}`
    case 'manual': return `User action · ${trigger.surface}`
  }
}

function actionLabel(action: WorkflowAction): string {
  switch (action.type) {
    case 'ring_owner': return `Ring owner for ${action.timeoutSeconds} seconds`
    case 'ring_team': return `Ring ${action.teamId} team for ${action.timeoutSeconds} seconds`
    case 'record_voicemail': return 'Record voicemail'
    case 'send_sms': return `Send approved SMS · ${action.templateId.replaceAll('_', ' ')}`
    case 'send_email': return `Send email · ${action.templateId.replaceAll('_', ' ')}`
    case 'create_next_action': return `Create ${action.actionType} next action · ${action.title}`
    case 'notify_owner': return `Notify owner · ${action.urgency}`
    case 'normalize_identity': return 'Normalize identity'
    case 'find_or_create_contact': return 'Find or create contact'
    case 'find_or_create_property': return 'Find or create property'
    case 'create_opportunity': return `Create ${action.stage.replaceAll('_', ' ')} opportunity`
    case 'assign_owner': return `Assign owner · ${action.strategy.replaceAll('_', ' ')}`
    case 'create_calendar_event': return 'Create calendar event'
    case 'wait_until': return `Wait until ${Math.abs(action.offsetMinutes / 60)} hours before appointment`
    case 'stop_future_reminders': return 'Stop future reminders'
    case 'branch': return `Decision · ${action.condition}`
    case 'execute': return action.label
  }
}

function SurfaceHeader({ section, onNew }: { section: string; onNew: () => void }) {
  const content = section === 'phones'
    ? { eyebrow: 'Phone routing', title: 'Master Phone System', description: 'Every owned number, the path it takes, the workflow that controls it, and the gaps that require a decision.' }
    : section === 'all'
      ? { eyebrow: 'System registry', title: 'All Workflows', description: 'The canonical operating registry for live routes, workers, automations, and workflows still being designed.' }
      : { eyebrow: 'Operations control', title: 'Workflows', description: 'One source of truth for phone routing, lead intake, communication, appointments, pipeline movement, closeout, reporting, and operating rhythm.' }

  return (
    <header className="flex flex-col gap-4 border-b border-[var(--crm-border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="crm-eyebrow">{content.eyebrow}</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-[var(--crm-ink)]">{content.title}</h1>
        <p className="mt-1 max-w-4xl text-sm leading-6 text-[var(--crm-text-muted)]">{content.description}</p>
      </div>
      <button type="button" onClick={onNew} className="crm-primary-button inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-black">
        <Icon name="add" className="text-[18px]" />
        New workflow
      </button>
    </header>
  )
}

function Overview({ onSelect }: { onSelect: (workflow: WorkflowDefinition) => void }) {
  const active = WORKFLOW_CATALOG.filter((workflow) => workflow.status === 'active').length
  const attention = WORKFLOW_CATALOG.filter((workflow) => workflow.health === 'warning' || workflow.health === 'error').length
  const attentionWorkflows = WORKFLOW_CATALOG.filter((workflow) => workflow.health === 'warning' || workflow.health === 'error')
  const reviewWorkflows = attentionWorkflows.length > 0 ? attentionWorkflows : WORKFLOW_CATALOG.slice(0, 4)
  const automations = WORKFLOW_CATALOG.filter((workflow) => workflow.implementation.execution === 'worker').length

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Owned numbers', value: PHONE_SYSTEM.length, note: 'Every live DID is registered', icon: 'phone_in_talk', tone: 'text-[var(--crm-info)] bg-[var(--crm-info-soft)]' },
          { label: 'System workflows', value: WORKFLOW_CATALOG.length, note: `${active} active definitions`, icon: 'account_tree', tone: 'text-[var(--crm-violet)] bg-[var(--crm-violet-soft)]' },
          { label: 'Scheduled workers', value: automations, note: 'Cron and worker execution', icon: 'schedule', tone: 'text-[var(--crm-success)] bg-[var(--crm-success-soft)]' },
          { label: 'Needs attention', value: PHONE_SYSTEM_ATTENTION.length + attention, note: 'Routing or workflow decisions', icon: 'error', tone: 'text-[var(--crm-danger)] bg-[var(--crm-danger-soft)]' },
        ].map((item) => (
          <article key={item.label} className="crm-panel rounded-2xl p-4">
            <div className={`grid h-10 w-10 place-items-center rounded-xl ${item.tone}`}><Icon name={item.icon} className="text-[21px]" /></div>
            <p className="mt-4 text-3xl font-black tracking-tight text-[var(--crm-ink)]">{item.value}</p>
            <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-[var(--crm-text-muted)]">{item.label}</p>
            <p className="mt-2 text-xs text-[var(--crm-text-muted)]">{item.note}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Link href="/workflows?section=phones" className="group crm-panel rounded-2xl p-5 transition hover:-translate-y-0.5 hover:border-[var(--crm-info)]/50 hover:shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--crm-info-soft)] text-[var(--crm-info)]"><Icon name="phone_in_talk" className="text-[25px]" /></div>
            <Icon name="arrow_forward" className="text-[22px] text-[var(--crm-text-dim)] transition group-hover:translate-x-1 group-hover:text-[var(--crm-info)]" />
          </div>
          <h2 className="mt-5 text-xl font-black text-[var(--crm-ink)]">Phone System</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--crm-text-muted)]">Audit all {PHONE_SYSTEM.length} phone identities and follow voice, SMS, no-answer, outbound, fallback, owner, and workflow paths.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-[var(--crm-success-soft)] px-2.5 py-1 text-xs font-bold text-[var(--crm-success)]">{PHONE_SYSTEM.length - PHONE_SYSTEM_ATTENTION.length} mapped</span>
            <span className="rounded-full bg-[var(--crm-danger-soft)] px-2.5 py-1 text-xs font-bold text-[var(--crm-danger)]">{PHONE_SYSTEM_ATTENTION.length} decisions</span>
          </div>
        </Link>

        <Link href="/workflows?section=all" className="group crm-panel rounded-2xl p-5 transition hover:-translate-y-0.5 hover:border-[var(--crm-violet)]/50 hover:shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]"><Icon name="schema" className="text-[25px]" /></div>
            <Icon name="arrow_forward" className="text-[22px] text-[var(--crm-text-dim)] transition group-hover:translate-x-1 group-hover:text-[var(--crm-violet)]" />
          </div>
          <h2 className="mt-5 text-xl font-black text-[var(--crm-ink)]">Workflow Registry</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--crm-text-muted)]">See each trigger, operating owner, action sequence, implementation source, mutation policy, and approval boundary.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-[var(--crm-violet-soft)] px-2.5 py-1 text-xs font-bold text-[var(--crm-violet)]">{WORKFLOW_CATALOG.length} definitions</span>
            <span className="rounded-full bg-[var(--crm-info-soft)] px-2.5 py-1 text-xs font-bold text-[var(--crm-info)]">{new Set(WORKFLOW_CATALOG.map((workflow) => workflow.category)).size} operating areas</span>
          </div>
        </Link>
      </section>

      {PHONE_SYSTEM_ATTENTION.length > 0 ? (
        <section className="rounded-2xl border border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)] p-5">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--crm-surface)] text-[var(--crm-danger)]"><Icon name="error" /></div>
            <div className="min-w-0 flex-1">
              <h2 className="font-black text-[var(--crm-ink)]">Routing decisions are visible, not hidden</h2>
              <p className="mt-1 text-sm text-[var(--crm-text-muted)]">The master registry found {PHONE_SYSTEM_ATTENTION.length} live phone paths that do not match their intended ownership.</p>
              <div className="mt-3 space-y-2">{PHONE_SYSTEM_ATTENTION.map((record) => <Link key={record.number} href="/workflows?section=phones" className="flex items-center justify-between gap-3 rounded-xl bg-[var(--crm-surface)] px-3 py-2 text-sm hover:shadow"><span><strong>{record.label}</strong><span className="ml-2 text-[var(--crm-text-muted)]">{record.healthNote}</span></span><Icon name="arrow_forward" className="shrink-0 text-[var(--crm-danger)]" /></Link>)}</div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="crm-panel rounded-2xl p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="crm-eyebrow">Workflow review</p><h2 className="mt-1 font-black text-[var(--crm-ink)]">{attentionWorkflows.length > 0 ? 'Definitions that need a decision' : 'Common workflow definitions'}</h2></div>
          <Link href="/workflows?section=all" className="text-xs font-black text-[var(--crm-violet)] hover:underline">Open all workflows</Link>
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-2">{reviewWorkflows.map((workflow) => <button key={workflow.id} type="button" onClick={() => onSelect(workflow)} aria-label={`Open ${workflow.name} workflow details`} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-3 text-left transition hover:border-[var(--crm-violet)] hover:bg-[var(--crm-violet-soft)]"><span><strong className="block text-sm text-[var(--crm-ink)]">{workflow.name}</strong><span className="mt-1 block line-clamp-2 text-xs text-[var(--crm-text-muted)]">{workflow.description}</span></span><Icon name="arrow_forward" className="shrink-0 text-[var(--crm-violet)]" /></button>)}</div>
      </section>
    </div>
  )
}

function PhoneSystem({ onSelect }: { onSelect: (record: PhoneSystemRecord) => void }) {
  const [search, setSearch] = useState('')
  const [routeType, setRouteType] = useState('')
  const [auditState, setAuditState] = useState<'idle' | 'loading' | 'verified' | 'unavailable' | 'error'>('idle')
  const [liveAudit, setLiveAudit] = useState<Record<string, string>>({})
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return PHONE_SYSTEM.filter((record) =>
      (!routeType || record.routeType === routeType) &&
      (!needle || [record.label, record.number, record.owner, record.team, record.workflowId, record.healthNote].some((value) => value.toLowerCase().includes(needle))),
    )
  }, [routeType, search])

  async function verifyCarrier() {
    setAuditState('loading')
    try {
      const response = await fetch('/api/workflows/phone-system', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Carrier audit failed')
      setLiveAudit(Object.fromEntries((data.numbers ?? []).map((row: { number: string; carrierStatus: string }) => [row.number, row.carrierStatus])))
      setAuditState(data.providerAvailable ? 'verified' : 'unavailable')
    } catch {
      setAuditState('error')
    }
  }

  return (
    <section className="crm-panel overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--crm-border)] p-4">
        <label className="relative min-w-64 flex-1"><Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--crm-text-muted)]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search number, owner, workflow, or path..." className="crm-field h-10 w-full rounded-lg pl-10 pr-3 text-sm outline-none" /></label>
        <select aria-label="Route type" value={routeType} onChange={(event) => setRouteType(event.target.value)} className="crm-field h-10 rounded-lg px-3 text-sm font-bold">
          <option value="">All route types</option>
          <option value="acquisitions_ivr">Acquisition IVR</option>
          <option value="google_ads">Google Ads</option>
          <option value="cold_callback">Cold callback</option>
          <option value="direct_agent">Direct agent</option>
          <option value="dispositions">Dispositions</option>
          <option value="legacy">Legacy</option>
        </select>
        <button type="button" onClick={verifyCarrier} disabled={auditState === 'loading'} className="crm-secondary-button inline-flex h-10 items-center gap-2 rounded-lg px-3 text-xs font-black disabled:opacity-60"><Icon name={auditState === 'loading' ? 'progress_activity' : 'verified'} className={auditState === 'loading' ? 'animate-spin' : ''} />{auditState === 'loading' ? 'Checking carrier…' : auditState === 'verified' ? 'Carrier verified' : auditState === 'unavailable' ? 'Carrier unavailable' : auditState === 'error' ? 'Retry carrier audit' : 'Verify live carrier'}</button>
        <span className="rounded-full bg-[var(--crm-surface-subtle)] px-3 py-2 text-xs font-black text-[var(--crm-text-muted)]">{visible.length} numbers</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] border-collapse text-left">
          <thead className="crm-table-header border-b"><tr className="text-[11px] uppercase tracking-[0.12em]"><th className="px-5 py-3 font-black">Phone identity</th><th className="px-5 py-3 font-black">Owner</th><th className="px-5 py-3 font-black">Inbound route</th><th className="px-5 py-3 font-black">No answer / SMS</th><th className="px-5 py-3 font-black">Workflow</th><th className="px-5 py-3 font-black">State</th><th className="w-12" /></tr></thead>
          <tbody className="divide-y divide-[var(--crm-border)]">
            {visible.map((record) => (
              <tr key={record.number} onClick={() => onSelect(record)} className="cursor-pointer bg-[var(--crm-surface)] transition hover:bg-[var(--crm-surface-subtle)]">
                <td className="px-5 py-4"><p className="font-black text-[var(--crm-ink)]">{record.label}</p><p className="mt-1 font-mono text-xs text-[var(--crm-text-muted)]">{record.number}</p></td>
                <td className="px-5 py-4"><p className="text-sm font-bold text-[var(--crm-ink)]">{record.owner}</p><p className="mt-1 text-xs text-[var(--crm-text-muted)]">{record.team}</p></td>
                <td className="max-w-[280px] px-5 py-4"><div className="flex flex-wrap items-center gap-1 text-xs text-[var(--crm-text-muted)]">{record.inboundPath.slice(1, 4).map((step, index) => <span key={step} className="contents"><span className="rounded-md bg-[var(--crm-info-soft)] px-2 py-1 font-bold text-[var(--crm-info)]">{step}</span>{index < Math.min(record.inboundPath.length - 2, 2) ? <Icon name="chevron_right" className="text-[14px]" /> : null}</span>)}</div></td>
                <td className="max-w-[250px] px-5 py-4"><p className="line-clamp-2 text-xs leading-5 text-[var(--crm-text-muted)]">{record.noAnswerPath}</p></td>
                <td className="px-5 py-4"><Link href={`/workflows?section=all&workflow=${record.workflowId}`} onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 text-xs font-black text-[var(--crm-violet)] hover:underline"><Icon name="account_tree" className="text-[15px]" />{record.workflowId}</Link></td>
                <td className="px-5 py-4"><span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-black ${liveAudit[record.number] === 'mismatch' || liveAudit[record.number] === 'missing' || record.health === 'attention' ? 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]'}`}><span className={`h-2 w-2 rounded-full ${liveAudit[record.number] === 'mismatch' || liveAudit[record.number] === 'missing' || record.health === 'attention' ? 'bg-[var(--crm-danger)]' : 'bg-[var(--crm-success)]'}`} />{liveAudit[record.number] === 'verified' ? 'Verified live' : liveAudit[record.number] === 'mismatch' ? 'Carrier mismatch' : liveAudit[record.number] === 'missing' ? 'Missing at carrier' : record.health === 'healthy' ? 'Mapped' : 'Decision needed'}</span></td>
                <td className="pr-4 text-right"><Icon name="chevron_right" className="text-[var(--crm-text-dim)]" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-5 py-3 text-xs text-[var(--crm-text-muted)]"><strong className="text-[var(--crm-ink)]">Fallback truth:</strong> none of the registered Twilio numbers currently has a carrier-level voice or SMS fallback URL. That is shown on every phone record instead of being implied.</div>
    </section>
  )
}

function WorkflowRegistry({ onSelect }: { onSelect: (workflow: WorkflowDefinition) => void }) {
  const params = useSearchParams()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return WORKFLOW_CATALOG.filter((workflow) =>
      (!category || workflow.category === category) &&
      (!needle || [workflow.name, workflow.description, triggerLabel(workflow.trigger), workflow.owner.displayName, ...workflow.implementation.sourceFiles].some((value) => value.toLowerCase().includes(needle))),
    )
  }, [category, search])

  const requestedWorkflow = params.get('workflow')
  const requested = requestedWorkflow ? WORKFLOW_CATALOG.find((workflow) => workflow.id === requestedWorkflow) : undefined

  return (
    <section className="crm-panel overflow-hidden rounded-2xl">
      {requested ? <button type="button" onClick={() => onSelect(requested)} className="flex w-full items-center justify-between gap-3 border-b border-[var(--crm-violet)]/25 bg-[var(--crm-violet-soft)] px-5 py-3 text-left text-sm font-bold text-[var(--crm-violet)]"><span>Open linked workflow: {requested.name}</span><Icon name="open_in_new" /></button> : null}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--crm-border)] p-4">
        <label className="relative min-w-64 flex-1"><Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--crm-text-muted)]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search workflow, trigger, owner, or implementation..." className="crm-field h-10 w-full rounded-lg pl-10 pr-3 text-sm outline-none" /></label>
        <select aria-label="Workflow category" value={category} onChange={(event) => setCategory(event.target.value)} className="crm-field h-10 rounded-lg px-3 text-sm font-bold"><option value="">All operating areas</option>{Array.from(new Set(WORKFLOW_CATALOG.map((workflow) => workflow.category))).map((value) => <option key={value} value={value}>{workflowCategoryLabel(value)}</option>)}</select>
        <span className="rounded-full bg-[var(--crm-surface-subtle)] px-3 py-2 text-xs font-black text-[var(--crm-text-muted)]">{visible.length} workflows</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse text-left">
          <thead className="crm-table-header border-b"><tr className="text-[11px] uppercase tracking-[0.12em]"><th className="px-5 py-3 font-black">Workflow</th><th className="px-5 py-3 font-black">Operating area</th><th className="px-5 py-3 font-black">Trigger</th><th className="px-5 py-3 font-black">Owner</th><th className="px-5 py-3 font-black">Execution</th><th className="px-5 py-3 font-black">State</th><th className="w-12" /></tr></thead>
          <tbody className="divide-y divide-[var(--crm-border)]">
            {visible.map((workflow) => (
              <tr key={workflow.id} onClick={() => onSelect(workflow)} className="cursor-pointer bg-[var(--crm-surface)] transition hover:bg-[var(--crm-surface-subtle)]">
                <td className="max-w-[320px] px-5 py-4"><p className="font-black text-[var(--crm-ink)]">{workflow.name}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--crm-text-muted)]">{workflow.description}</p></td>
                <td className="px-5 py-4"><span className="rounded-full bg-[var(--crm-info-soft)] px-2.5 py-1 text-xs font-bold text-[var(--crm-info)]">{workflowCategoryLabel(workflow.category)}</span></td>
                <td className="max-w-[260px] px-5 py-4 text-xs font-semibold leading-5 text-[var(--crm-text-muted)]">{triggerLabel(workflow.trigger)}</td>
                <td className="px-5 py-4 text-sm font-bold text-[var(--crm-ink)]">{workflow.owner.displayName}</td>
                <td className="px-5 py-4"><p className="text-xs font-black capitalize text-[var(--crm-ink)]">{workflow.implementation.execution}</p><p className="mt-1 text-xs text-[var(--crm-text-muted)]">{workflow.implementation.mutatesData ? 'Writes data' : 'Read only'}</p></td>
                <td className="px-5 py-4"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${HEALTH_STYLES[workflow.health]}`} /><span className="text-xs font-black text-[var(--crm-ink)]">{HEALTH_LABELS[workflow.health]}</span></div><span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${STATUS_STYLES[workflow.status]}`}>{workflow.status}</span></td>
                <td className="pr-4 text-right"><Icon name="chevron_right" className="text-[var(--crm-text-dim)]" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function DetailSheet({ workflow, phone, onClose }: { workflow: WorkflowDefinition | null; phone: PhoneSystemRecord | null; onClose: () => void }) {
  const open = Boolean(workflow || phone)
  const ref = useDialogAccessibility<HTMLElement>(open, onClose)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-black/30 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside ref={ref} role="dialog" aria-modal="true" aria-label={workflow ? `${workflow.name} workflow details` : `${phone?.label} phone details`} className="h-full w-full max-w-[560px] overflow-y-auto border-l border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--crm-border)] bg-[var(--crm-surface)]/95 p-5 backdrop-blur">
          <div><p className="crm-eyebrow">{phone ? 'Phone route' : 'Workflow definition'}</p><h2 className="mt-1 text-xl font-black text-[var(--crm-ink)]">{phone?.label || workflow?.name}</h2>{phone ? <p className="mt-1 font-mono text-xs text-[var(--crm-text-muted)]">{phone.number}</p> : null}</div>
          <button type="button" onClick={onClose} aria-label="Close details" className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--crm-border)] text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-subtle)]"><Icon name="close" /></button>
        </div>
        {phone ? <PhoneDetails record={phone} /> : workflow ? <WorkflowDetails workflow={workflow} /> : null}
      </aside>
    </div>
  )
}

function PhoneDetails({ record }: { record: PhoneSystemRecord }) {
  const facts = [
    ['Owner', record.owner], ['Team', record.team], ['Answered', record.answeredPath], ['No answer', record.noAnswerPath], ['SMS', record.smsPath], ['Outbound', record.outboundUse], ['Carrier fallback', record.carrierFallback],
  ]
  return (
    <div className="space-y-6 p-5">
      <div className={`rounded-2xl border p-4 ${record.health === 'healthy' ? 'border-[var(--crm-success)]/25 bg-[var(--crm-success-soft)]' : 'border-[var(--crm-danger)]/25 bg-[var(--crm-danger-soft)]'}`}><div className="flex items-start gap-3"><Icon name={record.health === 'healthy' ? 'verified' : 'error'} className={record.health === 'healthy' ? 'text-[var(--crm-success)]' : 'text-[var(--crm-danger)]'} /><div><p className="font-black text-[var(--crm-ink)]">{record.health === 'healthy' ? 'Route mapped' : 'Decision needed'}</p><p className="mt-1 text-sm leading-6 text-[var(--crm-text-muted)]">{record.healthNote}</p></div></div></div>
      <section><h3 className="text-xs font-black uppercase tracking-[0.14em] text-[var(--crm-text-muted)]">Inbound path</h3><div className="mt-3 space-y-0">{record.inboundPath.map((step, index) => <div key={step} className="flex gap-3"><div className="flex flex-col items-center"><span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-black ${index === 0 ? 'bg-[var(--crm-brand)] text-white' : 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'}`}>{index + 1}</span>{index < record.inboundPath.length - 1 ? <span className="h-7 w-0.5 bg-[var(--crm-border-strong)]" /> : null}</div><p className="pt-1.5 text-sm font-bold text-[var(--crm-ink)]">{step}</p></div>)}</div></section>
      <section className="divide-y divide-[var(--crm-border)] rounded-2xl border border-[var(--crm-border)]">{facts.map(([label, value]) => <div key={label} className="p-4"><p className="text-[10px] font-black uppercase tracking-[0.13em] text-[var(--crm-text-muted)]">{label}</p><p className="mt-1 text-sm leading-6 text-[var(--crm-ink)]">{value}</p></div>)}</section>
      <Link href={`/workflows?section=all&workflow=${record.workflowId}`} className="crm-secondary-button flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-black"><Icon name="account_tree" />Open controlling workflow</Link>
      <section><h3 className="text-xs font-black uppercase tracking-[0.14em] text-[var(--crm-text-muted)]">Implementation sources</h3><div className="mt-2 space-y-2">{record.sourceFiles.map((source) => <code key={source} className="block rounded-lg bg-[var(--crm-surface-subtle)] px-3 py-2 text-xs text-[var(--crm-text-muted)]">{source}</code>)}</div></section>
    </div>
  )
}

function WorkflowDetails({ workflow }: { workflow: WorkflowDefinition }) {
  return (
    <div className="space-y-6 p-5">
      <p className="text-sm leading-6 text-[var(--crm-text-muted)]">{workflow.description}</p>
      <div className="grid grid-cols-2 gap-3">{[['Owner', workflow.owner.displayName], ['Area', workflowCategoryLabel(workflow.category)], ['Status', workflow.status], ['Approval', workflow.implementation.approvalPolicy.replaceAll('_', ' ')]].map(([label, value]) => <div key={label} className="rounded-xl bg-[var(--crm-surface-subtle)] p-3"><p className="text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]">{label}</p><p className="mt-1 text-sm font-black capitalize text-[var(--crm-ink)]">{value}</p></div>)}</div>
      <section><h3 className="text-xs font-black uppercase tracking-[0.14em] text-[var(--crm-text-muted)]">Trigger</h3><div className="mt-2 flex items-center gap-3 rounded-xl border border-[var(--crm-info)]/25 bg-[var(--crm-info-soft)] p-3 text-sm font-bold text-[var(--crm-info)]"><Icon name="bolt" />{triggerLabel(workflow.trigger)}</div></section>
      <section><h3 className="text-xs font-black uppercase tracking-[0.14em] text-[var(--crm-text-muted)]">Action sequence</h3><ol className="mt-3 space-y-3">{workflow.actions.map((action, index) => <li key={`${action.type}-${index}`} className="flex items-start gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--crm-violet-soft)] text-xs font-black text-[var(--crm-violet)]">{index + 1}</span><p className="pt-1 text-sm font-semibold leading-5 text-[var(--crm-ink)]">{actionLabel(action)}</p></li>)}</ol></section>
      <section><h3 className="text-xs font-black uppercase tracking-[0.14em] text-[var(--crm-text-muted)]">Implementation</h3><div className="mt-2 space-y-2">{workflow.implementation.sourceFiles.map((source) => <code key={source} className="block rounded-lg bg-[var(--crm-surface-subtle)] px-3 py-2 text-xs text-[var(--crm-text-muted)]">{source}</code>)}</div>{workflow.implementation.schedule ? <p className="mt-3 text-xs text-[var(--crm-text-muted)]"><strong className="text-[var(--crm-ink)]">Schedule:</strong> {workflow.implementation.schedule}</p> : null}</section>
    </div>
  )
}

function NewWorkflowDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useDialogAccessibility<HTMLElement>(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[130] grid place-items-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="new-workflow-title" className="w-full max-w-lg rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--crm-border)] p-5"><div><p className="crm-eyebrow">Governed creation</p><h2 id="new-workflow-title" className="mt-1 text-xl font-black text-[var(--crm-ink)]">Workflow safety requirements</h2></div><button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--crm-border)]"><Icon name="close" /></button></div>
        <div className="space-y-4 p-5 text-sm leading-6 text-[var(--crm-text-muted)]"><p>New workflows enter this same registry. Before activation they must declare a trigger, owner, action sequence, implementation source, data mutations, approval policy, protected phone identities, and rollback path.</p><div className="rounded-xl border border-[var(--crm-warning)]/25 bg-[var(--crm-warning-soft)] p-4 text-[var(--crm-ink)]"><strong>Publishing is intentionally gated.</strong> Creating or activating a workflow can send communication, move pipeline records, or change routing. The AI Assistant can draft the definition, but a user must approve consequential actions.</div></div>
        <div className="flex justify-end gap-3 border-t border-[var(--crm-border)] p-5"><button type="button" onClick={onClose} className="crm-secondary-button h-10 rounded-lg px-4 text-sm font-black">Close</button><Link href="/ai?prompt=Draft%20a%20new%20SavingKC%20workflow%20definition" className="crm-primary-button inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-black"><Icon name="smart_toy" />Draft with AI</Link></div>
      </section>
    </div>
  )
}

export default function WorkflowsPage() {
  const params = useSearchParams()
  const section = params.get('section') || 'overview'
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowDefinition | null>(null)
  const [selectedPhone, setSelectedPhone] = useState<PhoneSystemRecord | null>(null)
  const [showNew, setShowNew] = useState(false)

  return (
    <main className="h-full overflow-y-auto bg-[var(--crm-canvas)] text-[var(--crm-ink)]">
      <div className="mx-auto w-full max-w-[1480px] space-y-5 px-4 py-6 sm:px-6">
        <SurfaceHeader section={section} onNew={() => setShowNew(true)} />
        {section === 'phones' ? <PhoneSystem onSelect={(record) => { setSelectedPhone(record); setSelectedWorkflow(null) }} /> : section === 'all' ? <WorkflowRegistry onSelect={(workflow) => { setSelectedWorkflow(workflow); setSelectedPhone(null) }} /> : <Overview onSelect={(workflow) => { setSelectedWorkflow(workflow); setSelectedPhone(null) }} />}
      </div>
      <DetailSheet workflow={selectedWorkflow} phone={selectedPhone} onClose={() => { setSelectedWorkflow(null); setSelectedPhone(null) }} />
      <NewWorkflowDialog open={showNew} onClose={() => setShowNew(false)} />
    </main>
  )
}
