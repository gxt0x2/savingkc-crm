// Ari Chat — talk to Ari about this lead. Ari answers from the lead's manifest.

'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface AriChatProps {
  leadId: string
  leadName?: string | null
  /** When true, applies a subtle pulsing accent border to draw the eye. */
  attention?: boolean
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTED_PROMPTS = [
  'What should I ask next?',
  'What do we know about their motivation?',
  "What's the biggest risk on this deal?",
  'Summarize this lead in 3 bullets.',
]

export function AriChat({ leadId, leadName, attention }: AriChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (expanded) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, expanded])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    const next = [...messages, { role: 'user' as const, content: trimmed }]
    setMessages(next)
    setInput('')
    setLoading(true)
    setExpanded(true)

    try {
      const res = await fetch('/api/ari/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, messages: next }),
      })
      const data = await res.json()
      const reply = data.reply || data.error || 'No response.'
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Network error. Try again.' }])
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <section
      className={`rounded-2xl p-5 border ${attention ? 'ck-attention' : ''}`}
      style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon name="smart_toy" className="!text-base !text-[color:var(--ck-accent)]" />
        <h2 className="ck-microlabel !text-[11px] !text-[color:var(--ck-text)]">Ask Ari</h2>
        {messages.length > 0 && (
          <button
            onClick={() => { setMessages([]); setExpanded(false) }}
            className="ml-auto text-[10px] font-bold hover:underline"
            style={{ color: 'var(--ck-text-muted)' }}
          >
            Clear
          </button>
        )}
      </div>

      {messages.length === 0 ? (
        <p className="text-xs mb-3" style={{ color: 'var(--ck-text-muted)' }}>
          Ask anything about {leadName || 'this lead'}. Ari answers from the manifest.
        </p>
      ) : (
        <div
          className={`space-y-2 mb-3 overflow-y-auto pr-1 transition-all ${expanded ? 'max-h-80' : 'max-h-40'}`}
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={`text-xs leading-snug rounded-lg px-2.5 py-1.5 ${m.role === 'user' ? 'ml-4' : 'mr-4'}`}
              style={{
                background: m.role === 'user' ? 'var(--ck-surface-hi)' : 'var(--ck-surface-elev)',
                color: 'var(--ck-text)',
                border: '1px solid var(--ck-border)',
              }}
            >
              <p className="ck-microlabel !text-[9px] mb-0.5">
                {m.role === 'user' ? 'You' : 'Ari'}
              </p>
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          ))}
          {loading && (
            <div className="text-[11px] flex items-center gap-2 pl-2" style={{ color: 'var(--ck-text-muted)' }}>
              <div
                className="w-2.5 h-2.5 border-2 rounded-full animate-spin"
                style={{ borderColor: 'rgba(239,68,68,0.3)', borderTopColor: 'var(--ck-accent)' }}
              />
              Ari is thinking…
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => send(p)}
              disabled={loading}
              className="text-[10px] px-2 py-1 rounded-full border transition-colors hover:bg-white/5 disabled:opacity-50"
              style={{ borderColor: 'var(--ck-border-strong)', color: 'var(--ck-text-muted)' }}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask Ari about this lead…"
          rows={2}
          disabled={loading}
          className="flex-1 min-w-0 resize-none rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[color:var(--ck-accent)] disabled:opacity-60"
          style={{
            background: 'var(--ck-surface-elev)',
            border: '1px solid var(--ck-border)',
            color: 'var(--ck-text)',
          }}
        />
        <button
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
          className="shrink-0 h-8 w-8 rounded-lg flex items-center justify-center disabled:opacity-40 transition-opacity"
          style={{ background: 'var(--ck-accent)', color: '#fff' }}
          title="Send"
        >
          <Icon name="send" className="!text-sm" />
        </button>
      </div>
    </section>
  )
}
