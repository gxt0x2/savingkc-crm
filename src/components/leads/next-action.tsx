// Next Action — calls /api/ari/next-action for a LLM-synthesized, grounded
// next-step recommendation (pulls from manifest + calendar tasks + transcripts +
// notes + emails). Falls back to local rule-based analysis if the endpoint fails.

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { useCardCollapse } from '@/hooks/use-card-collapse'

type Priority = 'critical' | 'high' | 'nominal'

interface SynthesizedAction {
  title: string
  detail: string
  dateTime: string | null
  dateOnly?: boolean
  priority: Priority
  cta: string
  source: string
  prep_actions?: string[]
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
  onAppointmentOutcome?: () => void
  onCall?: () => void
}

const TONE: Record<Priority, { color: string; bg: string; label: string }> = {
  critical: { color: 'var(--ck-accent-bright)', bg: 'rgba(239,68,68,0.12)',  label: 'Critical' },
  high:     { color: 'var(--ck-warn)',          bg: 'rgba(245,158,11,0.12)', label: 'High' },
  nominal:  { color: 'var(--ck-text-muted)',    bg: 'var(--ck-surface-elev)', label: 'Nominal' },
}

// ─── Date parsing that survives midnight-UTC serialization ──────────────────
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
  // Full, readable format: "Wednesday, April 29" — no cramped abbreviations
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
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

// ─── Minimal local fallback (used only if API fails) ───────────────────────
function localFallback(props: NextActionProps): SynthesizedAction {
  const name = props.leadName || 'this lead'
  const now = Date.now()
  const tasks = (props.activities || [])
    .filter((a) => a.activity_type === 'task')
    .map((a) => ({ ...a, md: (a.metadata || {}) as any }))
    .filter((a) => a.md.due_date && a.md.status !== 'completed' && a.md.status !== 'done')
    .sort((a, b) => new Date(a.md.due_date).getTime() - new Date(b.md.due_date).getTime())
  const t = tasks[0]
  if (t) {
    return {
      title: `${t.description || 'Task'} — ${name}`,
      detail: t.md.notes ? String(t.md.notes).slice(0, 200) : 'Scheduled task.',
      dateTime: t.md.due_date,
      dateOnly: false,
      priority: new Date(t.md.due_date).getTime() < now ? 'critical' : 'high',
      cta: 'Open Task',
      source: `Task due ${new Date(t.md.due_date).toLocaleDateString()}`,
    }
  }
  return {
    title: `Stand by on ${name}`,
    detail: 'No pending tasks or appointments on record.',
    dateTime: null,
    priority: 'nominal',
    cta: 'Log Note',
    source: 'No signals on record',
  }
}

export function NextAction(props: NextActionProps) {
  const { leadId } = props
  const [open, toggleOpen] = useCardCollapse('next-action', true)
  const [expanded, setExpanded] = useState(false) // compact by default; double-click to expand
  const [action, setAction] = useState<SynthesizedAction | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastFetchKey = useRef<string>('')

  // Key changes whenever the data we want synthesized-from changes.
  const fetchKey = useMemo(() => {
    const count = props.activities?.length ?? 0
    const latestId = props.activities?.[0]?.id ?? ''
    return `${leadId}:${count}:${latestId}`
  }, [leadId, props.activities])

  useEffect(() => {
    if (!leadId) return
    if (lastFetchKey.current === fetchKey) return
    lastFetchKey.current = fetchKey
    let cancelled = false
    async function run() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/ari/next-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId }),
        })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const data = (await res.json()) as SynthesizedAction & { error?: string }
        if (cancelled) return
        if (data?.error || !data?.title) {
          setAction(localFallback(props))
        } else {
          setAction(data)
        }
      } catch (e: any) {
        if (cancelled) return
        setError(e?.message || 'synthesize failed')
        setAction(localFallback(props))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, leadId])

  async function handleRefresh() {
    lastFetchKey.current = '' // force
    // Bump the key via a state toggle? Simpler: just call directly.
    setLoading(true)
    try {
      const res = await fetch('/api/ari/next-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })
      const data = (await res.json()) as SynthesizedAction
      if (data?.title) setAction(data)
    } catch { /* keep existing */ }
    setLoading(false)
  }

  // Map the CTA string from the endpoint to an onClick handler.
  const ctaHandler = useMemo(() => {
    if (!action) return undefined
    const c = action.cta.toLowerCase()
    if (c.includes('call') || c === 'start call') return props.onCall || props.onNewTask
    if (c.includes('sms') || c.includes('text')) return props.onSmsCompose
    if (c.includes('outcome')) return props.onAppointmentOutcome
    if (c.includes('note')) return props.onLogNote
    if (c.includes('task')) return props.onNewTask
    if (c.includes('contract')) return props.onContract
    return props.onNewTask
  }, [action, props])

  const dateLabel = action ? formatDateLabel(action.dateTime) : null
  const timeLabel = action ? formatTimeLabel(action.dateTime, action.dateOnly) : null
  const tone = action ? TONE[action.priority] : TONE.nominal

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
          <h2 className="ck-microlabel !text-[11px] !text-white">Next Action</h2>
        </div>
        <div className="flex items-center gap-2">
          <span
            role="button"
            title="Re-analyze"
            onClick={(e) => { e.stopPropagation(); handleRefresh() }}
            className="p-1 rounded hover:bg-white/5"
            style={{ color: 'var(--ck-text-dim)' }}
          >
            <Icon name="refresh" className={`!text-sm ${loading ? 'animate-spin' : ''}`} />
          </span>
          <Icon
            name={open ? 'expand_less' : 'expand_more'}
            className="!text-base !text-[color:var(--ck-text-muted)]"
          />
        </div>
      </button>

      {/* Date/time pill — pinned directly under the Next Action header */}
      {open && action && (dateLabel || timeLabel) && (
        <div
          className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 mb-3 border"
          style={{
            background: 'rgba(239,68,68,0.08)',
            borderColor: 'rgba(239,68,68,0.3)',
          }}
        >
          {dateLabel && (
            <span
              className="inline-flex items-center gap-1.5 font-black"
              style={{ color: 'var(--ck-accent-bright)' }}
            >
              <Icon name="event" className="!text-base" />
              <span className="text-base tracking-tight">{dateLabel}</span>
            </span>
          )}
          {timeLabel && (
            <>
              <span style={{ color: 'rgba(239,68,68,0.4)' }}>·</span>
              <span
                className="inline-flex items-center gap-1 font-bold"
                style={{ color: 'var(--ck-accent-bright)' }}
              >
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

            <div className="flex items-center justify-between gap-2 mt-2">
              {ctaHandler ? (
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
              ) : <span />}

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
                Using local fallback ({error})
              </p>
            )}
          </div>
        )
      )}
    </section>
  )
}
