'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { toProperCase, formatPhone } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'

interface Lead {
  id: string
  full_name: string | null
  phone: string | null
  property_address: string | null
  assigned_agent: string | null
}

interface SmsActivity {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, any> | null
  created_at: string
}

interface SmsTemplate {
  id: string
  name: string
  category: string
  body: string
  merge_fields: string[]
}

interface SmsComposeModalProps {
  lead: Lead
  onClose: () => void
  onSent?: () => void
}

export function SmsComposeModal({ lead, onClose, onSent }: SmsComposeModalProps) {
  const [messages, setMessages] = useState<SmsActivity[]>([])
  const [message, setMessage] = useState('')
  const [fromPhone, setFromPhone] = useState<string>(TWILIO_NUMBERS[0].value)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [templates, setTemplates] = useState<SmsTemplate[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Fetch conversation history ──
  async function fetchHistory() {
    const supabase = createClient()
    const { data } = await supabase
      .from('lead_activities')
      .select('id, activity_type, description, agent, metadata, created_at')
      .eq('lead_id', lead.id)
      .in('activity_type', ['sms_sent', 'sms_received', 'sms_inbound'])
      .order('created_at', { ascending: true })
      .limit(50)
    if (data) setMessages(data)
  }

  // ── Auto-detect reply number from last inbound SMS ──
  useEffect(() => {
    const lastInbound = [...messages].reverse().find(
      m => m.activity_type === 'sms_received' || m.activity_type === 'sms_inbound'
    )
    if (lastInbound?.metadata?.to) {
      const matchedNumber = TWILIO_NUMBERS.find(n => n.value === lastInbound.metadata!.to)
      if (matchedNumber) setFromPhone(matchedNumber.value)
    }
  }, [messages])

  // ── Load history + templates on mount ──
  useEffect(() => {
    fetchHistory()
    fetch('/api/sms-templates')
      .then(r => r.json())
      .then(data => setTemplates(data.templates || []))
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime subscription for new messages ──
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`sms-modal-${lead.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'lead_activities',
          filter: `lead_id=eq.${lead.id}`,
        },
        (payload: any) => {
          const type = payload.new?.activity_type
          if (type === 'sms_sent' || type === 'sms_received' || type === 'sms_inbound') {
            fetchHistory()
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [lead.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll on new messages ──
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // ── Send SMS ──
  async function handleSend() {
    if (!message.trim()) return
    if (!lead.phone) { setError('No phone number for this contact'); return }

    setSending(true)
    setError(null)
    setSent(false)

    try {
      const res = await fetch('/api/conversations/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          phone: lead.phone,
          body: message.trim(),
          mode: 'sms',
          fromPhone,
          agent: lead.assigned_agent || 'Ernest',
        }),
      })

      const data = await res.json()

      if (res.status === 400 && data.error?.toLowerCase().includes('opt')) {
        setError('This number has opted out of SMS messages')
        return
      }
      if (res.status === 409) {
        setError('Duplicate message — already sent recently')
        return
      }
      if (!res.ok) throw new Error(data.error || 'Send failed')

      setMessage('')
      setSent(true)
      setTimeout(() => setSent(false), 2000)
      onSent?.()
    } catch (err: any) {
      setError(err.message || 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  // ── Merge template fields ──
  function applyTemplate(template: SmsTemplate) {
    let body = template.body
    const firstName = (lead.full_name || '').split(' ')[0]
    body = body.replace(/\{firstName\}/g, toProperCase(firstName) || 'there')
    body = body.replace(/\{propertyAddress\}/g, lead.property_address || 'your property')
    setMessage(body)
    setShowTemplates(false)
    textareaRef.current?.focus()
  }

  // ── Keyboard: Enter to send, Shift+Enter for newline ──
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isOutbound = (m: SmsActivity) => m.activity_type === 'sms_sent'

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: '80vh' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
            <div className="flex items-center gap-3">
              <Icon name="sms" className="text-primary text-xl" />
              <div>
                <h2 className="text-lg font-bold text-primary">Send Text</h2>
                <p className="text-xs text-on-surface-variant/60">
                  To: {toProperCase(lead.full_name)} — {formatPhone(lead.phone)}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-on-surface-variant hover:text-primary transition-colors"
            >
              <Icon name="close" />
            </button>
          </div>

          {/* Conversation History */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3 min-h-0">
            {messages.length === 0 && (
              <p className="text-sm text-on-surface-variant/40 text-center py-8">No SMS history yet</p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${isOutbound(m) ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    isOutbound(m)
                      ? 'bg-primary text-on-primary rounded-br-md'
                      : 'bg-surface-container text-on-surface rounded-bl-md'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.description}</p>
                  <p className={`text-[10px] mt-1 ${isOutbound(m) ? 'text-on-primary/60' : 'text-on-surface-variant/40'}`}>
                    {new Date(m.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    {m.agent && isOutbound(m) && ` · ${m.agent}`}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Compose Area */}
          <div className="border-t border-outline-variant/10">
            {/* From number */}
            <div className="px-6 pt-3 flex items-center gap-2">
              <span className="text-xs text-on-surface-variant/60 font-medium">From:</span>
              <select
                value={fromPhone}
                onChange={(e) => setFromPhone(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700"
              >
                {TWILIO_NUMBERS.map((n) => (
                  <option key={n.value} value={n.value}>{n.label}</option>
                ))}
              </select>
            </div>

            {/* Message input + actions */}
            <div className="px-6 py-3 flex items-end gap-2">
              <div className="relative flex-1">
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message…"
                  rows={2}
                  className="w-full resize-none rounded-xl border border-outline-variant/20 bg-surface-container px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/30 pr-10"
                />
                {/* Templates button */}
                <div className="absolute right-2 bottom-2">
                  <button
                    type="button"
                    onClick={() => setShowTemplates(!showTemplates)}
                    className="text-on-surface-variant/40 hover:text-primary transition-colors"
                    title="Insert template"
                  >
                    <Icon name="bolt" className="text-lg" />
                  </button>
                  {showTemplates && (
                    <div className="absolute bottom-8 right-0 w-56 bg-white rounded-xl shadow-xl border border-outline-variant/10 py-1 z-10 max-h-48 overflow-y-auto">
                      {templates.length === 0 && (
                        <p className="text-xs text-on-surface-variant/40 px-3 py-2">No templates</p>
                      )}
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => applyTemplate(t)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-surface-container transition-colors"
                        >
                          <span className="font-medium text-on-surface">{t.name}</span>
                          <span className="block text-on-surface-variant/50 truncate">{t.body}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Send button */}
              <button
                onClick={handleSend}
                disabled={sending || !message.trim()}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                {sending ? (
                  <Icon name="progress_activity" className="animate-spin text-lg" />
                ) : sent ? (
                  <Icon name="check" className="text-lg" />
                ) : (
                  <Icon name="send" className="text-lg" />
                )}
              </button>
            </div>

            {/* Error display */}
            {error && (
              <div className="px-6 pb-3">
                <p className="text-xs text-error bg-error/10 rounded-lg px-3 py-2">{error}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
