'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'
import { CONVERSATION_TWILIO_NUMBERS as TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { formatPhone } from '@/lib/format'

type ComposeMode = 'sms' | 'email' | 'note'

const modes: { key: ComposeMode; label: string; icon: string }[] = [
  { key: 'sms', label: 'SMS', icon: 'sms' },
  { key: 'email', label: 'Email', icon: 'mail' },
  { key: 'note', label: 'Internal note', icon: 'edit_note' },
]

interface ComposeBoxProps {
  leadId?: string
  phone?: string
  email?: string
  onSent?: () => void
  replyFromPhone?: string // Auto-select the Twilio number the lead last texted
  draftMessage?: string
  draftVersion?: number
  initialMode?: ComposeMode
}

export function ComposeBox({ leadId, phone, email, onSent, replyFromPhone, draftMessage, draftVersion, initialMode = 'sms' }: ComposeBoxProps) {
  const [activeMode, setActiveMode] = useState<ComposeMode>(initialMode)
  const [message, setMessage] = useState('')
  const [subject, setSubject] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fromPhone, setFromPhone] = useState(replyFromPhone || '+18163077835')
  const [templates, setTemplates] = useState<{id: string; name: string; category: string; body: string; merge_fields: string[]}[]>([])
  const [showTemplates, setShowTemplates] = useState(false)

  // Fetch templates on mount
  useEffect(() => {
    fetch('/api/sms-templates')
      .then(r => r.json())
      .then(data => setTemplates(data.templates || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (draftMessage) {
      setActiveMode('sms')
      setMessage(draftMessage)
    }
  }, [draftMessage, draftVersion])

  useEffect(() => {
    setActiveMode(initialMode)
  }, [initialMode])

  async function handleSend() {
    if (!message.trim()) return
    if (activeMode === 'sms' && !phone) { setError('No phone number for this contact'); return }
    if (activeMode === 'email' && !email) { setError('No email address for this contact'); return }
    if (activeMode === 'note' && (!leadId || leadId.startsWith('unmatched:'))) { setError('Create or link this contact before adding an internal note.'); return }

    setSending(true)
    setError(null)

    try {
      const isInternalNote = activeMode === 'note'
      const res = await fetch(
        isInternalNote ? `/api/leads/${leadId}/activities` : '/api/conversations/send',
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isInternalNote ? {
          description: message.trim(),
          agent: 'Ernest',
        } : {
          leadId: leadId?.startsWith('unmatched:') ? null : leadId,
          phone,
          to: activeMode === 'email' ? email : undefined,
          subject: activeMode === 'email' ? subject.trim() || 'Message from Saving KC' : undefined,
          body: message.trim(),
          mode: activeMode,
          fromPhone: activeMode === 'sms' ? fromPhone : undefined,
          agent: 'Ernest', // TODO: pass logged-in user name
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')

      setMessage('')
      setSubject('')
      onSent?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleTemplateSelect(template: typeof templates[0]) {
    let body = template.body
    // Simple merge field resolution with available data
    body = body.replace(/\{firstName\}/g, 'there')
    body = body.replace(/\{propertyAddress\}/g, 'your property')
    setMessage(body)
    setShowTemplates(false)
  }

  return (
    <div className="relative z-10 flex-shrink-0 border-t border-[#dde2e8] bg-white p-4">
      <div className="overflow-hidden rounded-lg border border-[#ccd3dc] bg-white">
        {/* Toggle Tabs */}
        <div className="flex border-b border-outline-variant/5">
          {modes.map((mode) => (
            <button
              key={mode.key}
              type="button"
              onClick={() => setActiveMode(mode.key)}
              aria-pressed={activeMode === mode.key}
              className={cn(
                'flex items-center gap-2 border-b-2 px-5 py-2.5 text-xs font-bold transition-all',
                activeMode === mode.key
                  ? 'border-[#df3038] text-[#b91c26]'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              <Icon name={mode.icon} className="text-sm" />
              {mode.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="px-6 pt-3 text-xs text-red-500 font-medium">{error}</div>
        )}

        {/* From number (SMS only) — auto-detected from conversation, manual only for new outreach */}
        {activeMode === 'sms' && (
          <div className="px-6 pt-3 flex items-center gap-2">
            <span className="text-xs text-on-surface-variant/60 font-medium">From:</span>
            {replyFromPhone ? (
              <span className="text-xs font-medium text-slate-700 bg-slate-100 px-2 py-1 rounded-lg">
                {TWILIO_NUMBERS.find(n => n.value === replyFromPhone)?.label || formatPhone(replyFromPhone)}
              </span>
            ) : (
              <select
                aria-label="Sending phone number"
                value={fromPhone}
                onChange={(e) => setFromPhone(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700"
              >
                {TWILIO_NUMBERS.map((n) => (
                  <option key={n.value} value={n.value}>{n.label}</option>
                ))}
              </select>
            )}
          </div>
        )}
        {activeMode === 'email' ? (
          <div className="border-t border-[#eef1f4] px-5 py-2">
            <input aria-label="Email subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Email subject" className="h-8 w-full border-0 bg-transparent text-xs font-semibold text-slate-700 outline-none placeholder:text-slate-400" />
          </div>
        ) : null}

        {/* Input Area */}
        <div className="flex items-end gap-3 p-3">
          <div className="flex-1">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-14 w-full resize-none border-none bg-transparent p-2 text-sm text-slate-700 focus:outline-none focus:ring-0"
              placeholder={
                activeMode === 'sms'
                  ? 'Type your message... (Enter to send)'
                  : activeMode === 'email'
                    ? 'Compose email...'
                  : 'Add an internal note...'
              }
              spellCheck={false}
              disabled={sending}
            />
            <div className="flex gap-2 p-2">
              <button type="button" onClick={() => setMessage((value) => `${value}${value ? ' ' : ''}🙂`)} title="Add emoji" className="p-1.5 hover:bg-surface-container rounded-lg transition-all">
                <Icon name="mood" className="text-on-surface-variant text-lg" />
              </button>
              <button
                type="button"
                onClick={() => setShowTemplates(!showTemplates)}
                className="p-1.5 hover:bg-surface-container rounded-lg transition-all relative"
                title="Templates"
              >
                <Icon name="bolt" className="text-on-surface-variant text-lg" />
              </button>
            </div>
            {showTemplates && templates.length > 0 && (
              <div className="absolute bottom-full left-0 mb-2 w-80 max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-50">
                <div className="p-2 border-b border-slate-100 text-xs font-bold text-slate-500 uppercase tracking-wide">Templates</div>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleTemplateSelect(t)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-50 last:border-0"
                  >
                    <div className="text-xs font-semibold text-slate-700">{t.name.replace(/_/g, ' ')}</div>
                    <div className="text-xs text-slate-400 truncate">{t.body}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleSend}
            aria-label={activeMode === 'note' ? 'Add internal note' : activeMode === 'email' ? 'Send email' : 'Send text message'}
            disabled={sending || !message.trim()}
            className={cn(
              'mb-2 flex h-10 w-16 items-center justify-center rounded-md text-sm font-bold transition-all',
              sending || !message.trim()
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-[#df3038] text-white hover:bg-[#c9232d]'
            )}
          >
            {sending
              ? <Icon name="hourglass_empty" className="text-sm animate-spin" />
              : <Icon name="send" />
            }
          </button>
        </div>
      </div>
    </div>
  )
}
