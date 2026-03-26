/**
 * ARI CRM - Ari Briefing Panel
 * Night 3: Proactive Intelligence
 * ARI-02: Priority Stacking, ARI-03: Actionable Deep Links
 *
 * Real-time event-driven briefing with polling
 */

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import type { BriefingEvent, BriefingPriority } from '@/lib/ari-briefing'

const POLL_INTERVAL = 20000 // 20 seconds
const MAX_VISIBLE_EVENTS = 6

export function AriBriefingPanel() {
  const router = useRouter()
  const [events, setEvents] = useState<BriefingEvent[]>([])
  const [loading, setLoading] = useState(true)

  async function fetchEvents() {
    try {
      const res = await fetch('/api/ari/briefing?limit=10')
      const data = await res.json()
      setEvents(data.events || [])
      setLoading(false)
    } catch (error) {
      console.error('Failed to fetch briefing events:', error)
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEvents()
    const interval = setInterval(fetchEvents, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  async function handleEventClick(event: BriefingEvent) {
    // Mark as read
    if (event.id && !event.read) {
      await fetch('/api/ari/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-read', eventId: event.id }),
      })
    }

    // Navigate to action URL if present
    if (event.action_url) {
      router.push(event.action_url)
    }
  }

  async function handleDismiss(eventId: string, e: React.MouseEvent) {
    e.stopPropagation()

    await fetch('/api/ari/briefing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss', eventId }),
    })

    // Remove from local state immediately
    setEvents((prev) => prev.filter((ev) => ev.id !== eventId))
  }

  if (loading) {
    return (
      <div className="bg-primary-container rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_rgba(0,110,47,0.4)]" />
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-on-primary-container">
            Ari Briefing
          </h2>
        </div>
        <p className="text-sm text-on-surface-variant">Loading...</p>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="bg-primary-container rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_rgba(0,110,47,0.4)]" />
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-on-primary-container">
            Ari Briefing
          </h2>
        </div>
        <p className="text-sm text-on-surface-variant">
          All clear. No pending alerts.
        </p>
      </div>
    )
  }

  const visibleEvents = events.slice(0, MAX_VISIBLE_EVENTS)
  const hasMore = events.length > MAX_VISIBLE_EVENTS

  return (
    <div className="bg-primary-container rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_rgba(0,110,47,0.4)] animate-pulse" />
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-on-primary-container">
          Ari Briefing
        </h2>
        <span className="ml-auto text-xs text-on-surface-variant">
          {events.length} {events.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {visibleEvents.map((event) => (
          <BriefingEventCard
            key={event.id}
            event={event}
            onClick={() => handleEventClick(event)}
            onDismiss={(e) => event.id && handleDismiss(event.id, e)}
          />
        ))}
      </div>

      {hasMore && (
        <div className="mt-3 pt-3 border-t border-outline-variant/20 text-center">
          <p className="text-xs text-on-surface-variant">
            +{events.length - MAX_VISIBLE_EVENTS} more{' '}
            {events.length - MAX_VISIBLE_EVENTS === 1 ? 'event' : 'events'}
          </p>
        </div>
      )}
    </div>
  )
}

function BriefingEventCard({
  event,
  onClick,
  onDismiss,
}: {
  event: BriefingEvent
  onClick: () => void
  onDismiss: (e: React.MouseEvent) => void
}) {
  const priorityConfig = getPriorityConfig(event.priority)

  return (
    <div
      onClick={onClick}
      className={`
        relative group rounded-lg p-3 cursor-pointer transition-all
        ${priorityConfig.bgClass}
        ${event.action_url ? 'hover:opacity-80' : ''}
        ${event.read ? 'opacity-60' : ''}
      `}
    >
      {/* Priority Indicator */}
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${priorityConfig.iconColor}`}>
          <Icon name={priorityConfig.icon} size="text-base" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3 className="text-sm font-bold text-on-surface mb-1 flex items-center gap-2">
            {event.title}
            {!event.read && (
              <span className="w-1.5 h-1.5 rounded-full bg-secondary shadow-[0_0_4px_rgba(0,110,47,0.6)]" />
            )}
          </h3>

          {/* Description */}
          <p className="text-xs text-on-surface-variant leading-relaxed">
            {event.description}
          </p>

          {/* Timestamp */}
          <p className="text-[10px] text-on-surface-variant/60 mt-1">
            {formatTimestamp(event.created_at)}
          </p>
        </div>

        {/* Dismiss Button */}
        <button
          onClick={onDismiss}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-surface-variant rounded"
        >
          <Icon name="close" size="text-xs" className="text-on-surface-variant" />
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// HELPERS
// ============================================================================

function getPriorityConfig(priority: BriefingPriority): {
  bgClass: string
  iconColor: string
  icon: string
} {
  switch (priority) {
    case 'critical':
      return {
        bgClass: 'bg-error-container border border-error/20',
        iconColor: 'text-error',
        icon: 'warning',
      }
    case 'high':
      return {
        bgClass: 'bg-tertiary-container border border-tertiary/10',
        iconColor: 'text-tertiary',
        icon: 'priority_high',
      }
    case 'medium':
      return {
        bgClass: 'bg-surface-container-high border border-outline-variant/10',
        iconColor: 'text-secondary',
        icon: 'info',
      }
    case 'low':
      return {
        bgClass: 'bg-surface-container border border-outline-variant/5',
        iconColor: 'text-on-surface-variant',
        icon: 'check_circle',
      }
    default:
      return {
        bgClass: 'bg-surface-container',
        iconColor: 'text-on-surface-variant',
        icon: 'info',
      }
  }
}

function formatTimestamp(timestamp: string | undefined): string {
  if (!timestamp) return 'Just now'

  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString()
}
