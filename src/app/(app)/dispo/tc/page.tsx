'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { cn, formatCurrency } from '@/lib/utils'
import type { TcFile, TcStatus, TcTask } from '@/types/dispo'

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
    const text = [
      template.subject ? `Subject: ${template.subject}` : '',
      template.body,
    ].filter(Boolean).join('\n\n')
    await navigator.clipboard.writeText(text)
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

export default function TransactionCoordinatorPage() {
  const [files, setFiles] = useState<TcFile[]>([])
  const [activeTab, setActiveTab] = useState<TcStatus | 'all' | 'blocked'>('all')
  const [selected, setSelected] = useState<TcFile | null>(null)
  const [templates, setTemplates] = useState<TcDocumentTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <main className="min-h-screen bg-[#0f0f0f] text-white">
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight">Transaction Coordinator</h1>
            <p className="mt-1 text-sm text-[var(--ck-text-muted)]">Assigned deals from contract through title, HUD, and revenue.</p>
          </div>
          <button onClick={fetchFiles} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/5">
            <Icon name="refresh" size="text-sm" /> Refresh
          </button>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Open files', stats.open],
            ['Blocked', stats.blocked],
            ['Scheduled', stats.scheduled],
            ['Assignment fees', formatCurrency(stats.fees)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">{label}</p>
              <p className="mt-1 text-xl font-black text-white">{value}</p>
            </div>
          ))}
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'whitespace-nowrap rounded-lg px-3 py-2 text-xs font-black transition-colors',
                activeTab === tab.key ? 'bg-[#E32E2E] text-white' : 'border border-white/10 text-[var(--ck-text-muted)] hover:bg-white/5 hover:text-white'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && <div className="mb-4 rounded-lg border border-[#E32E2E]/40 bg-[#E32E2E]/10 px-4 py-3 text-sm text-[#ff8b8b]">{error}</div>}

        <div className="overflow-hidden rounded-lg border border-white/10 bg-[#141414]">
          <div className="grid grid-cols-[1.4fr_1fr_0.9fr_0.7fr_0.6fr_1.2fr] gap-3 border-b border-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">
            <span>Property</span>
            <span>Buyer</span>
            <span>Title</span>
            <span>Closing</span>
            <span>Risk</span>
            <span>Next Action</span>
          </div>
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--ck-text-muted)]">Loading TC files...</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--ck-text-muted)]">No TC files in this view.</div>
          ) : (
            <div className="divide-y divide-white/10">
              {filtered.map((file) => (
                <button
                  key={file.id}
                  onClick={() => setSelected(file)}
                  className="grid w-full grid-cols-[1.4fr_1fr_0.9fr_0.7fr_0.6fr_1.2fr] gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-white/[0.04]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold text-white">{file.lead?.property_address || 'No address'}</span>
                    <span className="mt-1 block text-xs text-[var(--ck-text-muted)]">{statusLabel(file.status)} · {openTaskCount(file)} open tasks</span>
                  </span>
                  <span className="truncate text-[var(--ck-text-muted)]">{file.offer?.buyer?.name || file.offer?.buyer?.company || '—'}</span>
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
    </main>
  )
}
