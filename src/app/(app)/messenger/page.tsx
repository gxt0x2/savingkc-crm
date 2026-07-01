'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import { ScNav } from '@/components/smartercontact/sc-nav'
import { INBOX_FILTERS, type InboxFilterKey } from '@/lib/smartercontact/types'
import { formatPhone } from '@/lib/format'

interface Thread {
  id: string
  contact_phone: string
  contact_name: string | null
  sending_number: string | null
  last_body: string | null
  last_direction: 'inbound' | 'outbound' | null
  last_message_at: string | null
  unread_count: number
  is_read: boolean
  awaiting_reply: boolean
  missed_call: boolean
}

interface Msg {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  status: string
  created_at: string
  sending_number: string | null
}

interface QuickReply {
  id: string
  title: string
  body: string
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const d = Date.now() - new Date(iso).getTime()
  const m = Math.floor(d / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export default function MessengerPage() {
  const [filter, setFilter] = useState<InboxFilterKey>('all')
  const [threads, setThreads] = useState<Thread[]>([])
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Thread | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([])
  const [showQr, setShowQr] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [composePhone, setComposePhone] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadThreads = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ filter, ...(search ? { search } : {}) })
      const res = await fetch(`/api/sc/conversations?${params}`)
      const json = await res.json()
      if (res.ok) {
        setThreads(json.threads || [])
        setUnreadTotal(json.unreadTotal || 0)
      } else {
        setError(json.error || 'Failed to load')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filter, search])

  useEffect(() => {
    loadThreads()
  }, [loadThreads])

  useEffect(() => {
    fetch('/api/sc/quick-replies')
      .then((r) => r.json())
      .then((j) => setQuickReplies(j.quickReplies || []))
      .catch(() => {})
  }, [])

  const openThread = useCallback(async (t: Thread) => {
    setSelected(t)
    setMessages([])
    const res = await fetch(`/api/sc/conversations/${t.id}`)
    const json = await res.json()
    if (res.ok) setMessages(json.messages || [])
    // Mark read
    if (!t.is_read) {
      fetch(`/api/sc/conversations/${t.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read' }),
      }).then(() => {
        setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, is_read: true, unread_count: 0 } : x)))
        setUnreadTotal((n) => Math.max(0, n - (t.unread_count || 0)))
      })
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  async function send() {
    if (!selected || !draft.trim() || sending) return
    setSending(true)
    setError('')
    const optimistic: Msg = {
      id: `tmp-${Date.now()}`,
      direction: 'outbound',
      body: draft.trim(),
      status: 'queued',
      created_at: new Date().toISOString(),
      sending_number: selected.sending_number,
    }
    setMessages((m) => [...m, optimistic])
    const bodyText = draft.trim()
    setDraft('')
    try {
      const res = await fetch(`/api/sc/conversations/${selected.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', body: bodyText }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Send failed')
        setMessages((m) => m.filter((x) => x.id !== optimistic.id))
      } else {
        setMessages((m) =>
          m.map((x) => (x.id === optimistic.id ? { ...x, status: 'sent' } : x)),
        )
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  async function sendCompose() {
    if (!composePhone.trim() || !composeBody.trim()) return
    setError('')
    const res = await fetch('/api/sc/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: composePhone, body: composeBody }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error || 'Send failed')
    } else {
      setShowCompose(false)
      setComposePhone('')
      setComposeBody('')
      loadThreads()
    }
  }

  return (
    <div className="flex flex-col h-full">
      <ScNav />
      <div className="flex flex-1 min-h-0">
        {/* Filter rail */}
        <aside className="w-48 border-r border-[var(--ck-border)] p-3 flex flex-col gap-1 shrink-0">
          <button
            onClick={() => setShowCompose(true)}
            className="mb-2 flex items-center justify-center gap-1.5 rounded-lg bg-[#E32E2E] text-white text-sm font-bold py-2 hover:bg-[#c72828]"
          >
            <Icon name="add" size="text-lg" /> New
          </button>
          {INBOX_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setFilter(f.key)
                setSelected(null)
              }}
              className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
                filter === f.key
                  ? 'bg-[#E32E2E]/15 text-white'
                  : 'text-[var(--ck-text-muted)] hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2">
                <Icon name={f.icon} size="text-lg" className="text-[var(--ck-text-dim)]" />
                {f.label}
              </span>
              {f.key === 'unread' && unreadTotal > 0 && (
                <span className="rounded-full bg-[#E32E2E] text-white text-xs px-1.5 py-0.5 min-w-5 text-center">
                  {unreadTotal}
                </span>
              )}
            </button>
          ))}
        </aside>

        {/* Thread list */}
        <section className="w-80 border-r border-[var(--ck-border)] flex flex-col shrink-0">
          <div className="p-2 border-b border-[var(--ck-border)]">
            <div className="flex items-center gap-2 rounded-lg bg-[var(--ck-surface)] px-2">
              <Icon name="search" size="text-lg" className="text-[var(--ck-text-dim)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="bg-transparent py-2 text-sm outline-none flex-1 text-[var(--ck-text)]"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-sm text-[var(--ck-text-dim)]">Loading…</div>
            ) : threads.length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--ck-text-dim)]">
                No conversations
              </div>
            ) : (
              threads.map((t) => (
                <button
                  key={t.id}
                  onClick={() => openThread(t)}
                  className={`w-full text-left px-3 py-3 border-b border-[var(--ck-border)] hover:bg-white/5 ${
                    selected?.id === t.id ? 'bg-white/5' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm truncate ${!t.is_read ? 'font-bold text-white' : 'font-semibold text-[var(--ck-text)]'}`}>
                      {t.contact_name || formatPhone(t.contact_phone)}
                    </span>
                    <span className="text-xs text-[var(--ck-text-dim)] shrink-0">
                      {timeAgo(t.last_message_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {t.last_direction === 'outbound' && (
                      <Icon name="reply" size="text-sm" className="text-[var(--ck-text-dim)] rotate-180" />
                    )}
                    {t.missed_call && (
                      <Icon name="phone_missed" size="text-sm" className="text-[#E32E2E]" />
                    )}
                    <span className="text-xs text-[var(--ck-text-muted)] truncate">
                      {t.last_body || '—'}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        {/* Thread view */}
        <section className="flex-1 flex flex-col min-w-0">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--ck-text-dim)]">
              <Icon name="chat" size="text-6xl" className="text-[var(--ck-text-dim)] mb-2" />
              <p className="text-sm">Select a conversation</p>
            </div>
          ) : (
            <>
              <header className="px-4 py-3 border-b border-[var(--ck-border)] flex items-center justify-between">
                <div>
                  <div className="font-bold text-white">
                    {selected.contact_name || formatPhone(selected.contact_phone)}
                  </div>
                  <div className="text-xs text-[var(--ck-text-dim)]">
                    {formatPhone(selected.contact_phone)}
                    {selected.sending_number && ` · via ${formatPhone(selected.sending_number)}`}
                  </div>
                </div>
              </header>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${
                      m.direction === 'outbound'
                        ? 'self-end bg-[#E32E2E] text-white'
                        : 'self-start bg-[var(--ck-surface)] text-[var(--ck-text)]'
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div className={`text-[10px] mt-1 ${m.direction === 'outbound' ? 'text-white/70' : 'text-[var(--ck-text-dim)]'}`}>
                      {new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      {m.direction === 'outbound' && ` · ${m.status}`}
                    </div>
                  </div>
                ))}
              </div>

              {error && (
                <div className="px-4 py-2 text-xs text-[#E32E2E] bg-[#E32E2E]/10">{error}</div>
              )}

              <div className="border-t border-[var(--ck-border)] p-3 relative">
                {showQr && quickReplies.length > 0 && (
                  <div className="absolute bottom-full left-3 mb-1 w-72 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] shadow-lg max-h-64 overflow-y-auto z-10">
                    {quickReplies.map((qr) => (
                      <button
                        key={qr.id}
                        onClick={() => {
                          setDraft((d) => (d ? d + ' ' : '') + qr.body)
                          setShowQr(false)
                        }}
                        className="block w-full text-left px-3 py-2 hover:bg-white/5 border-b border-[var(--ck-border)]"
                      >
                        <div className="text-sm font-semibold text-[var(--ck-text)]">{qr.title}</div>
                        <div className="text-xs text-[var(--ck-text-dim)] truncate">{qr.body}</div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <button
                    onClick={() => setShowQr((v) => !v)}
                    title="Quick replies"
                    className="p-2 rounded-lg hover:bg-white/5 text-[var(--ck-text-dim)]"
                  >
                    <Icon name="bolt" size="text-xl" />
                  </button>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        send()
                      }
                    }}
                    rows={1}
                    placeholder="Type a message…"
                    className="flex-1 resize-none rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)] max-h-32"
                  />
                  <button
                    onClick={send}
                    disabled={!draft.trim() || sending}
                    className="p-2 rounded-lg bg-[#E32E2E] text-white disabled:opacity-40 hover:bg-[#c72828]"
                  >
                    <Icon name="send" size="text-xl" />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCompose(false)}>
          <div
            className="w-96 rounded-xl bg-[var(--ck-bg)] border border-[var(--ck-border)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-white mb-3">New conversation</h3>
            <input
              value={composePhone}
              onChange={(e) => setComposePhone(e.target.value)}
              placeholder="Phone number"
              className="w-full mb-2 rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)]"
            />
            <textarea
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              placeholder="Message"
              rows={3}
              className="w-full mb-3 rounded-lg bg-[var(--ck-surface)] border border-[var(--ck-border)] px-3 py-2 text-sm outline-none text-[var(--ck-text)] resize-none"
            />
            {error && <div className="text-xs text-[#E32E2E] mb-2">{error}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCompose(false)} className="px-3 py-2 text-sm text-[var(--ck-text-muted)]">
                Cancel
              </button>
              <button
                onClick={sendCompose}
                disabled={!composePhone.trim() || !composeBody.trim()}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-[#E32E2E] text-white disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
