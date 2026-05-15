'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { toProperCase, formatPhone } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'

// ── Agent → default Twilio number mapping ──
const AGENT_DEFAULT_NUMBERS: Record<string, string> = {
  ernest: '+18166088588',  // (816) 608-8588 — Ernest Company
  casey:  '+18167277667',  // (816) 727-7667 — Casey Company
}

function getAgentFromEmail(email: string | undefined | null): string {
  if (!email) return 'Ernest'
  if (email.includes('casey')) return 'Casey'
  return 'Ernest'
}

function getDefaultFromPhone(email: string | undefined | null): string {
  if (!email) return AGENT_DEFAULT_NUMBERS.ernest
  const key = email.includes('casey') ? 'casey' : 'ernest'
  return AGENT_DEFAULT_NUMBERS[key]
}

interface Lead {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  assigned_agent: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

interface PropertyMeta {
  parcelId?: string
  legalDescription?: string
}

interface Activity {
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

interface ComposeModalProps {
  lead: Lead
  onClose: () => void
  onSent?: () => void
  initialTab?: 'sms' | 'email'
}

export function SmsComposeModal({ lead, onClose, onSent, initialTab = 'sms' }: ComposeModalProps) {
  const { user } = useAuth()
  const agentName = getAgentFromEmail(user?.email)

  const [activeTab, setActiveTab] = useState<'sms' | 'email'>(initialTab)
  const [messages, setMessages] = useState<Activity[]>([])
  const [message, setMessage] = useState('')
  const [fromPhone, setFromPhone] = useState<string>(AGENT_DEFAULT_NUMBERS.ernest)
  const [fromPhoneOverridden, setFromPhoneOverridden] = useState(false)

  // ── Set default from-number once auth loads ──
  useEffect(() => {
    if (user?.email && !fromPhoneOverridden) {
      setFromPhone(getDefaultFromPhone(user.email))
    }
  }, [user?.email, fromPhoneOverridden])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [templates, setTemplates] = useState<SmsTemplate[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [propertyMeta, setPropertyMeta] = useState<PropertyMeta>({})

  // Email-specific state
  const [emailTo, setEmailTo] = useState(lead.email || '')
  const [emailSubject, setEmailSubject] = useState(`${toProperCase(lead.full_name) || 'Your'} Property – Saving KC`)

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

  // ── Auto-detect reply number from last inbound SMS (only if user hasn't manually changed) ──
  useEffect(() => {
    if (fromPhoneOverridden) return
    const lastInbound = [...messages].reverse().find(
      m => m.activity_type === 'sms_received' || m.activity_type === 'sms_inbound'
    )
    if (lastInbound?.metadata?.to) {
      const matchedNumber = TWILIO_NUMBERS.find(n => n.value === lastInbound.metadata!.to)
      if (matchedNumber) setFromPhone(matchedNumber.value)
    }
  }, [messages, fromPhoneOverridden])

  // ── Load history + templates + property meta on mount ──
  useEffect(() => {
    fetchHistory()
    fetch('/api/sms-templates')
      .then(r => r.json())
      .then(data => setTemplates(data.templates || []))
      .catch(() => {})

    // Pull parcel + legal description from manifest
    ;(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('manifests')
        .select('manifest')
        .eq('lead_id', lead.id)
        .limit(1)
        .maybeSingle()
      const m = data?.manifest as any
      if (m?.property) {
        setPropertyMeta({
          parcelId: m.property.parcel || undefined,
          legalDescription: m.property.legalDescription || m.property.legal_description || undefined,
        })
      }
    })()
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

  // ── Clear state when switching tabs ──
  function switchTab(tab: 'sms' | 'email') {
    setActiveTab(tab)
    setMessage('')
    setError(null)
    setSent(false)
    setShowTemplates(false)
  }

  // ── Send SMS ──
  async function handleSendSms() {
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
          agent: agentName,
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

  // ── Send Email ──
  async function handleSendEmail() {
    if (!emailTo || !message.trim()) { setError('Recipient and message are required'); return }

    setSending(true)
    setError(null)
    setSent(false)

    try {
      const res = await fetch('/api/conversations/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          to: emailTo,
          subject: emailSubject,
          body: message.trim(),
          mode: 'email',
          agent: agentName,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')

      setMessage('')
      setSent(true)
      setTimeout(() => setSent(false), 2000)
      onSent?.()
    } catch (err: any) {
      setError(err.message || 'Failed to send email')
    } finally {
      setSending(false)
    }
  }

  function handleSend() {
    if (activeTab === 'sms') handleSendSms()
    else handleSendEmail()
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

  // ── Keyboard: Enter inserts a newline (default textarea behavior).
  // Only the Send button submits — agents sometimes paste multi-line messages
  // and accidental Enter-sends caused them to fire half-typed texts.
  // Cmd/Ctrl+Enter still sends for power users.
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  const isOutbound = (m: Activity) => m.activity_type === 'sms_sent'

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="ck-dark bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-lg flex flex-col border border-outline-variant/20" style={{ maxHeight: '80vh' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
            <div className="flex items-center gap-3">
              <Icon name={activeTab === 'sms' ? 'sms' : 'email'} className="text-primary text-xl" />
              <div>
                <h2 className="text-lg font-bold text-primary">
                  {activeTab === 'sms' ? 'Send Text' : 'Send Email'}
                </h2>
                <p className="text-xs text-on-surface-variant/60">
                  To: {toProperCase(lead.full_name)}
                  {activeTab === 'sms' && lead.phone && ` — ${formatPhone(lead.phone)}`}
                  {activeTab === 'email' && lead.email && ` — ${lead.email}`}
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

          {/* Tabs */}
          <div className="flex border-b border-outline-variant/10">
            <button
              onClick={() => switchTab('sms')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold transition-colors ${
                activeTab === 'sms'
                  ? 'text-blue-500 border-b-2 border-blue-500'
                  : 'text-on-surface-variant/50 hover:text-on-surface-variant'
              }`}
            >
              <Icon name="sms" size="text-sm" />
              Text
            </button>
            <button
              onClick={() => switchTab('email')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold transition-colors ${
                activeTab === 'email'
                  ? 'text-purple-500 border-b-2 border-purple-500'
                  : 'text-on-surface-variant/50 hover:text-on-surface-variant'
              }`}
            >
              <Icon name="email" size="text-sm" />
              Email
            </button>
          </div>

          {/* ── SMS Tab Content ── */}
          {activeTab === 'sms' && (
            <>
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

              {/* SMS Compose Area */}
              <div className="border-t border-outline-variant/10">
                {/* Property info quick-inserts */}
                {(lead.property_address || propertyMeta.parcelId || propertyMeta.legalDescription) && (
                  <div className="px-6 pt-3 flex flex-wrap gap-1.5">
                    {lead.property_address && (
                      <QuickInsert
                        label="Address"
                        onClick={() => setMessage((m) => (m ? m + '\n' : '') + `Property: ${[lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')}`)}
                      />
                    )}
                    {propertyMeta.parcelId && (
                      <QuickInsert
                        label={`Parcel ID: ${propertyMeta.parcelId}`}
                        onClick={() => setMessage((m) => (m ? m + '\n' : '') + `Parcel ID: ${propertyMeta.parcelId}`)}
                      />
                    )}
                    {propertyMeta.legalDescription && (
                      <QuickInsert
                        label="Legal Description"
                        onClick={() => setMessage((m) => (m ? m + '\n' : '') + `Legal: ${propertyMeta.legalDescription}`)}
                      />
                    )}
                  </div>
                )}

                {/* From number */}
                <div className="px-6 pt-3 flex items-center gap-2">
                  <span className="text-xs text-on-surface-variant/60 font-medium">From:</span>
                  <select
                    value={fromPhone}
                    onChange={(e) => { setFromPhone(e.target.value); setFromPhoneOverridden(true) }}
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
            </>
          )}

          {/* ── Email Tab Content ── */}
          {activeTab === 'email' && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Email fields */}
              <div className="px-6 pt-4 space-y-3">
                <div>
                  <label className="block text-[10px] font-black text-on-surface-variant/50 uppercase tracking-wider mb-1">To</label>
                  <input
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    className="w-full border border-outline-variant/20 rounded-xl px-4 py-2.5 text-sm bg-surface-container text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-on-surface-variant/50 uppercase tracking-wider mb-1">Subject</label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    className="w-full border border-outline-variant/20 rounded-xl px-4 py-2.5 text-sm bg-surface-container text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              {/* Email body */}
              <div className="px-6 py-3 flex-1 flex flex-col">
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your email…"
                  rows={6}
                  autoFocus
                  className="w-full flex-1 resize-none rounded-xl border border-outline-variant/20 bg-surface-container px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {/* Email send footer */}
              <div className="px-6 pb-4 flex items-center gap-2">
                <button
                  onClick={handleSend}
                  disabled={sending || !message.trim() || !emailTo}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-purple-600 text-white font-bold text-sm hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {sending ? (
                    <Icon name="progress_activity" className="animate-spin text-sm" />
                  ) : sent ? (
                    <><Icon name="check" size="text-sm" /> Sent</>
                  ) : (
                    <><Icon name="send" size="text-sm" /> Send Email</>
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
          )}
        </div>
      </div>
    </>
  )
}

function QuickInsert({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] px-2 py-1 rounded-full border border-outline-variant/30 hover:bg-surface-container text-on-surface-variant flex items-center gap-1"
      title="Insert into message"
    >
      <Icon name="add" className="!text-[12px]" />
      <span className="truncate max-w-[180px]">{label}</span>
    </button>
  )
}
