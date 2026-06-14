'use client'

import { Icon } from '@/components/ui/icon'
import { formatPhone } from '@/lib/format'
import type { CommChannel, CommEvent, CommsSummary, OutcomeTone } from '@/lib/comms-timeline'

// The Communication Hub view — one clear, scannable record of who we contacted,
// how, when, and the outcome. Channel-agnostic so calls, SMS, email, and
// voicemail all read the same way.

function channelIcon(channel: CommChannel, direction: 'inbound' | 'outbound'): string {
  switch (channel) {
    case 'call': return direction === 'inbound' ? 'call_received' : 'call_made'
    case 'sms': return 'chat'
    case 'email': return 'mail'
    case 'voicemail': return 'voicemail'
    case 'letter': return 'markunread_mailbox'
  }
}

const TONE_CHIP: Record<OutcomeTone, string> = {
  positive: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400',
  negative: 'bg-[#E32E2E]/15 border-[#E32E2E]/35 text-[#ff7777]',
  neutral: 'bg-[var(--ck-surface-hi)] border-[var(--ck-border)] text-[var(--ck-text-muted)]',
}

function timeAgo(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const y = new Date(today); y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function durationLabel(sec: number | null): string | null {
  if (!sec) return null
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export function CommsSummaryBar({ summary }: { summary: CommsSummary }) {
  const reached = summary.lastReachedAt ? timeAgo(summary.lastReachedAt) : null
  const last = summary.lastContactAt ? timeAgo(summary.lastContactAt) : null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--ck-text-muted)]">
      <span className="inline-flex items-center gap-1"><Icon name="call" size="text-xs" className="text-[var(--ck-text-dim)]" />{summary.calls}</span>
      <span className="inline-flex items-center gap-1"><Icon name="chat" size="text-xs" className="text-[var(--ck-text-dim)]" />{summary.sms}</span>
      <span className="inline-flex items-center gap-1"><Icon name="mail" size="text-xs" className="text-[var(--ck-text-dim)]" />{summary.emails}</span>
      <span className="inline-flex items-center gap-1"><Icon name="voicemail" size="text-xs" className="text-[var(--ck-text-dim)]" />{summary.voicemails}</span>
      <span className="flex-1" />
      {reached
        ? <span className="text-emerald-400 font-semibold">Reached {reached}</span>
        : last
        ? <span>Last touch {last}</span>
        : <span>No contact yet</span>}
    </div>
  )
}

export function CommsTimeline({ events, emptyHint }: { events: CommEvent[]; emptyHint?: string }) {
  if (events.length === 0) {
    return <p className="text-xs text-[var(--ck-text-dim)] italic py-6 text-center">{emptyHint || 'No communications logged yet.'}</p>
  }

  // Group by day for scannability.
  const groups: { day: string; items: CommEvent[] }[] = []
  for (const e of events) {
    const day = dayKey(e.at)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(e)
    else groups.push({ day, items: [e] })
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.day}>
          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)] mb-2">{group.day}</p>
          <ul className="space-y-2">
            {group.items.map((e) => {
              const dur = durationLabel(e.durationSec)
              return (
                <li key={e.id} className="flex items-start gap-2.5">
                  <span className={`shrink-0 w-7 h-7 rounded-lg border flex items-center justify-center mt-0.5 ${
                    e.direction === 'inbound'
                      ? 'bg-cyan-500/10 border-cyan-500/25 text-cyan-300'
                      : 'bg-[var(--ck-surface-elev)] border-[var(--ck-border)] text-[var(--ck-text-muted)]'
                  }`}>
                    <Icon name={channelIcon(e.channel, e.direction)} size="text-sm" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[var(--ck-text)]">{e.title}</span>
                      {e.outcome && (
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${TONE_CHIP[e.outcomeTone]}`}>
                          {e.outcome}
                        </span>
                      )}
                      {dur && <span className="text-[10px] font-mono text-[var(--ck-text-dim)]">{dur}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[var(--ck-text-dim)]">
                      {e.contact && <span className="font-mono">{formatPhone(e.contact) || e.contact}</span>}
                      {e.agent && <span>· {e.agent}</span>}
                      <span>· {timeAgo(e.at)}</span>
                    </div>
                    {e.body && <p className="mt-1 text-[11px] text-[var(--ck-text-muted)] line-clamp-2 break-words">{e.body}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
