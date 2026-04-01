'use client'

import { useState, useRef, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import Link from 'next/link'
import type { ActivityType } from '@/types'
import { getAgentProfile } from '@/lib/agent-profiles'

interface FeedItem {
  id: string
  type: ActivityType
  title: string
  content?: string
  timestamp: string
  statusBadge?: string
  link?: string
  linkLabel?: string
  recordingUrl?: string
  rawType?: string
  agentName?: string   // Who performed this action
}

interface ActivityFeedProps {
  activities: FeedItem[]
  leadPhone?: string
  leadEmail?: string
  leadId?: string
  onCompose?: (type: 'call' | 'sms' | 'email') => void
}

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
  sms:           { icon: 'sms',         dotColor: 'bg-blue-500',    label: 'SMS' },
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

// ─── Relative time ──────────────────────────────────────────────────────────
function relTime(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    if (d < 7) return `${d}d ago`
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return ts }
}

// ─── Agent Badge ────────────────────────────────────────────────────────────
function AgentBadge({ name }: { name: string }) {
  const profile = getAgentProfile(name)
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${profile.color} ${profile.textColor}`}>
      {profile.initials}
      <span className="opacity-80 font-medium">{profile.name}</span>
    </span>
  )
}

// ─── Comms Hub Quick-Action Bar ─────────────────────────────────────────────
function CommsBar({ onAction }: { onAction: (type: 'call' | 'sms' | 'email') => void }) {
  return (
    <div className="flex gap-2 mb-5">
      <button
        onClick={() => onAction('call')}
        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-600/15 hover:bg-green-600/25 border border-green-600/20 text-green-400 text-xs font-bold transition-all"
      >
        <Icon name="call" size="text-sm" />
        Call
      </button>
      <button
        onClick={() => onAction('sms')}
        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 border border-blue-600/20 text-blue-400 text-xs font-bold transition-all"
      >
        <Icon name="sms" size="text-sm" />
        Text
      </button>
      <button
        onClick={() => onAction('email')}
        className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-purple-600/15 hover:bg-purple-600/25 border border-purple-600/20 text-purple-400 text-xs font-bold transition-all"
      >
        <Icon name="email" size="text-sm" />
        Email
      </button>
    </div>
  )
}

// ─── Main Feed ──────────────────────────────────────────────────────────────
export function ActivityFeed({ activities, onCompose }: ActivityFeedProps) {
  const handleAction = (type: 'call' | 'sms' | 'email') => {
    onCompose?.(type)
  }

  return (
    <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-5 shadow-sm">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-sm font-black uppercase tracking-widest text-primary">
          Communications
        </h2>
        <span className="text-xs text-on-surface-variant">{activities.length} events</span>
      </div>

      {/* Quick action bar */}
      <CommsBar onAction={handleAction} />

      {/* Timeline */}
      {activities.length === 0 ? (
        <p className="text-sm text-on-surface-variant italic text-center py-6">No activity recorded yet</p>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-outline-variant/20" />

          <div className="space-y-4">
            {activities.map((activity, i) => {
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
                    <div className="flex-1 min-w-0 pb-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-on-surface leading-snug">{activity.title}</span>
                        {activity.agentName && (
                          <AgentBadge name={activity.agentName} />
                        )}
                        <span className="text-[10px] text-on-surface-variant whitespace-nowrap ml-auto">{relTime(activity.timestamp)}</span>
                      </div>
                      {activity.content && (
                        <p className={`text-xs mt-0.5 ${activity.type === 'sms' ? 'text-blue-300 italic' : 'text-on-surface-variant'}`}>
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
    </section>
  )
}
