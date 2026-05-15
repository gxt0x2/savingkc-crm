'use client'

import { useState, useRef, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import Link from 'next/link'
import type { ActivityType } from '@/types'
import { getAgentProfile } from '@/lib/agent-profiles'
import { useCardCollapse } from '@/hooks/use-card-collapse'

interface FeedItem {
  id: string
  type: ActivityType
  title: string
  content?: string
  timestamp: string
  statusBadge?: string
  dispositionLabel?: string
  dispositionTone?: 'positive' | 'neutral' | 'negative'
  direction?: 'inbound' | 'outbound'
  link?: string
  linkLabel?: string
  recordingUrl?: string
  recordingSid?: string
  rawType?: string
  agentName?: string
  metadata?: Record<string, unknown>
}

interface ActivityFeedProps {
  activities: FeedItem[]
  leadPhone?: string
  leadEmail?: string
  leadId?: string
  prominent?: boolean
  onCompose?: (type: 'call' | 'sms' | 'email') => void
  onEditNote?: (noteId: string, currentContent: string) => void
  onEditTask?: (taskId: string, currentTitle: string, metadata: Record<string, unknown>) => void
}

type ActivityFilter = 'all' | 'call' | 'sms' | 'email' | 'mail' | 'note'

const FILTERS: { key: ActivityFilter; label: string; matches: (raw: string) => boolean }[] = [
  { key: 'all',   label: 'All',    matches: () => true },
  { key: 'call',  label: 'Calls',  matches: (r) => r === 'call' },
  { key: 'sms',   label: 'Texts',  matches: (r) => r === 'sms' },
  { key: 'email', label: 'Emails', matches: (r) => r === 'email' },
  { key: 'mail',  label: 'Mail',   matches: (r) => r === 'letter_tracking' },
  { key: 'note',  label: 'Notes',  matches: (r) => r === 'note' },
]

// ─── Icon & tint per activity type ─────────────────────────────────────────
// Single accent color per category. Apple-style: subtle tint background, bold
// icon stroke. No multi-color dots — keeps the timeline calm.
const typeConfig: Record<string, { icon: string; tint: string; ink: string; label: string }> = {
  call:            { icon: 'phone',       tint: 'rgba(52,199,89,0.14)',  ink: '#34C759', label: 'Call' },
  sms:             { icon: 'chat_bubble', tint: 'rgba(48,209,88,0.14)',  ink: '#30D158', label: 'Text' },
  email:           { icon: 'mail',        tint: 'rgba(142,142,147,0.16)', ink: '#8E8E93', label: 'Email' },
  letter_tracking: { icon: 'inventory',   tint: 'rgba(255,159,10,0.16)', ink: '#FF9F0A', label: 'Mail' },
  note:            { icon: 'edit_note',   tint: 'rgba(175,82,222,0.14)', ink: '#AF52DE', label: 'Note' },
  voicemail:       { icon: 'voicemail',   tint: 'rgba(52,199,89,0.14)',  ink: '#34C759', label: 'Voicemail' },
  status_change:   { icon: 'sync_alt',    tint: 'rgba(227,46,46,0.14)',  ink: '#E32E2E', label: 'Status' },
  appointment:     { icon: 'event',       tint: 'rgba(227,46,46,0.14)',  ink: '#E32E2E', label: 'Appt' },
  task:            { icon: 'check',       tint: 'rgba(227,46,46,0.10)',  ink: '#E32E2E', label: 'Task' },
}

const MILESTONES = new Set(['status_change', 'appointment'])

// ─── Format timestamp (Apple-y: relative for recent, then absolute) ─────────
function relTime(ts: string): string {
  if (!ts) return ''
  try {
    const date = new Date(ts)
    if (isNaN(date.getTime())) return ''
    const now = Date.now()
    const diffMs = now - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'Now'
    if (diffMin < 60) return `${diffMin}m ago`

    // Once past 1 hour, always show the time of day next to the date marker.
    let h = date.getHours()
    const m = String(date.getMinutes()).padStart(2, '0')
    const ampm = h >= 12 ? 'pm' : 'am'
    h = h % 12 || 12
    const clock = `${h}:${m}${ampm}`

    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24 && date.getDate() === new Date().getDate()) {
      return clock
    }
    const diffDays = Math.floor(diffHr / 24)
    if (diffDays < 7) {
      return `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${clock}`
    }
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${clock}`
  } catch {
    return ''
  }
}

// ─── Recording Player (themed with ck-* tokens) ────────────────────────────
function CallRecordingPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const resolve = async () => {
      try {
        if (url.includes('/storage/v1/object/public/recordings/')) {
          const path = url.split('/storage/v1/object/public/recordings/')[1]
          const res = await fetch(`/api/recordings?path=${encodeURIComponent(path)}`)
          if (!res.ok) throw new Error('failed')
          const data = await res.json()
          setResolvedUrl(data.url)
        } else {
          setResolvedUrl(url)
        }
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    resolve()
  }, [url])

  const togglePlay = () => {
    const a = audioRef.current
    if (!a || !resolvedUrl) return
    if (playing) a.pause()
    else a.play()
  }

  const cycleSpeed = () => {
    const a = audioRef.current
    const next = speed >= 2 ? 1 : speed + 0.5
    setSpeed(next)
    if (a) a.playbackRate = next
  }

  const fmt = (s: number) => {
    if (!Number.isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div
        className="mt-3 rounded-xl px-3 py-2 text-[12px] animate-pulse"
        style={{ background: 'var(--ck-surface-elev)', color: 'var(--ck-text-muted)' }}
      >
        Loading recording…
      </div>
    )
  }
  if (error || !resolvedUrl) {
    return (
      <div
        className="mt-3 rounded-xl px-3 py-2 text-[12px]"
        style={{ background: 'var(--ck-surface-elev)', color: 'var(--ck-text-muted)' }}
      >
        Recording unavailable
      </div>
    )
  }

  return (
    <div
      className="mt-3 rounded-xl p-3 flex items-center gap-3"
      style={{ background: 'var(--ck-surface-elev)', border: '1px solid var(--ck-border)' }}
    >
      <audio
        ref={audioRef}
        src={resolvedUrl}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0) }}
        onTimeUpdate={() => {
          const a = audioRef.current
          if (a) setProgress(a.duration ? a.currentTime / a.duration : 0)
        }}
        onLoadedMetadata={() => {
          const a = audioRef.current
          if (a) setDuration(a.duration)
        }}
      />
      <button
        type="button"
        onClick={togglePlay}
        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95"
        style={{
          background: '#E32E2E',
          color: 'white',
          boxShadow: '0 2px 8px rgba(227,46,46,0.35)',
        }}
        aria-label={playing ? 'Pause recording' : 'Play recording'}
      >
        <Icon name={playing ? 'pause' : 'play_arrow'} size="text-xl" filled />
      </button>
      <div className="flex-1 min-w-0">
        <div
          className="w-full h-1 rounded-full cursor-pointer overflow-hidden"
          style={{ background: 'var(--ck-border)' }}
          onClick={(e) => {
            const a = audioRef.current
            if (!a) return
            const rect = e.currentTarget.getBoundingClientRect()
            const pct = (e.clientX - rect.left) / rect.width
            a.currentTime = pct * a.duration
          }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${progress * 100}%`, background: '#E32E2E' }}
          />
        </div>
        <div
          className="flex justify-between text-[11px] mt-1 tabular-nums"
          style={{ color: 'var(--ck-text-muted)' }}
        >
          <span>{fmt(progress * duration)}</span>
          <span>{fmt(duration)}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={cycleSpeed}
        className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold tabular-nums transition-colors"
        style={{
          background: 'var(--ck-surface)',
          color: 'var(--ck-text)',
          border: '1px solid var(--ck-border)',
        }}
      >
        {speed}×
      </button>
    </div>
  )
}

// ─── Direction badge (↗ outbound · ↙ inbound) ──────────────────────────────
function DirectionBadge({ direction }: { direction: 'inbound' | 'outbound' }) {
  const isOut = direction === 'outbound'
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md"
      style={{
        background: isOut ? 'rgba(227,46,46,0.10)' : 'rgba(52,199,89,0.14)',
        color: isOut ? '#E32E2E' : '#0F7A2F',
      }}
      title={isOut ? 'Outbound' : 'Inbound'}
    >
      <Icon name={isOut ? 'north_east' : 'south_west'} size="text-[11px]" filled />
      {isOut ? 'Out' : 'In'}
    </span>
  )
}

// ─── Disposition chip ──────────────────────────────────────────────────────
function DispoChip({ label, tone }: { label: string; tone?: 'positive' | 'neutral' | 'negative' }) {
  const palette =
    tone === 'positive'
      ? { bg: 'rgba(52,199,89,0.14)',  fg: '#0F7A2F' }
      : tone === 'negative'
      ? { bg: 'rgba(227,46,46,0.12)',  fg: '#E32E2E' }
      : { bg: 'rgba(142,142,147,0.16)', fg: 'var(--ck-text-muted)' }
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: palette.bg, color: palette.fg }}
    >
      {label}
    </span>
  )
}

// ─── Agent badge ───────────────────────────────────────────────────────────
function AgentInitial({ name }: { name: string }) {
  const profile = getAgentProfile(name)
  if (name === 'System' || profile.initials === 'SYS') return null
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ background: 'var(--ck-surface-elev)', color: 'var(--ck-text-muted)' }}
    >
      {profile.initials}
    </span>
  )
}

// ─── Comms quick-action bar (Apple-style segmented call to action) ─────────
function CommsBar({ onAction }: { onAction: (type: 'call' | 'sms' | 'email') => void }) {
  return (
    <div className="grid grid-cols-3 gap-2 mb-4">
      <button
        type="button"
        onClick={() => onAction('call')}
        className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-transform active:scale-[0.98]"
        style={{
          background: '#E32E2E',
          color: 'white',
          boxShadow: '0 2px 10px rgba(227,46,46,0.28)',
        }}
      >
        <Icon name="phone" size="text-sm" filled />
        Call
      </button>
      <button
        type="button"
        onClick={() => onAction('sms')}
        className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
        style={{
          background: 'var(--ck-surface-elev)',
          color: 'var(--ck-text)',
          border: '1px solid var(--ck-border)',
        }}
      >
        <Icon name="chat_bubble" size="text-sm" filled />
        Text
      </button>
      <button
        type="button"
        onClick={() => onAction('email')}
        className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
        style={{
          background: 'var(--ck-surface-elev)',
          color: 'var(--ck-text)',
          border: '1px solid var(--ck-border)',
        }}
      >
        <Icon name="mail" size="text-sm" filled />
        Email
      </button>
    </div>
  )
}

// ─── Segmented filter (Apple-style) ────────────────────────────────────────
function SegmentedFilter({
  active,
  counts,
  onChange,
}: {
  active: ActivityFilter
  counts: Record<ActivityFilter, number>
  onChange: (key: ActivityFilter) => void
}) {
  return (
    <div
      className="flex items-center gap-1 p-1 rounded-full overflow-x-auto scrollbar-hide mb-3"
      style={{ background: 'var(--ck-surface-elev)', border: '1px solid var(--ck-border)' }}
    >
      {FILTERS.map((f) => {
        const selected = active === f.key
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => onChange(f.key)}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold transition-all ${
              selected ? 'shadow-sm' : ''
            }`}
            style={{
              background: selected ? 'var(--ck-surface)' : 'transparent',
              color: selected ? 'var(--ck-text)' : 'var(--ck-text-muted)',
            }}
          >
            <span>{f.label}</span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none tabular-nums"
              style={{
                background: selected ? 'var(--ck-surface-hi)' : 'transparent',
                color: selected ? 'var(--ck-text-muted)' : 'var(--ck-text-dim)',
              }}
            >
              {counts[f.key]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Row ───────────────────────────────────────────────────────────────────
function ActivityRow({
  activity,
  onEditNote,
  onEditTask,
}: {
  activity: FeedItem
  onEditNote?: (noteId: string, currentContent: string) => void
  onEditTask?: (taskId: string, currentTitle: string, metadata: Record<string, unknown>) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const rawType = activity.rawType || activity.type
  const cfg = typeConfig[rawType] || typeConfig.status_change
  const isMilestone = MILESTONES.has(rawType)
  const hasRecording = Boolean(activity.recordingUrl) && (rawType === 'call' || rawType === 'voicemail')
  const isCallOrSms = rawType === 'call' || rawType === 'sms' || rawType === 'email'
  const showDirection = isCallOrSms && (activity.direction === 'inbound' || activity.direction === 'outbound')

  return (
    <div
      className="group flex gap-3 items-start px-2 py-2 rounded-xl transition-colors"
      style={{ background: 'transparent' }}
    >
      {/* Icon badge */}
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: cfg.tint, color: cfg.ink }}
      >
        <Icon name={cfg.icon} size="text-lg" filled />
      </div>

      {/* Content column */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          {showDirection && activity.direction && <DirectionBadge direction={activity.direction} />}
          <span
            className="text-[14px] font-semibold leading-tight"
            style={{ color: 'var(--ck-text)' }}
          >
            {activity.title}
          </span>
          {activity.dispositionLabel && (
            <DispoChip label={activity.dispositionLabel} tone={activity.dispositionTone} />
          )}
          <span
            className="ml-auto text-[11px] tabular-nums whitespace-nowrap"
            style={{ color: 'var(--ck-text-dim)' }}
          >
            {relTime(activity.timestamp)}
          </span>
        </div>

        {activity.content && (
          <p
            className={`text-[13px] mt-1 ${isMilestone ? '' : 'leading-snug'}`}
            style={{ color: 'var(--ck-text-muted)' }}
          >
            {activity.content}
          </p>
        )}

        {/* Meta row: duration + agent (for calls) */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {activity.statusBadge && (
            <span className="text-[11px] tabular-nums" style={{ color: 'var(--ck-text-muted)' }}>
              {activity.statusBadge}
            </span>
          )}
          {activity.agentName && <AgentInitial name={activity.agentName} />}
          {hasRecording && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold transition-colors"
              style={{ color: '#E32E2E' }}
            >
              <Icon name={expanded ? 'expand_less' : 'play_circle'} size="text-sm" filled />
              {expanded ? 'Hide recording' : 'Play recording'}
            </button>
          )}
          {activity.rawType === 'note' && onEditNote && (
            <button
              type="button"
              onClick={() => onEditNote(activity.id, activity.content || '')}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] inline-flex items-center gap-1"
              style={{ color: 'var(--ck-text-muted)' }}
              title="Edit note"
            >
              <Icon name="edit" size="text-xs" />
              Edit
            </button>
          )}
          {activity.rawType === 'task' && onEditTask && (
            <button
              type="button"
              onClick={() => onEditTask(activity.id, activity.title, activity.metadata || {})}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] inline-flex items-center gap-1"
              style={{ color: 'var(--ck-text-muted)' }}
              title="Edit task"
            >
              <Icon name="edit" size="text-xs" />
              Edit
            </button>
          )}
        </div>

        {hasRecording && expanded && activity.recordingUrl && (
          <CallRecordingPlayer url={activity.recordingUrl} />
        )}

        {activity.link && (
          <Link
            href={activity.link}
            className="inline-flex items-center gap-1 text-[11px] font-semibold mt-1 hover:underline"
            style={{ color: 'var(--ck-text-muted)' }}
          >
            <Icon name="arrow_forward" size="text-[11px]" />
            {activity.linkLabel || 'View'}
          </Link>
        )}
      </div>
    </div>
  )
}

// ─── Main ──────────────────────────────────────────────────────────────────
export function ActivityFeed({
  activities,
  prominent = false,
  onCompose,
  onEditNote,
  onEditTask,
}: ActivityFeedProps) {
  const [open, toggleOpen] = useCardCollapse('activity-feed', prominent)
  const [filter, setFilter] = useState<ActivityFilter>('all')

  const counts: Record<ActivityFilter, number> = {
    all:   activities.length,
    call:  activities.filter((a) => (a.rawType || a.type) === 'call').length,
    sms:   activities.filter((a) => (a.rawType || a.type) === 'sms').length,
    email: activities.filter((a) => (a.rawType || a.type) === 'email').length,
    mail:  activities.filter((a) => (a.rawType || a.type) === 'letter_tracking').length,
    note:  activities.filter((a) => (a.rawType || a.type) === 'note').length,
  }
  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]
  const filtered = activities.filter((a) => activeFilter.matches(a.rawType || a.type))
  const visible = prominent || open

  const handleAction = (type: 'call' | 'sms' | 'email') => onCompose?.(type)

  return (
    <section
      className="rounded-2xl p-5 border"
      style={{
        background: 'var(--ck-surface)',
        borderColor: 'var(--ck-border)',
        boxShadow: prominent ? '0 1px 2px rgba(0,0,0,0.04), 0 6px 16px rgba(0,0,0,0.05)' : undefined,
      }}
    >
      {/* Header */}
      {prominent ? (
        <div className="w-full flex justify-between items-center mb-4">
          <h2
            className="text-[17px] font-bold tracking-tight"
            style={{ color: 'var(--ck-text)' }}
          >
            Activity
          </h2>
          <span className="text-[12px] font-medium" style={{ color: 'var(--ck-text-muted)' }}>
            {activities.length} {activities.length === 1 ? 'event' : 'events'}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={toggleOpen}
          className="w-full flex justify-between items-center mb-4"
        >
          <h2 className="ck-microlabel !text-[11px] !text-[color:var(--ck-text)]">Activity</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--ck-text-muted)' }}>
              {activities.length} events
            </span>
            <Icon
              name={open ? 'expand_less' : 'expand_more'}
              className="!text-base !text-[color:var(--ck-text-muted)]"
            />
          </div>
        </button>
      )}

      {!visible ? null : (
        <>
          <CommsBar onAction={handleAction} />
          <SegmentedFilter active={filter} counts={counts} onChange={setFilter} />

          {filtered.length === 0 ? (
            <p
              className="text-[13px] text-center py-10"
              style={{ color: 'var(--ck-text-muted)' }}
            >
              {filter === 'all'
                ? 'No activity recorded yet'
                : `No ${activeFilter.label.toLowerCase()} yet`}
            </p>
          ) : (
            <div className="-mx-2">
              {filtered.map((activity, idx) => (
                <div key={activity.id}>
                  <ActivityRow
                    activity={activity}
                    onEditNote={onEditNote}
                    onEditTask={onEditTask}
                  />
                  {idx < filtered.length - 1 && (
                    <div
                      className="mx-14 h-px"
                      style={{ background: 'var(--ck-border)', opacity: 0.5 }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
