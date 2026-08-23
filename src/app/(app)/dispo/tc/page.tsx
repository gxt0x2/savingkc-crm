'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AssignmentPreviewModal } from '@/components/dispo/assignment-preview-modal'
import { DocusealUnavailableNotice, useDocusealAvailability } from '@/components/dispo/docuseal-availability'
import { DispoPageHeader, DispoWorkspaceTabs, NextStepCard } from '@/components/dispo/workspace-ui'
import { TcHandoffStrip } from '@/components/dispo/tc-handoff-strip'
import { Icon } from '@/components/ui/icon'
import { useAuth } from '@/hooks/use-auth'
import {
  activeDispositionPhases,
  dispositionTaskDefinition,
  summarizeDispositionPhase,
  type DispositionOperatingLane,
} from '@/lib/dispo/operating-lifecycle'
import {
  communicationTemplateDepartmentLabel,
  communicationTemplatePhaseLabel,
  unresolvedCommunicationTemplateFields,
  type CommunicationTemplateDepartment,
} from '@/lib/operating-model/communication-template-catalog'
import { cn, formatCurrency } from '@/lib/utils'
import type { BuyerOffer, TcCommunication, TcDraft, TcEvent, TcFile, TcStatus, TcTask } from '@/types/dispo'

const STATUS_TABS: { key: TcStatus | 'all' | 'blocked'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'opening_package_needed', label: 'Needs Opening' },
  { key: 'emd_pending', label: 'EMD Pending' },
  { key: 'title_work', label: 'Title Work' },
  { key: 'clear_to_close', label: 'Clear' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'closed', label: 'Closed' },
  { key: 'blocked', label: 'Blocked' },
]

const STATUS_OPTIONS: TcStatus[] = [
  'not_opened',
  'opening_package_needed',
  'opened',
  'emd_pending',
  'title_work',
  'clear_to_close',
  'scheduled',
  'closed',
  'cancelled',
]

const TASK_ASSIGNEES = ['Dispositions', 'Closing Coordination', 'Shared', 'Ernest', 'Casey', 'Gertha'] as const

const DETAIL_TABS = [
  { key: 'communications', label: 'Communications', icon: 'forum' },
  { key: 'activity', label: 'TC Activity', icon: 'history' },
  { key: 'docs', label: 'Docs', icon: 'description' },
] as const

type DetailTab = (typeof DETAIL_TABS)[number]['key']

type TcPageView = 'files' | 'communications' | 'docs' | 'tasks' | 'reports'

const TC_PAGE_TABS: { key: TcPageView; label: string; href: string; icon: string }[] = [
  { key: 'files', label: 'Files', href: '/dispo/tc', icon: 'fact_check' },
  { key: 'communications', label: 'Messages', href: '/dispo/tc?view=communications', icon: 'forum' },
  { key: 'docs', label: 'Documents', href: '/dispo/tc?view=docs', icon: 'preview' },
  { key: 'tasks', label: 'Work', href: '/dispo/tc?view=tasks', icon: 'task_alt' },
  { key: 'reports', label: 'Results', href: '/dispo/tc?view=reports', icon: 'account_tree' },
]

interface TcFileTimeline {
  communications: TcCommunication[]
  events: TcEvent[]
}

const STATUS_META: Record<TcStatus, { label: string; badge: string; icon: string }> = {
  not_opened: { label: 'Not Opened', badge: 'border-[var(--crm-border-strong)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]', icon: 'draft' },
  opening_package_needed: { label: 'Needs Opening', badge: 'border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]', icon: 'outbox' },
  opened: { label: 'Opened', badge: 'border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] text-[var(--crm-info)]', icon: 'folder_open' },
  emd_pending: { label: 'EMD Pending', badge: 'border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]', icon: 'payments' },
  title_work: { label: 'Title Work', badge: 'border-[var(--crm-violet-border)] bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]', icon: 'policy' },
  clear_to_close: { label: 'Clear to Close', badge: 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]', icon: 'verified' },
  scheduled: { label: 'Scheduled', badge: 'border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] text-[var(--crm-info)]', icon: 'event_available' },
  closed: { label: 'Closed', badge: 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]', icon: 'check_circle' },
  cancelled: { label: 'Cancelled', badge: 'border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]', icon: 'cancel' },
}

const fieldClass = 'w-full rounded-lg border !border-[var(--crm-border-strong)] !bg-[var(--crm-surface)] px-3 py-2 text-sm !text-[var(--crm-ink)] outline-none transition focus:!border-[var(--crm-brand)] focus:ring-2 focus:ring-[var(--crm-brand)]/15 placeholder:!text-[var(--crm-text-dim)]'
const fieldLabelClass = 'text-[11px] font-bold uppercase text-[var(--crm-text-muted)]'
const secondaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-3 py-2 text-sm font-bold text-[var(--crm-text)] transition hover:border-[var(--crm-brand)]/40 hover:bg-[var(--crm-brand-soft)]'

interface TcDocumentTemplate {
  id: string
  slug: string
  title: string
  template_type: 'email' | 'document' | 'checklist'
  audience: 'buyer' | 'seller' | 'title' | 'internal'
  subject: string | null
  body: string
  sort_order?: number
  department: CommunicationTemplateDepartment
  phase_id: string
  task_type: string
  workflow_id: string
  source: 'archive' | 'gmail' | 'archive_and_gmail'
  source_label: string
  catalog: boolean
  system?: boolean
}

function statusLabel(status: string) {
  return STATUS_META[status as TcStatus]?.label ?? status.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

function dateForInput(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toISOString().slice(0, 10)
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function tcClosingDate(file: TcFile) {
  return file.closing_scheduled_at || file.dispo_deal?.close_date || null
}

function communicationIcon(type: string) {
  const map: Record<string, string> = {
    sms: 'sms',
    email: 'mail',
    call: 'call',
    appointment: 'event',
    task: 'task_alt',
    follow_up: 'schedule',
    note: 'sticky_note_2',
  }
  return map[type] ?? 'forum'
}

function communicationLabel(item: TcCommunication) {
  const direction = typeof item.metadata?.direction === 'string' ? item.metadata.direction : ''
  if (item.activity_type === 'sms') return direction === 'received' ? 'Inbound SMS' : 'Outbound SMS'
  if (item.activity_type === 'email') return direction === 'received' ? 'Inbound Email' : 'Outbound Email'
  if (item.activity_type === 'call') return direction === 'received' ? 'Inbound Call' : 'Call'
  return item.title || item.activity_type.replace(/_/g, ' ')
}

function normalizePageView(value: string | null): TcPageView {
  if (value === 'communications' || value === 'docs' || value === 'tasks' || value === 'reports') return value
  return 'files'
}

function riskClass(risk: string) {
  const map: Record<string, string> = {
    normal: 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
    watch: 'border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
    urgent: 'border-[var(--crm-warning)] bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
    blocked: 'border-[var(--crm-brand)]/35 bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
  }
  return map[risk] ?? map.normal
}

function openTaskCount(file: TcFile) {
  return file.tasks?.filter((task) => task.status === 'open' || task.status === 'blocked').length ?? 0
}

function taskStatusClass(status: TcTask['status']) {
  const map: Record<TcTask['status'], string> = {
    open: 'border-[var(--crm-border-strong)] bg-[var(--crm-surface)] text-[var(--crm-text-muted)]',
    done: 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
    waived: 'border-[var(--crm-border)] bg-[var(--crm-canvas)] text-[var(--crm-text-muted)]',
    blocked: 'border-[var(--crm-brand)]/35 bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
  }
  return map[status]
}

function operatingContext(file: TcFile) {
  return {
    dealStage: file.dispo_deal?.stage ?? 'new',
    tcStatus: file.status,
    enteredAt: file.dispo_deal?.entered_at ?? file.created_at,
    closingAt: tcClosingDate(file),
  }
}

function operatingProgress(file: TcFile) {
  const phases = activeDispositionPhases(operatingContext(file))
  const summaries = phases.map((phase) => summarizeDispositionPhase(phase, file.tasks ?? []))
  const total = summaries.reduce((sum, summary) => sum + summary.total, 0)
  const completed = summaries.reduce((sum, summary) => sum + summary.completed, 0)
  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    blocked: summaries.reduce((sum, summary) => sum + summary.blocked, 0),
  }
}

function laneLabel(lane: DispositionOperatingLane) {
  if (lane === 'dispositions') return 'Dispositions'
  if (lane === 'coordination') return 'Closing coordination'
  return 'Shared'
}

function laneClass(lane: DispositionOperatingLane) {
  if (lane === 'dispositions') return 'border-[var(--crm-violet-border)] bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]'
  if (lane === 'coordination') return 'border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] text-[var(--crm-info)]'
  return 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]'
}

function ContactTile({
  icon,
  label,
  name,
  context,
  phone,
  email,
  href,
}: {
  icon: string
  label: string
  name: string
  context?: string | null
  phone?: string | null
  email?: string | null
  href?: string
}) {
  return (
    <div className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-raised)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--crm-danger-soft)] text-[var(--crm-brand)]">
          <Icon name={icon} size="text-sm" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase text-[var(--crm-text-muted)]">{label}</p>
          <p className="truncate text-sm font-bold text-[var(--crm-ink)]">{name}</p>
        </div>
      </div>
      {context && <p className="mb-2 truncate text-xs text-[var(--crm-text-muted)]">{context}</p>}
      <div className="flex flex-wrap gap-2">
        {phone && (
          <a href={`tel:${phone}`} className="inline-flex items-center gap-1 rounded-md border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-2 py-1 text-xs font-bold text-[var(--crm-text-muted)] hover:border-[var(--crm-brand)]/40 hover:bg-[var(--crm-brand-soft)]">
            <Icon name="call" size="text-xs" />
            {phone}
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="inline-flex items-center gap-1 rounded-md border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-2 py-1 text-xs font-bold text-[var(--crm-text-muted)] hover:border-[var(--crm-brand)]/40 hover:bg-[var(--crm-brand-soft)]">
            <Icon name="mail" size="text-xs" />
            Email
          </a>
        )}
        {href && (
          <Link href={href} prefetch={href.startsWith('/leads/') ? false : undefined} className="inline-flex items-center gap-1 rounded-md border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-2 py-1 text-xs font-bold text-[var(--crm-text-muted)] hover:border-[var(--crm-brand)]/40 hover:bg-[var(--crm-brand-soft)]">
            <Icon name="open_in_new" size="text-xs" />
            Open
          </Link>
        )}
      </div>
    </div>
  )
}

function DetailDrawer({
  file,
  templates,
  docuseal,
  onTemplatesChanged,
  onClose,
  onChanged,
}: {
  file: TcFile
  templates: TcDocumentTemplate[]
  docuseal: { enabled: boolean; checking: boolean }
  onTemplatesChanged: () => void
  onClose: () => void
  onChanged: () => void
}) {
  const { user } = useAuth()
  const [status, setStatus] = useState<TcStatus>(file.status)
  const [fileNumber, setFileNumber] = useState(file.file_number ?? '')
  const [nextAction, setNextAction] = useState(file.next_action ?? '')
  const [closingDate, setClosingDate] = useState(dateForInput(file.closing_scheduled_at))
  const [assignmentFee, setAssignmentFee] = useState(file.assignment_fee != null ? String(file.assignment_fee) : '')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<TcDocumentTemplate | 'new' | null>(null)
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>('communications')
  const [communications, setCommunications] = useState<TcCommunication[]>([])
  const [events, setEvents] = useState<TcEvent[]>([])
  const [loadingComms, setLoadingComms] = useState(false)
  const [assignmentPreviewOffer, setAssignmentPreviewOffer] = useState<BuyerOffer | null>(null)
  const [activeDraft, setActiveDraft] = useState<TcDraft | null>(null)
  const [draftSubject, setDraftSubject] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftAction, setDraftAction] = useState<'idle' | 'creating' | 'saving' | 'approving' | 'sending'>('idle')
  const [draftNotice, setDraftNotice] = useState('')
  const [preparingTemplateId, setPreparingTemplateId] = useState<string | null>(null)
  const [templateDraft, setTemplateDraft] = useState({
    title: '',
    template_type: 'email' as TcDocumentTemplate['template_type'],
    audience: 'buyer' as TcDocumentTemplate['audience'],
    subject: '',
    body: '',
  })
  const didMountRef = useRef(false)
  const lastPayloadRef = useRef('')
  const operatingPhases = useMemo(() => activeDispositionPhases(operatingContext(file)), [file])
  const operatingTaskTypes = useMemo(
    () => new Set(operatingPhases.flatMap((phase) => phase.tasks.map((task) => task.taskType))),
    [operatingPhases],
  )
  const taskByType = useMemo(
    () => new Map((file.tasks ?? []).map((task) => [task.task_type, task])),
    [file.tasks],
  )
  const manualTasks = useMemo(
    () => (file.tasks ?? []).filter((task) => !operatingTaskTypes.has(task.task_type)),
    [file.tasks, operatingTaskTypes],
  )
  const nextWork = useMemo(() => {
    for (const phase of operatingPhases) {
      for (const definition of phase.tasks) {
        const task = taskByType.get(definition.taskType)
        if (task?.status === 'blocked' || task?.status === 'open') return { phase, definition, task }
      }
    }
    return null
  }, [operatingPhases, taskByType])
  const templatesByTaskType = useMemo(() => {
    const byTaskType = new Map<string, TcDocumentTemplate[]>()
    for (const template of templates) {
      if (template.template_type !== 'email' || !template.task_type) continue
      const current = byTaskType.get(template.task_type) ?? []
      current.push(template)
      byTaskType.set(template.task_type, current)
    }
    return byTaskType
  }, [templates])
  const unresolvedDraftFields = useMemo(
    () => unresolvedCommunicationTemplateFields(draftSubject, draftBody),
    [draftBody, draftSubject],
  )
  const draftActor = useMemo(() => {
    const email = user?.email?.toLowerCase() ?? ''
    if (email.includes('casey')) return 'Casey'
    if (email.includes('gertha')) return 'Gertha'
    if (email.includes('ernest')) return 'Ernest'
    return user?.email || 'CRM user'
  }, [user?.email])

  useEffect(() => {
    setStatus(file.status)
    setFileNumber(file.file_number ?? '')
    setNextAction(file.next_action ?? '')
    setClosingDate(dateForInput(file.closing_scheduled_at))
    setAssignmentFee(file.assignment_fee != null ? String(file.assignment_fee) : '')
    setSaveState('idle')
    setActiveDraft(null)
    setDraftSubject('')
    setDraftBody('')
    setDraftNotice('')
    setDraftAction('idle')
    setPreparingTemplateId(null)
    didMountRef.current = false
    lastPayloadRef.current = ''
  }, [file.assignment_fee, file.closing_scheduled_at, file.file_number, file.id, file.next_action, file.status])

  useEffect(() => {
    const controller = new AbortController()
    setLoadingComms(true)
    setCommunications([])
    setEvents([])

    async function loadCommunications() {
      try {
        const res = await fetch(`/api/tc/files/${file.id}/communications`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load TC communications')
        setCommunications(data.communications ?? [])
        setEvents(data.events ?? [])
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : 'Failed to load TC communications')
        }
      } finally {
        setLoadingComms(false)
      }
    }

    loadCommunications()
    return () => controller.abort()
  }, [file.id])

  useEffect(() => {
    const payload = JSON.stringify({
      status,
      file_number: fileNumber || null,
      next_action: nextAction || null,
      closing_scheduled_at: closingDate ? new Date(`${closingDate}T12:00:00`).toISOString() : null,
      assignment_fee: assignmentFee ? Number(assignmentFee) : null,
    })

    if (!didMountRef.current) {
      didMountRef.current = true
      lastPayloadRef.current = payload
      return
    }
    if (payload === lastPayloadRef.current) return

    setSaveState('saving')
    setError(null)
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tc/files/${file.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: controller.signal,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Autosave failed')
        lastPayloadRef.current = payload
        setSaveState('saved')
        onChanged()
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setSaveState('error')
        setError(err instanceof Error ? err.message : 'Autosave failed')
      }
    }, 650)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [assignmentFee, closingDate, file.id, fileNumber, nextAction, onChanged, status])

  async function updateTask(task: TcTask, nextStatus: TcTask['status']) {
    setError(null)
    const res = await fetch(`/api/tc/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Task update failed')
      return
    }
    onChanged()
  }

  async function updateTaskAssignee(task: TcTask, assignedTo: string | null) {
    setError(null)
    const res = await fetch(`/api/tc/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_to: assignedTo }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Task assignment failed')
      return
    }
    onChanged()
  }

  async function copyTemplate(template: TcDocumentTemplate) {
    const text = [
      template.subject ? `Subject: ${template.subject}` : '',
      template.body,
    ].filter(Boolean).join('\n\n')
    await navigator.clipboard.writeText(text)
    setCopiedSlug(template.slug)
    setTimeout(() => setCopiedSlug(null), 1600)
  }

  async function prepareTemplate(template: TcDocumentTemplate) {
    if (preparingTemplateId) return
    setError(null)
    setDraftNotice('')
    setPreparingTemplateId(template.id)
    setDraftAction('creating')
    try {
      const response = await fetch('/api/tc/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tc_file_id: file.id,
          template_id: template.id,
          created_by: draftActor,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Draft could not be created.')
      const draft = { ...data.draft, template: data.draft?.template ?? template } as TcDraft
      setActiveDraft(draft)
      setDraftSubject(draft.subject ?? '')
      setDraftBody(draft.edited_body || draft.approved_body || draft.draft_body)
      setDraftNotice(data.existing ? 'Opened the existing pending draft for this file.' : 'Draft created. Review every unresolved field before approval.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Draft could not be created.')
    } finally {
      setDraftAction('idle')
      setPreparingTemplateId(null)
    }
  }

  async function persistDraft(nextStatus?: 'approved') {
    if (!activeDraft || draftAction !== 'idle') return
    setError(null)
    setDraftNotice('')
    setDraftAction(nextStatus === 'approved' ? 'approving' : 'saving')
    try {
      const response = await fetch(`/api/tc/drafts/${activeDraft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: draftSubject || null,
          edited_body: draftBody,
          ...(nextStatus ? { status: nextStatus, approved_by: draftActor } : {}),
          actor: draftActor,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Draft could not be saved.')
      setActiveDraft({ ...data.draft, template: activeDraft.template } as TcDraft)
      setDraftNotice(nextStatus === 'approved' ? 'Draft approved. Sending still requires a separate confirmation.' : 'Draft saved.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Draft could not be saved.')
    } finally {
      setDraftAction('idle')
    }
  }

  async function sendApprovedDraft() {
    if (!activeDraft || activeDraft.status !== 'approved' || draftAction !== 'idle') return
    const destination = activeDraft.recipient_email || activeDraft.recipient_phone || activeDraft.recipient_role
    if (!window.confirm(`Send this approved ${activeDraft.channel} to ${destination}? This action is recorded and cannot be undone.`)) return
    setError(null)
    setDraftNotice('')
    setDraftAction('sending')
    try {
      const response = await fetch(`/api/tc/drafts/${activeDraft.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_send: true, actor: draftActor }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Approved draft could not be sent.')
      setActiveDraft({ ...data.draft, template: activeDraft.template } as TcDraft)
      setDraftNotice('Message sent and recorded on the transaction file.')
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approved draft could not be sent.')
    } finally {
      setDraftAction('idle')
    }
  }

  function startEditTemplate(template: TcDocumentTemplate | 'new') {
    if (template !== 'new' && template.system) {
      setError('Governed workflow templates are version-controlled. Create a custom template instead of changing the approved standard in place.')
      return
    }
    setEditingTemplate(template)
    if (template === 'new') {
      setTemplateDraft({
        title: '',
        template_type: 'email',
        audience: 'buyer',
        subject: '',
        body: '',
      })
    } else {
      setTemplateDraft({
        title: template.title,
        template_type: template.template_type,
        audience: template.audience,
        subject: template.subject ?? '',
        body: template.body,
      })
    }
  }

  async function saveTemplate() {
    const isNew = editingTemplate === 'new'
    const url = isNew ? '/api/tc/document-templates' : `/api/tc/document-templates/${editingTemplate?.id}`
    const res = await fetch(url, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...templateDraft,
        subject: templateDraft.subject || null,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to save template')
      return
    }
    setEditingTemplate(null)
    onTemplatesChanged()
  }

  async function deleteTemplate(template: TcDocumentTemplate) {
    if (template.system) {
      setError('Governed workflow templates cannot be deleted from an active file.')
      return
    }
    const res = await fetch(`/api/tc/document-templates/${template.id}`, { method: 'DELETE' })
    if (res.ok) onTemplatesChanged()
  }

  function startAssignmentPreview() {
    if (!docuseal.enabled || !file.offer) return
    setAssignmentPreviewOffer({
      ...file.offer,
      lead: {
        id: file.lead_id,
        full_name: file.lead?.full_name ?? '',
        property_address: file.lead?.property_address ?? '',
      },
    } as BuyerOffer)
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--crm-ink)]/35 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-6 py-5">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-black', STATUS_META[file.status].badge)}>
                <Icon name={STATUS_META[file.status].icon} size="text-sm" />
                {statusLabel(file.status)}
              </span>
              <span className={cn('inline-flex rounded-full border px-2 py-1 text-[11px] font-black uppercase', riskClass(file.risk_level))}>
                {file.risk_level}
              </span>
            </div>
            <h2 className="truncate text-xl font-black text-[var(--crm-ink)]">{file.lead?.property_address || 'TC File'}</h2>
            <p className="mt-1 text-sm text-[var(--crm-text-muted)]">
              {file.lead?.full_name || 'No seller'} · {file.offer?.buyer?.name || file.offer?.buyer?.company || 'No buyer'}
            </p>
            <p className="mt-2 text-[11px] font-bold uppercase text-[var(--crm-text-muted)]">
              {saveState === 'saving' ? 'Autosaving' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Autosave failed' : 'Instant autosave'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] p-2 text-[var(--crm-text-muted)] hover:bg-[var(--crm-brand-soft)]" aria-label="Close TC file">
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {error && <div className="rounded-lg border border-[var(--crm-brand)]/35 bg-[var(--crm-danger-soft)] px-3 py-2 text-sm font-semibold text-[var(--crm-danger)]">{error}</div>}

          <NextStepCard
            title={nextWork?.definition.label || 'All required work is complete'}
            detail={nextWork ? `${nextWork.phase.label} · ${laneLabel(nextWork.definition.lane)}${nextWork.task.due_at ? ` · Due ${formatDate(nextWork.task.due_at)}` : ''}` : 'Review the file, confirm closing, and complete the closeout.'}
            blocked={nextWork?.task.status === 'blocked'}
            complete={!nextWork}
            actionLabel={nextWork ? (nextWork.task.status === 'blocked' ? 'Resolve block' : 'Mark done') : undefined}
            onAction={nextWork ? () => updateTask(nextWork.task, nextWork.task.status === 'blocked' ? 'open' : 'done') : undefined}
          />

          {activeDraft && (
            <section className="overflow-hidden rounded-xl border border-[var(--crm-violet-border)] bg-[var(--crm-surface)] shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--crm-border)] bg-[var(--crm-violet-soft)] px-4 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon name="edit_note" size="text-base" className="text-[var(--crm-violet)]" />
                    <h3 className="text-sm font-black text-[var(--crm-ink)]">{activeDraft.template?.title || 'Communication draft'}</h3>
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-black uppercase',
                      activeDraft.status === 'sent' ? 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : activeDraft.status === 'approved' ? 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' : 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
                    )}>{activeDraft.status}</span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-[var(--crm-text-muted)]">
                    {activeDraft.recipient_role} · {activeDraft.recipient_email || activeDraft.recipient_phone || 'recipient not yet available'}
                  </p>
                </div>
                <button type="button" onClick={() => setActiveDraft(null)} className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] text-[var(--crm-text-muted)]" aria-label="Close draft review"><Icon name="close" size="text-sm" /></button>
              </div>

              <div className="space-y-3 p-4">
                {draftNotice ? <div className="rounded-lg border border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-info)]">{draftNotice}</div> : null}
                {!activeDraft.recipient_email && activeDraft.channel === 'email' ? (
                  <div className="rounded-lg border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-warning)]">Add the {activeDraft.recipient_role}&apos;s email address before sending.</div>
                ) : null}
                {unresolvedDraftFields.length > 0 ? (
                  <div className="rounded-lg border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-3 py-2 text-xs text-[var(--crm-warning)]">
                    <strong>{unresolvedDraftFields.length} fields still require human input:</strong> {unresolvedDraftFields.join(', ')}
                  </div>
                ) : (
                  <div className="rounded-lg border border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-success)]">All merge fields have been resolved. Read the complete message before approval.</div>
                )}

                <label className="block space-y-1">
                  <span className={fieldLabelClass}>Subject</span>
                  <input value={draftSubject} onChange={(event) => setDraftSubject(event.target.value)} disabled={activeDraft.status !== 'pending'} className={cn(fieldClass, 'disabled:bg-[var(--crm-canvas)] disabled:text-[var(--crm-text-muted)]')} />
                </label>
                <label className="block space-y-1">
                  <span className={fieldLabelClass}>Message</span>
                  <textarea value={draftBody} onChange={(event) => setDraftBody(event.target.value)} disabled={activeDraft.status !== 'pending'} rows={15} className={cn(fieldClass, 'resize-y leading-6 disabled:bg-[var(--crm-canvas)] disabled:text-[var(--crm-text-muted)]')} />
                </label>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--crm-border)] pt-3">
                  <p className="max-w-sm text-[11px] leading-5 text-[var(--crm-text-muted)]">Creating a draft never sends it. Approval locks the reviewed body; sending requires a second explicit confirmation.</p>
                  <div className="flex flex-wrap gap-2">
                    {activeDraft.status === 'pending' ? (
                      <>
                        <button type="button" onClick={() => persistDraft()} disabled={draftAction !== 'idle'} className={secondaryButtonClass}><Icon name="save" size="text-sm" />{draftAction === 'saving' ? 'Saving…' : 'Save'}</button>
                        <button type="button" onClick={() => persistDraft('approved')} disabled={draftAction !== 'idle' || unresolvedDraftFields.length > 0 || !draftBody.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--crm-info)] px-3 py-2 text-sm font-black text-[var(--crm-on-brand)] transition hover:bg-[var(--crm-info)] disabled:cursor-not-allowed disabled:opacity-45"><Icon name="verified" size="text-sm" />{draftAction === 'approving' ? 'Approving…' : 'Approve'}</button>
                      </>
                    ) : null}
                    {activeDraft.status === 'approved' ? (
                      <button type="button" onClick={sendApprovedDraft} disabled={draftAction !== 'idle' || (activeDraft.channel === 'email' && !activeDraft.recipient_email)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--crm-brand)] px-3 py-2 text-sm font-black text-[var(--crm-on-brand)] transition hover:bg-[var(--crm-brand-hover)] disabled:cursor-not-allowed disabled:opacity-45"><Icon name="send" size="text-sm" />{draftAction === 'sending' ? 'Sending…' : 'Confirm & send'}</button>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          )}

          <details className="group overflow-hidden rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)]">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 marker:content-none">
              <Icon name="tune" size="text-base" className="text-[var(--crm-brand)]" />
              <span className="flex-1 text-sm font-black text-[var(--crm-ink)]">File details</span>
              <span className="text-xs font-semibold text-[var(--crm-text-muted)]">Status, dates, fee</span>
              <Icon name="expand_more" size="text-lg" className="text-[var(--crm-text-muted)] transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-[var(--crm-border)] p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className={fieldLabelClass}>Status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value as TcStatus)} className={fieldClass} style={{ colorScheme: 'light' }}>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className={fieldLabelClass}>File Number</span>
                <input value={fileNumber} onChange={(e) => setFileNumber(e.target.value)} className={fieldClass} />
              </label>
              <label className="space-y-1">
                <span className={fieldLabelClass}>Closing Date</span>
                <input type="date" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} className={fieldClass} style={{ colorScheme: 'light' }} />
              </label>
              <label className="space-y-1">
                <span className={fieldLabelClass}>Assignment Fee</span>
                <input type="number" value={assignmentFee} onChange={(e) => setAssignmentFee(e.target.value)} className={fieldClass} />
              </label>
              </div>

              <label className="mt-3 block space-y-1">
                <span className={fieldLabelClass}>Next Action</span>
                <textarea value={nextAction} onChange={(e) => setNextAction(e.target.value)} rows={3} className={cn(fieldClass, 'resize-none')} />
              </label>

              <div className="mt-4 flex flex-wrap gap-2">
                {file.lead_id && (
                  <Link href={`/leads/${file.lead_id}`} prefetch={false} className={secondaryButtonClass}>
                    <Icon name="person" size="text-sm" /> Lead
                  </Link>
                )}
                {file.offer?.assignment_document_url && (
                  <a href={file.offer.assignment_document_url} target="_blank" rel="noreferrer" className={secondaryButtonClass}>
                    <Icon name="description" size="text-sm" /> Assignment
                  </a>
                )}
              </div>
            </div>
          </details>

          <section className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon name="contacts" size="text-base" className="text-[var(--crm-brand)]" />
                <h3 className="text-sm font-black text-[var(--crm-ink)]">Shared Contacts</h3>
              </div>
              <Link href="/dispo/contacts" className="text-xs font-bold text-[var(--crm-brand)] hover:text-[var(--crm-brand-hover)]">
                Directory
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <ContactTile
                icon="person"
                label="Seller"
                name={file.lead?.full_name || 'No seller assigned'}
                context={file.lead?.property_address}
                phone={file.lead?.phone}
                email={file.lead?.email}
                href={file.lead_id ? `/leads/${file.lead_id}` : undefined}
              />
              <ContactTile
                icon="groups"
                label="Buyer"
                name={file.offer?.buyer?.name || file.offer?.buyer?.company || 'No buyer assigned'}
                context={file.offer?.buyer?.company}
                phone={file.offer?.buyer?.phone}
                email={file.offer?.buyer?.email}
                href="/dispo/contacts?tab=buyers"
              />
              <ContactTile
                icon="store"
                label="Title / Vendor"
                name={file.title_contact?.name || file.title_company?.name || 'Not assigned'}
                context={file.title_company?.name || file.title_contact?.role}
                phone={file.title_contact?.phone || file.title_company?.office_phone}
                email={file.title_contact?.email || file.title_company?.office_email}
                href="/dispo/contacts?tab=vendors"
              />
            </div>
          </section>

          <section className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon name="forum" size="text-base" className="text-[var(--crm-brand)]" />
                <h3 className="text-sm font-black text-[var(--crm-ink)]">Communications & Docs</h3>
              </div>
              <span className="text-xs font-bold text-[var(--crm-text-muted)]">Lead + TC file history</span>
            </div>

            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {DETAIL_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveDetailTab(tab.key)}
                  className={cn(
                    'inline-flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-black transition-colors',
                    activeDetailTab === tab.key
                      ? 'border-[var(--crm-brand)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]'
                      : 'border-[var(--crm-border-strong)] bg-[var(--crm-surface)] text-[var(--crm-text-muted)] hover:border-[var(--crm-brand)]/40 hover:bg-[var(--crm-brand-soft)]'
                  )}
                >
                  <Icon name={tab.icon} size="text-sm" />
                  {tab.label}
                </button>
              ))}
            </div>

            {activeDetailTab === 'communications' && (
              <div className="space-y-2">
                {loadingComms ? (
                  <div className="rounded-lg border border-dashed border-[var(--crm-border-strong)] bg-[var(--crm-surface-raised)] px-4 py-8 text-center text-sm font-semibold text-[var(--crm-text-muted)]">
                    Loading communications...
                  </div>
                ) : communications.length > 0 ? (
                  communications.map((item) => (
                    <div key={item.id} className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-raised)] p-3">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--crm-danger-soft)] text-[var(--crm-brand)]">
                            <Icon name={communicationIcon(item.activity_type)} size="text-sm" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold capitalize text-[var(--crm-ink)]">{communicationLabel(item)}</p>
                            <p className="text-[11px] font-semibold text-[var(--crm-text-muted)]">
                              {formatDateTime(item.created_at)}{item.agent ? ` · ${item.agent}` : ''}
                            </p>
                          </div>
                        </div>
                      </div>
                      {item.description && <p className="whitespace-pre-wrap text-sm text-[var(--crm-text-muted)]">{item.description}</p>}
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-[var(--crm-border-strong)] bg-[var(--crm-surface-raised)] px-4 py-8 text-center text-sm font-semibold text-[var(--crm-text-muted)]">
                    No TC-related lead communications found yet.
                  </div>
                )}
              </div>
            )}

            {activeDetailTab === 'activity' && (
              <div className="space-y-2">
                {loadingComms ? (
                  <div className="rounded-lg border border-dashed border-[var(--crm-border-strong)] bg-[var(--crm-surface-raised)] px-4 py-8 text-center text-sm font-semibold text-[var(--crm-text-muted)]">
                    Loading TC activity...
                  </div>
                ) : events.length > 0 ? (
                  events.map((event) => (
                    <div key={event.id} className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-raised)] p-3">
                      <div className="flex items-start gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]">
                          <Icon name="history" size="text-sm" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-[var(--crm-ink)]">{event.event_type.replace(/_/g, ' ')}</p>
                          <p className="text-[11px] font-semibold text-[var(--crm-text-muted)]">
                            {formatDateTime(event.created_at)}{event.actor ? ` · ${event.actor}` : ''}
                          </p>
                          {event.payload && Object.keys(event.payload).length > 0 && (
                            <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-[var(--crm-surface-subtle)] p-2 text-[11px] text-[var(--crm-text-muted)]">
                              {JSON.stringify(event.payload, null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-[var(--crm-border-strong)] bg-[var(--crm-surface-raised)] px-4 py-8 text-center text-sm font-semibold text-[var(--crm-text-muted)]">
                    No TC activity has been logged for this file yet.
                  </div>
                )}
              </div>
            )}

            {activeDetailTab === 'docs' && (
              <div className="space-y-3">
                <div className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-raised)] p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-[var(--crm-ink)]">Assignment Contract</p>
                      <p className="text-xs font-semibold text-[var(--crm-text-muted)]">
                        {docuseal.enabled
                          ? 'Review signed docs or launch the DocuSeal iframe preview from the TC file.'
                          : 'Review existing signed docs. New DocuSeal assignments are temporarily unavailable.'}
                      </p>
                    </div>
                    {file.offer?.assignment_document_url ? (
                      <a href={file.offer.assignment_document_url} target="_blank" rel="noreferrer" className={secondaryButtonClass}>
                        <Icon name="open_in_new" size="text-sm" />
                        Full View
                      </a>
                    ) : file.buyer_offer_id && docuseal.enabled ? (
                      <button type="button" onClick={startAssignmentPreview} className={secondaryButtonClass}>
                        <Icon name="preview" size="text-sm" />
                        Preview Assignment
                      </button>
                    ) : file.buyer_offer_id ? (
                      <DocusealUnavailableNotice checking={docuseal.checking} />
                    ) : null}
                  </div>

                  {file.offer?.assignment_document_url ? (
                    <div className="h-[520px] overflow-hidden rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-surface)]">
                      <iframe
                        src={file.offer.assignment_document_url}
                        title="Assignment document"
                        className="h-full w-full border-0"
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-4 py-8 text-center text-sm font-semibold text-[var(--crm-text-muted)]">
                      No signed assignment document is attached yet.
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Icon name="account_tree" size="text-base" className="text-[var(--crm-brand)]" />
                  <h3 className="text-sm font-black text-[var(--crm-ink)]">Operating workflow</h3>
                </div>
                <p className="mt-1 text-xs font-semibold text-[var(--crm-text-muted)]">One transaction record with Dispositions, Closing Coordination, and shared gates.</p>
              </div>
              <span className="rounded-full border border-[var(--crm-border-strong)] bg-[var(--crm-surface-subtle)] px-2.5 py-1 text-xs font-black text-[var(--crm-text-muted)]">{openTaskCount(file)} open</span>
            </div>

            <div className="space-y-3">
              {operatingPhases.map((phase, index) => {
                const summary = summarizeDispositionPhase(phase, file.tasks ?? [])
                const phaseTasks = phase.tasks.map((definition) => ({
                  definition,
                  task: taskByType.get(definition.taskType),
                }))

                return (
                  <details key={phase.id} open={!summary.gateComplete || index === operatingPhases.length - 1} className="group overflow-hidden rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-raised)]">
                    <summary className="cursor-pointer list-none px-4 py-3 marker:content-none">
                      <div className="flex items-center gap-3">
                        <span className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black',
                          summary.gateComplete ? 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : summary.blocked > 0 ? 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]',
                        )}>
                          {summary.gateComplete ? <Icon name="check" size="text-base" /> : index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-black text-[var(--crm-ink)]">{phase.label}</span>
                            {summary.gateComplete && <span className="rounded-full bg-[var(--crm-success-soft)] px-2 py-0.5 text-[10px] font-black uppercase text-[var(--crm-success)]">Gate clear</span>}
                            {summary.blocked > 0 && <span className="rounded-full bg-[var(--crm-danger-soft)] px-2 py-0.5 text-[10px] font-black uppercase text-[var(--crm-danger)]">{summary.blocked} blocked</span>}
                          </span>
                          <span className="mt-0.5 block text-xs font-semibold text-[var(--crm-text-muted)]">{phase.description}</span>
                        </span>
                        <span className="text-right">
                          <span className="block text-sm font-black text-[var(--crm-ink)]">{summary.percent}%</span>
                          <span className="block text-[10px] font-bold text-[var(--crm-text-muted)]">{summary.completed}/{summary.total}</span>
                        </span>
                        <Icon name="expand_more" size="text-lg" className="text-[var(--crm-text-muted)] transition group-open:rotate-180" />
                      </div>
                      <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-[var(--crm-border)]">
                        <span className="block h-full rounded-full bg-[var(--crm-brand)] transition-all" style={{ width: `${summary.percent}%` }} />
                      </span>
                    </summary>

                    <div className="space-y-2 border-t border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
                      <p className="rounded-lg bg-[var(--crm-surface-subtle)] px-3 py-2 text-xs font-bold text-[var(--crm-text-muted)]">
                        Gate: {phase.completionGate}
                      </p>
                      {phaseTasks.map(({ definition, task }) => (
                        <div key={definition.taskType} className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-raised)] p-3">
                          <div className="flex items-start gap-3">
                            {task ? (
                              <button
                                type="button"
                                onClick={() => updateTask(task, task.status === 'done' ? 'open' : 'done')}
                                className={cn(
                                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition',
                                  task.status === 'done' ? 'border-[var(--crm-success)] bg-[var(--crm-success)] text-[var(--crm-surface)]' : 'border-[var(--crm-border-strong)] bg-[var(--crm-surface)] text-[var(--crm-text-muted)] hover:border-[var(--crm-brand)]/40',
                                )}
                                aria-label={task.status === 'done' ? `Reopen ${task.label}` : `Complete ${task.label}`}
                              >
                                <Icon name={task.status === 'done' ? 'check' : task.status === 'blocked' ? 'block' : 'radio_button_unchecked'} size="text-sm" />
                              </button>
                            ) : (
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--crm-border-strong)] bg-[var(--crm-surface)] text-[var(--crm-text-dim)]">
                                <Icon name="sync" size="text-sm" />
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className={cn('text-sm font-bold', task?.status === 'done' ? 'text-[var(--crm-text-dim)] line-through' : 'text-[var(--crm-text)]')}>{definition.label}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black', laneClass(definition.lane))}>{laneLabel(definition.lane)}</span>
                                <span className="rounded-full border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-2 py-0.5 text-[10px] font-black text-[var(--crm-text-muted)]">Evidence: {definition.evidence}</span>
                                {definition.gate && <span className="rounded-full border border-[var(--crm-warning-border)] bg-[var(--crm-warning-soft)] px-2 py-0.5 text-[10px] font-black text-[var(--crm-warning)]">Required gate</span>}
                                {task?.due_at && <span className="text-[10px] font-bold text-[var(--crm-text-muted)]">Due {formatDate(task.due_at)}</span>}
                              </div>
                            </div>
                            {task && (
                              <div className="flex shrink-0 flex-col items-end gap-1.5">
                                <span className={cn('rounded-full border px-2 py-1 text-[10px] font-black uppercase', taskStatusClass(task.status))}>{task.status}</span>
                                <select
                                  value={task.assigned_to ?? ''}
                                  onChange={(event) => updateTaskAssignee(task, event.target.value || null)}
                                  onClick={(event) => event.stopPropagation()}
                                  className="max-w-[160px] rounded-md border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-2 py-1 text-[10px] font-bold text-[var(--crm-text-muted)]"
                                  aria-label={`Assign ${task.label}`}
                                >
                                  <option value="">Unassigned</option>
                                  {TASK_ASSIGNEES.map((assignee) => <option key={assignee} value={assignee}>{assignee}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                          {task && task.status !== 'done' && (
                            <div className="mt-2 flex justify-end gap-2 border-t border-[var(--crm-border)] pt-2">
                              {task.status === 'blocked' ? (
                                <button type="button" onClick={() => updateTask(task, 'open')} className="text-[11px] font-black text-[var(--crm-info)] hover:underline">Resolve block</button>
                              ) : (
                                <button type="button" onClick={() => updateTask(task, 'blocked')} className="text-[11px] font-black text-[var(--crm-danger)] hover:underline">Mark blocked</button>
                              )}
                              {!definition.gate && task.status !== 'waived' && (
                                <button type="button" onClick={() => updateTask(task, 'waived')} className="text-[11px] font-black text-[var(--crm-text-muted)] hover:underline">Waive</button>
                              )}
                            </div>
                          )}
                          {(templatesByTaskType.get(definition.taskType)?.length ?? 0) > 0 ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--crm-border)] pt-2">
                              <span className="mr-auto text-[10px] font-black uppercase tracking-[0.1em] text-[var(--crm-text-muted)]">Linked communication</span>
                              {(templatesByTaskType.get(definition.taskType) ?? []).map((template) => (
                                  <button key={template.id} type="button" onClick={() => prepareTemplate(template)} disabled={Boolean(preparingTemplateId)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--crm-violet-border)] bg-[var(--crm-violet-soft)] px-2.5 py-1.5 text-[11px] font-black text-[var(--crm-violet)] transition hover:bg-[var(--crm-violet-soft)] disabled:opacity-50">
                                    <Icon name="mail" size="text-sm" />
                                    {preparingTemplateId === template.id ? 'Preparing…' : `Prepare ${template.audience} email`}
                                  </button>
                                ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </details>
                )
              })}

              {operatingPhases.length === 0 && (
                <div className="rounded-lg border border-dashed border-[var(--crm-border-strong)] bg-[var(--crm-surface-raised)] px-4 py-8 text-center text-sm font-semibold text-[var(--crm-text-muted)]">
                  This transaction is cancelled or no longer in the active operating workflow.
                </div>
              )}
            </div>

            {manualTasks.length > 0 && (
              <details className="mt-4 overflow-hidden rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-raised)]">
                <summary className="cursor-pointer px-4 py-3 text-sm font-black text-[var(--crm-text)]">Existing manual tasks ({manualTasks.length})</summary>
                <div className="space-y-2 border-t border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
                  {manualTasks.map((task) => (
                    <div key={task.id} className="flex items-center gap-3 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-raised)] px-3 py-2">
                      <button
                        type="button"
                        onClick={() => updateTask(task, task.status === 'done' ? 'open' : 'done')}
                        className={cn('flex h-8 w-8 items-center justify-center rounded-lg border', task.status === 'done' ? 'border-[var(--crm-success)] bg-[var(--crm-success)] text-[var(--crm-on-brand)]' : 'border-[var(--crm-border-strong)] bg-[var(--crm-surface)] text-[var(--crm-text-muted)]')}
                        aria-label={task.status === 'done' ? `Reopen ${task.label}` : `Complete ${task.label}`}
                      >
                        <Icon name={task.status === 'done' ? 'check' : 'radio_button_unchecked'} size="text-sm" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[var(--crm-text)]">{task.label}</p>
                        {task.due_at && <p className="text-xs text-[var(--crm-text-muted)]">Due {formatDate(task.due_at)}</p>}
                      </div>
                      <span className={cn('rounded-full border px-2 py-1 text-[10px] font-black uppercase', taskStatusClass(task.status))}>{task.status}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>

          <section className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon name="article" size="text-base" className="text-[var(--crm-brand)]" />
                <h3 className="text-sm font-black text-[var(--crm-ink)]">Templates</h3>
              </div>
              <button onClick={() => startEditTemplate('new')} className={secondaryButtonClass}>
                <Icon name="add" size="text-sm" />
                New
              </button>
            </div>

            {editingTemplate && (
              <div className="mb-3 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    value={templateDraft.title}
                    onChange={(e) => setTemplateDraft((d) => ({ ...d, title: e.target.value }))}
                    placeholder="Template title"
                    className={cn(fieldClass, 'sm:col-span-2')}
                  />
                  <select
                    value={templateDraft.template_type}
                    onChange={(e) => setTemplateDraft((d) => ({ ...d, template_type: e.target.value as TcDocumentTemplate['template_type'] }))}
                    className={fieldClass}
                    style={{ colorScheme: 'light' }}
                  >
                    <option value="email">Email</option>
                    <option value="document">Document</option>
                    <option value="checklist">Checklist</option>
                  </select>
                  <select
                    value={templateDraft.audience}
                    onChange={(e) => setTemplateDraft((d) => ({ ...d, audience: e.target.value as TcDocumentTemplate['audience'] }))}
                    className={fieldClass}
                    style={{ colorScheme: 'light' }}
                  >
                    <option value="buyer">Buyer</option>
                    <option value="seller">Seller</option>
                    <option value="title">Title</option>
                    <option value="internal">Internal</option>
                  </select>
                  <input
                    value={templateDraft.subject}
                    onChange={(e) => setTemplateDraft((d) => ({ ...d, subject: e.target.value }))}
                    placeholder="Email subject"
                    className={cn(fieldClass, 'sm:col-span-2')}
                  />
                  <textarea
                    value={templateDraft.body}
                    onChange={(e) => setTemplateDraft((d) => ({ ...d, body: e.target.value }))}
                    rows={8}
                    placeholder="Template body"
                    className={cn(fieldClass, 'resize-y sm:col-span-2')}
                  />
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => setEditingTemplate(null)} className="rounded-lg px-3 py-2 text-xs font-bold text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-subtle)]">Cancel</button>
                  <button onClick={saveTemplate} className="inline-flex items-center gap-2 rounded-lg bg-[var(--crm-brand)] px-3 py-2 text-xs font-bold text-[var(--crm-surface)] hover:bg-[var(--crm-brand-hover)]">
                    <Icon name="save" size="text-sm" />
                    Save Template
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {templates.map((template) => (
                <div key={template.id} className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-raised)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[220px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-[var(--crm-ink)]">{template.title}</p>
                        {template.system ? <span className="rounded-full bg-[var(--crm-success-soft)] px-2 py-0.5 text-[9px] font-black uppercase text-[var(--crm-success)]">Governed</span> : <span className="rounded-full bg-[var(--crm-surface-subtle)] px-2 py-0.5 text-[9px] font-black uppercase text-[var(--crm-text-muted)]">Custom</span>}
                      </div>
                      <p className="mt-0.5 text-[11px] font-bold uppercase text-[var(--crm-text-muted)]">{template.audience} · {communicationTemplateDepartmentLabel(template.department)} · {communicationTemplatePhaseLabel(template.phase_id)}</p>
                      {template.subject && <p className="mt-2 truncate text-xs text-[var(--crm-text-muted)]">{template.subject}</p>}
                      <p className="mt-1 text-[10px] font-semibold text-[var(--crm-text-dim)]">{template.source_label}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {template.template_type === 'email' ? (
                        <button onClick={() => prepareTemplate(template)} disabled={Boolean(preparingTemplateId)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--crm-violet)] px-3 py-2 text-sm font-bold text-[var(--crm-on-brand)] transition hover:bg-[var(--crm-violet)] disabled:opacity-50">
                          <Icon name="edit_note" size="text-sm" />
                          {preparingTemplateId === template.id ? 'Preparing…' : 'Prepare draft'}
                        </button>
                      ) : null}
                      <button onClick={() => copyTemplate(template)} className={secondaryButtonClass}>
                        <Icon name={copiedSlug === template.slug ? 'check' : 'content_copy'} size="text-sm" />
                        {copiedSlug === template.slug ? 'Copied' : 'Copy'}
                      </button>
                      {!template.system ? (
                        <>
                          <button onClick={() => startEditTemplate(template)} className={secondaryButtonClass}><Icon name="edit" size="text-sm" />Edit</button>
                          <button onClick={() => deleteTemplate(template)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--crm-brand)]/35 bg-[var(--crm-danger-soft)] px-3 py-2 text-sm font-bold text-[var(--crm-danger)] transition hover:bg-[var(--crm-danger-soft)]"><Icon name="delete" size="text-sm" />Delete</button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
              {templates.length === 0 && (
                <div className="rounded-lg border border-dashed border-[var(--crm-border-strong)] bg-[var(--crm-surface-raised)] px-4 py-8 text-center text-sm font-semibold text-[var(--crm-text-muted)]">
                  No templates yet.
                </div>
              )}
            </div>
          </section>
        </div>
      </aside>
    </div>
    {assignmentPreviewOffer && docuseal.enabled && (
      <AssignmentPreviewModal
        offer={assignmentPreviewOffer}
        onClose={() => setAssignmentPreviewOffer(null)}
        onSent={() => {
          setAssignmentPreviewOffer(null)
          onChanged()
        }}
      />
    )}
    </>
  )
}

export default function TransactionCoordinatorPage() {
  const searchParams = useSearchParams()
  const pageView = normalizePageView(searchParams.get('view'))
  const docuseal = useDocusealAvailability()
  const [files, setFiles] = useState<TcFile[]>([])
  const [activeTab, setActiveTab] = useState<TcStatus | 'all' | 'blocked'>('all')
  const [selected, setSelected] = useState<TcFile | null>(null)
  const [templates, setTemplates] = useState<TcDocumentTemplate[]>([])
  const [timelineByFile, setTimelineByFile] = useState<Record<string, TcFileTimeline>>({})
  const [loadingTimeline, setLoadingTimeline] = useState(false)
  const [assignmentPreviewOffer, setAssignmentPreviewOffer] = useState<BuyerOffer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [taskLane, setTaskLane] = useState<'all' | DispositionOperatingLane>('all')
  const [taskState, setTaskState] = useState<'active' | 'all' | TcTask['status']>('active')

  async function fetchFiles() {
    setError(null)
    if (files.length === 0) setLoading(true)
    try {
      const res = await fetch('/api/tc/files?limit=200')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load TC files')
      setFiles(data.files ?? [])
      if (selected) {
        const fresh = (data.files ?? []).find((file: TcFile) => file.id === selected.id)
        setSelected(fresh ?? null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load TC files')
    } finally {
      setLoading(false)
    }
  }

  async function fetchTemplates() {
    const res = await fetch('/api/tc/document-templates')
    if (!res.ok) return
    const data = await res.json()
    setTemplates(data.templates ?? [])
  }

  useEffect(() => {
    fetchFiles()
    fetchTemplates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (pageView !== 'communications') return
    if (files.length === 0) {
      setTimelineByFile({})
      return
    }

    const controller = new AbortController()
    setLoadingTimeline(true)

    async function fetchTimeline() {
      try {
        const entries = await Promise.all(
          files.map(async (file) => {
            const res = await fetch(`/api/tc/files/${file.id}/communications`, {
              cache: 'no-store',
              signal: controller.signal,
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to load TC communications')
            return [file.id, {
              communications: data.communications ?? [],
              events: data.events ?? [],
            }] as const
          })
        )
        setTimelineByFile(Object.fromEntries(entries))
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : 'Failed to load TC communications')
        }
      } finally {
        setLoadingTimeline(false)
      }
    }

    fetchTimeline()
    return () => controller.abort()
  }, [files, pageView])

  const filtered = useMemo(() => {
    if (activeTab === 'all') return files
    if (activeTab === 'blocked') return files.filter((file) => file.risk_level === 'blocked')
    return files.filter((file) => file.status === activeTab)
  }, [activeTab, files])

  const stats = useMemo(() => ({
    open: files.filter((file) => file.status !== 'closed' && file.status !== 'cancelled').length,
    blocked: files.filter((file) => file.risk_level === 'blocked').length,
    scheduled: files.filter((file) => file.status === 'scheduled').length,
    fees: files.reduce((sum, file) => sum + (file.assignment_fee ?? 0), 0),
  }), [files])

  const pageCommunications = useMemo(() => (
    files.flatMap((file) => (timelineByFile[file.id]?.communications ?? []).map((item) => ({ file, item })))
      .sort((a, b) => new Date(b.item.created_at).getTime() - new Date(a.item.created_at).getTime())
  ), [files, timelineByFile])

  const pageEvents = useMemo(() => (
    files.flatMap((file) => (timelineByFile[file.id]?.events ?? []).map((event) => ({ file, event })))
      .sort((a, b) => new Date(b.event.created_at).getTime() - new Date(a.event.created_at).getTime())
  ), [files, timelineByFile])

  const pageTasks = useMemo(() => (
    files.flatMap((file) => (file.tasks ?? []).map((task) => ({ file, task })))
      .sort((a, b) => {
        const aTime = a.task.due_at ? new Date(a.task.due_at).getTime() : Number.MAX_SAFE_INTEGER
        const bTime = b.task.due_at ? new Date(b.task.due_at).getTime() : Number.MAX_SAFE_INTEGER
        return aTime - bTime
      })
  ), [files])

  const visiblePageTasks = useMemo(() => pageTasks.filter(({ task }) => {
    const operating = dispositionTaskDefinition(task.task_type)
    if (taskLane !== 'all' && operating?.definition.lane !== taskLane) return false
    if (taskState === 'active') return task.status === 'open' || task.status === 'blocked'
    if (taskState !== 'all' && task.status !== taskState) return false
    return true
  }), [pageTasks, taskLane, taskState])

  const pageDocs = useMemo(() => (
    files.filter((file) => file.buyer_offer_id || file.offer?.assignment_document_url)
  ), [files])

  const reportRows = useMemo(() => {
    const openTasks = pageTasks.filter(({ task }) => task.status === 'open' || task.status === 'blocked')
    return [
      {
        label: 'Needs opening',
        value: files.filter((file) => file.status === 'not_opened' || file.status === 'opening_package_needed').length,
        detail: 'Files waiting on opening package work',
        icon: 'outbox',
        tone: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
      },
      {
        label: 'Title work',
        value: files.filter((file) => file.status === 'title_work' || file.title_company_id).length,
        detail: 'Files with title work active or assigned',
        icon: 'policy',
        tone: 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]',
      },
      {
        label: 'Docs ready',
        value: pageDocs.length,
        detail: 'Assignments or previews ready for review',
        icon: 'description',
        tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]',
      },
      {
        label: 'Open tasks',
        value: openTasks.length,
        detail: 'Open or blocked TC tasks across files',
        icon: 'task_alt',
        tone: 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
      },
    ]
  }, [files, pageDocs.length, pageTasks])

  const upcomingClosings = useMemo(() => (
    files
      .filter((file) => tcClosingDate(file))
      .sort((a, b) => new Date(tcClosingDate(a)!).getTime() - new Date(tcClosingDate(b)!).getTime())
      .slice(0, 8)
  ), [files])

  const blockedFiles = useMemo(() => (
    files.filter((file) => file.risk_level === 'blocked').slice(0, 8)
  ), [files])

  function startAssignmentPreview(file: TcFile) {
    if (!docuseal.enabled || !file.offer) return
    setAssignmentPreviewOffer({
      ...file.offer,
      lead: {
        id: file.lead_id,
        full_name: file.lead?.full_name ?? '',
        property_address: file.lead?.property_address ?? '',
      },
    } as BuyerOffer)
  }

  const metricCards = [
    { label: 'Open files', value: stats.open, icon: 'folder_open', tone: 'info' as const },
    { label: 'Need help', value: stats.blocked, icon: 'report', tone: 'danger' as const },
    { label: 'Closing soon', value: stats.scheduled, icon: 'event_available', tone: 'warning' as const },
    { label: 'Assignment fees', value: formatCurrency(stats.fees), icon: 'payments', tone: 'success' as const },
  ]

  return (
    <main className="min-h-full bg-[var(--crm-canvas)] text-[var(--crm-ink)]">
      <div className="mx-auto max-w-[1440px] space-y-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-xl border border-[var(--crm-border)] shadow-[var(--crm-shadow-sm)]">
          <DispoPageHeader
            eyebrow="Dispositions"
            title="Closing coordination"
            description="Open a file, see what is due, and complete the next step. Dispositions and Closing Coordination work from the same record."
            actions={(
              <button onClick={fetchFiles} className={secondaryButtonClass}>
                <Icon name="refresh" size="text-sm" /> Refresh
              </button>
            )}
          />
          <DispoWorkspaceTabs tabs={TC_PAGE_TABS} activeKey={pageView} />
        </div>

        <TcHandoffStrip items={metricCards} />

        {error && <div className="mb-4 rounded-lg border border-[var(--crm-brand)]/35 bg-[var(--crm-danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--crm-danger)]">{error}</div>}

        {pageView === 'files' && (
          <>
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    'whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-black transition-colors',
                    activeTab === tab.key
                      ? 'border-[var(--crm-brand)] bg-[var(--crm-brand)] text-[var(--crm-surface)]'
                      : 'border-[var(--crm-border-strong)] bg-[var(--crm-surface)] text-[var(--crm-text-muted)] hover:border-[var(--crm-brand)]/40 hover:bg-[var(--crm-brand-soft)]'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="overflow-hidden rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-sm">
              <div className="overflow-x-auto">
                <div className="min-w-[980px]">
                  <div className="grid grid-cols-[1.35fr_0.95fr_0.9fr_0.72fr_0.72fr_0.9fr_1.05fr] gap-3 border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-3 text-[11px] font-black uppercase text-[var(--crm-text-muted)]">
                    <span>Property</span>
                    <span>Buyer</span>
                    <span>Title</span>
                    <span>Closing</span>
                    <span>Risk</span>
                    <span>Workflow</span>
                    <span>Next Action</span>
                  </div>
                  {loading ? (
                    <div className="px-4 py-12 text-center text-sm font-semibold text-[var(--crm-text-muted)]">Loading TC files...</div>
                  ) : filtered.length === 0 ? (
                    <div className="px-4 py-14 text-center">
                      <Icon name="fact_check" size="text-3xl" className="mx-auto mb-2 text-[var(--crm-border-strong)]" />
                      <p className="text-sm font-bold text-[var(--crm-text)]">No active closing files in this view.</p>
                      <p className="mt-1 text-xs text-[var(--crm-text-muted)]">Real Dispositions records appear here as the shared operating workflow activates.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--crm-border)]">
                      {filtered.map((file) => {
                        const progress = operatingProgress(file)
                        return (
                        <button
                          key={file.id}
                          onClick={() => setSelected(file)}
                          className="grid w-full grid-cols-[1.35fr_0.95fr_0.9fr_0.72fr_0.72fr_0.9fr_1.05fr] gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--crm-brand-soft)]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-bold text-[var(--crm-ink)]">{file.lead?.property_address || 'No address'}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--crm-text-muted)]">
                              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black', STATUS_META[file.status].badge)}>
                                <Icon name={STATUS_META[file.status].icon} size="text-sm" />
                                {statusLabel(file.status)}
                              </span>
                              <span>{openTaskCount(file)} open tasks</span>
                            </span>
                          </span>
                          <span className="truncate text-[var(--crm-text-muted)]">{file.offer?.buyer?.name || file.offer?.buyer?.company || '—'}</span>
                          <span className="truncate text-[var(--crm-text-muted)]">{file.title_company?.name || file.file_number || 'Not assigned'}</span>
                          <span className="text-[var(--crm-text-muted)]">{formatDate(tcClosingDate(file))}</span>
                          <span>
                            <span className={cn('inline-flex rounded-full border px-2 py-1 text-[11px] font-black uppercase', riskClass(file.risk_level))}>{file.risk_level}</span>
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center justify-between gap-2 text-[11px] font-black text-[var(--crm-text)]">
                              <span>{progress.percent}%</span>
                              <span className="text-[var(--crm-text-muted)]">{progress.completed}/{progress.total}</span>
                            </span>
                            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--crm-border)]">
                              <span className={cn('block h-full rounded-full', progress.blocked > 0 ? 'bg-[var(--crm-brand)]' : 'bg-[var(--crm-success)]')} style={{ width: `${progress.percent}%` }} />
                            </span>
                          </span>
                          <span className="truncate text-[var(--crm-text-muted)]">{file.next_action || '—'}</span>
                        </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {pageView === 'communications' && (
          <section className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-sm">
            <div className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-3">
              <h2 className="text-sm font-black text-[var(--crm-ink)]">Communications</h2>
            </div>
            <div className="divide-y divide-[var(--crm-border)]">
              {loadingTimeline ? (
                <div className="px-4 py-12 text-center text-sm font-semibold text-[var(--crm-text-muted)]">Loading communications...</div>
              ) : pageCommunications.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm font-semibold text-[var(--crm-text-muted)]">No communications found.</div>
              ) : (
                pageCommunications.map(({ file, item }) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelected(file)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--crm-brand-soft)]"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--crm-danger-soft)] text-[var(--crm-brand)]">
                      <Icon name={communicationIcon(item.activity_type)} size="text-base" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-black text-[var(--crm-ink)]">{communicationLabel(item)}</span>
                      <span className="mt-0.5 block text-xs font-semibold text-[var(--crm-text-muted)]">
                        {file.lead?.property_address || 'No property'} · {formatDateTime(item.created_at)}
                      </span>
                      {item.description && <span className="mt-2 line-clamp-2 block text-sm text-[var(--crm-text-muted)]">{item.description}</span>}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {pageView === 'docs' && (
          <section className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-sm">
            <div className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-3">
              <h2 className="text-sm font-black text-[var(--crm-ink)]">Documents</h2>
              <p className="mt-1 text-xs font-semibold text-[var(--crm-text-muted)]">Contracts, receipts, title work, approvals, and closing evidence tied to the transaction record.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2">
              {loading ? (
                <div className="rounded-lg border border-dashed border-[var(--crm-border-strong)] px-4 py-12 text-center text-sm font-semibold text-[var(--crm-text-muted)] xl:col-span-2">Loading docs...</div>
              ) : pageDocs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--crm-border-strong)] px-4 py-12 text-center text-sm font-semibold text-[var(--crm-text-muted)] xl:col-span-2">No docs ready for review.</div>
              ) : (
                pageDocs.map((file) => (
                  <div key={file.id} className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-raised)] p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-[var(--crm-ink)]">{file.lead?.property_address || 'No property'}</p>
                        <p className="mt-0.5 text-xs font-semibold text-[var(--crm-text-muted)]">{file.offer?.buyer?.name || file.offer?.buyer?.company || 'No buyer'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {file.offer?.assignment_document_url ? (
                          <a href={file.offer.assignment_document_url} target="_blank" rel="noreferrer" className={secondaryButtonClass}>
                            <Icon name="open_in_new" size="text-sm" />
                            Full View
                          </a>
                        ) : file.buyer_offer_id && docuseal.enabled ? (
                          <button type="button" onClick={() => startAssignmentPreview(file)} className={secondaryButtonClass}>
                            <Icon name="preview" size="text-sm" />
                            Preview Assignment
                          </button>
                        ) : null}
                        <button type="button" onClick={() => setSelected(file)} className={secondaryButtonClass}>
                          <Icon name="fact_check" size="text-sm" />
                          Open File
                        </button>
                      </div>
                    </div>
                    {file.offer?.assignment_document_url ? (
                      <div className="h-[360px] overflow-hidden rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-surface)]">
                        <iframe
                          src={file.offer.assignment_document_url}
                          title={`Assignment document for ${file.lead?.property_address || 'TC file'}`}
                          className="h-full w-full border-0"
                        />
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-4 py-10 text-center text-sm font-semibold text-[var(--crm-text-muted)]">
                        Assignment preview pending.
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {pageView === 'tasks' && (
          <section className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-3">
              <div>
                <h2 className="text-sm font-black text-[var(--crm-ink)]">Role queue</h2>
                <p className="mt-1 text-xs font-semibold text-[var(--crm-text-muted)]">Due work across Dispositions, Closing Coordination, and shared handoffs.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select value={taskLane} onChange={(event) => setTaskLane(event.target.value as typeof taskLane)} className="rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-3 py-2 text-xs font-black text-[var(--crm-text)]" aria-label="Filter tasks by team lane">
                  <option value="all">All teams</option>
                  <option value="dispositions">Dispositions</option>
                  <option value="coordination">Closing coordination</option>
                  <option value="shared">Shared gates</option>
                </select>
                <select value={taskState} onChange={(event) => setTaskState(event.target.value as typeof taskState)} className="rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-3 py-2 text-xs font-black text-[var(--crm-text)]" aria-label="Filter tasks by status">
                  <option value="active">Active work</option>
                  <option value="all">All statuses</option>
                  <option value="open">Open</option>
                  <option value="blocked">Blocked</option>
                  <option value="done">Done</option>
                  <option value="waived">Waived</option>
                </select>
              </div>
            </div>
            <div className="divide-y divide-[var(--crm-border)]">
              {loading ? (
                <div className="px-4 py-12 text-center text-sm font-semibold text-[var(--crm-text-muted)]">Loading tasks...</div>
              ) : visiblePageTasks.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm font-semibold text-[var(--crm-text-muted)]">No tasks match this role queue.</div>
              ) : (
                visiblePageTasks.map(({ file, task }) => {
                  const operating = dispositionTaskDefinition(task.task_type)
                  return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setSelected(file)}
                    className="grid w-full grid-cols-[1.4fr_1fr_0.8fr_0.7fr] gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--crm-brand-soft)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-[var(--crm-ink)]">{task.label}</span>
                      <span className="mt-0.5 block truncate text-xs font-semibold text-[var(--crm-text-muted)]">{file.lead?.property_address || 'No property'}</span>
                      {operating && (
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black', laneClass(operating.definition.lane))}>{laneLabel(operating.definition.lane)}</span>
                          <span className="rounded-full border border-[var(--crm-border-strong)] bg-[var(--crm-surface)] px-2 py-0.5 text-[10px] font-black text-[var(--crm-text-muted)]">{operating.phase.label}</span>
                        </span>
                      )}
                    </span>
                    <span className="truncate text-[var(--crm-text-muted)]">{task.assigned_to || 'Unassigned'}</span>
                    <span className="text-[var(--crm-text-muted)]">{formatDate(task.due_at)}</span>
                    <span>
                      <span className={cn('inline-flex rounded-full border px-2 py-1 text-[11px] font-black uppercase', taskStatusClass(task.status))}>{task.status}</span>
                    </span>
                  </button>
                  )
                })
              )}
            </div>
          </section>
        )}

        {pageView === 'reports' && (
          <section className="space-y-4">
            <div className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-sm">
              <div className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-3">
                <h2 className="text-sm font-black text-[var(--crm-ink)]">Transaction performance</h2>
                <p className="mt-1 text-xs font-semibold text-[var(--crm-text-muted)]">Shared Dispositions and Closing Coordination performance from the same live transaction records.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
                {reportRows.map((row) => (
                  <div key={row.label} className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-raised)] px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase text-[var(--crm-text-muted)]">{row.label}</p>
                        <p className="mt-1 text-2xl font-black text-[var(--crm-ink)]">{row.value}</p>
                        <p className="mt-1 text-xs font-semibold text-[var(--crm-text-muted)]">{row.detail}</p>
                      </div>
                      <span className={cn('flex h-10 w-10 items-center justify-center rounded-lg', row.tone)}>
                        <Icon name={row.icon} size="text-xl" />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-sm">
                <div className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-3">
                  <h3 className="text-sm font-black text-[var(--crm-ink)]">Upcoming Closings</h3>
                </div>
                <div className="divide-y divide-[var(--crm-border)]">
                  {loading ? (
                    <div className="px-4 py-10 text-center text-sm font-semibold text-[var(--crm-text-muted)]">Loading closing report...</div>
                  ) : upcomingClosings.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm font-semibold text-[var(--crm-text-muted)]">No scheduled closings yet.</div>
                  ) : (
                    upcomingClosings.map((file) => (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => setSelected(file)}
                        className="grid w-full grid-cols-[1.3fr_0.8fr_0.8fr] gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--crm-brand-soft)]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-[var(--crm-ink)]">{file.lead?.property_address || 'No property'}</span>
                          <span className="mt-0.5 block truncate text-xs font-semibold text-[var(--crm-text-muted)]">{file.offer?.buyer?.name || file.offer?.buyer?.company || 'No buyer'}</span>
                        </span>
                        <span className="font-semibold text-[var(--crm-text-muted)]">{formatDate(tcClosingDate(file))}</span>
                        <span className={cn('justify-self-start rounded-full border px-2 py-1 text-[11px] font-black uppercase', STATUS_META[file.status].badge)}>
                          {statusLabel(file.status)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-sm">
                <div className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-3">
                  <h3 className="text-sm font-black text-[var(--crm-ink)]">Blocked / Watch Items</h3>
                </div>
                <div className="divide-y divide-[var(--crm-border)]">
                  {loading ? (
                    <div className="px-4 py-10 text-center text-sm font-semibold text-[var(--crm-text-muted)]">Loading risk report...</div>
                  ) : blockedFiles.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm font-semibold text-[var(--crm-text-muted)]">No blocked files right now.</div>
                  ) : (
                    blockedFiles.map((file) => (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => setSelected(file)}
                        className="grid w-full grid-cols-[1fr_0.7fr] gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--crm-brand-soft)]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-[var(--crm-ink)]">{file.lead?.property_address || 'No property'}</span>
                          <span className="mt-0.5 block truncate text-xs font-semibold text-[var(--crm-text-muted)]">{file.risk_reason || file.next_action || 'Needs TC review'}</span>
                        </span>
                        <span className={cn('justify-self-start rounded-full border px-2 py-1 text-[11px] font-black uppercase', riskClass(file.risk_level))}>{file.risk_level}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {pageView === 'communications' && pageEvents.length > 0 && (
          <section className="mt-4 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-sm">
            <div className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-3">
              <h2 className="text-sm font-black text-[var(--crm-ink)]">TC Activity</h2>
            </div>
            <div className="divide-y divide-[var(--crm-border)]">
              {pageEvents.slice(0, 20).map(({ file, event }) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setSelected(file)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--crm-brand-soft)]"
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]">
                    <Icon name="history" size="text-base" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-[var(--crm-ink)]">{event.event_type.replace(/_/g, ' ')}</span>
                    <span className="mt-0.5 block text-xs font-semibold text-[var(--crm-text-muted)]">
                      {file.lead?.property_address || 'No property'} · {formatDateTime(event.created_at)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {selected && (
        <DetailDrawer
          file={selected}
          templates={templates}
          docuseal={docuseal}
          onTemplatesChanged={fetchTemplates}
          onClose={() => setSelected(null)}
          onChanged={fetchFiles}
        />
      )}
      {assignmentPreviewOffer && docuseal.enabled && (
        <AssignmentPreviewModal
          offer={assignmentPreviewOffer}
          onClose={() => setAssignmentPreviewOffer(null)}
          onSent={() => {
            setAssignmentPreviewOffer(null)
            fetchFiles()
          }}
        />
      )}
    </main>
  )
}
