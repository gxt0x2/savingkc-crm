'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Icon } from '@/components/ui/icon'
import Link from 'next/link'

interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  url: string | null
  is_read: boolean
  created_at: string
  metadata: Record<string, unknown>
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const typeIcons: Record<string, string> = {
  offer: 'gavel',
  sms: 'sms',
  call: 'call',
  appointment: 'event',
  system: 'info',
  info: 'info',
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=15')
      if (!res.ok) return
      const data = await res.json()
      setNotifications(data.notifications || [])
      setUnreadCount(data.unread_count || 0)
    } catch { /* ignore */ }
  }, [])

  // Poll every 30 seconds
  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30_000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function markAllRead() {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mark_all_read: true }),
    })
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
  }

  async function markRead(id: string) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); if (!open) fetchNotifications() }}
        className="relative w-10 h-10 rounded-lg bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] flex items-center justify-center transition-colors"
        aria-label="Notifications"
        title="Notifications"
      >
        <Icon name="notifications" size="text-xl" className="text-[var(--ck-text-muted)]" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-[#E32E2E] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 ring-2 ring-[var(--ck-surface)]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 ck-card shadow-2xl z-50 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ck-border)]">
            <h3 className="text-sm font-bold text-[var(--ck-text)]">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-[11px] font-medium text-[#E32E2E] hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[var(--ck-text-muted)]">
                No notifications yet
              </div>
            ) : (
              notifications.map(n => {
                const inner = (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer ${
                      !n.is_read ? 'bg-[#E32E2E]/5' : ''
                    }`}
                    onClick={() => { if (!n.is_read) markRead(n.id); setOpen(false) }}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      !n.is_read ? 'bg-[#E32E2E]/10 text-[#E32E2E]' : 'bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)]'
                    }`}>
                      <Icon name={typeIcons[n.type] || 'info'} size="text-base" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] leading-tight ${!n.is_read ? 'font-semibold text-[var(--ck-text)]' : 'text-[var(--ck-text-muted)]'}`}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-[12px] text-[var(--ck-text-dim)] mt-0.5 line-clamp-2">{n.body}</p>
                      )}
                      <p className="text-[11px] text-[var(--ck-text-dim)] mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                    {!n.is_read && (
                      <span className="w-2 h-2 rounded-full bg-[#E32E2E] flex-shrink-0 mt-1.5" />
                    )}
                  </div>
                )
                return n.url ? (
                  <Link key={n.id} href={n.url} className="block">
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
