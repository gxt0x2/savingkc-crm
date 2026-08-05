'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AssignmentPreviewModal } from '@/components/dispo/assignment-preview-modal'
import { Icon } from '@/components/ui/icon'
import { cn, formatCurrency } from '@/lib/utils'
import type { BuyerOffer, TcCommunication, TcEvent, TcFile, TcStatus, TcTask } from '@/types/dispo'

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

const DETAIL_TABS = [
  { key: 'communications', label: 'Communications', icon: 'forum' },
  { key: 'activity', label: 'TC Activity', icon: 'history' },
  { key: 'docs', label: 'Docs', icon: 'description' },
] as const

type DetailTab = (typeof DETAIL_TABS)[number]['key']

type TcPageView = 'files' | 'communications' | 'docs' | 'tasks' | 'reports'

const TC_PAGE_TABS: { key: TcPageView; label: string; href: string; icon: string }[] = [
  { key: 'files', label: 'Files', href: '/dispo/tc', icon: 'fact_check' },
  { key: 'communications', label: 'Communications', href: '/dispo/tc?view=communications', icon: 'forum' },
  { key: 'docs', label: 'Doc Review', href: '/dispo/tc?view=docs', icon: 'preview' },
  { key: 'tasks', label: 'Tasks', href: '/dispo/tc?view=tasks', icon: 'task_alt' },
  { key: 'reports', label: 'Dispo Reports', href: '/dispo/tc?view=reports', icon: 'account_tree' },
]

interface TcFileTimeline {
  communications: TcCommunication[]
  events: TcEvent[]
}

const STATUS_META: Record<TcStatus, { label: string; badge: string; icon: string }> = {
  not_opened: { label: 'Not Opened', badge: 'border-[#cad2df] bg-[#eef2f7] text-[#4b5565]', icon: 'draft' },
  opening_package_needed: { label: 'Needs Opening', badge: 'border-[#f7c948] bg-[#fff7d6] text-[#8a5a00]', icon: 'outbox' },
  opened: { label: 'Opened', badge: 'border-[#9fd5ff] bg-[#e8f4ff] text-[#075985]', icon: 'folder_open' },
  emd_pending: { label: 'EMD Pending', badge: 'border-[#f9bc8b] bg-[#fff0e5] text-[#9a3412]', icon: 'payments' },
  title_work: { label: 'Title Work', badge: 'border-[#c4b5fd] bg-[#f1edff] text-[#5b21b6]', icon: 'policy' },
  clear_to_close: { label: 'Clear to Close', badge: 'border-[#86efac] bg-[#e8fff0] text-[#166534]', icon: 'verified' },
  scheduled: { label: 'Scheduled', badge: 'border-[#93c5fd] bg-[#eff6ff] text-[#1d4ed8]', icon: 'event_available' },
  closed: { label: 'Closed', badge: 'border-[#6ee7b7] bg-[#e7fff7] text-[#047857]', icon: 'check_circle' },
  cancelled: { label: 'Cancelled', badge: 'border-[#fda4af] bg-[#fff1f2] text-[#be123c]', icon: 'cancel' },
}

const fieldClass = 'w-full rounded-lg border !border-[#cad2df] !bg-[#ffffff] px-3 py-2 text-sm !text-[#111827] outline-none transition focus:!border-[#E32E2E] focus:ring-2 focus:ring-[#E32E2E]/15 placeholder:!text-[#7a8494]'
const fieldLabelClass = 'text-[11px] font-bold uppercase text-[#697386]'
const secondaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[#cad2df] bg-[#ffffff] px-3 py-2 text-sm font-bold text-[#253041] transition hover:border-[#E32E2E]/40 hover:bg-[#fff7f7]'

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
    normal: 'border-[#86efac] bg-[#e8fff0] text-[#166534]',
    watch: 'border-[#f7c948] bg-[#fff8db] text-[#8a5a00]',
    urgent: 'border-[#fb923c] bg-[#fff0e5] text-[#9a3412]',
    blocked: 'border-[#E32E2E]/35 bg-[#fff1f1] text-[#b42318]',
  }
  return map[risk] ?? map.normal
}

function openTaskCount(file: TcFile) {
  return file.tasks?.filter((task) => task.status === 'open' || task.status === 'blocked').length ?? 0
}

function taskStatusClass(status: TcTask['status']) {
  const map: Record<TcTask['status'], string> = {
    open: 'border-[#cad2df] bg-[#ffffff] text-[#697386]',
    done: 'border-[#86efac] bg-[#e8fff0] text-[#166534]',
    waived: 'border-[#d8dee9] bg-[#f6f7f9] text-[#697386]',
    blocked: 'border-[#E32E2E]/35 bg-[#fff1f1] text-[#b42318]',
  }
  return map[status]
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
    <div className="rounded-lg border border-[#e1e6ee] bg-[#fbfcfe] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fff1f1] text-[#E32E2E]">
          <Icon name={icon} size="text-sm" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase text-[#697386]">{label}</p>
          <p className="truncate text-sm font-bold text-[#111827]">{name}</p>
        </div>
      </div>
      {context && <p className="mb-2 truncate text-xs text-[#697386]">{context}</p>}
      <div className="flex flex-wrap gap-2">
        {phone && (
          <a href={`tel:${phone}`} className="inline-flex items-center gap-1 rounded-md border border-[#cad2df] bg-white px-2 py-1 text-xs font-bold text-[#4b5565] hover:border-[#E32E2E]/40 hover:bg-[#fff7f7]">
            <Icon name="call" size="text-xs" />
            {phone}
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="inline-flex items-center gap-1 rounded-md border border-[#cad2df] bg-white px-2 py-1 text-xs font-bold text-[#4b5565] hover:border-[#E32E2E]/40 hover:bg-[#fff7f7]">
            <Icon name="mail" size="text-xs" />
            Email
          </a>
        )}
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 rounded-md border border-[#cad2df] bg-white px-2 py-1 text-xs font-bold text-[#4b5565] hover:border-[#E32E2E]/40 hover:bg-[#fff7f7]">
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
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>('communications')
  const [communications, setCommunications] = useState<TcCommunication[]>([])
  const [events, setEvents] = useState<TcEvent[]>([])
  const [loadingComms, setLoadingComms] = useState(false)
  const [assignmentPreviewOffer, setAssignmentPreviewOffer] = useState<BuyerOffer | null>(null)
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

  function startAssignmentPreview() {
    if (!file.offer) return
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
    <div className="fixed inset-0 z-50 flex justify-end bg-[#111827]/35 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-[#d8dee9] bg-[#f8fafc] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#d8dee9] bg-[#ffffff] px-6 py-5">
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
            <h2 className="truncate text-xl font-black text-[#111827]">{file.lead?.property_address || 'TC File'}</h2>
            <p className="mt-1 text-sm text-[#697386]">
              {file.lead?.full_name || 'No seller'} · {file.offer?.buyer?.name || file.offer?.buyer?.company || 'No buyer'}
            </p>
            <p className="mt-2 text-[11px] font-bold uppercase text-[#697386]">
              {saveState === 'saving' ? 'Autosaving' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Autosave failed' : 'Instant autosave'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-[#cad2df] bg-[#ffffff] p-2 text-[#4b5565] hover:bg-[#fff7f7]" aria-label="Close TC file">
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          {error && <div className="rounded-lg border border-[#E32E2E]/35 bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#b42318]">{error}</div>}

          <section className="rounded-lg border border-[#d8dee9] bg-[#ffffff] p-4">
            <div className="mb-4 flex items-center gap-2">
              <Icon name="tune" size="text-base" className="text-[#E32E2E]" />
              <h3 className="text-sm font-black text-[#111827]">File Controls</h3>
            </div>
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
                <Link href={`/leads/${file.lead_id}`} className={secondaryButtonClass}>
                  <Icon name="person" size="text-sm" /> Lead
                </Link>
              )}
              {file.offer?.assignment_document_url && (
                <a href={file.offer.assignment_document_url} target="_blank" rel="noreferrer" className={secondaryButtonClass}>
                  <Icon name="description" size="text-sm" /> Assignment
                </a>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[#d8dee9] bg-[#ffffff] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon name="contacts" size="text-base" className="text-[#E32E2E]" />
                <h3 className="text-sm font-black text-[#111827]">Shared Contacts</h3>
              </div>
              <Link href="/dispo/contacts" className="text-xs font-bold text-[#E32E2E] hover:text-[#c42626]">
                Directory
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <ContactTile
                icon="person"
                label="Seller"
                name={file.lead?.full_name || 'No seller assigned'}
                context={file.lead?.property_address}
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

          <section className="rounded-lg border border-[#d8dee9] bg-[#ffffff] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon name="forum" size="text-base" className="text-[#E32E2E]" />
                <h3 className="text-sm font-black text-[#111827]">Communications & Docs</h3>
              </div>
              <span className="text-xs font-bold text-[#697386]">Lead + TC file history</span>
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
                      ? 'border-[#E32E2E] bg-[#fff1f1] text-[#b42318]'
                      : 'border-[#cad2df] bg-[#ffffff] text-[#4b5565] hover:border-[#E32E2E]/40 hover:bg-[#fff7f7]'
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
                  <div className="rounded-lg border border-dashed border-[#cad2df] bg-[#fbfcfe] px-4 py-8 text-center text-sm font-semibold text-[#697386]">
                    Loading communications...
                  </div>
                ) : communications.length > 0 ? (
                  communications.map((item) => (
                    <div key={item.id} className="rounded-lg border border-[#e1e6ee] bg-[#fbfcfe] p-3">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#fff1f1] text-[#E32E2E]">
                            <Icon name={communicationIcon(item.activity_type)} size="text-sm" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold capitalize text-[#111827]">{communicationLabel(item)}</p>
                            <p className="text-[11px] font-semibold text-[#697386]">
                              {formatDateTime(item.created_at)}{item.agent ? ` · ${item.agent}` : ''}
                            </p>
                          </div>
                        </div>
                      </div>
                      {item.description && <p className="whitespace-pre-wrap text-sm text-[#4b5565]">{item.description}</p>}
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-[#cad2df] bg-[#fbfcfe] px-4 py-8 text-center text-sm font-semibold text-[#697386]">
                    No TC-related lead communications found yet.
                  </div>
                )}
              </div>
            )}

            {activeDetailTab === 'activity' && (
              <div className="space-y-2">
                {loadingComms ? (
                  <div className="rounded-lg border border-dashed border-[#cad2df] bg-[#fbfcfe] px-4 py-8 text-center text-sm font-semibold text-[#697386]">
                    Loading TC activity...
                  </div>
                ) : events.length > 0 ? (
                  events.map((event) => (
                    <div key={event.id} className="rounded-lg border border-[#e1e6ee] bg-[#fbfcfe] p-3">
                      <div className="flex items-start gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eef2f7] text-[#4b5565]">
                          <Icon name="history" size="text-sm" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-[#111827]">{event.event_type.replace(/_/g, ' ')}</p>
                          <p className="text-[11px] font-semibold text-[#697386]">
                            {formatDateTime(event.created_at)}{event.actor ? ` · ${event.actor}` : ''}
                          </p>
                          {event.payload && Object.keys(event.payload).length > 0 && (
                            <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-[#f8fafc] p-2 text-[11px] text-[#4b5565]">
                              {JSON.stringify(event.payload, null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-[#cad2df] bg-[#fbfcfe] px-4 py-8 text-center text-sm font-semibold text-[#697386]">
                    No TC activity has been logged for this file yet.
                  </div>
                )}
              </div>
            )}

            {activeDetailTab === 'docs' && (
              <div className="space-y-3">
                <div className="rounded-lg border border-[#e1e6ee] bg-[#fbfcfe] p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-[#111827]">Assignment Contract</p>
                      <p className="text-xs font-semibold text-[#697386]">
                        Review signed docs or launch the DocuSeal iframe preview from the TC file.
                      </p>
                    </div>
                    {file.offer?.assignment_document_url ? (
                      <a href={file.offer.assignment_document_url} target="_blank" rel="noreferrer" className={secondaryButtonClass}>
                        <Icon name="open_in_new" size="text-sm" />
                        Full View
                      </a>
                    ) : file.buyer_offer_id ? (
                      <button type="button" onClick={startAssignmentPreview} className={secondaryButtonClass}>
                        <Icon name="preview" size="text-sm" />
                        Preview Assignment
                      </button>
                    ) : null}
                  </div>

                  {file.offer?.assignment_document_url ? (
                    <div className="h-[520px] overflow-hidden rounded-lg border border-[#cad2df] bg-white">
                      <iframe
                        src={file.offer.assignment_document_url}
                        title="Assignment document"
                        className="h-full w-full border-0"
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-[#cad2df] bg-[#ffffff] px-4 py-8 text-center text-sm font-semibold text-[#697386]">
                      No signed assignment document is attached yet.
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[#d8dee9] bg-[#ffffff] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon name="checklist" size="text-base" className="text-[#E32E2E]" />
                <h3 className="text-sm font-black text-[#111827]">Checklist</h3>
              </div>
              <span className="text-xs font-bold text-[#697386]">{openTaskCount(file)} open</span>
            </div>
            <div className="space-y-2">
              {(file.tasks ?? []).map((task) => (
                <div key={task.id} className="flex items-center gap-3 rounded-lg border border-[#e1e6ee] bg-[#fbfcfe] px-3 py-2">
                  <button
                    onClick={() => updateTask(task, task.status === 'done' ? 'open' : 'done')}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-lg border transition',
                      task.status === 'done' ? 'border-[#22c55e] bg-[#22c55e] text-[#ffffff]' : 'border-[#cad2df] bg-[#ffffff] text-[#697386] hover:border-[#E32E2E]/40'
                    )}
                    aria-label={task.status === 'done' ? 'Reopen task' : 'Complete task'}
                  >
                    <Icon name={task.status === 'done' ? 'check' : 'radio_button_unchecked'} size="text-sm" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm font-semibold', task.status === 'done' ? 'text-[#7a8494] line-through' : 'text-[#253041]')}>{task.label}</p>
                    {task.due_at && <p className="text-xs text-[#697386]">Due {formatDate(task.due_at)}</p>}
                  </div>
                  <span className={cn('rounded-full border px-2 py-1 text-[11px] font-black uppercase', taskStatusClass(task.status))}>{task.status}</span>
                </div>
              ))}
              {(file.tasks ?? []).length === 0 && (
                <div className="rounded-lg border border-dashed border-[#cad2df] bg-[#fbfcfe] px-4 py-8 text-center text-sm font-semibold text-[#697386]">
                  No checklist tasks yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[#d8dee9] bg-[#ffffff] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon name="article" size="text-base" className="text-[#E32E2E]" />
                <h3 className="text-sm font-black text-[#111827]">Templates</h3>
              </div>
              <button onClick={() => startEditTemplate('new')} className={secondaryButtonClass}>
                <Icon name="add" size="text-sm" />
                New
              </button>
            </div>

            {editingTemplate && (
              <div className="mb-3 rounded-lg border border-[#d8dee9] bg-[#f8fafc] p-3">
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
                  <button onClick={() => setEditingTemplate(null)} className="rounded-lg px-3 py-2 text-xs font-bold text-[#697386] hover:bg-[#eef2f7]">Cancel</button>
                  <button onClick={saveTemplate} className="inline-flex items-center gap-2 rounded-lg bg-[#E32E2E] px-3 py-2 text-xs font-bold text-[#ffffff] hover:bg-[#c42626]">
                    <Icon name="save" size="text-sm" />
                    Save Template
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {templates.map((template) => (
                <div key={template.id} className="rounded-lg border border-[#e1e6ee] bg-[#fbfcfe] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[220px] flex-1">
                      <p className="text-sm font-bold text-[#111827]">{template.title}</p>
                      <p className="mt-0.5 text-[11px] font-bold uppercase text-[#697386]">
                        {template.audience} · {template.template_type}
                      </p>
                      {template.subject && <p className="mt-2 truncate text-xs text-[#4b5565]">{template.subject}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => copyTemplate(template)} className={secondaryButtonClass}>
                        <Icon name={copiedSlug === template.slug ? 'check' : 'content_copy'} size="text-sm" />
                        {copiedSlug === template.slug ? 'Copied' : 'Copy'}
                      </button>
                      <button onClick={() => startEditTemplate(template)} className={secondaryButtonClass}>
                        <Icon name="edit" size="text-sm" />
                        Edit
                      </button>
                      <button onClick={() => deleteTemplate(template)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#E32E2E]/35 bg-[#fff1f1] px-3 py-2 text-sm font-bold text-[#b42318] transition hover:bg-[#ffe5e5]">
                        <Icon name="delete" size="text-sm" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {templates.length === 0 && (
                <div className="rounded-lg border border-dashed border-[#cad2df] bg-[#fbfcfe] px-4 py-8 text-center text-sm font-semibold text-[#697386]">
                  No templates yet.
                </div>
              )}
            </div>
          </section>
        </div>
      </aside>
    </div>
    {assignmentPreviewOffer && (
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
  const [files, setFiles] = useState<TcFile[]>([])
  const [activeTab, setActiveTab] = useState<TcStatus | 'all' | 'blocked'>('all')
  const [selected, setSelected] = useState<TcFile | null>(null)
  const [templates, setTemplates] = useState<TcDocumentTemplate[]>([])
  const [timelineByFile, setTimelineByFile] = useState<Record<string, TcFileTimeline>>({})
  const [loadingTimeline, setLoadingTimeline] = useState(false)
  const [assignmentPreviewOffer, setAssignmentPreviewOffer] = useState<BuyerOffer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
  }, [files])

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
        tone: 'bg-[#fff7d6] text-[#8a5a00]',
      },
      {
        label: 'Title work',
        value: files.filter((file) => file.status === 'title_work' || file.title_company_id).length,
        detail: 'Files with title work active or assigned',
        icon: 'policy',
        tone: 'bg-[#f1edff] text-[#5b21b6]',
      },
      {
        label: 'Docs ready',
        value: pageDocs.length,
        detail: 'Assignments or previews ready for review',
        icon: 'description',
        tone: 'bg-[#e8f4ff] text-[#075985]',
      },
      {
        label: 'Open tasks',
        value: openTasks.length,
        detail: 'Open or blocked TC tasks across files',
        icon: 'task_alt',
        tone: 'bg-[#fff1f1] text-[#b42318]',
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
    if (!file.offer) return
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
    { label: 'Open files', value: stats.open, icon: 'folder_open', tone: 'bg-[#e8f4ff] text-[#075985]' },
    { label: 'Blocked', value: stats.blocked, icon: 'report', tone: 'bg-[#fff1f1] text-[#b42318]' },
    { label: 'Scheduled', value: stats.scheduled, icon: 'event_available', tone: 'bg-[#eff6ff] text-[#1d4ed8]' },
    { label: 'Assignment fees', value: formatCurrency(stats.fees), icon: 'payments', tone: 'bg-[#e8fff0] text-[#166534]' },
  ]

  return (
    <main className="tc-portal min-h-full bg-[var(--crm-canvas)] text-[var(--crm-ink)]">
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-[#d8dee9] pb-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#E32E2E]">Reports to Dispositions</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-[#111827]">Transaction Coordination Portal</h1>
            <p suppressHydrationWarning className="mt-1 max-w-2xl text-sm text-[#4b5565]">Closing files, approved communications, call agendas, exceptions, title work, EMD, and assignment fee recognition.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {TC_PAGE_TABS.map((tab) => {
              const active = pageView === tab.key
              return (
                <Link
                  key={tab.key}
                  href={tab.href}
                  prefetch={false}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-black transition',
                    active
                      ? 'border-[#E32E2E] bg-[#E32E2E] text-white shadow-sm shadow-[#E32E2E]/20'
                      : 'border-[#cad2df] bg-[#ffffff] text-[#253041] hover:border-[#E32E2E]/40 hover:bg-[#fff7f7]'
                  )}
                >
                  <Icon name={tab.icon} size="text-sm" className={active ? 'text-white' : 'text-[#697386]'} />
                  {tab.label}
                </Link>
              )
            })}
            <button onClick={fetchFiles} className={secondaryButtonClass}>
              <Icon name="refresh" size="text-sm" /> Refresh
            </button>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metricCards.map((card) => (
            <div key={card.label} className="rounded-lg border border-[#d8dee9] bg-[#ffffff] px-4 py-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase text-[#697386]">{card.label}</p>
                  <p className="mt-1 text-2xl font-black text-[#111827]">{card.value}</p>
                </div>
                <span className={cn('flex h-10 w-10 items-center justify-center rounded-lg', card.tone)}>
                  <Icon name={card.icon} size="text-xl" />
                </span>
              </div>
            </div>
          ))}
        </div>

        {error && <div className="mb-4 rounded-lg border border-[#E32E2E]/35 bg-[#fff1f1] px-4 py-3 text-sm font-semibold text-[#b42318]">{error}</div>}

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
                      ? 'border-[#E32E2E] bg-[#E32E2E] text-[#ffffff]'
                      : 'border-[#cad2df] bg-[#ffffff] text-[#4b5565] hover:border-[#E32E2E]/40 hover:bg-[#fff7f7]'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="overflow-hidden rounded-lg border border-[#d8dee9] bg-[#ffffff] shadow-sm">
              <div className="overflow-x-auto">
                <div className="min-w-[980px]">
                  <div className="grid grid-cols-[1.4fr_1fr_0.95fr_0.8fr_0.7fr_1.2fr] gap-3 border-b border-[#e1e6ee] bg-[#f8fafc] px-4 py-3 text-[11px] font-black uppercase text-[#697386]">
                    <span>Property</span>
                    <span>Buyer</span>
                    <span>Title</span>
                    <span>Closing</span>
                    <span>Risk</span>
                    <span>Next Action</span>
                  </div>
                  {loading ? (
                    <div className="px-4 py-12 text-center text-sm font-semibold text-[#697386]">Loading TC files...</div>
                  ) : filtered.length === 0 ? (
                    <div className="px-4 py-14 text-center">
                      <Icon name="fact_check" size="text-3xl" className="mx-auto mb-2 text-[#cad2df]" />
                      <p className="text-sm font-bold text-[#253041]">No TC files in this view.</p>
                      <p className="mt-1 text-xs text-[#697386]">Real Dispo pipeline files will appear here when they are ready for closing coordination.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-[#e1e6ee]">
                      {filtered.map((file) => (
                        <button
                          key={file.id}
                          onClick={() => setSelected(file)}
                          className="grid w-full grid-cols-[1.4fr_1fr_0.95fr_0.8fr_0.7fr_1.2fr] gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[#fff7f7]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-bold text-[#111827]">{file.lead?.property_address || 'No address'}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#697386]">
                              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black', STATUS_META[file.status].badge)}>
                                <Icon name={STATUS_META[file.status].icon} size="text-sm" />
                                {statusLabel(file.status)}
                              </span>
                              <span>{openTaskCount(file)} open tasks</span>
                            </span>
                          </span>
                          <span className="truncate text-[#4b5565]">{file.offer?.buyer?.name || file.offer?.buyer?.company || '—'}</span>
                          <span className="truncate text-[#4b5565]">{file.title_company?.name || file.file_number || 'Not assigned'}</span>
                          <span className="text-[#4b5565]">{formatDate(tcClosingDate(file))}</span>
                          <span>
                            <span className={cn('inline-flex rounded-full border px-2 py-1 text-[11px] font-black uppercase', riskClass(file.risk_level))}>{file.risk_level}</span>
                          </span>
                          <span className="truncate text-[#4b5565]">{file.next_action || '—'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {pageView === 'communications' && (
          <section className="rounded-lg border border-[#d8dee9] bg-[#ffffff] shadow-sm">
            <div className="border-b border-[#e1e6ee] bg-[#f8fafc] px-4 py-3">
              <h2 className="text-sm font-black text-[#111827]">Communications</h2>
            </div>
            <div className="divide-y divide-[#e1e6ee]">
              {loadingTimeline ? (
                <div className="px-4 py-12 text-center text-sm font-semibold text-[#697386]">Loading communications...</div>
              ) : pageCommunications.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm font-semibold text-[#697386]">No communications found.</div>
              ) : (
                pageCommunications.map(({ file, item }) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelected(file)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#fff7f7]"
                  >
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#fff1f1] text-[#E32E2E]">
                      <Icon name={communicationIcon(item.activity_type)} size="text-base" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-black text-[#111827]">{communicationLabel(item)}</span>
                      <span className="mt-0.5 block text-xs font-semibold text-[#697386]">
                        {file.lead?.property_address || 'No property'} · {formatDateTime(item.created_at)}
                      </span>
                      {item.description && <span className="mt-2 line-clamp-2 block text-sm text-[#4b5565]">{item.description}</span>}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {pageView === 'docs' && (
          <section className="rounded-lg border border-[#d8dee9] bg-[#ffffff] shadow-sm">
            <div className="border-b border-[#e1e6ee] bg-[#f8fafc] px-4 py-3">
              <h2 className="text-sm font-black text-[#111827]">Doc Review</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2">
              {loading ? (
                <div className="rounded-lg border border-dashed border-[#cad2df] px-4 py-12 text-center text-sm font-semibold text-[#697386] xl:col-span-2">Loading docs...</div>
              ) : pageDocs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#cad2df] px-4 py-12 text-center text-sm font-semibold text-[#697386] xl:col-span-2">No docs ready for review.</div>
              ) : (
                pageDocs.map((file) => (
                  <div key={file.id} className="rounded-lg border border-[#e1e6ee] bg-[#fbfcfe] p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-[#111827]">{file.lead?.property_address || 'No property'}</p>
                        <p className="mt-0.5 text-xs font-semibold text-[#697386]">{file.offer?.buyer?.name || file.offer?.buyer?.company || 'No buyer'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {file.offer?.assignment_document_url ? (
                          <a href={file.offer.assignment_document_url} target="_blank" rel="noreferrer" className={secondaryButtonClass}>
                            <Icon name="open_in_new" size="text-sm" />
                            Full View
                          </a>
                        ) : file.buyer_offer_id ? (
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
                      <div className="h-[360px] overflow-hidden rounded-lg border border-[#cad2df] bg-white">
                        <iframe
                          src={file.offer.assignment_document_url}
                          title={`Assignment document for ${file.lead?.property_address || 'TC file'}`}
                          className="h-full w-full border-0"
                        />
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-[#cad2df] bg-white px-4 py-10 text-center text-sm font-semibold text-[#697386]">
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
          <section className="rounded-lg border border-[#d8dee9] bg-[#ffffff] shadow-sm">
            <div className="border-b border-[#e1e6ee] bg-[#f8fafc] px-4 py-3">
              <h2 className="text-sm font-black text-[#111827]">Tasks</h2>
            </div>
            <div className="divide-y divide-[#e1e6ee]">
              {loading ? (
                <div className="px-4 py-12 text-center text-sm font-semibold text-[#697386]">Loading tasks...</div>
              ) : pageTasks.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm font-semibold text-[#697386]">No TC tasks found.</div>
              ) : (
                pageTasks.map(({ file, task }) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setSelected(file)}
                    className="grid w-full grid-cols-[1.4fr_1fr_0.8fr_0.7fr] gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[#fff7f7]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-[#111827]">{task.label}</span>
                      <span className="mt-0.5 block truncate text-xs font-semibold text-[#697386]">{file.lead?.property_address || 'No property'}</span>
                    </span>
                    <span className="truncate text-[#4b5565]">{task.assigned_to || 'Unassigned'}</span>
                    <span className="text-[#4b5565]">{formatDate(task.due_at)}</span>
                    <span>
                      <span className={cn('inline-flex rounded-full border px-2 py-1 text-[11px] font-black uppercase', taskStatusClass(task.status))}>{task.status}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {pageView === 'reports' && (
          <section className="space-y-4">
            <div className="rounded-lg border border-[#d8dee9] bg-[#ffffff] shadow-sm">
              <div className="border-b border-[#e1e6ee] bg-[#f8fafc] px-4 py-3">
                <h2 className="text-sm font-black text-[#111827]">Dispo Reports</h2>
                <p className="mt-1 text-xs font-semibold text-[#697386]">TC closing snapshot for Dispositions without leaving the TC portal.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
                {reportRows.map((row) => (
                  <div key={row.label} className="rounded-lg border border-[#e1e6ee] bg-[#fbfcfe] px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase text-[#697386]">{row.label}</p>
                        <p className="mt-1 text-2xl font-black text-[#111827]">{row.value}</p>
                        <p className="mt-1 text-xs font-semibold text-[#697386]">{row.detail}</p>
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
              <div className="rounded-lg border border-[#d8dee9] bg-[#ffffff] shadow-sm">
                <div className="border-b border-[#e1e6ee] bg-[#f8fafc] px-4 py-3">
                  <h3 className="text-sm font-black text-[#111827]">Upcoming Closings</h3>
                </div>
                <div className="divide-y divide-[#e1e6ee]">
                  {loading ? (
                    <div className="px-4 py-10 text-center text-sm font-semibold text-[#697386]">Loading closing report...</div>
                  ) : upcomingClosings.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm font-semibold text-[#697386]">No scheduled closings yet.</div>
                  ) : (
                    upcomingClosings.map((file) => (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => setSelected(file)}
                        className="grid w-full grid-cols-[1.3fr_0.8fr_0.8fr] gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[#fff7f7]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-[#111827]">{file.lead?.property_address || 'No property'}</span>
                          <span className="mt-0.5 block truncate text-xs font-semibold text-[#697386]">{file.offer?.buyer?.name || file.offer?.buyer?.company || 'No buyer'}</span>
                        </span>
                        <span className="font-semibold text-[#4b5565]">{formatDate(tcClosingDate(file))}</span>
                        <span className={cn('justify-self-start rounded-full border px-2 py-1 text-[11px] font-black uppercase', STATUS_META[file.status].badge)}>
                          {statusLabel(file.status)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-[#d8dee9] bg-[#ffffff] shadow-sm">
                <div className="border-b border-[#e1e6ee] bg-[#f8fafc] px-4 py-3">
                  <h3 className="text-sm font-black text-[#111827]">Blocked / Watch Items</h3>
                </div>
                <div className="divide-y divide-[#e1e6ee]">
                  {loading ? (
                    <div className="px-4 py-10 text-center text-sm font-semibold text-[#697386]">Loading risk report...</div>
                  ) : blockedFiles.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm font-semibold text-[#697386]">No blocked files right now.</div>
                  ) : (
                    blockedFiles.map((file) => (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => setSelected(file)}
                        className="grid w-full grid-cols-[1fr_0.7fr] gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[#fff7f7]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-[#111827]">{file.lead?.property_address || 'No property'}</span>
                          <span className="mt-0.5 block truncate text-xs font-semibold text-[#697386]">{file.risk_reason || file.next_action || 'Needs TC review'}</span>
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
          <section className="mt-4 rounded-lg border border-[#d8dee9] bg-[#ffffff] shadow-sm">
            <div className="border-b border-[#e1e6ee] bg-[#f8fafc] px-4 py-3">
              <h2 className="text-sm font-black text-[#111827]">TC Activity</h2>
            </div>
            <div className="divide-y divide-[#e1e6ee]">
              {pageEvents.slice(0, 20).map(({ file, event }) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setSelected(file)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#fff7f7]"
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#eef2f7] text-[#4b5565]">
                    <Icon name="history" size="text-base" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-[#111827]">{event.event_type.replace(/_/g, ' ')}</span>
                    <span className="mt-0.5 block text-xs font-semibold text-[#697386]">
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
          onTemplatesChanged={fetchTemplates}
          onClose={() => setSelected(null)}
          onChanged={fetchFiles}
        />
      )}
      {assignmentPreviewOffer && (
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
