// Next Action — appointment/task aware, suggestion-fallback.
//
// Resolution:
//   1. /api/ari/next-action returns either:
//        {type:'task', taskId, ...action fields, userEdited?}
//        {type:'suggestion', ...action fields}
//   2. Task mode: render the task with Edit / Complete / (CTA). The user is
//      in control; no LLM call ever overrides it.
//   3. Suggestion mode: render the AI suggestion with direct actions. It never
//      creates a task unless the user explicitly opens the New Task flow.

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { useCardCollapse } from '@/hooks/use-card-collapse'

type Priority = 'critical' | 'high' | 'nominal'

type SynthesizedAction = {
  type: 'task' | 'suggestion'
  taskId?: string
  title: string
  detail: string
  dateTime: string | null
  dateOnly?: boolean
  priority: Priority
  cta: string
  source: string
  prep_actions?: string[]
  userEdited?: boolean
}

interface NextActionProps {
  leadId: string
  leadName?: string | null
  leadPhone?: string | null
  leadEmail?: string | null
  priority?: string | null
  station?: string | null
  activities?: Array<{
    id: string
    activity_type: string
    description: string | null
    metadata: Record<string, unknown> | null
    created_at: string
  }>
  onNewTask?: () => void
  onContract?: () => void
  onSmsCompose?: () => void
  onLogNote?: () => void
  onScheduleAppointment?: () => void
  onAppointmentOutcome?: () => void
  onCall?: () => void
}

const TONE: Record<Priority, { color: string; bg: string; label: string }> = {
  critical: { color: 'var(--ck-accent-bright)', bg: 'rgba(239,68,68,0.12)',  label: 'Critical' },
  high:     { color: 'var(--ck-warn)',          bg: 'rgba(245,158,11,0.12)', label: 'High' },
  nominal:  { color: 'var(--ck-text-muted)',    bg: 'var(--ck-surface-elev)', label: 'Nominal' },
}

const CTA_OPTIONS = ['Start Call', 'Send SMS', 'Send Email', 'Set Appointment', 'Log Outcome', 'Log Note', 'Open Task']

// ─── Date helpers ──────────────────────────────────────────────────────────
function parseSmart(iso: string): { date: Date; dateOnly: boolean } {
  if (!iso) return { date: new Date(NaN), dateOnly: false }
  const plain = /^\d{4}-\d{2}-\d{2}$/
  const midnightUtc = /^\d{4}-\d{2}-\d{2}T00:00:00(\.\d+)?(Z|\+00:00)$/
  if (plain.test(iso) || midnightUtc.test(iso)) {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
    return { date: new Date(y, m - 1, d), dateOnly: true }
  }
  return { date: new Date(iso), dateOnly: false }
}

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function formatPassageDate(d: Date): string {
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' })
  const month = d.toLocaleDateString('en-US', { month: 'long' })
  return `${weekday} ${month} ${ordinalSuffix(d.getDate())}`
}

function formatDateLabel(iso: string | null): string | null {
  if (!iso) return null
  const { date: d } = parseSmart(iso)
  if (isNaN(d.getTime())) return null
  const now = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays > 0 && diffDays <= 6) return d.toLocaleDateString('en-US', { weekday: 'long' })
  if (diffDays < 0 && diffDays >= -6) return `${Math.abs(diffDays)}d ago`
  return formatPassageDate(d)
}

function formatTimeLabel(iso: string | null, dateOnlyHint?: boolean): string | null {
  if (!iso) return null
  const { date: d, dateOnly } = parseSmart(iso)
  if (isNaN(d.getTime())) return null
  if (dateOnly || dateOnlyHint) return null
  const h = d.getHours()
  const m = d.getMinutes()
  if (h === 0 && m === 0) return null
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function isoToLocalInputs(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  if (isNaN(d.getTime())) return { date: '', time: '' }
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` }
}

function localInputsToIso(date: string, time: string): string | null {
  if (!date) return null
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : '09:00'
  const d = new Date(`${date}T${t}:00`)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

// ─── Edit modal ────────────────────────────────────────────────────────────
function EditModal({
  open,
  initial,
  onCancel,
  onSave,
}: {
  open: boolean
  initial: SynthesizedAction | null
  onCancel: () => void
  onSave: (next: { title: string; notes: string; dateIso: string | null; priority: Priority; cta: string }) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [priority, setPriority] = useState<Priority>('high')
  const [cta, setCta] = useState('Start Call')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !initial) return
    setTitle(initial.title || '')
    setNotes(initial.detail || '')
    const { date: d, time: t } = isoToLocalInputs(initial.dateTime)
    setDate(d)
    setTime(t)
    setPriority(initial.priority || 'high')
    setCta(initial.cta || 'Start Call')
    setSaving(false)
  }, [open, initial])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl p-5 shadow-2xl"
        style={{ background: 'var(--ck-surface)', border: '1px solid var(--ck-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[17px] font-bold tracking-tight" style={{ color: 'var(--ck-text)' }}>
            Edit Next Action
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ background: 'var(--ck-surface-elev)', color: 'var(--ck-text-muted)' }}
            aria-label="Close"
          >
            <Icon name="close" size="text-base" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--ck-text-muted)' }}>
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Call Helen for follow-up on title issues"
              className="w-full mt-1 rounded-xl px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-[#E32E2E]/40"
              style={{
                background: 'var(--ck-surface-elev)',
                color: 'var(--ck-text)',
                border: '1px solid var(--ck-border)',
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--ck-text-muted)' }}>
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full mt-1 rounded-xl px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-[#E32E2E]/40"
                style={{
                  background: 'var(--ck-surface-elev)',
                  color: 'var(--ck-text)',
                  border: '1px solid var(--ck-border)',
                }}
              />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--ck-text-muted)' }}>
                Time
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full mt-1 rounded-xl px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-[#E32E2E]/40"
                style={{
                  background: 'var(--ck-surface-elev)',
                  color: 'var(--ck-text)',
                  border: '1px solid var(--ck-border)',
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--ck-text-muted)' }}>
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full mt-1 rounded-xl px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-[#E32E2E]/40"
                style={{
                  background: 'var(--ck-surface-elev)',
                  color: 'var(--ck-text)',
                  border: '1px solid var(--ck-border)',
                }}
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="nominal">Nominal</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--ck-text-muted)' }}>
                Action
              </label>
              <select
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                className="w-full mt-1 rounded-xl px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-[#E32E2E]/40"
                style={{
                  background: 'var(--ck-surface-elev)',
                  color: 'var(--ck-text)',
                  border: '1px solid var(--ck-border)',
                }}
              >
                {CTA_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--ck-text-muted)' }}>
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What did the seller say? What did the agent commit to?"
              className="w-full mt-1 rounded-xl px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-[#E32E2E]/40 resize-none"
              style={{
                background: 'var(--ck-surface-elev)',
                color: 'var(--ck-text)',
                border: '1px solid var(--ck-border)',
              }}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-[13px] font-semibold transition-colors"
            style={{
              background: 'var(--ck-surface-elev)',
              color: 'var(--ck-text)',
              border: '1px solid var(--ck-border)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !title.trim()}
            onClick={async () => {
              if (!title.trim()) return
              setSaving(true)
              const dateIso = localInputsToIso(date, time)
              try {
                await onSave({ title: title.trim(), notes: notes.trim(), dateIso, priority, cta })
              } finally {
                setSaving(false)
              }
            }}
            className="px-4 py-2 rounded-xl text-[13px] font-bold text-white transition-opacity disabled:opacity-50"
            style={{
              background: '#E32E2E',
              boxShadow: '0 4px 12px rgba(227,46,46,0.3)',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main ──────────────────────────────────────────────────────────────────
export function NextAction(props: NextActionProps) {
  const { leadId } = props
  const [open, toggleOpen] = useCardCollapse('next-action', true)
  const [expanded, setExpanded] = useState(false)
  const [action, setAction] = useState<SynthesizedAction | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const lastFetchKey = useRef<string>('')

  const fetchKey = useMemo(() => {
    const count = props.activities?.length ?? 0
    const latestId = props.activities?.[0]?.id ?? ''
    return `${leadId}:${count}:${latestId}`
  }, [leadId, props.activities])

  const [refreshTick, setRefreshTick] = useState(0)
  useEffect(() => {
    function bump() { setRefreshTick((t) => t + 1) }
    window.addEventListener('crm:lead-refresh', bump)
    return () => window.removeEventListener('crm:lead-refresh', bump)
  }, [])

  async function fetchAction(force = false): Promise<SynthesizedAction | null> {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ari/next-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
        cache: force ? 'no-store' : 'default',
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = (await res.json()) as SynthesizedAction & { error?: string }
      if (data?.error || !data?.title) {
        setAction(null)
        return null
      }
      setAction(data)
      return data
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'failed'
      setError(msg)
      return null
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!leadId) return
    if (refreshTick > 0) lastFetchKey.current = ''
    if (lastFetchKey.current === fetchKey) return
    lastFetchKey.current = fetchKey
    let cancelled = false
    ;(async () => {
      const result = await fetchAction()
      if (cancelled && result) return
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, leadId, refreshTick])

  const ctaHandler = useMemo(() => {
    if (!action) return undefined
    const c = action.cta.toLowerCase()
    if (c.includes('call') || c === 'start call') return props.onCall || props.onNewTask
    if (c.includes('sms') || c.includes('text')) return props.onSmsCompose
    if (c.includes('appointment') || c.includes('meet') || c.includes('walkthrough')) return props.onScheduleAppointment
    if (c.includes('outcome')) return props.onAppointmentOutcome
    if (c.includes('note')) return props.onLogNote
    if (c.includes('task')) return props.onNewTask
    if (c.includes('contract')) return props.onContract
    return props.onNewTask
  }, [action, props])

  async function saveTaskEdit(next: { title: string; notes: string; dateIso: string | null; priority: Priority; cta: string }) {
    if (!action) return
    if (action.type === 'task' && action.taskId) {
      const res = await fetch(`/api/leads/tasks/${action.taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: next.title,
          notes: next.notes,
          dueDate: next.dateIso,
          priority: next.priority === 'critical' ? 'critical' : next.priority === 'nominal' ? 'normal' : 'high',
          cta: next.cta,
        }),
      })
      if (!res.ok) throw new Error(`task PATCH failed: ${res.status}`)
    } else {
      const res = await fetch('/api/calendar/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          title: next.title,
          dueDate: next.dateIso,
          taskType: 'follow_up',
          assignedTo: 'Casey',
          notes: next.notes,
        }),
      })
      if (!res.ok) throw new Error(`task create failed: ${res.status}`)
    }
    setEditOpen(false)
    window.dispatchEvent(new Event('crm:lead-refresh'))
    await fetchAction(true)
  }

  async function completeTask() {
    if (!action || action.type !== 'task' || !action.taskId) return
    try {
      const res = await fetch(`/api/leads/tasks/${action.taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      if (!res.ok) throw new Error(`complete failed: ${res.status}`)
      window.dispatchEvent(new Event('crm:lead-refresh'))
      await fetchAction(true)
    } catch (e) {
      console.error('[NextAction] complete failed', e)
    }
  }

  const dateLabel = action ? formatDateLabel(action.dateTime) : null
  const timeLabel = action ? formatTimeLabel(action.dateTime, action.dateOnly) : null
  const tone = action ? TONE[action.priority] : TONE.nominal
  const isTask = action?.type === 'task'
  const isSuggestion = action?.type === 'suggestion'
  const appointmentLike = action
    ? /appointment|walkthrough|meet|visit/i.test(`${action.title} ${action.detail} ${action.cta}`)
    : false
  const ctaIsAppointment = action ? /appointment|walkthrough|meet|visit/i.test(action.cta) : false

  return (
    <section
      className="rounded-2xl p-5 border"
      style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
    >
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full flex items-center justify-between mb-3"
      >
        <div className="flex items-center gap-2">
          <Icon name="navigation" className="!text-base !text-[color:var(--ck-accent)]" />
          <h2 className="ck-microlabel !text-[11px] !text-[color:var(--ck-text)]">Next Action</h2>
          {isSuggestion && (
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(175,82,222,0.14)', color: '#AF52DE' }}
              title="AI suggestion. Accept to make it your committed action."
            >
              Ari Suggestion
            </span>
          )}
          {isTask && action?.userEdited && (
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: 'var(--ck-surface-elev)', color: 'var(--ck-text-muted)' }}
              title="You edited this task."
            >
              Edited
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isTask && (
            <span
              role="button"
              title="Edit task"
              onClick={(e) => { e.stopPropagation(); setEditOpen(true) }}
              className="p-1 rounded hover:bg-white/5"
              style={{ color: 'var(--ck-text-dim)' }}
            >
              <Icon name="edit" className="!text-sm" />
            </span>
          )}
          {isSuggestion && (
            <span
              role="button"
              title="Re-analyze (Ari only — does not change a saved task)"
              onClick={(e) => { e.stopPropagation(); fetchAction(true) }}
              className="p-1 rounded hover:bg-white/5"
              style={{ color: 'var(--ck-text-dim)' }}
            >
              <Icon name="refresh" className={`!text-sm ${loading ? 'animate-spin' : ''}`} />
            </span>
          )}
          <Icon
            name={open ? 'expand_less' : 'expand_more'}
            className="!text-base !text-[color:var(--ck-text-muted)]"
          />
        </div>
      </button>

      {open && action && (dateLabel || timeLabel) && (
        <div
          className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 mb-3 border"
          style={{
            background: 'rgba(239,68,68,0.08)',
            borderColor: 'rgba(239,68,68,0.3)',
          }}
        >
          {dateLabel && (
            <span className="inline-flex items-center gap-1.5 font-black" style={{ color: 'var(--ck-accent-bright)' }}>
              <Icon name="event" className="!text-base" />
              <span className="text-base tracking-tight">{dateLabel}</span>
            </span>
          )}
          {timeLabel && (
            <>
              <span style={{ color: 'rgba(239,68,68,0.4)' }}>·</span>
              <span className="inline-flex items-center gap-1 font-bold" style={{ color: 'var(--ck-accent-bright)' }}>
                <Icon name="schedule" className="!text-sm" />
                <span className="text-sm">{timeLabel}</span>
              </span>
            </>
          )}
        </div>
      )}

      {open && (
        loading && !action ? (
          <div className="flex items-center gap-2 py-2">
            <div
              className="w-3 h-3 border-2 rounded-full animate-spin"
              style={{ borderColor: 'rgba(239,68,68,0.3)', borderTopColor: 'var(--ck-accent)' }}
            />
            <span className="text-xs" style={{ color: 'var(--ck-text-muted)' }}>Reading notes, calls, and calendar…</span>
          </div>
        ) : !action ? (
          <p className="text-xs" style={{ color: 'var(--ck-text-muted)' }}>No recommendation.</p>
        ) : (
          <div
            className="text-left select-none"
            onDoubleClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Double-click to collapse' : 'Double-click to see full briefing'}
          >
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <p className="text-sm font-bold leading-tight" style={{ color: 'var(--ck-text)' }}>
                {action.title}
              </p>
              <span
                className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ background: tone.bg, color: tone.color }}
              >
                {tone.label}
              </span>
            </div>

            {expanded && action.detail && (
              <p
                className="text-[12px] leading-relaxed mb-2 whitespace-pre-line"
                style={{ color: 'var(--ck-text)' }}
              >
                {action.detail}
              </p>
            )}

            {expanded && action.prep_actions && action.prep_actions.length > 0 && (
              <div className="mb-3">
                <p
                  className="ck-microlabel !text-[10px] mb-1.5"
                  style={{ color: 'var(--ck-accent)' }}
                >
                  Prep before this call
                </p>
                <ul className="space-y-1">
                  {action.prep_actions.map((p, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-[11px] leading-snug"
                      style={{ color: 'var(--ck-text)' }}
                    >
                      <span
                        className="mt-[5px] w-1 h-1 rounded-full shrink-0"
                        style={{ background: 'var(--ck-accent)' }}
                      />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {expanded && action.source && (
              <div
                className="text-[10px] italic mb-3 flex items-center gap-1"
                style={{ color: 'var(--ck-text-dim)' }}
                title="Where this recommendation came from"
              >
                <Icon name="info" className="!text-[10px]" />
                {action.source}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
              {isTask && (
                <div className="flex items-center gap-2">
                  {ctaHandler && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); ctaHandler() }}
                      className="h-9 px-3 rounded-lg text-xs font-bold text-white inline-flex items-center gap-1.5 transition-opacity hover:opacity-90"
                      style={{
                        background: 'var(--ck-accent)',
                        boxShadow: '0 4px 12px rgba(239,68,68,0.22)',
                      }}
                    >
                      {action.cta}
                    </button>
                  )}
                  {appointmentLike && !ctaIsAppointment && props.onScheduleAppointment && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); props.onScheduleAppointment?.() }}
                      className="h-9 px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                      style={{
                        background: 'var(--ck-surface-elev)',
                        color: 'var(--ck-text)',
                        border: '1px solid var(--ck-border)',
                      }}
                    >
                      <Icon name="event" className="!text-sm" />
                      Set Appointment
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); completeTask() }}
                    className="h-9 px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                    style={{
                      background: 'var(--ck-surface-elev)',
                      color: 'var(--ck-text)',
                      border: '1px solid var(--ck-border)',
                    }}
                    title="Mark this task done"
                  >
                    <Icon name="check" className="!text-sm" />
                    Done
                  </button>
                </div>
              )}

              {isSuggestion && (
                <div className="flex items-center gap-2 flex-wrap">
                  {ctaHandler && action.cta !== 'Open Task' && !ctaIsAppointment && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); ctaHandler() }}
                      className="h-9 px-3 rounded-lg text-xs font-bold text-white inline-flex items-center gap-1.5 transition-opacity hover:opacity-90"
                      style={{
                        background: 'var(--ck-accent)',
                        boxShadow: '0 4px 12px rgba(239,68,68,0.22)',
                      }}
                    >
                      {action.cta}
                    </button>
                  )}
                  {props.onScheduleAppointment && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); props.onScheduleAppointment?.() }}
                      className="h-9 px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                      style={{
                        background: appointmentLike ? 'var(--ck-accent)' : 'var(--ck-surface-elev)',
                        color: appointmentLike ? 'white' : 'var(--ck-text)',
                        border: appointmentLike ? '1px solid var(--ck-accent)' : '1px solid var(--ck-border)',
                      }}
                      title="Schedule a real appointment, not a task"
                    >
                      <Icon name="event" className="!text-sm" />
                      Set Appointment
                    </button>
                  )}
                  {props.onNewTask && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); props.onNewTask?.() }}
                      className="h-9 px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                      style={{
                        background: 'var(--ck-surface-elev)',
                        color: 'var(--ck-text)',
                        border: '1px solid var(--ck-border)',
                      }}
                      title="Create a task manually"
                    >
                      <Icon name="add_task" className="!text-sm" />
                      New Task
                    </button>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
                className="text-[10px] font-bold hover:underline"
                style={{ color: 'var(--ck-text-muted)' }}
              >
                {expanded ? 'Show less' : 'Show details'}
              </button>
            </div>

            {error && expanded && (
              <p className="text-[9px] mt-2" style={{ color: 'var(--ck-text-dim)' }}>
                Fetch error: {error}
              </p>
            )}
          </div>
        )
      )}

      <EditModal
        open={editOpen}
        initial={action}
        onCancel={() => setEditOpen(false)}
        onSave={saveTaskEdit}
      />
    </section>
  )
}
