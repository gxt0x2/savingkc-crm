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
  link?: string
  linkLabel?: string
  recordingUrl?: string
  rawType?: string
  agentName?: string   // Who performed this action
  metadata?: Record<string, unknown>
}

interface ActivityFeedProps {
  activities: FeedItem[]
  leadPhone?: string
  leadEmail?: string
  leadId?: string
  /** When true, renders without the collapsible header (prominent placement). */
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

// ─── Recording Player (with signed URL fetching) ───────────────────────────
function CallRecordingPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    // If URL is a Supabase storage URL, get signed URL
    const fetchSigned = async () => {
      try {
        if (url.includes('/storage/v1/object/public/recordings/')) {
          const path = url.split('/storage/v1/object/public/recordings/')[1]
          const res = await fetch(`/api/recordings?path=${encodeURIComponent(path)}`)
          if (!res.ok) throw new Error('failed')
          const data = await res.json()
          setSignedUrl(data.url)
        } else {
          setSignedUrl(url)
        }
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    fetchSigned()
  }, [url])

  const togglePlay = () => {
    const a = audioRef.current
    if (!a || !signedUrl) return
    if (playing) { a.pause() } else { a.play() }
  }

  const cycleSpeed = () => {
    const a = audioRef.current
    const next = speed >= 2 ? 1 : speed + 0.5
    setSpeed(next)
    if (a) a.playbackRate = next
  }

  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  if (loading) return <div className="mt-2 text-xs text-on-surface-variant animate-pulse">Loading recording…</div>
  if (error || !signedUrl) return <div className="mt-2 text-xs text-error">Recording unavailable</div>

  return (
    <div className="mt-2 bg-green-950/30 border border-green-700/30 rounded-xl p-3">
      <audio
        ref={audioRef}
        src={signedUrl}
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
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="w-8 h-8 rounded-full bg-green-600 hover:bg-green-500 text-white flex items-center justify-center transition-colors shrink-0"
        >
          <Icon name={playing ? 'pause' : 'play_arrow'} size="text-sm" />
        </button>
        <div className="flex-1 flex flex-col gap-1">
          <div
            className="w-full h-1.5 bg-green-900/40 rounded-full cursor-pointer"
            onClick={(e) => {
              const a = audioRef.current
              if (!a) return
              const rect = e.currentTarget.getBoundingClientRect()
              const pct = (e.clientX - rect.left) / rect.width
              a.currentTime = pct * a.duration
            }}
          >
            <div
              className="h-full bg-green-400 rounded-full transition-all"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-green-400/70">
            <span>{fmt(progress * duration)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>
        <button
          onClick={cycleSpeed}
          className="text-[10px] font-bold text-green-400 bg-green-900/40 px-2 py-0.5 rounded-full hover:bg-green-800/50 transition-colors shrink-0"
        >
          {speed}×
        </button>
      </div>
    </div>
  )
}

// ─── Icon config per type ───────────────────────────────────────────────────
const typeConfig: Record<string, { icon: string; dotColor: string; label: string }> = {
  sms:           { icon: 'sms',         dotColor: 'bg-emerald-500', label: 'SMS' },
  call:          { icon: 'call',        dotColor: 'bg-green-500',   label: 'Call' },
  email:         { icon: 'email',       dotColor: 'bg-purple-500',  label: 'Email' },
  status_change: { icon: 'sync_alt',    dotColor: 'bg-slate-500',   label: 'Status' },
  note:          { icon: 'sticky_note_2', dotColor: 'bg-amber-500', label: 'Note' },
  appointment:   { icon: 'event',       dotColor: 'bg-teal-500',    label: 'Appt' },
  letter_tracking: { icon: 'mail',      dotColor: 'bg-pink-500',    label: 'Letter' },
  task:          { icon: 'task_alt',    dotColor: 'bg-orange-500',  label: 'Task' },
}

// ─── Milestone types (bigger cards) ────────────────────────────────────────
const MILESTONES = new Set(['status_change', 'appointment'])

// ─── Format timestamp ───────────────────────────────────────────────────────
function relTime(ts: string): string {
  if (!ts) return 'No date'

  try {
    const date = new Date(ts)

    // Validate date
    if (isNaN(date.getTime())) {
      return 'Invalid date'
    }

    // Format as: MM/DD/YY, HH:MMam/pm
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const year = String(date.getFullYear()).slice(-2)

    let hours = date.getHours()
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const ampm = hours >= 12 ? 'pm' : 'am'
    hours = hours % 12 || 12

    return `${month}/${day}/${year}, ${hours}:${minutes}${ampm}`
  } catch {
    return 'Invalid date'
  }
}

// ─── Agent Badge ────────────────────────────────────────────────────────────
function AgentBadge({ name }: { name: string }) {
  const profile = getAgentProfile(name)
  const isSystem = name === 'System' || profile.initials === 'SYS'

  if (isSystem) {
    return (
      <span className={`inline-flex items-center text-[9px] font-bold px-1 py-0.5 rounded-full ${profile.color} ${profile.textColor}`}>
        {profile.initials}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${profile.color} ${profile.textColor}`}>
      {profile.initials}
      <span className="opacity-80 font-medium">{profile.name}</span>
    </span>
  )
}

// ─── Comms Hub Quick-Action Bar ─────────────────────────────────────────────
function CommsBar({ onAction }: { onAction: (type: 'call' | 'sms' | 'email') => void }) {
  const baseCls =
    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-xs font-bold transition-all'
  const neutralStyle = {
    background: 'var(--ck-surface-elev)',
    borderColor: 'var(--ck-border)',
    color: 'var(--ck-text)',
  } as const
  const primaryStyle = {
    background: 'var(--ck-accent)',
    borderColor: 'var(--ck-accent)',
    color: 'white',
    boxShadow: '0 4px 16px rgba(239,68,68,0.22)',
  } as const
  return (
    <div className="flex gap-2 mb-5">
      <button onClick={() => onAction('call')} className={baseCls} style={primaryStyle}>
        <Icon name="call" size="text-sm" />
        Call
      </button>
      <button onClick={() => onAction('sms')} className={baseCls} style={neutralStyle}>
        <Icon name="sms" size="text-sm" />
        Text
      </button>
      <button onClick={() => onAction('email')} className={baseCls} style={neutralStyle}>
        <Icon name="email" size="text-sm" />
        Email
      </button>
    </div>
  )
}

// ─── Apple-style Segmented Filter ──────────────────────────────────────────
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
      className="flex items-center gap-1 p-1 rounded-full overflow-x-auto scrollbar-hide mb-4"
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
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none"
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

// ─── Main Feed ──────────────────────────────────────────────────────────────
export function ActivityFeed({ activities, prominent = false, onCompose, onEditNote, onEditTask }: ActivityFeedProps) {
  const [hoveredNote, setHoveredNote] = useState<string | null>(null)
  const [hoveredTask, setHoveredTask] = useState<string | null>(null)
  const [open, toggleOpen] = useCardCollapse('activity-feed', prominent)
  const [filter, setFilter] = useState<ActivityFilter>('all')

  const handleAction = (type: 'call' | 'sms' | 'email') => {
    onCompose?.(type)
  }

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

  return (
    <section
      className="rounded-2xl p-5 border"
      style={{
        background: 'var(--ck-surface)',
        borderColor: 'var(--ck-border)',
        boxShadow: prominent ? '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.04)' : undefined,
      }}
    >
      {/* Header */}
      {prominent ? (
        <div className="w-full flex justify-between items-center mb-4">
          <h2 className="text-[17px] font-bold tracking-tight" style={{ color: 'var(--ck-text)' }}>
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
      {/* Quick action bar */}
      <CommsBar onAction={handleAction} />

      {/* Segmented filter */}
      <SegmentedFilter active={filter} counts={counts} onChange={setFilter} />

      {/* Timeline */}
      {filtered.length === 0 ? (
        <p className="text-sm text-center py-8" style={{ color: 'var(--ck-text-muted)' }}>
          {filter === 'all' ? 'No activity recorded yet' : `No ${activeFilter.label.toLowerCase()} yet`}
        </p>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-outline-variant/20" />

          <div className="space-y-4">
            {filtered.map((activity) => {
              const cfg = typeConfig[activity.rawType || activity.type] || typeConfig.status_change
              const isMilestone = MILESTONES.has(activity.rawType || activity.type)

              return (
                <div key={activity.id} className="flex gap-3 relative">
                  {/* Dot */}
                  <div className={`w-[22px] h-[22px] rounded-full ${cfg.dotColor} flex items-center justify-center shrink-0 mt-0.5 z-10 shadow-sm`}>
                    <Icon name={cfg.icon} size="text-[11px]" className="text-white" />
                  </div>

                  {/* Card */}
                  {isMilestone ? (
                    // Milestone card (status changes, appointments)
                    <div className="flex-1 bg-surface-container rounded-xl px-3 py-2.5 border border-outline-variant/10 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-bold text-on-surface">{activity.title}</span>
                        {activity.agentName && <AgentBadge name={activity.agentName} />}
                        {activity.statusBadge && (
                          <span className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary rounded-full font-bold">
                            {activity.statusBadge}
                          </span>
                        )}
                        <span className="text-[10px] text-on-surface-variant ml-auto">{relTime(activity.timestamp)}</span>
                      </div>
                      {activity.content && (
                        <p className="text-xs text-on-surface-variant mt-1">{activity.content}</p>
                      )}
                    </div>
                  ) : (
                    // Regular entry
                    <div
                      className="flex-1 min-w-0 pb-1 group"
                      onMouseEnter={() => {
                        if (activity.rawType === 'note') setHoveredNote(activity.id)
                        if (activity.rawType === 'task') setHoveredTask(activity.id)
                      }}
                      onMouseLeave={() => {
                        setHoveredNote(null)
                        setHoveredTask(null)
                      }}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-on-surface leading-snug">{activity.title}</span>
                        {activity.dispositionLabel && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                            activity.dispositionTone === 'negative'
                              ? 'bg-red-500/10 text-red-400 border-red-500/20'
                              : activity.dispositionTone === 'positive'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          }`}>
                            {activity.dispositionLabel}
                          </span>
                        )}
                        {activity.statusBadge && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            activity.statusBadge === 'No answer' || activity.statusBadge === 'Busy'
                              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                              : 'bg-green-500/10 text-green-400 border border-green-500/20'
                          }`}>
                            {activity.statusBadge}
                          </span>
                        )}
                        {activity.agentName && (
                          <AgentBadge name={activity.agentName} />
                        )}
                        <span className="text-[10px] text-on-surface-variant whitespace-nowrap ml-auto">{relTime(activity.timestamp)}</span>
                        {activity.rawType === 'note' && onEditNote && hoveredNote === activity.id && (
                          <button
                            onClick={() => onEditNote(activity.id, activity.content || '')}
                            className="text-on-surface-variant/60 hover:text-primary transition-colors p-1"
                            title="Edit note"
                          >
                            <Icon name="edit" size="text-xs" />
                          </button>
                        )}
                        {activity.rawType === 'task' && onEditTask && hoveredTask === activity.id && (
                          <button
                            onClick={() => onEditTask(activity.id, activity.title, activity.metadata || {})}
                            className="text-on-surface-variant/60 hover:text-primary transition-colors p-1"
                            title="Edit task"
                          >
                            <Icon name="edit" size="text-xs" />
                          </button>
                        )}
                      </div>
                      {activity.content && (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--ck-text-muted)' }}>
                          {activity.content}
                        </p>
                      )}
                      {activity.recordingUrl && (
                        <CallRecordingPlayer url={activity.recordingUrl} />
                      )}
                      {activity.link && (
                        <Link
                          href={activity.link}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-secondary hover:underline mt-1"
                        >
                          <Icon name="arrow_forward" size="text-[10px]" />
                          {activity.linkLabel || 'View'}
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      </>
      )}
    </section>
  )
}
