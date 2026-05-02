'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { cn, formatCurrency } from '@/lib/utils'
import type { TcDraft, TcDraftStatus, TcFile, TcStatus, TcTask } from '@/types/dispo'

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

type QueueKey = 'drafts' | 'calls' | 'exceptions' | 'files'

const QUEUE_TABS: { key: QueueKey; label: string; icon: string }[] = [
  { key: 'drafts', label: 'Drafts', icon: 'edit_note' },
  { key: 'calls', label: 'Calls', icon: 'phone_in_talk' },
  { key: 'exceptions', label: 'Exceptions', icon: 'report' },
  { key: 'files', label: 'Files', icon: 'folder_open' },
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

function statusLabel(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

function dateForInput(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toISOString().slice(0, 10)
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function riskClass(risk: string) {
  const map: Record<string, string> = {
    normal: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    watch: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    urgent: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    blocked: 'bg-[#E32E2E]/15 text-[#ff8b8b] border-[#E32E2E]/40',
  }
  return map[risk] ?? map.normal
}

function draftStatusClass(status: TcDraftStatus | 'missing') {
  const map: Record<TcDraftStatus | 'missing', string> = {
    missing: 'bg-white/5 text-[var(--ck-text-muted)] border-white/10',
    pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    rejected: 'bg-[#E32E2E]/15 text-[#ff8b8b] border-[#E32E2E]/40',
    sending: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    sent: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    superseded: 'bg-white/5 text-[var(--ck-text-dim)] border-white/10',
  }
  return map[status]
}

function openTaskCount(file: TcFile) {
  return file.tasks?.filter((task) => task.status === 'open' || task.status === 'blocked').length ?? 0
}

interface TcDocumentTemplate {
  id: string
  slug: string
  title: string
  template_type: 'email' | 'document' | 'checklist'
  audience: 'buyer' | 'seller' | 'title' | 'internal'
  subject: string | null
  body: string
  sort_order?: number
}

const STATUS_TEMPLATE_AUDIENCES: Record<TcStatus, TcDocumentTemplate['audience'][]> = {
  not_opened: ['internal'],
  opening_package_needed: ['title', 'seller'],
  opened: ['title', 'buyer'],
  emd_pending: ['buyer', 'title'],
  title_work: ['title', 'internal'],
  clear_to_close: ['title', 'buyer', 'seller'],
  scheduled: ['buyer', 'seller', 'title'],
  closed: ['seller', 'internal'],
  cancelled: ['internal'],
}

const CALL_TASK_TYPES = new Set([
  'send_opening_package',
  'confirm_emd',
  'confirm_file_number',
  'confirm_title_clear',
  'schedule_closing',
  'collect_hud',
])

interface DraftQueueItem {
  id: string
  file: TcFile
  template: TcDocumentTemplate
  draft: TcDraft | null
  reason: string
}

interface CallQueueItem {
  id: string
  file: TcFile
  task: TcTask
  recipientName: string
  recipientRole: string
  recipientPhone: string | null
}

interface ExceptionQueueItem {
  id: string
  file: TcFile
  title: string
  severity: 'watch' | 'urgent' | 'blocked'
  detail: string
}

function buyerName(file: TcFile) {
  return file.offer?.buyer?.name || file.offer?.buyer?.company || 'No buyer'
}

function propertyLabel(file: TcFile) {
  return file.lead?.property_address || 'No address'
}

function draftReason(status: TcStatus, audience: TcDocumentTemplate['audience']) {
  if (status === 'opening_package_needed' && audience === 'title') return 'Open title file'
  if (status === 'opening_package_needed' && audience === 'seller') return 'Seller closing handoff'
  if (status === 'emd_pending') return 'EMD follow-up'
  if (status === 'title_work') return 'Title status push'
  if (status === 'clear_to_close') return 'Closing coordination'
  if (status === 'scheduled') return 'Closing confirmation'
  return statusLabel(status)
}

function templateText(template: TcDocumentTemplate) {
  return [template.subject ? `Subject: ${template.subject}` : '', template.body]
    .filter(Boolean)
    .join('\n\n')
}

function currentDraftBody(draft: TcDraft) {
  return draft.edited_body || draft.approved_body || draft.draft_body
}

function draftKey(tcFileId: string, templateId: string | null) {
  return `${tcFileId}:${templateId ?? 'custom'}`
}

function buildDraftQueue(files: TcFile[], templates: TcDocumentTemplate[], drafts: TcDraft[]): DraftQueueItem[] {
  const draftsByKey = new Map<string, TcDraft>()
  for (const draft of drafts) {
    if (!draft.template_id) continue
    const key = draftKey(draft.tc_file_id, draft.template_id)
    if (!draftsByKey.has(key)) draftsByKey.set(key, draft)
  }

  return files.flatMap((file) => {
    if (file.status === 'closed' || file.status === 'cancelled') return []
    const audiences = STATUS_TEMPLATE_AUDIENCES[file.status] ?? []
    const matches = templates
      .filter((template) => template.template_type === 'email' && audiences.includes(template.audience))
      .slice(0, 3)

    return matches.flatMap((template) => {
      const draft = draftsByKey.get(draftKey(file.id, template.id)) ?? null
      if (draft?.status === 'sent' || draft?.status === 'superseded') return []
      return [{
        id: `${file.id}-${template.id}`,
        file,
        template,
        draft: draft?.status === 'rejected' ? null : draft,
        reason: draftReason(file.status, template.audience),
      }]
    })
  })
}

function buildCallQueue(files: TcFile[]): CallQueueItem[] {
  return files.flatMap((file) => {
    const tasks = (file.tasks ?? []).filter((task) =>
      (task.status === 'open' || task.status === 'blocked') && CALL_TASK_TYPES.has(task.task_type)
    )

    return tasks.map((task) => ({
      id: `${file.id}-${task.id}`,
      file,
      task,
      recipientName: file.title_contact?.name || file.title_company?.name || buyerName(file),
      recipientRole: file.title_contact?.role || (file.title_company ? 'Title' : 'Buyer'),
      recipientPhone: file.title_contact?.phone || file.title_company?.office_phone || file.offer?.buyer?.phone || null,
    }))
  }).sort((left, right) => {
    if (left.task.status === right.task.status) return propertyLabel(left.file).localeCompare(propertyLabel(right.file))
    return left.task.status === 'blocked' ? -1 : 1
  })
}

function buildExceptionQueue(files: TcFile[]): ExceptionQueueItem[] {
  const exceptions: ExceptionQueueItem[] = []

  for (const file of files) {
    if (file.risk_level !== 'normal') {
      exceptions.push({
        id: `${file.id}-risk`,
        file,
        title: `${statusLabel(file.risk_level)} risk`,
        severity: file.risk_level,
        detail: file.risk_reason || file.next_action || 'Review TC file status.',
      })
    }

    for (const task of file.tasks ?? []) {
      if (task.status === 'blocked') {
        exceptions.push({
          id: `${file.id}-${task.id}`,
          file,
          title: task.label,
          severity: 'blocked',
          detail: task.notes || 'Blocked checklist item.',
        })
      }
    }

    if (file.status !== 'not_opened' && file.status !== 'closed' && file.status !== 'cancelled' && !file.title_company_id) {
      exceptions.push({
        id: `${file.id}-missing-title`,
        file,
        title: 'Title company missing',
        severity: 'watch',
        detail: file.next_action || 'Assign title before the file advances.',
      })
    }
  }

  return exceptions.sort((left, right) => {
    const weights = { blocked: 0, urgent: 1, watch: 2 }
    return weights[left.severity] - weights[right.severity]
  })
}

function EmptyQueue({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#141414] px-4 py-10 text-center text-sm text-[var(--ck-text-muted)]">
      {children}
    </div>
  )
}

function DetailDrawer({
  file,
  templates,
  onTemplatesChanged,
  onClose,
  onChanged,
}: {
  file: TcFile
  templates: TcDocumentTemplate[]
  onTemplatesChanged: () => void
  onClose: () => void
  onChanged: () => void
}) {
  const [status, setStatus] = useState<TcStatus>(file.status)
  const [fileNumber, setFileNumber] = useState(file.file_number ?? '')
  const [nextAction, setNextAction] = useState(file.next_action ?? '')
  const [closingDate, setClosingDate] = useState(dateForInput(file.closing_scheduled_at))
  const [assignmentFee, setAssignmentFee] = useState(file.assignment_fee != null ? String(file.assignment_fee) : '')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<TcDocumentTemplate | 'new' | null>(null)
  const [templateDraft, setTemplateDraft] = useState({
    title: '',
    template_type: 'email' as TcDocumentTemplate['template_type'],
    audience: 'buyer' as TcDocumentTemplate['audience'],
    subject: '',
    body: '',
  })
  const didMountRef = useRef(false)
  const lastPayloadRef = useRef('')

  useEffect(() => {
    setStatus(file.status)
    setFileNumber(file.file_number ?? '')
    setNextAction(file.next_action ?? '')
    setClosingDate(dateForInput(file.closing_scheduled_at))
    setAssignmentFee(file.assignment_fee != null ? String(file.assignment_fee) : '')
    setSaveState('idle')
    didMountRef.current = false
    lastPayloadRef.current = ''
  }, [file.assignment_fee, file.closing_scheduled_at, file.file_number, file.id, file.next_action, file.status])

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
    const res = await fetch(`/api/tc/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })
    if (res.ok) onChanged()
  }

  async function copyTemplate(template: TcDocumentTemplate) {
    await navigator.clipboard.writeText(templateText(template))
    setCopiedSlug(template.slug)
    setTimeout(() => setCopiedSlug(null), 1600)
  }

  function startEditTemplate(template: TcDocumentTemplate | 'new') {
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
    const res = await fetch(`/api/tc/document-templates/${template.id}`, { method: 'DELETE' })
    if (res.ok) onTemplatesChanged()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto border-l border-[var(--ck-border)] bg-[#141414] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--ck-border)] bg-[#141414] px-6 py-5">
          <div>
            <h2 className="text-lg font-black text-white">{file.lead?.property_address || 'TC File'}</h2>
            <p className="mt-1 text-xs text-[var(--ck-text-muted)]">
              {file.lead?.full_name || 'No seller'} · {file.offer?.buyer?.name || file.offer?.buyer?.company || 'No buyer'}
            </p>
            <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-dim)]">
              {saveState === 'saving' ? 'Autosaving...' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Autosave failed' : 'Instant autosave'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-[var(--ck-text-muted)] hover:bg-white/5">
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {error && <div className="rounded-lg border border-[#E32E2E]/40 bg-[#E32E2E]/10 px-3 py-2 text-sm text-[#ff8b8b]">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-[var(--ck-text-dim)]">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as TcStatus)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-[var(--ck-text-dim)]">File Number</span>
              <input value={fileNumber} onChange={(e) => setFileNumber(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-[var(--ck-text-dim)]">Closing Date</span>
              <input type="date" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-[var(--ck-text-dim)]">Assignment Fee</span>
              <input type="number" value={assignmentFee} onChange={(e) => setAssignmentFee(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase text-[var(--ck-text-dim)]">Next Action</span>
            <textarea value={nextAction} onChange={(e) => setNextAction(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" />
          </label>

          <div className="flex flex-wrap gap-2">
            {file.lead_id && (
              <Link href={`/leads/${file.lead_id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/5">
                <Icon name="person" size="text-sm" /> Lead
              </Link>
            )}
            {file.offer?.assignment_document_url && (
              <a href={file.offer.assignment_document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/5">
                <Icon name="description" size="text-sm" /> Assignment
              </a>
            )}
          </div>

          <div>
            <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-[var(--ck-text-dim)]">Checklist</h3>
            <div className="space-y-2">
              {(file.tasks ?? []).map((task) => (
                <div key={task.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                  <button
                    onClick={() => updateTask(task, task.status === 'done' ? 'open' : 'done')}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-md border',
                      task.status === 'done' ? 'border-emerald-500 bg-emerald-500 text-black' : 'border-white/20 text-[var(--ck-text-muted)]'
                    )}
                  >
                    <Icon name={task.status === 'done' ? 'check' : 'radio_button_unchecked'} size="text-sm" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm font-semibold', task.status === 'done' ? 'text-[var(--ck-text-muted)] line-through' : 'text-white')}>{task.label}</p>
                    {task.due_at && <p className="text-[10px] text-[var(--ck-text-dim)]">Due {formatDate(task.due_at)}</p>}
                  </div>
                  {task.status === 'blocked' && <span className="rounded-full bg-[#E32E2E]/15 px-2 py-1 text-[10px] font-bold text-[#ff8b8b]">Blocked</span>}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-[var(--ck-text-dim)]">Docs & Email Templates</h3>
              <button
                onClick={() => startEditTemplate('new')}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-white/5"
              >
                <Icon name="add" size="text-sm" />
                New
              </button>
            </div>
            {editingTemplate && (
              <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.04] p-3">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={templateDraft.title}
                    onChange={(e) => setTemplateDraft((d) => ({ ...d, title: e.target.value }))}
                    placeholder="Template title"
                    className="col-span-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                  />
                  <select
                    value={templateDraft.template_type}
                    onChange={(e) => setTemplateDraft((d) => ({ ...d, template_type: e.target.value as TcDocumentTemplate['template_type'] }))}
                    className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                  >
                    <option value="email">Email</option>
                    <option value="document">Document</option>
                    <option value="checklist">Checklist</option>
                  </select>
                  <select
                    value={templateDraft.audience}
                    onChange={(e) => setTemplateDraft((d) => ({ ...d, audience: e.target.value as TcDocumentTemplate['audience'] }))}
                    className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
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
                    className="col-span-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                  />
                  <textarea
                    value={templateDraft.body}
                    onChange={(e) => setTemplateDraft((d) => ({ ...d, body: e.target.value }))}
                    rows={8}
                    placeholder="Template body"
                    className="col-span-2 resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => setEditingTemplate(null)} className="rounded-lg px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] hover:bg-white/5">Cancel</button>
                  <button onClick={saveTemplate} className="rounded-lg bg-[#E32E2E] px-3 py-2 text-xs font-bold text-white">Save Template</button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {templates.map((template) => (
                <div key={template.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white">{template.title}</p>
                      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-dim)]">
                        {template.audience} · {template.template_type}
                      </p>
                      {template.subject && <p className="mt-2 truncate text-xs text-[var(--ck-text-muted)]">{template.subject}</p>}
                    </div>
                    <button
                      onClick={() => copyTemplate(template)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-white/5"
                    >
                      <Icon name={copiedSlug === template.slug ? 'check' : 'content_copy'} size="text-sm" />
                      {copiedSlug === template.slug ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      onClick={() => startEditTemplate(template)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-white/5"
                    >
                      <Icon name="edit" size="text-sm" />
                      Edit
                    </button>
                    <button
                      onClick={() => deleteTemplate(template)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#E32E2E]/30 px-2.5 py-1.5 text-xs font-bold text-[#ff8b8b] hover:bg-[#E32E2E]/10"
                    >
                      <Icon name="delete" size="text-sm" />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DraftDrawer({
  draft,
  file,
  template,
  onClose,
  onChanged,
  onOpenFile,
}: {
  draft: TcDraft
  file: TcFile | null
  template: TcDocumentTemplate | NonNullable<TcDraft['template']> | null
  onClose: () => void
  onChanged: (draft: TcDraft) => void
  onOpenFile: (file: TcFile) => void
}) {
  const [subject, setSubject] = useState(draft.subject ?? '')
  const [body, setBody] = useState(currentDraftBody(draft))
  const [rejectionNotes, setRejectionNotes] = useState(draft.rejection_notes ?? '')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const didMountRef = useRef(false)
  const lastPayloadRef = useRef('')
  const isLocked = draft.status !== 'pending'
  const canSend = draft.status === 'approved' && !draft.sent_at
  const draftProperty = file?.lead?.property_address || draft.file?.lead?.property_address || 'No address'
  const draftFileLabel = file?.file_number || draft.file?.file_number || draftProperty

  useEffect(() => {
    setSubject(draft.subject ?? '')
    setBody(currentDraftBody(draft))
    setRejectionNotes(draft.rejection_notes ?? '')
    setSaveState('idle')
    setSendState(draft.status === 'sent' ? 'sent' : 'idle')
    setError(null)
    didMountRef.current = false
    lastPayloadRef.current = ''
  }, [draft])

  useEffect(() => {
    if (isLocked) return
    const payload = JSON.stringify({
      subject: subject || null,
      edited_body: body,
      actor: 'gertha',
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
        const res = await fetch(`/api/tc/drafts/${draft.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: controller.signal,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Autosave failed')
        lastPayloadRef.current = payload
        setSaveState('saved')
        onChanged(data.draft)
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
  }, [body, draft.id, isLocked, onChanged, subject])

  async function patchDraft(payload: Record<string, unknown>) {
    setSaveState('saving')
    setError(null)
    const res = await fetch(`/api/tc/drafts/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: subject || null,
        edited_body: body,
        actor: 'gertha',
        ...payload,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setSaveState('error')
      setError(data.error || 'Failed to update draft')
      return
    }
    setSaveState('saved')
    onChanged(data.draft)
  }

  async function approveDraft() {
    await patchDraft({ status: 'approved', approved_by: 'gertha' })
  }

  async function rejectDraft() {
    const notes = rejectionNotes.trim()
    if (!notes) {
      setError('Add a rejection note before rejecting.')
      return
    }
    await patchDraft({ status: 'rejected', rejection_notes: notes })
  }

  async function sendDraft() {
    if (!canSend || sendState === 'sending') return
    setSendState('sending')
    setError(null)
    const res = await fetch(`/api/tc/drafts/${draft.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm_send: true, actor: 'gertha' }),
    })
    const data = await res.json()
    if (!res.ok) {
      setSendState('error')
      setError(data.error || 'Failed to send draft')
      if (data.draft) onChanged(data.draft)
      return
    }
    setSendState('sent')
    onChanged(data.draft)
  }

  async function copyDraftText() {
    await navigator.clipboard.writeText([subject ? `Subject: ${subject}` : '', body].filter(Boolean).join('\n\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--ck-border)] bg-[#141414] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--ck-border)] bg-[#141414] px-6 py-5">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={cn('rounded-full border px-2 py-1 text-[10px] font-black uppercase', draftStatusClass(draft.status))}>
                {draft.status}
              </span>
              <span className="text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">
                {saveState === 'saving' ? 'Autosaving...' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Autosave failed' : 'Draft review'}
              </span>
            </div>
            <h2 className="truncate text-lg font-black text-white">{template?.title || 'TC Draft'}</h2>
            <p className="mt-1 truncate text-xs text-[var(--ck-text-muted)]">
              {draftProperty} · {draft.recipient_role}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-[var(--ck-text-muted)] hover:bg-white/5">
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {error && <div className="rounded-lg border border-[#E32E2E]/40 bg-[#E32E2E]/10 px-3 py-2 text-sm text-[#ff8b8b]">{error}</div>}
          {draft.delivery_error && draft.status !== 'sent' && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {draft.delivery_error}
            </div>
          )}
          {draft.status === 'sent' && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              Sent {formatDate(draft.sent_at)}{draft.delivery_provider ? ` via ${draft.delivery_provider}` : ''}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">Recipient</p>
              <p className="mt-1 truncate text-sm font-bold text-white">{draft.recipient_email || draft.recipient_phone || draft.recipient_role}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">File</p>
              <p className="mt-1 truncate text-sm font-bold text-white">{draftFileLabel}</p>
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase text-[var(--ck-text-dim)]">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={isLocked}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] font-bold uppercase text-[var(--ck-text-dim)]">Body</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={isLocked}
              rows={18}
              className="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-3 font-mono text-sm leading-6 text-white disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          {draft.status === 'pending' && (
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase text-[var(--ck-text-dim)]">Rejection Notes</span>
              <textarea
                value={rejectionNotes}
                onChange={(e) => setRejectionNotes(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
              />
            </label>
          )}

          {draft.rejection_notes && draft.status === 'rejected' && (
            <div className="rounded-lg border border-[#E32E2E]/30 bg-[#E32E2E]/10 px-3 py-2 text-sm text-[#ffb3b3]">
              {draft.rejection_notes}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={copyDraftText}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/5"
              >
                <Icon name={copied ? 'check' : 'content_copy'} size="text-sm" />
                {copied ? 'Copied' : 'Copy'}
              </button>
              {file && (
                <button
                  onClick={() => onOpenFile(file)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/5"
                >
                  <Icon name="folder_open" size="text-sm" />
                  Open File
                </button>
              )}
              <button
                onClick={sendDraft}
                disabled={!canSend || sendState === 'sending'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black',
                  canSend && sendState !== 'sending'
                    ? 'bg-[#E32E2E] text-white'
                    : 'cursor-not-allowed border border-white/10 text-[var(--ck-text-dim)] opacity-60'
                )}
              >
                <Icon name={sendState === 'sent' || draft.status === 'sent' ? 'check' : 'send'} size="text-sm" />
                {sendState === 'sending' || draft.status === 'sending'
                  ? 'Sending...'
                  : sendState === 'sent' || draft.status === 'sent'
                    ? 'Sent'
                    : 'Send Approved'}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={rejectDraft}
                disabled={draft.status !== 'pending'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E32E2E]/30 px-3 py-2 text-xs font-black text-[#ff8b8b] hover:bg-[#E32E2E]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="close" size="text-sm" />
                Reject
              </button>
              <button
                onClick={approveDraft}
                disabled={draft.status !== 'pending'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#E32E2E] px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="check" size="text-sm" />
                Approve
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TransactionCoordinatorPage() {
  const [files, setFiles] = useState<TcFile[]>([])
  const [drafts, setDrafts] = useState<TcDraft[]>([])
  const [activeQueue, setActiveQueue] = useState<QueueKey>('drafts')
  const [fileStatusFilter, setFileStatusFilter] = useState<TcStatus | 'all' | 'blocked'>('all')
  const [selected, setSelected] = useState<TcFile | null>(null)
  const [selectedDraft, setSelectedDraft] = useState<TcDraft | null>(null)
  const [templates, setTemplates] = useState<TcDocumentTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draftActionId, setDraftActionId] = useState<string | null>(null)

  async function fetchFiles() {
    setError(null)
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

  async function fetchDrafts() {
    const res = await fetch('/api/tc/drafts?limit=200')
    if (!res.ok) return
    const data = await res.json()
    setDrafts(data.drafts ?? [])
    if (selectedDraft) {
      const fresh = (data.drafts ?? []).find((draft: TcDraft) => draft.id === selectedDraft.id)
      if (fresh) setSelectedDraft(fresh)
    }
  }

  async function openDraft(item: DraftQueueItem) {
    setDraftActionId(item.id)
    setError(null)
    try {
      if (item.draft) {
        setSelectedDraft(item.draft)
        return
      }

      const res = await fetch('/api/tc/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tc_file_id: item.file.id,
          template_id: item.template.id,
          created_by: 'gertha',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create draft')
      setSelectedDraft({
        ...data.draft,
        file: item.file,
        template: item.template,
      })
      await fetchDrafts()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open draft')
    } finally {
      setDraftActionId(null)
    }
  }

  function handleDraftChanged(nextDraft: TcDraft) {
    setDrafts((current) => [nextDraft, ...current.filter((draft) => draft.id !== nextDraft.id)])
    setSelectedDraft(nextDraft)
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
    fetchDrafts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const draftQueue = useMemo(() => buildDraftQueue(files, templates, drafts), [drafts, files, templates])
  const callQueue = useMemo(() => buildCallQueue(files), [files])
  const exceptionQueue = useMemo(() => buildExceptionQueue(files), [files])

  const filteredFiles = useMemo(() => {
    if (fileStatusFilter === 'all') return files
    if (fileStatusFilter === 'blocked') return files.filter((file) => file.risk_level === 'blocked')
    return files.filter((file) => file.status === fileStatusFilter)
  }, [fileStatusFilter, files])

  const stats = useMemo(() => ({
    open: files.filter((file) => file.status !== 'closed' && file.status !== 'cancelled').length,
    blocked: files.filter((file) => file.risk_level === 'blocked').length,
    scheduled: files.filter((file) => file.status === 'scheduled').length,
    fees: files.reduce((sum, file) => sum + (file.assignment_fee ?? 0), 0),
  }), [files])

  const queueCounts: Record<QueueKey, number> = {
    drafts: draftQueue.length,
    calls: callQueue.length,
    exceptions: exceptionQueue.length,
    files: stats.open,
  }

  const selectedDraftFile = selectedDraft
    ? files.find((file) => file.id === selectedDraft.tc_file_id) ?? null
    : null
  const selectedDraftTemplate = selectedDraft
    ? templates.find((template) => template.id === selectedDraft.template_id) ?? selectedDraft.template ?? null
    : null

  return (
    <main className="tc-portal min-h-screen bg-[#f6f7f9] text-[#111827]">
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#E32E2E]">Reports to Dispositions</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-[#111827]">Transaction Coordination Portal</h1>
            <p className="mt-1 text-sm text-[var(--ck-text-muted)]">Closing files, approved communications, call agendas, and exceptions.</p>
          </div>
          <button
            onClick={() => {
              fetchFiles()
              fetchDrafts()
              fetchTemplates()
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/5"
          >
            <Icon name="refresh" size="text-sm" /> Refresh
          </button>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ['Drafts', draftQueue.length],
            ['Calls', callQueue.length],
            ['Exceptions', exceptionQueue.length],
            ['Open files', stats.open],
            ['Assignment fees', formatCurrency(stats.fees)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">{label}</p>
              <p className="mt-1 text-xl font-black text-white">{value}</p>
            </div>
          ))}
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {QUEUE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveQueue(tab.key)}
              className={cn(
                'inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-black transition-colors',
                activeQueue === tab.key ? 'bg-[#E32E2E] text-white' : 'border border-white/10 text-[var(--ck-text-muted)] hover:bg-white/5 hover:text-white'
              )}
            >
              <Icon name={tab.icon} size="text-base" />
              {tab.label}
              <span className={cn(
                'rounded-full px-2 py-0.5 text-[10px]',
                activeQueue === tab.key ? 'bg-black/20 text-white' : 'bg-white/5 text-[var(--ck-text-muted)]'
              )}>
                {queueCounts[tab.key]}
              </span>
            </button>
          ))}
        </div>

        {error && <div className="mb-4 rounded-lg border border-[#E32E2E]/40 bg-[#E32E2E]/10 px-4 py-3 text-sm text-[#ff8b8b]">{error}</div>}

        {loading ? (
          <EmptyQueue>Loading TC queues...</EmptyQueue>
        ) : activeQueue === 'drafts' ? (
          draftQueue.length === 0 ? (
            <EmptyQueue>No draft approvals queued.</EmptyQueue>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {draftQueue.map((item) => (
                <div key={item.id} className="rounded-lg border border-white/10 bg-[#141414] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">{propertyLabel(item.file)}</p>
                      <p className="mt-1 truncate text-xs text-[var(--ck-text-muted)]">{buyerName(item.file)} · {statusLabel(item.file.status)}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full border px-2 py-1 text-[10px] font-black uppercase', draftStatusClass(item.draft?.status ?? 'missing'))}>
                      {item.draft?.status ?? item.reason}
                    </span>
                  </div>
                  <div className="mt-4 rounded-md border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-sm font-bold text-white">{item.template.title}</p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">
                      {item.template.audience} · {item.template.template_type}
                    </p>
                    {item.template.subject && <p className="mt-2 truncate text-xs text-[var(--ck-text-muted)]">{item.template.subject}</p>}
                    {item.draft && <p className="mt-2 line-clamp-2 text-xs text-[var(--ck-text-muted)]">{currentDraftBody(item.draft)}</p>}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => openDraft(item)}
                      disabled={draftActionId === item.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#E32E2E] px-3 py-2 text-xs font-black text-white"
                    >
                      <Icon name={item.draft ? 'edit' : 'add'} size="text-sm" />
                      {draftActionId === item.id ? 'Opening...' : item.draft ? 'Open Draft' : 'Create Draft'}
                    </button>
                    <button
                      onClick={() => setSelected(item.file)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/5"
                    >
                      <Icon name="folder_open" size="text-sm" />
                      Open File
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : activeQueue === 'calls' ? (
          callQueue.length === 0 ? (
            <EmptyQueue>No call agendas queued.</EmptyQueue>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {callQueue.map((item) => (
                <div key={item.id} className="rounded-lg border border-white/10 bg-[#141414] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">{item.recipientName}</p>
                      <p className="mt-1 truncate text-xs text-[var(--ck-text-muted)]">{item.recipientRole} · {item.recipientPhone || 'No phone'}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full border px-2 py-1 text-[10px] font-black uppercase', item.task.status === 'blocked' ? riskClass('blocked') : 'border-white/10 bg-white/5 text-[var(--ck-text-muted)]')}>
                      {item.task.status}
                    </span>
                  </div>
                  <div className="mt-4 space-y-2 rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm">
                    <p className="font-bold text-white">{item.task.label}</p>
                    <p className="text-[var(--ck-text-muted)]">{propertyLabel(item.file)}</p>
                    <p className="text-[var(--ck-text-muted)]">{statusLabel(item.file.status)} · {item.file.next_action || 'No next action'}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.recipientPhone && (
                      <a href={`tel:${item.recipientPhone}`} className="inline-flex items-center gap-1.5 rounded-lg bg-[#E32E2E] px-3 py-2 text-xs font-black text-white">
                        <Icon name="call" size="text-sm" />
                        Call
                      </a>
                    )}
                    <button
                      onClick={() => setSelected(item.file)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/5"
                    >
                      <Icon name="folder_open" size="text-sm" />
                      Open File
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : activeQueue === 'exceptions' ? (
          exceptionQueue.length === 0 ? (
            <EmptyQueue>No exceptions queued.</EmptyQueue>
          ) : (
            <div className="space-y-3">
              {exceptionQueue.map((item) => (
                <div key={item.id} className="flex flex-col gap-4 rounded-lg border border-white/10 bg-[#141414] p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={cn('rounded-full border px-2 py-1 text-[10px] font-black uppercase', riskClass(item.severity))}>{item.severity}</span>
                      <span className="truncate text-sm font-black text-white">{item.title}</span>
                    </div>
                    <p className="truncate text-sm text-[var(--ck-text-muted)]">{propertyLabel(item.file)} · {buyerName(item.file)}</p>
                    <p className="mt-1 text-sm text-[var(--ck-text-muted)]">{item.detail}</p>
                  </div>
                  <button
                    onClick={() => setSelected(item.file)}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-black text-white hover:bg-white/5"
                  >
                    <Icon name="folder_open" size="text-sm" />
                    Open File
                  </button>
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setFileStatusFilter(tab.key)}
                  className={cn(
                    'whitespace-nowrap rounded-lg px-3 py-2 text-xs font-black transition-colors',
                    fileStatusFilter === tab.key ? 'bg-[#E32E2E] text-white' : 'border border-white/10 text-[var(--ck-text-muted)] hover:bg-white/5 hover:text-white'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="overflow-hidden rounded-lg border border-white/10 bg-[#141414]">
              <div className="grid min-w-[900px] grid-cols-[1.4fr_1fr_0.9fr_0.7fr_0.6fr_1.2fr] gap-3 border-b border-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">
                <span>Property</span>
                <span>Buyer</span>
                <span>Title</span>
                <span>Closing</span>
                <span>Risk</span>
                <span>Next Action</span>
              </div>
              {filteredFiles.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[var(--ck-text-muted)]">No TC files in this view.</div>
              ) : (
                <div className="divide-y divide-white/10 overflow-x-auto">
                  {filteredFiles.map((file) => (
                    <button
                      key={file.id}
                      onClick={() => setSelected(file)}
                      className="grid min-w-[900px] w-full grid-cols-[1.4fr_1fr_0.9fr_0.7fr_0.6fr_1.2fr] gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-white/[0.04]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-white">{propertyLabel(file)}</span>
                        <span className="mt-1 block text-xs text-[var(--ck-text-muted)]">{statusLabel(file.status)} · {openTaskCount(file)} open tasks</span>
                      </span>
                      <span className="truncate text-[var(--ck-text-muted)]">{buyerName(file)}</span>
                      <span className="truncate text-[var(--ck-text-muted)]">{file.title_company?.name || file.file_number || 'Not assigned'}</span>
                      <span className="text-[var(--ck-text-muted)]">{formatDate(file.closing_scheduled_at)}</span>
                      <span>
                        <span className={cn('inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase', riskClass(file.risk_level))}>{file.risk_level}</span>
                      </span>
                      <span className="truncate text-[var(--ck-text-muted)]">{file.next_action || '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {selected && (
        <DetailDrawer
          file={selected}
          templates={templates}
          onTemplatesChanged={fetchTemplates}
          onClose={() => setSelected(null)}
          onChanged={fetchFiles}
        />
      )}

      {selectedDraft && (
        <DraftDrawer
          draft={selectedDraft}
          file={selectedDraftFile}
          template={selectedDraftTemplate}
          onClose={() => setSelectedDraft(null)}
          onChanged={handleDraftChanged}
          onOpenFile={(file) => {
            setSelectedDraft(null)
            setSelected(file)
          }}
        />
      )}
    </main>
  )
}
