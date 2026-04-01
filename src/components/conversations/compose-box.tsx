'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Icon } from '@/components/ui/icon'

type ComposeMode = 'sms' | 'email' | 'call'

const modes: { key: ComposeMode; label: string; icon: string }[] = [
  { key: 'sms', label: 'SMS', icon: 'sms' },
  { key: 'email', label: 'Email', icon: 'mail' },
  { key: 'call', label: 'Call', icon: 'call' },
]

const TWILIO_NUMBERS = [
  { label: '(816) 307-7835 — Main', value: '+18163077835' },
  { label: '(816) 429-2900 — SKC Business', value: '+18164292900' },
  { label: '(816) 608-8858', value: '+18166088858' },
  { label: '(816) 608-8770', value: '+18166088770' },
  { label: '(816) 608-8808', value: '+18166088808' },
  { label: '(816) 608-8552', value: '+18166088552' },
  { label: '(816) 608-8559', value: '+18166088559' },
  { label: '(816) 608-6699', value: '+18166086699' },
  { label: '(816) 310-0845', value: '+18163100845' },
  { label: '(816) 640-4701', value: '+18166404701' },
  { label: '(816) 608-6648', value: '+18166086648' },
  { label: '(816) 608-6999', value: '+18166086999' },
  { label: '(816) 608-8588 — Ernest Company', value: '+18166088588' },
  { label: '(816) 476-1344', value: '+18164761344' },
  { label: '(816) 727-7667 — Casey Company', value: '+18167277667' },
]

interface ComposeBoxProps {
  leadId?: string
  phone?: string
  onSent?: () => void
  replyFromPhone?: string // Auto-select the Twilio number the lead last texted
}

export function ComposeBox({ leadId, phone, onSent, replyFromPhone }: ComposeBoxProps) {
  const [activeMode, setActiveMode] = useState<ComposeMode>('sms')
  const [message, setMessage] = useState('')
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

  async function handleSend() {
    if (!message.trim()) return
    if (!phone) { setError('No phone number for this contact'); return }

    setSending(true)
    setError(null)

    try {
      const res = await fetch('/api/conversations/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: leadId?.startsWith('unmatched:') ? null : leadId,
          phone,
          body: message.trim(),
          mode: activeMode,
          fromPhone: activeMode === 'sms' ? fromPhone : undefined,
          agent: 'Ernest', // TODO: pass logged-in user name
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')

      setMessage('')
      onSent?.()
    } catch (err: any) {
      setError(err.message || 'Failed to send')
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
    <div className="p-8 pt-0 relative z-10 flex-shrink-0">
      <div className="bg-white rounded-3xl shadow-[0px_8px_32px_rgba(0,0,0,0.08)] border border-outline-variant/10 overflow-hidden">
        {/* Toggle Tabs */}
        <div className="flex border-b border-outline-variant/5">
          {modes.map((mode) => (
            <button
              key={mode.key}
              onClick={() => setActiveMode(mode.key)}
              className={cn(
                'px-8 py-4 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all',
                activeMode === mode.key
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-on-surface-variant/40 hover:text-on-surface-variant'
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
                {TWILIO_NUMBERS.find(n => n.value === replyFromPhone)?.label || replyFromPhone}
              </span>
            ) : (
              <select
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

        {/* Input Area */}
        <div className="p-4 flex items-end gap-4">
          <div className="flex-1">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full border-none focus:ring-0 text-sm p-2 resize-none h-20 bg-transparent focus:outline-none"
              placeholder={
                activeMode === 'sms'
                  ? 'Type your message... (Enter to send)'
                  : activeMode === 'email'
                    ? 'Compose email...'
                    : 'Add call notes...'
              }
              spellCheck={false}
              disabled={sending}
            />
            <div className="flex gap-2 p-2">
              <button className="p-1.5 hover:bg-surface-container rounded-lg transition-all">
                <Icon name="mood" className="text-on-surface-variant text-lg" />
              </button>
              <button className="p-1.5 hover:bg-surface-container rounded-lg transition-all">
                <Icon name="attach_file" className="text-on-surface-variant text-lg" />
              </button>
              <button
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
            onClick={handleSend}
            disabled={sending || !message.trim()}
            className={cn(
              'w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-lg mb-2',
              sending || !message.trim()
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-primary text-on-primary hover:scale-[1.02] active:scale-95'
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
